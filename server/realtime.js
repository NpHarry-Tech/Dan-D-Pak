// Socket.IO realtime hub. Every device joins its branch room and receives
// live events: new orders, item status changes, table/payment/menu/inventory updates.
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { audit } from './db.js';
import { userFor, canAccessBranch } from './services/auth.js';

let io = null;

// Ghi nhật ký khi có thiết bị mới kết nối — nhưng chống spam: cùng một
// thiết bị + IP chỉ ghi lại 1 lần trong khoảng TTL (tránh log mỗi lần F5/đổi trang/reconnect).
const recentConnLog = new Map(); // "branch|device|ip" -> lastLoggedMs
const CONN_LOG_TTL = 10 * 60 * 1000; // 10 phút

const cleanIp = (ip) => String(ip || '').replace('::ffff:', '').trim() || 'không rõ';

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
  io = new Server(httpServer, { cors: { origin: corsOrigin, credentials: true } });

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
      socket.join('branch:' + branch);
      socket.data.branch = branch;
      socket.data.device = device;
      logDeviceConnect(branch, device, cleanIp(socket.handshake.address));
      emitPresenceThrottled(branch);

      socket.on('disconnect', () => {
        try {
          emitPresenceThrottled(branch);
        } catch (err) {
          console.warn('[Socket.IO] disconnect presence error:', err.message);
        }
      });
    } catch (err) {
      console.warn('[Socket.IO] connection error:', err.message);
    }
  });

  return io;
}

// Broadcast an event to everyone in a branch.
export function emit(event, payload, branch = 'br1') {
  try {
    if (io) io.to('branch:' + branch).emit(event, payload);
  } catch (err) {
    console.warn('[Socket.IO] broadcast emit error:', err.message);
  }
}

function emitPresence(branch) {
  try {
    if (!io) return;
    const room = io.sockets.adapter.rooms.get('branch:' + branch);
    const sockets = room ? [...room].map(id => io.sockets.sockets.get(id)) : [];
    const devices = {};
    for (const s of sockets) {
      const d = s?.data?.device || 'unknown';
      devices[d] = (devices[d] || 0) + 1;
    }
    io.to('branch:' + branch).emit('presence', { count: sockets.length, devices });
  } catch (err) {
    console.warn('[Socket.IO] emitPresence error:', err.message);
  }
}

export function getActiveConnections(branch = 'br1') {
  try {
    if (!io) return [];
    const room = io.sockets.adapter.rooms.get('branch:' + branch);
    if (!room) return [];
    return [...room].map(id => {
      const s = io.sockets.sockets.get(id);
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
    console.warn('[Socket.IO] getActiveConnections error:', err.message);
    return [];
  }
}
