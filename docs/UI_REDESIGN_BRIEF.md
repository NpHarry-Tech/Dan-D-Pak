# Dan D Pak POS — Prompt bàn giao cho Claude Design (redesign UI/UX toàn diện)

Dán nguyên văn tài liệu này làm tin nhắn đầu tiên trong dự án Claude Design mới.
Đây là phần NỀN để bạn hiểu toàn bộ app trước — mọi mô tả cụ thể hơn (từng màn,
từng luồng, ảnh chụp hiện trạng) sẽ được bổ sung ở các tin nhắn sau.

---

## 1. Sản phẩm là gì

**Dan D Pak POS** — hệ thống bán hàng (F&B + bán lẻ) cho chuỗi cửa hàng tại Việt
Nam. Không phải một app, mà là **4 ứng dụng khách** dùng chung một lõi, cộng một
backend Node.js:

| App | Nền tảng | Người dùng | Thiết bị thật |
|---|---|---|---|
| Desktop | Windows | Thu ngân đứng quầy | PC/màn hình rộng, nhiều máy là **Celeron yếu** |
| Tablet | Android | Thu ngân / phục vụ | Tablet gắn quầy hoặc cầm tay, màn vừa |
| Phone | Android | Thu ngân cầm tay | **Sunmi V2** — POS cầm tay có máy in nhiệt gắn liền, **khoá dọc**, ~393dp ngang |
| BYOD (web) | Trình duyệt di động của khách | **Khách hàng**, không cài app | Khách quét QR tại bàn, tự gọi món bằng điện thoại riêng |

Ngoài 4 app trên còn có **self-order** (khác BYOD): một chế độ gọi món trên
chính thiết bị của cửa hàng (ví dụ tablet gắn tại bàn, hoặc màn hình phụ), khách
thao tác nhưng thiết bị là của quán, không phải máy khách tự mang tới.

Vai trò cửa hàng: quản lý, thu ngân, bếp/pha chế (nhận phiếu qua KDS), nhân viên
kho. Toàn bộ giao diện hiện tại **tiếng Việt là ngôn ngữ gốc**, có bản dịch
en/zh (khách BYOD chọn ngôn ngữ; nhân viên dùng thẳng tiếng Việt).

## 2. Nghiệp vụ chính (để hiểu vì sao màn hình phức tạp)

- Bán hàng F&B theo bàn (sơ đồ bàn, gộp/tách bàn, chuyển bàn, gọi món nhiều đợt)
  và bán lẻ (giỏ hàng, quét mã vạch).
- Thanh toán đa phương thức, in hoá đơn nhiệt + **hoá đơn điện tử VAT** (tuân
  thủ Nghị định 123/2020, tích hợp MISA meInvoice) — đây là ràng buộc pháp lý
  thật, không phải tính năng có thể bỏ khi thiết kế lại.
- Kho & tồn kho nhiều chi nhánh, phiếu nhập/xuất/chuyển kho.
- Kênh bán online: Haravan, Lazada, TikTok Shop, Shopee — đơn đổ về, đồng bộ
  sản phẩm/tồn kho hai chiều với một số kênh.
- Khách hàng thân thiết: tích điểm, khuyến mại/voucher.
- Kế toán/hoá đơn/công nợ, báo cáo ca, nhân sự & phân quyền theo vai trò.
- Bếp: phiếu bếp in nhiệt hoặc màn hình bếp (KDS).
- Toàn bộ thiết kế phải giả định **offline-first**: mất mạng vẫn phải bán được,
  đồng bộ lại sau — đừng thiết kế màn hình theo kiểu "luôn có mạng".

## 3. Kiến trúc mã nguồn (để biết cái gì dùng chung, cái gì riêng từng app)

```
flutter-apps/
  dandpak_core/     ← TOÀN BỘ màn hình, widget, theme, service nằm ở đây
  dandpak_desktop/  ← vỏ mỏng, chỉ cấu hình + entry point
  dandpak_tablet/   ← vỏ mỏng
  dandpak_phone/    ← vỏ mỏng
server/             ← Node.js backend, cũng phục vụ luôn trang BYOD tĩnh
  assets/byod/      ← HTML/CSS/JS thuần (không framework) cho khách quét QR
```

3 vỏ app **dùng chung 100% màn hình** từ `dandpak_core` — khác biệt duy nhất là
kích thước màn hình thật khiến cùng một màn hình phải tự co giãn (responsive),
KHÔNG có 3 bộ UI riêng. Vì vậy redesign cần nghĩ theo **breakpoint trong cùng
một bộ màn hình**, không phải 3 bộ thiết kế độc lập.

