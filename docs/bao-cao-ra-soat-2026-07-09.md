# Báo cáo rà soát & tinh gọn toàn bộ mã nguồn — 09/07/2026

Phạm vi: toàn bộ `server/` (~17.000 dòng JS) đọc chi tiết từng file lõi; hai app Flutter
`dandpak_pos` + `dandpak_tablet` (~56.000 dòng Dart) quét bằng máy (analyze/test) kết hợp
đọc tay các phần trọng yếu. Mọi thay đổi bên dưới đã kiểm chứng: server khởi động sạch,
`flutter analyze` 2 app = 0 cảnh báo, toàn bộ test pass.

---

## 1. Tính năng mới: vùng kéo ẩn của Màn hình phụ

**Yêu cầu:** thanh ẩn ở mép trên màn hình phụ — giữ chuột kéo để dời cửa sổ, nhấp đúp để
bật/tắt toàn màn hình; mô tả cách dùng viết ngay trong phần Cài đặt.

**Đã làm:**
- `lib/services/second_window_fullscreen.dart` — thêm 3 hàm native (Win32, không đổi
  window-style lúc chạy nên không dính lỗi crash cũ):
  - `startSecondWindowDrag()` — kéo cửa sổ bằng đúng cơ chế kéo thanh tiêu đề của Windows
    (ReleaseCapture + WM_NCLBUTTONDOWN/HTCAPTION) nên rất mượt, dù cửa sổ đã bỏ viền.
  - `isSecondWindowFullscreen()` — nhận biết trạng thái bằng cách so kích thước cửa sổ với
    màn hình vật lý đang chứa nó (không phụ thuộc biến nhớ giữa 2 engine).
  - `toggleSecondWindowFullscreen()` — vào toàn màn hình: nhớ vị trí cũ, phủ kín đúng màn
    hình đang đứng (kéo sang màn nào phóng ở màn đó), TOPMOST như kiosk; thoát: về đúng
    chỗ cũ và bỏ TOPMOST.
- `second_screen.dart` — thanh `_HiddenDragBar` cao 36px ở mép trên: bình thường trong
  suốt tuyệt đối (khách không thấy), rê chuột vào mới hiện dải mờ kèm dòng gợi ý
  "Kéo để di chuyển • Nhấp đúp để phóng to / thu nhỏ".
- `settings_customer_display_panel.dart` — viết lại phần mô tả theo văn phong hướng dẫn
  người dùng: sửa subtitle công tắc, thêm panel **"Cách sử dụng"** 4 gạch đầu dòng bằng
  tiếng Việt tự nhiên, sửa thông báo sau khi mở màn hình phụ.

## 2. Lỗi thật đã tìm ra và sửa

| # | Lỗi | Hậu quả nếu không sửa | Sửa |
|---|-----|----------------------|-----|
| 1 | `server/index.js` dùng biến `ROOT` **chưa từng khai báo** ở nhánh nạp `config-seed.json` | Máy MỚI cài, DB trống, không có `CONFIG_SEED_URL` → server **sập ngay khi khởi động** (`ReferenceError`). Đây là đường đi của mọi bản cài mới. | Dùng `__dirname` trỏ đúng `server/config-seed.json` |
| 2 | `/api/dev/seed` gọi 2 script Python (`import_kiotviet_excel.py`, `import_lounge_menu.py`) **đã bị xóa khỏi repo** | Endpoint không bao giờ chạy nổi, lỗi khó hiểu khi cần seed | Chỉ còn chạy `node server/seed.js` |
| 3 | Test `app_updater_test.dart` là test tích hợp cần server thật + bản release đã publish → **luôn đỏ** trên máy dev | `flutter test` không bao giờ xanh → lâu dần không ai chạy test nữa | Tự bỏ qua trừ khi chạy với `--dart-define=E2E=true` |

## 3. Code chết / trùng lặp đã dọn

**Server:**
- Xóa `server/adapters/` (6 file stub Postgres/S3/WebSocket "chưa implement", không nơi
  nào import — chính audit nội bộ 04/07 cũng khuyến nghị xóa).
- Xóa `server/find_pin.js` (script debug cũ).
- Xóa 2 hàm không ai gọi trong `db.js`: `compactOldAuditLogs`, `purgeOldAudit` (đã bị
  thay bằng cơ chế nén nhật ký theo tháng).
