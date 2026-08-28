# MISA meInvoice / VAT — đối chiếu đặc tả 1.0.0

Ngày rà soát: 2026-08-01. Nguồn: hai nội dung đặc tả người dùng cung cấp.

| Nhóm yêu cầu | Code hiện tại | Trạng thái | Việc đã/chưa làm | Rủi ro / test |
|---|---|---|---|---|
| Bill đã trả luôn có HĐĐT | `payments.js`, `einvoice.js` | Đã có | Luôn tạo bản ghi `PENDING_PROVIDER` khi chưa nối MISA | Test toàn backend |
| Một bill / một RefID, retry giữ RefID | unique `idempotency_key`, `createInvoiceRequest`, `retryInvoice` | Đã có | Không sinh khóa mới khi retry | Test idempotency hiện có |
| Snapshot bất biến | `e_invoices.request_snapshot`, audit log | Có nhưng schema khác tên đặc tả | Snapshot giữ buyer/items/total tại lúc đóng bill | Cần migration versioned trước khi đổi schema lớn |
| Queue, retry, restart | `processInvoiceQueue`, SQLite | Đã có | Backoff lưu DB | Test queue/restart hiện có |
| Không phát hành mock | `einvoice.js` | Đã sửa | Bỏ phát hành số HĐ local giả; thiếu cấu hình chuyển `PENDING_PROVIDER` | `misa-production-blockers.test.mjs` |
| Khóa Production khi còn UNCONFIRMED | `misa.js`, settings route | Đã sửa | Chặn API type, tax method, rounding, template và config test chưa đạt | `misa-production-blockers.test.mjs` |
| Credential backend/mã hóa/audit | `settings/integrations.js` | Đã có | Secret mã hóa và frontend chỉ nhận masked value | Security regression tests |
| VAT integer | `core/money.js`, `tax.js`, `misa.js` | Đã có phần cốt lõi | BigInt/fixed-point; net + VAT = gross | Money/tax tests |
| Tax profile theo hiệu lực | SKU có VAT rate; chưa đủ bảng versioned theo đặc tả | Chưa đầy đủ | Không tự đoán hoặc hard-code lại | Cần quyết định kế toán + migration |
| Topping/bao bì/phụ thu tax profile riêng | Dữ liệu hiện hữu chưa đồng nhất | Chưa đầy đủ | Chưa migration vì VAT các loại còn UNCONFIRMED | Cần kế toán xác nhận |
| MISA adapter nhiều phiên bản | `misa.js` là adapter thực hiện tại | Chưa đầy đủ | Không tạo ba adapter giả khi chưa biết hợp đồng API | Cần MISA xác nhận loại API |
| Template lấy từ MISA | Chưa có contract endpoint chắc chắn | Chưa có | Production bị khóa bằng `templateId` | Cần sandbox/App ID và API contract |
| Màn cấu hình MISA đầy đủ | Màn liên kết chung đã có credential/test cơ bản | Chưa đầy đủ | Chưa hiển thị giả các bước chưa gọi được | Cần API MISA thật để hoàn thiện |
| Màn quản lý hóa đơn | `invoices_screen.dart`, invoice routes | Có nhưng chưa đủ toàn bộ enum/action 1.0.0 | Giữ nguyên để không phá vận hành | Cần phase UI/API riêng |
| K80/K57 cùng mẫu ba cột | `printing.js` | Đã sửa | Cùng thứ tự: tên → CTKM → SL/đơn giá net/thành tiền net; tổng net/VAT/gross căn phải | `print-paper-size.test.mjs` |

## Luồng hiện tại

`Payment → Bill paid/close → immutable request snapshot + RefID → SQLite queue → MISA → trạng thái CQT/PDF/XML`

## Nội dung bắt buộc còn UNCONFIRMED

- Phương pháp thuế; loại hóa đơn; loại API MISA; có/không mã CQT.
- VAT topping, bao bì, phụ thu; voucher và điểm thành viên.
- Quy tắc làm tròn; mapping multi-payment; trả hàng/điều chỉnh/thay thế.
- Template/series chính thức, sandbox credential, endpoint và rate limit theo hợp đồng MISA.

Production MISA không thể bật cho đến khi các mục trên cần cho phát hành đã được xác nhận và kiểm tra cấu hình đạt. Không có dữ liệu giả hoặc lựa chọn mặc định để vượt chốt này.

## Audit độ gọn

`server/services/invoices.js` và `server/services/einvoice.js` có phần trách nhiệm giao nhau, nhưng cả hai còn route/caller thật nên chưa đủ bằng chứng để xóa an toàn. Không thêm interface/adapter giả cho ba phiên bản MISA khi chưa có hợp đồng API; việc đó chỉ tăng code chết.
