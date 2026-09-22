# Dan D Pak POS — danh sách ảnh cần chụp

Chụp ở độ phân giải gốc, không dùng ảnh nén qua Zalo/Messenger. Nên dùng dữ liệu mẫu, không để lộ số điện thoại, email, MST, tài khoản ngân hàng, PIN hay dữ liệu thật của khách. Mỗi ảnh chỉ cần khoanh đúng vùng thao tác; chưa cần tự vẽ mũi tên vì ảnh sẽ được biên tập đồng bộ sau.

## Trạng thái thực hiện

- ✅ Đã nhận đủ **37 vị trí ảnh chuẩn + 4 ảnh bổ sung** từ `G:\37 ảnh` và gắn vào toàn bộ 12 bài hướng dẫn.
- ✅ Dùng nguyên bản ảnh nội bộ theo xác nhận của chủ dự án; không che tên nhân viên trên ảnh.
- ✅ Chú thích ba ngôn ngữ đã được sửa theo đúng màn hình thực tế: màn danh sách, nút tạo phiếu và màn phiếu đang nhập.
- ✅ Bộ 41 ảnh hiện tại được chốt là bản chính thức cho 12 bài Kho/Retail/F&B/Thanh toán.
- ⏳ Đợt mở rộng Báo cáo/Quản lý/Hóa đơn/Kế toán/Cài đặt/Lỗi cần **27 ảnh Desktop/Tablet** bên dưới. Ảnh `mobile-00-placeholder.png` chưa chụp cho đến khi bản Mobile nghiệm thu.

## Quy cách bàn giao

- Định dạng gốc: PNG; chụp toàn cửa sổ app, không chụp bằng camera điện thoại.
- Tên file: dùng chính xác tên bên dưới. Nếu gửi file gốc khác tên, ghi kèm số thứ tự.
- Dữ liệu mẫu thống nhất: chi nhánh `Dan D Pak Demo`, kho `Kho bán lẻ`, bàn `A01`, khách `Khách Demo`.
- Với popup, phải thấy cả popup và đủ phần màn hình nền để nhận biết người dùng đang ở đâu.
- Với bước thanh toán/HĐĐT, che số tài khoản, mã giao dịch, email, SĐT và MST thật.

## A. Bắt đầu

| # | Tên file | Màn hình cần chụp | Trạng thái cần có |
|---|---|---|---|
| 01 | `start-01-branch-login.png` | Đăng nhập/chọn chi nhánh | Danh sách nhân viên và chi nhánh; không hiện PIN. |

## B. Kho hàng

| # | Tên file | Màn hình cần chụp | Trạng thái cần có |
|---|---|---|---|
| 02 | `warehouse-01-create-menu.png` | Kho → Tồn kho → Tạo mới | Menu hiện Hàng hóa hoặc Nguyên liệu/Vật dụng. |
| 03 | `warehouse-02-product-form.png` | Form Thông tin hàng hóa | Thấy tên, mã, mã vạch, nhóm, đơn vị, giá, VAT, quản lý lô/HSD. |
| 04 | `warehouse-03-conversion-units.png` | Form hàng hóa → Biến thể/đơn vị quy đổi | Ví dụ Chai, Lốc = 6, Thùng = 24. |
| 05 | `warehouse-04-supplier-list.png` | Kho → Nhà cung cấp | Danh sách và panel chi tiết một NCC demo. |
| 06 | `warehouse-05-goods-receipt.png` | Kho → Nhập hàng → phiếu mới | Có kho, NCC, ít nhất 2 dòng; một dòng có lô/HSD. |
| 07 | `warehouse-06-quick-receive.png` | Chi tiết hàng hóa → Nhập | Popup có số lượng, lô, HSD, giá vốn, NCC. |
| 08 | `warehouse-07-stocktake-form.png` | Kiểm kho → phiếu đang nhập | Thấy Tồn kho, SL thực tế, Lô, HSD và Lệch. |
| 09 | `warehouse-08-stocktake-approve.png` | Chi tiết phiếu kiểm tạm | Có vài dòng lệch và nút Cân bằng kho. |
| 10 | `warehouse-09-transfer-form.png` | Chuyển hàng → phiếu mới | Thấy Từ kho, Tới kho, tồn và SL chuyển. |
| 11 | `warehouse-10-internal-issue.png` | Xuất dùng nội bộ → phiếu mới | Có kho xuất, hàng, số lượng và lý do. |
| 12 | `warehouse-11-purchase-return.png` | Trả hàng nhập → phiếu mới | Có NCC, kho, hàng/lô, số lượng và tham chiếu. |
| 13 | `warehouse-12-lot-expiry.png` | Kho → Lô & HSD | Có lô còn hạn, sắp hết hạn và/hoặc hết hạn. |
| 14 | `warehouse-13-price-book.png` | Kho → Thiết lập giá | Thấy bảng giá, VAT, giá vốn/giá nhập cuối và giá bán. |
| 15 | `warehouse-14-stock-history.png` | Kho → Lịch sử | Một mã hàng có nhiều loại chuyển động và mã chứng từ. |

