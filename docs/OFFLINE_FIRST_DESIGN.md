# Bước 2 — Local Hub + Offline-first (Thiết kế)

> Mục tiêu: **cửa hàng vẫn bán / in / mở két kể cả khi mất internet hoặc VPS chết**,
> và tự đồng bộ lên VPS khi có mạng lại. Đây là phần "cứu" khi rớt mạng — quan
> trọng nhất của một hệ POS. Bước 1 (auto-update OTA) đã xong.

## 1. Vì sao cần (điểm yếu hiện tại)

Hiện tại là **STAR thuần**: mọi thiết bị (POS/tablet/KDS) nối thẳng VPS. VPS hoặc
internet chết → **cả cửa hàng ngừng bán**. Không chấp nhận được với POS.

## 2. Kiến trúc đích (hierarchical hybrid)

```
                 VPS (Hub toàn hệ thống)              ← nguồn sự thật TOÀN CHUỖI
                 gộp mọi CN · báo cáo · e-invoice · OTA
                        ▲   sync 2 chiều (khi có mạng)
        ┌───────────────┴───────────────┐
   [Local Hub CN A]                 [Local Hub CN B]   ← nguồn sự thật TRONG CN
   Node + SQLite tại cửa hàng        (mỗi CN 1 hub)
        ▲ LAN (luôn sống)
   ┌────┼─────┬──────────┐
  POS  Tablet  KDS   Màn khách                          ← client mỏng, nối Local Hub
```

**Nguyên tắc vàng:** thiết bị KHÔNG nối thẳng VPS nữa (trừ back-office xem từ xa).
Thiết bị nối **Local Hub trong LAN cửa hàng** → LAN không bao giờ phụ thuộc internet
→ bán offline được. Local Hub mới là bên nói chuyện với VPS.

## 3. Vai trò từng thành phần

| Thành phần | Vai trò |
|---|---|
| **VPS** | Sự thật toàn chuỗi. Nhận sync từ các Local Hub, gộp báo cáo, xuất e-invoice, phát OTA. KHÔNG phục vụ trực tiếp thiết bị POS. |
| **Local Hub** (1 máy/CN: máy POS quầy hoặc mini-PC) | Chạy `server/index.js` tại cửa hàng. Là nơi POS/tablet/KDS ghi/đọc. Hàng đợi thay đổi → đẩy lên VPS khi online; kéo thay đổi từ VPS về. Điều khiển máy in/két qua LAN (đã có Hardware Agent). |
| **Thiết bị** (POS/tablet/KDS) | Client mỏng, nối Local Hub qua LAN. `discovery_service` (đã có) tự dò Local Hub trong subnet. |

## 4. Cơ chế đồng bộ (an toàn, chống mất/đè dữ liệu)

### 4.1 Change feed (đã có nền)
Mỗi Local Hub ghi mọi thay đổi vào `sync_queue` (trigger SQLite đã có). Mỗi bản
ghi thay đổi có: `table, ref (pk), op, payload, updated_at, origin_device, seq`.

### 4.2 Định danh & chống trùng (idempotency)
- Mỗi Local Hub có `hub_id` cố định. Mỗi bản ghi sync mang `hub_id + seq` (số tăng dần).
- VPS lưu `processed_seq` theo từng hub → đẩy lại cùng bản ghi cũng KHÔNG áp 2 lần
  (chống double khi mạng chập chờn).

### 4.3 Chống XUNG ĐỘT (2 nơi sửa cùng 1 bản ghi)
Quy tắc theo LOẠI dữ liệu (không dùng "last-write-wins" mù cho mọi thứ):
- **Giao dịch chỉ-ghi-thêm** (orders, payments, kds_logs, cash entries, audit): KHÔNG
  bao giờ sửa chéo — mỗi bản ghi thuộc về đúng 1 CN, chỉ CN đó tạo. Sync = append.
  **An toàn tuyệt đối, không xung đột.** → Làm TRƯỚC.
