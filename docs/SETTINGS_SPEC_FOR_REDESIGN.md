# Cài đặt trên máy POS cầm tay — Đặc tả bàn giao thiết kế

Tài liệu bàn giao cho người thiết kế lại giao diện Cài đặt cho **máy POS cầm tay
Sunmi V2** (và điện thoại nói chung).

Mã nguồn: `flutter-apps/dandpak_core/lib/src/screens/management/`
Cửa vào: `settings_screen.dart` → `settings_tab.dart` → các panel con.

---

## 1. Bối cảnh thiết bị

| | |
|---|---|
Máy | Sunmi V2 — POS cầm tay Android, có máy in nhiệt gắn liền ở đầu máy |
Hướng màn hình | **Khoá dọc, một hướng duy nhất** (không xoay được) |
Bề ngang | ~393dp — mọi thứ rộng hơn con số này đều tràn |
Người dùng | Nhân viên bán hàng, đứng, **cầm một tay**, có thể đeo găng hoặc tay ướt |
Bối cảnh dùng | Giữa ca bán, ánh sáng cửa hàng, thao tác nhanh |

Vì đây là máy cầm tay dùng khi đang đứng bán, mọi thao tác chính nên nằm trong
**tầm ngón cái** — nghĩa là nửa dưới màn hình.

---

## 2. Vì sao phải thiết kế lại

Cài đặt hiện được **bê nguyên từ desktop/tablet**. Nó không xấu — nó được dựng cho
màn rộng, và trên màn 5.45 inch thì các giả định đó vỡ. Bằng chứng lấy từ mã nguồn:

**Điều hướng vỡ ở ngưỡng 820px.** `settings_tab.dart` dòng 113:

```dart
final wide = constraints.maxWidth >= 820;
if (wide)  → cột trái 270px + nội dung bên phải
else       → dải ngang cao 64px chứa hết các mục, cuộn ngang
```

Máy cầm tay luôn rơi vào nhánh dưới: **các mục dồn vào một dải cuộn ngang cao
64px**. Người dùng không thấy được có bao nhiêu mục, phải quẹt mò để tìm.

**20 chỗ đặt bề rộng cứng** trong các panel: `330`, `380`, `340`, `310`, `300`,
`220`, `180`, `150`. Màn rộng 393px — những hộp 330–380px chiếm gần trọn bề ngang
hoặc tràn.

**Hàng nhiều cột.** Nhiều panel xếp nhãn + ô nhập + nút trên cùng một hàng ngang.

---

## 3. Ba mục đã gỡ khỏi bản điện thoại

Đã bỏ trong `settings_tab.dart`, **không cần thiết kế lại**:

| Mục | Lý do gỡ |
|---|---|
| Bill & Tem nhãn | Canvas kéo thả, không dùng nổi bằng ngón tay |
| Nhân sự & Phân quyền | Ma trận nhóm × quyền, hàng chục ô đánh dấu |
| Kết nối | Đã chuyển việc nối máy in ra **Nhiều hơn → Máy in** |

Desktop và tablet **vẫn giữ đủ 12 mục** — đây là bỏ bớt trên màn nhỏ, không phải
xóa tính năng.

**Nối máy in giờ nằm ở Nhiều hơn → Máy in** (đã làm xong, có thể xem làm mẫu):
bảng trượt từ đáy, một cột — Tên máy in · Địa chỉ IP · Cổng · Loại phiếu · công
tắc "Có nối ngăn kéo đựng tiền". Tệp `screens/phone/phone_printer_setup.dart`.

---

## 4. Chín mục cần thiết kế lại

Xếp theo **tần suất dùng thật ngoài cửa hàng** — quan trọng cho việc quyết định
mục nào lên trên.

| # | Mục | Tần suất | Độ khó |
|---|---|---|---|
| 1 | **Thực đơn (Menu)** | Hằng ngày | Khó |
| 2 | **Tích điểm & Khuyến mại** | Hằng tuần | Khó |
| 3 | **Kho & kênh bán** | Hằng tuần | Vừa |
| 4 | **Cấu hình bàn** | Thỉnh thoảng | Dễ |
| 5 | **Cấu hình thông báo** | Thỉnh thoảng | Vừa |
| 6 | **Liên kết** | Hiếm — lúc lắp đặt | Khó |
| 7 | **Chi nhánh** | Hiếm | Dễ |
| 8 | **Màn hình phụ** | Hiếm | Dễ |
| 9 | **Thiết bị khách** | Hiếm | Rất dễ |

