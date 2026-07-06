# UI / UX của Web (Dan D Pak POS/ERP)

Tài liệu này ghi lại **toàn bộ chi tiết giao diện và trải nghiệm người dùng** của lớp web
(`/web`). Web hiện vẫn là lớp UI thực thi đang chạy (được Flutter "local engine" phục vụ
sau pivot — xem `memory/desktop-tablet-architecture.md`). Mọi mô tả dưới đây bám sát mã
nguồn thực tế trong `web/`, không phải mong muốn.

> Triết lý xuyên suốt: **minimalist, sạch, nền dịu, viền mảnh, ít ám xanh**, mọi màn hình
> dùng chung một bộ design token + một app-header thống nhất; điều chỉnh thẩm mỹ chỉ qua
> token trong `web/shared/app.css`. Cảm hứng layout module quản lý theo phong cách Haravan,
> URL deep-link `/<module>/:tab`.

---

## 1. Kiến trúc front-end & tệp

- **Không framework, không build step.** Tất cả là HTML tĩnh + ES modules thuần + một file
  CSS dùng chung. Mỗi "màn" là một file `.html` ở `web/` tự nạp `shared/client.js`.
- **CSS dùng chung:** [`web/shared/app.css`](../web/shared/app.css) (289 dòng) — design
  tokens + toàn bộ component cơ bản + responsive. Mỗi page chỉ thêm `<style>` cục bộ cho
  layout riêng của nó.
- **Runtime dùng chung:** [`web/shared/client.js`](../web/shared/client.js) (993 dòng) —
  REST helper `api()`, realtime socket `connect()`, topbar, login wizard, PIN pad, toast,
  clock, online dot, money/format, i18n re-export.
- **Module phụ trợ dùng chung** (`web/shared/`): `i18n.js` (vi/en), `modules.js` (catalog
  module), `shift.js` (ca/két tiền), `orderHistory.js`, `customer.js` (picker khách +
  perk), `invoiceRequest.js` (yêu cầu hóa đơn công ty), `danBill.js`, `cardTerminal.js`,
  `kiosk.js`.
- **Core utils** (`web/js/core/`): `apiClient.js`, `realtimeClient.js`, `storage.js`,
  `notificationSound.js`, `formatters.js`, `money.js`, `dates.js`, `dom.js`, `errors.js`,
  `eventBus.js`, `config.js`.
- **Font:** `Be Vietnam Pro` (UI) + `JetBrains Mono` (số/tiền/mã) nạp từ Google Fonts.

### Danh sách màn hình (`web/*.html`)

| File | Module | Vai trò UI |
|------|--------|-----------|
| `index.html` | Launcher | Hub chọn thiết bị/module sau đăng nhập |
| `ipad.html` | iPad Self-Order | Kiosk khách tự gọi món (lớn nhất, ~3k dòng) |
| `pos.html` | FnB POS | POS quầy theo sơ đồ bàn |
| `retail.html` | Retail POS | POS bán lẻ quét mã vạch, đa hóa đơn |
| `kds.html` | KDS | Màn hình bếp/bar |
| `online.html` | Kênh online | Đơn GrabFood/ShopeeFood/Haravan |
| `warehouse.html` | Kho | Nhập/xuất/kiểm kho, lot/HSD |
| `admin.html` | Quản lý | Dashboard + Settings shell + Reports center (lớn nhất, ~7.3k dòng) |
| `settings.html` | Cài đặt | Chỉ redirect → `/settings` (admin shell) |
| `contacts.html` | Liên hệ | Danh bạ khách + NCC dùng chung |
| `purchase.html` | Mua hàng | Đơn mua → nhận kho → công nợ NCC |
| `expenses.html` | Chi phí | Sổ chi phí theo danh mục |
| `invoices.html` | Hóa đơn điện tử | Danh sách HĐĐT đã phát hành |
| `database.html` | CSDL | Quản lý DB local, backup, audit, docs |
| `printers.html` | In ấn | Máy in, két tiền, lịch sử in |
| `documents.html` | Tài liệu | Trình đọc tài liệu kiến trúc |
| `sim.html` | Simulator | Khung mô phỏng iPad/thiết bị để xem trước |

---

## 2. Phong cách thị giác & màu sắc chủ đạo

### 2.0 Phong cách thị giác (visual language)

Tổng thể là **light-mode tối giản, "calm UI" kiểu SaaS/Haravan** — sạch, thoáng, ưu tiên
nội dung và số liệu hơn trang trí. Đặc trưng cụ thể:

