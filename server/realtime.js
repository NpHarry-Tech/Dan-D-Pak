// Socket.IO realtime hub. Every device joins its branch room and receives
// live events: new orders, item status changes, table/payment/menu/inventory updates.
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { audit } from './db.js';
import { userFor, canAccessBranch, userBranchIds, listBranches } from './services/auth.js';

let io = null;

// Ghi nhật ký khi có thiết bị mới kết nối — nhưng chống spam: cùng một
// thiết bị + IP chỉ ghi lại 1 lần trong khoảng TTL (tránh log mỗi lần F5/đổi trang/reconnect).
const recentConnLog = new Map(); // "branch|device|ip" -> lastLoggedMs
const CONN_LOG_TTL = 10 * 60 * 1000; // 10 phút

const cleanIp = (ip) => String(ip || '').replace('::ffff:', '').trim() || 'không rõ';

const EVENT_DEVICE_TARGETS = {
  'order:new': ['pos', 'kds', 'admin', 'retail'],
  'order:pending': ['pos', 'admin', 'retail'],
  'order:customer_pending': ['ipad', 'pos', 'admin', 'retail'],
  'order:confirmed': ['ipad', 'pos', 'kds', 'admin', 'retail'],
  'order:rejected': ['ipad', 'pos', 'admin', 'retail'],
  'order:updated': ['ipad', 'pos', 'kds', 'admin', 'retail'],
  'order:item': ['ipad', 'pos', 'kds', 'admin', 'retail'],
  'kds:refresh': ['kds', 'pos', 'admin'],
  'table:updated': ['ipad', 'pos', 'admin', 'retail'],
  'staff:call': ['pos', 'admin'],
  'payment:done': ['ipad', 'pos', 'admin', 'retail', 'invoice'],
  'print:new': ['printers', 'pos', 'admin'],
  'print:queued': ['printers', 'pos', 'admin'],
  'print:done': ['printers', 'pos', 'admin'],
  'print:failed': ['printers', 'pos', 'admin'],
  'inventory:updated': ['warehouse', 'purchase', 'retail', 'admin'],
  'inventory:alert': ['warehouse', 'purchase', 'retail', 'admin'],
  'expenses:updated': ['expenses', 'warehouse', 'admin'],
  'purchase:updated': ['purchase', 'warehouse', 'admin'],
  'customers:updated': ['contacts', 'admin', 'pos'],
  'menu:updated': ['ipad', 'pos', 'kds', 'admin', 'retail'],
  'stats:dirty': ['admin', 'reports', 'pos', 'retail'],
  'shift:updated': ['pos', 'admin', 'retail'],
  'sync:status': ['admin', 'reports'],
};

function deviceRoomsForEvent(event, branch) {
  const targets = EVENT_DEVICE_TARGETS[event];
  if (!targets?.length) return null;
  return targets.map(device => `branch:${branch}:device:${device}`);
}

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
  const corsOrigin = env.CORS_ORIGINS.includes('*')
    ? true
    : env.CORS_ORIGINS.length
      ? env.CORS_ORIGINS
      : (env.isProduction ? [] : true);
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
      let branch = socket.handshake.auth?.branch || socket.handshake.query?.branch || 'br1';
      const device = socket.handshake.auth?.device || socket.handshake.query?.device || 'unknown';
      // Thiết bị công cộng (ipad) không qua canAccessBranch ở middleware — chặn join chi nhánh
      // không tồn tại / dò chi nhánh tùy ý. Người dùng đã đăng nhập đã được validate ở io.use.
      if (!socket.data.user && !listBranches().some(b => b.id === branch)) branch = 'br1';
      const branchRooms = new Set([branch]);
      if (socket.data.user && ['admin', 'contacts', 'reports'].includes(device)) {
        for (const id of userBranchIds(socket.data.user)) branchRooms.add(id);
      }
      for (const id of branchRooms) {
        socket.join('branch:' + id);
        socket.join(`branch:${id}:device:${device}`);
      }
      socket.data.branch = branch;
      socket.data.branchRooms = [...branchRooms];
      socket.data.device = device;
      logDeviceConnect(branch, device, cleanIp(socket.handshake.address));
      for (const id of branchRooms) emitPresenceThrottled(id);

      socket.on('disconnect', () => {
        try {
          for (const id of socket.data.branchRooms || [branch]) emitPresenceThrottled(id);
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
    if (!io) return;
    const deviceRooms = deviceRoomsForEvent(event, branch);
    if (deviceRooms) {
      let target = io;
      for (const room of deviceRooms) target = target.to(room);
      target.emit(event, payload);
      return;
    }
    io.to('branch:' + branch).emit(event, payload);
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
      return {
        id: s.id,
        device: s?.data?.device || 'unknown',
        ip: s?.handshake?.address || '',
        connectedAt: s?.handshake?.issued || Date.now()
      };
    });
  } catch (err) {
    console.warn('[Socket.IO] getActiveConnections error:', err.message);
    return [];
  }
}
