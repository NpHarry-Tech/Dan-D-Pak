# Runbook nghiệm thu Desktop trước

Tài liệu này là thứ tự chạy thực tế cho Windows Desktop. Chi tiết case và tiêu chí chung nằm tại [QA_MASTER_TEST_PLAN.md](QA_MASTER_TEST_PLAN.md).

## Gate Desktop

Tablet và Phone chỉ bắt đầu sau khi Desktop đạt đủ:

- Cài mới và nâng cấp thành công trên artifact Windows cuối.
- Tất cả module active mở được đúng quyền.
- Click Coverage Ledger Desktop đạt 100% control reachable.
- Toàn bộ P0/P1 Desktop PASS.
- Không crash/native exit, Flutter exception, sai tiền, sai tồn, ghi trùng hoặc vượt quyền.
- Backup/restore staging và rollback app đã thử thành công.

## Chuẩn bị một lần

1. Máy POS Windows 1366×768, scaling 100%.
2. Máy Windows 1920×1080, scaling 125%.
3. Một bộ hai màn hình để test customer display.
4. Một KDS/browser hoặc app thứ hai cùng LAN.
5. Máy in bill 80 mm; nếu có vận hành thật, thêm 58 mm, bếp/bar và tem.
6. Scanner barcode; card terminal sandbox/mock.
7. DB QA sạch và một DB upgrade đã khử dữ liệu nhạy cảm.
8. Tài khoản owner, manager, cashier, warehouse granular, KDS-only, report-only và deny-user.

Trước mỗi ngày chạy:

- Ghi commit, build number, installer SHA-256, máy, Windows version, scaling và `run_id`.
- Backup DB QA.
- Mở Nhật ký hoạt động ở một cửa sổ để theo dõi crash/error/duplicate.
- Không dùng production cho reset, restore, replay webhook hoặc destructive case.

## Phiên D0 — Automation và artifact

1. Chạy `flutter analyze` tại `flutter-apps/dandpak_core`.
2. Chạy `flutter test` tại `flutter-apps/dandpak_core`.
3. Chạy `node --test server/*.test.mjs server/services/*.test.mjs`.
4. Build release Windows và installer.
5. Cài mới trên máy sạch; boot, login, logout, restart.
6. Nâng cấp từ hai build desktop gần nhất; dữ liệu và cấu hình còn nguyên.
7. Verify `/api/app/version?platform=windows`, download, installer version và update notification.

PASS khi không có analyze/test/build error, artifact đúng version và app boot sạch.

## Phiên D1 — Window, bootstrap, Auth và Launcher

Chạm toàn bộ:

- Nút minimize/maximize/close, kéo cửa sổ, resize, 100%/125% scaling.
- Chọn chi nhánh, refresh, back, logout.
- Chọn user, bàn phím PIN, show/hide nếu có, đăng nhập.
- Đổi PIN bắt buộc; Việt/Anh; update banner/button.
- Mọi tile module hiện theo owner, rồi lặp lại theo từng role/deny-user.

Case lỗi:

- Server chưa sẵn sàng, sai URL, sai PIN, rate-limit, user inactive, token hết hạn.
- Mở app hai lần, kill process rồi mở lại, shutdown sạch.

Đối chiếu: session/auth DB, một login failure chỉ một log, planned module không xuất hiện như active.

## Phiên D2 — Cài đặt nền

Đi tuần tự 12 mục sidebar, bấm mọi tab/menu/dialog/control:

1. Nhân sự & Phân quyền.
2. Chi nhánh.
3. Cấu hình bàn.
4. Thực đơn.
5. Liên kết.
6. Kết nối.
7. Kho & kênh bán.
8. Bill & Tem nhãn.
9. Thiết bị khách.
10. Màn hình phụ.
11. Tích điểm & Khuyến mại.
12. Cấu hình thông báo.

Với từng mục: load/rỗng/lỗi, add/edit/delete/toggle/dropdown/upload/test/save/reset/cancel/close; sai PIN, đúng PIN, thiếu quyền; restart và branch isolation.

Đặc biệt:

- Secret đã lưu luôn mask; để trống giữ secret; nhập mới mới ghi đè; API/log không trả secret thật.
- Permission deny có hiệu lực cả UI lẫn API.
- Mẫu in autosave không tạo log lặp và preview không overflow.
- Màn hình phụ không tự mở trên máy một màn hình; setting lưu đúng theo branch.

## Phiên D3 — POS FnB + KDS + máy in

1. Mở ca và kiểm đếm tiền đầu ca.
2. Chọn từng khu vực/bàn.
3. Thêm món bếp/bar/salad; modifier, ghi chú, qty, xóa.
4. Gửi bếp; xem đúng ticket từng station và bản in routing.
5. KDS: pending→preparing→ready→served, dismiss.
6. Thêm món lượt hai; hủy trước/sau bếp với reason/PIN.
7. Chuyển bàn, gộp bàn, tách bill.
8. Voucher/discount; permission deny.
9. In tạm tính, bill, in lại.
10. Pay cash/card/QR/split; thiếu/thừa/decline/double-click.
11. Xem lịch sử/receipt và đóng ca.

Luôn đối chiếu order/order_items/payment/payment_lines/stock movements/audit/print jobs và realtime. Một thao tác không được tạo hai bản ghi nghiệp vụ.

## Phiên D4 — Self-order Desktop và realtime nhiều thiết bị

