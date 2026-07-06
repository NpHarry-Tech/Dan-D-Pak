# 07 — BUSINESS LOGIC FINDINGS (POS nghiệp vụ)

Trọng tâm: mất tiền, lệch hóa đơn, sai tồn kho, sai báo cáo, mất đối soát. Mọi finding dẫn file/hàm.

---
## Đã phòng thủ TỐT (ghi nhận)
- **BL-OK-1 Giá server-side**: `orders.js createOrUpdateOrder` lấy giá từ `menu_items`/`skus` trong DB, KHÔNG tin giá client. Modifier client gửi bị **clamp >= 0** (không cho mod âm hạ đơn giá). `unitPrice = max(0, price + modSum)`.
- **BL-OK-2 Discount cần quyền**: `/orders/:id/pay` chặn discount>0 nếu không có perm `discount` (chống thu ngân hạ tổng về 0).
- **BL-OK-3 Đóng bill idempotent**: `payOrder` dùng `BEGIN IMMEDIATE`; `UPDATE orders SET status='paid' ... WHERE status='open'` kiểm `changes===0` → chặn double-pay/race.
- **BL-OK-4 Đủ tiền mới đóng**: `paid < total` → ném lỗi; webhook underpaid → không đóng.
- **BL-OK-5 Chặn thanh toán khi còn món chờ xác nhận**: `pending_confirm` > 0 → không cho pay/QR.
- **BL-OK-6 Hủy món có cổng**: món đã `preparing/ready/served` không hủy được; đã gửi bếp cần PIN Manager/Owner.
- **BL-OK-7 Shift-lock sau bán**: refund/invoice/cancel bill đã kết ca cần PIN (HTTP 423).
- **BL-OK-8 Yêu cầu mở ca**: bán/thanh toán chặn nếu chưa mở ca (`requireOpenShiftForSales`, ops.shifts.requireOpenShift).
- **BL-OK-9 HĐĐT chống trùng**: `e_invoices` UNIQUE order_id + idempotency_key; xuất HĐ công ty = upgradeBuyer trên cùng bản ghi, không sinh HĐ thứ 2.
- **BL-OK-10 Két tiền có balance_before/after**: `cash_drawer_entries` ghi số dư trước/sau → truy vết.

---
## P1 — Cao (cần xác nhận/sửa)

### BL-01 (P1) Route nhập kho `receive` không guard quyền
`api.js`: `/inventory/:id/receive`, `/skus/:id/receive`, `/warehouse/receive`(có guard) — hai cái đầu **không** `guard('inventory.adjust')`. Ai gọi được cũng tăng tồn + tạo lot + set unit_cost → **sai tồn kho + sai giá vốn + sai báo cáo lãi/lỗ**.
- Kiểm chứng thêm: `Inv.receiveStock/receiveSku` có tự kiểm quyền bên trong không? (Cần đọc inventory.js — hiện CHƯA đọc). Nếu không → lỗ hổng thật.
- Sửa an toàn: thêm guard hoặc kiểm quyền trong service.

### BL-02 (P1) Discount toàn đơn không giới hạn trần
`payments.js payOrder`: nếu có perm `discount`, `discount` là số tùy ý → `total = max(0, subtotal - discount)`. Người có quyền discount hạ bill về 0 hợp lệ, không cần PIN self ở bước pay (voucher thì cần PIN self).
- Rủi ro: mất tiền do lạm quyền discount (không cần đồng phạm).
- Sửa an toàn: trần % giảm, hoặc bắt PIN self + audit lý do khi discount vượt ngưỡng.

### BL-03 (P1) Manual-confirm thanh toán chỉ cần PIN chính-mình, không đối chiếu số tiền bắt buộc
`api.js applyManualConfirm` + `payOrder`: thu ngân đánh dấu `manual_confirm` với reason + PIN của chính mình → bill đóng như đã thu tiền, kể cả khi KHÔNG có `bank_tx_id` (không có giao dịch tiền-về thật).
- Đây là chủ ý (mất mạng/khớp lỗi) và có audit đầy đủ (`payment.manual_confirm`), nhưng là điểm **mất tiền nếu nhân viên gian lận** (tự đóng bill "đã CK" mà tiền không về).
- Sửa an toàn: cảnh báo/đối soát bắt buộc — báo cáo cuối ca liệt kê mọi bill manual-confirm không gắn bank_tx để quản lý duyệt; ngưỡng số tiền cần PIN Manager.

