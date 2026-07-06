
## P1 — Cao (Pass 2)

### SEC-13 (P1) `GET /settings/integrations` trả TOÀN BỘ secret plaintext — KHÔNG mask (xác nhận TP-04)
`settings.js getIntegrations()` + `api.js` route `guardAny('settings.integrations')`:
- Trả nguyên văn: MISA `password` + `secretKey`, payOS `apiKey` + `checksumKey`, SePay `apiKey`, Casso `webhookSecret`, Grab/Shopee/Be/Website `clientSecret` + `webhookSecret` + `apiKey`.
- Lưu plaintext trong `app_settings.integrations_config` (không mã hóa như audit_log).
- Rủi ro: bất kỳ user có `settings.integrations` (hoặc XSS/log/backup lộ JSON) lấy được key có thể GIẢ webhook đóng bill (checksumKey payOS, apiKey SePay) hoặc phát hành HĐĐT thật (MISA password).
- Sửa an toàn: response mask (`ap****ey`), chỉ ghi đè khi client gửi giá trị mới khác mask; cân nhắc mã hóa at-rest cùng cơ chế AUDIT_LOG_KEY.

### SEC-14 (P1) SEC-03/BL-01 XÁC NHẬN: `Inv.receiveStock/receiveSku` KHÔNG tự kiểm quyền
Đã đọc `inventory.js` toàn bộ (871 dòng): `receiveGeneric` không có bất kỳ check quyền/PIN nào — quyền hoàn toàn dựa vào guard tầng route. Mà `/inventory/:id/receive`, `/skus/:id/receive` (api.js) không guard + dùng `visibleBranch(req)` (chạy được cả khi CHƯA đăng nhập nếu request không có user). → Lỗ hổng thật, không phải chủ ý: nhập kho + tạo lot + set `unit_cost` tùy ý không cần quyền. Nâng BL-01 từ "cần xác nhận" thành CONFIRMED.

---
## P2 — Trung bình (Pass 2)

### SEC-15 (P2) `ipad_staff_pin` plaintext + mặc định '0000' + `/device/ipad/unlock` không rate-limit
`settings.js` DEFAULTS `ipad_staff_pin: '0000'`; `getSettings()` trả PIN plaintext cho mọi user có bất kỳ quyền settings.* (route `/settings/app` guardAny 8 quyền). `api.js /device/ipad/unlock` là route public, verify so sánh chuỗi, KHÔNG rate-limit → brute-force 10.000 tổ hợp. Sửa: rate-limit the
## Pass 2 — Findings mới / xác nhận

### SEC-P2-01 (P1) XÁC NHẬN: TP-04 — `getIntegrations` trả secret NGUYÊN VĂN ra client
`settings.js getIntegrations` + `api.js GET /settings/integrations` (guard `settings.integrations`) trả về TOÀN BỘ `channels` KHÔNG mask: `misa.password`, `misa.secretKey`, `payos.apiKey/checksumKey`, `sepay.apiKey`, `casso.webhookSecret`, `*.clientSecret`, `*.webhookSecret`. `sanitizeIntegrations`/`mergeChannel` chỉ `str()`-trim, KHÔNG che.
- Rủi ro: bất kỳ user có perm `settings.integrations` (không chỉ owner) đọc được mọi khóa API/checksum/mật khẩu MISA → giả webhook (bỏ qua HMAC), phát hành HĐ, rút tiền cổng thanh toán. Secret cũng nằm trong response cache/trình duyệt/log proxy.
- Sửa an toàn: mask khi trả UI (giữ 4 ký tự cuối + cờ `hasValue:true`); chỉ ghi giá trị mới khi client gửi field khác placeholder; cân nhắc owner-only cho các field secret.

### SEC-P2-02 (P2) `misa.js` xác thực lại mỗi call, không cache — không phải lỗ hổng nhưng tăng bề mặt
Mỗi `issueInvoice/getInvoiceStatus/cancelInvoice` gọi `authenticate()` gửi taxCode/username/password qua HTTPS. Token không lưu → không rò rỉ ở nghỉ, nhưng creds truyền lặp lại nhiều lần. Ghi nhận: token lưu RAM tạm, tốt cho bảo mật ở nghỉ; đánh đổi hiệu năng.

### SEC-P2-03 (P2) `cash_drawer_entries.invoice_image` nhận base64 tới 7.5MB không kiểm magic-byte
`cashDrawer.js createEntry`: `invoice_image = cleanText(body.invoice_image, 7_500_000)` — chấp nhận chuỗi bất kỳ (data URL) do client gửi, không sniff loại file. Cùng họ SEC-06. Lưu thẳng DB (không ghi đĩa) nên rủi ro path/exec thấp; rủi ro là nhồi dữ liệu rác/XSS nếu render inline. Sửa: validate tiền tố `data:image/` + kích thước thực.

### SEC-P2-04 (P3) Flutter POS đọc cấu hình cardTerminal (IP/port/mode) client-side để quyết định luồng
`payment_dialog.dart`: mode/terminalName/ip/port lấy từ `operationsConfig` client. Chỉ ảnh hưởng UX (manual/auto), không phải quyết định bảo mật — server vẫn ghi payment_lines độc lập. Ghi nhận, không phải lỗ hổng.

### SEC-P2-05 (giải quyết) BL-01/SEC-03 receive route — đã có guard
XÁC NHẬN qua đọc api.js: `POST /inventory/:id/receive` và `POST /skus/:id/receive` HIỆN **KHÔNG** có `guard('inventory.adjust')` (chỉ create/update/delete/adjust và `/warehouse/receive` mới có). `Inv.receiveStock/receiveSku` (inventory.js) KHÔNG kiểm quyền nội bộ. → BL-01/SEC-03 là lỗ hổng THẬT, giữ P1. Chi tiết ở 07.


---
## Pass 3 — Findings mới (online / báo cáo / bookMenu / hóa đơn / bill_no)

### SEC-P3-01 (P2) `bookMenu.importPubhtml5` — SSRF: server fetch URL tùy ý người dùng
`bookMenu.js importPubhtml5(rawUrl,...)` (route `POST /settings/book-menu/import-pubhtml5`, guard `settings.bookmenu`):
- Server gọi `fetch(configUrl)` rồi `downloadFile(pageUrl,...)` với URL **hoàn toàn do client cung cấp** (`req.body.url`). Không allowlist host, không chặn IP nội bộ/loopback/metadata.
- Rủi ro SSRF: user có quyền `settings.bookmenu` khiến server truy vấn `http://169.254.169.254/...`, `http://localhost:PORT/...`, dịch vụ nội bộ; nội dung tải về ghi vào `uploads/menu-books/<id>/` (ghi file từ nguồn remote).
- Sửa an toàn: allowlist domain PubHTML5/fliphtml5; resolve DNS và chặn dải private/loopback/link-local; giới hạn kích thước + số trang tải.
