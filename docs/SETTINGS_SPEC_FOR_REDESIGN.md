# Mục Cài đặt — Đặc tả bàn giao thiết kế lại cho điện thoại / POS cầm tay

Tài liệu này mô tả **toàn bộ** mục Cài đặt hiện có: từng phần làm gì, có những nút
nào, bấm vào ra gì, và luồng thao tác. Mục đích là bàn giao cho người thiết kế lại
giao diện cho màn hình nhỏ.

Mã nguồn: `flutter-apps/dandpak_core/lib/src/screens/management/`
Cửa vào: `settings_screen.dart` → `settings_tab.dart` → 12 panel con.

---

## 0. Vì sao phải thiết kế lại

Cài đặt hiện được **bê nguyên từ desktop/tablet** xuống điện thoại. Không phải nó
xấu — nó được dựng cho màn rộng, và trên màn 6 inch thì các giả định đó vỡ:

**Điều hướng hai cột.** `settings_tab.dart` dòng 113 có ngưỡng:

```dart
final wide = constraints.maxWidth >= 820;
if (wide)  → cột trái 270px + nội dung bên phải
else       → một dải ngang cao 64px chứa 12 mục, cuộn ngang
```

Màn điện thoại luôn rơi vào nhánh `else`: **12 mục dồn vào một dải cuộn ngang cao
64px**. Người dùng không thấy được có bao nhiêu mục, phải quẹt mò để tìm.

**Hộp thoại rộng cố định.** Trong các panel có 20 chỗ đặt `width:` cứng —
`330`, `380`, `340`, `310`, `300`, `220`, `180`, `150`. Trên màn rộng 393px thì
những hộp 330–380px chiếm gần trọn bề ngang hoặc tràn.

**Hàng nhiều cột.** Nhiều panel xếp nhãn + ô nhập + nút trên cùng một `Row`. Màn
hẹp thì hoặc bị bóp méo, hoặc tràn khung.

**Mật độ dày.** Một số panel (Kết nối, Liên kết, Khuyến mại) có hàng chục ô nhập
trên một trang, vốn để xem trên màn 15 inch.

---

## 1. Bố cục tổng thể hiện tại

```
SettingsScreen
 ├── DanModuleTopBar      tên chi nhánh · "Cài đặt" · tên+vai trò người dùng
 │                        nút Quay lại · nút Đăng xuất
 └── SettingsTab
      ├── Điều hướng      12 mục (cột trái 270px nếu ≥820px, else dải ngang 64px)
      └── Nội dung        panel của mục đang chọn
```

Mỗi mục điều hướng có: **biểu tượng · nhãn · mô tả một dòng**.

---

## 2. Mười hai mục

| # | Mục | Mô tả hiện có | Biểu tượng |
|---|---|---|---|
| 1 | **Nhân sự & Phân quyền** | Tài khoản, vai trò và quyền truy cập của nhân viên | `groups_2` |
| 2 | **Chi nhánh** | Thiết lập chi nhánh, kho và phân vùng bán hàng | `store` |
| 3 | **Cấu hình bàn** | Thiết lập bàn, khu vực và sơ đồ phòng bán | `table_restaurant` |
| 4 | **Thực đơn (Menu)** | Danh mục, món ăn, recipe trừ kho và lịch bán | `restaurant_menu` |
| 5 | **Liên kết** | Hóa đơn điện tử, kế toán và nền tảng bán hàng | `hub` |
| 6 | **Kết nối** | Trạng thái thiết bị, máy in và đồng bộ cloud | `cable` |
| 7 | **Kho & kênh bán** | Quản lý kho hàng và liên kết kênh bán | `warehouse` |
| 8 | **Bill & Tem nhãn** | Thiết kế mẫu in hóa đơn và tem sản phẩm | `print` |
| 9 | **Thiết bị khách** | Màn hình self-order và thiết bị cho khách | `devices_other` |
| 10 | **Màn hình phụ** | Quảng cáo khi rảnh, hiển thị đơn & QR cho màn thứ 2 | `desktop_windows` |
| 11 | **Tích điểm & Khuyến mại** | Điểm theo SĐT, hạng thành viên, CTKM, voucher | `loyalty` |
| 12 | **Cấu hình thông báo** | Âm thanh và định tuyến thông báo sự kiện | `notifications_active` |

---

## 3. Chi tiết từng mục

### 1. Nhân sự & Phân quyền
`settings_users_panel.dart` — 39 KB, **panel phức tạp thứ ba**

