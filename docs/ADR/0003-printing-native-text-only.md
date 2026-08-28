# ADR-0003: Printing — Native Text Only, No App-Level Rasterization

- Status: Accepted
- Date: 2026-08-14

## Bối cảnh
Font mặc định máy in nhiệt (ROM Font A/B) bị "răng cưa/pixel" khi phóng to, và
tiếng Việt qua raw ESC/POS dễ mất dấu. Có cám dỗ "render bill thành ảnh cho đẹp".

## Quyết định
**CẤM tuyệt đối application-level receipt rasterization**: không render bill thành
PNG/Canvas/screenshot/HTML→ảnh/PDF→ảnh rồi gửi ảnh xuống máy in. (Đã thử
`server/services/print_raster.js` HTML→Chromium→PNG→`GS v 0` — ĐÃ GỠ SẠCH.)

Kiến trúc hybrid theo loại máy — `ReceiptDocument → LayoutEngine → Backend`:

1. **EscPosBackend** — LAN raw 9100 / phiếu bếp / bar / fallback. Font ROM, siêu
   ổn định. Phóng to dùng `GS ! 0x11` (2× rộng + 2× cao, đã verify).
2. **WindowsDriverBackend** (MỚI) — bill khách trên K80 Windows ('system'). Server
   dựng semantic doc (`services/receipt_doc.js`); agent Windows in bằng
   `System.Drawing.Printing.PrintDocument` + `Graphics.DrawString/MeasureString`,
   font TrueType (Segoe UI/Roboto…), đo cột thật (không dựa khoảng trắng), đo
   chiều cao nội dung để giấy vừa khít. **Driver raster hoá ở tầng thiết bị** —
   KHÁC HẲN in ảnh tầng app. Kết quả: font mượt + tiếng Việt chuẩn 100% (bỏ được
   `ascii()`). Bật/tắt per-printer (`renderMode`, `driverFont`).
3. **SunmiNativeBackend** — máy Sunmi cầm tay. Plugin `sunmi_printer_plus` v4 có
   `printText`/`printRow`/`printQRCode` (font hệ điều hành). Hiện dùng
   `printEscPos` — sẽ chuyển sang API text native (pending, cần test máy thật).

## Ranh giới "được phép rasterize"
Đầu in nhiệt vốn là thiết bị raster → OS print driver / firmware raster hoá glyph
ở TẦNG CUỐI là ĐƯỢC PHÉP. Chỉ CẤM app tự tạo ảnh cả bill. QR/mã vạch: lệnh native
của máy (ESC/POS) hoặc đồ hoạ nhỏ ở driver-mode — không phải "bill thành ảnh".

## Hệ quả
- Fallback an toàn: dựng doc lỗi → agent in ESC/POS (bill luôn ra).
- Mặc định `renderMode='escpos'` → không đổi hành vi live cho tới khi bật.
- Font pixel trên máy nhiệt raw là giới hạn phần cứng ROM — chỉ đường driver đổi được.
- Test hardware bắt buộc (mission #57): nút "In thử" ở chế độ driver in bill mẫu.
