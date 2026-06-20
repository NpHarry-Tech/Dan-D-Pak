# Workflow Map

Last updated: 2026-06-18

Each workflow row includes actors/devices, preconditions, steps, success state, failure cases, data touched, protected data, modules, API endpoints, realtime events, tests/checklist, related code, and known fixes.

| Workflow | Actors/devices | Preconditions | Steps | Success state | Failure cases | Data/protection | Modules/API/realtime | Tests/code/known fixes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Login success | Staff, any protected screen | Active user and PIN | Open screen, choose user, enter PIN | Session saved and module opens | Backend offline, wrong role | Users, sessions; protected | Auth; `POST /api/login`, `GET /api/me`; none | Login owner/manager/cashier; `web/shared/client.js`, `server/services/auth.js`; updated 2026-06-18 |
| Login failure | Staff | Wrong PIN/user inactive | Enter invalid PIN | Login gate remains | Demo fallback confusion | Users; protected | Auth; `POST /api/login`; none | Verify no session saved; `web/shared/client.js`; updated 2026-06-18 |
| No self-register | Staff/admin | Login screen only lists users | Try to create self account | No public account creation | API exposed without guard | Users/roles; protected | Auth/settings; `POST /api/settings/users`; none | Verify settings guard; `server/api.js`; updated 2026-06-18 |
| Admin creates account | Admin | Permission `settings.users` | Open settings, add user | User appears and can login | Duplicate username, missing role | Users, permissions; protected | Auth/settings; `POST /api/settings/users`; audit | Create test user, check audit/archive; updated 2026-06-18 |
| Admin creates role | Admin | Permission `settings.perms` | Update role matrix | Role permissions saved | Invalid permission key | Roles/permissions; protected | Auth/settings; `POST /api/settings/roles/:role/permissions`; audit | Change manager perms and verify; updated 2026-06-18 |
| Admin assigns permission | Admin | User exists | Edit user permission override | Effective perms update | User loses critical access | User permissions; protected | Auth/settings; `POST /api/settings/users/:id/permissions`; audit | Re-login and verify module access; updated 2026-06-18 |
| Two users login at same time | Two devices | Backend online | Login on two devices | Both sessions valid | Session overwrite, permission leak | Sessions/users; protected | Auth; `POST /api/login`; presence | Two browsers login different roles; updated 2026-06-18 |
| 3-4 devices active at same time | iPad, POS, KDS, Admin | Socket.IO reachable | Open multiple device pages | Presence and realtime active | Socket disconnect, CORS | Device presence; operational | Realtime; `/socket.io`; `presence` | Open pages and verify connection status; updated 2026-06-18 |
| Customer iPad connects to store | iPad | Store server URL/config valid | Open `/ipad`, choose table | Menu and order UI load | API offline, no table | Menu/tables; protected | Menu/tables; `GET /api/menu`, `GET /api/tables`; `menu:updated` | Load iPad on tablet viewport; updated 2026-06-18 |
| Device pairing | Device/Admin | Planned device registry | Device requests pair | Pairing request stored | Duplicate device, expired code | Device pairing; protected | Devices planned; `POST /api/devices/pair`; `DEVICE_HEARTBEAT` planned | Planned endpoint returns not implemented until built; updated 2026-06-18 |
| Device approval | Admin | Pairing request exists | Admin approves device | Device role assigned | Unauthorized admin | Device approval; protected | Devices planned; `PATCH /api/devices/:id/approve`; planned events | Planned; updated 2026-06-18 |
| iPad order | Customer iPad, POS, KDS | Table selected, menu available | Add items, send order | Order created/pending, POS/KDS update | Menu unavailable, backend offline | Orders/order_items/kitchen tickets; protected | Orders; `POST /api/orders`; `order:new`, `order:pending`, `kds:refresh` | Create order from iPad and watch POS/KDS; updated 2026-06-18 |
| POS order | Cashier POS, KDS | Cashier logged in | Select table/items, send | Order created and routed | Permission/API failure | Orders/order_items; protected | Orders; `POST /api/orders`; `order:new`, `kds:refresh` | Create POS order; updated 2026-06-18 |
| Kitchen receives ticket | KDS | Order has kitchen items | KDS station open | Ticket appears | Wrong station, socket down | Kitchen tickets/order items; protected | KDS/orders; `GET /api/kds/:station`; `kds:refresh` | Send kitchen item and verify; updated 2026-06-18 |
| Bar receives drink ticket | KDS bar | Item station `bar` | Send drink | Bar station sees ticket | Station mapping wrong | Kitchen tickets/order items; protected | KDS/orders; same as above | Verify station filter; updated 2026-06-18 |
| Salad station receives cold item | KDS salad | Item station `salad` | Send cold item | Salad station sees ticket | Station mapping wrong | Kitchen tickets/order items; protected | KDS/orders; same as above | Verify station filter; updated 2026-06-18 |
| Order cancellation | POS/Admin | Order/item cancellable | Cancel with reason/PIN if needed | Item/order marked cancelled | Already preparing/ready/served | Orders/order_items/audit; protected | Orders; `POST /api/orders/items/:id/cancel`; `order:updated`, `kds:refresh` | Cancel before prep and check audit; updated 2026-06-18 |
| Item cancellation after kitchen sent | POS/Admin | Item already sent | Try cancel | Requires manager/owner and may block | Kitchen already prepared | Order items/audit; protected | Orders; `POST /api/orders/items/:id/cancel`; `kds:refresh` | Verify status rules; updated 2026-06-18 |
| Table transfer | POS | Open order/table exists | Move bill to another table | Target table has order | Target invalid/occupied rules | Orders/tables/audit; protected | Orders; `POST /api/tables/:id/move`; `order:updated`, `table:updated` | Move table and verify KDS bill path; updated 2026-06-18 |
| Table merge | POS | Two open tables | Merge source into target | One combined bill | Target missing, item conflict | Orders/order_items/tables; protected | Orders; `POST /api/tables/:id/merge`; `order:updated`, `table:updated` | Merge two bills; updated 2026-06-18 |
| Bill split | POS | Open order with items | Select items, split | New split order created | No items, paid order | Orders/order_items; protected | Orders; `POST /api/orders/:id/split`; `order:updated` | Split bill and verify totals; updated 2026-06-18 |
| Split payment | POS | Pay permission, open bill | Add multiple lines, pay | Payment and lines posted | Underpay/overpay/method invalid | Payments/payment_lines/order/inventory; protected | Payments; `POST /api/orders/:id/pay`; `payment:done`, `stats:dirty` | Pay with cash/card mix; updated 2026-06-18 |
| Card payment | POS/payment terminal | Card method configured | Add card line, approve | Payment approved in receipt | Terminal failure/manual reference missing | Payments; protected | Payments/settings; `POST /api/orders/:id/pay`; `payment:done` | Verify method and reference captured; updated 2026-06-18 |
| Payment failed | POS/payment terminal | Payment attempt started | Provider fails/declines | Bill remains unpaid | Silent mock success | Payments/order; protected | Payments; provider planned; no success event | Simulate failure and verify no paid state; updated 2026-06-18 |
| Payment approved | POS | Valid payment lines | Submit payment | Order paid, inventory deducted, receipt archived | Inventory deduction failure | Payments/order/inventory/archive; protected | Payments/inventory; `POST /api/orders/:id/pay`; `payment:done`, `inventory:updated` | Pay order and verify reports; updated 2026-06-18 |
| MISA invoice planned flow | POS/Admin/customer | MISA settings configured | Customer requests invoice, issue/cancel | Invoice stored with lookup | API auth failure, invalid tax data | Invoices/customers/orders; protected | Invoices/MISA; `/api/invoices/*`; `invoice:issued`, `invoice:cancelled` | Test sandbox before production; updated 2026-06-18 |
| Inventory purchase receipt | Warehouse | Item/SKU exists | Receive stock/lot | Stock and lot increase | Missing expiry/qty invalid | Inventory movements/lots; protected | Inventory; `POST /api/warehouse/receive`; `inventory:updated` | Receive lot and verify snapshot; updated 2026-06-18 |
| Stock transfer | Warehouse | Source/target warehouse valid | Transfer qty | Movement records posted | Insufficient stock, bad warehouse | Stock movements/lots/docs; protected | Inventory; `POST /api/warehouse/transfer`; `inventory:updated` | Transfer stock and inspect docs; updated 2026-06-18 |
| Stocktake | Warehouse/Admin | Count sheet prepared | Count and approve | Delta movements posted | Unauthorized, wrong count | Stocktake/movements; protected | Inventory; `POST /api/warehouse/stocktake`; `inventory:updated` | Count sample item; updated 2026-06-18 |
| Inventory adjustment | Warehouse/Admin | Permission `inventory.adjust` | Adjust stock/reason | Movement/audit created | Destructive direct set risk | Inventory movements; protected | Inventory; `POST /api/inventory/:id/adjust`; `inventory:updated` | Adjust with reason; updated 2026-06-18 |
| Admin dashboard realtime update | Admin | Dashboard open, socket online | Order/payment/inventory changes | KPIs update without reload | Socket down/stale cache | Reports/order/payment/inventory; protected | Reports; `GET /api/dashboard`; `stats:dirty` | Create payment and watch admin; updated 2026-06-18 |
| Backend offline | Any frontend | Backend unreachable | API call fails | Offline state shown; no fake success | Silent mock success | None mutated | API client; all endpoints | Stop backend and verify status; updated 2026-06-18 |
| Database offline | Backend | DB inaccessible | Request or health check | JSON error/health failure | HTML error, data loss | All protected data | DB/health; `GET /health`; none | Simulate missing DB path only with backup; updated 2026-06-18 |
| VPS restart | VPS services | Docker/system service running | Restart app/proxy | App returns healthy | DB not ready, stale sockets | All protected data | Deploy; `/health`; reconnect events | Restart and verify health/realtime; updated 2026-06-18 |
| Render cold start | Temporary backend | Render service sleeping | First API call wakes service | Frontend shows loading/offline then recovers | Timeout/CORS | None mutated unless retry | API client; `/api/ping`; none | Test first request after idle; updated 2026-06-18 |
| Vercel route 404 | Vercel frontend | Static route without rewrite | Open `/admin` | Rewritten to `/admin.html` | Missing `vercel.json` | None | Vercel config | Verify route after deploy; known case recorded; updated 2026-06-18 |
| API 404 | Frontend/backend | Wrong route | Call unknown `/api/*` | JSON `API_NOT_FOUND` | HTML error page | None | HTTP core; all API | `GET /api/does-not-exist`; updated 2026-06-18 |
| CORS failure | Vercel/Render | CORS origin missing | Browser calls backend | Clear browser failure; configure env | Wildcard in prod risk | None | CORS config; all API/socket | Set `CORS_ORIGIN`; updated 2026-06-18 |
| Device lost connection | Any device | Socket connected | Network drops | Offline indicator, reconnect possible | Missed event | Operational state | Realtime/client; socket events | Disable network and restore; updated 2026-06-18 |
| Multiple devices receiving realtime updates | iPad/POS/KDS/Admin | 3+ devices open | Create/update order | All relevant screens update | Branch mismatch, socket CORS | Orders/KDS/payments; protected | Realtime; order/payment/KDS events | End-to-end device smoke; updated 2026-06-18 |
| Database migration | Admin/DevOps | Verified backup and migration script | Run migration | Schema/data valid | Data loss/drop table | All protected DB data | DB/migrations; health | Dry run on backup first; updated 2026-06-18 |
| Backup and restore | DevOps | Backup scripts configured | Run backup/restore | Verified recovered DB | Restore wrong file, overwrite prod | Database/backups; protected | Deploy scripts; health | Restore to staging first; updated 2026-06-18 |
| VPS deploy | DevOps | Server, DNS, env ready | Pull, compose up, healthcheck | HTTPS app online | Env missing, DB unavailable | All protected data | Deploy; `/health` | Follow VPS docs; updated 2026-06-18 |
| Rollback | DevOps | Previous release/backup exists | Revert image/commit and restore if needed | Prior version healthy | Data/schema mismatch | All protected data | Deploy/DB | Rollback app before DB restore unless schema requires; updated 2026-06-18 |