---
## P2 — Trung bình

### BL-04 (P2) Khớp bill webhook theo nội dung CK có thể trùng tiền tố
`payments.js findOpenOrderByContent`: khớp `needle.includes(ref)` với ref = DANBILL+bill_no (<=23 ký tự). Nếu 2 bill mở có bill_no là tiền tố của nhau (vd DAN0701 vs DAN07011) → `includes` có thể khớp nhầm bill.
- Rủi ro: đóng nhầm bill khi auto-confirm → lệch đối soát.
- Sửa an toàn: so khớp chính xác token (ranh giới), hoặc gắn orderCode payOS 1-1 (đã có cho payOS, chưa cho SePay/Casso).

### BL-05 (P2) Đơn online coi là prepaid → trừ kho ngay, hoàn tiền/hủy không rõ hoàn kho
`online.js receive` → `deductForOrder`. Nếu kênh hủy/hoàn, cần đảm bảo cộng kho lại. `returnOrder`/`setStatus` — cần kiểm tra thủ công có reverse tồn không.
- Rủi ro: sai tồn kho khi đơn online hủy sau khi đã trừ.

### BL-06 (P2) `recomputeTotals` chỉ trừ discount tuyệt đối, không kiểm discount > subtotal ở tầng order
`orders.js recomputeTotals`: `total = max(0, subtotal - discount)`. Discount lưu trên order có thể > subtotal (total về 0) mà không cảnh báo. Kết hợp BL-02.

### BL-07 (P2) Reset transactions xóa cả `audit_log`
`api.js /database/reset-transactions` (PIN Manager/Owner) DELETE cả `audit_log`, `staff_calls`, `bank_transactions`, `invoices`...
- Rủi ro: mất dấu vết đối soát nếu dùng nhầm. Bản NDJSON permanent-storage vẫn còn (giảm nhẹ) nhưng audit_log hot bị mất.
- Sửa an toàn: chặn xóa audit_log ở reset; hoặc snapshot bắt buộc trước reset + double-confirm.

---
## P3 — Thấp / ghi nhận
- **BL-08** Xóa vật lý bản ghi cấu hình (menu/category/user/table `DELETE`) — README đã ghi "cần chuyển append-only". Mất lịch sử cấu hình (giá cũ) nếu không có snapshot. `menu_items` có `deleted_at` nhưng route delete gọi `Catalog.deleteMenuItem` — cần kiểm tra soft hay hard.
- **BL-09** `deductForOrder` gọi sau khi COMMIT trong `payOrder`? (Đọc: deduct gọi TRONG try trước COMMIT → tốt, trong transaction). Ghi nhận OK.
- **BL-10** `bill_no` unique per branch + reset theo ngày — cần đảm bảo sinh bill_no atomic (race 2 thu ngân cùng giây). Cần kiểm tra thủ công hàm sinh bill_no.

## Cần kiểm tra thủ công thêm (chưa đọc source)
`inventory.js` (receive/issue/transfer/stocktake/deductForOrder, FEFO, giá vốn), `retail.js` (checkout/refund hoàn kho),
`purchase.js` (nhận hàng → tồn + công nợ), `expenses.js`/`cashDrawer.js` (đối chiếu quỹ), `shifts.js` (kết ca tính tiền),
`vouchers.js` (áp mã: min_total, scope, hết hạn, chống dùng lại), `einvoice.js`/`invoices.js`/`misa.js`, `reportCenter.js` (nguồn số báo cáo), sinh `bill_no`.


---
---
# PASS 2 — Business logic findings bổ sung (inventory.js / einvoice.js / misa.js / shifts.js / cashDrawer.js / retail.js + Flutter POS)

