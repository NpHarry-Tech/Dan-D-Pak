# Deployment Fingerprint — 2026-08-08

## Phạm vi và nguyên tắc an toàn

- Giai đoạn hiện tại: chỉ audit, chưa sửa business logic.
- Không reset, checkout, clean, stash, restart, deploy hoặc migration.
- Không đọc/chỉnh sửa bản ghi nghiệp vụ production.
- Không ghi secret vào báo cáo. Giá trị biến môi trường đã được che toàn bộ.
- VPS được khóa theo SSH host key: `SHA256:fmDCv6ehU4KpbB+pV7uVvFbC+M0SM6OF8YINwuAkRZM`.

## Kết luận source of truth ban đầu

Source backend đang chạy khớp byte-for-byte với working tree local đối với toàn bộ 177 file JS/CJS/MJS/JSON/Dockerfile hiện có trong phạm vi kiểm tra. Thư mục deploy VPS và image đang chạy cũng khớp nhau ở các file trọng yếu đã fingerprint.

Tuy nhiên, VPS/image còn 46 file legacy không còn tồn tại trong local. Vì deploy hiện tại không mang Git metadata và có dấu hiệu chép đè source mà không loại file cũ, chưa được kết luận rằng các file legacy không thể tham gia runtime. Phải truy vết import/route/bootstrap trước khi phân tích root cause nghiệp vụ.

## Local Git fingerprint

| Thuộc tính | Giá trị |
|---|---|
| Repo | `D:\Dan D Pak` |
| Branch | `fix/universal-print-validation` |
| HEAD | `5208475` |
| HEAD subject | `fix(printing): ưu tiên máy in cắm tại thiết bị cho cả phiếu bếp, tem ly và chạy món` |
| Remote | `NpHarry-Tech/Dan-D-Pak` — chỉ tham khảo lịch sử |
| Tracked changes | 128 file, khoảng `+10.109/-2.388` |
| Untracked | Có nhiều file/thư mục mới |
| Deleted tracked files | `flutter-apps/dandpak_core/lib/src/screens/retail/retail_customer_dialogs.dart`; `server/services/misa.js` |
| Cached diff | Không ghi nhận thay đổi staged trong lần chụp ban đầu |
| Safety action | Giữ nguyên toàn bộ working tree; không stash/reset/checkout |

## VPS/runtime fingerprint

| Thuộc tính | Giá trị |
|---|---|
| Host | `42.96.18.70` (`api.dandpakpos.io.vn`) |
| Hostname | `ubuntu` |
| OS | Ubuntu 24.04.4 LTS, kernel `6.8.0-111-generic` |
| Host timezone | `Asia/Ho_Chi_Minh` |
| NTP | Đồng bộ |
| Docker | 29.1.3 |
| Docker Compose | 2.40.3 |
| Compose project | `company-server` |
| Compose file | `/opt/dan-d-pak/deploy/company-server/docker-compose.yml` |
| Node runtime | v22.23.2 |
| Public health | Healthy; `nodeEnv=production`; `deploymentTarget=vps` |
| Providers | SQLite, Socket.IO, local storage |

## Container fingerprint

| Container | Image | Image ID | Created/started | Health | Ports |
|---|---|---|---|---|---|
| `company-server-app-1` | `company-server-app:latest` | `sha256:3d64ddefa5af...` | 2026-08-07 23:48 UTC | healthy | internal 3000 |
| `company-server-caddy-1` | `caddy:2` | `sha256:af5fdcd76f2d...` | started 2026-07-26 | no Docker healthcheck | public 80/443 |

Rollback image hiện có: `company-server-app:rollback`, ID `sha256:65f44c923b36...`, tạo ngày 2026-07-28. Chưa kiểm chứng khả năng rollback và tương thích schema.

App dùng các volume riêng cho SQLite, backup, storage, permanent storage, releases, uploads và product images. Caddy bind-mount read-only file `/opt/dan-d-pak/deploy/company-server/Caddyfile`.

## Release fingerprint

| Component | Local source version/build | Production release slot | Match? |
|---|---:|---:|---|
| Desktop Windows | `2026.08.08.01` / 118 | `2026.08.08.01` / 118 | Có |
| Tablet Android | `2026.08.08.01` / 91 | `android`: `2026.08.08.01` / 91 | Có |
| Phone Android | `2026.08.08.01` / 69 | `android-phone`: `2026.08.08.01` / 69 | Có |
| SUNMI/Handy | Chưa có release slot riêng; cần xác minh dùng Phone APK hay build khác | Chưa xác minh | Chưa rõ |
| Hardware Print Agent | Binary local tồn tại nhưng backend không có release slot | Chưa xác minh trên từng máy | Chưa rõ |