## System & Architecture Workflows (VPS + Company Server)

These cover the two-zone architecture. Each lists actor/device, preconditions,
steps, success, failure cases, tables touched, audit, realtime, print, and
sync/offline behavior. See [DATA_OWNERSHIP.md](DATA_OWNERSHIP.md).

### 1. App access (public VPS)
Actor: any user/browser. Pre: VPS online. Steps: open public VPS domain → VPS
serves `web/` shell → frontend calls same-origin `/api` → VPS proxies to company
server if online. Success: app loads, API reaches company server. Failure: VPS down
(no app), company server down (offline/temporary state shown). Tables: none on VPS.
Audit: gateway access logs (non-sensitive). Sync: falls back to buffer if upstream
offline.

### 2. Local LAN
Actor: POS/iPad/KDS. Pre: company server reachable on LAN (`pos.local`/LAN IP). Steps:
device connects directly to company server, no VPS. Success: full operation, all
data in PostgreSQL. Failure: LAN/server down → device offline queue. Tables: all
business tables. Audit: normal. Sync: not required when on LAN.

### 3. Remote access
Actor: owner/admin off-site. Pre: VPS + VPN/tunnel up. Steps: admin hits VPS → VPS
routes API/WebSocket through VPN to company server. Success: remote operation.
Failure: tunnel down → offline state. Security: tunnel only; no direct DB exposure.

