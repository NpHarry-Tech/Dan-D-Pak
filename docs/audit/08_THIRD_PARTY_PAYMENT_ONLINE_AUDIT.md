# 08 — THIRD-PARTY / PAYMENT / ONLINE AUDIT

Trọng tâm đối soát: mất tiền, đóng bill giả, double-credit, lộ token, sai đối soát.

## Ma trận xác thực webhook

| Webhook | Route | Xác thực | Idempotency | Đánh giá |
| --- | --- | --- | --- | --- |
| payOS | /api/payos/webhook | HMAC-SHA256 Checksum Key, `timingSafeEqual` | bank_transactions UNIQUE(provider,external_id) | **Mạnh** |
| SePay | /api/sepay/webhook | `Authorization: Apikey <key>` so sánh chuỗi | như trên | Khá (so sánh không constant-time) |
| Casso | /api/casso/webhook | header `secure-token`/`x-casso-signature` = webhookSecret | như trên | Khá (so chuỗi thường) |
| VietQR | /api/vietqr/webhook | Basic Auth username:password nếu gửi kèm | như trên | Trung bình (chỉ verify NẾU header tồn tại) |
| Online (Grab/Shopee/Be/Web) | /api/online/webhook | webhookSecret NẾU cấu hình; chưa có → **vẫn nhận** | order theo online_ref | Yếu khi chưa cấu hình secret |

## Findings

### TP-01 (P1) SePay/Casso/VietQR so sánh secret KHÔNG constant-time
`payments.js`: `provided !== cleanText(cfg.apiKey)` / `token !== webhookSecret` / `decoded !== user:pass`. So sánh `!==` chuỗi → timing side-channel (rủi ro thấp qua mạng, nhưng payOS đã đúng chuẩn `timingSafeEqual` → nên đồng bộ).
- Sửa: dùng `crypto.timingSafeEqual` cho cả 3.

### TP-02 (P1) Webhook VietQR & Online chỉ verify khi header/secret tồn tại
- `handleVietqrWebhook`: chỉ verify Basic Auth `if (/^basic/.test(auth))` — request KHÔNG gửi header auth thì **bỏ qua verify** và xử lý credit. Kẻ tấn công trong mạng có thể POST giả "tiền về" khớp DANBILL → auto-đóng bill (mất hàng, không mất tiền vào tài khoản kẻ gian nhưng cửa hàng giao hàng miễn phí).
- `online.js assertWebhookSecret`: chưa cấu hình secret → nhận đơn không xác thực (chỉ audit cảnh báo).
- Sửa an toàn: nếu kênh enabled mà thiếu secret cấu hình → **từ chối** (fail-closed) thay vì nhận; VietQR bắt buộc Basic Auth khi enabled.

### TP-03 (P2) Khớp bill bằng `includes` (trùng tiền tố) — xem BL-04
Auto-confirm SePay/Casso/VietQR khớp nội dung bằng substring → nguy cơ đóng nhầm bill. payOS an toàn hơn nhờ orderCode 1-1 (`recordBankTx link:orderCode`).

### TP-04 (P2) `getIntegrations` có thể lộ secret ra client?
`/api/settings/integrations` (guardAny settings.integrations) trả cấu hình kênh. Cần xác nhận `getIntegrations` có mask apiKey/checksumKey/password trước khi trả ra UI không. **Cần kiểm tra thủ công settings.js** — nếu trả nguyên secret → lộ token cho mọi user có quyền settings.integrations (không chỉ owner).
- Sửa nếu đúng: mask khi trả client (chỉ trả `configured: true`).

### TP-05 (P2) URL fallback payOS hardcode domain sản xuất
`createPayosPaymentLink`: returnUrl/cancelUrl mặc định `https://dan-d-pak.onrender.com/pay/{success,cancel}`. Domain cụ thể lộ trong source; nếu domain bị chiếm dụng → redirect khách. Rủi ro thấp.
- Sửa: đưa vào config, không hardcode.

### TP-06 (P3) Ảnh QR public qua bên thứ ba
`emvQrImage` render QR qua `api.qrserver.com`; `publicVietQrImage` qua `img.vietqr.io`. Nội dung (số tiền, số tài khoản, nội dung CK) gửi sang dịch vụ ngoài → lộ metadata giao dịch. Chấp nhận được nhưng ghi nhận (ưu tiên render QR local nếu có thư viện).