---

### 1. Thực đơn (Menu) — dùng hằng ngày

`menu_tab.dart` · `menu_item_dialogs.dart` (48 KB) · `book_menu_panel.dart` (32 KB)

**Đây là mục nhân viên mở nhiều nhất** — báo hết món, bật lại món, sửa giá.

**Danh sách món**
- Ô tìm kiếm: *"Tìm món..."*
- Lọc theo nhóm: Tất cả nhóm · Salad/Lạnh · Bếp · …
- Mỗi món hiện: ảnh, tên, giá, nhóm, trạng thái
- Trạng thái: **Đang bán** · **Tạm hết** · **Ngoài lịch**
- Hai chế độ: **Thực đơn FnB** và **Menu quyển**

**Thao tác nhanh trên từng món** — cái này quan trọng nhất, nhân viên cần làm
trong hai giây giữa lúc bán:
- Bật / tắt món → *"Đã bật món"* / *"Đã tắt món"*
- Ẩn / hiện món → *"Đã ẩn món"* / *"Đã hiện món"*
- **Sửa** · **Xóa** → *"Đã xóa món"*
- Món đã có đơn thì lưu trữ chứ không xóa → *"Đã lưu trữ món (đã có order)"*

**Hộp thoại Sửa món** — nhiều trường, nên chia bước hoặc nhóm gập lại:

| Nhóm | Trường |
|---|---|
| Cơ bản | Tên món (bắt buộc) · Nhóm (bắt buộc) · Giá · Mô tả |
| Ảnh | Chọn ảnh món · Bỏ ảnh · hoặc dán đường dẫn `/uploads/menu/...` |
| Bếp | SLA phút (thời gian cam kết ra món) |
| Công thức trừ kho | Danh sách nguyên liệu · Nguyên liệu (hiển thị cho khách) |
| Dị ứng | Allergen / dị ứng |
| Món kèm | **Món ăn kèm & Extra** · **Mua thêm** · trống thì *"Chưa có món kèm / extra."* |
| Lịch bán | **Bán cả ngày** / **Theo giờ mỗi ngày** / **Theo ngày trong tuần** / **Chỉ một ngày** (Ngày bán YYYY-MM-DD) |
| Bản dịch | **Bản dịch món** → **Lưu bản dịch** |

Kiểm tra: *"Cần nhập tên món và chọn nhóm"*

> **Gợi ý**: tách "thao tác nhanh" (bật/tắt/hết món) khỏi "sửa đầy đủ". Nhân viên
> bán hàng chỉ cần cái đầu; cái sau là việc của quản lý và có thể để trên máy bàn.

---

### 2. Tích điểm & Khuyến mại — dùng hằng tuần

`settings_loyalty_panel.dart` (19 KB) + `settings_promotions_panel.dart` (30 KB)

Panel có **hai thẻ con**. Trên màn nhỏ nên tách thành hai mục riêng.

#### 2a. Tích điểm

| Nhóm | Trường |
|---|---|
| Cách tích | **Chi tiêu** · **Giới thiệu bạn bè** · **Hoàn tiền / cashback** |
| Quy đổi | **1 điểm = … VND** · **Làm tròn** · **Hóa đơn tối thiểu** |
| Đổi điểm | công tắc **Cho phép đổi điểm thành giảm giá** · **Quy đổi**: Thành voucher / Thành điểm |
| Sinh nhật | **Nhân điểm trong ngày sinh nhật** · **Hệ số nhân** |
| Hạng thành viên | danh sách: Mã · **Chi tiêu tối thiểu** · **% ưu đãi** · **Hệ số nhân** → nút **Thêm hạng** |
| Hành vi | nút **Thêm hành vi** (thêm quy tắc tích điểm) |

#### 2b. CTKM / Voucher

- **Danh sách chương trình** — trống thì *"Chưa có chương trình khuyến mại"*
- **Hình thức**: Giảm theo % / Giảm số tiền → **Giá trị**
- **Khuyến mại theo**: Hóa đơn / toàn bill · Hàng hóa / mọi SKU ·
  Hàng hóa / SKU cụ thể (→ **Chọn SKU áp dụng**) · Nhóm hàng
