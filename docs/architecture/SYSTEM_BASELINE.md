# SYSTEM BASELINE — Dan D Pak POS/ERP

> Phase 0-1 của master re-architecture mission. Ảnh chụp hiện trạng TRƯỚC khi
> refactor các bounded context. Cập nhật 2026-08-14.

## Snapshot
- Branch: `fix/universal-print-validation` @ `5208475`
- Nền tảng: Flutter (desktop Windows + tablet/phone Android, chung lib `dandpak_core`),
  Node.js ESM server (`node:sqlite` DatabaseSync) trên VPS Docker, Hardware Agent
  (`server/agent.cjs`, đóng gói .exe) chạy tại cửa hàng.

## Quy mô mã nguồn
| Loại | Số file |
|---|---|
| Dart | 192 |
| JS/MJS/CJS | 131 |
| Kotlin (Android native) | 2 (MainActivity phone + tablet) |
| Swift | 10 |
| Test (`*.test.mjs`) | 30 |
| Docs (`*.md`) | 86 |

## Backend (server/)
- **41 services** (`services/*.js`): auth, orders, payments, retail, inventory,
  invoices, catalog/catalogue, catalogueSync, haravanConnector, einvoice (MISA),
  push, printing, receipt_doc, reports/reportCenter, settings, shifts, sync,
  edgeSync, system, systemLogs, tax, vouchers, expenses, purchase, customers…
- **24 module dirs** (`modules/*/routes.js`): agent, appRelease, audit, auth,
  catalog, catalogue, clientLog, contacts, database, documents, expenses,
  inventory, invoices, online, orders, payments, printing, purchase, reports,
  retail, settings, sync, tax.
- **~70 bảng DB** (db.js): orders, order_items, payments, payment_lines,
  stock_movements, stock_lots, inventory_items/documents, invoices, e_invoices,
  sale_snapshots, shifts, cash_drawer_entries, print_jobs, device_tokens,
  external_orders/products/customers (Haravan), sync_* (outbox/inbox/hub),
  audit_log, system_logs, price_books, vouchers, warehouses, zones, tables…
- **~42 socket events** (realtime): order:new/pending/updated/item, payment:*,
  print:new/done/failed, einvoice:*, inventory:*, kds:*, staff:call, sync:status…

## Integrations hiện có
| Tên | Trạng thái |
|---|---|
| Haravan | 8 file (connector + sync worker + webhook) |
| MISA (e-invoice) | 19 file |
| Payment (SePay/VietQR/thẻ) | 38 file; sepay 11, vietqr 9 |
| Shipping | 2 file (sơ khai) |
| **Navision / Business Central** | **0 file — CHƯA CÓ (greenfield, mission #18-28)** |

## Realtime / Sync
- Socket.IO + outbox/inbox pattern (`sync_queue`, `sync_inbox`, `sync_hub_*`,
  `sync_apply_state`). Đã có idempotency (`services/idempotency.js`,
  `idempotency-chong-trung-don.test.mjs`).

## Notifications
- Server `push.js` (FCM firebase-admin) + routing config theo role/category
  (fnb_order/online_order/invoice). Client: FCM + local notification + snackbar +
  socket alert. **Chưa hợp nhất taxonomy** (mission #14-17).

## Printing (Phase 9 — ĐÃ LÀM)
- Xem `docs/architecture/PRINTING_ARCHITECTURE.md` + `docs/ADR/ADR-004-*`.
- Backends: EscPosBackend (LAN/bếp/bar/fallback), **WindowsDriverBackend** (bill
  K80 Windows, GDI + font TrueType — MỚI), SunmiNativeBackend (đang dùng
  `printEscPos`, chưa chuyển native text — pending).
- **CẤM in ảnh tầng app** (đã gỡ sạch `print_raster.js`).
- Test in: 137/137 pass (escpos-parity, receipt-golden-parity, kitchen-*,
  printer-*, print-*, driver-receipt-doc…).

## Tình trạng theo Phase mission
| Phase | Trạng thái |
|---|---|
| 0-1 Snapshot + Discovery | Ảnh chụp này |
| 9 Printing redesign | ✅ Hoàn tất (WindowsDriverBackend) |
| 12 Security (một phần) | ✅ /health/live + /health/ready; scan secret sơ bộ sạch |
| 2-4 Arch map / dup / dead-code / target plan | ⏳ chưa |
| 5 DB hardening | ⏳ |
| 6 Backend modularization | ⏳ |
| 7 Frontend modularization | ⏳ |
| 8 Notification unification | ⏳ |
| 10 Navision integration (greenfield) | ⏳ cần discovery môi trường NAV từ user |
| 11 Integrations regression | ⏳ |
| 13-15 E2E / docs / readiness | ⏳ |

> Mỗi phase còn lại là một khối việc riêng, làm theo mission: discover → refactor
> từng bounded context → test → migrate → remove legacy, KHÔNG big-bang, giữ rollback.