**Danh sách nhân viên**: ảnh đại diện, họ tên, tên đăng nhập, vai trò, trạng thái
hoạt động.

**Thêm / Sửa nhân viên** (hộp thoại):
- Họ tên · Tên đăng nhập · Vai trò · Ngôn ngữ (Tiếng Việt / English)
- **Chọn ảnh** đại diện (hiện "Chưa có ảnh" khi trống)
- Công tắc **Cho phép đăng nhập**
- **Chi nhánh & phân vùng** — nhân viên được vào chi nhánh nào
- Kiểm tra: "Cần nhập tên và tên đăng nhập"

**Bảng phân quyền** — phần nặng nhất của panel. Quyền chia theo nhóm:

| Nhóm | Ví dụ quyền bên trong |
|---|---|
| Bán hàng | Bán hàng, mở bàn, thêm món · Giảm giá và voucher · Chuyển / gộp bàn · Hủy bill / hủy món |
| Ca, thanh toán, vận hành | Hoàn tiền và đổi trả · Hóa đơn |
| Kho | Chuyển hàng giữa các kho · Cân bằng tồn sau kiểm kho |
| Bếp & online | (món, KDS) |
| Danh bạ | (khách hàng, NCC) |
| Báo cáo | |
| Hệ thống & module | Cấu hình menu · Bill & tem nhãn · Hóa đơn điện tử |

Có nút **Chọn tất cả** / **Bỏ chọn** cho từng nhóm.
Ghi chú cố định: *"Admin luôn có toàn quyền, không cần chỉnh."*

> **Vấn đề trên màn nhỏ**: bảng quyền là ma trận nhóm × quyền với hàng chục ô
> đánh dấu. Đây là phần khó nhất phải thiết kế lại.

---

### 2. Chi nhánh
`settings_branches_panel.dart` — 13 KB

Danh sách chi nhánh: tên, mã, trạng thái (**Đang mở** / **Đã đóng**).

**Thêm / Sửa chi nhánh**: Tên chi nhánh · Mã chi nhánh · công tắc Đang hoạt động.

**Module bán hàng tại chi nhánh** — bật/tắt từng module cho chi nhánh đó:
- POS nhà hàng — *Sơ đồ bàn, gọi món và thanh toán F&B*
- Bán lẻ — *Bán hàng mã vạch và thêm hàng retail vào bill F&B*
- Màn hình bếp KDS

Nút: **Thêm chi nhánh** · **Sửa** · **Tạo** · **Lưu** · **Hủy**

---

### 3. Cấu hình bàn
`settings_tables_panel.dart` — 12 KB

Danh sách bàn nhóm theo khu vực, mỗi bàn hiện `Bàn <mã>` và `<n> chỗ`, trạng thái
**Trống**.

**Thêm / Sửa bàn**: Khu vực (gợi ý *"VD: Tầng 1, Sân vườn"*) · Số bàn / Mã bàn ·
Số chỗ ngồi.

Có khối **XEM TRƯỚC TRÊN SƠ ĐỒ BÀN**.

Nút: **Thêm bàn** · **Sửa** · **Xóa** · **Tạo** · **Lưu** · **Hủy**

---

### 4. Thực đơn (Menu)
`menu_tab.dart` + `menu_item_dialogs.dart` (48 KB) + `book_menu_panel.dart` (32 KB)
— **cụm phức tạp nhất**

Hai chế độ: **Thực đơn FnB** và **Menu quyển**.

Danh sách món: tìm kiếm (*"Tìm món..."*), lọc theo **Danh mục** (Tất cả nhóm,
Salad/Lạnh, Bếp...), trạng thái **Đang bán** / **Tạm hết** / **Ngoài lịch**.

Thao tác mỗi món: **Sửa** · **Xóa** · ẩn/hiện · bật/tắt.
Thông báo: "Đã bật món", "Đã tắt món", "Đã ẩn món", "Đã hiện món", "Đã xóa món",
**"Đã lưu trữ món (đã có order)"** — món đã phát sinh đơn thì lưu trữ chứ không xóa.

`menu_item_dialogs.dart` chứa hộp thoại thêm/sửa món: giá, nhóm, recipe trừ kho,
lịch bán, tuyến in.

---

### 5. Liên kết
`settings_integrations_panel.dart` — 40 KB, **phức tạp thứ hai**

