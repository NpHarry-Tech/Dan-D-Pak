// Socket.IO realtime hub. Every device joins its branch room and receives
// live events: new orders, item status changes, table/payment/menu/inventory updates.
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { audit } from './db.js';
import { userFor, canAccessBranch } from './services/auth.js';
import { normalizeIp } from './core/util.js';
import { logger } from './core/logger.js';

let io = null;

// Hai phòng theo chi nhánh:
//   staffRoom  = 'branch:<id>'        → thiết bị NHÂN VIÊN (đã đăng nhập token). Nhận
//                                        ĐẦY ĐỦ mọi sự kiện, payload nguyên vẹn.
//   ipadRoom   = 'branch:<id>:ipad'   → thiết bị KHÁCH (kiosk self-order, KHÔNG token).
//                                        CHỈ nhận whitelist sự kiện vận hành, đã XOÁ PII.
// Lý do: ai cũng khai được device='ipad' để kết nối không cần token → tuyệt đối không
// phát receipt/tiền/khách (payment:done, stats, ca, két...) vào phòng này.
const staffRoom = (b) => 'branch:' + b;
const ipadRoom = (b) => 'branch:' + b + ':ipad';

// Sự kiện kiosk khách ĐƯỢC nhận (trạng thái món / bàn / thực đơn). Mọi sự kiện khác
// (payment/stats/shift/cash-drawer/inventory/purchase/invoice/sync/settings...) chỉ ở staffRoom.
const IPAD_EVENTS = new Set([
  'order:new', 'order:updated', 'order:item', 'order:pending',
  'order:confirmed', 'order:rejected', 'order:customer_pending',
  'table:updated', 'menu:updated', 'book-menu:updated', 'payment:done',
]);

// Xoá thông tin khách (PII) khỏi payload trước khi gửi vào phòng kiosk công khai.
function scrubPii(o) {
  if (!o || typeof o !== 'object') return;
  delete o.customer_json; delete o.customer;
  delete o.customer_name; delete o.customer_phone;
  for (const k of Object.keys(o)) if (k.startsWith('invoice_')) delete o[k];
  if (o.order) scrubPii(o.order);
}
function sanitizeForIpad(event, payload) {
  // payment:done chỉ để kiosk biết bàn đã thanh toán (reset phiên) — BỎ hẳn receipt (PII + số tiền chi tiết).
  if (event === 'payment:done') {
    return { order_id: payload?.order_id || payload?.receipt?.order_id || null, paid: true };
  }
  if (!payload || typeof payload !== 'object') return payload;
  const clone = JSON.parse(JSON.stringify(payload)); // payload realtime nhỏ → clone an toàn
  scrubPii(clone);
  return clone;
}

// Gộp socket của cả 2 phòng (staff + kiosk) — dùng cho presence & danh sách thiết bị.
function socketsInBranch(branch) {
  if (!io) return [];
  const ids = new Set();
  for (const room of [staffRoom(branch), ipadRoom(branch)]) {
    const r = io.sockets.adapter.rooms.get(room);
    if (r) for (const id of r) ids.add(id);
  }
  return [...ids].map(id => io.sockets.sockets.get(id)).filter(Boolean);
}

// Ghi nhật ký khi có thiết bị mới kết nối — nhưng chống spam: cùng một
// thiết bị + IP chỉ ghi lại 1 lần trong khoảng TTL (tránh log mỗi lần F5/đổi trang/reconnect).
const recentConnLog = new Map(); // "branch|device|ip" -> lastLoggedMs
const CONN_LOG_TTL = 10 * 60 * 1000; // 10 phút

const cleanIp = (ip) => normalizeIp(ip) || 'không rõ';

function logDeviceConnect(branch, device, ip) {
  const key = `${branch}|${device}|${ip}`;
  const nowMs = Date.now();
  if (nowMs - (recentConnLog.get(key) || 0) < CONN_LOG_TTL) return;
  recentConnLog.set(key, nowMs);
  if (recentConnLog.size > 500) {
    for (const [k, t] of recentConnLog) if (nowMs - t > CONN_LOG_TTL) recentConnLog.delete(k);
  }
  try { audit('device.connect', { device, ip, connectedAt: new Date().toISOString() }, branch); } catch {}
}

const presenceTimers = new Map(); // branch -> timeout

function emitPresenceThrottled(branch) {
  if (presenceTimers.has(branch)) return;
  
  const timer = setTimeout(() => {
    presenceTimers.delete(branch);
    emitPresence(branch);
  }, 2000);
  
  presenceTimers.set(branch, timer);
}

