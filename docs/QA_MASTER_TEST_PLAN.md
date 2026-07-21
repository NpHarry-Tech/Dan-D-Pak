# Kế hoạch kiểm thử tổng thể Dan D Pak POS/ERP

Trạng thái: baseline trước nghiệm thu toàn hệ thống  
Nguồn phạm vi: source code hiện tại, không dựa vào danh sách tính năng dự kiến  
Phạm vi app: `dandpak_desktop`, `dandpak_tablet`, `dandpak_phone`, lõi dùng chung `dandpak_core`, Node.js server, SQLite, Socket.IO và các tích hợp bên ngoài

## 1. Mục tiêu nghiệm thu

Một bản chỉ được gọi là đã qua tester khi đồng thời đạt đủ bốn điều kiện:

1. Mọi module đang hoạt động mở được trên đúng loại thiết bị và đúng quyền.
2. Mọi điểm tương tác nhìn thấy được đã được thao tác ít nhất một lần ở trạng thái hợp lệ; các nút ghi/xóa/tiền/quyền phải kiểm thêm trạng thái từ chối và hủy.
3. Mọi luồng nghiệp vụ quan trọng được kiểm từ UI đến API, DB, audit, realtime, in ấn/tích hợp liên quan.
4. Không còn lỗi blocker/critical/high; không có crash, mất dữ liệu, ghi trùng, sai tiền, sai tồn kho hoặc vượt quyền.

Không dùng “100% line coverage” làm bằng chứng hoàn thành. Chuẩn ở đây là 100% tính năng đang hoạt động, 100% control UI reachable, 100% API đang được app sử dụng và 100% luồng tiền/kho/dữ liệu quan trọng.

## 2. Baseline phạm vi từ source

- Flutter core: 137 file Dart, khoảng 59.355 dòng.
- Server: 85 file JavaScript/MJS, khoảng 19.240 dòng.
- API: khoảng 273 khai báo route trong `server/api.js` và `server/modules/*/routes.js`.
- UI: khoảng 702 khai báo tương tác trong `lib/src/screens` gồm button, icon button, InkWell, gesture, switch, checkbox, dropdown và menu.
- Test tự động hiện có: 4 file Flutter; 3 file Node (security, log dedup, Haravan).
- 3 shell app dùng chung một core:
  - Desktop: tất cả module active theo quyền; có local Node engine, cập nhật Windows, in, màn hình phụ.
  - Tablet: Quản lý, POS, Retail, Self-order, KDS, Online, Kho/Tồn, Liên hệ, In và Cài đặt.
  - Phone: Quản lý, Retail, Liên hệ, Chi phí, Hóa đơn, Kế toán, Kho, Database và Cài đặt.
- Module `planned` trong catalog không thuộc nghiệm thu chức năng; chỉ kiểm chúng không hiện như tính năng sử dụng được.

## 3. Nguyên tắc kiểm “bấm toàn bộ”

Mỗi màn hình phải có một dòng trong Click Coverage Ledger. Tester không được ghi PASS chỉ vì màn hình mở được.

Với từng control nhìn thấy được:

1. Ghi tên màn hình, control, điều kiện xuất hiện, vai trò và thiết bị.
2. Bấm/chạm một lần và xác nhận phản hồi đúng.
3. Với control thay đổi dữ liệu: kiểm request, kết quả DB, audit và realtime.
4. Với dialog/sheet/menu: mở, thử từng lựa chọn, thử Hủy/Đóng/Escape/backdrop và mở lại.
5. Với form: thử dữ liệu hợp lệ, trống bắt buộc, sai kiểu, min/max, Unicode tiếng Việt, khoảng trắng và nhập lặp.
6. Với nút nguy hiểm: thử sai PIN, đúng PIN, Hủy, double-click và gửi lại request.
7. Với control disabled: xác nhận không thể kích hoạt bằng chuột, bàn phím hoặc chạm nhanh nhiều lần.
8. Với danh sách: kiểm dòng đầu/cuối, rỗng, một dòng, nhiều trang, tìm kiếm, lọc, sort, refresh và scroll.
9. Với responsive: kiểm không overflow, không mất nút và vùng chạm tối thiểu ở desktop/tablet/phone.
10. Chụp bằng chứng trước/sau cho mọi case ghi dữ liệu hoặc lỗi.