- **Tồn kho (stock_lots, skus.stock)**: xung đột thật (bán ở POS + nhập ở kho cùng lúc).
  Dùng **delta** thay vì giá trị tuyệt đối: sync "−2 lọ lô X" chứ không sync "còn 8".
  VPS cộng dồn delta → không đè. Local Hub là nơi trừ kho FEFO (đã có `inventory.js`).
- **Danh mục (menu, giá, cấu hình)**: sự thật thuộc VPS (owner sửa ở back-office) →
  VPS → Local Hub một chiều (pull). Local Hub không tự sửa danh mục.

### 4.4 Bầu hub dự phòng (mesh, chống chết 1 máy)
Nếu Local Hub chính chết: các thiết bị (đã có `discovery_service`) không thấy hub →
một máy POS được cấu hình "có thể làm hub" tự bật `server/index.js` lên làm hub tạm,
tiếp tục bán; khi hub chính sống lại, merge change feed 2 bên bằng `hub_id + seq`.
(Giai đoạn sau — không bắt buộc cho MVP offline.)

## 5. Lộ trình TĂNG DẦN (mỗi bước tự chạy + test được)

> Làm từng bước, test kỹ rồi mới sang bước sau. Sync sai = mất dữ liệu → không vội.

- **B2.1 — Local Hub cơ bản (offline bán được).** Thiết bị nối Local Hub LAN (đã có
  `discovery_service` + `NodeRunner`). Bỏ ép nối VPS ở cửa hàng. Test: rút mạng WAN,
  vẫn bán/in/mở két. *Chưa cần sync lên VPS.* — **Giá trị lớn nhất, rủi ro thấp nhất.**
- **B2.2 — Đẩy 1 chiều Local Hub → VPS (append-only).** Wire `CENTRAL_SYNC_URL`:
  đẩy orders/payments/shifts/audit lên VPS (idempotent theo hub_id+seq). VPS gộp báo
  cáo toàn chuỗi. Test: tạo đơn offline → có mạng → đơn xuất hiện trên VPS đúng 1 lần.
- **B2.3 — Kéo danh mục VPS → Local Hub.** Owner sửa menu/giá ở back-office (VPS) →
  Local Hub các CN tự kéo về. Một chiều, không xung đột.
- **B2.4 — Tồn kho bằng delta.** Đồng bộ tồn kho dạng cộng/trừ delta (mục 4.3). Test
  đua: bán + nhập cùng lúc 2 nơi → tồn cuối đúng.
- **B2.5 — Hub dự phòng (bầu leader).** Chỉ khi cần độ sẵn sàng cao.
- **B2.6 — OTA qua Local Hub.** Local Hub tải bản mới từ VPS 1 lần rồi phát cho thiết
  bị trong LAN (tiết kiệm băng thông). Ghép với auto-update đã có.

## 6. Rủi ro & cách chặn

- **Mất/đè dữ liệu:** dùng append-only + delta + idempotency (mục 4). KHÔNG last-write-wins mù.
- **Đồng hồ lệch giữa các máy:** dùng `hub_id + seq` (thứ tự nội bộ mỗi hub) làm mốc, không dựa `updated_at` để phân xử.
- **Sync nửa chừng khi mất mạng:** giao dịch theo lô + xác nhận đã-nhận từ VPS mới đánh dấu `done`; chưa xác nhận thì gửi lại (an toàn nhờ idempotency).
- **Test:** mỗi bước có kịch bản rút-mạng + đua-ghi, chạy trên máy dev bằng 2 tiến trình (giả Local Hub + VPS) trước khi lên thật.

## 7. Bắt đầu từ đâu

**B2.1 (Local Hub cơ bản)** — cho phép bán offline, rủi ro thấp nhất, giá trị cao nhất,
gần như KHÔNG đụng logic sync phức tạp (chỉ định tuyến thiết bị về Local Hub thay vì VPS).
Đây là bước nên làm trước.

> Lưu ý điều phối: hiện có nhiều file server/app đang được sửa song song (video ads,
> modules...). Các bước B2.2+ đụng `server/` nên sẽ làm sau khi phần đang sửa ổn định,
> tránh xung đột.
