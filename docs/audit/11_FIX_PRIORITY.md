# 11 — FIX PRIORITY (Pass 1 + Pass 2 hợp nhất)

Xếp theo rủi ro mất tiền/dữ liệu × mức độ khai thác. KHÔNG sửa production trước khi báo cáo được xác nhận.
Cập nhật sau Pass 2 (đã đọc line-by-line: inventory.js, einvoice.js, misa.js, settings.js, shifts.js, cashDrawer.js, retail.js + Flutter payment_dialog/pos_screen/pos_provider).

## P0 — Làm ngay (mất tiền / mở cửa hệ thống)
Không có P0 tuyệt đối (không SQLi/RCE/auth-bypass toàn cục). Lõi tiền phòng thủ tốt. Các mục P1 dưới ưu tiên như P0 vận hành.

## P1 — Cao (làm trước)
| ID | Vấn đề | File | Sửa an toàn | Trạng thái |
| --- | --- | --- | --- | --- |
| BL-01 / BL-P2-01 / SEC-03 | `/inventory/:id/receive` & `/skus/:id/receive` KHÔNG guard; `receiveGeneric` không kiểm quyền → tăng tồn, set unit_cost tùy ý, sai giá vốn/báo cáo | api.js, inventory.js | Thêm `guard('inventory.adjust')` cho 2 route receive | XÁC NHẬN lỗ hổng thật (Pass 2) |
| TP-04 / SEC-P2-01 | `getIntegrations` trả secret NGUYÊN VĂN (MISA password/secretKey, payOS apiKey/checksumKey, sepay apiKey, casso/webhook secrets) cho mọi user có `settings.integrations` | settings.js, api.js | Mask khi trả UI (4 ký tự cuối + hasValue), chỉ ghi khi khác placeholder, owner-only cho field secret | Nâng lên P1 (Pass 2) |
| TP-02 | Webhook VietQR/Online nhận khi thiếu xác thực → đóng bill/nhận đơn giả | payments.js, online.js | Fail-closed: enabled mà thiếu secret → 400/401 | Pass 1 |
| TP-01 | So sánh secret không constant-time (SePay/Casso/VietQR) | payments.js | `crypto.timingSafeEqual` | Pass 1 |
| BL-02 / BL-06 | Discount toàn đơn không trần → hạ tổng về 0 (chỉ cần perm discount, không PIN self ở pay) | payments.js payOrder | Trần %/số tiền + PIN self + audit khi vượt ngưỡng | Pass 1 |
| BL-03 | Manual-confirm không gắn bank_tx → đóng bill "đã CK" giả | api.js applyManualConfirm | Báo cáo cuối ca liệt kê + duyệt; ngưỡng cần PIN Manager | Pass 1 |
| SEC-02 | Route ghi public (orders/calls/qr/customer-invoice) | api.js | Kiosk/device token cho iPad + rate-limit IP | Pass 1 |
| SEC-01 | CORS mở khi không production | cors.js/env.js | Buộc NODE_ENV=production + CORS_ORIGIN ở deployment thật | Pass 1 |

## P2 — Trung bình
| ID | Vấn đề | File | Sửa |
| --- | --- | --- | --- |
| BL-P2-02 | Kho bếp bán âm tồn (allowNegative) tính unit_cost=0 → méo giá vốn/tồn bếp kéo dài | inventory.js deductForOrder | Cảnh báo tồn âm bắt buộc xử lý; gán unit_cost cuối đã biết cho phần âm |
| BL-P2-04 | Refund retail KHÔNG hủy/điều chỉnh HĐĐT đã ISSUED → sai kê khai NĐ70 | retail.js refund | Khi bill đã ISSUED, đi đường cancelInvoice/HĐ điều chỉnh + PIN Manager |
| BL-P2-05 | Cột `stock` gộp vs tồn theo kho/lot lệch khi bật multi-kho; retail check tồn theo cột gộp | inventory.js, retail.js | Thống nhất nguồn tồn theo warehouse/lot cho cả kiểm bán lẫn hiển thị |
| BL-04/TP-03 | Khớp bill webhook bằng includes (trùng tiền tố) | payments.js findOpenOrderByContent | So khớp token chính xác / orderCode 1-1 |
| BL-05 | Đơn online hủy có hoàn kho chưa (retail đã OK — BL-P2-03) | online.js | Đảm bảo returnOrder cộng kho + hủy HĐĐT + audit |
| BL-07 | reset-transactions xóa audit_log | api.js | Loại audit_log khỏi danh sách xóa; snapshot trước reset |
| SEC-04 | Secret default/salt tĩnh | env.js/db.js | Fail-fast khi change-me; salt ngẫu nhiên |
| SEC-05 | allowCustomerSelfConfirm tự đóng bill | settings/payments | Giữ tắt mặc định, ẩn khỏi UI thường |
| SEC-06 / SEC-P2-03 | DMS/avatar + cash_drawer invoice_image (7.5MB base64) tin MIME client | api.js, cashDrawer.js | Verify magic bytes; validate data:image/ + kích thước; attachment cho non-image |
| SEC-08 | decrypt-audit cho settings.manage | api.js | Owner-only + audit người giải mã |

