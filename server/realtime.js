// Socket.IO realtime hub. Every device joins its branch room and receives
// live events: new orders, item status changes, table/payment/menu/inventory updates.
import { Server } from 'socket.io';

let io = null;

export function initRealtime(httpServer) {
  io = new Server(httpServer, { cors: { origin: '*' } });

  io.on('connection', (socket) => {
    const branch = socket.handshake.query.branch || 'br1';
    const device = socket.handshake.query.device || 'unknown';
    socket.join('branch:' + branch);
    socket.data.branch = branch;
    socket.data.device = device;
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