Mẫu ledger:

| ID | App/thiết bị | Màn hình | Control | Điều kiện | Vai trò | Kỳ vọng | Evidence | Kết quả |
|---|---|---|---|---|---|---|---|---|
| UI-0001 | Desktop | Launcher | POS FnB | Đăng nhập, có `module.pos` | Cashier | Mở POS, không lỗi log | ảnh/video + log ID | PASS/FAIL |

Điều kiện hoàn thành ledger: số control `PASS + N/A có lý do` phải bằng số control đã inventory từ bản build đang test. Mỗi lần source đổi, tạo lại inventory; không tái sử dụng ledger cũ.

## 4. Môi trường và thiết bị bắt buộc

### 4.1 Môi trường

- QA sạch: DB seed riêng, không chứa dữ liệu thật.
- QA nâng cấp: bản sao đã khử dữ liệu nhạy cảm của DB cũ để kiểm migration/update.
- Staging tích hợp: endpoint HTTPS thật, webhook sandbox/test, không phát hành hóa đơn hay thu tiền thật ngoài case được phê duyệt.
- Production smoke: chỉ đọc và giao dịch thử đã định danh; không chạy reset/restore/destructive test.

### 4.2 Ma trận thiết bị

| Thiết bị | Cấu hình tối thiểu phải test |
|---|---|
| Windows POS | 1366×768 và 1920×1080; 100% và 125% scaling; chuột + bàn phím |
| Windows hai màn hình | POS chính + màn khách; cắm/rút, mở/ẩn, thêm/xóa món, QR, quảng cáo |
| Android tablet | dọc/ngang; màn ngắn và màn chuẩn; Wi-Fi ổn định/chập chờn |
| Android phone | màn hẹp; dọc; background/foreground; notification/update |
| iPad/iPhone | nếu là nền tảng phát hành: cùng ma trận viewport, lifecycle và quyền hệ thống |
| KDS | ít nhất bếp và bar/salad chạy đồng thời |
| Máy in | bill, bếp/bar, tem; online/offline, hết giấy hoặc agent lỗi |
| Scanner | barcode camera và scanner bàn phím nếu triển khai |
| Card terminal | sandbox/mock được kiểm soát và một vòng chứng nhận thiết bị thật |

### 4.3 Tài khoản/quyền

- Owner/Admin toàn quyền.
- Manager có quyền quản lý nhưng không phải owner.
- Cashier: sell/pay, không quản trị.
- Warehouse: từng quyền granular receive/issue/transfer/stocktake/price/delete.
- KDS-only.
- Reporting/audit read-only.
- User bị deny một quyền cụ thể.
- User bị khóa/inactive.
- User PIN mặc định bắt buộc đổi.
- Hai user khác chi nhánh và user được cấp nhiều chi nhánh.

## 5. Dữ liệu test chuẩn

Tạo một bộ dữ liệu có thể reset:

- 3 chi nhánh: Sala, Q1, TD; mỗi chi nhánh có kho bếp và kho retail.
- 3 khu vực, 12 bàn; có bàn trống, đang gọi món, chờ thanh toán.
- 12 món FnB: bếp/bar/salad, modifier, ghi chú, recipe, lịch bán, món ẩn/hết.
- 12 SKU retail: barcode, SKU trùng tên, biến thể, có/không lot, FEFO, gần hết HSD, hết hàng.
- 6 khách: trùng SĐT, trùng email, có MST, thành viên, khách online/offline.
- 4 nhà cung cấp và 2 contact `both`.
- Voucher theo món, đơn, phần trăm, số tiền; chưa hiệu lực, hết hạn, min bill.
- Ca mở/đóng; tiền đầu ca; chi, hoàn chi; nhiều mệnh giá kiểm đếm.
- Đơn Haravan và các đơn online có external ID cố định để kiểm idempotency.
- Cấu hình test MISA/payOS/SePay/Casso/VietQR/Haravan với secret sandbox.
- Ảnh hợp lệ, ảnh sai MIME, file quá lớn, PDF/XML hóa đơn, tài liệu trùng hash.

Mỗi run phải ghi `run_id`; tên dữ liệu phát sinh dùng prefix đó để dọn chính xác, không reset nhầm dữ liệu khác.