- **Nền sáng phẳng, phân lớp bằng độ sáng chứ không bằng bóng đổ nặng.** Ba lớp bề mặt:
  nền trang xám rất nhạt (`--bg #f7f8fa`) → card/panel **trắng** (`--surface`) → vùng phụ
  xám nhạt (`--surface2`). Không có nền tối, không gradient nền sặc sỡ.
- **Viền mảnh thay vì bóng đậm.** Mặc định viền `1px` màu `--border` rất nhạt; bóng chỉ là
  gợi ý độ nổi (`shadow-sm` 1px, `shadow` 4px×16px, opacity ~4–6%). Card chỉ "nâng" rõ khi
  hover (dịch -2px + bóng nhạt màu brand).
- **Bo góc mềm, nhất quán theo thang** `8 / 10 / 14px` (nút → card → panel; modal 16px;
  pill/chip bo tròn hoàn toàn `99px`). Không góc vuông sắc, không bo quá lớn kiểu "bong
  bóng".
- **Khoảng trắng rộng rãi**, mật độ thông tin vừa phải; bảng/biểu đồ có nhịp thở.
- **Icon đồng bộ kiểu line-art (outline, nét 1.9px, bo tròn đầu nét)** — toàn bộ tiêu đề
  module dùng SVG stroke cùng một "trọng lượng nét". Trong nội dung thì xen **emoji** làm
  nhãn nhanh (🔥 top món, 🛒 giỏ, 🪑 bàn, 🍳/🏬 kho…) cho thân thiện và nhận diện nhanh.
- **Hai họ chữ:** chữ giao diện mềm, dễ đọc tiếng Việt (**Be Vietnam Pro**); **mọi con
  số/tiền/mã** dùng **monospace (JetBrains Mono)** để cột số thẳng hàng, có cảm giác
  "máy POS chuyên nghiệp". Tiêu đề thường **đậm 800**, nhãn phụ in hoa nhỏ + giãn chữ.
- **Chuyển động tiết chế, có chủ đích:** fade khi vào view, modal trượt lên + scale nhẹ,
  PIN sai thì rung, chấm "live"/online **nhấp nháy** (`pulse`), shimmer khi tải. Tất cả
  ngắn (<0.25s) và tôn trọng `prefers-reduced-motion` (hiện còn tắt cứng để mượt trên máy
  yếu).
- **Phẳng nhưng có điểm nhấn gradient rất nhỏ** (xem dưới) — không lạm dụng.

Cảm giác cuối cùng: **trung tính, đáng tin, hơi "y tế/ngân hàng"**, để màu thương hiệu và
màu trạng thái nổi bật trên nền trắng-xám.

### 2.1 Màu sắc chủ đạo (dominant palette)

Bảng màu thực tế chia 3 nhóm theo mức độ áp đảo trên màn hình:

**a) Màu nền — chiếm ~90% diện tích (trung tính, không màu):**
- Trắng `#ffffff` (card/panel/topbar) trên nền **xám lạnh rất nhạt `#f7f8fa`**.
- Chữ chính gần-đen **`#1a2230`** (xanh đen rất tối, không phải đen tuyền) → dịu mắt.
- Chữ phụ xám xanh `#677084` / mờ `#9aa3b2`; viền `#e7eaee`/`#d3d8df`.

**b) Màu thương hiệu / nhấn — duy nhất một tông, dùng tiết kiệm:**
- **Cyan/teal `--brand #0891b2`** là **màu chủ đạo nhận diện** của hệ thống: nút primary,
  link, viền focus, tab đang chọn, số nổi bật (KPI doanh thu), chip thương hiệu.
- Dùng kèm bản nhạt `--brand-dim rgba(8,145,178,.10)` cho nền chip/hover/ring focus.
- **Điểm nhấn gradient cyan → green** `linear-gradient(180deg,#34d2ee,#3fe08f)`: xuất hiện
  ở **vạch nhỏ đầu tiêu đề `panel h3`**, logo simulator, vài badge — đây là "chữ ký" thị
  giác phụ, luôn ở liều lượng rất nhỏ.
- Nền đăng nhập là **radial sáng** `radial-gradient(circle at 50% 45%,#fff,#edf3f8)` —
  vẫn trắng-xanh nhạt, không phá tông.

**c) Màu trạng thái (semantic) — chỉ để báo trạng thái, không trang trí:**

| Màu | Hex | Nghĩa | Ví dụ dùng |
|-----|-----|-------|-----------|
| 🔵 xanh dương `--new` | `#5ea3ff` | mới / chờ | đơn mới, "Số bill" |
| 🟡 vàng `--doing` | `#ffc24d` | đang xử lý | bàn busy, KDS đang làm, đơn đang mở |
| 🟢 xanh lá `--done` | `#3fe08f` | xong / OK / online | "Trực tiếp", online dot, kho ổn, nút Xong |
| 🔴 đỏ `--late` | `#ff6b6b` | trễ / lỗi / nguy hiểm / offline | món trễ, tồn thấp, nút danger, mất kết nối |
| 🟣 tím `--purple` | `#b58cff` | đang thanh toán | bàn ở trạng thái paying |

