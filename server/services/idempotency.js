// ─────────────────────────────────────────────────────────────────────────
// CHỐNG TRÙNG LỆNH GHI (idempotency).
//
// VÌ SAO CẦN — sự cố thật ở màn khách (self-order / catalogue):
// Khách bấm "Gửi đơn", mạng wifi cửa hàng lag hoặc server đang bận. App chờ
// 10 giây rồi báo lỗi. Khách bấm gửi lại, lần này vào được → BẾP NHẬN HAI ĐƠN.
//
// Điểm mấu chốt: HẾT THỜI GIAN CHỜ KHÔNG CÓ NGHĨA LÀ SERVER CHƯA CHẠY. Rất
// thường là server ĐÃ tạo đơn xong, chỉ là câu trả lời về không kịp trước khi
// app bỏ cuộc. Client không có cách nào phân biệt "chưa chạy" với "chạy rồi mà
// trả lời chậm" — nên client KHÔNG BAO GIỜ được tự quyết gửi lại là an toàn.
//
// Cách chặn: client sinh MỘT mã cho MỘT lần bấm (không phải một lần gọi), gửi
// kèm mọi lần thử lại của chính lần bấm đó. Server nhớ mã; gặp lại mã cũ thì
// TRẢ VỀ ĐÚNG KẾT QUẢ CŨ, không chạy lại. Bấm lần mới = mã mới = đơn mới.
//
// Đã có idempotency riêng cho thanh toán (payments) và hóa đơn điện tử
// (e_invoices) — file này là bản DÙNG CHUNG cho các lệnh ghi còn lại.
// ─────────────────────────────────────────────────────────────────────────
import { db, now } from '../db.js';

db.exec(`CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL,
  scope TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  response_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(scope, key)
);`);

// Giữ 24 giờ là quá đủ: một lần bấm của khách không thể kéo dài hơn thế. Dọn
// định kỳ để bảng không phình theo năm tháng.
const TTL_GIO = 24;

// Lệnh đang chạy dở bao lâu thì coi là đã chết (server restart giữa chừng).
// Ngắn hơn thì lần thử lại hợp lệ bị chặn oan; dài hơn thì khách phải chờ lâu.
const CHAY_DO_TOI_DA_MS = 90_000;

function txt(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}

/** Mã chống trùng lấy từ header hoặc body. Không có -> null (chạy như cũ). */
export function idempotencyKeyOf(req) {
  return txt(req?.headers?.['idempotency-key']
    || req?.headers?.['x-idempotency-key']
    || req?.body?.idempotency_key) || null;
}

/**
 * Chạy [fn] đúng MỘT LẦN cho mỗi [key].
 *
 * Gọi lại với cùng key:
 *   - lần trước đã xong  -> trả lại NGUYÊN kết quả cũ, không chạy lại
 *   - lần trước đang dở  -> báo lỗi 409 để client chờ, KHÔNG chạy song song
 *                           (chạy song song là đúng cái ta đang muốn chặn)
 *   - lần trước chết dở  -> quá CHAY_DO_TOI_DA_MS thì cho chạy lại
 *
 * Không có key thì chạy thẳng — giữ tương thích với client bản cũ.
 */
export async function withIdempotency(scope, key, branch_id, fn) {
  if (!key) return fn();

  const s = txt(scope, 60);
  const k = txt(key);
  const cu = db.prepare(
    `SELECT status, response_json, created_at FROM idempotency_keys WHERE scope=? AND key=?`)
    .get(s, k);

  if (cu) {
    if (cu.status === 'done') {
      try { return JSON.parse(cu.response_json || 'null'); } catch { return null; }
    }
    const tuoi = Date.now() - Date.parse(cu.created_at || '');
    if (Number.isFinite(tuoi) && tuoi < CHAY_DO_TOI_DA_MS) {
      const e = new Error('Yêu cầu trước đó đang được xử lý, vui lòng chờ trong giây lát.');
      e.status = 409;
      throw e;
    }
    // Lần trước chết dở (server restart) → cho chạy lại từ đầu.
    db.prepare(`DELETE FROM idempotency_keys WHERE scope=? AND key=?`).run(s, k);
  }

  // Đặt chỗ TRƯỚC khi chạy. Hai request cùng key tới cùng lúc thì chỉ một cái
  // chèn được (PRIMARY KEY), cái còn lại rơi vào nhánh 409 ở trên.
  try {
    db.prepare(`INSERT INTO idempotency_keys (key,scope,branch_id,status,created_at)
        VALUES (?,?,?,'running',?)`).run(k, s, txt(branch_id, 80), now());
  } catch {
    const e = new Error('Yêu cầu trước đó đang được xử lý, vui lòng chờ trong giây lát.');
    e.status = 409;
    throw e;
  }

  try {
    const out = await fn();
    db.prepare(`UPDATE idempotency_keys SET status='done', response_json=? WHERE scope=? AND key=?`)
      .run(JSON.stringify(out ?? null), s, k);
    return out;
  } catch (err) {
    // LỖI THÌ XOÁ CHỖ ĐẶT. Lỗi nghiệp vụ (hết hàng, sai dữ liệu) phải cho phép
    // sửa rồi gửi lại bằng chính mã đó — giữ lại là khách bấm mãi không được.
    db.prepare(`DELETE FROM idempotency_keys WHERE scope=? AND key=?`).run(s, k);
    throw err;
  }
}

export function maintainIdempotencyKeys({ hours = TTL_GIO } = {}) {
  try {
    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
    return db.prepare(`DELETE FROM idempotency_keys WHERE created_at < ?`).run(cutoff).changes;
  } catch {
    return 0;
  }
}