## 6. Thứ tự thực thi

### Gate 0 — Build và kiểm tĩnh

- `flutter analyze` cho core và từng shell.
- `flutter test` cho core.
- `node --test server/*.test.mjs server/services/*.test.mjs`.
- Build release Windows và Android; cài mới trên máy sạch.
- Kiểm signature/hash artifact, version/build đúng với manifest update.
- FAIL ngay nếu analyze/test/build lỗi hoặc working tree chứa artifact/runtime DB ngoài vùng ignore.

### Gate 1 — Server, DB và API contract

- Boot DB mới hai lần: migration phải idempotent.
- Boot từ bản sao DB cũ: số row, khóa ngoại, index và dữ liệu tiền/tồn không đổi ngoài migration dự kiến.
- `/health`, `/api/ping`, API 404 JSON, lỗi validation và lỗi auth phải có format nhất quán.
- Kiểm 273 route: method/path, auth guard, permission, branch scope, success, validation, not-found và duplicate submission.
- Route `notImplemented` phải trả trạng thái rõ ràng và không tạo dữ liệu.
- Chạy integrity check, WAL checkpoint, backup; restore vào DB khác rồi so sánh checksum/count.
- Xác minh runtime chỉ dùng một `SQLITE_PATH`; không có DB clone được app tự đọc lại.

### Gate 2 — UI click sweep

- Chạy theo từng app và từng vai trò.
- Inventory mọi route màn hình và control động sau khi có dữ liệu/rỗng/lỗi.
- Thực hiện Click Coverage Ledger.
- Mỗi màn hình mở log system song song; không chấp nhận Flutter exception, overflow, warning lặp hoặc crash marker mới.

### Gate 3 — Luồng nghiệp vụ end-to-end

- Chạy các suite ở mục 7 theo thứ tự Auth → Settings nền → Catalog → POS/KDS → Retail → Kho → Tài chính → Online/Haravan → Báo cáo/DB.
- Sau mỗi suite, đối chiếu DB, audit, realtime và báo cáo.

### Gate 4 — Thiết bị, mạng và độ bền

- Hai màn hình, máy in, scanner, notification, update.
- Mất mạng, reconnect, server restart, app kill, power loss mô phỏng trên DB QA.
- Soak 8 giờ với POS + KDS + tablet + admin, không tăng log/rác/bộ nhớ bất thường.

### Gate 5 — Release candidate

- Cài mới và nâng cấp từ hai build gần nhất.
- Chạy P0 smoke trên artifact cuối cùng, không dùng debug build.
- Backup trước release; chứng minh rollback app và restore staging hoạt động.

## 7. Bộ test chức năng chi tiết

### AUTH — Khởi động, chi nhánh, đăng nhập, phiên và cập nhật

- AUTH-01: mở app lần đầu, local server start/remote server, splash kết thúc đúng.
- AUTH-02: chọn từng chi nhánh, refresh, back, server lỗi, chi nhánh không active.
- AUTH-03: đăng nhập đúng trên owner/manager/cashier/warehouse/KDS.
- AUTH-04: sai PIN một lần chỉ sinh một thông báo và một log nghiệp vụ; không duplicate.
- AUTH-05: rate-limit sai PIN; hết thời gian khóa mới cho thử lại.
- AUTH-06: inactive user không đăng nhập được; session cũ bị vô hiệu đúng chính sách.
- AUTH-07: PIN mặc định buộc đổi; sai PIN cũ, PIN mới yếu/trùng, xác nhận không khớp.
- AUTH-08: logout, đóng/mở app, nhiều session, token hết hạn.
- AUTH-09: chuyển chi nhánh cần đúng PIN/quyền; dữ liệu màn cũ không rò sang chi nhánh mới.
- AUTH-10: ngôn ngữ Việt/Anh lưu theo user và áp dụng sau restart.
- AUTH-11: launcher chỉ hiện module active đúng flavor và quyền; planned module không mở được.
- AUTH-12: update không có/có bản mới, download lỗi, retry, cài thành công; notification một lần/build và đúng ngôn ngữ.

### SET — Cài đặt và quản trị nền

Mỗi khu vực dưới đây phải kiểm Save, Reset/Reload, cancel, sai PIN, đúng PIN, permission deny, refresh/restart và branch isolation.