Mỗi màu có bản nền nhạt `*-bg` (alpha ~12–14%) để tô chip/badge/vùng cảnh báo mà không chói.

> **Nguyên tắc dùng màu:** nền trung tính áp đảo → **một** màu thương hiệu (cyan) cho hành
> động & nhận diện → màu trạng thái **chỉ** khi cần truyền trạng thái. Tránh dùng màu
> thương hiệu/trạng thái làm trang trí, và không thêm tông màu mới ngoài bảng này.

### Màu (token đầy đủ)
| Token | Giá trị | Dùng cho |
|-------|---------|----------|
| `--bg` | `#f7f8fa` | Nền toàn trang |
| `--surface` | `#ffffff` | Card/panel/topbar |
| `--surface2` | `#f3f5f7` | Nền phụ, input, hover |
| `--surface3` | `#e8ebef` | Nền nhấn, scrollbar |
| `--border` / `--border2` | `#e7eaee` / `#d3d8df` | Viền mảnh / viền đậm hơn |
| `--text` | `#1a2230` | Chữ chính |
| `--muted` / `--faint` | `#677084` / `#9aa3b2` | Chữ phụ / mờ |
| `--brand` | `#0891b2` (cyan/teal) | Màu thương hiệu, nút primary, focus |
| `--brand-dim` | `rgba(8,145,178,.10)` | Nền nhạt của brand |

### Màu trạng thái (semantic) — quy ước dùng nhất quán mọi nơi
| Token | Màu | Ý nghĩa |
|-------|-----|---------|
| `--new` `#5ea3ff` | xanh dương | Mới / chờ |
| `--doing` `#ffc24d` | vàng | Đang xử lý |
| `--done` `#3fe08f` | xanh lá | Hoàn tất / online / OK |
| `--late` `#ff6b6b` | đỏ | Trễ / lỗi / nguy hiểm / offline |
| `--purple` `#b58cff` | tím | Đang thanh toán |

Mỗi màu có biến `*-bg` đi kèm (nền nhạt) để tô chip/badge.

### Bo góc, đổ bóng, font
- Bo góc: `--r-sm:8px`, `--r:10px`, `--r-lg:14px`.
- Shadow: `--shadow-sm` (1px nhẹ), `--shadow` (4px 16px dịu).
- Font: `--font` (Be Vietnam Pro), `--mono` (JetBrains Mono).
- Cỡ chữ gốc body `14px`, line-height `1.5`.

---

## 3. Component cơ bản (dùng chung mọi màn)

- **Nút `.btn`**: nền `surface2`, viền mảnh, bo `r-sm`; hover đổi sang viền+chữ brand.
  Biến thể: `.primary` (nền brand, chữ trắng, có shadow), `.green`, `.warn`, `.danger`
  (viền đỏ trong suốt), `.sm` (nhỏ). Có micro-interaction: `:active` dịch xuống 1px,
  shadow nâng khi hover. `:disabled` mờ 0.4.
- **Chip `.chip`**: pill in hoa, letter-spacing rộng; biến thể `c-new/c-doing/c-done/c-late/
  c-purple/c-muted` ánh theo màu trạng thái.
- **Card `.card`**: nền surface, viền, bo `r-lg`, đổ bóng nhẹ; có `.lb` (nhãn in hoa nhỏ) +
  `.vl` (số lớn mono, biến thể màu `cy/gr/yl/rd`). `a.card`/`.card.click` nâng -2px + đổ
  bóng brand khi hover.
- **Panel `.panel`**: khối nội dung; tiêu đề `h3` có thanh gradient cyan→green nhỏ ở đầu
  (`::before`).
- **Bảng `table`**: header in hoa mờ, dòng có viền dưới mảnh; **sticky header** khi cuộn
  dài, hover dòng đổi nền nhẹ; cột đầu đậm hơn.
- **Form (input/select/textarea/...)**: nền surface, viền mảnh, focus = viền brand + ring
  `0 0 0 3px brand-dim`. `select` được vẽ lại mũi tên tùy biến (2 gradient tam giác).
  Placeholder màu `faint`.
- **Modal `.overlay`/`.modal`**: phủ nền tối `rgba(5,10,16,.7)` + blur 3px, modal trắng bo
  16px, có animation vào (`modalIn` trượt lên + scale nhẹ). `label` in hoa nhỏ; `.optrow`/
  `.opt` là chip chọn (active = nền brand-dim). `.mfoot` là hàng nút dưới đáy (flex đều).
