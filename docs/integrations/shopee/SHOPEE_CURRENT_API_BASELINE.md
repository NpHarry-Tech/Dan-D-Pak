# Shopee — Current API Baseline (OpenAPI v2)

> ⚠️ NGUỒN AUTHORITY LÀ CONSOLE SHOPEE OPEN PLATFORM SỐNG của Dan D Pak.
> Tài liệu này phản ánh **OpenAPI v2** như code hiện tại đã implement + tài liệu
> công khai. **Trước khi go-live, đối chiếu lại từng mục với console thật** (endpoint,
> scope, TTL có thể đổi). Không hard-code TTL — dùng `expire_in` do Shopee trả về.

## Developer / App type
- Để phục vụ **NHIỀU người bán** (mỗi cửa hàng Dan D Pak là một seller Shopee riêng),
  Dan D Pak phải đăng ký app loại **cross-region / ERP / third-party (ISV)** trên
  `open.shopee.com`, và được Shopee **duyệt go-live**. Đây là việc MỘT LẦN của công ty.
- Kết quả nhận được (giữ ở BACKEND, không lộ cho user): **Partner ID** + **Partner Key**.
- Khai **Redirect/Callback URL**: `https://api.dandpakpos.io.vn/auth/shopee/callback`
  (và URL webhook push: `https://api.dandpakpos.io.vn/webhooks/shopee`).

## Base URL
- Production: `https://partner.shopeemobile.com`
- Sandbox: `https://partner.test-stable.shopeemobile.com`

## Ký (signing) — HMAC-SHA256 hex, tham số `sign`
- Public API (auth/token): `base = partner_id + path + timestamp`
- Shop API (order/logistics/product): `base = partner_id + path + timestamp + access_token + shop_id`
- `sign = HMAC_SHA256(base, partner_key)` → hex. `timestamp` = giây.
- (Đã implement đúng trong `shopeeConnector.js`: `signPublic`, `signShop`.)

## Authorization (OAuth)
1. Tạo URL uỷ quyền: `GET /api/v2/shop/auth_partner?partner_id&timestamp&sign&redirect`
2. Seller đăng nhập Shopee + đồng ý → Shopee redirect về `redirect` kèm `code` + `shop_id`.
3. Đổi token: `POST /api/v2/auth/token/get` body `{ code, shop_id, partner_id }`
   → `{ access_token, refresh_token, expire_in }`.
4. Làm mới: `POST /api/v2/auth/access_token/get` body `{ refresh_token, shop_id, partner_id }`.
   - access_token ~4h, refresh_token ~30 ngày (VERIFY console). Refresh token có thể **xoay vòng** → lưu lại token mới atomically.
5. Huỷ uỷ quyền (disconnect): `cancel_auth_partner` (VERIFY tên/endpoint hiện hành).

## API dùng
- Đơn: `/api/v2/order/get_order_list`, `/api/v2/order/get_order_detail`.
- Sản phẩm: `/api/v2/product/get_item_list`, `get_item_base_info`, `get_model_list`.
- Tồn kho (outbound): `/api/v2/product/update_stock` (VERIFY) — đẩy tồn Dan D Pak → Shopee.
- Giá (outbound): `/api/v2/product/update_price` (VERIFY).
- Logistics/waybill: `create_shipping_document` → `get_shipping_document_result` → `download_shipping_document` (PDF).

## Webhook / Push
- Shopee POST tới `push_url` đã khai. Header `Authorization = HMAC_SHA256(push_url + "|" + raw_body, partner_key)`.
- code=3 = cập nhật trạng thái đơn → kéo lại chi tiết đơn (idempotent).
- VERIFY danh sách push type hiện hành trong console (order status, item, logistics…).

## Rate limit
- Có giới hạn theo app/shop/endpoint. Cần backoff + jitter + throttle queue. VERIFY con số ở console.

## Trạng thái đơn (map → canonical Dan D Pak)
UNPAID→pending · READY_TO_SHIP/PROCESSED→processed · SHIPPED/TO_CONFIRM_RECEIVE→shipping
· COMPLETED→delivered · CANCELLED→cancelled · TO_RETURN→return_refund. (VERIFY tên hiện hành.)