- SET-USER: tạo/sửa/khóa/xóa user; avatar; role; allow/deny override; không được tự cấp quyền mình không có.
- SET-BRANCH: tạo/sửa chi nhánh, mặc định, active; mapping kho và phân vùng.
- SET-TABLE: tạo/sửa/xóa khu vực/bàn; tọa độ sơ đồ; bàn đang có order không được làm mất bill.
- SET-MENU: category CRUD; món CRUD; ảnh; giá; modifier; recipe; station; lịch bán; ẩn/hết; import book menu.
- SET-INTEGRATION: từng kênh MISA, payOS, VietQR, SePay, Casso, Grab, ShopeeFood, BeFood, GrabMart, Website, Haravan; secret đã lưu phải mask, để trống giữ nguyên, nhập mới mới ghi đè.
- SET-CONNECTION: trạng thái server/socket/agent/máy in/cloud; refresh và trạng thái offline.
- SET-WAREHOUSE: kho, kênh bán, kho mặc định, rule âm kho, threshold; không xóa/tắt kho cuối cùng đang cần.
- SET-PRINT: máy in, routing bếp/bar/bill/tem, khổ giấy, số bản; test print.
- SET-DESIGNER: kéo/thả/chọn phần tử, font, đậm, căn lề, logo, QR, preview, autosave, reset, mẫu Nhật/Vừa/Đậm/Rất đậm; không overflow/crash.
- SET-DEVICE: self-order config, staff PIN, customer display visibility theo platform.
- SET-DISPLAY: bật/tắt, ảnh quảng cáo, thời lượng, mở/ẩn cửa sổ phụ, một/hai màn hình.
- SET-LOYALTY: rule điểm, hạng thành viên, voucher/khuyến mãi, lịch và xung đột rule.
- SET-NOTIFY: âm thanh, preview, routing event→device; offline và file âm thanh thiếu.

### FNB — POS FnB, bàn, bill và bếp

- FNB-01: mở ca; nhập tiền đầu ca; không mở ca thì bán bị chặn theo config.
- FNB-02: chọn khu vực/bàn; mở bàn trống; bàn đang phục vụ; trạng thái realtime.
- FNB-03: thêm món bằng danh mục/tìm kiếm; modifier; số lượng; ghi chú; xóa trước gửi bếp.
- FNB-04: gửi bếp; KDS đúng station nhận đúng một ticket; resend không nhân đôi món.
- FNB-05: KDS chuyển pending→preparing→ready→served; dismiss; SLA; refresh/reconnect.
- FNB-06: thêm món sau lượt gửi đầu; chỉ món mới được gửi/in.
- FNB-07: hủy món trước/sau bếp; reason và PIN; audit và KDS cập nhật.
- FNB-08: chuyển bàn, gộp bàn, tách bill; tổng tiền và item ownership đúng.
- FNB-09: voucher/giảm giá hợp lệ; min/max; không quyền discount; snapshot giá cũ không đổi.
- FNB-10: in tạm tính, in bill, in lại có dấu reprint; job/attempt/audit đúng.
- FNB-11: thanh toán cash/card/QR/split; thiếu/thừa tiền; double-submit; provider decline.
- FNB-12: request payment từ khách; invoice choice; paid đóng bill, trừ tồn đúng một lần.
- FNB-13: lịch sử đơn, lọc, xem receipt, refund/cancel theo rule.
- FNB-14: gọi nhân viên và yêu cầu thanh toán từ self-order hiện đúng nơi.

### SELF — Khách tự gọi món

- SELF-01: welcome, chọn/đổi bàn, bàn không hợp lệ, kiosk lock/unlock và rate-limit PIN.
- SELF-02: book menu lật trang, zoom/drag và quay về menu tương tác.
- SELF-03: danh mục, tìm kiếm, món ẩn/hết, modifier bắt buộc, ghi chú, giỏ.
- SELF-04: tăng/giảm/xóa/clear cart; back giữ đúng trạng thái.
- SELF-05: check-in SĐT, khách mới/cũ, privacy và rate-limit.
- SELF-06: gửi order một lần; retry mạng không tạo trùng.
- SELF-07: gọi nhân viên, yêu cầu thanh toán, chọn hóa đơn.
- SELF-08: QR payment pending/success/fail/timeout; không tự paid nếu chưa xác nhận.
- SELF-09: staff exit; sai/đúng PIN; app trở về launcher đúng.

