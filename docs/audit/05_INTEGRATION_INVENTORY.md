# 05 — INTEGRATION INVENTORY (bên thứ ba)

Cấu hình lưu trong `app_settings` → `getIntegrations(branch)` (settings.js). Bảo vệ bằng PIN Manager/Owner khi ghi (`POST /settings/integrations`).

## Thanh toán / QR
| Kênh | Vai trò | Webhook | Xác thực | File |
| --- | --- | --- | --- | --- |
| VietQR (api.vietqr.org / img.vietqr.io) | Sinh QR (public image / API token) + transaction-sync callback | `/api/vietqr/webhook` | Basic Auth (username:password) nếu gửi kèm | payments.js `handleVietqrWebhook`, `getVietQrToken` |
| SePay | Đọc biến động số dư → auto-confirm | `/api/sepay/webhook` | `Authorization: Apikey <apiKey>` | payments.js `handleSepayWebhook` |
| Casso | Đọc biến động số dư → auto-confirm | `/api/casso/webhook` | header `secure-token` = webhookSecret | payments.js `handleCassoWebhook` |
| payOS | Tạo link/QR theo bill + poll trạng thái | `/api/payos/webhook` | **HMAC-SHA256** Checksum Key (timingSafeEqual) + verify signData khi tạo link | payments.js `handlePayosWebhook`, `payosVerifySignature`, `createPayosPaymentLink`, `getPayosPaymentStatus` |

- Chuẩn hoá nội dung CK: prefix `DANBILL` + bill_no (`paymentReferenceForOrder`), stripVietnamese + [A-Z0-9] tối đa 23 ký tự.
- Idempotency: `bank_transactions` UNIQUE(provider, external_id) + kiểm tra dup trước khi xử lý (`processIncomingCredit`).
- Khớp bill: `findOpenOrderByContent` (query 500 order mở, so DANBILL trong nội dung).
- Under/over-pay: amount < total → status `underpaid` (KHÔNG đóng bill). Đủ tiền → `payOrder` tự đóng.

## Online (giao đồ ăn / web)
| Kênh | integrationKey | File |
| --- | --- | --- |
| GrabFood/GrabMerchant, ShopeeFood, BeFood, GrabMart, Website | grabmerchant/shopeefood/befood/grabmart/website | online.js `receive`, `CHANNELS`, `assertWebhookSecret` |
- Webhook `/api/online/webhook` (public). Xác thực: `webhookSecret` nếu cấu hình (x-webhook-secret / secure-token / Bearer/Apikey). **Chưa cấu hình secret → vẫn nhận nhưng ghi audit `online.webhook.unverified`** (xem file 08 TP-02).
- Đơn online coi là **prepaid** → tự trừ kho (`deductForOrder`). Xem file 07 (BL-05).

## Hóa đơn điện tử
| Kênh | Vai trò | File |
| --- | --- | --- |
| MISA | Phát hành HĐĐT (test connection + issue), tuân thủ NĐ 70/2025 | misa.js, einvoice.js, invoices.js |
- Bật MISA → backfill HĐ PENDING_PROVIDER (`requeuePendingProvider`).
- Worker `processInvoiceQueue()` mỗi 10s (index.js) — issue + retry.

## Phần cứng cửa hàng
| Loại | Cơ chế | File |
| --- | --- | --- |
| Máy in nhiệt/bếp/bar/tem | ESC/POS LAN (IP:9100), OS driver, browser print | printing.js |
| Ngăn kéo tiền | Xung ESC/POS qua máy in bill | printing.js `openCashDrawer` |
| POS thẻ VCB SmartPOS | cardTerminal auto/manual/mock (web/shared/cardTerminal.js); native bridge ở android-pos (scaffold) | payments.js `sanitizeCardMeta` |

## Tra cứu bên ngoài
- Tra MST doanh nghiệp: `Customers.lookupTaxCode` (public `/api/public/tax-lookup/:mst` + `/api/customers/lookup/tax/:mst`).
- Import sản phẩm: `server/scripts/import-{kiotviet,bcm}-products.js`, `download-cdn-images.js` (offline scripts).

## Secret / credential
- Lưu trong `app_settings` (DB) qua Integrations; đọc backend-only qua `getIntegrations`.
- Env secret: `JWT_SECRET`, `SESSION_SECRET`, `AUDIT_LOG_KEY`, `DANDPAK_ADMIN_RESET_PIN`, `CONFIG_SEED_URL`.
- `.env.example` để `change-me` cho JWT/SESSION/POSTGRES_PASSWORD — cảnh báo phải đổi khi production (env.js validateEnv chỉ cảnh báo CORS/DATABASE_URL/STORAGE_PATH). Xem file 06 SEC-04.

> Cần kiểm tra thủ công thêm: misa.js, settings.js (getIntegrations trả field gì ra client — nguy cơ lộ secret?), cardTerminal.js, android-pos bridge.