## P3 — Thấp (backlog)
| ID | Vấn đề | Sửa |
| --- | --- | --- |
| BL-P2-08 | Job HĐĐT kẹt trạng thái SENDING nếu process crash giữa chừng (không có reaper timeout) | Reaper đưa SENDING quá hạn → RETRYING |
| BL-P2-09 | shiftReport gom transfer/pos bằng key cứng lệch canonical (bank/visa) → phân loại báo cáo sai | Đồng bộ danh sách với canonical keys |
| SEC-07 | Không có CSP | Bật CSP report-only sau module hóa inline |
| SEC-09 | /health lộ thông tin hệ thống | Rút gọn field ở production |
| SEC-11 | verifyManagerOwnerPin quét 200 scrypt | Giới hạn/cache |
| SEC-P2-02 | misa.js auth lại mỗi call | Cache token theo TTL (đánh đổi, không gấp) |
| TP-05 | payOS URL hardcode | Đưa vào config |
| TP-06 | QR render qua bên thứ ba | Render local |
| BL-08 | Xóa vật lý cấu hình | Chuyển append-only |
| SEC-P2-05 (movement) | stock_movements thiếu actor_id trực tiếp (truy vết qua audit_log) | Thêm cột actor vào movement nếu cần đối soát nhanh |

## Kiến trúc (song song, không chặn fix)
Xem file 10 — quick wins (guard receive, timingSafeEqual, fail-closed, trần discount, mask secret, giữ audit_log, validateEnv) làm trước, độc lập refactor lớn.

## Nguyên tắc thực thi
1. Mỗi fix: PR nhỏ + test đối chiếu + cập nhật changelog + ghi vùng dữ liệu bị chạm.
2. Không đụng permanent-storage/.env/DB/backups.
3. Fix vùng tiền (payments/inventory) cần double-review + test A1–A12 (file 09) trước merge.

## Số finding tổng (Pass 1 + Pass 2)
- P0: 0
- P1: 8 (BL-01/BL-P2-01, TP-04/SEC-P2-01, TP-02, TP-01, BL-02, BL-03, SEC-02, SEC-01)
- P2: 10 · P3: 10 · OK ghi nhận: 31 (13 security + 18 business)


---
# FIX PRIORITY — FINAL (Pass 1 + 2 + 3 hợp nhất)

Cập nhật sau Pass 3 (đọc line-by-line: online.js, vouchers.js, invoices.js, reports.js, reportCenter.js, bookMenu.js + web/ frontend + xác minh bill_no atomic).

## P0 — Làm ngay
Không có P0 tuyệt đối (không SQLi/RCE/auth-bypass toàn cục, lõi tiền phòng thủ tốt). Các P1 dưới ưu tiên như P0 vận hành trước khi go-live thật.

