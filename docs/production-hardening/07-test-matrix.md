# Test matrix bắt buộc

Hardware/manual execution uses [13-manual-acceptance-checklist.md](13-manual-acceptance-checklist.md);
all ACC-01..ACC-19 rows require observed result, IDs/logs and screenshot/artifact evidence.

## Payment/concurrency

- Cùng idempotency key/payload: một payment, replay cùng kết quả; khác payload/order: 409.
- Timeout sau commit rồi retry: không thu/trừ kho/in/cộng điểm hai lần.
- Hai POS trả cùng bill; webhook và POS race; webhook duplicate/out-of-order.
- Print/agent/archive/invoice worker fail không đổi payment success.
- Partial, over-tender cash, non-cash overpay, zero-total.

## Inventory

- Tồn 0, sát biên, đủ đúng, thiếu 1, qty lớn; hai transaction tranh SKU.
- Combo/component, retail trong F&B, return/refund/cancel.
- Invariant: stock không âm; mỗi sale movement đúng một lần.

## Pricing/promotion — tối thiểu 1.000 case

Deterministic matrix + seeded property tests: 1/2/5 item, qty 1/lớn, combo thấp/bằng/cao giá lẻ, manual item/order discount, item/order voucher, multiple promo, birthday/time range/expired/disabled/min spend/free unit/100%/rounding/duplicate/non-stackable/concurrent revision.

Invariant: `final_total >= 0`; discount không vượt base; adjustment không áp lặp trái rule; fixed combo authoritative; checkout = payment required = snapshot = receipt = invoice = report.

## Time/print/offline/device

- Time: 23:59:59, 00:00:00, cuối tháng/năm, host UTC, client +07; order 23:50 paid 00:10.
- Print: 1–9 copies, retry intent, reprint, claim race, late ACK, no printer, LAN/system/browser.
- Offline: restart ở QUEUED/SYNCING, mất ACK, conflict revision, PENDING_VERIFICATION.
- Camera tự động: cấu hình chỉ nhận barcode bán lẻ, tiếp tục phân tích sau frame rỗng/không hợp lệ,
  không nhận QR thanh toán và không trả ảnh camera. Camera thiết bị thật: scan liên tục, lifecycle,
  orientation, duplicate suppression, low light và nhiều model Android/iPhone vẫn là cổng canary bắt buộc.

Unit pass chưa đủ: cần integration DB, concurrency, contract, golden receipt, hardware smoke, restore/migration rehearsal và reconciliation.

## Kết quả hiện tại — 2026-08-10

- Backend: 393/393 test pass từ 69 file test được enumerate đệ quy.
- Flutter core: 109 pass, 1 E2E updater skip có chủ đích; `flutter analyze` sạch.
- Promotion/combo: 1.200 case deterministic pass ngoài các regression case hiện hữu.
- Failure injection: print job insert fail không rollback payment; outbox recovery tạo đúng một job.
- Stock boundary: thiếu tồn rollback và không để movement rác.
- Còn bắt buộc trước deploy: restore/migration rehearsal, hardware/device smoke, canary và production reconciliation.
- `mobile_scanner` giữ ở dòng 6.0.11 cho release hiện tại. Dòng 7.x thay CameraX/Vision,
  lifecycle và yêu cầu toolchain; chỉ nâng trong một canary thiết bị riêng, không nâng major sát production.
