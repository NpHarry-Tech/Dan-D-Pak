// Realtime bus — a one-way decoupling seam between low-level modules and the
// Socket.IO layer.
//
// VÌ SAO CẦN: realtime.js đã `import { audit } from './db.js'`. Nếu db/audit.js
// import ngược realtime.js để phát sự kiện thì thành VÒNG import (db → realtime →
// auth → db). Bus này cắt vòng đó: realtime.js đăng ký hàm emit của nó vào đây tại
// initRealtime(), còn các module tầng dưới (audit, document registry…) chỉ gọi
// publishRealtime() mà KHÔNG cần biết tới realtime.js.
//
// An toàn khi KHÔNG có socket (unit test, cron, worker): chưa đăng ký emitter →
// no-op, không ném lỗi. Mọi lỗi phát sự kiện đều được nuốt để KHÔNG bao giờ làm
// hỏng nghiệp vụ đã gọi (ghi log/ghi tài liệu vẫn phải thành công).

let emitter = null;

// realtime.js gọi hàm này một lần tại initRealtime, truyền vào chính emit(event,
// payload, branch) của nó.
export function setRealtimeEmitter(fn) {
  emitter = typeof fn === 'function' ? fn : null;
}

// Có socket layer đang chạy hay chưa (dùng cho test/health).
export function hasRealtimeEmitter() {
  return emitter != null;
}

// Phát một domain event tới đúng chi nhánh. GỌI SAU KHI ĐÃ GHI DB THÀNH CÔNG
// (post-commit) — DatabaseSync ghi đồng bộ nên khi statement.run() trả về là đã
// commit ở chế độ autocommit. Best-effort, nuốt lỗi.
export function publishRealtime(event, payload, branch = 'sala') {
  if (!emitter) return false;
  try {
    emitter(event, payload, branch);
    return true;
  } catch {
    return false;
  }
}