### 4. Company server online order
Actor: iPad/POS. Pre: company server online. Steps: create order → company backend
writes to PostgreSQL → KDS ticket created → POS/admin dashboards update realtime →
print job created if required. Success: order persisted + routed. Tables: orders,
order_items, order_status_history, kitchen_tickets, print_jobs. Audit: order events.
Realtime: `order:new`, `kds:refresh`. Print: kitchen/bill. Sync: none (online).

### 5. Company server offline (VPS buffer)
Actor: any write path via VPS. Pre: VPS up, company server unreachable. Steps: VPS
enters temporary buffer mode → event encrypted + stored (`VPS_PENDING`) → UI shows
waiting-for-sync, **no fake official success**. Tables (VPS): temporary_events.
Sync: reconciled on recovery. Security: payload encrypted on VPS.

### 6. Recovery sync
Actor: sync worker. Pre: company server back online. Steps: pull pending VPS events
→ validate payload_hash/signature → check event_id idempotency → write to PostgreSQL
→ ACK → VPS deletes synced data. Success: pending count → 0. Failure: conflict →
CONFLICT for admin review. Tables: sync_events, processed_event_ids, sync_conflicts.
Audit: sync conflicts.

### 7. Order cancellation
Actor: staff/POS/admin. Pre: order/item cancellable. Steps: cancel with **required
reason** → status history row → audit log → kitchen notified → payment/inventory
impact handled. Tables: orders, order_status_history, audit_logs. Realtime:
`order:updated`, `kds:refresh`. Non-destructive: order never deleted.