- Gộp 3 đoạn upload ảnh base64 giống hệt nhau trong `api.js` (avatar nhân viên, ảnh món,
  avatar đối tác) về 1 hàm `saveBase64Image()` — bớt ~40 dòng, sửa 1 chỗ là đủ.
- Bỏ import `enterpriseStorage` thừa trong `api.js`.

**Flutter (dandpak_pos):**
- Gộp logic ghi quảng cáo base64 ra file tạm bị **lặp ở 2 nơi** (`second_screen.dart` và
  `customer_display_screen.dart`) về 1 helper mới `lib/services/ad_cache.dart`.
- Xóa 2 danh sách `_events` chết (kds_screen, online_screen), map `_channelNames` chết,
  hàm `_handleClear` chết (tablet), import/`show` thừa.

**File rác đã xóa:** `tmp_p.db*`, `tmp_s.db*`, `tmp_p.log`, `tmp_server_err.log`,
`tmp_server_run.log`, `tmp_verify_server.log`, `server/_err.log`, `server/_out.log`
(toàn bộ là sản phẩm test cũ, đều đã nằm trong .gitignore).

## 4. Chất lượng mã nguồn

- **116 cảnh báo `flutter analyze` → 0** (61 bên POS, 55 bên tablet): API Flutter cũ
  (`withOpacity`→`withValues`, `value`→`initialValue`, `Radio`→`RadioGroup`,
  `background`→`surface`), 4 chỗ dùng `BuildContext` sau `await` thiếu guard `mounted`
  (lỗi tiềm ẩn crash thật), if thiếu ngoặc, thiếu `const`.
- **Test:** 5 pass, 1 skip có chủ đích (test E2E). Server: 47 file JS đạt kiểm tra cú
  pháp, khởi động sạch 0 lỗi, backup tự chạy.
- **Build Windows release:** phải build qua `build_release.bat` (vcvars64) — build
  `flutter build windows` trần sẽ lỗi thiếu `dxgi.h` (đặc thù VS2026 Build Tools).
- Ấn tượng chung: server viết khá kỷ luật — guard + PIN + audit nhất quán trên mọi route
  nhạy cảm, không còn TODO bỏ quên, catch-nuốt-lỗi đều có chú thích lý do.

## 5. Những điểm cần Anh quyết định (em không tự làm)

1. **`server/db.sqlite` và `server/pos.db`** — 2 file rỗng 0 byte còn sót (DB thật là
   `store.db`). Nên xóa tay khi tiện.
2. **`server/store_staging.db` (159MB)** — bản nhân từ nút "Clone sang staging" ngày
   06/07. Nếu không còn dùng phiên staging đó thì xóa để nhẹ máy.
3. **`android-pos/`** — dự án Android cũ trước khi chuyển hướng Flutter (30/06). Nếu đã
   thay hoàn toàn bằng `dandpak_tablet` thì nên xóa hoặc chuyển vào nhánh lưu trữ.
4. **`dan-d-pak-pos-setup-2026-07-08.exe` (18MB) ở gốc dự án** — nên dời vào
   `server/releases/` (chỗ chuẩn của cơ chế auto-update) cho gọn.
5. **Rất nhiều thay đổi chưa commit** (xóa toàn bộ `web/`, gradle 2 app, nhiều file
   server…). Nên commit thành các cụm có ý nghĩa sớm — để dồn lâu rất khó lần lại lỗi.

## 6. Rủi ro còn mở (đã biết, chưa sửa trong đợt này)

- **CORS production:** VPS chưa đặt `CORS_ORIGIN` → nên đặt khi lên production
  (`env.js` đã có cảnh báo sẵn).
- **Khóa mã hóa nhật ký:** `AUDIT_LOG_KEY` chưa đặt → đang rơi về chuỗi mặc định trong
  source. Nên đặt biến môi trường trên VPS ngay từ đầu.
- **Socket.IO cho iPad:** thiết bị tự khai `device=ipad` được miễn token → về lý thuyết
  máy lạ trong LAN có thể vào room chi nhánh nghe sự kiện realtime. Chấp nhận được trong
  LAN cửa hàng, nhưng khi server ở VPS công khai thì nên cấp token thiết bị riêng cho iPad.
- **Postgres adapter:** đã xóa stub; khi thật sự chuyển Postgres thì viết theo kế hoạch
  trong `docs/audit/10_CLEAN_ARCHITECTURE_REFACTOR_PLAN.md` + `db/schema/0001,0002`.