- **Toast `.toast`**: nổi đáy giữa màn, trượt lên khi `.show`, tự ẩn sau 2.6s; biến thể
  `.err` viền đỏ nền hồng nhạt. Gọi qua `toast(msg, isErr)`.
- **Skeleton `.skeleton`**: shimmer gradient chạy (dùng làm placeholder khi đang tải —
  thấy ở launcher, dashboard, bảng top món...).
- **Spinner `.spin`**: vòng xoay nhỏ brand.
- **Empty state `.empty`**: căn giữa, chữ mờ, thường kèm hình logo + dòng gợi ý.

---

## 4. App shell — App-header thống nhất (topbar)

Hàm `topbar(active, {title, sub, actions})` trong `client.js` tạo **một thanh header duy
nhất dùng cho mọi module**, cấu trúc 3 vùng:

```
[ logo + tên chi nhánh + chấm "Trực tiếp" ] · [ tiêu đề trang + phụ đề ] · [ actions · đồng hồ · online dot · user chip ]
```

- **Brand bên trái** (`.tb-brand`): logo `DanOnLogo.png`, bấm vào về `/` (Launcher). Kèm
  tên chi nhánh đang chọn + nhãn `Trực tiếp/Live` với chấm xanh nhấp nháy (`pulse`).
- **Heading giữa** (`.tb-heading`): mỗi page truyền `title` (kèm icon SVG line-art 20px) +
  `sub` (mô tả ngắn). Cắt ellipsis khi hẹp.
- **Phải** (`.tb-right`): khu `actions` riêng từng page (nút/chip ngữ cảnh), **đồng hồ**
  (`#clock`, cập nhật mỗi giây, định dạng theo locale), **online dot** (`.onlinedot`), và
  **user chip** (`#userchip`: 👤 tên · vai trò + nút đăng xuất ⏻).
- Nút icon `.tb-iconbtn`, bộ chọn ngôn ngữ `.tb-lang` (pill VI/EN) cũng thuộc topbar.

Icon các trang đều là **SVG stroke line-art 1.9px** đồng bộ (Quản lý = bar chart, POS =
giỏ, KDS = dụng cụ ăn, Kho = hộp 3D, Online = quả cầu, Liên hệ = nhóm người, v.v.).

---

## 5. Đăng nhập & bảo mật (UX)

Toàn bộ trong `client.js`, gọi `requireLogin()` / `requireModuleAccess(key)` đầu mỗi page.

- **Login wizard** (`openLoginWizard`): card trắng bo 20px trên nền radial sáng. Wizard
  trượt ngang từng bước (`.lg-track` translateX):
  1. **Chọn chi nhánh** (`.lg-branch-row`) — chỉ hiện khi thiết bị **chưa "chốt" chi
     nhánh** và hệ thống có >1 chi nhánh, hoặc khi chủ động "Đổi chi nhánh". Chi nhánh hiện
     tại gắn 📍, còn lại 🏬; chọn = ✓.
  2. **Chọn nhân viên** (`.lg-user`) — avatar tròn chữ cái đầu + tên + vai trò.
  - Header wizard có nút `‹` quay lại, logo, nút "Hủy" (chỉ ở chế độ switch).
- **PIN pad** (`requestPinCode`): card bo 28px, tiêu đề + phụ đề + chip vai trò; **dãy chấm
  PIN** (`.pin-dots` sáng dần), bàn phím số 3×4 (phím tròn lớn 74px, có ⌫). Sai PIN → card
  **rung** (`pinShake`) + báo đỏ. Hỗ trợ gõ bàn phím vật lý (số/Backspace/Esc/Enter). Auto
  submit khi đủ độ dài. Dùng lại cho cả đăng nhập lẫn re-auth thao tác nhạy cảm.
- **Đổi chi nhánh giữ phiên** (`changeBranchFlow`): manager/admin nhiều chi nhánh đổi tức
  thì, không cần đăng nhập lại; nhân viên 1 chi nhánh không thấy nút.
- **Chặn quyền**: thiếu quyền module → thay `body` bằng panel "Không có quyền truy cập" +
  nút về Launcher.
- **Phân quyền theo vai trò**: nhãn vai trò vi/en — Admin/owner, Quản lý/manager,
  Thu ngân/cashier, Bếp/kitchen, Thủ kho/warehouse.

---

## 6. Realtime & trạng thái kết nối

- **Online dot** (`.onlinedot`): chấm + nhãn. Ping `/ping` mỗi 5s; hiển thị `Online · Nms`,
  chuyển `.slow` khi >500ms, `.off` (đỏ "Mất kết nối/Offline") khi rớt.
