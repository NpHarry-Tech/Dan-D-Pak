# Repository Structure

Last updated: 2026-08-01

This document maps the **target architecture** (public VPS zone vs. private company
server zone) onto the **current repository layout**. A full directory rename of a
live business system is risky, so the current names are kept and the mapping is
documented here. Renames will happen incrementally and safely.

## Target vs. current mapping

| Target zone | Target folder | Current folder | Status |
| --- | --- | --- | --- |
| Public/mobile/desktop app shell | `apps/` | `flutter-apps/` | Current app source lives here |
| VPS gateway (proxy/buffer/relay) | `vps-gateway/` | `deploy/company-server/` | Company-server deploy scaffold exists; gateway relay remains planned |
| Private company server (source of truth) | `company-server/` | `server/` | Keep current name; same role |
| Deploy definitions | `deploy/` | `deploy/` | Exists (`deploy/vps`) |
| Documentation | `docs/` | `docs/` | Exists |

> **Rule:** Flutter app code is the public, non-sensitive shell. `server/` is the private
> source of truth. The VPS never owns business data — see
> [DATA_OWNERSHIP.md](DATA_OWNERSHIP.md).

## Current layout

```text
Dan-D-Pak/
  flutter-apps/
    dandpak_core/              ⭐ Gói lõi DÙNG CHUNG — chứa TOÀN BỘ code app
      lib/dandpak_core.dart    barrel công khai (runDandpakApp + AppFlavor + primitives)
      lib/src/app_flavor.dart  điểm phân hoá theo thiết bị (appId + module set + layout)
      lib/src/bootstrap.dart   điểm vào dùng chung (runDandpakApp) + root app widget
      lib/src/screens/         POS, self-order, KDS, warehouse, invoices, settings...
      lib/src/services/        API/realtime/local runtime + api/ (domain extensions)
      lib/src/{models,providers,ui,widgets,utils}/
      test/                    unit/smoke test dùng chung
    dandpak_desktop/           Vỏ mỏng Windows/Linux/macOS (lib/main.dart + app_version.dart)
      windows/ linux/ macos/   thư mục nền tảng; assets/ + fonts khai báo tại app
    dandpak_tablet/            Vỏ mỏng Android/iOS (main.dart + app_version.dart)
      android/ ios/            thư mục nền tảng; assets/ + fonts khai báo tại app
    dandpak_phone/             Vỏ mỏng Android/iOS (main.dart + app_version.dart)
      android/ ios/            thư mục nền tảng; assets/ + fonts khai báo tại app

  # 3 app khác nhau DUY NHẤT ở AppFlavor trong main.dart (appId + enabledModuleKeys +
  # layout). Không còn nhân bản 100+ file như trước. Xem docs/ARCHITECTURE.md.

  server/                      => target company-server/ (private source of truth)
    index.js api.js db.js      Express entry, REST router, live SQLite schema
    realtime.js                Socket.IO hub
    config/                    env, cors, runtime, providers
    core/                      logger, errors, http helpers
    services/                  current business logic (orders, payments, inventory ...)
      misa/                    tích hợp MISA meInvoice (xem docs/MISA_EINVOICE.md)
      settings/                từng nhóm cấu hình một file (print, retail, sell, ...)
    modules/                   domain route/module entrypoints (inventory, payments, invoices, tax...)
    db/                        SQLite connection, transaction, audit, backup, maintenance helpers
    migrations/                utilities; live schema migration remains in server/db.js
    assets/ uploads/ releases/ runtime/downloadable files served by backend
    enterprise-storage/        append-only enterprise archive storage
    permanent-storage/         archived JSON/NDJSON snapshots, not the live DB

  runtime/                     local runtime data, ignored by git
    server-data/store.db        single local SQLite DB (+ WAL sidecar files)

  deploy/
    company-server/            Docker/Caddy/Postgres scaffold for company server

  docs/                        architecture, workflows, data-ownership, runbooks

  artifacts/                   bản build đem đi phát hành (.apk/.exe) — git bỏ qua
  backups/                     bản sao DB xuất ra bằng tay — git bỏ qua

  # Ở NGAY THƯ MỤC GỐC (không gom vào deploy/): mấy file này là ĐƯỜNG VÀO của
  # người dùng cuối và của bộ cài desktop, đường dẫn tới chúng nằm trong shortcut
  # trên máy khách và trong setup.iss. Gom vào thư mục con là gãy shortcut đã
  # phát cho cửa hàng, nên giữ nguyên chỗ và ghi lại ở đây.
  Dan D Pak POS.vbs            shortcut khởi động app desktop (không hiện cửa sổ đen)
  DanDPak_POS_DESKTOP_APP.ps1  script chạy app desktop kèm backend cục bộ
  package-for-it.ps1           đóng gói mã nguồn gửi bộ phận IT
  package.json                 script dev dùng chung + khoá phiên bản Node
```

## Company-server module zones

Route ownership hiện có trong `server/modules/` (mỗi module có `routes.js`).
Nghiệp vụ luôn ở `server/services/*`.

```text
server/modules/   (22 module — route ownership; api.js là registrar)
  ✅ inventory/ invoices/ payments/ tax/                          (đã tách trước đó)
  ✅ orders/ reports/ audit/ purchase/ expenses/ online/ printing/ (tách 2026-07-13)
  ✅ retail/ contacts/ catalog/ agent/ appRelease/ sync/           (tách 2026-07-13)
  ✅ auth/ clientLog/ settings/ database/ documents/               (tách 2026-07-13, nhóm nhạy cảm)
  # api.js chỉ còn: helper cross-cutting dùng chung (truyền vào module) + route dev /dev/seed.
```

> ✅ = route đã chuyển vào module. ⏳ = route vẫn ở `api.js` (chạy tốt; sẽ tách dần, không
> đổi hành vi). Đây là trạng thái THẬT — không phải kế hoạch. So khớp với
> [MODULE_MAP.md](MODULE_MAP.md).

See [MODULE_MAP.md](MODULE_MAP.md) for the service-to-module mapping and
[ERP_MODULE_ROADMAP.md](ERP_MODULE_ROADMAP.md) for sequencing.

## Why no big-bang rename

- `server/` is referenced by `package.json`, deploy scripts, bundled engine startup,
  and app runtime URLs.
- `flutter-apps/` contains separate desktop/tablet/phone app shells sharing the same backend API.
- A rename would touch deploy pipelines and risk an outage on a live system.
- The role separation (app shell vs. private data owner) is already true in
  code; this document makes it explicit. Renames are a later, isolated PR.