## P1 — Cao (làm trước khi chạy thật)
| ID | Vấn đề | File | Sửa an toàn |
| --- | --- | --- | --- |
| BL-P3-01 / TP-P3-01 | Webhook online KHÔNG idempotent — trùng `online_ref` tạo đơn mới → **double trừ kho + double doanh thu** khi Grab/Shopee/Website retry | online.js `receive` | Dedup theo online_ref trước khi tạo; UNIQUE `(branch_id, online_channel, online_ref)`; retry trả đơn cũ |
| BL-P3-02 | `returnOrder` chỉ set void — KHÔNG hoàn kho, KHÔNG hủy HĐĐT, KHÔNG đảo payment → hụt kho + lệch đối soát online | online.js `returnOrder` | Hoàn kho từng dòng + hủy HĐĐT (PIN Manager) + đảo payment, trong 1 transaction |
| TP-P3-03 / TP-02 | Webhook online fail-OPEN khi chưa cấu hình secret (route public) + so chuỗi không constant-time | online.js, payments.js | Fail-closed (enabled thiếu secret → 401); `timingSafeEqual`; rate-limit IP |
| BL-01 / BL-P2-01 / SEC-03 | `/inventory/:id/receive` & `/skus/:id/receive` KHÔNG guard; `receiveGeneric` không kiểm quyền → tăng tồn, set unit_cost tùy ý | api.js, inventory.js | Thêm `guard('inventory.adjust')` cho 2 route receive |
| TP-04 / SEC-P2-01 | `getIntegrations` trả secret NGUYÊN VĂN (MISA password/secretKey, payOS apiKey/checksumKey, sepay apiKey, các webhookSecret) cho mọi user có `settings.integrations`; admin.html render thẳng vào input value | settings.js, api.js, web/admin.html | Mask khi trả UI (4 ký tự cuối + hasValue), chỉ ghi khi khác placeholder, owner-only field secret |
| TP-01 | So sánh secret không constant-time (SePay/Casso/VietQR/Online) | payments.js, online.js | `crypto.timingSafeEqual` |
| BL-02 / BL-06 | Discount toàn đơn không trần → hạ tổng về 0 (chỉ cần perm discount, không PIN self ở pay) | payments.js `payOrder` | Trần %/số tiền + PIN self + audit khi vượt ngưỡng |
| BL-03 | Manual-confirm không gắn bank_tx → đóng bill "đã CK" giả | api.js `applyManualConfirm` | Báo cáo cuối ca liệt kê + duyệt; ngưỡng cần PIN Manager |
| SEC-02 | Route ghi public (orders/calls/qr/customer-invoice/online-webhook) | api.js | Kiosk/device token cho iPad + rate-limit IP |
| SEC-01 | CORS mở khi không production | cors.js/env.js | Buộc NODE_ENV=production + CORS_ORIGIN ở deployment thật |

## P2 — Trung bình
| ID | Vấn đề | File | Sửa |
| --- | --- | --- | --- |
| BL-P3-03 | Voucher không có `max_uses`/single-use/redemption → dùng lại vô hạn | vouchers.js, db.js | `max_uses` + bảng `voucher_redemptions(voucher_id, order_id UNIQUE)`; kiểm trong transaction đóng bill |
| BL-P3-04 | `invoices.nextInvoiceNo` COUNT-based, không atomic, không UNIQUE invoice_no (nhánh local/mock) | invoices.js, db.js | Sequence atomic per-ký-hiệu + `UNIQUE(branch_id, invoice_no)` + transaction |
| BL-P3-05 | Báo cáo không chặn span thời gian → nạp toàn bộ dòng vào RAM (DoS) | reportCenter.js | Giới hạn span (≤366 ngày) / phân trang / trần số dòng cho export |
| SEC-P3-01 | `bookMenu.importPubhtml5` SSRF — server fetch URL tùy ý | bookMenu.js | Allowlist host + chặn IP private/loopback/metadata + giới hạn size |
| BL-P2-02 | Kho bếp bán âm tồn (allowNegative) unit_cost=0 → méo giá vốn | inventory.js `deductForOrder` | Cảnh báo tồn âm; gán unit_cost cuối đã biết |
| BL-P2-04 | Refund retail KHÔNG hủy HĐĐT đã ISSUED → sai kê khai NĐ70 | retail.js refund | Đi đường cancelInvoice/HĐ điều chỉnh + PIN Manager |
| BL-P2-05 | Cột `stock` gộp vs tồn theo kho/lot lệch khi multi-kho | inventory.js, retail.js | Thống nhất nguồn tồn theo warehouse/lot |
| BL-04/TP-03 | Khớp bill webhook bằng includes (trùng tiền tố) | payments.js | So khớp token chính xác / orderCode 1-1 |
| BL-07 | reset-transactions xóa audit_log | api.js | Loại audit_log khỏi danh sách xóa; snapshot trước reset |
| SEC-04 | Secret default/salt tĩnh | env.js/db.js | Fail-fast khi change-me; salt ngẫu nhiên |
| SEC-05 | allowCustomerSelfConfirm tự đóng bill | settings/payments | Giữ tắt mặc định, ẩn khỏi UI thường |
| SEC-06 / SEC-P2-03 | DMS/avatar + cash_drawer invoice_image tin MIME client | api.js, cashDrawer.js | Verify magic bytes; validate data:image/ + size |
| SEC-08 | decrypt-audit cho settings.manage | api.js | Owner-only + audit người giải mã |
| SEC-15 | ipad_staff_pin plaintext + default '0000' + unlock không rate-limit | settings.js, api.js | Hash PIN + rate-limit + bỏ default |

