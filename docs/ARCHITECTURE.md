# Architecture

Last updated: 2026-07-13

Dan D Pak now runs as a modular monolith backend plus native Flutter app shells.

## Runtime Shape

```text
dandpak_core (Flutter package) — TOÀN BỘ code dùng chung
  models/ providers/ screens/ services/ ui/ widgets/ utils/ + bootstrap.dart
  app_flavor.dart  điểm phân hoá theo thiết bị (appId + bộ module + layout)
        ^ path dependency
        |
Flutter app shells (vỏ mỏng: chỉ main.dart + app_version.dart)
  dandpak_desktop  Windows/Linux/macOS — bộ module đầy đủ (quầy)
  dandpak_tablet   Android/iOS — bộ module gọi món/bếp/kho
  dandpak_phone    Android/iOS — bộ module quản trị/duyệt
        |
        | HTTP /api + Socket.IO
        v
server/
  index.js         Express + Socket.IO entry
  api.js           top-level API registrar (đã mỏng dần khi tách module)
  modules/         domain route modules (route ownership)
  services/        business services (nguồn sự thật nghiệp vụ)
  db.js + db/      SQLite schema/helpers and extracted database helpers
```

There is no active static browser app. The Flutter browser-platform folder was removed from the split apps, and shared UI images live under each app's `assets/brand/` directory.

## Backend Modules

`server/api.js` remains the compatibility registrar. Domain route ownership lives under
`server/modules/<domain>/routes.js` (each has an `index.js` re-exporting its service):

- ✅ Route ownership đã tách hết vào module — **23 module**: `inventory`, `invoices`, `payments`,
  `tax`, `orders` (+void/refund+staff-calls), `reports`, `audit` (+archive), `purchase`, `expenses`,
  `online`, `printing`, `retail` (POS+vouchers), `contacts`, `catalog` (menu+categories), `agent`
  (hardware print), `appRelease` (auto-update), `sync`, `auth` (login+registry), `clientLog`,
  `config`, `settings` (user/perm/PIN/config/devices), `database` (backup/restore/staging),
  `documents` (DMS + export `fileCashDrawerReceipt` cho payments).
- ⏳ CÒN inline trong `api.js` (thin registrar ~320 dòng): chỉ còn **helper cross-cutting dùng chung**
  (wrap/guard/branch/visibleBranch/actor/publicBranch + saveBase64Image/applyManualConfirm/
  assertBillEditable/scopedUserBody/requireContactMutationPermission/logRequestError — truyền vào
  module) và route dev `/dev/seed` (khóa env). Đây là vai trò registrar + helper chung, đúng thiết kế.
- Route module chỉ validate + gọi service; nghiệp vụ luôn ở `services/*` (34 file). `api.js` từ
  **1796 → ~320 dòng**.

Business rules stay in `server/services/*` (34 file, một domain một file — đây là ranh giới
module thật). Route modules only validate request shape, call services, and return normalized
API payloads. Việc tách phần route inline còn lại là dọn dần, không đổi hành vi.

## Flutter Apps

**Không còn nhân bản code giữa 3 app.** Toàn bộ code UI + nghiệp vụ dùng chung (models,
providers, screens, services, ui, widgets, utils, bootstrap) sống MỘT nơi trong
`flutter-apps/dandpak_core`. Ba app chỉ là "vỏ mỏng" (`lib/main.dart` + `lib/app_version.dart`):

- `flutter-apps/dandpak_desktop` — Windows/Linux/macOS
- `flutter-apps/dandpak_tablet` — Android/iOS
- `flutter-apps/dandpak_phone` — Android/iOS

Mỗi `main.dart` gọi `runDandpakApp(flavor: AppFlavor(...))` với **AppFlavor** riêng — điểm phân
hoá DUY NHẤT giữa 3 app:

- `appId` — định danh máy (đi vào hộp đen/nhật ký để biết lỗi ở app nào).
- `versionName`/`buildNumber` — lấy từ `app_version.dart` của chính app.
- `enabledModuleKeys` — BỘ MODULE hiển thị (desktop = tất cả; tablet/phone = bộ riêng →
  "khác số lượng module").
- `layout` (`station`/`tablet`/`handset`) — tinh chỉnh bố cục UX (cùng ngôn ngữ thiết kế
  `ui/app_theme.dart`, khác cách sắp xếp).

Plugin (media_kit, mobile_scanner, desktop_multi_window…) khai báo trong `dandpak_core` và
kéo vào 3 app qua phụ thuộc bắc cầu; app chỉ giữ khai báo `assets/`+`fonts` và thư mục nền
tảng (`windows/`, `android/`, `ios/`…). Unit test dùng chung nằm ở `dandpak_core/test/`.