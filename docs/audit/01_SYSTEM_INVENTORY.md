# 01 — SYSTEM INVENTORY

## Tổng quan
Dan-D-Pak là **modular monolith** Node.js (ES Modules) phục vụ POS/ERP cho F&B + Retail + Warehouse + Online,
chạy trên **local store server**. Backend + frontend tĩnh + realtime chung 1 process Express.

- Runtime: Node.js, `"type": "module"`
- Dependencies (production): `express@4.21.2`, `socket.io@4.8.1`, `pdfkit@0.19.1`, `write-excel-file@4.1.1`
- DB: SQLite qua built-in `node:sqlite` (`DatabaseSync`), WAL mode — KHÔNG dùng better-sqlite3
- Realtime: Socket.IO (phòng theo chi nhánh `branch:<id>`)
- Entry: `server/index.js` → `npm start`

## App / Shell (đa thiết bị, 1 nguồn dữ liệu)
| Shell | Vị trí | Ghi chú |
| --- | --- | --- |
| Web tĩnh (desktop/tablet/phone) | `web/*.html` | Phục vụ trực tiếp từ Express |
| Flutter apps (5) | `flutter-apps/dandpak_{pos,tablet,kds,backoffice,core}` | Cần kiểm tra thủ công thêm |
| Android POS wrapper | `android-pos/` | Cầu nối thẻ VCB SmartPOS (scaffold) |
| Desktop launcher | `Dan D Pak POS.vbs`, `DanDPak_POS_DESKTOP_APP.ps1` | Vỏ Windows |

## Màn hình web (route → file)
`/` index · `/admin` (=`/settings`) admin.html · `/pos` · `/ipad` · `/kds` · `/retail` · `/warehouse` ·
`/printers` · `/online` · `/contacts` · `/purchase` · `/expenses` · `/invoices` · `/database` · `/documents` · `/sim`

## Service backend (server/services/) — 30 file
auth, pin, bootstrapAdmin, branches, catalog, bookMenu, orders, payments, shifts, cashDrawer, retail,
inventory, purchase, expenses, customers, vouchers, invoices, einvoice, misa, online, printing, reports,
reportCenter, history, archive, enterpriseStorage, settings, modules, system, sync, configBackup.

## Lớp hạ tầng
- `server/config/`: env.js, cors.js, providers.js, runtime.js
- `server/core/`: logger.js, errors.js, http.js, requestLogger.js
- `server/adapters/`: database (sqlite/postgres), realtime (socketio/websocket), storage (local/s3) — **postgres/s3/websocket còn scaffold**
- `server/modules/`: orders/payments/inventory/invoices/reports/audit (chỉ README, vùng đích refactor)
- `server/db/schema/`: `0001_*.sql`, `0002_*.sql` — PostgreSQL đích (planned)
- `server/permanent-storage/`: NDJSON append-only (audit/orders/payments/customers/staff/cash-drawer/reports) — gitignored
- `server/enterprise-storage/`: config doanh nghiệp — gitignored

## Vùng lưu trữ dữ liệu
- SQLite chính: `server/store.db` (+ `-shm`, `-wal`)
- Backup snapshot: `backups/store-*.db` (148 file — cơ chế backup định kỳ đang chạy)
- File replica vĩnh viễn: `server/permanent-storage/eternal_replica.db`
- Uploads: `server/uploads/{documents,avatars,menu}`

## Điểm hạ tầng đáng chú ý (bằng chứng)
- Gzip middleware tự viết bằng `node:zlib` (`server/index.js`) — không cần package nén.
- Security headers thủ công (nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy) — **KHÔNG có CSP** (cố ý, ghi chú trong code).
- Worker định kỳ: backup DB (24h), audit maintenance (24h), e-invoice queue (10s), sync engine.
- Xử lý `uncaughtException`/`unhandledRejection` có log rồi mới thoát.