## P3 — Thấp (backlog)
| ID | Vấn đề | Sửa |
| --- | --- | --- |
| BL-P2-08 | Job HĐĐT kẹt SENDING nếu crash | Reaper timeout → RETRYING |
| BL-P2-09 | shiftReport gom transfer/pos key cứng lệch canonical | Đồng bộ canonical keys |
| SEC-07 | Không có CSP | CSP report-only sau module hóa inline |
| SEC-09 | /health lộ thông tin | Rút gọn field ở production |
| SEC-11 | verifyManagerOwnerPin quét 200 scrypt | Giới hạn/cache |
| SEC-P2-02 | misa.js auth lại mỗi call | Cache token theo TTL |
| TP-05 | payOS URL hardcode | Đưa vào config |
| TP-06 | QR render qua bên thứ ba | Render local |
| BL-08 | Xóa vật lý cấu hình | Chuyển append-only |
| MOV-01 | stock_movements thiếu actor_id trực tiếp | Thêm cột actor nếu cần đối soát nhanh |

## Số finding tổng — FINAL (Pass 1 + 2 + 3)
- **P0: 0**
- **P1: 10** — BL-P3-01/TP-P3-01, BL-P3-02, TP-P3-03/TP-02, BL-01, TP-04/SEC-P2-01, TP-01, BL-02, BL-03, SEC-02, SEC-01
- **P2: 14** — BL-P3-03, BL-P3-04, BL-P3-05, SEC-P3-01, BL-P2-02, BL-P2-04, BL-P2-05, BL-04/TP-03, BL-07, SEC-04, SEC-05, SEC-06/SEC-P2-03, SEC-08, SEC-15
- **P3: 10**

---
# PASS 4 - RECHECK PRIORITY DELTA

No P0 added. P1 list remains open in current code.

## Still P1 After Re-check

| ID | Current evidence | Minimal next patch |
| --- | --- | --- |
| BL-P3-01 / TP-P3-01 | `online.receive()` creates a new order for every webhook and DB has no unique online ref index | Dedup by `(branch_id, online_channel, online_ref)` and add UNIQUE index |
| BL-P3-02 | `online.returnOrder()` only sets `status='void'` | Reverse stock, payment, and e-invoice state in one transaction |
| BL-01 / SEC-03 | `api.js:911` and `api.js:924` receive routes have no `guard('inventory.adjust')` | Add the same guard used by adjust/warehouse receive |
| TP-04 / SEC-P2-01 | `getIntegrations()` returns full config; UI renders secrets into inputs | Mask secret response and preserve old value when mask placeholder is posted |
| TP-01 / TP-02 | Online/VietQR/SePay/Casso auth is not consistently fail-closed/constant-time | Shared `safeEqual()` and reject enabled channels missing secrets |

## Ponytail Cleanup Priority

1. Move runtime data out of source tree: `server/permanent-storage` is about 228MB.
2. Delete/ignore generated `scratch/` output and root screenshots.
3. Remove dead `notImplemented()` route stubs and unused adapter scaffolds until they are actually wired.
4. Reuse `dandpak_core` in backoffice instead of maintaining a second HTTP client.
- **OK ghi nhận: 36** (13 security + 23 business/PASS gồm bill_no atomic, online fail-closed mapping, report permission/scope)