Mỗi đối tác là một thẻ có trạng thái **Chưa kết nối** / **Kết nối thành công!** /
**Kết nối thất bại**, và ba khối: **CẤU HÌNH CHI TIẾT**, **THIẾT LẬP TÍNH NĂNG**,
**GHI CHÚ NỘI BỘ**.

Các đối tác:
- **Hóa đơn điện tử** — Mã số thuế · Tên công ty · Tài khoản / Username ·
  Mật khẩu / Token
- **SePay** — tự đối soát chuyển khoản
- **Casso** — tự đối soát chuyển khoản
- **VietQR / PayOS** — Số tài khoản nhận tiền · Mã ngân hàng (VCB, MB, ACB...) ·
  Return URL (Thành công) · Cancel URL (Hủy thanh toán)
- **Kênh online** (Grab, Shopee...) — **Cách nhận đơn**: *Tự nhận đơn hợp lệ* /
  *Nhân viên xác nhận* · công tắc **Tự in khi có đơn mới**
- **Kế toán (MISA)** — Chi nhánh mặc định

Nút: **Kiểm tra cấu hình** (→ *Kiểm tra thành công* / *Kiểm tra thất bại*) ·
**Lưu kết nối đang chọn** · **Copy**

Panel còn hiện các endpoint đang dùng để đối chiếu kỹ thuật, ví dụ
`Tạo QR động: POST /qr/generate-customer`.

---

### 6. Kết nối
`settings_connections_panel.dart` — **56 KB, panel lớn nhất**

**CHẾ ĐỘ HOẠT ĐỘNG**: Bình thường / Chậm / Cảnh báo / Lỗi / *Không ra được internet*

**Kết nối phần cứng**:
- **IP MÁY POS THẺ (TETHERING/LAN)** + **CỔNG (PORT)** → nút **Lưu cấu hình máy POS thẻ**
- **IP máy in (LAN)** (hiện *"Chưa có IP"* khi trống)
- **Có két** — máy in có nối ngăn kéo đựng tiền không

**Danh mục in** — bản đồ loại phiếu → tuyến in:
Hóa đơn · Hóa đơn / Tạm tính · Bếp · Màn bếp (KDS) · Bán lẻ (Retail POS) ·
Báo cáo (Report) · Kênh online · Khác (Custom) → nút **Lưu danh mục in**

**Job in gần đây**: danh sách lệnh in, trạng thái **Chờ in** / **Lỗi**, nút **In thử**.
Trống thì hiện *"Chưa có job in nào"*.

**Thiết bị đang kết nối**: trống thì *"Chưa có thiết bị nào kết nối"*.

**Lưu trữ**: Lưu trữ cục bộ · Lưu trữ lâu dài · Cơ sở dữ liệu

---

### 7. Kho & kênh bán
`settings_warehouse_panel.dart` — 41 KB

**Danh sách kho**: tên, mã, loại, trạng thái **Bật** / **Tắt**, cột **Mặc định**.

**Tạo / Sửa kho**: Tên kho · Mã kho · **Loại kho** (Kho retail / showroom · Kho
bếp / vật dụng) · **Sắp xếp**

**Kênh bán hàng đang nối với kho này** — mỗi kho nối tới:
- RETAIL POS (bán lẻ)
- RETAIL TRONG F&B (thêm retail ở POS nhà hàng)
- POS nhà hàng
- Kênh online chung

Trống thì hiện *"Chưa nối kênh bán hàng"*.

**Bảng giá**: danh sách, **Tạo bảng giá**, Tên bảng giá, áp **Theo kênh bán**.

Nút: **Tạo kho** · **Tạo kho mới** · **Lưu cấu hình kho** · **Tắt kho** ·
**Mở màn Kho**

---

### 8. Bill & Tem nhãn
`settings_print_panel.dart` (2 KB, chỉ là vỏ) →
`print_template_designer.dart` + `print_template_designer_methods.dart` (54 KB)

**Bộ thiết kế mẫu in trực quan** — kéo thả phần tử lên mẫu bill/tem, có xem trước
đúng như bản in thật.

Chọn khổ giấy có sẵn: **K80** (80×320mm) · **K57** (57×320mm) · **A5** (148×210mm).
Bề ngang bill chỉnh được 48–120mm; tem 20–120mm.

Phần tử đặt được: chữ, đường kẻ, ảnh/logo, mã QR, mã vạch, bảng dòng hàng.

> **Vấn đề trên màn nhỏ**: đây là công cụ kéo thả trên canvas. Gần như không dùng
> được bằng ngón tay trên màn 6 inch. Cân nhắc: trên điện thoại chỉ cho **xem** và
> **chọn mẫu có sẵn**, còn thiết kế thì để trên máy để bàn.

