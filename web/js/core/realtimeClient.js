import { resolveRealtimeUrl } from './config.js';

export function connectRealtime(device, branch, handlers = {}, setOnline = () => {}, token = '') {
  if (typeof io === 'undefined') {
    console.warn('[realtime] socket.io client not loaded; realtime disabled, REST still works');
    return { on() {}, emit() {}, disconnect() {} };
  }

  const base = resolveRealtimeUrl();
  // Gửi token + branch + device qua cả `query` và `auth` để server xác thực kết nối.
  // Thiết bị khách tự phục vụ (device==='ipad') được server miễn token.
  const opts = { query: { branch, device, token }, auth: { branch, device, token } };
  const socket = base ? io(base, opts) : io(opts);

  socket.on('connect', () => setOnline(true));
  socket.on('disconnect', () => setOnline(false));
  for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);
  return socket;
}