export function initRealtime(httpServer) {
  const corsOrigin = env.CORS_ORIGINS.length ? env.CORS_ORIGINS : (env.isProduction ? [] : '*');
  io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    // Kiên nhẫn hơn với mạng chớp tắt: mặc định pingTimeout 20s khiến chỉ một
    // lần trễ mạng ngắn là server coi client "chết" và ngắt (nhân viên thấy
    // "MẤT KẾT NỐI" liên tục). Cho phép im lặng tới 40s trước khi coi là rớt,
    // ping mỗi 20s. Cho cả nâng cấp transport thêm thời gian.
    pingInterval: 20000,
    pingTimeout: 40000,
    upgradeTimeout: 20000,
    // Tablet/điện thoại có thể gửi ảnh SKU khi tạo món — nới buffer để không
    // đứt kết nối vì payload lớn.
    maxHttpBufferSize: 1e7,
  });

  // Middleware xác thực kết nối Socket.IO
  io.use((socket, next) => {
    try {
      const device = socket.handshake.auth?.device || socket.handshake.query?.device || 'unknown';
      // iPad là thiết bị công cộng đặt tại bàn, không cần xác thực token nhân viên
      if (device === 'ipad') {
        return next();
      }

      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        return next(new Error('Xác thực thất bại: Thiếu token truy cập.'));
      }

      const user = userFor(token);
      if (!user) {
        return next(new Error('Xác thực thất bại: Phiên làm việc không hợp lệ hoặc đã hết hạn.'));
      }

      const branch = socket.handshake.auth?.branch || socket.handshake.query?.branch || 'br1';
      if (!canAccessBranch(user, branch)) {
        return next(new Error('Xác thực thất bại: Không có quyền truy cập chi nhánh này.'));
      }

      socket.data.user = user;
      next();
    } catch (err) {
      next(new Error('Xác thực lỗi: ' + err.message));
    }
  });

  io.on('connection', (socket) => {
    try {
      const branch = socket.handshake.auth?.branch || socket.handshake.query?.branch || 'br1';
      const device = socket.handshake.auth?.device || socket.handshake.query?.device || 'unknown';
      // Kiosk khách (device='ipad', không token) → phòng công khai đã lọc PII.
      // Thiết bị nhân viên đã xác thực → phòng đầy đủ.
      socket.join(device === 'ipad' ? ipadRoom(branch) : staffRoom(branch));
      socket.data.branch = branch;
      socket.data.device = device;
      logDeviceConnect(branch, device, cleanIp(socket.handshake.address));
      emitPresenceThrottled(branch);

      socket.on('disconnect', () => {
        try {
          emitPresenceThrottled(branch);
        } catch (err) {
          logger.warn('socket disconnect presence error', { message: err.message });
        }
      });
    } catch (err) {
      logger.warn('socket connection error', { message: err.message });
    }
  });

  return io;
}

// Broadcast an event to everyone in a branch.
export function emit(event, payload, branch = 'br1') {
  try {
    if (!io) return;
    // Nhân viên: đầy đủ, nguyên vẹn.
    io.to(staffRoom(branch)).emit(event, payload);
    // Kiosk khách: chỉ sự kiện whitelist + đã xoá PII, và chỉ khi có kiosk đang kết nối.
    if (IPAD_EVENTS.has(event)) {
      const room = ipadRoom(branch);
      if (io.sockets.adapter.rooms.get(room)?.size) {
        io.to(room).emit(event, sanitizeForIpad(event, payload));
      }
    }
  } catch (err) {
    logger.warn('socket broadcast emit error', { message: err.message });
  }
}

function emitPresence(branch) {
  try {
    if (!io) return;
    const sockets = socketsInBranch(branch);
    const devices = {};
    for (const s of sockets) {
      const d = s?.data?.device || 'unknown';
      devices[d] = (devices[d] || 0) + 1;
    }
    io.to(staffRoom(branch)).emit('presence', { count: sockets.length, devices });
  } catch (err) {
    logger.warn('socket emitPresence error', { message: err.message });
  }
}

export function getActiveConnections(branch = 'br1') {
  try {
    if (!io) return [];
    return socketsInBranch(branch).map(s => {
      const u = s?.data?.user || null;
      return {
        id: s.id,
        device: s?.data?.device || 'unknown',   // loại màn hình (admin/pos/kds/ipad...)
        // Người đăng nhập thực trên thiết bị đó (iPad công cộng thì không có).
        user_name: u?.name || u?.username || '',
        user_role: u?.role || '',
        ip: s?.handshake?.address || '',
        connectedAt: s?.handshake?.issued || Date.now()
      };
    });
  } catch (err) {
    logger.warn('socket getActiveConnections error', { message: err.message });
    return [];
  }
}