- **Socket.IO** (`connect(device, handlers)`): mỗi màn đăng ký sự kiện realtime riêng
  (`order:new`, `order:item`, `payment:done`, `menu:updated`, `inventory:updated`,
  `sync:status`, `kds:refresh`...). Order ở iPad hiện ngay sang POS/KDS/Quản lý.
- **Âm thanh thông báo** (`notificationSound.js`): KDS/Online phát chuông khi có đơn mới;
  cấu hình bật/tắt, âm lượng, chọn âm trong Cài đặt, đồng bộ qua `/notification-sound`.

---

## 7. Responsive, cảm ứng & kiosk

- **3 ngưỡng chính** trong app.css:
  - `max-width:1100px` **hoặc** `max-height:820px`: "POS terminal compact" — thu nhỏ
    topbar/padding/cỡ chữ/nút cho màn 1024×768, **không dùng zoom trình duyệt**.
  - `max-width:760px`: header reflow 2 hàng (định danh + trạng thái trên, tiêu đề dưới).
  - `max-width:520px`: ẩn phụ đề, actions xuống hàng riêng.
- **Touch (`pointer:coarse`)**: nút/input/opt to hơn cho POS/iPad.
- **Kiosk hardening** (`body.kiosk`): chặn chọn text, long-press callout, kéo ảnh, pinch
  zoom — chỉ nút/input của ta dùng được. Áp dụng cho màn hướng tới khách (iPad). Ngoài ra
  app.css chặn `user-select` toàn cục, chỉ cho phép trên input/textarea/`.allow-select`.
- **Giảm chuyển động**: tôn trọng `prefers-reduced-motion` (và app.css hiện tắt cứng mọi
  transition/animation ở cuối file để ưu tiên độ mượt/ổn định trên thiết bị yếu).
- **Focus ring** brand cho mọi phần tử tương tác (`:focus-visible`) — hỗ trợ bàn phím.

---

## 8. Đa ngôn ngữ (i18n)

- `web/shared/i18n.js`: hỗ trợ **vi (mặc định) + en**. Từ điển `BASE_TRANSLATIONS`
  vi→en cho chuỗi UI; dịch DOM động sau render (`applyDOMTranslations`/`watchAndTranslate`).
- Đổi ngôn ngữ qua pill VI/EN; lưu vào `localStorage` và profile user (`/me/lang`), reload
  để áp dụng. Tiền tệ format theo ngôn ngữ: `1.000đ` (vi) vs `1,000 VND` (en).

---

## 9. Chi tiết từng module