### 8. Payment
Actor: cashier/POS. Pre: open bill, pay permission. Steps: cash/card/bank/split →
payment lines recorded → status history recorded → official only after approval →
audit log. Tables: payments, payment_lines, payment_status_history. Offline: pending
until synced/approved — see [PAYMENT_OFFLINE_POLICY.md](PAYMENT_OFFLINE_POLICY.md).

### 9. Cash in/out
Actor: staff/manager. Pre: shift open. Steps: open drawer → opening cash recorded →
cash in/out with **required reason** → manager approval if needed → shift report
updated → audit log. Tables: cash_drawers, cash_shifts, cash_in_out, cash_count_logs.
See [CASH_IN_OUT_WORKFLOW.md](CASH_IN_OUT_WORKFLOW.md).

### 10. Bank account linking
Actor: admin. Steps: link bank/provider → credentials/tokens **encrypted** → no
plaintext secret in DB/logs → account number masked in UI → audit log. Tables:
bank_accounts, payment_provider_tokens, bank_config_history. See
[BANK_ACCOUNT_LINKING.md](BANK_ACCOUNT_LINKING.md).

### 11. App-web linking
Actor: user/admin. Steps: scan QR or enter pairing code → device/app/web session
linked → token created → approval if needed → session audited → revocation
supported. Tables: device_pairing_requests, app_web_links, app_web_link_tokens. See
[APP_WEB_LINKING.md](APP_WEB_LINKING.md).