## Đã phòng thủ TỐT (Pass 2)
- **BL-OK-11 Giá server-side cho HĐĐT/MISA**: `misa.js issueInvoice` KHÔNG cộng thuế chồng — tách VAT ngược từ `order.total` (giá đã gồm VAT), phân bổ giảm giá theo tỷ trọng, dòng cuối nhận phần dư làm tròn → tổng HĐ khớp tuyệt đối tổng bill.
- **BL-OK-12 RefID idempotent MISA**: `RefID = einv:{taxCode}:{order.id}`; MISA trả DUPLICATE_REFID → tự `getInvoiceStatus` đồng bộ thay vì phát hành lần 2.
- **BL-OK-13 Idempotency key HĐĐT ở DB**: `e_invoices` có `UNIQUE(order_id)` + `UNIQUE(idempotency_key = einv:{branch}:{order})` (db.js) → không thể tạo 2 bản ghi HĐĐT cho 1 order kể cả race.
- **BL-OK-14 Retail checkout atomic**: `retail.js checkout` bọc `BEGIN IMMEDIATE`...COMMIT/ROLLBACK; giá lấy từ `skus.price` DB, kiểm tồn + lot trước khi bán.
- **BL-OK-15 Manual discount retail clamp >= 0**: `checkout` `manual = max(0, round(manual_discount))`; perk + voucher tính server qua `calculateRetailDiscount`.
- **BL-OK-16 Transfer kho chống âm**: `inventory.js transferStock` kiểm `availAtSource >= qty` trước khi consumeLots (không tạo lot ảo bù thiếu).
- **BL-OK-17 Két chi không âm**: `cashDrawer.createEntry` `after < 0` → ném lỗi; balance_before/after ghi vào mỗi entry.
- **BL-OK-18 Reconciliation cuối ca HĐĐT**: `einvoice.getShiftInvoiceSummary` + `getReconciliation` liệt kê bill paid thiếu/lỗi HĐĐT; kết ca chặn nếu còn missing/failed.

---
## P1 — Cao (Pass 2)

### BL-P2-01 (P1) XÁC NHẬN BL-01: route receive KHÔNG guard → sai tồn/giá vốn (không cần đồng phạm)
`api.js`: `POST /inventory/:id/receive`, `POST /skus/:id/receive` gọi `Inv.receiveStock/receiveSku` mà KHÔNG có `guard('inventory.adjust')`. Đã đọc `inventory.js`: `receiveGeneric` KHÔNG kiểm quyền — chỉ kiểm `expiry_required`. Bất kỳ ai đăng nhập (kể cả role thấp không có `inventory.adjust`) POST được → tăng `stock`, tạo `stock_lots` với `unit_cost` tùy ý, ghi `stock_movements`. → sai tồn + sai giá vốn FEFO + méo báo cáo lãi/lỗ.
- Sửa an toàn: thêm `guard('inventory.adjust')` cho 2 route `/receive` (khớp với `/adjust` và `/warehouse/receive` đã có guard).

### BL-P2-02 (P1) Kho bếp bán ÂM tồn không giới hạn (allowNegative) — đúng chủ ý nhưng thiếu chốt chặn giá vốn
`inventory.js deductForOrder` → `issueGeneric(..., allowNegative:true)` cho nguyên liệu công thức: khi hết tồn vẫn trừ, tạo dòng consumed `{lot_id:null, qty:remaining, unit_cost:0}`. Sale không bao giờ bị chặn (chủ ý, BL-OK), NHƯNG phần tồn âm được tính `unit_cost=0` → giá vốn món bị hụt, tồn `inventory_items.stock` xuống âm không cảnh báo cứng (chỉ `emit inventory:short` + audit). Không mất tiền trực tiếp, nhưng **méo giá vốn/tồn kho bếp** kéo dài nếu công thức/nhập liệu sai.
- Sửa an toàn: dashboard cảnh báo tồn âm bắt buộc xử lý; định kỳ chặn bán món khi tồn âm vượt ngưỡng; gán unit_cost cuối cùng đã biết cho phần âm thay vì 0.

## P2 — Trung bình (Pass 2)

### BL-P2-03 (P2) GIẢI QUYẾT BL-05: `retail.refund` CÓ hoàn kho; đơn online cần double-check
`retail.js refund`: duyệt `order.items`, với mỗi `sku_id` chưa cancelled gọi `returnSku(sku_id, qty, order_id, {lot_id})` → `receiveGeneric` cộng lại đúng lot (movementType 'return', reason 'retail_return'). Set `status='void'`, chặn refund 2 lần (`status==='void'` → ném lỗi). → Retail hoàn kho ĐÚNG. Riêng ĐƠN ONLINE (`online.js returnOrder/setStatus`) vẫn CHƯA đọc line-by-line — giữ VERIFY.
- Ghi nhận: BL-05 với retail = OK; với online = vẫn cần kiểm.

