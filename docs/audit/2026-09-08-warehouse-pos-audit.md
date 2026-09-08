# Audit kho, in bếp, hoàn tiền và POS F&B — 2026-09-08

Phạm vi audit gồm 22 ảnh chụp do người dùng cung cấp, mã Flutter desktop/tablet/phone, API Node/Express, SQLite schema và các service nghiệp vụ. Mọi thay đổi sau tài liệu này phải giữ tương thích dữ liệu cũ, dùng migration cộng thêm và không xuất bản production.

## IMPORT-01 — Import Excel bị chặn bởi đơn giá nhập

- **Hiện tượng:** thiếu cột hoặc để trống `Đơn giá nhập` làm hủy toàn bộ file; người dùng không có màn staging để sửa từng dòng.
- **Bằng chứng:** `KvSpreadsheetData.requireColumn()` ném lỗi cấp file. `purchase_doc_form_page.dart` gọi `requireColumn(costAliases)` và `numberCell(required: true)` trước khối `try/catch` từng dòng.
- **Nguyên nhân gốc:** validation cấu trúc và validation ô dữ liệu bị gộp; giá mua bị coi là khóa nhận diện bắt buộc dù mã/tên, đơn vị và số lượng mới là dữ liệu tối thiểu của chứng từ.
- **Phạm vi ảnh hưởng:** nhập hàng, trả hàng nhập, chuyển hàng, xuất nội bộ, kiểm kho và mọi màn dùng chung `kv_excel.dart`.
- **Giải pháp:** chỉ lỗi cấu trúc thật sự mới chặn mở file; đưa lỗi dữ liệu vào staging theo dòng/ô; cho sửa, khớp SKU, bỏ dòng hoặc tạo SKU; giá trống dùng giá mua gần nhất cho SKU đã có, còn SKU mới dùng 0 kèm cảnh báo; draft không ghi nhận tồn và Complete thực hiện một transaction/idempotency key.

## RECEIVING-LOT-02 — Chứng từ chưa biểu diễn nhiều lô

- **Hiện tượng:** bật quản lý lô/HSD nhưng một mặt hàng chỉ có một ô lô và HSD; không nhập được nhiều lô cho cùng dòng.
- **Bằng chứng:** inventory core đã có `stock_lots`, FEFO theo `expiry_date, received_at` và chuyển kho bảo toàn lot; `purchase_order_lines` cùng UI chỉ giữ `lot_no/expiry_date` đơn.
- **Nguyên nhân gốc:** mô hình tồn kho chi tiết tốt hơn mô hình chứng từ nhận hàng, khiến allocation nhiều lô bị làm phẳng.
- **Phạm vi ảnh hưởng:** nhập hàng, chuyển kho, kiểm kho, trả hàng nhập và rollback chứng từ.
- **Giải pháp:** thêm bảng allocation lô theo dòng chứng từ; tổng số lượng allocation phải bằng số lượng dòng; HSD bắt buộc chỉ chặn Complete; giữ lô khi chuyển, FEFO khi xuất, kiểm kho theo lô và trả đúng lô nguồn.

## PRODUCT-MODEL-03 — Form hàng hóa trộn nhiều aggregate

- **Hiện tượng:** một modal chứa master data, giá nhập, giá bán, tồn tối thiểu và tồn đầu kỳ.
- **Bằng chứng:** `_SkuEditDialog` ghi cả `skus.cost`, price book và `opening_stock`; `createSku` chèn SKU trước rồi mới nhận tồn đầu.
- **Nguyên nhân gốc:** ranh giới Product / Pricing / Purchasing / Inventory chưa rõ; `cost` master bị dùng như lịch sử mua gần nhất.
- **Phạm vi ảnh hưởng:** audit tồn đầu, báo cáo giá vốn và lỗi nửa chừng khi tạo hàng.
- **Giải pháp:** chia section theo aggregate; giá mua chỉ là tham chiếu/giá gần nhất; tồn đầu tạo bằng chứng từ nhập tồn có movement và audit, không chỉnh trực tiếp master.

## KITCHEN-04 — Preview và bản in không dùng cùng document

- **Hiện tượng:** preview là bảng ASCII `+ - |`, bản in Windows và ESC/POS lệch wrap; một lần gửi có thể ra nhiều phiếu.
- **Bằng chứng:** Flutter có `_kitchenItemsSample`; server có `kitchenTableLines`; Windows lại dùng `buildKitchenDoc`; `splitPerItem` mặc định thành true khi chưa cấu hình.
- **Nguyên nhân gốc:** ba renderer dựng nội dung riêng và quyết định chia job nằm ở cấu hình legacy.
- **Phạm vi ảnh hưởng:** preview, Windows/GDI, ESC/POS và số lượng job in.
- **Giải pháp:** một semantic print document; renderer Windows/ESC-POS chỉ chuyển document sang lệnh đích; gom tất cả món mới chưa gửi thành một ticket cho mỗi đích/station, ghi chú nằm ngay dưới món và không in lại món cũ.

## KITCHEN-ROUTING-05 — Station là chuỗi hard-code

