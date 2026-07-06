# 12 — FINAL CHECKLIST (Pass 1 + Pass 2)

## Phạm vi đã hoàn thành — Pass 1
- [x] Cấu trúc gốc, package.json, .env.example, README
- [x] server/index.js + config (env, cors)
- [x] Toàn bộ api.js (1614 dòng)
- [x] db.js — schema, index, audit encryption, sync triggers
- [x] auth.js, pin.js, bootstrapAdmin.js
- [x] payments.js (864 dòng) — webhook, idempotency, đối soát
- [x] orders.js (pricing/recompute) + online.js (webhook auth)
- [x] Sơ đồ hệ thống + inventory app/module/API/DB (01–05)
- [x] Security (06), Business logic (07), Third-party/payment (08), QA matrix (09), Clean Arch (10), Fix priority (11)

## Phạm vi đã hoàn thành — Pass 2 (đọc line-by-line)
- [x] `inventory.js` (871 dòng) — receive/issue/transfer/stocktake/deductForOrder, FEFO lots, giá vốn, guard
- [x] `einvoice.js` (735 dòng) — idempotency, retry/backoff, cancel, reconciliation, shift-summary
- [x] `misa.js` (294 dòng) — auth/token, tách VAT, RefID idempotent, timeout AbortController
- [x] `settings.js` (825 dòng) — integrations/print/operations config, KIỂM masking secret
- [x] `shifts.js` (234 dòng) — mở/kết ca, reconciliation, chặn HĐĐT thiếu/lỗi
- [x] `cashDrawer.js` (322 dòng) — expense/reimbursement, balance_before/after, allocation
- [x] `retail.js` (124 dòng) — checkout atomic, refund hoàn kho
- [x] Flutter POS: `payment_dialog.dart` (741), `pos_screen.dart`, `pos_provider.dart`, retail_screen (discount/PIN)
- [x] Ghi findings vào 04, 06, 07; hợp nhất 11 & 12

## Câu hỏi Pass 2 — kết luận
1. **guard('inventory.adjust') trước điều chỉnh tồn?** — CÓ cho create/update/delete/adjust/warehouse.*; **THIẾU** cho `/inventory/:id/receive` & `/skus/:id/receive` (BL-P2-01, P1).
2. **Race 2 thiết bị bán SKU tồn cuối?** — Không bán âm SKU: retail dùng BEGIN IMMEDIATE; FnB `issueGeneric` sku strict (không allowNegative) → bill thứ 2 fail lúc pay (an toàn). Kho bếp CỐ Ý cho âm (BL-P2-02).
3. **Lot/HSD?** — FEFO đúng (expiry ASC, received ASC); `expiry_required` bắt nhập HSD khi nhập; upsertLot gộp theo lot_no.
4. **Stock movement đủ trace?** — CÓ order_id/doc_id (ref), reason, warehouse, lot, unit_cost. THIẾU actor_id trực tiếp (truy qua audit_log). Ghi nhận P3.
5. **Refund/void hoàn kho?** — Retail: CÓ (`returnSku` cộng đúng lot, chặn refund 2 lần). NHƯNG không hủy HĐĐT đã ISSUED (BL-P2-04, P2). Online: chưa đọc.
6. **HĐĐT idempotency/unique?** — CÓ: UNIQUE(order_id)+UNIQUE(idempotency_key) DB + RefID MISA + DUPLICATE_REFID → sync (không tạo trùng).
7. **Retry tạo trùng invoice?** — Không: retry cập nhật CÙNG bản ghi; MAX_ATTEMPTS 10 + backoff. Rủi ro nhỏ: kẹt SENDING nếu crash (BL-P2-08, P3).
8. **Timeout MISA?** — CÓ: AbortController 12s auth / 20s issue.
9. **Cancel sau issued?** — `cancelInvoice` chỉ cho status ISSUED, cần reason + PIN Manager, gọi MISA cancel + ghi audit.
10. **MISA token lưu ở đâu?** — RAM tạm mỗi call (authenticate mỗi lần), KHÔNG lưu DB/log. Creds đọc từ integrations_config (nhưng config trả secret nguyên văn — SEC-P2-01).
11. **Settings masking secret?** — KHÔNG mask → TP-04/SEC-P2-01 nâng P1.
12. **Shift/cash reconciliation?** — expected_cash = opening + cash_sales − expenses + reimbursements (khớp cashDrawer); kết ca chặn HĐĐT thiếu/lỗi.
13. **UI tự tính total/price gửi lên?** — Flutter gửi `amount: cartTotal` + `discount` nhưng SERVER TÍNH LẠI: `payOrder` recompute total từ order_items DB, kiểm `paid < total`; giá món lấy từ DB (BL-OK-1). Total client chỉ để hiển thị/validate cash.
14. **Thao tác nhạy cảm chỉ check client?** — Không: discount/voucher/manual-confirm/hủy món/kết ca override đều re-check + PIN server-side. Client chỉ ẩn/hiện.
15. **Discount/voucher validate server?** — CÓ: retail qua `calculateRetailDiscount` server; manual_discount clamp≥0 server; voucher cần PIN self + perm.

