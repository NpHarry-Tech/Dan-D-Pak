import { initRealtime, emit, getActiveConnections } from '../../realtime.js';

export function createSocketIoAdapter() {
  return {
    provider: 'socketio',
    initRealtime,
    emit,
    getActiveConnections,
  };
}
