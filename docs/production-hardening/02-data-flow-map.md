# Data-flow và source-of-truth map

| Domain | Source hiện tại | Conflict | Source chuẩn đề xuất |
|---|---|---|---|
| Order | `orders`, `order_items`; `orders.js` | Nhiều đường đóng đơn | Order aggregate có revision |
| Cart | Order mở, retail cart riêng, Flutter memory | Có | Server/edge aggregate; client là projection |
| Price/promotion/combo/voucher | `vouchers.js` + order totals | Route, retail và UI cùng tham gia | Versioned Pricing Quote |
| Payment | `payments`, `payment_lines`, order status | Nhiều ingress | Payment aggregate + stable idempotency |
| Bank | `bank_transactions` | Manual/webhook allocation | Provider ID + allocation ledger |
| VAT/invoice | E-invoice snapshot + operational order | Consumer không chung snapshot | Immutable Sale Snapshot |
| Inventory | SKU stock + `stock_movements` | Cho phép âm; thiếu semantic key | Atomic inventory ledger |
| Print | `print_jobs` | Không semantic copy key | Transactional print intent |
| Report/accounting | Query operational tables | Có thể drift sau bán | Sale Snapshot/ledger |
| Time/shift | Chuỗi ISO và `Date` theo module | Host/UTC/+07 không thống nhất | BusinessClock |
| Device | Header/settings/agent registry | Không có release capability chuẩn | Versioned device registry |
| Sync | Backend trigger `sync_queue` | Không phải offline device sync | Device outbox + server inbox |

## Luồng thanh toán hiện tại

1. Flutter tạo idempotency key từ microsecond tại mỗi lần gọi.
2. Route tính discount rồi cập nhật order/item trước transaction của `payOrder`.
3. `payOrder` ghi payment, trạng thái, kho, số bill và HĐĐT trong `BEGIN IMMEDIATE`.
4. Archive, print-job creation và realtime emit xảy ra trước COMMIT.
5. Sau COMMIT, code gọi lại `createInvoiceRequest`; thường trả bản ghi đã có.

Hậu quả: retry sau timeout có key mới; promo có thể tồn tại dù payment fail; lỗi tạo job in có thể rollback payment; event/file archive không rollback cùng SQLite.

## Luồng đích

`Cart revision` → `Pricing Quote(hash)` → transaction `Payment + Inventory ledger + Sale Snapshot + Outbox intents` → COMMIT → worker idempotent xử lý realtime/print/invoice/archive.

Receipt, reprint, invoice, accounting và report chỉ đọc Sale Snapshot đã khóa.

## Offline hiện tại

`LocalStore` chỉ lưu preferences/JSON cache. Không có mutation outbox, `base_revision` hay conflict result. Backend `sync_queue` là trigger queue nội bộ và endpoint chủ yếu đánh dấu row hoàn thành. Hệ thống hiện chưa đáp ứng offline-first.

Đề xuất dài hạn: hybrid Edge Server + Flutter cache/outbox. Chưa triển khai cùng đợt sửa money path vì cần ADR về leader/failover và disaster recovery.
