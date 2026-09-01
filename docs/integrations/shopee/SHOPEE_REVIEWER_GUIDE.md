# Shopee App Review — Môi trường Reviewer (Dan D Pak POS)

Tài liệu này phục vụ bước **Submit Service Information** trên Shopee Open Platform
(Live Business Product URL / Live Test Username / Live Test Password) và ghi rõ
**quy trình test** cho reviewer.

## 1. Kiến trúc (đúng thực tế — không dựng web giả)

Dan D Pak POS là **ứng dụng Windows Desktop** (Flutter) + backend Node.js trên VPS.
Không web-hoá được (34 file dùng `dart:io`/`Process`, plugin `win32`/`video_player_win`/FCM
không có bản web). Vì vậy reviewer **tải app Desktop thật** và app nối vào **backend
review tách biệt**:

```
Shopee Reviewer
   │  (1) mở URL Business Product
   ▼
https://review.<domain>              ← Reviewer Portal (trang tĩnh: tải app + hướng dẫn)
   │  (2) tải & cài "Dan D Pak (Review)"
   ▼
Dan D Pak Desktop — Review build     ← CÙNG source production, chỉ khác backend
   │  (3) đăng nhập tài khoản reviewer
   ▼
https://api-review.<domain>          ← backend review (stack Docker RIÊNG)
   ├── DB review riêng  (/app/server-data/review.db — guard khoá cứng, tách store.db)
   ├── dữ liệu synthetic (demo seed)
   ├── user reviewer quyền tối thiểu (role shopee_reviewer)
   ├── Shopee SANDBOX (SHOPEE_ENV=sandbox)
   └── KHÔNG truy cập DB / credential production
```

Production và review chạy **hai stack Docker khác nhau** (volume/DB/mạng tách hẳn),
có thể cùng một VPS. Không dùng chung DB.

## 2. Giá trị điền vào form Shopee

| Trường | Giá trị |
|---|---|
| **Business Product URL** | `https://review.<domain>` (VD `https://review.dandpakpos.io.vn`) — KHÔNG điền URL API |
| **Live Test Username** | `shopee-reviewer` |
| **Live Test Password** | = giá trị `SHOPEE_REVIEWER_PIN` (8–12 chữ số) bạn đặt trong `deploy/review/.env` — KHÔNG commit, sinh trên VPS |
| **How many sellers supporting** | *(số người bán thật của bạn — mới thì chọn dải nhỏ nhất)* |
| **Other e-commerce platforms integrated** | *(chọn đúng sàn đã tích hợp: Haravan / Lazada / TikTok Shop / Tiki)* |
| **Remarks** | "Dan D Pak POS is a Windows desktop application. The Business Product URL is a portal to download the desktop review build; log in with the test credentials, then open *Bán Online → Shopee* to test the integration in the sandbox environment." |

## 3. Đáp ứng 10 yêu cầu review

| # | Yêu cầu | Cách đáp ứng |
|---|---|---|
| 1 | Reviewer truy cập được sản phẩm thật | App Desktop THẬT (cùng source production), tải từ portal |
| 2 | Không dữ liệu khách production | DB review riêng (`review.db`), chỉ dữ liệu synthetic demo seed |
| 3 | Không lộ Partner Key/secret/token | Token/secret nằm ở backend, mã hoá; reviewer không có quyền xem |
| 4 | Vai trò reviewer quyền tối thiểu | Role `shopee_reviewer` (14 quyền, xem [reviewSeed.js](../../../server/db/reviewSeed.js)) |
| 5 | Xem/thử Online Sales, Products, Inventory, Orders, Marketplace Connections, Shopee | Đủ quyền `module.online/retail/warehouse/inventory`, `online.*`, `omni.connector` |
| 6 | KHÔNG xem secret/credential/DB admin/thao tác nguy hiểm | Role KHÔNG có `settings.*`, `warehouse.delete/item`, `refund`, `void`, `audit.view` |
| 7 | Dữ liệu test synthetic | Demo seed (branch "Shopee Review Store", TEST-*, tồn 100, đơn synthetic) |
| 8 | HTTPS | Caddy tự cấp TLS cho cả `review.` và `api-review.` |
| 9 | Tách production/testing | Stack Docker riêng + `SHOPEE_ENV=sandbox` + `ALLOW_PRODUCTION_DATA=false` |
| 10 | Tài liệu URL + quy trình test | Chính tài liệu này + portal |

## 4. Quy trình test cho reviewer

1. Mở `https://review.<domain>` → bấm **Download Dan D Pak (Review)**.
2. Cài và mở **Dan D Pak POS (Review)** (Windows 10/11). App tự nối backend review.
3. Đăng nhập: username `shopee-reviewer`, PIN/password `860921`.
4. Vào **Bán Online** từ menu chính.
5. **Thiết lập kênh → Shopee → Kết nối**: chạy uỷ quyền Shopee 1 chạm (sandbox).
6. Xem **Đơn hàng**, **Hàng hoá** (đối chiếu listing↔SKU), **Tồn kho**, **Kết nối sàn**.

## 5. Việc bạn (chủ) cần làm trước khi nộp form

1. **DNS**: trỏ `review.<domain>` và `api-review.<domain>` về VPS.
2. **Shopee Console**: lấy **Sandbox Partner ID/Key**; khai redirect
   `https://api-review.<domain>/auth/shopee/callback` và webhook
   `https://api-review.<domain>/webhooks/shopee`.
3. **Build app review** trên máy Windows:
   `.\deploy\build-desktop-review.ps1` → installer copy vào `deploy/review/portal/download/`.
4. **Chạy stack review** trên VPS:
   ```bash
   cd deploy/review
   cp .env.example .env      # điền DATA_ENCRYPTION_KEY (openssl rand -hex 32),
                             # SHOPEE_PARTNER_ID/KEY sandbox
   docker compose -p dandpak-review up -d --build
   ```
   *(Nếu review chung VPS production: đặt `REVIEW_HTTP_PORT/HTTPS_PORT` hoặc cho
   Caddy production route 2 domain review sang cổng 8080/8443. Nếu VPS riêng: đổi
   về 80/443.)*
5. Điền form Shopee theo mục 2 → submit.
