# Shopee — Legacy Inventory (audit hiện trạng)

> Nguồn: workspace local (source of truth), đọc trực tiếp code ngày rebuild.
> Mục tiêu: phân loại code Shopee hiện có trước khi rewrite (không xóa mù).

## Kết luận nhanh

Luồng OAuth v2 **ĐÃ CHẠY được về cơ chế** (auth_partner → callback → token/get →
refresh). Vấn đề **KHÔNG phải cơ chế** mà là **mô hình credential + UX**:

- Partner ID / Partner Key được lấy từ **thiết lập TỪNG chi nhánh** (user tự
  nhập) thay vì **một secret cấp nền tảng ở backend** → đó là lý do "rườm rà".
- Màn Thiết lập kênh lộ field kỹ thuật (Partner ID/Key/Token…).
- Chưa có model kết nối riêng (`shopee_connections`) + auth-attempt (nonce),
  chưa có multi-shop, chưa có worker refresh, chưa có webhook idempotency store.

## Bảng phân loại

| File / thành phần | Loại | Vai trò | Thay thế |
|---|---|---|---|
| `server/services/shopeeConnector.js` | ACTIVE (giữ lõi) | OAuth v2, ký HMAC, callShop, order sync, product sync, waybill, webhook push | Tách thành ShopeeAuthService/Client/…; đổi nguồn credential sang platform |
| `shopeeConfig(branchId)` | LEGACY (mô hình sai) | Đọc partnerId/secretKey từ per-branch settings | Partner ID/Key từ ENV nền tảng; per-shop chỉ giữ shopId/token |
| `server/services/settings/integrations.js` → `shopee` schema | LEGACY | Field user nhập partnerId/secretKey/shopId/accessToken/refreshToken | Bỏ field kỹ thuật khỏi user; chỉ giữ toggles (syncOrders/products/inventory, orderMode) |
| `server/modules/online/routes.js` `/online/connectors/shopee/*` | PARTIAL | capabilities, auth-link, refresh-token, sync, sync-products, waybill | Giữ sync/waybill; auth chuyển sang `/integrations/shopee/*` mới |
| `server/index.js` `GET /auth/shopee/callback` | ACTIVE | Nhận code+shop_id → shopeeExchangeToken | Nâng cấp: validate auth-attempt (nonce), multi-shop, đánh dấu connection ACTIVE |
| `server/index.js` `POST /webhooks/shopee` | ACTIVE | Nhận push, verify chữ ký, kéo đơn | Thêm idempotency store + queue (không xử lý nặng trong request) |
| `shopeeExchangeToken` / `shopeeRefreshToken` | ACTIVE (giữ) | Đổi/làm mới token v2 | Ghi vào `shopee_connections`; worker refresh chủ động |
| Flutter `settings_integrations_panel.dart` (Shopee card) | LEGACY (UX) | Form nhập credential kỹ thuật | Màn "Kết nối Shopee" 1-chạm, ẩn field kỹ thuật |
| `external_orders` / `external_products` (provider='shopee') | ACTIVE (giữ + migrate) | Đơn/sản phẩm sàn | Giữ nguyên; connection mới liên kết qua shop_id |

## Dữ liệu KHÔNG được mất khi migrate
- Mapping SKU (`external_products.internal_variant_id`).
- Đơn đã đồng bộ (`external_orders`, `orders` channel=online).
- Sync logs / audit.
- Token đang hoạt động (nếu shop đã ủy quyền) → migrate sang `shopee_connections`.
