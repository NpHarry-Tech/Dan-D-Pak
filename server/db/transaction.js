import { db } from './connection.js';

/** Chạy `fn` trong MỘT giao dịch, an toàn khi gọi lồng nhau.
 *
 *  Vì sao cần: các thao tác kho (chuyển kho, kiểm kho, xuất nội bộ) đụng tới
 *  nhiều bảng — tồn theo lô, phiếu kho, dòng phiếu, nhật ký chuyển động. Không
 *  bọc giao dịch thì một lỗi giữa chừng để lại phiếu áp NỬA VỜI: hàng đã trừ ở
 *  kho nguồn mà chưa cộng vào kho đích, hoặc ngược lại. Kiểm tra trước khi ghi
 *  (như code cũ vẫn làm) không cứu được, vì lỗi có thể xảy ra TRONG lúc ghi, và
 *  cũng không chặn được hai phiếu chạy đồng thời cùng rút một lô.
 *
 *  Vì sao phải RE-ENTRANT: SQLite không cho mở giao dịch trong giao dịch. Có
 *  luồng đã mở sẵn giao dịch ở lớp ngoài rồi mới gọi xuống tầng kho (bán hàng:
 *  retail.checkout mở giao dịch → trừ kho theo lô). Nếu tầng kho lại mở giao
 *  dịch mới thì cả luồng thanh toán vỡ. Ở đây phát hiện bằng chính lỗi SQLite
 *  trả về, nên hoạt động đúng kể cả khi lớp ngoài dùng `BEGIN IMMEDIATE` thô
 *  thay vì gọi hàm này.
 */
export function inTransaction(fn) {
  let owner = false;
  try {
    db.prepare('BEGIN IMMEDIATE').run();
    owner = true;
  } catch (e) {
    // Đã nằm trong giao dịch của lớp ngoài → chạy tiếp, để lớp đó quyết định
    // commit/rollback. Lỗi khác thì ném ra như bình thường.
    if (!/within a transaction/i.test(String(e?.message || ''))) throw e;
  }

  try {
    const out = fn();
    if (owner) db.prepare('COMMIT').run();
    return out;
  } catch (err) {
    if (owner) {
      try { db.prepare('ROLLBACK').run(); } catch { /* đã tự rollback */ }
    }
    throw err;
  }
}