### 12. Print
Actor: system/staff. Steps: kitchen/bill/label print → attempt logged → on failure
retry → reprint logged (who/why/when). Tables: print_jobs, print_attempts,
reprint_logs. Every print/reprint logged. See [PRINT_WORKFLOW.md](PRINT_WORKFLOW.md).

### 13. Price update
Actor: admin. Steps: change price → **new price version created** → old orders keep
old price snapshot → audit log. Tables: price_versions, price_change_logs,
audit_logs. Non-destructive: no recalculation of closed orders.

### 14. Restaurant setting update
Actor: admin. Steps: change config → **setting version created** → devices receive
realtime update → audit log. Tables: restaurant_setting_versions, config_change_logs.
Realtime: settings broadcast.

### 15. Inventory in
Actor: warehouse. Steps: purchase/goods receipt → inventory movement created →
supplier + cost recorded → stock updated **by ledger** → audit log. Tables:
purchase_orders, goods_receipts, inventory_movements, inventory_cost_layers. See
[INVENTORY_WORKFLOW.md](INVENTORY_WORKFLOW.md).

### 16. Inventory out
Actor: system/warehouse. Steps: sale/recipe consumption/waste/transfer → movement
created → ledger updated → **no direct destructive quantity edit**. Tables:
inventory_movements, inventory_movement_items.

### 17. Stocktake
Actor: warehouse. Steps: open session → count items → compute differences →
adjustment movements created → close session → audit log. Tables: stocktake_sessions,
stocktake_items, inventory_movements (STOCKTAKE_ADJUSTMENT).

### 18. Customer
Actor: staff/admin. Steps: create/update customer → privacy-sensitive data protected
→ activity linked to orders → audit log. Tables: customers, customer_activity_logs.

### 19. Report
Actor: admin. Steps: realtime dashboard shows live numbers → official report closes
after shift/day close → report snapshot stored → corrections audited. Tables:
report_snapshots, shift_reports. Official reports use closed shifts/day locks.

### 20. Backup/restore
Actor: DevOps. Steps: encrypted DB backup → restore test → restore audit log. Tables:
all (DB-level). See [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

### 21. Power outage
Actor: system. Steps: company server offline → VPS buffer active → local devices may
queue if powered → on return, sync begins → conflict handling if needed. See
[POWER_OUTAGE_RUNBOOK.md](POWER_OUTAGE_RUNBOOK.md).

### 22. Conflict
Actor: sync worker + admin. Steps: duplicate/conflicting offline data detected → mark
CONFLICT → admin review required → resolution audited. Tables: sync_conflicts,
audit_logs. No silent overwrite.

## Required Follow-Up Tests

- Add automated smoke tests for `/health`, `/api/ping`, API 404 JSON, and core order/payment/KDS flows.
- Add migration dry-run tests before PostgreSQL cutover.
- Add device pairing tests when device registry endpoints are implemented.
- Add sync-back idempotency tests (duplicate `event_id` must not double-write).
