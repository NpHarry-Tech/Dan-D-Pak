# Android POS wrapper — cầu nối thanh toán thẻ (VCB SmartPOS)

App Android mỏng **bọc web POS hiện có trong WebView** và cấp một cầu nối JS↔native để:
- Bấm "Quẹt thẻ" trong web POS → gọi app ngân hàng (VCB) trên máy → nhận kết quả.
- In bill hệ thống qua máy in nhiệt của thiết bị.

> ⚠️ Đây là **bộ khung (scaffold)**. Nó **chưa build được ngay** vì còn thiếu 2 thứ phải lấy
> từ đối tác, không có trên internet:
> 1. **Tài liệu tích hợp ECR / Intent của VCB** (cách gọi app VCB và nhận approval code) — xin từ Trung tâm thẻ / hỗ trợ POS Vietcombank.
> 2. **Printer SDK của hãng máy** (PAX / Sunmi / Telpo / Aisino...) — xin từ nơi bán máy.
>
> Khi có đủ, điền vào 2 chỗ `TODO(VCB)` và `TODO(PRINTER)` trong `app/CardTerminalBridge.kt`.

## Kiến trúc 3 chế độ (khớp với web)

Web đã hỗ trợ tự rớt chế độ (`web/shared/cardTerminal.js`):

| Chế độ | Khi nào | Cần gì từ VCB |
|---|---|---|
| **auto** | App này có mặt + native bridge hoạt động | Tài liệu Intent/SDK của VCB |
| **manual** | Không có bridge (hoặc VCB không cho tích hợp) | **Không cần gì** — thu ngân tự quẹt trên app VCB rồi nhập approval code |
| **mock** | Demo trên trình duyệt PC | Không |

→ Dù VCB **từ chối** cho tích hợp, hệ thống **vẫn chạy** ở chế độ `manual`. App này chỉ để nâng cấp lên `auto`.

## Cách hoạt động (chế độ auto)

```
WebView (web POS)
  │  window.NativeCardTerminal.charge(payloadJson, token)
  ▼
CardTerminalBridge (Kotlin @JavascriptInterface)
  │  startActivityForResult → Intent app VCB   ← TODO(VCB)
  ▼
App VCB xử lý quẹt thẻ → trả result
  │  webView.evaluateJavascript("window.__cardTerminalResult(token, resultJson)")
  ▼
Web POS: tự thêm dòng thanh toán + gọi /api/orders/:id/pay (kèm card meta) → đóng bill
  │
  ▼
In bill: web gọi luồng in sẵn có HOẶC native in qua Printer SDK  ← TODO(PRINTER)
```

## Build (sau khi có SDK)

1. Mở thư mục này bằng **Android Studio** (tạo project Empty Views Activity, hoặc gắn các file `app/*.kt` vào project có sẵn).
2. Thêm dependency Printer SDK + (nếu có) Payment SDK của VCB vào `build.gradle`.
3. Sửa `WEB_POS_URL` trong `MainActivity.kt` trỏ về server cửa hàng (vd `http://192.168.1.10:3000`).
4. Điền `TODO(VCB)` và `TODO(PRINTER)`.
5. Build APK → cài lên máy POS.

## Hợp đồng cầu nối JS↔native

Xem [`CONTRACT.md`](./CONTRACT.md) — đây là phần web đã cài sẵn; native phải tuân theo đúng để khớp.