Điều hướng: không dùng named routes. Có một `AuthProvider` (ChangeNotifier)
đóng vai trò router phản ứng — đăng nhập xong tự chuyển màn theo trạng thái.

## 4. Bản đồ toàn bộ màn hình hiện có

Đường dẫn gốc: `flutter-apps/dandpak_core/lib/src/screens/` (128 file .dart).
Liệt kê theo thư mục — đây là danh sách MODULE cần tính tới khi redesign, dù
bạn chưa đọc từng file:

| Thư mục | Nội dung |
|---|---|
| *(gốc)* | `pos_screen.dart` — màn bán hàng chính; sơ đồ bàn (`floor_layout.dart`); màn khởi động/đăng nhập/chọn chi nhánh; lịch sử đơn; hộp thoại ca làm việc |
| `retail/` (10 file) | Luồng bán lẻ — giỏ hàng, checkout, chuyển tạm |
| `warehouse/` (11 file) | Kho, tồn kho, phiếu chuyển kho, bộ lọc |
| `management/` (30 file — **to nhất**) | Toàn bộ **Cài đặt**: thực đơn, khuyến mại, nhân sự, chi nhánh, tích hợp kênh bán, máy in, v.v. Xem mục 6. |
| `online/` (10 file) | Đơn hàng online, đối soát, chat đa kênh, sản phẩm kênh online |
| `self_order/` (11 file) | Gọi món trên thiết bị của quán (không phải BYOD) |
| `accounting/`, `invoices/`, `documents/`, `expenses/`, `money/` | Kế toán, hoá đơn, chứng từ, chi phí, sổ quỹ |
| `contacts/` | Khách hàng / nhà cung cấp |
| `catalogue/` | Danh mục sản phẩm |
| `purchase/` | Nhập hàng/mua hàng |
| `printers/` | Cấu hình máy in |
| `kds/` | Màn hình bếp (Kitchen Display) |
| `customer_display/` | Màn hình phụ hướng ra khách (hiện tổng tiền, QR) |
| `database/` | Công cụ vận hành/CSDL nội bộ |
| `scanner/` | Quét mã vạch/QR |
| `phone/` | Một số màn RIÊNG chỉ dùng trên bản điện thoại Sunmi (ví dụ cấu hình máy in rút gọn) |

Widget dùng chung: `lib/src/widgets/` (20 file — dialog xác nhận PIN quản lý,
date/time picker, side sheet, tra cứu MST, chọn khách hàng, thanh top bar, lưới
ô bấm lớn cho màn cảm ứng...).

## 5. Hệ thống thiết kế ĐANG DÙNG (baseline — không phải đề xuất)

**Có 2 hệ thống thiết kế song song, khác nhau, cho 2 nhóm người dùng khác nhau:**

### 5a. App nhân viên (desktop/tablet/phone) — `lib/src/ui/app_theme.dart`

Material 3, font **Be Vietnam Pro**, theo hướng trung tính/chuyên nghiệp:

```
Màu chính:   #0891B2 (xanh lơ/cyan — "brand")
Nền:         #F7F8FA · Bề mặt: #FFFFFF / #F3F5F7 / #E8EBEF
Viền:        #E7EAEE / #D3D8DF
Chữ:         #1A2230 (chính) · #677084 (mờ) · #9AA3B2 (rất mờ)
Trạng thái:  mới #5EA3FF · đang làm #FFC24D · xong #3FE08F · trễ #FF6B6B · đang trả #B58CFF
Bo góc:      8 / 10 / 14px (sm/md/lg)
Nút:         chiều cao tối thiểu 42px, chữ 13px/700
```

Có **chế độ máy yếu** (`lowEnd`): tắt hiệu ứng chuyển trang + hiệu ứng loang
khi chạm, vì nhiều máy POS Celeron không kham nổi animation — **redesign phải
giữ khả năng tắt animation này**, đừng thiết kế phụ thuộc hiệu ứng chuyển động
phức tạp làm mặc định.

### 5b. BYOD (khách tự gọi món qua web) — `server/assets/byod/app.css`

Đã có sẵn **một dự án Claude Design trước đó** tên "Dan D Pak BYOD" — token bên
dưới được port thẳng từ đó, phong cách ấm/thân thiện hơn, đúng bộ nhận diện đỏ
của thương hiệu:

```
Accent:      #D81F26 (đỏ thương hiệu) · hover #B3181E
Nền:         #FDFAF5 (kem) · Card: #FFFFFF
Viền:        #ECE7DF / #DCD4C8
Chữ:         #1A2230 / #677084 / #9AA3B2 (giống hệ app nhân viên)
Bo góc:      chip 9 · field 14 · card 16 · sheet 24
Spacing:     thang 4/6/8/10/12/14/18/22px
Font:        Be Vietnam Pro (giống nhau cả 2 hệ)
```

BYOD phải tự xử lý **safe-area + visual viewport** của trình duyệt di động
(thanh công cụ Safari/Chrome ẩn/hiện, tai thỏ, thanh điều hướng) — mọi nút nổi/
thanh dưới cùng đều cộng `env(safe-area-inset-*)`.

**Gợi ý cho Claude Design**: nếu bạn thấy nên **hợp nhất 2 hệ thống thành 1**
(cùng bộ màu/token cho cả nhân viên lẫn khách), hoặc **cố tình giữ tách biệt**
(nhân viên = công cụ làm việc trung tính, khách = trải nghiệm thương hiệu ấm),
hãy nêu rõ đề xuất và lý do — đây là quyết định thiết kế, chưa có câu trả lời
sẵn.

## 6. Đã có sẵn 1 bản đặc tả redesign mẫu — dùng làm chuẩn văn phong

File `docs/SETTINGS_SPEC_FOR_REDESIGN.md` trong repo là bản bàn giao redesign
**đã làm xong** cho riêng phần Cài đặt trên máy cầm tay Sunmi V2. Nó minh hoạ
đúng mức độ chi tiết và cách trình bày mong muốn: bối cảnh thiết bị → bằng
chứng cụ thể trong mã nguồn (số dòng, giá trị pixel) → xếp hạng theo tần suất
dùng thật → đặc tả từng mục. Điểm chính rút ra (áp dụng cho toàn app, không chỉ
Cài đặt):

- **Điều hướng vỡ ở ngưỡng cứng 820px** — dưới ngưỡng đó, danh sách mục dồn vào
  một dải cuộn ngang cao 64px, người dùng phải quẹt mò.
- **Nhiều nơi đặt bề rộng cứng theo pixel** (330/380/340/310/300/220/180/150)
  — vỡ trên màn Sunmi V2 chỉ ~393dp ngang.
- **Máy cầm tay dùng khi đang đứng bán, một tay** — thao tác chính phải nằm
  trong tầm ngón cái (nửa dưới màn hình), có thể đeo găng hoặc tay ướt.
- Khi thu gọn màn hình nhỏ, một số mục phức tạp (canvas kéo thả, ma trận quyền
  hàng chục ô) nên **chuyển hướng thao tác** thay vì cố nhồi vào màn nhỏ, không
  phải xoá tính năng.

## 7. Ràng buộc PHẢI giữ khi redesign

1. **Không được bớt nghiệp vụ** — đây là yêu cầu tường minh của chủ hệ thống:
   redesign để "làm gọn, chặt chẽ, tối ưu", KHÔNG phải cắt tính năng.
2. Tuân thủ hoá đơn điện tử VAT (định dạng, thông tin bắt buộc trên hoá đơn in)
   — phần này có ràng buộc pháp lý, không tự ý đơn giản hoá nội dung hiển thị.
3. Phải hoạt động tốt ở **cả 3 kích thước màn hình nhân viên bằng cùng 1 bộ
   màn hình** (responsive/breakpoint), không thiết kế 3 bộ riêng.
4. Giữ khả năng tắt animation (chế độ máy yếu).
5. BYOD phải tự chịu được trình duyệt di động thật (an toàn vùng, bàn phím ảo
   che khuất, xoay màn hình) — không giả định viewport cố định.
6. Chuỗi hiển thị hiện là tiếng Việt gốc + tra bảng dịch en/zh theo đúng câu
   tiếng Việt làm khoá — nếu redesign đổi chữ trên UI, chữ mới cũng cần dịch
   được theo cách tương tự (không cần đổi cơ chế dịch, chỉ cần biết ràng buộc
   này tồn tại).
7. Thiết bị Sunmi V2 (bản điện thoại) khoá dọc, không xoay ngang được.

## 8. Cách làm việc tiếp theo

Đây mới là phần NỀN. Ở các tin nhắn sau, chủ hệ thống sẽ gửi thêm: ảnh chụp
màn hình hiện trạng của từng khu vực cụ thể, mô tả vấn đề đang gặp, và có thể
yêu cầu thiết kế lại từng phần theo thứ tự ưu tiên. Hãy giữ nguyên bối cảnh ở
trên khi nhận thêm thông tin, và hỏi lại nếu một mô tả cụ thể mâu thuẫn với
ràng buộc đã nêu ở mục 7.
