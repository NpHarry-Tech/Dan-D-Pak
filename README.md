# Dan-D-Pak POS/ERP

Dan-D-Pak là một hệ thống **POS/ERP cho cửa hàng F&B + Retail** chạy trên **một máy chủ tại cửa hàng (local store server)**. Hệ thống bao gồm: iPad tự gọi món, POS thu ngân, KDS bếp/bar, quản lý kho, thanh toán (tiền mặt / chuyển khoản QR tự xác nhận / thẻ), hóa đơn điện tử, mua hàng, chi phí, danh bạ liên hệ, báo cáo, dashboard realtime, in ấn ESC/POS và một bộ khung module ERP mở rộng.

> Đây là **một hệ thống nghiệp vụ thật**. Đơn hàng, hóa đơn, khách hàng, báo cáo, thanh toán, tồn kho, thiết bị và nhật ký hoạt động là **dữ liệu được bảo vệ**. Đọc kỹ mục [Dữ liệu được bảo vệ & quy tắc an toàn](#dữ-liệu-được-bảo-vệ--quy-tắc-an-toàn-ai) trước khi sửa code.

---

## Kiến trúc 3 app, 1 nguồn dữ liệu

Dan-D-Pak được chia thành 3 app shell khác nhau để tối ưu giao diện theo thiết bị, nhưng **không chia database theo thiết bị**:

- **Desktop app**: Windows desktop shell mở `?app=desktop`; dành cho thu ngân/quản lý trên máy POS. Không hiện iPad Self-Order và không hiện nút camera scan; vẫn dùng máy quét USB hoặc nhập barcode.
- **Tablet app**: nằm trong `android-pos`, mở `?app=tablet`; dành cho tablet Android/POS Android, có iPad Self-Order và camera scan.
- **Phone app**: mở `?app=phone` hoặc tự nhận theo màn hình nhỏ; không hiện iPad Self-Order, vẫn có camera scan.

Tất cả thiết bị cùng truy cập **một POS Engine** qua LAN/tunnel, ví dụ `http://<IP-may-POS>:3000`. Dữ liệu được scope theo đăng nhập + cửa hàng/chi nhánh (`branch/store context`). Nếu desktop, tablet và phone cùng đăng nhập vào cùng chi nhánh, chúng sẽ sync qua cùng API và Socket.IO realtime: tablet tạo order thì desktop POS/KDS thấy ngay; desktop bán retail thì tablet/phone cùng chi nhánh thấy tồn kho cập nhật.

```text
Desktop app / Tablet Android app / Phone app
        -> POS Engine local
        -> auth session + branch/store context
        -> SQLite/local database + Socket.IO realtime
```

---

## Mục lục

- [Stack thực tế](#stack-thực-tế)
- [Kiến trúc 3 app, 1 nguồn dữ liệu](#kiến-trúc-3-app-1-nguồn-dữ-liệu)
- [Khởi chạy nhanh (local)](#khởi-chạy-nhanh-local)
- [Tài khoản demo](#tài-khoản-demo)
- [Các màn hình / thiết bị](#các-màn-hình--thiết-bị)
- [Kiến trúc tổng quan](#kiến-trúc-tổng-quan)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Backend: services & module nghiệp vụ](#backend-services--module-nghiệp-vụ)
- [Phân quyền: vai trò & permission](#phân-quyền-vai-trò--permission)
- [Module ERP registry](#module-erp-registry)
- [Cơ sở dữ liệu](#cơ-sở-dữ-liệu)
- [Realtime](#realtime)
- [Thanh toán & tự xác nhận](#thanh-toán--tự-xác-nhận)
- [In ấn & phần cứng cửa hàng](#in-ấn--phần-cứng-cửa-hàng)
- [API REST](#api-rest)
- [Biến môi trường](#biến-môi-trường)
- [Triển khai (Docker / company server)](#triển-khai-docker--company-server)
- [Vùng triển khai & sở hữu dữ liệu](#vùng-triển-khai--sở-hữu-dữ-liệu)
- [Dữ liệu được bảo vệ & quy tắc an toàn AI](#dữ-liệu-được-bảo-vệ--quy-tắc-an-toàn-ai)
- [Checklist kiểm thử](#checklist-kiểm-thử)
- [Vấn đề đã biết](#vấn-đề-đã-biết)
- [Quy tắc cho AI agent](#quy-tắc-cho-ai-agent)
- [Chỉ mục tài liệu](#chỉ-mục-tài-liệu)

---

## Stack thực tế

Bản chạy hiện tại (local store server):


- **Backend + frontend chung 1 server Express** (`server/index.js`) — Node.js, ES Modules (`"type": "module"`).
- **Database: SQLite** thông qua module built-in **`node:sqlite`** (không cần `better-sqlite3`). File local mặc định `runtime/server-data/store.db` (WAL mode).
- **Realtime: Socket.IO** (`server/realtime.js`) — phòng theo chi nhánh (`branch:<id>`).
- **Frontend: Flutter native apps** trong `flutter-apps/`: `dandpak_desktop`, `dandpak_tablet`, `dandpak_phone`.
- **Dependency runtime tối thiểu:** chỉ `express` + `socket.io` (xem `package.json`). DB, crypto, fs… đều dùng module built-in của Node.

Stack đích khi lên máy chủ công ty (đã có scaffold deploy):

- Ubuntu/Linux + **Docker Compose**.
- **Caddy** reverse proxy (HTTP/HTTPS).
- Node backend (image build từ `server/Dockerfile`).
- **SQLite (WAL)** làm CSDL production duy nhất, lưu trên volume bền vững của VPS.
- Backup/restore tự động qua script trong `deploy/company-server/scripts/`.


---

## Khởi chạy nhanh (local)

```bash
npm install
npm start
```

- `npm start` → `node server/index.js`
- `npm run dev` → `node --watch server/index.js` (tự reload khi sửa code)
- `npm run seed` → nạp lại dữ liệu demo (`server/seed.js`)

Lần chạy đầu tiên, nếu database trống, server tự động:

1. Khôi phục cấu hình từ `CONFIG_SEED_URL` nếu được khai báo, hoặc
2. Nạp **dữ liệu demo** (`server/seed.js`) — trừ khi đặt `DISABLE_DEMO_SEED=true`.
3. Tạo tài khoản admin mặc định nếu chưa có (`bootstrapDefaultAdmin`).

Sau khi chạy, mở:

| URL | Màn hình |
| --- | --- |
| `http://localhost:3000/` | Trang chủ / launcher |
| `http://localhost:3000/admin` | Quản lý (dashboard, thực đơn, vận hành, cài đặt) |
| `http://localhost:3000/pos` | POS thu ngân F&B |
| `http://localhost:3000/ipad` | iPad khách tự gọi món |
| `http://localhost:3000/kds` | Màn hình bếp/bar (KDS) |
| `http://localhost:3000/retail` | Bán lẻ (barcode/SKU) |
| `http://localhost:3000/warehouse` | Quản lý kho |
| `http://localhost:3000/printers` | Máy in & ngăn kéo tiền |
| `http://localhost:3000/online` | Kênh online (Grab/Shopee/Web) |
| `http://localhost:3000/contacts` | Liên hệ (KH + NCC) |
| `http://localhost:3000/purchase` | Mua hàng (PO) |
| `http://localhost:3000/expenses` | Chi phí |
| `http://localhost:3000/invoices` | Hóa đơn điện tử |
| `http://localhost:3000/database` | CSDL & tài liệu (backup/restore/reset giao dịch) |
| `http://localhost:3000/documents` | Tài liệu (DMS) |
| `http://localhost:3000/settings` | Cài đặt (= admin.html) |

Kiểm tra sống: `GET /health` (JSON, có trạng thái DB + provider) và `GET /api/ping`.

---

## Tài khoản demo

Dùng cho local/demo (định nghĩa trong `server/seed.js`):

| Vai trò | Username | PIN |
| --- | --- | --- |
| Admin (owner) | `admin` | `1234` |
| Quản lý (manager) | `manager` | `2222` |
| Thu ngân (cashier) | `cashier` | `1111` |
| Bếp (kitchen) | `kitchen` | `3333` |
| Thủ kho (warehouse) | `warehouse` | `4444` |

PIN mặc định mở khóa thiết bị khách (iPad): `0000` (đổi trong Cài đặt).

---

## Các màn hình / thiết bị

- **iPad** (`ipad.html`): khách tự gọi món, xem menu quyển, gửi bếp, gọi nhân viên, yêu cầu thanh toán, chọn xuất hóa đơn VAT hoặc bán cho người tiêu dùng sau khi trả tiền. Nhân viên mở khóa bằng PIN thiết bị.
- **POS** (`pos.html`): sơ đồ bàn, mở order, thêm/sửa món, xác nhận món iPad gửi lên, giảm giá/voucher, tách bill, gộp/chuyển bàn, thanh toán nhiều phương thức (tiền mặt / QR / thẻ), in bill, mở ngăn kéo tiền, ca làm việc & két tiền.
- **KDS** (`kds.html`): vé bếp/bar/salad theo station, trạng thái món (pending → preparing → ready → served), SLA, hủy/loại vé.
- **Retail** (`retail.html`): bán lẻ theo barcode/SKU, lot/date, voucher, đổi trả/hoàn tiền.
- **Warehouse** (`warehouse.html`): nhiều kho, SKU & nguyên liệu, nhập/xuất/chuyển kho, kiểm kho (stocktake), lot & hạn dùng, định mức tồn (min stock), chứng từ kho.
- **Online** (`online.html`): nhận đơn GrabFood/ShopeeFood/Website qua webhook, điều phối trạng thái fulfillment.
- **Contacts** (`contacts.html`): danh bạ chung khách hàng + nhà cung cấp (SĐT, MST, địa chỉ, người liên hệ).
- **Purchase** (`purchase.html`): vòng đời đơn mua hàng (PO) → nhận hàng vào kho → công nợ NCC.
- **Expenses** (`expenses.html`): sổ chi phí theo danh mục, chi từ tiền két hoặc kế toán chi trực tiếp, đối chiếu quỹ.
- **Invoices** (`invoices.html`): hóa đơn điện tử (MISA), phát hành/hủy/tra cứu.
- **Database** (`database.html`): trạng thái CSDL, kiểm tra toàn vẹn, dọn dữ liệu giao dịch, tài liệu hệ thống.
- **Documents** (`documents.html`): hệ thống quản lý tài liệu (DMS) — upload/preview/tải/xóa file.
- **Admin/Settings** (`admin.html`): dashboard, báo cáo, thực đơn, người dùng & phân quyền, chi nhánh, tích hợp, máy in, thiết bị, âm thanh thông báo, nhật ký hoạt động.
- **Printers** (`printers.html`): trạng thái máy in kết nối, lịch sử in, in lại, điều phối máy in LAN/OS, điều khiển ngăn kéo tiền.

Chi tiết: [docs/DEVICE_WORKFLOWS.md](docs/DEVICE_WORKFLOWS.md), [docs/WORKFLOWS.md](docs/WORKFLOWS.md).

---

## Kiến trúc tổng quan

Kiến trúc là **modular monolith**: một server Express phục vụ API REST và realtime Socket.IO cho các app Flutter native. Logic nghiệp vụ tách theo `server/services/*`; runtime dùng đúng một SQLite, Socket.IO và storage local bền vững.

```text
Thiết bị (iPad / POS / KDS / Retail / Warehouse / Admin)
        │  HTTP REST + Socket.IO
        ▼
server/index.js  ── Express ──┬── /health
                              ├── /api/*  → api.js (router) → services/*
                              ├── Socket.IO (realtime.js)  → phòng theo chi nhánh
                              └── Flutter native apps dùng /api + Socket.IO
        │
        ▼
node:sqlite  (runtime/server-data/store.db, WAL)  +  permanent-storage/  (archive file, không phải DB sống)
```

Luồng xử lý request (`api.js`):

1. `Auth.attachUser()` gắn `req.user` cho mọi request (nếu có token).
2. Mỗi route dùng `guard(perm)` / `guardAny(...perms)` để kiểm tra quyền.
3. `wrap(fn)` chuẩn hóa response JSON + bắt lỗi (`errorPayload`), hỗ trợ cả handler async.
4. Service thực thi nghiệp vụ trên DB, ghi `audit(...)`, rồi `emit(event, payload, branch)` để đẩy realtime.

Chi tiết: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Cấu trúc thư mục

```text
Dan-D-Pak/
  server/                         Backend (company-server — nguồn dữ liệu thật)
    index.js                      Entry: Express + Socket.IO + static + migrate + seed + bootstrap admin
    api.js                        Router REST (toàn bộ endpoint /api/*)
    db.js                         Schema SQLite (node:sqlite), migrate(), audit(), uid(), purgeOldAudit()
    realtime.js                   Hub Socket.IO (phòng theo chi nhánh, presence)
    seed.js                       Dữ liệu demo (menu, user, kho, bàn...)
    Dockerfile                    Build image backend
    config/                       env.js, cors.js, runtime.js, providers.js
    core/                         logger, errors, http helpers, requestLogger
    services/                     Logic nghiệp vụ (xem bảng bên dưới)
    modules/                      Vùng module đích (orders, payments, inventory, invoices, reports, audit — README)
    db/                           Kết nối, migration versioned, audit và backup SQLite
    migrations/                   Ghi chú quy ước migration
    scripts/                      Script import dữ liệu (KiotViet, BCM products)
    permanent-storage/            Lưu trữ vĩnh viễn dạng file (orders/payments/customers/staff/audit/reports/cash-drawer) — GITIGNORED
    enterprise-storage/           Kho cấu hình doanh nghiệp (branches/users/system) — GITIGNORED
    uploads/documents/            File DMS upload (runtime) — GITIGNORED

  flutter-apps/                    Flutter native app shells
    dandpak_desktop/               Desktop POS/Admin/KDS/Warehouse shell
    dandpak_tablet/                Tablet self-order/POS shell
    dandpak_phone/                 Phone companion shell
    dandpak_core/                  Shared Dart API/realtime client package

  android-pos/                    App Android mỏng bọc web POS + cầu nối thẻ VCB SmartPOS (scaffold)
  deploy/company-server/          Docker Compose triển khai trên máy chủ công ty (app + caddy + postgres)
  docs/                           Tài liệu kiến trúc, workflow, an toàn dữ liệu, runbook
  backups/                        Bản backup (GITIGNORED)
```

> **Quy ước vùng:** Flutter apps là vỏ native không giữ dữ liệu nhạy cảm. `server/` là nguồn dữ liệu thật.
> Tên thư mục hiện giữ nguyên để tránh rủi ro đổi tên hệ thống đang chạy — ánh xạ trong [docs/REPO_STRUCTURE.md](docs/REPO_STRUCTURE.md).

---

## Backend: services & module nghiệp vụ

Toàn bộ logic nằm trong `server/services/*`, được `api.js` gọi:

| File | Vai trò |
| --- | --- |
| `auth.js` | Đăng nhập PIN, session/token, vai trò & permission, xác thực PIN Manager/Owner, phân quyền theo chi nhánh |
| `branches.js` | Quản lý chi nhánh & phân vùng |
| `catalog.js` | Thực đơn F&B: món, danh mục, công thức (recipe), modifier/addon, lịch bán |
| `bookMenu.js` | Menu quyển (flipbook) cho iPad, import pubhtml5 |
| `orders.js` | Bàn, order, xác nhận/từ chối món iPad, tách/gộp/chuyển bàn, trạng thái món, gọi nhân viên, vé KDS |
| `payments.js` | Thanh toán bill, QR động/standalone, webhook ngân hàng (VietQR/SePay/Casso/payOS), poll trạng thái payOS, giao dịch ngân hàng |
| `shifts.js` | Ca làm việc (mở/đóng ca) |
| `cashDrawer.js` | Két tiền: chi/hoàn ứng, đối chiếu |
| `retail.js` | Bán lẻ: checkout barcode/SKU, hoàn tiền |
| `inventory.js` | Kho: SKU & nguyên liệu, nhập/xuất/chuyển, kiểm kho, lot/date, chứng từ, movement |
| `purchase.js` | Mua hàng: PO lifecycle, nhận hàng vào kho, công nợ NCC, thanh toán PO |
| `expenses.js` | Chi phí: danh mục, sổ chi, liên kết két/kế toán |
| `customers.js` | Khách hàng + đối tác (Contacts), tích điểm, tra cứu mã số thuế |
| `vouchers.js` | Voucher & giảm giá |
| `invoices.js` | Hóa đơn điện tử (qua MISA), yêu cầu hóa đơn từ khách |
| `misa.js` | Tích hợp HĐĐT MISA (test kết nối + phát hành) |
| `online.js` | Kênh online: nhận webhook đơn, danh sách kênh, đổi trạng thái |
| `printing.js` | Job in (bếp/bar/bill/tem), điều phối máy in LAN/OS, in lại, mở ngăn kéo |
| `reports.js` | Dashboard, xu hướng doanh thu, nhật ký hoạt động gần đây |
| `reportCenter.js` | Trung tâm báo cáo: catalog báo cáo, build & xuất (HTML/Word/Excel/PDF) |
| `history.js` | Lịch sử order, biên nhận (receipt) |
| `archive.js` | Soi kho lưu trữ vĩnh viễn (permanent-storage) |
| `enterpriseStorage.js` | Đảm bảo thư mục lưu trữ doanh nghiệp tồn tại |
| `settings.js` | Cài đặt app, tích hợp đối tác, cấu hình in/máy in/thiết bị/âm thanh, thao tác/ca |
| `modules.js` | Registry module ERP (nhóm, quyền, trạng thái rollout) |
| `system.js` | Kiểm tra internet, liệt kê máy in hệ thống (OS) |
| `sync.js` | Engine đồng bộ cloud/offline (status, offline toggle, sync now) |
| `configBackup.js` | Export/import cấu hình, khôi phục từ URL khi DB trống |
| `bootstrapAdmin.js` | Tạo tài khoản admin mặc định lần đầu |

DMS (tài liệu) được định nghĩa trực tiếp trong `api.js` (upload/list/download/preview/update/delete với whitelist MIME, tối đa 25MB).

---

## Phân quyền: vai trò & permission

Vai trò (`server/services/auth.js`):

| Key | Tên hiển thị | Mặc định |
| --- | --- | --- |
| `owner` | Admin | Toàn quyền (`*`), không chỉnh được |
| `manager` | Quản lý | Vận hành cửa hàng, hầu hết module + báo cáo + cài đặt |
| `cashier` | Thu ngân | `sell`, `pay`, `discount`, `invoice`, POS/Retail/Invoice |
| `kitchen` | Bếp | `kds` |
| `warehouse` | Thủ kho | `inventory.adjust`, `warehouse.manage`, kho + mua hàng |

- Ma trận **role → permission** được lưu trong bảng `role_perms` và **chỉnh sửa được trực tiếp** trong Cài đặt.
- Có thể override theo từng user qua `user_perms` (allow/deny).
- Nhiều thao tác nhạy cảm yêu cầu **nhập lại PIN của Manager/Admin** để xác nhận (tạo/sửa/xóa món, danh mục, bàn, user, đổi tiền két gốc, cấu hình máy POS thẻ, danh mục máy in, mật khẩu thiết bị khách, phân quyền vai trò, cấu hình kho…).

Danh sách permission đầy đủ xem `PERMISSIONS` trong `auth.js` (bán hàng, thanh toán, giảm giá, hoàn tiền, hủy, quản lý thực đơn/kho, hóa đơn, online, báo cáo theo loại, audit, và nhóm `settings.*` + `module.*`).

---

## Module ERP registry

`server/services/modules.js` là **bản đồ module ERP** duy nhất (lấy cảm hứng từ các bộ ERP lớn). Mỗi module có: nhóm, icon, route, permission, trạng thái (`active` / `core` / `planned`), phụ thuộc.

Nhóm module: Thiết yếu · Bán hàng · Chuỗi cung ứng · Tài chính · Năng suất · Studio · Cài đặt & nền tảng · Developer & database.

**Đang hoạt động (`active`/`core`):** iPad Self-Order, FnB POS, Retail POS, KDS, Kênh online, Quản lý kho, Tồn kho (core), Quản lý/Admin, Cài đặt, In ấn, Mua hàng, Hóa đơn, Chi phí, Liên hệ, Cơ sở dữ liệu & Tài liệu.

**Dự kiến (`planned`):** CRM, Báo giá & đơn bán, Đăng ký, eCommerce, Sản xuất, Mã vạch, Đội xe, Kế toán, Thanh toán online, Nhập/xuất dữ liệu, Dự án, Lịch, Thảo luận, Kiến thức, Việc cần làm, Studio, Tự động hóa, Developer.

Lộ trình: [docs/ERP_MODULE_ROADMAP.md](docs/ERP_MODULE_ROADMAP.md), ánh xạ service↔module: [docs/MODULE_MAP.md](docs/MODULE_MAP.md).

---

## Cơ sở dữ liệu

SQLite (`node:sqlite`) tại `runtime/server-data/store.db` khi chạy local, hoặc `/app/server-data/store.db` khi chạy VPS Docker. Schema & migration sống trong `server/db.js` (`migrate()`). Các bảng chính:

- **Cấu hình:** `branches`, `users`, `auth_sessions`, `role_perms`, `user_perms`, `app_settings`, `user_preferences`
- **Danh mục:** `categories`, `menu_items`, `recipes`, `skus`, `inventory_items`, `tables`, `vouchers`
- **Kho:** `warehouses`, `stock_lots`, `stock_movements`, `inventory_documents`, `inventory_document_lines`, `stocktake_sessions`, `stocktake_lines`
- **Bán hàng:** `orders`, `order_items`, `staff_calls`, `customers`
- **Thanh toán/quỹ:** `payments`, `payment_lines`, `shifts`, `cash_drawer_entries`, `cash_drawer_reimbursement_allocations`, `bank_transactions`
- **Mua hàng/chi phí:** `purchase_orders`, `purchase_order_lines`, `purchase_payments`, `expense_categories`, `expenses`
- **Khác:** `print_jobs`, `invoices`, `sync_queue`, `audit_log`, `enterprise_storage`, `document_files`

Đặc điểm quan trọng:

- **Nhật ký hoạt động (`audit_log`)** trong SQLite chỉ giữ **7 ngày gần nhất** (`purgeOldAudit`, dọn khi khởi động + mỗi ngày). Bản đầy đủ được ghi song song xuống `<STORAGE_PATH>/permanent-storage/audit/` dạng NDJSON.
- **`permanent-storage/`** là **bộ nhớ vĩnh viễn dạng file**: orders, payments, customers, staff, cash-drawer, reports được snapshot theo `by-id/` và `by-date/`. Đây là dữ liệu được bảo vệ, **gitignored**.
- Database được coi là **bộ nhớ vĩnh viễn của cửa hàng** — lưu lịch sử thay đổi quan trọng, không chỉ trạng thái mới nhất. Xem [docs/COMPANY_DATABASE_MEMORY.md](docs/COMPANY_DATABASE_MEMORY.md) và [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md).

---

## Realtime

`server/realtime.js` dùng Socket.IO:

- Mỗi thiết bị join phòng `branch:<id>` qua query `?branch=...&device=...`.
- `emit(event, payload, branch)` broadcast cho cả chi nhánh.
- Sự kiện điển hình: `menu:updated`, `kds:refresh`, `shift:updated`, `cash-drawer:updated`, `book-menu:updated`, và các sự kiện order/payment/table/presence.
- `presence` báo số thiết bị đang online theo loại. `getActiveConnections()` liệt kê kết nối cho màn hình Cài đặt → Kết nối.
- Có chống spam log kết nối (cùng thiết bị+IP chỉ log 1 lần / 10 phút).

---

## Thanh toán & tự xác nhận

Hệ thống hỗ trợ nhiều phương thức và **tự động đóng bill khi nhận xác nhận từ ngân hàng**:

- **Tiền mặt** + ngăn kéo tiền ESC/POS.
- **QR chuyển khoản** (VietQR / SePay / Casso / payOS), có thể chọn provider trong Cài đặt → Tích hợp.
- **Tự xác nhận (auto-confirm):**
  - *Path B — Webhook ngân hàng* (SePay/Casso): khớp bill theo nội dung chuyển khoản (memo `DANBILL…`) → gọi `payOrder` → đóng bill realtime. Webhook công khai, xác thực bằng key/chữ ký provider.
  - *Path A — payOS*: tạo link/QR theo từng bill, xác thực webhook HMAC bằng Checksum Key; đồng thời hỗ trợ **poll trạng thái** (`GET /api/payos/payment-status/:orderCode`) để chạy được cả trên localhost (không cần webhook public).
- **Thẻ (VCB SmartPOS):** cầu nối đa chế độ `auto/manual/mock` (native payment/card-terminal integration). Nếu không có app native, vẫn chạy ở chế độ **manual** (thu ngân tự quẹt rồi nhập approval code). App Android nâng cấp lên `auto` nằm ở `android-pos/` (scaffold, chờ tài liệu Intent VCB + Printer SDK).

Webhook & endpoint liên quan: `/api/{vietqr,sepay,casso,payos}/webhook`, `/api/orders/:id/payment-qr`, `/api/payment-qr`, `/api/payments/bank-transactions`.

Xem [docs/PAYMENT_OFFLINE_POLICY.md](docs/PAYMENT_OFFLINE_POLICY.md), [docs/BANK_ACCOUNT_LINKING.md](docs/BANK_ACCOUNT_LINKING.md).

---

## In ấn & phần cứng cửa hàng

Máy in nhiệt, máy in bếp/bar, ngăn kéo tiền, POS, KDS, thiết bị kho **phải nói chuyện với một backend chạy trong cùng mạng LAN** khi cần lệnh phần cứng.

- **Máy in LAN/IP:** dùng IP nội bộ + cổng ESC/POS (thường `9100`).
- **Máy in OS:** dùng driver đã cài trên máy chạy backend.
- **Máy in trình duyệt:** mở hộp thoại in hệ thống từ web (in/in lại để review).
- **Ngăn kéo tiền:** thường nối vào máy in bill, mở bằng xung ESC/POS.
- **Cloud không tới được LAN `192.168.x.x`** — với cửa hàng thật, luôn giữ một store server/agent online trong LAN và để cloud lo đồng bộ liên cửa hàng.

Xem [docs/PRINT_WORKFLOW.md](docs/PRINT_WORKFLOW.md).

---

## API REST

Toàn bộ route khai báo trong `server/api.js`, mount tại `/api`. Một số nhóm chính:

- **Auth/người dùng:** `/login`, `/logout`, `/me`, `/users`, `/branches`, `/ping`
- **Module & cài đặt:** `/modules`, `/settings/permissions`, `/settings/users`, `/settings/roles/:role/permissions`, `/settings/branches`, `/settings/app`, `/settings/integrations`, `/settings/connections/status`, `/settings/book-menu`, `/notification-sound`
- **Thực đơn/danh mục:** `/menu`, `/menu/manage`, `/menu/:id/...`, `/categories`
- **Bàn/order:** `/tables`, `/tables/:id/{move,merge}`, `/orders`, `/orders/:id/{confirm,reject,split,pay,...}`, `/orders/items/:id/{status,cancel,kds-dismiss}`, `/kds/:station`, `/calls`
- **Thanh toán/ca/két:** `/orders/:id/pay`, `/orders/:id/payment-qr`, `/payment-qr`, `/{vietqr,sepay,casso,payos}/webhook`, `/payos/payment-status/:orderCode`, `/shifts/*`, `/cash-drawer/*`
- **Kho/retail:** `/warehouses`, `/inventory*`, `/skus*`, `/warehouse/{receive,issue,transfer,stocktake,documents,lots}`, `/retail/{checkout,sales}`, `/retail/:id/refund`, `/vouchers*`
- **Liên hệ/mua hàng/chi phí:** `/customers*`, `/partners*`, `/purchase*`, `/expenses*`
- **Online/in ấn/hóa đơn:** `/online/*`, `/print/*`, `/invoices/*`
- **Báo cáo/audit/lưu trữ:** `/dashboard`, `/dashboard/trends`, `/reports/{catalog,preview,export}`, `/audit`, `/archive/*`
- **Đồng bộ & cấu hình:** `/sync/{status,offline,now}`, `/config/{export,import}`
- **CSDL & tài liệu:** `/database/{status,integrity-check,reset-transactions,docs}`, `/documents/*` (DMS)

Các endpoint chưa hiện thực trả về `notImplemented(...)` rõ ràng (JSON), không trả HTML. Route không tồn tại dưới `/api` trả JSON `apiNotFound`.

Hợp đồng chi tiết: [docs/API_CONTRACT.md](docs/API_CONTRACT.md).

---

## Biến môi trường

Đọc trong `server/config/env.js`; mẫu ở `.env.example` (root) và `deploy/company-server/.env.example`. Các khóa chính:

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PORT` | `3000` | Cổng server |
| `NODE_ENV` | `development` | `production` bật kiểm tra CORS |
| `APP_URL` / `API_BASE_URL` | — | URL công khai |
| `CORS_ORIGIN` | — | Danh sách origin tin cậy (phẩy ngăn cách) |
| `DEPLOYMENT_TARGET` | `local` | `local` \| `vps` |
| `DATABASE_PROVIDER` | `sqlite` | `sqlite` \| `postgres` |
| `SQLITE_PATH` | `runtime/server-data/store.db` | Đường dẫn file SQLite local |
| `DATABASE_URL` | — | Bắt buộc khi `postgres` |
| `REALTIME_PROVIDER` | `socketio` | `socketio` \| `websocket` |
| `STORAGE_PROVIDER` | `local` | `local` \| `s3` |
| `STORAGE_PATH` | `server` | Thư mục lưu trữ local; deployment nên đặt volume bền riêng (ví dụ `/app/storage`) |
| `LOG_LEVEL` | `info` | Mức log |
| `BACKUP_RETENTION_DAYS` | `14` | Số ngày giữ backup |
| `DISABLE_DEMO_SEED` | `false` | Tắt nạp dữ liệu demo lần đầu |
| `CONFIG_SEED_URL` | — | Khôi phục cấu hình từ URL khi DB trống |
| `JWT_SECRET` / `SESSION_SECRET` | `change-me` | Khóa bí mật (đổi khi production) |

Thứ tự ưu tiên `API_BASE_URL` phía Flutter native apps:

1. `window.APP_CONFIG.API_BASE_URL`
2. `VITE_API_BASE_URL` (nếu có build tool)
3. LocalStorage key `dan_d_pak_api_base_url`
4. Same-origin `/api`, fallback `http://localhost:3000` chỉ khi mở bằng `file://`

Xem [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

---

## Triển khai (Docker / company server)

Triển khai chính thức dùng **Docker Compose** trong `deploy/company-server/` (app + Caddy + PostgreSQL):

```bash
cd deploy/company-server
cp .env.example .env          # đổi POSTGRES_PASSWORD, JWT_SECRET, SESSION_SECRET, APP_URL...
docker compose up -d --build  # build image + chạy ngầm app/caddy/postgres
./scripts/healthcheck.sh      # kiểm tra sức khỏe
```

- `app`: Node backend + frontend (image từ `server/Dockerfile`), nghe cổng 3000 nội bộ.
- `caddy`: reverse proxy 80/443 → app.
- `postgres`: PostgreSQL 16 (volume bền vững).
- Backup/restore: `scripts/backup-db.sh`, `scripts/restore-db.sh`; khởi động lại: `scripts/restart.sh`.

Hướng dẫn đầy đủ (tiếng Việt): [deploy/company-server/README_DEPLOY.md](deploy/company-server/README_DEPLOY.md). Tham khảo thêm [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/VPS_DEPLOYMENT.md](docs/VPS_DEPLOYMENT.md), [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md).

> **Lưu ý:** Runtime hiện vẫn dùng SQLite. Adapter PostgreSQL/S3/WebSocket đang ở dạng scaffold, cần một pass migration trước khi chuyển hẳn.

---

## Vùng triển khai & sở hữu dữ liệu

Mô hình đích chia **hai vùng với ranh giới cứng** (xem [docs/DATA_OWNERSHIP.md](docs/DATA_OWNERSHIP.md)):

### Vùng VPS công khai (gateway — KHÔNG phải nguồn dữ liệu)

VPS public-facing: kết thúc HTTPS, reverse-proxy `/api` + WebSocket về company server cho các app Flutter native, expose health/version, và giữ **bộ đệm sự kiện mã hóa tạm thời (1–7 ngày, mặc định 7)** khi company server offline. VPS **không bao giờ** là nguồn dữ liệu, không lưu vĩnh viễn order/khách/nhân viên/thanh toán/hóa đơn/tồn kho/báo cáo/credential/audit/cài đặt riêng tư. PostgreSQL không bao giờ mở trên VPS. Xem [docs/VPS_GATEWAY.md](docs/VPS_GATEWAY.md), [docs/VPS_TEMPORARY_BUFFER.md](docs/VPS_TEMPORARY_BUFFER.md).

### Vùng company server riêng tư (nguồn dữ liệu thật)

Sở hữu toàn bộ dữ liệu nghiệp vụ thật: API, PostgreSQL, realtime, auth, người dùng/nhân viên/khách, cài đặt, lịch sử menu/giá, order, thanh toán, sổ quỹ, liên kết ngân hàng/app-web, KDS, sổ kho, mua hàng, hóa đơn, log in, tích hợp, báo cáo, audit, sync worker, backup. Chỉ nhận traffic từ LAN, IP VPN/tunnel của VPS, và admin được duyệt. Xem [docs/COMPANY_DATA_SERVER.md](docs/COMPANY_DATA_SERVER.md).

Khi company server không tới được, ghi sự kiện được **đệm (VPS)** hoặc **xếp hàng (thiết bị)** ở trạng thái **pending** — không bao giờ báo thành công chính thức — và đối soát khi phục hồi qua **sync back** idempotent. Xem [docs/OFFLINE_FIRST_ARCHITECTURE.md](docs/OFFLINE_FIRST_ARCHITECTURE.md), [docs/SYNC_BACK_TO_COMPANY_SERVER.md](docs/SYNC_BACK_TO_COMPANY_SERVER.md).

---

## Dữ liệu được bảo vệ & quy tắc an toàn AI

**Không bao giờ** xóa/ghi đè dữ liệu được bảo vệ một cách âm thầm. **Không** reset bảng production khi chưa có phê duyệt rõ ràng. **Không** thay dữ liệu thật bằng mock/demo. **Không** lộ service-role/secret key ra frontend. **Không** commit file `.env`, file DB local, backup, export, hay dữ liệu storage riêng tư.

File/đường dẫn được bảo vệ (đã có trong `.gitignore`):

- `runtime/server-data/store.db`, `runtime/server-data/store.db-shm`, `runtime/server-data/store.db-wal`, `server/db.sqlite`, `*.db`, `*.sqlite`, `*.sqlite3`
- `server/permanent-storage/**`, `server/enterprise-storage/**` (giữ lại README/.gitkeep)
- `server/uploads/**` (file DMS), `storage/private/`
- `backups/`, `*.dump`, `*.backup`, dump DB, báo cáo/hóa đơn/khách/đối soát đã export
- `.env`, `.env.*` (trừ `.env.example`), `tmp_*`, `*.log`

Nếu file được bảo vệ đang bị git theo dõi, chỉ gỡ khỏi **index của git**, **không xóa khỏi đĩa**.

Xem [docs/DATA_SAFETY.md](docs/DATA_SAFETY.md), [docs/PROTECTED_ZONES.md](docs/PROTECTED_ZONES.md), [docs/CHANGELOG_WORKFLOW.md](docs/CHANGELOG_WORKFLOW.md).

---

## Checklist kiểm thử

- `npm start` khởi động không lỗi cú pháp.
- `GET /health` trả JSON (có trạng thái DB + provider).
- `GET /api/ping` trả JSON.
- Các trang Admin/POS/iPad/KDS load từ server local.
- Order từ iPad hiện sang POS/KDS không cần reload.
- Thanh toán cập nhật bàn/dashboard không cần reload.
- Nhập/xuất kho cập nhật trạng thái warehouse/admin.
- Route `/api` không tồn tại trả JSON, không trả HTML.
- Không commit mới `.env`, DB, backup, hay dữ liệu permanent-storage.

---

## Vấn đề đã biết

- Một số dữ liệu được bảo vệ từng bị git theo dõi trước đây cần gỡ khỏi index (không xóa khỏi đĩa).
- Adapter PostgreSQL, S3, WebSocket vẫn là scaffold, chưa thay thế live.
- Các trang HTML lớn còn lẫn UI + workflow nghiệp vụ, cần tách dần.
- Một số thao tác xóa hiện xóa vật lý bản ghi cấu hình; cần một pass data-model để chuyển sang append-only an toàn cho production.

Xem [docs/KNOWN_CASES.md](docs/KNOWN_CASES.md).

---

## Quy tắc cho AI agent

- **Kiểm tra trước khi sửa.** Giữ thay đổi nhỏ, tăng dần.
- Không di chuyển/viết lại các luồng nghiệp vụ trọng yếu một cách tùy tiện.
- Không xóa file được bảo vệ.
- Tài liệu hóa mọi thay đổi tác động dữ liệu.
- Nếu thay đổi chạm tới order, payment, hóa đơn, tồn kho, báo cáo, khách hàng, người dùng, phân quyền, thiết bị hay audit log → cập nhật tài liệu an toàn + ghi changelog.

---

## Chỉ mục tài liệu

**Kiến trúc & vùng:** [ARCHITECTURE](docs/ARCHITECTURE.md) · [REPO_STRUCTURE](docs/REPO_STRUCTURE.md) · [DATA_OWNERSHIP](docs/DATA_OWNERSHIP.md) · [VPS_GATEWAY](docs/VPS_GATEWAY.md) · [COMPANY_DATA_SERVER](docs/COMPANY_DATA_SERVER.md) · [SECURITY_BOUNDARIES](docs/SECURITY_BOUNDARIES.md)

**CSDL & schema:** [COMPANY_DATABASE_MEMORY](docs/COMPANY_DATABASE_MEMORY.md) · [DATABASE_SCHEMA](docs/DATABASE_SCHEMA.md) · [AUDIT_LOGGING](docs/AUDIT_LOGGING.md)

**Offline, sync & resilience:** [OFFLINE_FIRST_ARCHITECTURE](docs/OFFLINE_FIRST_ARCHITECTURE.md) · [VPS_TEMPORARY_BUFFER](docs/VPS_TEMPORARY_BUFFER.md) · [SYNC_BACK_TO_COMPANY_SERVER](docs/SYNC_BACK_TO_COMPANY_SERVER.md) · [POWER_OUTAGE_RUNBOOK](docs/POWER_OUTAGE_RUNBOOK.md) · [FAILOVER_RUNBOOK](docs/FAILOVER_RUNBOOK.md) · [BACKUP_RESTORE](docs/BACKUP_RESTORE.md)

**Workflow nghiệp vụ:** [WORKFLOWS](docs/WORKFLOWS.md) · [DEVICE_WORKFLOWS](docs/DEVICE_WORKFLOWS.md) · [PAYMENT_OFFLINE_POLICY](docs/PAYMENT_OFFLINE_POLICY.md) · [BANK_ACCOUNT_LINKING](docs/BANK_ACCOUNT_LINKING.md) · [APP_WEB_LINKING](docs/APP_WEB_LINKING.md) · [PRINT_WORKFLOW](docs/PRINT_WORKFLOW.md) · [INVENTORY_WORKFLOW](docs/INVENTORY_WORKFLOW.md) · [CASH_IN_OUT_WORKFLOW](docs/CASH_IN_OUT_WORKFLOW.md)

**Triển khai & module:** [DEPLOYMENT](docs/DEPLOYMENT.md) · [VPS_DEPLOYMENT](docs/VPS_DEPLOYMENT.md) · [deploy/company-server](deploy/company-server/README_DEPLOY.md) · [MODULE_MAP](docs/MODULE_MAP.md) · [ERP_MODULE_ROADMAP](docs/ERP_MODULE_ROADMAP.md) · [API_CONTRACT](docs/API_CONTRACT.md)

**Changelog:** mọi thay đổi tương lai theo [docs/CHANGELOG_WORKFLOW.md](docs/CHANGELOG_WORKFLOW.md) — ghi scope, file đụng tới, vùng dữ liệu được bảo vệ, kiểm thử, tác động triển khai, đường rollback, cảnh báo.