### 9.1 Launcher (`index.html`)
Hub sau đăng nhập. Logo lớn giữa trên nền cuộn. **Branch picker** (tên chi nhánh + nút "⇄
Đổi chi nhánh" chỉ cho user nhiều chi nhánh + "Đăng xuất"). **Lưới thẻ module** (`.dev`)
auto-fit, nhóm theo `MODULE_GROUPS` (Thiết yếu, Bán hàng, Chuỗi cung ứng, Tài chính, Năng
suất, Studio, Cài đặt, Developer). Module `active` bấm vào được, module roadmap mờ + nhãn
"Đang nằm trong roadmap". Khi tải hiện skeleton card. Footer mẹo: mở nhiều tab cạnh nhau để
thấy realtime.

### 9.2 iPad Self-Order (`ipad.html`) — kiosk khách
- **Hardening kiosk** ngay từ `<head>` (chặn context menu, selection, gesture, drag),
  viewport khóa zoom, thêm `body.kiosk`.
- **Table gate**: chưa chọn bàn → màn khóa; nhân viên **chạm logo 3 lần** để mở
  `renderTablePick` (yêu cầu PIN nhân viên) rồi chọn bàn. Tham số `?pick=1` ép vào chế độ
  chọn bàn.
- **Header iPad** (`.ipad-top`): khóa thương hiệu (logo + chi nhánh · Trực tiếp), chip "Bàn
  X", online dot, bộ VI/EN, nút "🔔 Gọi nhân viên".
- **Hai chế độ trình bày theo hướng máy**:
  - **Ngang (`renderLandscape`)**: cột danh mục (`.cats` icon + tên) | danh sách món
    (`.menulist`) | **giỏ hàng** (`.cartpane`) cố định bên phải. Món hết hàng tự xuống cuối
    (`available:false`). Giỏ hiện số món, tạm tính, phần "đã gửi bếp" (`renderSent`).
  - **Dọc + bật menu quyển (`renderBook`)**: **flipbook** 28 trang ảnh `.webp` lật như
    sách (có animation + tiếng lật), hotspot bấm vào ảnh để thêm món. Quản lý bật/tắt và
    thay quyển từ Cài đặt (`/book-menu`, realtime `book-menu:updated`).
- Khách tự chọn → gửi → **chờ nhân viên xác nhận** (không xuống bếp ngay). Thanh toán xong
  POS phát `payment:done` → iPad tự dọn giỏ + cảm ơn.

### 9.3 FnB POS (`pos.html`) — POS theo sơ đồ bàn
- Layout 2 cột: **sơ đồ bàn** trái (cuộn) | **bill pane** phải (340–380px).
- **Floor**: thanh `.floorbar` (tổng quan + thống kê chip), chia **zone/khu vực**, lưới thẻ
  bàn `.tcard` (auto-fill ~104px). Trạng thái bàn bằng màu nền/viền: `free` (trắng), `busy`
  (vàng), `paying` (tím), `calling` (đỏ + animation `ringing`), `sel` (outline brand). Thẻ
  hiện số bàn (mono), trạng thái, số tiền, cờ.
- **Bill pane**: header bàn, danh sách dòng món `.bitem` (tên + giá mono + modifier/note),
  footer tổng (`brow`, dòng `tt` tổng lớn brand), hàng nút thao tác (`billbtns`/`billops`):
  thêm món FnB, thêm retail, chuyển bàn, gộp bàn, **tách bill/thanh toán riêng**, giảm giá
  (`discbar`), chọn khách (`custline`/`custlist`). Trống → empty state logo + "Chọn một bàn
  để xem bill".
- **Chuông chờ xác nhận** (`.pendingbell`): badge đỏ số đơn khách vừa gửi từ iPad, nhấp
  nháy khi "hot". Mở **màn xác nhận** (`confirm-shell`): cột tab đơn | chi tiết từng dòng để
  duyệt/từ chối (kèm lý do) trước khi xuống bếp.
- **Thanh toán** (`pay-modal`, 640px): tóm tắt số tiền, **lưới phương thức** (`pay-methods`:
  tiền mặt, QR, internet banking, cà thẻ...), khu QR (`pay-qr` ảnh 220px + thông tin ngân
  hàng + mã `DANBILL`), **đa phương thức** (`pay-lines`) cộng dồn tới khi đủ (`remain`
  ok/no). Tích hợp auto-confirm payOS/SePay và cà thẻ VCB.
- **Hóa đơn/biên lai** (`.receipt`): mẫu in nền giấy ngà, font mono, hỗ trợ template động
  (`receipt-canvas-live` đặt phần tử tuyệt đối theo tỉ lệ giấy) + QR.
- **Ca & két tiền** (`shiftbtn` + `shift-box`): mở/kết ca, đếm mệnh giá (`denom-grid`),
  báo cáo ca (`shift-report`). Dùng chung `shared/shift.js`.

### 9.4 Retail POS (`retail.html`) — bán lẻ quét mã vạch
- **Đa hóa đơn**: thanh tab `.tab-bar` ("Hóa đơn 01, 02...") giữ nhiều giỏ song song, lưu
  `localStorage`, tự đánh số lại khi đóng tab.
- Layout 2 cột: **giỏ hàng** trái cố định | **lưới sản phẩm** phải. Trên cùng là **scanbox**:
  ô nhập mã vạch/từ khóa (Enter để thêm), nút "📷 Quét" (camera scanner), nút "Thêm", toggle
  "Chỉ còn hàng" (`stocktoggle` dạng switch).
- **Lưới sản phẩm** `.rtgrid` (auto-fill ~154px) + bộ đếm kết quả; chạm để thêm.
- **Giỏ** cho chọn **lot/HSD** từng dòng (bán lẻ có hạn dùng), giảm giá, voucher retail
  (`🎁 Voucher`), chọn khách (`👤`), yêu cầu hóa đơn công ty (`invoiceRequest.js`), ca +
  lịch sử đơn.
- **Mobile**: cột đổ dọc; giỏ trở thành **bottom-sheet** trượt lên (`.cartpane.open`) +
  thanh dưới cố định `.rt-mobilebar` ("Chọn lại" / "Xem đơn N").

### 9.5 KDS (`kds.html`) — màn hình bếp
- **Tab station** trong topbar: Tất cả / 🔥 Bếp / 🍹 Bar / 🥗 Salad-Lạnh / 🥤 Beverage —
  mỗi tab có **badge số đang chờ** + **badge "N trễ"** đỏ, viền đỏ khi có món trễ.
- **Lưới vé** `.kdsgrid` (auto-fill ~240px). Mỗi `.ticket`: header (#mã đơn mono · 🪑 bàn ·
  **đồng hồ đếm tiến mm:ss**), thân (qty× tên lớn, modifier `+...`, note nền vàng viền trái,
  **thanh SLA** đổ màu green→vàng→đỏ theo % thời gian), footer **nút workflow** theo trạng
  thái: Nhận món → Bắt đầu làm → Xong ✓ → Đã giao. Vé **trễ** viền+glow đỏ; vé **hủy** nền
  hồng + nhãn "MÓN ĐÃ HỦY" + nút "Xác nhận đã hủy".
- Timer cập nhật mỗi giây; đơn mới đẩy realtime + phát chuông. Empty state ✨ "Không có món
  nào đang chờ".

### 9.6 Kênh online (`online.html`)
- **Layout 3 panel**: trái = tra cứu + danh sách đơn (ô tìm theo mã/SĐT/tên/email + lọc
  **kênh** website-Haravan/GrabFood/ShopeeFood + lọc **trạng thái** chưa/đã thanh toán,
  chưa/đã giao); giữa = chi tiết đơn; phải = khách + tóm tắt. Chip đếm tổng đơn ở topbar.
  Đơn mới đẩy realtime + chuông.

### 9.7 Kho (`warehouse.html`)
- **Thanh kho** `.whbar`: pill từng kho, icon theo loại (🍳 kho bếp / 🏬 kho retail), chọn
  để đổi kho hoạt động.
- **6 subtab**: Kho · Nhập/Xuất · Phiếu nhập/xuất · Kiểm kho · Lot & HSD · Lịch sử.
- **Chip cảnh báo** ở topbar: "⚠ N tồn thấp · M lot gần HSD" (đỏ) hoặc "✓ Kho ổn" (xanh).
- Kho retail dùng SKU (`/skus`), kho bếp dùng nguyên liệu (`/inventory`); kiểm kho kiểu
  KiotViet (count sheet). Hỗ trợ quét camera khi nhập/xuất.

### 9.8 Quản lý (`admin.html`) — Dashboard + 2 "shell" lồng
File lớn nhất, đảm nhiệm 3 "view" qua sub-route:

**a) Dashboard (mặc định `/admin`)**
- **5 thẻ KPI** (`.cards`): Doanh thu ca hôm nay · Số bill · Bill trung bình · Đơn đang mở ·
  Cảnh báo kho (đỏ nếu >0). Dòng `dashWindow` ghi rõ phạm vi (Ca hôm nay / Trong ngày).