---

### 9. Thiết bị khách
`settings_devices_panel.dart` — 7 KB, **panel đơn giản nhất**

**Màn hình tự order (iPad / máy khách)**:
- Hiện `PIN hiện tại: ...` (hoặc *(chưa đặt)*)
- Ô **PIN mới (4 số)** → nút **Đổi PIN**
- Kiểm tra: *"PIN phải đúng 4 chữ số"* → báo *"Đã đổi PIN thiết bị khách"*

---

### 10. Màn hình phụ
`settings_customer_display_panel.dart` — 12 KB

- Công tắc **Kích hoạt**
- **Ảnh quảng cáo**: nút **Thêm ảnh**, tối đa N ảnh/video
- **Thời gian mỗi ảnh**: 15 / 20 / 25 / 30 giây
- Khối **Cách sử dụng** hướng dẫn
- Nút **Lưu** → *"Đã lưu màn hình phụ"*

---

### 11. Tích điểm & Khuyến mại
`settings_loyalty_panel.dart` (19 KB) + `settings_promotions_panel.dart` (30 KB)

Panel này có **hai thẻ con**: **Tích điểm** và **CTKM / Voucher**.

#### Tích điểm
- **Cách tích điểm tự động**: Chi tiêu · Giới thiệu bạn bè · Hoàn tiền/cashback
- **1 điểm = ... VND** · **Làm tròn** · **Hóa đơn tối thiểu**
- Công tắc **Cho phép đổi điểm thành giảm giá** · **Quy đổi**: Thành voucher /
  Thành điểm
- **Nhân điểm trong ngày sinh nhật** — Hệ số nhân
- **Hạng thành viên**: Mã · Chi tiêu tối thiểu · % ưu đãi · Hệ số nhân điểm →
  **Thêm hạng**
- **Thêm hành vi** — thêm quy tắc tích điểm

#### CTKM / Voucher
- **Danh sách chương trình** (trống: *"Chưa có chương trình khuyến mại"*)
- **Hình thức khuyến mại**: Giảm theo % / Giảm số tiền
- **Khuyến mại theo**: Hóa đơn / toàn bill · Hàng hóa / mọi SKU ·
  Hàng hóa / SKU cụ thể (→ **Chọn SKU áp dụng**) · Nhóm hàng
- **Điều kiện**: Bill tối thiểu · **Chỉ 1 lần** / Không giới hạn · Lot/Date áp dụng
- **Hiệu lực & lịch chạy**: Giờ bắt đầu · Giờ kết thúc · Chi nhánh áp dụng
- **Ghi chú nội bộ / mô tả cách chạy CTKM**
- Nút: **Lưu CTKM** · **Chỉnh sửa chương trình** · bật/tắt từng chương trình

---

### 12. Cấu hình thông báo
`settings_notify_routing_panel.dart` — 25 KB

- Công tắc **Bật âm thanh thông báo**
- **Âm riêng cho từng sự kiện** + nút **Nghe thử**

**Loại thông báo**:
Món mới lên màn hình bếp (KDS) · Thanh toán thành công · Khách gọi nhân viên ·
Khách tự gọi món (iPad) · Kho / Tồn thấp · Hóa đơn & Thanh toán

**Định tuyến — ai nhận thông báo nào**:
- **Theo vai trò**: Quản lý · Thu ngân · Bếp → Nhận / Không nhận
- **Ghi đè theo nhân viên**: tìm nhân viên (*"Tìm nhân viên..."*), đặt
  **Luôn nhận** / **Không nhận** cho từng người
- Hiện `<n> người có ghi đè`

Nút **Lưu thay đổi**

---

## 4. Mẫu tương tác lặp lại

Hầu hết panel theo cùng một khuôn:

```
[Tiêu đề phần]                          [Nút Thêm/Tạo]
┌──────────────────────────────────────────────────┐
│ Danh sách                                        │
│  • mục 1                          [Sửa] [Xóa]   │
│  • mục 2                          [Sửa] [Xóa]   │
└──────────────────────────────────────────────────┘

Bấm Thêm/Sửa → HỘP THOẠI:
   ô nhập, công tắc, ô chọn
   [Hủy]  [Tạo / Lưu]
```

Nhãn nút dùng lại xuyên suốt: **Thêm** · **Tạo** · **Sửa** · **Xóa** ·
**Lưu** · **Hủy** · **Bật** / **Tắt**

