# 04 — DATABASE INVENTORY

Nguồn: `server/db.js` (`migrate()`). Engine: `node:sqlite` DatabaseSync, WAL, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`.

## PRAGMA / tuning (bằng chứng db.js đầu file)
WAL · foreign_keys ON · busy_timeout 5000 · cache_size -65536 (64MB) · temp_store MEMORY · mmap_size 128MB · wal_autocheckpoint 1000.

## Bảng theo nhóm

### Cấu hình / định danh
`branches`, `users` (pin scrypt-hashed, branch_access_json), `auth_sessions` (token PK), `role_perms`,
`user_perms` (mode allow/deny CHECK), `app_settings` (branch,key PK), `user_preferences`, `enterprise_storage` (scope/scope_id/key).

### Danh mục / sản phẩm
`categories`, `menu_items` (price INTEGER, hidden, deleted_at, addons/modifiers/schedule JSON), `recipes` (menu↔inventory),
`skus` (barcode, stock REAL, track_lot, units_json), `inventory_items` (item_type, cost, track_lot), `tables`, `vouchers` (type/value/scope, sku_id, lot_no).

### Kho
`warehouses`, `stock_lots` (UNIQUE warehouse+type+item+lot_no; FEFO index expiry_date), `stock_movements`,
`inventory_documents` (+`inventory_document_lines`), `stocktake_sessions` (+`stocktake_lines`).

### Bán hàng
`orders` (subtotal/discount/total INTEGER; bill_no unique per branch; invoice_choice; einvoice_status; locked_at; voucher_*),
`order_items` (unit_price INTEGER; status machine; lot_id; promo_json; kds_dismissed), `staff_calls`, `customers` (partner_type customer|supplier|both).

### Thanh toán / quỹ
`payments`, `payment_lines` (+card_txn_id/rrn/approval/mask/scheme/terminal/mode để đối soát acquirer),
`shifts` (opening/closing cash + count_json), `cash_drawer_entries` (kind expense|reimbursement CHECK; balance_before/after),
`cash_drawer_reimbursement_allocations`, `bank_transactions` (**UNIQUE provider+external_id** → idempotency webhook; status received|paid|unmatched|underpaid|error|duplicate|claimed).

### Mua hàng / chi phí
`purchase_orders`, `purchase_order_lines`, `purchase_payments` (source drawer|direct), `expense_categories`, `expenses` (source drawer|direct, drawer_entry_id).

### Hóa đơn / tuân thủ
`invoices` (MISA legacy), `e_invoices` (**UNIQUE order_id**, **UNIQUE idempotency_key**; customer_mode; attempt_count/next_retry_at; request/response_snapshot),
`invoice_audit_logs` (bất biến, không sửa/xóa từ UI).

### Hệ thống
`print_jobs` (attempts, transport, target, reprint_of), `sync_queue` (status pending), `audit_log` (hot_until cho cold-tier), `document_files` (DMS metadata).

## Chỉ mục quan trọng
- `idx_orders_bill_no` UNIQUE(branch_id,bill_no) WHERE bill_no NOT NULL
- `idx_bank_tx_provider_ext` UNIQUE(provider,external_id) — chống double-credit webhook
- `idx_einv_order` / `idx_einv_idempotency` UNIQUE — chống trùng hóa đơn
- `idx_stock_lots_fefo` — First-Expire-First-Out
- Nhiều index hot: orders(status,created_at), order_items(status), audit(branch,created_at), stock_movements(branch,created).

## Vòng đời audit (db.js index.js)
- Hot: 3 tháng gần nhất trong SQLite (query nhanh).
- Cold: tháng cũ nén NDJSON.gz (`compactAuditToMonthly`); mở lại → rehydrate 7 ngày.
- Purge > 36 tháng. Bản đầy đủ ghi song song `permanent-storage/audit/` NDJSON fsync (durable qua power-loss).
- `reconcileAuditFromArchive()` khôi phục entry SQLite WAL mất sau mất điện.

## Mã hóa chi tiết audit (db.js ~1010)
- `encryptCompress`/`decryptDecompress`: gzip + AES-256-CTR, prefix `__ENC__:`.
- Key: `scryptSync(AUDIT_LOG_KEY || SESSION_SECRET || 'dandpak-audit-log-key-secret-12345', 'salt', 32)`.
- **RỦI RO**: salt hằng số `'salt'` + default key hardcode nếu không set env → xem file 06 (SEC-04).

## Sync triggers
`initSyncTriggers` cài trigger cho ~40 bảng → ghi `sync_queue` (kind + ref + branch resolve qua orderRef/paymentRef/poRef). Phục vụ sync-back company server (planned).

## Đường dẫn DB (bảo vệ, gitignored)
`server/store.db` (mặc định) hoặc `SQLITE_PATH`/`DATABASE_URL(sqlite://)`. Backup `backups/store-*.db`. Replica `permanent-storage/eternal_replica.db`.

> Schema PostgreSQL dự kiến đã được gỡ; runtime chỉ hỗ trợ SQLite.


---
---
# PASS 2 — Bổ sung Database inventory (bảng tồn kho / HĐĐT / két / ca)

## Tồn kho (inventory.js xác nhận cách dùng)
- `warehouses(id,branch_id,code,name,type[kitchen|retail],active,sort,sales_channels_json)` — 2 domain kho: bếp (nguyên liệu) + bán lẻ (SKU). Không cho tắt kho cuối cùng của 1 type.
- `inventory_items` / `skus` — mỗi bảng có cột `stock` GỘP (không phân kho) + `warehouse_id` mặc định. Nguồn tồn "thật" theo kho = `stock_lots`.
- `stock_lots(id,branch_id,warehouse_id,item_type,item_id,lot_no,mfg_date,expiry_date,received_at,qty_on_hand,unit_cost,supplier,status)` — FEFO: consume ORDER BY expiry NULL last, expiry ASC, received ASC. `upsertLot` gộp theo (warehouse,item,lot_no).
- `stock_movements(id,branch_id,inventory_item_id,type,qty,ref,created_at,item_type,warehouse_id,lot_id,unit_cost,reason,doc_id)` — TRACE đủ: ref=order_id/doc_id, reason, warehouse, lot, unit_cost. Không có cột user/actor ⇒ ai thao tác chỉ truy qua `audit_log` (audit() gọi kèm) chứ không nằm trong movement. GHI NHẬN: movement thiếu actor_id trực tiếp (truy vết gián tiếp qua audit).
- `inventory_documents` + `inventory_document_lines` — phiếu nhập/xuất/chuyển/kiểm; sale/return KHÔNG tạo doc (skipDocument) — bill là chứng từ bán.
- `stocktake_sessions` + `stocktake_lines` — kiểm kho, ghi expected/counted/delta.

## HĐĐT
- `e_invoices` — UNIQUE(order_id), UNIQUE(idempotency_key), status flow: NOT_CREATED→PENDING_PROVIDER/QUEUED→SENDING→ISSUED / RETRYING / FAILED / CANCELLED. `attempt_count`, `next_retry_at`, `request_snapshot`, `response_snapshot`.
- `invoice_audit_logs` — append-only, mọi chuyển trạng thái (CREATE_REQUEST/SENDING/ISSUE_SUCCESS/RETRY/FAILED/CANCEL/UPDATE_BUYER/REQUEUE/SYNC_STATUS) ghi old→new + actor + reason.

## Két & ca
- `shifts(id,branch_id,user_id,user_name,shift_key,shift_label,opening_cash,opening_count_json,closing_cash,closing_count_json,status,opened_at,closed_at)`.
- `cash_drawer_entries(...,kind[expense|reimbursement],amount,balance_before,balance_after,reimburses_entry_id,invoice_image,actor_id,actor_name,...)` — invoice_image lưu base64 tới 7.5MB (xem SEC-P2-03).
- `cash_drawer_reimbursement_allocations(id,branch_id,reimbursement_id,expense_id,amount)` — phân bổ hoàn chi nhiều-nhiều.

## Settings (app_settings key/value theo branch)
- Keys: `integrations_config` (chứa SECRET nguyên văn — xem SEC-P2-01/TP-04), `print_config`, `operations_config`, `notification_sound_config`, `tax_filing_profile`, `customer_display`, `ipad_staff_pin`.