## C. Retail

| # | Tên file | Màn hình cần chụp | Trạng thái cần có |
|---|---|---|---|
| 16 | `retail-01-cart.png` | Bán lẻ | Ô quét/tìm, 2–3 dòng hàng, số lượng và tổng giỏ. |
| 17 | `retail-02-customer-total.png` | Bán lẻ → giỏ | Đã chọn Khách Demo; thấy ưu đãi/giảm và tổng phải thu. |
| 18 | `retail-03-checkout.png` | Bán lẻ → Thanh toán | Popup có các phương thức và số tiền cần thu. |
| 19 | `retail-04-item-promotion.png` | Mở một dòng hàng → CTKM | Danh sách CTKM item, có một lựa chọn đủ điều kiện. |
| 20 | `retail-05-bill-discount.png` | Khu vực tổng bill | Nút CTKM bill, giảm thủ công và bản xem trước tổng giảm. |
| 21 | `retail-06-notes.png` | Giỏ Retail | Thấy vị trí ghi chú item và ghi chú toàn bill. Có nội dung demo. |
| 22 | `retail-07-return.png` | Hóa đơn gốc → Trả hàng | Danh sách dòng và ô số lượng trả; chưa bấm hoàn tất. |

## D. F&B và xác nhận Tablet/BYOD

| # | Tên file | Màn hình cần chụp | Trạng thái cần có |
|---|---|---|---|
| 23 | `fnb-01-floor-table.png` | POS Cashier → sơ đồ bàn | Có bàn trống, bàn đang mở và bàn chờ thanh toán nếu có. |
| 24 | `fnb-02-item-modifier-note.png` | Chọn món | Popup size/topping/modifier/combo và ghi chú món. |
| 25 | `fnb-03-kds-status.png` | KDS | Có ticket ở ít nhất 2 trạng thái và đúng trạm. |
| 26a | `fnb-04-move.png` | Bill bàn → Chuyển bàn | Popup chọn bàn đích còn trống. |
| 26b | `fnb-04-merge.png` | Bill bàn → Gộp bàn | Popup chọn bill/bàn đích hoặc trạng thái không có bàn phù hợp. |
| 27 | `fnb-05-pending-bell.png` | POS Cashier | Chuông/banner và badge có ít nhất 1 đơn chờ. |
| 28 | `fnb-06-pending-detail.png` | Popup Món khách vừa gọi | Thấy bàn, nguồn Tablet/BYOD, món, topping và ghi chú. |
| 29 | `fnb-07-accept-order.png` | Popup đơn chờ | Đã tick món hợp lệ và thấy nút Xác nhận (Accept). |
| 30 | `fnb-08-reject-reason.png` | Popup đơn chờ | Đã tick một món, có lý do “Hết món” và nút Từ chối. |
| 31a | `fnb-09-click-on-item-to-notes.png` | Bill F&B | Chạm dòng món và thấy thao tác Ghi chú món. |
| 31b | `fnb-09-line-note.png` | Bill F&B → Ghi chú món | Popup có nội dung ghi chú cụ thể. |
| 32 | `fnb-10-discount-actions.png` | Bill F&B | Thấy CTKM item, CTKM bill và Giảm giá thủ công. |

## E. Thanh toán và hóa đơn điện tử

| # | Tên file | Màn hình cần chụp | Trạng thái cần có |
|---|---|---|---|
| 33a | `payment-01-review-total-Retail.png` | Bill Retail trước thanh toán | Khách, tạm tính, VAT, giảm giá và phải thu. |
| 33b | `payment-01-review-total-F&B.png` | Bill F&B trước thanh toán | Tạm tính, điều chỉnh, VAT và phải thu. |
| 34 | `payment-02-methods.png` | Popup Thanh toán | Ít nhất 2 dòng phương thức để minh họa thanh toán hỗn hợp. |
| 35a | `payment-03-qr-confirm.png` | Thanh toán QR trên POS | QR và trạng thái đang chờ/đã xác nhận. |
| 35b | `payment-03-qr-confirm-customer-view.png` | Màn hình khách hàng | QR và đúng số tiền khách cần chuyển. |
| 36 | `payment-04-buyer-info.png` | Thông tin xuất HĐĐT | Tên công ty, MST, địa chỉ, email đều là dữ liệu demo. |
| 37 | `payment-05-issue-invoice.png` | Xem trước/phát hành HĐĐT | Thấy tổng, VAT, thông tin người mua và nút phát hành. |