Lưu ý: `pubspec.yaml` đang mang build metadata khác các hằng số phát hành (`desktop +101`, `tablet +73`, `phone +51`). Quy trình publish đọc `app_version.dart`; cần audit để tránh hai nguồn version gây nhầm fingerprint.

## Source matching evidence

- 10 file trọng yếu (`index`, `api`, `db`, order, payment, printing, retail, voucher và package manifests) có SHA-256 giống nhau giữa local, `/opt/dan-d-pak` và image `/app`.
- Manifest mở rộng: 177/177 file source hiện có ở local khớp hash với VPS; không có file local nào thiếu trên VPS và không có content diff trong phạm vi kiểm tra.
- VPS không có `.git`; không thể suy commit từ artifact đang chạy.
- Image/container không có label `commit`, `version` hoặc `buildTime` hữu dụng.

## Legacy files còn dư trên VPS/image

Có 46 file không còn trong local. Nhóm đáng chú ý:

- `server/services/misa.js` song song với `server/services/misa/*` mới.
- `server/db/schema/{migrations,tables}.js`, `server/db/syncTriggers.js`.
- `server/services/inventory/*` cũ.
- Nhiều `server/modules/*/index.js` và module config cũ.
- `server/agent.js` song song với `server/agent.cjs`.
- Một số script/test cũ.

Đây là rủi ro deployment/source P0. Chưa xóa file nào. Bước kế tiếp là chứng minh file nào được runtime import hoặc có thể được gọi bởi script/fallback.

## Bảng component tổng hợp

| Component | Source path | Git commit | Version/build | Build time | Đang deploy | Match source? |
|---|---|---|---|---|---|---|
| Backend Node.js | `server/` | Không nhúng; local HEAD `5208475` + working tree | package `1.0.0`; Node 22.23.2 | image 2026-08-08 06:48 +07 | Có | 177 file hiện hành khớp; VPS dư 46 legacy |
| Desktop Flutter | `flutter-apps/dandpak_desktop` + core | Không nhúng commit | 2026.08.08.01 / 118 | artifact local 2026-08-08 06:56 +07 | Release slot có | Version/build khớp; binary chưa hash đối chiếu |
| Tablet Flutter | `flutter-apps/dandpak_tablet` + core | Không nhúng commit | 2026.08.08.01 / 91 | Chưa xác minh binary tương ứng | Release slot `android` có | Version/build khớp; binary chưa hash đối chiếu |
| Phone Flutter | `flutter-apps/dandpak_phone` + core | Không nhúng commit | 2026.08.08.01 / 69 | Chưa xác minh binary tương ứng | Release slot có | Version/build khớp; binary chưa hash đối chiếu |
| SUNMI / Handy | Dùng Flutter phone theo dấu hiệu source | Không nhúng commit | Chưa xác minh thiết bị | Chưa xác minh | Chưa xác minh | Chưa rõ |
| Hardware Print Agent | `server/agent.cjs` + binary build | Không nhúng commit | Chưa có canonical version | Binary local có | Trên máy POS, không phải VPS | Chưa rõ |
| Database schema | `server/db.js`, `server/db/*` và SQLite runtime | Không áp dụng | Chưa dump metadata | Runtime production | Có | Chưa xác minh |
| Migration | `server/migrations` + bootstrap inline | Không áp dụng | Chưa xác minh canonical version | Runtime startup | Có | Chưa xác minh |
| Web/Admin UI | Được backend phục vụ | Không nhúng commit | Chưa có build metadata riêng | Theo backend image | Có | Cần fingerprint assets |

## Gate trước bước tiếp theo

Chưa được phân tích root cause nghiệp vụ hoặc sửa code cho tới khi:

1. Truy vết 46 file legacy có tham gia runtime hay không.
2. Dump metadata schema/index/constraint/migration bằng truy vấn chỉ-đọc.
3. Hash binary release trên VPS và đối chiếu artifact local tương ứng.
4. Xác minh build/version trên thiết bị Desktop, Tablet, Phone, SUNMI và Hardware Agent thực tế.
5. Hoàn thành system map, domain map và data-flow map.