- **Hiện tượng:** danh sách station cố định trong client và map `STATION_PRINTER` cố định trên server.
- **Bằng chứng:** menu form dùng `_stationLabels`; printing service map `kitchen/salad/bar/beverage`.
- **Nguyên nhân gốc:** chưa có station entity theo chi nhánh và quan hệ route dữ liệu.
- **Phạm vi ảnh hưởng:** món, nhóm món, printer route, KDS và in bếp.
- **Giải pháp:** entity station theo branch có create/edit/hide; category default + item override; route máy in tham chiếu station/category; server là nơi duy nhất quyết định đích.

## IMAGE-06 — Ảnh hợp lệ vẫn có thể thành placeholder

- **Hiện tượng:** đường dẫn PNG được lưu nhưng preview/tablet hiện emoji hoặc placeholder.
- **Bằng chứng:** server chỉ nhận JPEG/PNG/WebP/GIF; client suy MIME từ extension; widget preview có nơi truyền đường dẫn tương đối thẳng vào `Image.network`.
- **Nguyên nhân gốc:** thiếu pipeline decode/normalize chung và canonical URL; MIME khai báo, magic bytes và khả năng decoder chưa được nối thành một hợp đồng.
- **Phạm vi ảnh hưởng:** hàng hóa, món F&B, catalogue và self-order.
- **Giải pháp:** kiểm magic bytes; hỗ trợ/convert các định dạng decoder cho phép sang WebP/JPEG/PNG, giữ orientation, tạo thumbnail; từ chối file giả/SVG chưa sanitize; trả canonical URL có revision/cache busting và dùng resolver chung ở client.

## PRINTER-UI-07 — Trạng thái và cấu hình máy in bị lặp

- **Hiện tượng:** cùng máy in xuất hiện ở hai section “Trạng thái máy in” và “Danh mục in”.
- **Bằng chứng:** `settings_connections_panel.dart` dựng hai widget độc lập từ `printerStatuses` và `_printers`.
- **Nguyên nhân gốc:** live telemetry và persistent config chưa join thành một view model theo `(device_id, os_printer_name)`.
- **Phạm vi ảnh hưởng:** cấu hình, test print, chẩn đoán mất kết nối.
- **Giải pháp:** bỏ section trạng thái riêng; merge trạng thái vào card danh mục, hiển thị thiết bị, tên OS, last-seen, lỗi gần nhất, job types, routes, paper, copies và test print.

## RETURN-PROMO-08 — Hoàn tiền dùng gross thay vì net (P0)

- **Hiện tượng:** bill niêm yết 240.000đ nhưng thực thu 200.000đ, màn trả hàng đề xuất hoàn 240.000đ.
- **Bằng chứng:** Flutter `_returnTotal = qty * unit_price`; backend `createReturn` cũng tính `wanted * it.unit_price`, sau đó mới so với `order.total`.
- **Nguyên nhân gốc:** return không đọc immutable sale snapshot và chưa có allocation khuyến mãi/VAT theo dòng.
- **Phạm vi ảnh hưởng:** khuyến mãi toàn đơn, combo/tặng hàng, partial return, mixed tender và báo cáo VAT.
- **Giải pháp:** lưu/đọc net allocation bất biến; phân bổ discount theo tỷ trọng với quy tắc phần dư xác định; free item net=0; cap tổng refund bằng số thực thu và thực hiện trong `BEGIN IMMEDIATE`; lưu gross/promo/net/VAT trên dòng trả.

## POS-FNB-09 — Sai origin, panel không đóng và thông báo trùng

- **Hiện tượng:** món thu ngân thêm bị xem là khách tự gọi; có cả banner đen và nút đỏ; bấm nút đỏ chỉ tắt; panel bàn không đóng khi bấm vùng trống.
- **Bằng chứng:** `needsStaffConfirm` gồm cả `source === 'staff_pos' && table_id`; `RingOverlay` gọi `acknowledge()`; floor map không có blank-tap callback/Escape.
- **Nguyên nhân gốc:** origin contract không canonical và hai presentation layer quản lý trạng thái đọc riêng.
- **Phạm vi ảnh hưởng:** POS cashier, tablet self-order, socket/push, badge và điều hướng bàn.
- **Giải pháp:** canonical origin `cashier/customer_tablet/self_order/sync/external_channel` (map alias legacy); chỉ origin khách phát pending notification; một store dedupe theo event key, click điều hướng đúng zone/table/order/item và lưu read; blank/Escape/close bỏ chọn bàn; target chạm tối thiểu 44px.

## Đối chiếu workflow KiotViet

- Nhập hàng: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-giao-dich/nhap-hang/
- Hàng hóa theo lô/HSD và FEFO: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-hang-hoa/hang-hoa-lo-han-su-dung/
- Kiểm kho: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-hang-hoa/kiem-kho/
- Chuyển hàng: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-hang-hoa/chuyen-hang/
- Trả hàng nhập: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-giao-dich/tra-hang-nhap/
- In bar/bếp: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/in-bar-bep-kvprinter/su-dung-in-bar-bep/