## Đối soát & mất tiền — điểm rủi ro tổng hợp
1. **Manual-confirm không gắn bank_tx** (BL-03): thu ngân đóng bill "đã CK" mà tiền không về. → cần báo cáo cuối ca liệt kê + duyệt.
2. **Webhook giả** (TP-02): đóng bill không cần tiền thật nếu kênh thiếu xác thực. → fail-closed.
3. **Discount không trần** (BL-02): hạ tổng hợp lệ. → trần + audit.
4. **allowCustomerSelfConfirm** (SEC-05): khách tự đóng bill. → giữ tắt.
5. **Under/over-pay**: underpaid xử lý đúng (không đóng). Over-pay → change tính đúng trong buildReceipt. OK.

## Điểm đối soát TỐT (giữ)
- `bank_transactions` lưu mọi credit (paid/unmatched/underpaid/error/duplicate/claimed) → `listBankTransactions` cho màn đối soát.
- `markBankTxClaimed` đóng vòng đối soát khi gắn tx vào bill.
- `payment_lines` lưu card_txn/rrn/approval/mask → đối soát sao kê acquirer.
- Audit đầy đủ: `payment.done/auto_confirmed/manual_confirm/webhook.rejected/bank_tx_claimed`.

> Cần kiểm tra thủ công thêm: `settings.js getIntegrations` (masking secret), `misa.js` (lưu/log credential), `einvoice.js` (retry có double-issue không), luồng hoàn kho online return.


---
## Pass 3 — Online channel (đọc line-by-line online.js)

### TP-P3-01 (P1) Đơn ngoài KHÔNG idempotent — trùng `online_ref` tạo đơn mới → double kho + double doanh thu
`online.js receive()`: không dedup theo `online_ref` trước khi tạo order; không UNIQUE `(branch_id, online_channel, online_ref)`. Webhook Grab/Shopee/Website retry → đơn thứ 2, trừ kho + ghi doanh thu lần 2. Chi tiết & cách sửa: **BL-P3-01** (file 07).
- Đối chiếu nhánh bank: đã idempotent qua `bank_transactions UNIQUE(provider,external_id)`. Nhánh online thiếu hẳn cơ chế tương đương.

### TP-P3-02 (P1) Cập nhật cột "Idempotency" của ma trận cho Online
Dòng Online trong ma trận trên ghi "order theo online_ref" là **KHÔNG chính xác** — thực tế KHÔNG có ràng buộc unique/dedup nào theo online_ref. Đọc lại: mỗi webhook = 1 order mới. Sửa đánh giá thành: **Yếu (fail-open secret) + KHÔNG idempotent**.

### TP-P3-03 (xác nhận TP-02) Webhook online fail-OPEN khi chưa cấu hình secret
`online.js assertWebhookSecret`: nếu `webhookSecret` rỗng → chỉ ghi `audit('online.webhook.unverified')` rồi **vẫn nhận đơn**. Khi có secret thì so `provided !== secret` (không constant-time, cùng họ TP-01). Route `POST /online/webhook` là PUBLIC (không guard) + dùng `visibleBranch`.
- Kết hợp với TP-P3-01 (không dedup): kẻ biết endpoint có thể **bơm đơn online giả** khi kênh chưa đặt secret → tạo đơn paid, trừ kho, in bếp, đẩy doanh thu ảo.
- Sửa: fail-closed (kênh enabled mà thiếu secret → 400/401); `timingSafeEqual`; cân nhắc rate-limit theo IP cho route webhook public.

### Cancel đơn ngoài KHÔNG sync ngược POS (kho/HĐĐT/đối soát)
`returnOrder` chỉ set `status='void'`. Xem **BL-P3-02** (file 07) — P1: không hoàn kho, không hủy HĐĐT, không đảo payment_lines online → lệch kho thật + lệch đối soát cổng online.

## Ma trận webhook — cập nhật dòng Online (Pass 3)

| Webhook | Xác thực | Idempotency | Đánh giá (Pass 3) |
| --- | --- | --- | --- |
| Online (Grab/Shopee/Be/Web) | webhookSecret NẾU cấu hình; chưa có → **vẫn nhận** (fail-open); so chuỗi không constant-time | **KHÔNG** (mỗi webhook = order mới, không dedup online_ref) | **Yếu** — cần fail-closed + dedup online_ref + timingSafeEqual |
