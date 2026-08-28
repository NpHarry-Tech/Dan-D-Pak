# Implementation plan có gate

## Wave 0 — Safety net

1. Giữ nguyên dirty working tree; không tự checkout/reset/stash.
2. Chuẩn hóa test harness DB riêng; sửa hai fixture thiếu migration.
3. Thêm characterization tests cho payment/print, route price mutation, stock concurrency, print duplicate và midnight.
4. Backup/restore drill trên bản sao DB; chưa migration production.

## Wave 1 — Money và inventory

1. Thêm `sale_snapshots`, `outbox_events` và semantic idempotency fields bằng migration additive.
2. Một transaction: verify pricing revision/hash; payment; atomic stock ledger; bill number; immutable snapshot; outbox intents.
3. Commit xong worker mới archive/emit/print/invoice; worker replay idempotent.
4. Client persist một payment operation ID qua timeout/restart đến terminal result.

## Wave 2 — Price contract

1. Đưa adjustment vào Pricing Quote versioned từ engine hiện hữu, không tạo engine thứ hai.
2. Combo `FIXED_TOTAL` giữ configured total dù cao hơn component reference total.
3. Route không ghi promo/voucher ngoài unit of work.
4. Receipt/reprint/invoice/report đọc snapshot.

## Wave 3 — Time và printing

1. BusinessClock trả UTC occurrence, `Asia/Ho_Chi_Minh`, business date theo `paid_at`.
2. Print intent unique `(branch, semantic_type, semantic_id, copy_index)`; reprint có intent mới và audit.
3. State: `QUEUED`, `CLAIMED`, `SENT_TO_DRIVER`, `PRINTER_CONFIRMED` khi hỗ trợ, `FAILED`.

## Wave 4 — Offline

Viết ADR chọn hybrid edge + Flutter outbox rồi prototype staging. Không gộp rollout distributed offline với migration money path.

## Wave 5 — Deploy

Shadow validation → staging restore → canary → reconciliation → rollout. Migration additive giữ backward compatibility.
