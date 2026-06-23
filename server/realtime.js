// Socket.IO realtime hub. Every device joins its branch room and receives
// live events: new orders, item status changes, table/payment/menu/inventory updates.
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { audit } from './db.js';

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

export function initRealtime(httpServer) {
  const corsOrigin = env.CORS_ORIGINS.length ? env.CORS_ORIGINS : (env.isProduction ? [] : '*');
  io = new Server(httpServer, { cors: { origin: corsOrigin, credentials: true } });

  io.on('connection', (socket) => {
    const branch = socket.handshake.query.branch || 'br1';
    const device = socket.handshake.query.device || 'unknown';
    socket.join('branch:' + branch);
    socket.data.branch = branch;
    socket.data.device = device;
    logDeviceConnect(branch, device, cleanIp(socket.handshake.address));
    emitPresence(branch);

    socket.on('disconnect', () => emitPresence(branch));
  });

  return io;
}

// Broadcast an event to everyone in a branch.
export function emit(event, payload, branch = 'br1') {
  if (io) io.to('branch:' + branch).emit(event, payload);
}

function emitPresence(branch) {
  if (!io) return;
  const room = io.sockets.adapter.rooms.get('branch:' + branch);
  const sockets = room ? [...room].map(id => io.sockets.sockets.get(id)) : [];
  const devices = {};
  for (const s of sockets) {
    const d = s?.data?.device || 'unknown';
    devices[d] = (devices[d] || 0) + 1;
  }
  io.to('branch:' + branch).emit('presence', { count: sockets.length, devices });
}

export function getActiveConnections(branch = 'br1') {
  if (!io) return [];
  const room = io.sockets.adapter.rooms.get('branch:' + branch);
  if (!room) return [];
  return [...room].map(id => {
    const s = io.sockets.sockets.get(id);
    return {
      id: s.id,
      device: s.data.device || 'unknown',
      ip: s.handshake.address,
      connectedAt: s.handshake.issued || Date.now()
    };
  });
}