### RET — Bán lẻ

- RET-01: tải SKU, paging, search, lọc còn hàng, scan barcode có/không tìm thấy.
- RET-02: thêm cùng SKU/lot, tăng/giảm, xóa dòng, xóa giỏ; giới hạn tồn.
- RET-03: chọn lot/HSD, FEFO tự động, lot hết/expired, đổi lot làm quantity hợp lệ.
- RET-04: voucher dòng/đơn, customer discount, manual discount và xung đột.
- RET-05: tạo/chọn/sửa khách; nhận diện trùng SĐT/email.
- RET-06: nhiều tab bán; chuyển tab; đóng tab; cart sync giữa hai thiết bị không ping-pong/trùng.
- RET-07: checkout cash/card/QR/split; paid đúng một sale/payment/movement.
- RET-08: refund toàn phần/một phần; quá số lượng; ca khóa; tồn và tiền đảo đúng.
- RET-09: mở màn hình phụ rồi thêm/sửa/xóa món nhanh; màn phụ luôn đúng và app không crash.
- RET-10: kill/restart lúc cart mở; phục hồi cart theo policy, không resurrect dữ liệu đã xóa.

### DISP — Màn hình phụ

- DISP-01: một màn hình chỉ preview cửa sổ thường; hai màn hình tự mở theo setting.
- DISP-02: initial idle và quảng cáo; ảnh lỗi/lớn; đổi thời lượng.
- DISP-03: cart FnB và Retail: add, qty, modifier, promo, remove, clear, total.
- DISP-04: QR payment, paid confirmation, resume cart/idle.
- DISP-05: mở/ẩn/mở lại, kéo, double-click fullscreen, đổi monitor, đóng bằng X.
- DISP-06: mở rồi thao tác ngay trước khi child engine ready; dữ liệu phải retry và không detach.
- DISP-07: 100 vòng add/remove/clear và 20 vòng open/hide; không crash marker/native exit.

### WH — Kho, SKU, lot, giá và kiểm kho

- WH-01: inventory item/SKU CRUD; barcode; unit; min stock; track lot; delete guard.
- WH-02: tạo/sửa kho; warehouse type; branch scope; kho cuối cùng.
- WH-03: nhận kho có/không lot, HSD, supplier, cost; stock/lot/movement/doc/audit khớp.
- WH-04: xuất kho đủ/thiếu; reason; FEFO; không âm ngoài policy.
- WH-05: chuyển kho; source/target giống nhau; thiếu tồn; hai movement cân bằng.
- WH-06: phiếu nháp→xác nhận→hủy; sửa sau confirm bị chặn; duplicate submit idempotent.
- WH-07: stocktake draft, scan/count, chênh lệch, cân bằng cần quyền riêng, reopen/cancel.
- WH-08: bảng giá create/edit/apply; giá order cũ giữ snapshot.
- WH-09: import/export KiotViet/Excel: template, Unicode, duplicate SKU, sai cột, file lớn.
- WH-10: cảnh báo dưới định mức/gần HSD; filter/sort/export.

### PUR — Mua hàng

- PUR-01: PO draft với supplier, SKU, qty, cost, tax/discount.
- PUR-02: save/edit/confirm; validation; duplicate click.
- PUR-03: nhận một phần/nhiều lần; lot/HSD; không nhận quá policy.
- PUR-04: thanh toán từ két/direct, partial/multiple; công nợ đúng.
- PUR-05: cancel/delete theo trạng thái/quyền; tồn và ledger không sai.
- PUR-06: filter/search/detail/export và branch isolation.

### CRM — Khách hàng/nhà cung cấp

- CRM-01: list/search/filter customer/supplier/both.
- CRM-02: CRUD, avatar, MST lookup, tỉnh/phường/địa chỉ, contact person.
- CRM-03: duplicate SĐT/email/MST; merge/link theo rule, không mất lịch sử.
- CRM-04: khách liên kết order online/offline, tổng chi tiêu và loyalty.
- CRM-05: xóa contact đang được tham chiếu; permission và audit.

### CASH — Ca, két, chi phí và hoàn chi

