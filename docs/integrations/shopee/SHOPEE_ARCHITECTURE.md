# Shopee — Target Architecture (Dan D Pak)

Mục tiêu: người dùng chỉ **Kết nối Shopee → Đăng nhập → Đồng ý → Xong**. Mọi
phức tạp kỹ thuật nằm ở BACKEND. Partner ID/Key là **secret cấp nền tảng** (ENV),
KHÔNG bao giờ ra Flutter, KHÔNG cho user nhập.

## Credentials
- `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_ENV` (production|sandbox) — ENV backend, MỘT bộ cho cả sản phẩm.
- Per-shop (obtained qua OAuth, mã hoá): `shop_id`, `access_token`, `refresh_token`, expiry.
- Fallback migrate: nếu ENV trống, tạm đọc partnerId/secretKey từ integration cũ (per-branch) để không gãy khi chưa cấu hình ENV.

## Bảng
`shopee_connections`: id, branch_id, shop_id, shop_name, region, status,
access_token_enc, refresh_token_enc, access_expires_at, refresh_expires_at,
authorized_at, last_refresh_at, last_sync_at, settings_json, created_by, created_at, updated_at, disconnected_at.
UNIQUE(shop_id) — một shop chỉ nối một chỗ; một branch nối NHIỀU shop (multi-shop).

`shopee_auth_attempts`: id (state/nonce), branch_id, user_id, status(pending|done|expired|error),
created_at, expires_at (~10 phút), completed_at, shop_id, error. Chống replay/nhầm callback.

`shopee_webhook_events` (Phase 3): provider_event_id, event_type, shop_id, payload_hash, received_at, processed_at. Idempotency.

## States
DISCONNECTED · CONNECTING · CONNECTED · CONFIGURING · ACTIVE · AUTH_EXPIRED · REAUTH_REQUIRED · ERROR
(auth thành công ≠ đã sync; sync lỗi KHÔNG bắt OAuth lại.)

## Endpoints (backend-only token exchange)
- `POST /api/integrations/shopee/connect/start` → tạo auth_attempt(nonce) + build auth_partner URL (ký bằng Partner Key ENV) → trả {url, attempt_id}.
- `GET  /auth/shopee/callback?code&shop_id&state` → validate attempt(state,nonce,expiry,branch) → token/get → upsert `shopee_connections` ACTIVE → mark attempt done → (emit realtime).
- `GET  /api/integrations/shopee/attempts/:id` → Flutter poll trạng thái attempt (pending/done/error) để tự đóng dialog.
- `GET  /api/integrations/shopee/connections` → list gian hàng đã nối (metadata, KHÔNG token).
- `POST /api/integrations/shopee/connections/:id/settings` → chi nhánh/tồn/giá/auto-SKU/mốc lấy đơn.
- `POST /api/integrations/shopee/connections/:id/disconnect` → cancel_auth_partner + mark disconnected (giữ lịch sử đơn).
- `POST /api/integrations/shopee/connections/:id/sync` → sync thủ công (đơn/SP).

## Flow (Flutter Desktop)
Bấm Kết nối → gọi connect/start → mở URL Shopee ở trình duyệt hệ thống → dialog
"Đang chờ xác nhận trên Shopee…" + poll attempts/:id → callback backend đánh dấu
ACTIVE → Flutter thấy done → dialog tự đóng → hiện "Đã kết nối" + setup wizard.
Không phụ thuộc custom URL scheme; dùng poll (đơn giản, chắc chắn cho desktop).

## Bảo mật
Partner Key chỉ ở ENV server. Token chỉ ở backend (mã hoá bằng encryptSecret hiện có).
Flutter chỉ nhận: status, shop metadata, settings. Log redact secret. RBAC: chỉ quyền phù hợp mới connect/disconnect/đổi cấu hình. Audit mọi thao tác.

## Giữ lại từ code cũ
`shopeeConnector.js`: signPublic/signShop/callShop, syncShopeeOrder, pullShopeeOrders,
pullShopeeProducts, shopeeWaybill, handleShopeePush — tái dùng, chỉ đổi nguồn credential
(ENV + connection) thay vì shopeeConfig(per-branch).