1. Mở Self-order từ launcher; chọn/đổi bàn.
2. Book menu, menu tương tác, tìm kiếm, modifier, giỏ.
3. SĐT check-in, gọi nhân viên, gửi order, request payment/invoice.
4. QR pending/success/fail/timeout.
5. Staff exit sai/đúng PIN.
6. Tắt Wi-Fi/socket, thao tác, bật lại; không duplicate khi retry.
7. Theo dõi đồng thời POS, KDS, Self-order và Dashboard.

## Phiên D5 — Retail + màn hình phụ

1. Search/filter/paging/scan SKU.
2. Add, qty, lot/HSD, voucher, customer, discount.
3. Nhiều tab giỏ; sync hai desktop; đóng/khôi phục tab.
4. Checkout mọi phương thức và refund.
5. Mở màn hình phụ rồi thao tác ngay: add→qty→remove→clear.
6. QR→paid→resume; quảng cáo; open/hide/reopen; kéo/double-click.
7. Chạy vòng lặp 100 add/remove và 20 open/hide.
8. Kill/restart khi cart mở và sau khi cart vừa clear.

PASS khi màn phụ không bỏ lần update, không crash marker, cart đã xóa không sống lại, checkout/refund chỉ ghi một lần.

## Phiên D6 — Kho, giá và mua hàng

1. Inventory item/SKU CRUD, barcode, unit, min stock, lot tracking.
2. Kho CRUD và guard kho cuối cùng.
3. Receive/issue/transfer với đủ/thiếu tồn và FEFO.
4. Phiếu draft/confirm/cancel; duplicate click.
5. Stocktake count/delta/balance với từng granular permission.
6. Price book và snapshot giá order cũ.
7. Import/export Excel/KiotViet hợp lệ/sai/trùng/file lớn.
8. Purchase PO draft→confirm→partial receive→pay→cancel.
9. Cảnh báo dưới định mức/gần HSD và report.

Đối chiếu tổng `stock_lots`, `stock_movements`, documents, purchase payables và audit sau từng bước.

## Phiên D7 — Contacts, Expense, ca/két, Invoice và Accounting

1. Customer/supplier/both CRUD; SĐT/email/MST trùng; tax lookup; ảnh/địa chỉ.
2. Expense từ két/direct; ảnh hóa đơn; hoàn chi partial/full/multiple.
3. Đóng ca counted/expected/difference.
4. Invoice buyer data; issue/retry/cancel/download PDF/XML.
5. MISA sandbox success/auth fail/timeout/validation fail/restart worker.
6. Accounting views và report đối chiếu order/payment/refund/expense/shift.

PASS khi tiền về 0 sai lệch, invoice không trùng, audit status đầy đủ và không lộ dữ liệu nhạy cảm.

## Phiên D8 — Online, Haravan và payment providers

1. Online webhook từng kênh: missing/wrong/correct secret, malformed payload.
2. Duplicate/simultaneous external order.
3. Confirm/reject/assign/return/complete.
4. Haravan install/status/subscribe/unsubscribe/test.
5. Orders/customer/product/inventory topics và các sync flag.
6. Full/delta sync, 401/429/500, retry/resume.
7. Location Haravan đúng/sai; POS sale/refund push tồn một lần.
8. VietQR/SePay/Casso/payOS signature và replay.
9. Underpay/exact/overpay/unmatched/card decline.

PASS khi external ID, payment và tồn kho đều idempotent; sync log không spam và không có secret.

## Phiên D9 — Dashboard, báo cáo, Database, Audit và Documents

1. Dashboard filters/realtime và đối chiếu SQL.
2. Mọi report catalog: preview/export/date/branch/channel/permission.
3. Database status/path/integrity.
4. Backup; restore vào staging; so row counts/checksum.
5. Reset transactions và clone staging chỉ trên QA, có PIN và preview scope.
6. Audit/system log: filter/search/detail/copy/resolve/dedup/retention.
7. Documents: upload/download/preview/rename/delete; MIME/size/hash/path traversal.
8. Config export/import và secret redaction.

PASS khi app chỉ dùng đúng một runtime DB, restore được và một nghiệp vụ không bị hiển thị thành nhiều log trùng.

## Phiên D10 — Độ bền, bảo mật và release regression

- 8 giờ POS + KDS + Retail + Dashboard + socket.
- 10 checkout song song; 100 webhook burst; 20 client socket nếu lab cho phép.
- API 400/401/403/404/409/429/500, timeout, server restart.
- SQL injection, path traversal, malformed/oversized JSON/upload, MIME giả.
- Quét log/export/crash report tìm PIN/token/secret/card data.
- Chạy lại P0 smoke trên installer cuối và thử rollback.

## Click Coverage Ledger Desktop

Tạo một dòng cho từng control reachable trong từng phiên. Bắt buộc ghi:

| ID | Build | Role | Branch | Screen/state | Control | Expected | DB/API/audit check | Evidence | Result |
|---|---|---|---|---|---|---|---|---|---|

Quy tắc đóng phiên:

- Không còn control chưa bấm trong màn hình đã inventory.
- Control chỉ xuất hiện ở state động phải được tạo đúng state để test; không ghi N/A vì “không thấy”.
- N/A chỉ dành cho phần cứng/tích hợp không thuộc deployment và phải có người duyệt.
- Sau bug fix, chạy lại case lỗi + toàn phiên chứa nó + P0 liên quan.

## Thứ tự bắt đầu ngay

1. D0 automation/artifact.
2. D1 Auth/Launcher.
3. D2 toàn bộ Settings.
4. D3 POS/KDS/Print.
5. D5 Retail/Second screen.
6. Sau khi năm bước trên sạch mới tiếp D4, D6–D10.

Không bắt đầu Tablet/Phone trước khi Desktop Gate được ký PASS.