- CASH-01: mở ca, kiểm đếm mệnh giá, tiền đầu ca; một user/branch không mở trùng.
- CASH-02: thu bán hàng cập nhật expected cash đúng.
- CASH-03: chi từ két/direct, category, reason, ảnh hóa đơn; validation file.
- CASH-04: hoàn chi một/nhiều expense, partial/full; allocation và balance đúng.
- CASH-05: đóng ca, counted vs expected, chênh lệch; sai PIN/quyền.
- CASH-06: báo cáo ca, reopen policy, lịch sử và audit.

### PAY — Thanh toán ngân hàng/provider

- PAY-01: QR reference đúng bill và giới hạn ký tự.
- PAY-02: webhook thiếu/sai/đúng secret/signature cho VietQR, SePay, Casso, payOS.
- PAY-03: cùng external ID gửi lặp/song song chỉ ghi/credit một lần.
- PAY-04: underpay không đóng bill; exact/overpay theo policy; unmatched/claimed.
- PAY-05: payOS create/poll/cancel/expired và callback replay.
- PAY-06: card approve/decline/timeout; txn id/RRN/approval/mask/terminal lưu đúng.
- PAY-07: log/audit không lộ secret, PIN, token, số thẻ đầy đủ.

### INV — Hóa đơn điện tử/MISA và thuế

- INV-01: buyer cá nhân/doanh nghiệp; MST, tên, địa chỉ, email validation.
- INV-02: issue từ order paid; unpaid bị chặn; một order không phát hành trùng.
- INV-03: MISA success, timeout, auth fail, validation fail, retry/backoff.
- INV-04: app/server restart lúc queued/sending; worker resume idempotent.
- INV-05: cancel cần quyền/PIN/reason; audit old→new đầy đủ.
- INV-06: PDF/XML/download/preview; file thiếu; tra cứu.
- INV-07: invoice request từ Haravan/online đi cùng order và báo cáo quá hạn.

### ONLINE — Kênh online và Haravan

- ONL-01: webhook từng kênh đúng/sai/missing secret; payload sai schema.
- ONL-02: external order replay/song song chỉ tạo một order.
- ONL-03: confirm/reject/assign branch/status/return/complete; realtime.
- ONL-04: order paid/customer/address/items/shipping được map đúng.
- HAR-01: install/callback/status; token/secret mask và branch scope.
- HAR-02: subscribe/unsubscribe/test webhook; callback HTTPS xác thực được.
- HAR-03: orders create/update/cancel/paid/fulfilled/delete theo các topic đã subscribe.
- HAR-04: customer create/update; nhận diện SĐT/email và không nhân bản hồ sơ.
- HAR-05: product create/update/delete, variant/SKU/image/category/price/status.
- HAR-06: inventory đúng `locationId`; location khác bị ignore; inbound không tạo movement giả.
- HAR-07: POS sale/refund/adjust tạo push tồn một lần; retry không lặp lịch sử.
- HAR-08: full sync và delta sync; cursor; rate-limit; API 401/429/500 và resume.
- HAR-09: sync flags orders/products/inventory tắt thật sự chặn từng luồng.
- HAR-10: sync log rõ success/ignored/error, không spam một lỗi lặp.

### PRINT — Máy in, bill và tem

- PRINT-01: discover/list/config/test từng printer.
- PRINT-02: routing theo station/type/branch; số bản.
- PRINT-03: ESC/POS 58/80 mm, Unicode, logo, QR, cắt giấy, mở két.
- PRINT-04: tem SKU/lot/HSD/barcode, số lượng nhiều.
- PRINT-05: printer offline/hết giấy/agent lỗi; job failed, retry, reprint và audit đúng một lần.
- PRINT-06: preview phải khớp output; mẫu cực dài không crash/layout overflow.

### REP — Dashboard, báo cáo và kế toán

- REP-01: dashboard totals đối chiếu trực tiếp order/payment/refund/expense.
- REP-02: today/custom date/branch/channel/user/method filters.
- REP-03: online + offline, product best seller, customer repeat, inventory value.
- REP-04: report catalog/preview/export; CSV/XLSX/PDF mở được và số liệu khớp.
- REP-05: permissions chỉ thấy report/branch được cấp.
- REP-06: realtime stats dirty cập nhật; socket mất thì refresh phục hồi.
- REP-07: accounting ledger/tax/payment/shift views đối chiếu nguồn.