## CHƯA đọc line-by-line (pass sau)
- [ ] online.js (returnOrder/setStatus hoàn kho + hủy HĐĐT), purchase.js, expenses.js
- [ ] vouchers.js (min_total/scope/hết hạn/chống dùng lại), invoices.js (fallback bill cũ)
- [ ] reportCenter.js/reports.js (nguồn số), configBackup.js, sync.js, printing.js, catalog.js, customers.js
- [ ] web/*.html, còn lại flutter-apps/* (KDS/tablet/customer), android-pos/
- [ ] Sinh bill_no atomic; adapters/*, deploy/company-server/*

## Kết luận tổng quát
- Lõi tiền (payOrder, webhook, idempotency, shift-lock, PIN gate, HĐĐT chống trùng, giá server-side) **phòng thủ tốt** — không SQLi/RCE/auth-bypass toàn cục.
- Rủi ro chính: **vận hành/gian lận nội bộ + fail-open cấu hình**: BL-01 (receive không guard), TP-04 (lộ secret cấu hình), TP-02/TP-01 (webhook), BL-02/BL-03 (discount & manual-confirm), SEC-01/SEC-02 (CORS + route public), BL-P2-04 (refund vs HĐĐT).
- Kho: FEFO/lot/HSD/hoàn kho retail đúng; điểm cần siết là receive-guard, tồn âm bếp, và nhất quán tồn theo kho khi multi-kho.

## Số finding
- P0: 0 · P1: 8 · P2: 10 · P3: 10 · OK ghi nhận: 31

## Ràng buộc đã tuân thủ
- Không tạo exploit/payload. Không sửa production code. Không đụng .env/DB/permanent-storage/backups.
- Mọi finding có file + hàm/route; phần thiếu ghi rõ "Cần kiểm tra thủ công thêm".


---
# FINAL CHECKLIST — Pass 3 (AUDIT COMPLETED)

## Phạm vi đã hoàn thành — Pass 3 (đọc line-by-line)
- [x] `online.js` (361 dòng) — webhook receive/normalize, mapping, deduct, setStatus/confirm/returnOrder
- [x] `vouchers.js` (296 dòng) — scope order/sku/all_sku, buy_x_get_1, min_total, khung ngày
- [x] `invoices.js` (127 dòng) — nhánh fallback MISA/local, issue/cancel/customerRequest
- [x] `reports.js` (193 dòng) — dashboard, revenueTrends, recentAudit
- [x] `reportCenter.js` (1301 dòng) — build/export sales/kho/quỹ/công nợ/nhân viên, XLSX/PDF/HTML
- [x] `bookMenu.js` (192 dòng) — config menu quyển, import PubHTML5
- [x] `web/` frontend (admin.html, runtime-config.js, shared/*) — kiểm business logic + secret
- [x] Xác minh bill_no atomic (orders.js + UNIQUE index db.js)
- [x] api.js route guards cho online/reports/invoices/book-menu; applyManualConfirm

## Câu hỏi Pass 3 — kết luận (Pass / Fail / Pending)

| # | Câu hỏi | Kết luận |
| --- | --- | --- |
| 1 | External order duplicate (online_ref unique)? | **FAIL** — không dedup, không UNIQUE → double kho + doanh thu khi retry (BL-P3-01, P1) |
| 2 | Webhook/callback verification? | **PARTIAL/FAIL** — fail-OPEN khi chưa cấu hình secret; so chuỗi không constant-time (TP-P3-03, P1) |
| 3 | Cancel đơn ngoài sync ngược POS? | **FAIL** — `returnOrder` chỉ void; không hoàn kho/HĐĐT/payment (BL-P3-02, P1) |
| 4 | Trừ kho khi nhận đơn online? | **PASS (có kiểm soát)** — `deductForOrder` trong transaction; mapping fail-closed không trừ nhầm (BL-OK-20). Nhưng bị double do #1 |
| 5 | Tính doanh thu 2 lần? | **PASS trong-1-lần** — chỉ 1 payment/1 line; `confirmPayment` kiểm hasPayment. **FAIL do retry** (BL-P3-01) |
| 6 | Voucher dùng lại nhiều lần? | **FAIL (by design)** — không max_uses/single-use/redemption → dùng vô hạn (BL-P3-03, P2) |
| 7 | Unique redemption per order? | **FAIL** — không lưu redemption; không ràng buộc order↔voucher |
| 8 | Race 2 thiết bị cùng voucher? | **PASS (không áp dụng)** — voucher stateless, không decrement nên không có race |
| 9 | Invoice logic (invoices.js)? | **PARTIAL** — dedup theo order OK; nhưng `nextInvoiceNo` COUNT-based không atomic, không UNIQUE invoice_no (nhánh local, BL-P3-04, P2) |
| 10 | Permission export report? | **PASS** — requireReportType + report.<type>/reports; scope branch validated (403 nếu ngoài quyền) |
| 11 | Doanh thu báo cáo tính đúng (trừ refund/voucher/online)? | **PASS phần lớn** — total lưu sau giảm; void/refund đổi status tự loại; online tính 1 lần. Lưu ý refund retail nếu không đổi status order gốc (Pass 2) |
| 12 | Date range giới hạn (DoS)? | **FAIL** — reportCenter không chặn span, không LIMIT → nạp toàn bộ vào RAM (BL-P3-05, P2). revenueTrends/recentAudit thì có chặn |
| 13 | Payments manual confirm & reconciliation? | **PASS** — self-PIN (hoặc Admin) + lý do + audit; gắn bank_tx claimed đóng vòng đối soát |
| 14 | Business logic trong web frontend? | **PASS** — client chỉ hiển thị; server tính lại total/giá/discount/voucher; không có quyết định bảo mật ở client |
| 15 | Web expose sensitive endpoint/secret? | **PARTIAL** — không hardcode secret trong JS; nhưng admin.html render secret cấu hình vào input value (do getIntegrations trả nguyên văn — TP-04/SEC-P2-01) |
| 16 | bookMenu.js? | **FAIL (SSRF)** — importPubhtml5 fetch URL tùy ý người dùng, không allowlist (SEC-P3-01, P2) |
| 17 | bill_no atomic (trùng multi-device)? | **PASS** — sinh seq MAX+1 + retry khi đụng UNIQUE `(branch_id, bill_no)`; không thể trùng |

## Kết luận tổng quát — FINAL
- Lõi tiền (payOrder, bank webhook, HĐĐT idempotency, shift-lock, PIN gate, giá server-side, bill_no atomic) **phòng thủ tốt** — không SQLi/RCE/auth-bypass toàn cục.
- **Điểm yếu nghiêm trọng nhất phát hiện Pass 3 nằm ở kênh ONLINE**: không idempotent (double kho/doanh thu khi retry), cancel không sync ngược (hụt kho/HĐĐT), webhook fail-open. Đây là các P1 phải sửa trước khi bật kênh online thật.
- Voucher không có single-use; báo cáo không chặn span; bookMenu SSRF — P2.

## Số finding — FINAL
- **P0: 0 · P1: 10 · P2: 14 · P3: 10 · OK/PASS ghi nhận: 36**

## Ràng buộc đã tuân thủ
- Không tạo exploit/payload. Không sửa production code. Không đụng .env/DB/permanent-storage/backups.
- Mọi finding có file + hàm/route cụ thể.

---
# PASS 4 - TOOLING AND PONYTAIL CHECKLIST

| Check | Status |
| --- | --- |
| Server JS syntax | PASS |
| npm dependency audit | PASS, 0 vulnerabilities |
| Flutter core analyze | PASS |
| Flutter POS analyze | FAIL, 65 issues |
| Flutter tablet analyze | FAIL, 24 issues |
| Flutter KDS analyze | FAIL, 2 issues |
| Flutter backoffice analyze | FAIL, 13 issues |
| gitleaks | PENDING, tool not installed |
| semgrep | PENDING, tool not installed |
| trivy | PENDING, tool not installed |
| High-confidence source secret regex | PASS for source files; runtime config secrets are still exposed by `getIntegrations()` |
| Ponytail over-engineering audit | DONE in `13_PONYTAIL_REAUDIT_2026-07-04.md` |

Result: audit docs updated only. Production code intentionally unchanged until owner confirms the P1 patch set.