- Panel **🔥 Top món bán chạy** (bảng SL/doanh thu).
- **Biểu đồ doanh thu theo giờ** (`hbar` cột) + **theo thời gian** với segment chọn
  Ngày/Tuần/Tháng/Quý/Năm (`#trendSeg`).
- Panel **Phương thức thanh toán** + **Doanh thu theo kênh** (thanh ngang %).
- Nút "📄 Báo cáo" ở topbar mở Reports center. Tất cả tự refresh theo sự kiện realtime
  (`stats:dirty`, `payment:done`, `shift:updated`, `inventory:updated`...). Khi tải hiện
  skeleton (cả thẻ, bảng, biểu đồ).

**b) Settings shell (`/settings/:slug`)** — bố cục Haravan, deep-link
- `body.settings-shell`, sidebar trái `.settings-sidebar` + nội dung phải. **11 tab** (mỗi
  tab icon SVG + tiêu đề + mô tả), URL đồng bộ `/settings/<slug>`:
  | Tab (key) | slug | Nội dung |
  |-----------|------|----------|
  | Nhân sự & Phân quyền (`users`) | `staff` | Tài khoản, vai trò, quyền |
  | Chi nhánh & phân vùng (`branches`) | `location` | Chi nhánh, kho, phân vùng |
  | Liên kết (`integrations`) | `integrations` | HĐĐT, kế toán, sàn bán |
  | Kết nối (`connections`) | `connections` | Thiết bị, máy in, sync cloud |
  | Tài chính & Hóa đơn (`operations`) | `finance` | Ca, thanh toán, QR, HĐĐT |
  | Kho & kênh bán (`warehouse`) | `warehouse` | Kho + kênh bán |
  | Bill & Tem nhãn (`print`) | `print` | Thiết kế mẫu in bill/tem |
  | Thiết bị khách (`devices`) | `devices` | Màn self-order, iPad |
  | Menu (`menu`) | `menu` | Danh mục, món, menu quyển |
  | Cấu hình bàn & Sơ đồ (`tables`) | `tables` | Bàn, khu vực, sơ đồ |
  | Âm thanh thông báo (`notification_sound`) | `sounds` | Bật/tắt, âm lượng, chọn âm |
  - Tab chỉ hiện theo quyền (`settings.*`/`warehouse.manage`). Thao tác nhạy cảm (đổi tiền
    két gốc, tạo/cấu hình kho) cần **re-auth PIN**.