### DB — Database, audit, system log và tài liệu

- DB-01: status, integrity check, size/path chỉ đúng DB đang chạy.
- DB-02: backup tạo file nhất quán; restore vào staging; restart vẫn đủ dữ liệu.
- DB-03: reset transaction cần đúng PIN, preview scope, không xóa config/master data ngoài mô tả.
- DB-04: clone-to-staging không thay đổi runtime DB production.
- DB-05: audit filter/search/detail/copy JSON/resolve; một nghiệp vụ không hiện thành ba log trùng.
- DB-06: system log dedup theo fingerprint/outage; mark resolved; retention/compact/rehydrate.
- DB-07: crash marker clean/unclean exit; không báo crash giả sau shutdown bình thường.
- DB-08: document upload/download/preview/rename/delete; MIME/size/hash duplicate/path traversal.
- DB-09: config export/import với schema validation; secret không lộ trong export thường.

## 8. Cross-cutting: mọi module phải chạy thêm

### Quyền và chi nhánh

- Không token: 401; token đúng nhưng thiếu quyền: 403; không dùng 500 thay cho hai trường hợp này.
- Owner/manager/cashier/warehouse/read-only cho cùng một hành động.
- ID của chi nhánh khác không được đọc/sửa bằng thay URL/body.
- PIN sai/đúng; PIN không xuất hiện trong log/audit/request detail hiển thị.

### Idempotency và concurrency

- Double-click nút Save/Pay/Issue/Receive.
- Hai thiết bị cùng sửa order/cart/stocktake.
- Webhook giống nhau gửi tuần tự và song song.
- Timeout sau server đã commit rồi client retry.
- Kỳ vọng: một business record, một movement/payment/invoice chính thức; phản hồi retry an toàn.

### Lỗi, offline và lifecycle

- API 400/401/403/404/409/429/500, timeout và connection refused.
- Tắt/bật Wi-Fi; socket reconnect; app background/foreground; kill/restart.
- Không fake success; trạng thái loading kết thúc; retry không nhân đôi dữ liệu.
- Một nguyên nhân chỉ tạo một thông báo/log trong cửa sổ dedup phù hợp.

### UI/UX và accessibility

- Desktop keyboard tab/enter/escape, focus nhìn thấy, shortcut không kích hoạt nhầm.
- Touch target, scroll, keyboard che form, portrait/landscape.
- Việt/Anh, Unicode, text dài, số lớn, dữ liệu rỗng.
- Contrast, tooltip cho icon-only, semantic label cho control quan trọng.
- Không RenderFlex overflow, setState during build, ListTile Material warning hoặc uncaught runtime error.

### Hiệu năng và độ bền

- Catalog 10.000 SKU, 5.000 customer, 100.000 order/audit, 500 dòng report.
- p95 API đọc thường <500 ms LAN; thao tác ghi thường <1 s; report lớn có progress và không block UI.
- 20 thiết bị socket, burst 100 webhook, 10 checkout song song trên DB QA.
- Soak 8 giờ: memory/CPU/file descriptors/log size không tăng vô hạn.

### Bảo mật

- Rate-limit login, public self-order, webhook, upload/publish.
- SQL injection, path traversal, oversized JSON/upload, MIME giả, malformed JSON.
- CORS production, security headers, CSP theo kiến trúc WebView hiện tại.
- Timing-safe secret compare cho mọi webhook.
- Token/secret/PIN/card data không xuất hiện ở API public, UI log, audit export hoặc crash report.

## 9. Tự động hóa tối thiểu cần bổ sung

Ưu tiên theo rủi ro; không tự động hóa mọi pixel:

1. Node integration: auth/permission/branch guard cho toàn route registry.
2. Node integration: order→KDS→payment→inventory→report.
3. Node integration: retail checkout/refund, ca/két và idempotency.
4. Node integration: warehouse receive/issue/transfer/stocktake và rollback khi lỗi.
5. Node integration: e-invoice queue/retry/idempotency.
6. Node integration: webhook providers và online/Haravan replay/concurrency.
7. DB test: migration hai lần, backup/restore, foreign key/integrity.
8. Flutter widget: launcher visibility theo flavor/quyền; mọi settings panel narrow/wide.
9. Flutter widget: POS/Retail cart mutations, dialog cancel/save, error states.
10. Windows integration: second-window startup handshake, add/remove loop và update installer.
11. Android integration: notification locale/dedup, updater, lifecycle và scanner.