### BL-P2-04 (P2) Refund retail KHÔNG hoàn/hủy HĐĐT đã phát hành
`retail.js refund` chỉ set order `void` + hoàn kho, KHÔNG gọi `einvoice.cancelInvoice`. Nếu bill retail đã phát hành HĐĐT (MISA), refund tạo lệch: hàng trả kho + tiền hoàn nhưng HĐĐT vẫn ISSUED trên thuế → sai kê khai (NĐ70 phải hủy/thay thế). 
- Sửa an toàn: khi refund bill đã ISSUED, buộc đi đường `cancelInvoice`/hóa đơn điều chỉnh + PIN Manager.

### BL-P2-05 (P2) `setStockLevel`/adjust/stocktake dùng tổng lot theo kho, nhưng `addSummaryStock` cập nhật cột `stock` toàn cục (không theo kho)
`inventory.js`: `currentStock` ưu tiên SUM(stock_lots) theo warehouse; nhưng `addSummaryStock` cộng thẳng `skus.stock`/`inventory_items.stock` (1 cột duy nhất, không phân kho). Với item nằm nhiều kho, cột `stock` là tổng gộp còn `currentStock(warehouseFilter)` là theo kho → hai nguồn số liệu có thể lệch khi list không truyền `warehouse_id`. `retail.checkout normalizeCheckoutItems` kiểm `sku.stock` (cột gộp) chứ không theo kho/lot → có thể cho bán khi kho cụ thể đã hết (nếu multi-kho). Hiện cấu hình 1 kho retail nên chưa lộ, nhưng là bẫy khi bật nhiều kho.
- Sửa an toàn: thống nhất nguồn tồn (luôn theo warehouse/lot) cho cả kiểm bán lẫn hiển thị.

### BL-P2-06 (P2) Race 2 thiết bị bán SKU tồn cuối — chốt chặn ở lot, KHÔNG ở transaction bán FnB
Bán retail đi qua `retail.checkout` (BEGIN IMMEDIATE, tốt). Nhưng bán SKU qua FnB `orders.createOrUpdateOrder` chỉ kiểm `sku.stock < qty` (cột gộp) tại thời điểm thêm món, còn trừ kho thật xảy ra ở `payOrder → deductForOrder → issueGeneric('sku', strict)`. `issueGeneric` cho sku KHÔNG allowNegative → nếu 2 bill cùng chốt lot cuối, người thứ 2 nhận lỗi "Không đủ tồn" khi pay (an toàn, không bán âm). Kết luận: **không bán âm SKU** (tốt); rủi ro chỉ là trải nghiệm (bill thứ 2 fail lúc thanh toán thay vì lúc thêm món). Ghi nhận OK về mặt mất tiền/tồn.

## P3 — Thấp / ghi nhận (Pass 2)
- **BL-P2-07** `einvoice.customerRequest` khi khách "decline" vẫn tạo HĐĐT `NO_BUYER_INFO` (đúng NĐ70). OK.
- **BL-P2-08** `processInvoiceQueue` limit 10/lượt, backoff `[10,30,60,300,900,1800]s`, MAX_ATTEMPTS 10; `retryInvoice` chạy `processJob` nền không await — nếu process crash giữa chừng job kẹt SENDING (không có timeout tự phục hồi trạng thái SENDING → RETRYING). Sửa nhẹ: reaper đưa SENDING quá hạn về RETRYING.
- **BL-P2-09** `shiftReport`/`operationDayReport` gom method transfer/pos bằng danh sách key cứng (`bank_transfer,internet_banking,qrcode,qr,momo,zalopay` / `card,visa,pos_card`) trong khi payments canonicalize về `bank/visa`. Method mới ngoài danh sách sẽ KHÔNG vào transfer/pos totals (rơi khỏi 2 nhóm) dù vẫn tính vào total_revenue. Rủi ro báo cáo phân loại sai, không mất tiền. Đồng bộ danh sách với canonical keys.
- **BL-P2-10** `shifts.openShift` mặc định `opening_cash = defaultOpeningCash` (= closing_cash ca trước) nếu không nhập tay — reconciliation kế thừa tiền két ca trước, hợp lý. Kết ca ghi expected_cash = opening + cash_sales - expenses + reimbursements (khớp cashDrawer). OK.