**c) Reports center (`/reports/:slug`)** — modal toàn màn với sidebar trái nhóm báo cáo
(`.report-sidebar` → `.report-group-title` + `.report-item`), nội dung báo cáo bên phải,
deep-link `/reports/<key-gạch-ngang>`.

### 9.9 Liên hệ (`contacts.html`)
Danh bạ **dùng chung khách hàng + nhà cung cấp** (1 bảng customers). Ô tìm (tên/SĐT/MST/công
ty) + form thêm (tên, công ty, SĐT, email, MST 10/13 số, người phụ trách NCC, địa chỉ, loại
perk/giá trị, ghi chú). Là nền cho POS, Mua hàng, Kho, công nợ.

### 9.10 Mua hàng (`purchase.html`)
Đơn mua → **nhận vào kho** (tái dùng luồng nhập kho) → **theo dõi công nợ NCC**. Tìm theo
mã đơn/NCC; form chọn NCC + thêm mặt hàng (autocomplete từ kho hoặc gõ tay), ghi chú; có
modal ghi nhận thanh toán công nợ ("trả đợt 1"...).

### 9.11 Chi phí (`expenses.html`)
Sổ chi phí theo danh mục. Thẻ tổng quan trên cùng (`.cards`). Hai nguồn chi: **từ tiền két**
(trừ ca, tái dùng cashDrawer) hoặc **kế toán chi trực tiếp** — đã đối soát, không trùng kép.

### 9.12 Hóa đơn điện tử (`invoices.html`)
Danh sách HĐĐT đã phát hành. Thẻ tổng quan + ô tìm (số HĐ/khách/MST/mã tra cứu). Xem chi
tiết, tra cứu, hủy theo quy định.

### 9.13 Quản lý CSDL (`database.html`)
3 subtab deep-link: **Cơ sở dữ liệu** (theo dõi engine local, backup cấu hình, thống kê),
**Nhật ký hoạt động** (audit SQLite tối đa 3 năm, ô tìm theo hành động/nhân viên/nội dung;
câu mô tả audit Việt hóa qua `describeAudit`), **Tài liệu**.

### 9.14 In ấn (`printers.html`)
Máy in thật, két tiền, **lịch sử in** và **in lại có kiểm tra trước**. Ô tìm theo bàn/mã
job/món/hóa đơn/phiếu kho.

### 9.15 Tài liệu (`documents.html`)
Trình đọc tài liệu kiến trúc/vận hành ngay trong app, có ô tìm kiếm.

### 9.16 Simulator (`sim.html`)
Công cụ xem trước: khung **bezel iPad** (có nút nguồn/camera vẽ bằng CSS) bọc iframe màn
thật. Segment chọn **thiết bị** (iPad/Retail/POS/KDS/Quản lý), **hướng** (dọc/ngang),
**model** (Air 11″/Pro 13″/mini); có nút full-screen. Dùng để kiểm thử responsive nhanh.

---

## 10. Quy ước & pattern xuyên suốt (tóm tắt cho người mới)

1. **Một bộ token, một header, một CSS** — muốn đổi thẩm mỹ toàn hệ thống chỉ sửa
   `web/shared/app.css` (`:root`).
2. **Màu = ngữ nghĩa**: xanh dương=mới, vàng=đang làm, xanh lá=xong/ok, đỏ=trễ/lỗi,
   tím=đang thanh toán. Dùng đúng `chip`/`vl` màu tương ứng.
3. **Số/tiền/mã luôn dùng font mono** (`var(--mono)`).
4. **Deep-link sub-route** `/<module>/:tab` cho các module đã redesign (settings, reports,
   database, contacts) — back/forward và reload giữ đúng tab.
5. **Realtime-first**: mọi màn `connect()` và tự cập nhật; không cần F5.
6. **Skeleton khi tải, empty state thân thiện khi rỗng, toast cho phản hồi nhanh.**
7. **Touch & POS-terminal là công dân hạng nhất**: nút to khi `pointer:coarse`, compact mode
   theo chiều cao màn, kiosk hardening cho màn khách.
8. **Bảo mật trong UX**: PIN pad cho đăng nhập + re-auth thao tác nhạy cảm; chặn quyền bằng
   panel thay thế thay vì ẩn lặng.

> Khi thêm màn mới: nạp `shared/client.js`, gọi `topbar(key,{title,sub,actions})` +
> `requireModuleAccess(key)` + `renderUserChip()`, đăng ký `connect()`, và **chỉ dùng class
> dùng chung** — tránh tạo style trùng lặp với app.css.