- **Điều kiện**: Bill tối thiểu · **Chỉ 1 lần** / Không giới hạn ·
  Lot/Date áp dụng · Không ràng buộc
- **Hiệu lực & lịch chạy**: Giờ bắt đầu · Giờ kết thúc · Chi nhánh
- **Ghi chú nội bộ / mô tả cách chạy CTKM**
- Nút: **Lưu CTKM** · **Chỉnh sửa chương trình** · bật/tắt từng chương trình

> **Gợi ý**: form CTKM nhiều nhánh phụ thuộc nhau (chọn "theo SKU" mới hiện nút
> chọn SKU). Trên màn nhỏ nên đi theo **từng bước**, mỗi bước một câu hỏi.

---

### 3. Kho & kênh bán — dùng hằng tuần

`settings_warehouse_panel.dart` (41 KB)

**Danh sách kho**: tên · mã · loại · trạng thái **Bật**/**Tắt** · nhãn **Mặc định**

**Tạo / Sửa kho**
- Tên kho (bắt buộc — *"Nhập tên kho"*) · Mã kho
- **Loại kho**: Kho retail / showroom · Kho bếp / vật dụng
- **Sắp xếp** (thứ tự hiển thị)

**Kênh bán hàng đang nối với kho này** — mỗi kho nối tới một hoặc nhiều kênh:
- RETAIL POS (bán lẻ)
- RETAIL TRONG F&B (thêm retail ở POS nhà hàng)
- POS nhà hàng
- Kênh online chung

Trống thì hiện *"Chưa nối kênh bán hàng"*.

**Bảng giá**: danh sách · **Tạo bảng giá** · Tên bảng giá · áp **Theo kênh bán**

Nút: **Tạo kho** · **Lưu cấu hình kho** · **Tắt kho** · **Mở màn Kho**
Thông báo: *"Tạo kho …"* / *"Cập nhật kho …"*

---

### 4. Cấu hình bàn — thỉnh thoảng

`settings_tables_panel.dart` (12 KB)

- Danh sách bàn **nhóm theo khu vực**
- Mỗi bàn: `Bàn <mã>` · `<n> chỗ` · trạng thái **Trống**
- Khối **XEM TRƯỚC TRÊN SƠ ĐỒ BÀN**

**Thêm / Sửa bàn**: Khu vực (gợi ý *"VD: Tầng 1, Sân vườn"*) · Số bàn / Mã bàn ·
Số chỗ ngồi

Kiểm tra: *"Cần nhập khu vực và số bàn"*
Nút: **Thêm bàn** · **Sửa** · **Xóa** · **Tạo** · **Lưu** · **Hủy**

---

### 5. Cấu hình thông báo — thỉnh thoảng

`settings_notify_routing_panel.dart` (25 KB)

- Công tắc **Bật âm thanh thông báo**
- **Âm riêng cho từng sự kiện** + nút **Nghe thử**

**Loại thông báo**:
Món mới lên màn hình bếp (KDS) · Thanh toán thành công · Khách gọi nhân viên ·
Khách tự gọi món (iPad) · Kho / Tồn thấp · Hóa đơn & Thanh toán

**Định tuyến — ai nhận thông báo nào**
- **Theo vai trò**: Quản lý · Thu ngân · Bếp → **Nhận** / **Không nhận**
- **Ghi đè theo nhân viên**: tìm nhân viên (*"Tìm nhân viên..."*) → **Luôn nhận** /
  **Không nhận** · hiện `<n> người có ghi đè`

Nút **Lưu thay đổi**

> Đây là **ma trận loại thông báo × vai trò**. Nhỏ hơn bảng phân quyền nhiều
> (6 × 3) nên vẫn làm được trên màn nhỏ, nhưng cần cách trình bày khác bảng.

---

### 6. Liên kết — hiếm, chỉ lúc lắp đặt

`settings_integrations_panel.dart` (40 KB)

Mỗi đối tác là một thẻ, có **trạng thái**: Chưa kết nối · Kết nối thành công! ·
Kết nối thất bại · Lỗi kết nối

Mỗi thẻ có ba khối: **CẤU HÌNH CHI TIẾT** · **THIẾT LẬP TÍNH NĂNG** ·
**GHI CHÚ NỘI BỘ**

| Đối tác | Trường |
|---|---|
| Hóa đơn điện tử | Mã số thuế · Tên công ty · Tài khoản / Username · Mật khẩu / Token |
| SePay | tự đối soát chuyển khoản |
| Casso | tự đối soát chuyển khoản |
| VietQR / PayOS | Số tài khoản nhận tiền · Mã ngân hàng (VCB, MB, ACB...) · Return URL · Cancel URL |
| Kênh online | **Cách nhận đơn**: Tự nhận đơn hợp lệ / Nhân viên xác nhận · công tắc **Tự in khi có đơn mới** |
| Kế toán (MISA) | Chi nhánh mặc định |

Nút: **Kiểm tra cấu hình** (→ *Kiểm tra thành công* / *Kiểm tra thất bại*) ·
**Lưu kết nối đang chọn** · **Copy**

> **Gợi ý**: đây là việc làm **một lần lúc lắp đặt**, thường do kỹ thuật làm trên
> máy bàn. Trên máy cầm tay có thể chỉ cần **xem trạng thái kết nối** và nút
> **Kiểm tra lại** — còn nhập token thì để máy bàn. Việc gõ token dài trên bàn
> phím ảo giữa ca bán là không thực tế.

---

### 7. Chi nhánh — hiếm

`settings_branches_panel.dart` (13 KB)

- Danh sách: tên · mã · trạng thái **Đang mở** / **Đã đóng**
- **Thêm / Sửa**: Tên chi nhánh (bắt buộc) · Mã chi nhánh · công tắc **Đang hoạt động**
- **Module bán hàng tại chi nhánh** — bật/tắt từng cái:
  - POS nhà hàng — *Sơ đồ bàn, gọi món và thanh toán F&B*
  - Bán lẻ — *Bán hàng mã vạch và thêm hàng retail vào bill F&B*
  - Màn hình bếp KDS

Kiểm tra: *"Cần nhập tên chi nhánh"*

---

### 8. Màn hình phụ — hiếm

`settings_customer_display_panel.dart` (12 KB)

- Công tắc **Kích hoạt**
- **Ảnh quảng cáo**: **Thêm ảnh** · tối đa N ảnh/video
- **Thời gian mỗi ảnh**: 15 / 20 / 25 / 30 giây
- Khối **Cách sử dụng**
- **Lưu** → *"Đã lưu màn hình phụ"*

> Mục này **đã tự ẩn trên Android/iOS** (`settings_tab.dart` dòng 106) vì màn phụ
> là tính năng riêng của máy để bàn. Ghi ở đây cho đủ, **không cần thiết kế**.

---

### 9. Thiết bị khách — hiếm, đơn giản nhất

`settings_devices_panel.dart` (7 KB)

**Màn hình tự order (iPad / máy khách)**
- Hiện `PIN hiện tại: …` (hoặc *(chưa đặt)*)
- Ô **PIN mới (4 số)** → nút **Đổi PIN**
- Kiểm tra: *"PIN phải đúng 4 chữ số"* → *"Đã đổi PIN thiết bị khách"*

Cả mục chỉ có **một ô nhập và một nút**.

---

## 5. Mẫu tương tác lặp lại

Gần như mọi mục theo cùng một khuôn:

```
[Tiêu đề phần]                              [+ Thêm]
┌────────────────────────────────────────────────────┐
│ • mục 1                              [Sửa] [Xóa]  │
│ • mục 2                              [Sửa] [Xóa]  │
└────────────────────────────────────────────────────┘

Bấm Thêm/Sửa → biểu mẫu:
    ô nhập · công tắc · ô chọn
    [Hủy]              [Tạo / Lưu]
```

Nhãn nút dùng lại xuyên suốt:
**Thêm** · **Tạo** · **Sửa** · **Xóa** · **Lưu** · **Hủy** · **Bật** / **Tắt**

Sau khi lưu luôn có thông báo ngắn xác nhận: *"Tạo kho …"*, *"Cập nhật món …"*,
*"Đã xóa bàn"*.

---

## 6. Bộ giao diện điện thoại đã có — nên dùng lại

Bản điện thoại đã có sẵn hệ widget riêng. Dùng lại để Cài đặt trông giống phần còn
lại của app, thay vì tạo ngôn ngữ thứ hai.

`screens/phone/phone_kit.dart` và `phone_scaffolds.dart`:

| Widget | Dùng cho |
|---|---|
| `PhoneHeader` | Thanh tiêu đề có nút quay lại + nút hành động |
| `PhoneListScaffold` | Màn danh sách có tìm kiếm, lọc, kéo tải lại, trạng thái rỗng |
| `PhoneListRow` | Một dòng trong danh sách |
| `PhoneField` | Ô nhập một cột — nhãn trên, ô dưới |
| `PhoneSwitchRow` | Hàng công tắc — **chạm cả hàng** là đổi, không bắt trúng cái công tắc bé |
| `PhonePickList` | Danh sách chọn trong bảng trượt |
| `PhoneCta` | Nút chính, có trạng thái đang bận |
| `PhoneActionBar` | Thanh ghim đáy chứa nút chính |
| `PhoneSectionTitle` | Tiêu đề nhóm |
| `PhoneInfoCard` | Thẻ hiện các cặp nhãn–giá trị |
| `PhoneEmpty` | Trạng thái rỗng có biểu tượng và lời gợi ý |
| `PhoneBadge`, `PhoneChip` | Nhãn trạng thái, chip lọc |
| `PhoneNumPad` | Bàn phím số cho ô tiền |

Hàm trợ giúp: `showPhoneSheet()` (bảng trượt từ đáy) · `phoneMoney()` ·
`phoneInt()` · `appToast()`

**Xem làm mẫu**: `phone_printer_setup.dart` — vừa làm xong theo đúng khuôn này,
là ví dụ gần nhất cho một biểu mẫu cài đặt trên máy cầm tay.

---

## 7. Nguyên tắc đề xuất

Đây là gợi ý, người thiết kế quyết định.

**Điều hướng**: bỏ dải cuộn ngang 64px. Thay bằng **danh sách dọc toàn màn** —
bấm một mục thì đẩy sang màn con có nút quay lại. Giống hệt cách màn "Nhiều hơn"
đang làm.

**Một cột, luôn luôn**: nhãn trên, ô nhập dưới. Không xếp nhãn và ô nhập cạnh nhau.

**Biểu mẫu là bảng trượt từ đáy hoặc màn đầy đủ**, không phải hộp thoại rộng cố định.

**Nút chính ghim đáy** bằng `PhoneActionBar` + `PhoneCta`, để **Lưu** luôn trong
tầm ngón cái.

**Vùng chạm tối thiểu 44dp** — người dùng có thể đeo găng hoặc tay ướt.

**Biểu mẫu dài thì chia bước** thay vì cuộn dài. Đặc biệt: Sửa món và CTKM.

**Được phép để một số việc lại cho máy bàn.** Không phải tính năng nào cũng cần
đủ trên màn 5.45 inch. Nếu một việc hiếm khi làm và cần gõ nhiều (ví dụ nhập token
liên kết), thì trên máy cầm tay chỉ cần **xem trạng thái** kèm dòng nhắc *"Chỉnh
sửa trên máy để bàn"*. Điều tệ nhất là giả vờ dùng được rồi để người ta bấm nhầm
giữa ca bán.

---

## 8. Tệp mã nguồn liên quan

| Tệp | KB | Mục |
|---|---|---|
| `settings_tab.dart` | 13 | Điều hướng + lọc mục theo thiết bị |
| `menu_item_dialogs.dart` | 48 | Hộp thoại món ăn |
| `settings_warehouse_panel.dart` | 41 | Kho & kênh bán |
| `settings_integrations_panel.dart` | 40 | Liên kết |
| `book_menu_panel.dart` | 32 | Menu quyển |
| `settings_promotions_panel.dart` | 30 | Khuyến mại |
| `settings_notify_routing_panel.dart` | 25 | Thông báo |
| `settings_loyalty_panel.dart` | 19 | Tích điểm |
| `menu_tab.dart` | 14 | Danh sách món |
| `settings_branches_panel.dart` | 13 | Chi nhánh |
| `settings_customer_display_panel.dart` | 12 | Màn hình phụ (đã ẩn trên mobile) |
| `settings_tables_panel.dart` | 12 | Cấu hình bàn |
| `settings_devices_panel.dart` | 7 | Thiết bị khách |

Đã gỡ khỏi bản điện thoại, không cần thiết kế:
`settings_users_panel.dart` · `settings_connections_panel.dart` ·
`print_template_designer*.dart`
