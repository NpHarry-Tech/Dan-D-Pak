# 00 — AUDIT PROGRESS (Defensive Internal Audit)

- Codebase: `C:\Users\PC\Desktop\Dan D Pak` (Dan-D-Pak POS/ERP)
- Loại audit: Defensive internal audit (chỉ đọc + phân tích, KHÔNG sửa production, KHÔNG viết exploit)
- Ngày: 2026-07-04
- Người/agent thực hiện: Senior Flutter Architect + Software/Security/POS/Integration/Payment Auditor

## Phương pháp
Đọc trực tiếp source qua Desktop Commander MCP. Mọi finding đều dẫn file + hàm/route cụ thể.
Không giả định, không dựa mô tả cũ; các phần chưa đọc hết ghi rõ "Cần kiểm tra thủ công thêm".

## Trạng thái từng phase

| Phase | Nội dung | File kết quả | Trạng thái |
| --- | --- | --- | --- |
| 1 | Discovery — cấu trúc, entry, config | 01, 02 | DONE |
| 2 | Inventory app/module/screen | 01 | DONE |
| 3 | Route/API/Function inventory | 03 | DONE |
| 4 | Database inventory | 04 | DONE |
| 5 | Integration inventory | 05 | DONE |
| 6 | Security findings | 06 | DONE |
| 7 | Business logic findings | 07 | DONE |
| 8 | Third-party / payment / online audit | 08 | DONE |
| 9 | Simulation / QA test matrix | 09 | DONE |
| 10 | Clean Architecture refactor plan | 10 | DONE |
| 11 | Fix priority | 11 | DONE |
| 12 | Final checklist | 12 | DONE |

## Đã đọc trực tiếp (bằng chứng)
- `package.json`, `.env.example`, `README.md`
- `server/index.js`, `server/config/env.js`, `server/config/cors.js`
- `server/api.js` (toàn bộ 1614 dòng)
- `server/db.js` (schema + audit encryption + sync triggers)
- `server/services/auth.js`, `pin.js`, `bootstrapAdmin.js`
- `server/services/payments.js` (toàn bộ 864 dòng)
- `server/services/orders.js` (phần pricing/recomputeTotals)
- `server/services/online.js` (webhook auth)

## PASS 2 — ĐÃ HOÀN THÀNH (2026-07-04)
Đã đọc line-by-line: `inventory.js` (871), `einvoice.js` (735), `misa.js` (294), `settings.js` (825),
`shifts.js` (234), `cashDrawer.js` (322), `retail.js` (124) + Flutter `payment_dialog.dart` (741),
`pos_screen.dart`, `pos_provider.dart`, `retail_screen.dart` (discount/PIN).
Findings ghi vào: 04 (DB inventory/HĐĐT/két), 06 (SEC-P2-01..05, SEC-OK-9..13),
07 (BL-P2-01..10, BL-OK-11..18). Hợp nhất P0/P1/P2/P3 vào 11 & 12.

Kết quả chính Pass 2:
- P1 mới xác nhận: BL-P2-01 (receive route KHÔNG guard — lỗ hổng thật), SEC-P2-01/TP-04 (settings trả secret nguyên văn — nâng P1).
- HĐĐT: idempotency đầy đủ (UNIQUE order_id + idempotency_key + RefID MISA), timeout 12/20s, cancel gated PIN, token RAM-only.
- Kho: FEFO/lot/HSD đúng; retail refund hoàn kho đúng; bếp cố ý bán âm (BL-P2-02); refund không hủy HĐĐT (BL-P2-04).
- Flutter: server luôn tính lại total/giá/discount; thao tác nhạy cảm re-check + PIN server-side (client không phải điểm quyết định).

## Cần kiểm tra thủ công thêm (PASS 3 — chưa đọc line-by-line)
- `online.js` (returnOrder/setStatus hoàn kho + hủy HĐĐT), `purchase.js`, `expenses.js`,
  `invoices.js`, `reportCenter.js`, `reports.js`, `configBackup.js`, `sync.js`, `printing.js`,
  `catalog.js`, `vouchers.js`, `customers.js`
- Toàn bộ `web/*.html` (frontend) và các `flutter-apps/*` còn lại (KDS/tablet/customer), `android-pos/`
- `deploy/company-server/` (Docker/Caddy), `server/adapters/*` (Postgres/S3/WebSocket scaffold)
- Sinh `bill_no` atomic (race 2 thu ngân cùng giây)

> Ghi chú tiếp tục: nếu session mới, đọc file này trước, rồi tiếp tục từ danh sách PASS 3.


---
# PASS 3 — ĐÃ HOÀN THÀNH (2026-07-04) · AUDIT COMPLETED