Mỗi test không-trivial phải dùng DB/temp directory riêng và dọn sau run; tuyệt đối không trỏ vào production DB.

## 10. Phân hạng và xử lý lỗi

| Mức | Ví dụ | Quyết định |
|---|---|---|
| Blocker | Không boot/login, migration hỏng, mất DB | Dừng toàn bộ release |
| Critical | Crash, sai tiền/tồn, thanh toán/hóa đơn trùng, vượt quyền | Dừng release |
| High | Luồng chính không hoàn thành, realtime/in sai gây vận hành sai | Dừng release |
| Medium | Nhánh phụ lỗi có workaround, layout nghiêm trọng | Fix hoặc có chấp thuận rõ |
| Low | Text/căn chỉnh nhỏ, không ảnh hưởng nghiệp vụ | Có thể đưa backlog |

Bug report bắt buộc có build/app/device, role/branch, dữ liệu, bước tái hiện, expected/actual, ảnh/video, log ID, request/correlation ID và row DB liên quan. Sau fix phải chạy lại case lỗi, suite module và P0 regression; không chỉ thử đúng một nút vừa sửa.

## 11. Exit criteria và sign-off

- Gate 0–5 đều PASS trên đúng artifact release candidate.
- 100% module active có suite hoàn thành.
- 100% Click Coverage Ledger đạt PASS hoặc N/A có lý do được QA lead duyệt.
- 100% P0/P1; ít nhất 95% P2; không blocker/critical/high mở.
- Không crash mới, không log error Flutter/native, không duplicate business event.
- Tiền, tồn, thuế, báo cáo đối chiếu về 0 sai lệch trên bộ dữ liệu chuẩn.
- Backup/restore và rollback staging được chứng minh.
- Sign-off: QA lead + vận hành POS + kế toán + kho + owner sản phẩm.

## 12. Lịch chạy đề xuất

Thứ tự phát hành đã chốt: Desktop hoàn tất và ký Desktop Gate trước; sau đó mới chạy Tablet, cuối cùng Phone. Runbook thao tác Desktop nằm tại [DESKTOP_QA_RUNBOOK.md](DESKTOP_QA_RUNBOOK.md).

- Desktop ngày 1: dựng QA, seed, inventory control/API, automation và artifact.
- Desktop ngày 2: Auth, Launcher, Settings, permission/branch, click sweep.
- Desktop ngày 3: POS FnB, Self-order, KDS, print, màn hình phụ.
- Desktop ngày 4: Retail, kho, purchase, contacts, ca/két/expense.
- Desktop ngày 5: payments, invoice/MISA, online/Haravan, report/database.
- Desktop ngày 6: security, concurrency, soak, backup/restore, upgrade/rollback và sign-off Desktop.
- Tablet: bắt đầu sau Desktop Gate; chạy module subset + responsive/touch/lifecycle/notification/update.
- Phone: bắt đầu sau Tablet Gate; chạy module subset + màn hẹp/lifecycle/notification/update.

Lịch này giả định có ít nhất 2 tester và người phụ trách kho/kế toán hỗ trợ dữ liệu nghiệp vụ. Một tester vẫn chạy được nhưng không được giảm phạm vi; thời gian tăng tương ứng.

## 13. P0 smoke sau mỗi build

Chạy trong 30–45 phút:

1. Cài/nâng cấp, boot, login, đổi chi nhánh.
2. POS mở ca→tạo order→KDS nhận→pay→receipt.
3. Retail add/remove→checkout→refund.
4. Kho nhận→chuyển→stocktake nhỏ.
5. Màn hình phụ add/remove/QR/open-hide.
6. Haravan webhook duplicate và inventory đúng location.
7. Dashboard/report phản ánh giao dịch.
8. Audit/log không duplicate/error; DB integrity PASS.
9. Logout/restart; dữ liệu còn nguyên; update check đúng.

Nếu một bước P0 fail, build không được đưa cho tester tiếp tục exploratory vì kết quả phía sau không còn đáng tin.