Sau khi lưu, hệ thống hiện thông báo ngắn xác nhận, ví dụ
*"Cập nhật nhân viên …"*, *"Tạo kho …"*, *"Đã xóa bàn"*.

---

## 5. Xếp hạng độ khó khi thiết kế lại

| Mức | Mục | Vì sao |
|---|---|---|
| **Rất khó** | Bill & Tem nhãn | Canvas kéo thả, gần như không dùng được bằng ngón tay |
| **Rất khó** | Nhân sự & Phân quyền | Ma trận nhóm × quyền, hàng chục ô đánh dấu |
| **Khó** | Kết nối (56 KB) | Nhiều khối rời rạc: mạng, máy in, tuyến in, lịch sử, lưu trữ |
| **Khó** | Liên kết (40 KB) | 6 đối tác, mỗi cái một bộ ô nhập riêng |
| **Khó** | Thực đơn | Danh sách lớn + hộp thoại nhiều tầng (recipe, lịch bán) |
| **Vừa** | Kho & kênh bán · Tích điểm & Khuyến mại | Nhiều trường nhưng chia nhóm rõ |
| **Dễ** | Chi nhánh · Cấu hình bàn · Màn hình phụ · Cấu hình thông báo | Danh sách + biểu mẫu đơn giản |
| **Rất dễ** | Thiết bị khách | Đúng một ô PIN và một nút |

---

## 6. Gợi ý cho người thiết kế

Đây là gợi ý, không phải yêu cầu bắt buộc.

**Điều hướng**: thay dải cuộn ngang 64px bằng **danh sách dọc toàn màn hình** —
bấm một mục thì đẩy sang màn con, có nút quay lại. Cùng khuôn với màn "Nhiều hơn"
của bản điện thoại (`phone_shell.dart`).

**Hộp thoại**: đổi mọi hộp thoại rộng cố định thành **bảng trượt từ đáy** hoặc
**màn hình đầy đủ**. Bản điện thoại đã có sẵn `showPhoneSheet()` và `PhoneField`
trong `screens/phone/phone_kit.dart` — dùng lại để nhất quán.

**Một cột**: mọi `Row` nhãn + ô nhập nên xếp dọc — nhãn trên, ô nhập dưới.

**Nút chính ghim đáy**: dùng `PhoneActionBar` + `PhoneCta` như các màn điện thoại
khác, để nút **Lưu** luôn trong tầm ngón cái.

**Cân nhắc ẩn bớt trên điện thoại**: bộ thiết kế mẫu in và bảng phân quyền chi tiết
có thể chỉ cho **xem**, kèm dòng nhắc *"Chỉnh sửa trên máy để bàn"*. Không phải
tính năng nào cũng cần đủ trên màn 6 inch — quan trọng là không giả vờ dùng được
rồi để người ta bấm nhầm.

---

## 7. Tệp mã nguồn liên quan

| Tệp | KB | Nội dung |
|---|---|---|
| `settings_screen.dart` | 2 | Vỏ ngoài, thanh trên cùng |
| `settings_tab.dart` | 13 | Điều hướng 12 mục + chọn panel |
| `settings_connections_panel.dart` | 56 | Kết nối |
| `print_template_designer_methods.dart` | 54 | Thiết kế mẫu in |
| `menu_item_dialogs.dart` | 48 | Hộp thoại món ăn |
| `settings_warehouse_panel.dart` | 41 | Kho & kênh bán |
| `settings_integrations_panel.dart` | 40 | Liên kết |
| `settings_users_panel.dart` | 39 | Nhân sự & Phân quyền |
| `book_menu_panel.dart` | 32 | Menu quyển |
| `settings_promotions_panel.dart` | 30 | Khuyến mại |
| `settings_notify_routing_panel.dart` | 25 | Thông báo |
| `settings_loyalty_panel.dart` | 19 | Tích điểm |
| `settings_branches_panel.dart` | 13 | Chi nhánh |
| `settings_customer_display_panel.dart` | 12 | Màn hình phụ |
| `settings_tables_panel.dart` | 12 | Cấu hình bàn |
| `settings_devices_panel.dart` | 7 | Thiết bị khách |
| `settings_print_panel.dart` | 2 | Vỏ cho bộ thiết kế mẫu in |

Bộ widget dùng chung của bản điện thoại — nên dùng lại khi thiết kế:
`screens/phone/phone_kit.dart` · `phone_scaffolds.dart`