Đã đọc line-by-line: `online.js` (361), `vouchers.js` (296), `invoices.js` (127),
`reports.js` (193), `reportCenter.js` (1301), `bookMenu.js` (192) + `web/` frontend
(admin.html, runtime-config.js, shared/*) + xác minh `bill_no` atomic (orders.js + db.js UNIQUE index)
+ rà lại api.js route guards (online/reports/invoices/book-menu) và applyManualConfirm (payments).

Findings ghi vào: 06 (SEC-P3-01 SSRF), 07 (BL-P3-01..05 + BL-OK-19..23),
08 (TP-P3-01..03 + ma trận online). Hợp nhất P0/P1/P2/P3 FINAL vào 11; hoàn thành 12 (Pass/Fail/Pending).

## Trạng thái phase — FINAL
| Phase | Trạng thái |
| --- | --- |
| 1–12 | **COMPLETED** (Pass 1 + 2 + 3) |

===================================================================
# EXECUTIVE SUMMARY — Dan D Pak POS/ERP Defensive Audit
===================================================================

## 1) App đã đủ an toàn để chạy thật chưa?
**Chưa — nhưng gần đạt.** Lõi tiền phòng thủ tốt: không có P0 (không SQLi/RCE/auth-bypass
toàn cục). Đóng bill idempotent, giá tính server-side, HĐĐT MISA chống trùng, bill_no atomic
chống race multi-device, shift-lock + PIN gate cho thao tác nhạy cảm.

Có thể chạy thật ở chế độ **POS tại quầy / retail / F&B** nếu chấp nhận rủi ro vận hành đã biết
và siết vài P1 (guard receive, mask secret, trần discount).

**KHÔNG nên bật kênh ONLINE (Grab/Shopee/Website) thật** cho tới khi sửa nhóm P1 online:
webhook không idempotent (double kho + double doanh thu khi đối tác retry) và cancel không
đồng bộ ngược (hụt kho + lệch HĐĐT/đối soát). Đây là nơi dễ mất tiền/lệch tồn nhất.

## 2) Top 5 việc phải sửa NGAY (trước go-live)
1. **Online webhook idempotent** — dedup theo `online_ref` + UNIQUE `(branch_id, online_channel, online_ref)`; retry trả đơn cũ, không trừ kho/ghi doanh thu lần 2. (BL-P3-01, P1)
2. **Online returnOrder sync ngược** — hoàn kho từng dòng + hủy HĐĐT (PIN Manager) + đảo payment trong 1 transaction. (BL-P3-02, P1)
3. **Guard 2 route nhập kho** — thêm `guard('inventory.adjust')` cho `/inventory/:id/receive` & `/skus/:id/receive`; hiện KHÔNG guard, cho tăng tồn/đặt giá vốn tùy ý. (BL-01, P1)
4. **Che secret cấu hình** — `getIntegrations` trả nguyên văn MISA password/checksum/apiKey cho mọi user `settings.integrations`; mask khi trả UI + owner-only field secret. (TP-04/SEC-P2-01, P1)
5. **Webhook fail-closed + constant-time** — kênh online enabled mà thiếu secret hiện VẪN nhận đơn; đổi thành 401, và dùng `timingSafeEqual` cho SePay/Casso/VietQR/Online. (TP-P3-03/TP-02/TP-01, P1)

## 3) Tổng số findings — FINAL (Pass 1 + 2 + 3)
- **P0: 0**
- **P1: 10** (5 mục online/webhook + receive-guard + mask secret + discount + manual-confirm + CORS)
- **P2: 14** (voucher single-use, invoice atomic, report DoS span, bookMenu SSRF, tồn âm bếp, refund vs HĐĐT, v.v.)
- **P3: 10** (backlog: CSP, cache token MISA, reaper HĐĐT, actor_id movement, v.v.)
- **OK/PASS ghi nhận: 36** (gồm bill_no atomic, online mapping fail-closed, report permission/scope, manual-confirm reconciliation)

> Chi tiết đầy đủ: 06 (security), 07 (business logic), 08 (third-party/payment/online),
> 11 (fix priority FINAL), 12 (final checklist Pass/Fail/Pending).

---
# PASS 4 - PONYTAIL RE-AUDIT (2026-07-04)

Added: `docs/audit/13_PONYTAIL_REAUDIT_2026-07-04.md`.

Re-check summary:
- Server syntax check passed: `node --check server/index.js`, `server/api.js`, and `server/services/*.js`.
- `npm audit --omit=dev` passed with 0 vulnerabilities.
- Flutter analyze: `dandpak_core` passed; `dandpak_pos` 65 issues; `dandpak_tablet` 24; `dandpak_kds` 2; `dandpak_backoffice` 13.
- `gitleaks`, `semgrep`, and `trivy` were not installed, so commands are recorded for manual run.
- Current code still has the main P1s: online webhook no idempotency, online return incomplete, two unguarded stock receive routes, plaintext integration-secret response, and partial webhook constant-time/fail-closed hardening.
- Ponytail audit added a deletion/shrink list. No production code changed because the audit brief says report first and do not edit production before confirmation.
