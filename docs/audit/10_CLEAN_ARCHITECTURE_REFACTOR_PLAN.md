# 10 — CLEAN ARCHITECTURE REFACTOR PLAN

Không sửa production trong audit này. Đây là kế hoạch đề xuất, tăng dần, giữ hành vi.

## Vấn đề hiện tại (bằng chứng)
- `server/api.js` 1614 dòng: trộn HTTP routing + validation + nghiệp vụ (vd `/orders/:id/pay` gọi discount check + applyManualConfirm + payOrder + recordPurchase trong 1 handler; menu create INSERT thẳng trong route).
- `services/*` truy cập `db.prepare(...)` trực tiếp → không tách domain khỏi persistence; khó thay SQLite→Postgres dù đã có `adapters/`.
- HTML lớn (`web/*.html`) lẫn UI + workflow (README/KNOWN_CASES đã ghi nhận).
- Adapter Postgres/S3/WebSocket còn scaffold, chưa nối vào runtime.

## Kiến trúc đích (4 lớp)
```text
interfaces/ (HTTP, Socket.IO, webhook)   → chỉ parse req, gọi application, format res
  └─ controllers, route registrars, validators (zod-like), guards
application/ (use-cases)                 → orchestrate nghiệp vụ, transaction boundary, audit+emit
  └─ PayOrder, CreateOrder, ReceiveStock, IssueInvoice, ConfirmWebhook...
domain/ (entities + rules thuần)         → Order, Payment, Money, Discount rules, Shift, Inventory FEFO
  └─ không import express/sqlite
infrastructure/ (adapters)               → repositories (sqlite/postgres), realtime, storage, providers (payos/sepay/misa)
  └─ hiện thực interface do domain/application định nghĩa
```

## Lộ trình (giữ hành vi, PR nhỏ)
1. **Tách route khỏi nghiệp vụ**: chuyển logic inline trong `api.js` (menu CRUD, `/orders/:id/pay`, DMS) vào use-case/service tương ứng. api.js chỉ còn gọi + wrap.
2. **Repository layer**: gom mọi `db.prepare` theo bảng vào `infrastructure/repositories/*` (OrderRepo, PaymentRepo, InventoryRepo...). Service gọi repo, không chạm SQL.
3. **Payment provider port**: định nghĩa `PaymentGateway` interface; SePay/Casso/VietQR/payOS là adapter. Chuẩn hóa verify signature (timingSafeEqual) + fail-closed tại 1 chỗ.
4. **Validation tập trung**: schema cho mỗi endpoint (thay các `throw new Error('Thiếu...')` rải rác).
5. **Giữ một SQLite production**: chỉ xem xét provider khác khi có yêu cầu vận hành và kế hoạch migration đã được duyệt.
6. **Tách frontend**: rút workflow khỏi HTML lớn vào `web/js/*` module đã có (apiClient/eventBus). Hoặc hợp nhất về Flutter apps.
7. **CSP + hardening**: sau khi inline scripts được module hóa, bật CSP.

## Nguyên tắc an toàn khi refactor
- Mỗi bước có test đối chiếu response cũ/mới (golden test trên endpoint tiền/tồn/hóa đơn).
- Không đổi tên thư mục đang chạy (README cảnh báo) — map trong REPO_STRUCTURE.md.
- Không đụng permanent-storage / .env / DB trong refactor.
- Ưu tiên vùng tiền (payments), tồn kho (inventory), hóa đơn (einvoice) — rủi ro cao nhất.

## Quick wins (an toàn, không đổi kiến trúc) — làm trước
- Thêm guard cho `/inventory|/skus/:id/receive` (BL-01).
- `timingSafeEqual` cho SePay/Casso/VietQR (TP-01).
- Fail-closed webhook khi enabled thiếu secret (TP-02).
- Trần discount + audit (BL-02).
- Không xóa audit_log trong reset-transactions (BL-07).
- validateEnv fail-fast khi secret=change-me ở production (SEC-04).
