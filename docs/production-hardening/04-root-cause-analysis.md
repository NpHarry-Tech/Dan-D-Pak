# Root-cause analysis — Phase A

## RC-01 — Payment unit of work chứa side effect không nguyên tử

Archive, print jobs và realtime nằm trước COMMIT. SQLite rollback không thu hồi file/event; lỗi print có thể kéo rollback tiền. Gốc là thiếu transactional outbox và ranh giới “commit tiền trước, side effect sau”.

## RC-02 — Idempotency không xuyên suốt operation

Server có payment key nhưng client sinh key mới mỗi lần; stock movement và print job thiếu semantic unique key. Chưa có operation identity xuyên device → payment → inventory → print → invoice.

## RC-03 — Thiếu immutable Sale Snapshot dùng chung

E-invoice có snapshot riêng nhưng receipt/history/report/accounting vẫn dựa operational records hoặc job payload. Snapshot cục bộ cho MISA chưa là contract của toàn sale.

## RC-04 — Rule tồn kho cũ trái yêu cầu

`orders.js` và `retail.js` chủ ý cho bán xuống âm để xử lý nhập chậm. Fix phải khóa atomically tại ledger, không chỉ validate trước.

## RC-05 — Time không có ownership

Module tự dùng `new Date`, `toISOString`, host-local boundary, hardcoded +7 và `Intl`. MISA/printing xử lý cục bộ nhưng report/archive/shifts không thống nhất.

## RC-06 — Offline được mô tả nhưng chưa được xây

Preferences cache và server trigger queue không phải mutation outbox; không có device mutation schema/conflict state.

## RC-07 — Deploy không immutable

Artifact không nhúng commit/schema/agent version và filesystem còn file cũ. Import graph không gọi file dư hiện tại nhưng release không tự chứng minh nguồn.

## Devil’s advocate

- Chuyển print sau commit bằng `setTimeout` vẫn có cửa sổ mất job; phải ghi intent trong transaction.
- “SELECT rồi UPDATE stock” vẫn race; cần conditional atomic update/ledger constraint và test hai thiết bị.
- Không backfill snapshot bill cũ bằng catalog hiện tại; chỉ dùng dữ liệu có provenance.
- Cùng idempotency key khác payload phải 409.
- Driver Windows/ESC-POS thường không xác nhận giấy ra; UI phải dùng trạng thái đúng capability.
- Edge offline tăng availability nhưng tạo distributed consistency; không rollout cùng migration tiền/kho.