## Vẫn CẦN kiểm tra thủ công (chưa đọc Pass 2)
`online.js` (returnOrder/setStatus có hoàn kho HĐĐT không), `purchase.js` (nhận hàng → tồn + công nợ), `vouchers.js` (min_total/scope/hết hạn/chống dùng lại), `invoices.js` (fallback bill cũ), `reportCenter.js` (nguồn số), sinh `bill_no` atomic.


---
## Pass 3 — Findings mới (online.js / vouchers.js / invoices.js / reports)

### BL-P3-01 (P1) `online.receive` KHÔNG chống trùng đơn ngoài → double kho + double doanh thu khi webhook retry
`online.js receive()` (route PUBLIC `POST /online/webhook`):
- Ánh xạ món → `createOrUpdateOrder` → **luôn tạo order MỚI**, ghi `online_ref = norm.ref`, rồi INSERT `payments`/`payment_lines`, set `status='paid'` và `deductForOrder()` (trừ kho).
- **KHÔNG kiểm tra `online_ref` đã tồn tại** trước khi tạo. Grab/Shopee/Website đều retry webhook khi không nhận 2xx kịp → cùng `orderID/order_id` gửi lại → hệ thống tạo đơn thứ 2, **trừ kho lần 2 + ghi doanh thu lần 2 + in tem lần 2**.
- Không có UNIQUE trên `orders.online_ref` (chỉ có UNIQUE bill_no). Khác hẳn nhánh bank webhook đã có `bank_transactions UNIQUE(provider,external_id)`.
- Sửa an toàn: trước khi tạo, `SELECT id FROM orders WHERE branch_id=? AND online_channel=? AND online_ref=?`; nếu có → trả đơn cũ (idempotent), không trừ kho lại. Thêm UNIQUE index `(branch_id, online_channel, online_ref)`.

### BL-P3-02 (P1) `online.returnOrder` chỉ set `status='void'` — KHÔNG hoàn kho, KHÔNG hủy HĐĐT, KHÔNG đảo doanh thu/thanh toán
`online.js returnOrder(order_id)` (route `POST /online/orders/:id/return`, guard `online`):
- Chỉ chạy `UPDATE orders SET status='void'` + audit. **Không** gọi hoàn kho (đảo `deductForOrder`), **không** hủy `payment_lines`/`payments` đã ghi lúc receive, **không** hủy HĐĐT nếu đã phát hành.
- Hệ quả: đơn online bị trả/hủy → tồn kho **đã trừ vẫn mất** (hụt kho thật vs sổ sách), payment_lines online còn nguyên (lệch đối soát cổng/ca), HĐĐT (nếu có) không được điều chỉnh (sai kê khai NĐ70). Doanh thu dashboard loại đúng vì lọc `status='paid'`, nhưng kho + đối soát thì sai.
- Đối chiếu: retail `returnSku` (Pass 2) hoàn kho đúng. Online thì thiếu toàn bộ. Nâng BL-05 thành **CONFIRMED, P1**.
- Sửa an toàn: `returnOrder` phải cộng lại tồn theo từng dòng đã trừ, đảo/đánh dấu payment, hủy HĐĐT qua `cancelInvoice` + PIN Manager, ghi audit đầy đủ; bọc trong 1 transaction.

### BL-P3-03 (P2) Voucher KHÔNG có giới hạn số lần dùng / không single-use / không lưu redemption
`vouchers.js`: bảng `vouchers` không có cột `used_count`/`max_uses`/`max_per_customer`; `calculateRetailDiscount` chỉ lọc `active` + khung ngày (`isUsableToday`) rồi áp giá — **stateless**.
- Hệ quả: mọi voucher (kể cả mã giảm tiền `amount`) **dùng lại vô hạn** trên mọi đơn/mọi khách. Không tồn tại khái niệm mã dùng-một-lần. Không có bản ghi "voucher X đã redeem cho order Y".
- Vì stateless nên KHÔNG có race condition (không decrement) — nhưng cũng KHÔNG chống lạm dụng: 1 mã khuyến mãi phát ra có thể bị nhân viên/khách nhập lặp cho từng bill để hạ giá.
- Sửa an toàn (nếu cần mã single-use/limited): thêm `max_uses` + bảng `voucher_redemptions(voucher_id, order_id UNIQUE)`; khi áp voucher order-level ghi redemption trong cùng transaction đóng bill; kiểm `used_count < max_uses`.

