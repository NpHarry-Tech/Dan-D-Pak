# System map — Phase A

## Runtime hiện tại

`Flutter Desktop/Tablet/Phone` → HTTPS/Socket.IO → `Caddy` → `Node server/index.js` → `server/api.js` → route modules → service modules → SQLite production.

Hardware Print Agent chạy trên từng máy POS, poll/claim job từ backend rồi báo kết quả. Tích hợp ngân hàng gọi webhook vào backend; MISA được xử lý qua hàng đợi hóa đơn. VPS đang giữ SQLite và volume lâu dài, trái với tài liệu cũ nói VPS chỉ là gateway.

| Lớp | Entry/source chính | Trách nhiệm | Rủi ro chính |
|---|---|---|---|
| Bootstrap | `server/index.js` | HTTP, realtime, worker | Không nhúng release manifest |
| API | `server/api.js`, `server/modules/*/routes.js` | Auth, branch scope, orchestration | Payment route ghi giá trước transaction |
| Domain | `server/services/*.js` | Order, price, pay, stock, print, invoice, report | Transaction và side effect bị trộn |
| Persistence | `server/db.js`, `server/db/*` | SQLite schema/migration/trigger | `user_version=0`; hot tables thiếu FK |
| Client | `flutter-apps/dandpak_core` + app shells | UI/state/API/cache/agent | Chưa có business outbox |
| Print agent | `server/agent.cjs`, Flutter local agent | Claim/dispatch/report | Không có version độc lập; “printed” chưa chứng minh giấy ra |
| Deploy | Docker Compose/Caddy/release slots | Backend và OTA | Deploy để lại file legacy |

## Điểm nóng coupling

- `printing.js` hơn 2.600 dòng, trộn route resolution, render, queue, claim và dispatch.
- `inventory.js`, `db.js`, `reportCenter.js`, `payments.js` đều trên khoảng 1.100 dòng.
- Các màn bán hàng Flutter lớn hơn 2.000 dòng, trộn UI và workflow.
- Không refactor chỉ vì kích thước; chỉ tách seam cần cho transaction, snapshot, clock và outbox.

## Tài liệu lệch runtime

`DATA_OWNERSHIP.md`, `OFFLINE_FIRST_ARCHITECTURE.md`, `DATABASE_SCHEMA.md` mô tả company server/Postgres là nguồn chuẩn; production thực tế dùng SQLite trên VPS. `PRINT_WORKFLOW.md` mô tả `print_attempts`/`reprint_logs` nhưng schema production không có.

46 file dư trên image/VPS không nằm trong import graph hiện hành. Không xóa trong Phase A. Deployment sau phải tạo image sạch và kiểm manifest thay vì chép đè thư mục.
