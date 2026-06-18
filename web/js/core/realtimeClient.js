import { resolveRealtimeUrl } from './config.js';

export function connectRealtime(device, branch, handlers = {}, setOnline = () => {}) {
  if (typeof io === 'undefined') {
    console.warn('[realtime] socket.io client not loaded; realtime disabled, REST still works');
    return { on() {}, emit() {}, disconnect() {} };
  }

  const base = resolveRealtimeUrl();
  const socket = base
    ? io(base, { query: { branch, device } })
    : io({ query: { branch, device } });

  socket.on('connect', () => setOnline(true));
  socket.on('disconnect', () => setOnline(false));
  for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);
  return socket;
}