### BL-P3-04 (P2) `invoices.nextInvoiceNo` dựa `COUNT(*)+1` — không atomic, không UNIQUE → có thể trùng SỐ HÓA ĐƠN pháp lý
`invoices.js nextInvoiceNo(branch_id)` = `COUNT(*) FROM invoices WHERE branch_id=? + 1`, `issue()` không bọc transaction quanh (đọc COUNT → INSERT). Bảng `invoices` KHÔNG có UNIQUE trên `invoice_no`.
- Hai lần `issue()` đồng thời (hoặc gần nhau) → cùng số HĐ; COUNT gồm cả HĐ đã `cancelled` nên số vẫn tăng nhưng cơ chế đếm là điểm yếu.
- Đây là nhánh **fallback/mock** (khi MISA không live — `provider='local'`); nhánh thật là `einvoice.js`/MISA RefID đã idempotent (BL-OK-9). Rủi ro thực chỉ khi chạy chế độ local phát hành HĐ.
- Sửa an toàn: dùng bộ đếm atomic per-ký-hiệu (bảng sequence + `UPDATE ... RETURNING`), thêm `UNIQUE(branch_id, invoice_no)`, bọc `issue()` trong transaction.

### BL-P3-05 (P2) Báo cáo KHÔNG giới hạn khoảng thời gian → nạp toàn bộ dòng trong kỳ vào RAM (DoS)
`reportCenter.js`: `rangeFromQuery` nhận `from/to` từ client, **không chặn span tối đa**. `saleRows/movementRows/buildCashDrawer...` truy vấn `SELECT ... WHERE created_at BETWEEN from AND to` **không LIMIT**, rồi `.all()` nạp hết vào bộ nhớ và build section (mỗi dòng order_item/movement).
- Một request `type=sales_overview&from=2020-01-01&to=2030-01-01&format=xlsx` kéo toàn bộ order_items nhiều năm → tốn RAM/CPU, có thể treo server (single-process better-sqlite3 đồng bộ).
- `revenueTrends` (reports.js) đã chặn cutoff 4 năm; `recentAudit` clamp limit ≤1000 — nhưng report center thì không.
- Sửa an toàn: giới hạn span (vd ≤ 366 ngày) hoặc phân trang/streaming cho export; đặt trần số dòng.

---
## Đã phòng thủ TỐT — bổ sung Pass 3
- **BL-OK-19 bill_no atomic chống trùng multi-device**: `orders.js insertOpenOrder` sinh `Dan{ddMMyy}{seq}` (seq = MAX trong ngày +1) và **retry tăng seq khi đụng UNIQUE**. DB có `CREATE UNIQUE INDEX idx_orders_bill_no ON orders(branch_id, bill_no)` → 2 thu ngân cùng giây không thể trùng bill_no (đơn thua bị chặn, thử seq kế). PASS.
- **BL-OK-20 online.resolveItemMapping fail-closed**: khi không khớp được sản phẩm online, **ném lỗi `ONLINE_ITEM_UNMAPPED`** thay vì fallback "món đầu tiên" → không trừ nhầm kho / doanh thu ảo. Toàn bộ `receive` bọc `BEGIN IMMEDIATE` + ROLLBACK. PASS.
- **BL-OK-21 online.receive KHÔNG tính doanh thu 2 lần trong 1 lần nhận**: chỉ INSERT 1 payment + 1 payment_line, set paid 1 lần. `confirmPayment` có kiểm `hasPayment` trước khi ghi để không nhân đôi. (Vấn đề double là do **retry webhook** — BL-P3-01, không phải trong 1 lần gọi.)
- **BL-OK-22 Báo cáo doanh thu tính đúng gốc**: dashboard/report dùng `orders.total WHERE status='paid'` (đã trừ discount/voucher vì total lưu sau giảm); void/refund đổi status nên tự loại. Online tính vào doanh thu đúng 1 lần. (Lưu ý: refund retail nếu KHÔNG đổi status='paid' của order gốc thì doanh thu vẫn tính — xem retail Pass 2.)
- **BL-OK-23 Phân quyền + phạm vi báo cáo chặt**: `api.js requireReportType/canViewReport` (owner | `reports` | `report.<type>`); `reportScopeForUser` **ném 403 nếu branch_id không thuộc quyền user**. Export dùng cùng guard. PASS.