## Thứ tự chụp đề xuất

Để ít phải tạo lại dữ liệu, chụp theo thứ tự: `02–15` (Kho) → `16–22` (Retail) → `23–32` (F&B + Tablet/BYOD) → `33–37` (thanh toán/HĐĐT) → `01` (đăng nhập/chọn chi nhánh).

## F. Báo cáo — ảnh mới cần chụp

| Tên file | Màn hình cần chụp |
|---|---|
| `reports-01-center.png` | Quản lý → Báo cáo: thấy nhóm báo cáo, Từ/Đến và bộ lọc chi nhánh. |
| `reports-02-preview.png` | Một báo cáo đã xem trước: thấy chỉ số tổng và bảng chi tiết. |
| `reports-03-export.png` | Khu vực nút xuất Excel/PDF và thời điểm tạo. |

## G. Quản lý — ảnh mới cần chụp

| Tên file | Màn hình cần chụp |
|---|---|
| `management-01-dashboard.png` | Dashboard đúng chi nhánh, có doanh thu/bill/cảnh báo. |
| `management-02-menu.png` | Danh mục và danh sách món. |
| `management-03-recipe.png` | Form món có recipe, trạm chế biến và lịch bán. |
| `management-04-users.png` | Danh sách nhân viên và vai trò, không lộ PIN. |
| `management-05-permissions.png` | Ma trận quyền theo nhóm nghiệp vụ. |
| `management-06-audit.png` | Nhật ký hoạt động và bộ lọc. |

## H. Hóa đơn — ảnh mới cần chụp

| Tên file | Màn hình cần chụp |
|---|---|
| `invoice-01-list.png` | Danh sách hóa đơn, các ô tổng trạng thái và bộ lọc. |
| `invoice-02-detail.png` | Chi tiết bill, dòng hàng và trạng thái HĐĐT. |
| `invoice-03-issue.png` | Màn xem lại người mua/mẫu/thuế trước khi phát hành. |
| `invoice-04-actions.png` | Chi tiết có Đồng bộ, Thử lại, Email, PDF, Nhật ký kỹ thuật. |

## I. Kế toán — ảnh mới cần chụp

| Tên file | Màn hình cần chụp |
|---|---|
| `accounting-01-tax-profile.png` | Hồ sơ thuế, địa điểm và nhóm doanh thu; dùng dữ liệu demo. |
| `accounting-02-bank.png` | Tài khoản ngân hàng và phương thức thanh toán; che số thật. |
| `accounting-03-misa.png` | Trạng thái kết nối MISA; che credential. |
| `accounting-04-shift.png` | Mở ca/tiền đầu ca/trạng thái ca. |
| `accounting-05-close.png` | Kết ca: tiền hệ thống, tiền đếm và chênh lệch. |

## J. Cài đặt — ảnh mới cần chụp

| Tên file | Màn hình cần chụp |
|---|---|
| `settings-01-overview.png` | Toàn bộ 12 nhóm Cài đặt. |
| `settings-02-printers.png` | Danh sách máy in, thiết bị và loại tuyến. |
| `settings-03-template.png` | Bộ thiết kế Bill & Tem nhãn. |
| `settings-04-guest-device-phone.png` | Thiết bị khách trên điện thoại và trạng thái kết nối. |
| `settings-04-guest-device-tablet.png` | Thiết bị khách trên Tablet và trạng thái kết nối. |
| `settings-05-customer-display.png` | Cấu hình màn hình phụ dành cho khách. |
| `settings-05-customer-display-BYOD.png` | Banner và cấu hình trải nghiệm BYOD. |
| `settings-06-integrations.png` | Danh sách liên kết và trạng thái; che token. |

## K. Xử lý lỗi — ảnh mới cần chụp

| Tên file | Màn hình cần chụp |
|---|---|
| `trouble-01-desktop-status.png` | Desktop: trạng thái kết nối, phiên bản và thiết bị. |
| `trouble-02-tablet-status.png` | Tablet: chi nhánh, bàn và kết nối. |
| `trouble-03-byod-invalid.png` | BYOD: QR không hợp lệ hoặc phiên đã hết. |

## L. Mobile — giữ chỗ, chưa chụp

`mobile-00-placeholder.png` chỉ chụp sau khi quy trình Mobile được nghiệm thu. Các bộ dự kiến tiếp theo là `mobile-01…26`; xem bài `/vi/dien-thoai/trang-thai-va-ke-hoach/` để biết nhóm màn hình.
