# Hợp đồng cầu nối JS ↔ Native (`NativeCardTerminal`)

Phần **web đã cài sẵn** trong `web/shared/cardTerminal.js`. Lớp Android **phải tuân thủ đúng**
chữ ký dưới đây thì chế độ `auto` mới chạy. Nếu không có object này, web tự chạy chế độ `manual`.

## 1. Native expose object (gọi từ WebView)

```js
window.NativeCardTerminal = {
  // Bắt đầu một giao dịch quẹt thẻ. KHÔNG trả về trực tiếp — trả kết quả qua callback (mục 2).
  charge(payloadJson: string, token: string): void
}
```

`payloadJson` (web gửi xuống) — chuỗi JSON:

```json
{
  "amount": 150000,            // số tiền (VND, số nguyên)
  "reference": "POS-Dan2606001", // mã tham chiếu nội bộ (gợi ý in lên slip)
  "billNo": "Dan2606001",      // số bill nội bộ
  "terminalName": "VCB SmartPOS",
  "token": "ct3_lxyz..."       // ID giao dịch phía web — PHẢI trả lại nguyên văn ở callback
}
```

## 2. Native gọi lại khi xong (thành công / thất bại / hủy)

```js
window.__cardTerminalResult(token: string, resultJson: string)
```

Từ Kotlin:
```kotlin
val js = "window.__cardTerminalResult(${JSONObject.quote(token)}, ${JSONObject.quote(resultJson)})"
runOnUiThread { webView.evaluateJavascript(js, null) }
```

`resultJson` — chuỗi JSON:

| Field | Bắt buộc | Ý nghĩa |
|---|---|---|
| `approved` | ✅ | `true` nếu thẻ được duyệt, `false` nếu từ chối/hủy |
| `txnId` | nên có | Mã giao dịch của máy/acquirer |
| `rrn` | nên có | Retrieval Reference Number (đối soát) |
| `approval` | nên có | Approval / Auth code in trên slip |
| `mask` | tùy | 4 số cuối thẻ đã che, vd `**** **** **** 1234` |
| `scheme` | tùy | `VISA` / `MASTERCARD` / `NAPAS`... |
| `terminal` | tùy | TID hoặc tên máy |
| `error` | khi `approved=false` | Lý do (timeout / khách hủy / thẻ bị từ chối...) |

Ví dụ duyệt thành công:
```json
{ "approved": true, "txnId": "VCB240620A1", "rrn": "417112233445",
  "approval": "123456", "mask": "**** **** **** 1234", "scheme": "VISA", "terminal": "VCB-TID-001" }
```

Ví dụ thất bại:
```json
{ "approved": false, "error": "Khách hủy giao dịch" }
```

## 3. Lưu ý

- Web có **timeout 180s** chờ callback. Native nên luôn gọi `__cardTerminalResult` (kể cả khi lỗi/hủy) để UI không treo.
- `token` phải khớp 1-1 với lời gọi `charge` tương ứng (web dùng nó để định tuyến nhiều giao dịch).
- Card meta (`txnId/rrn/approval/...`) được web gửi tiếp về server và lưu vào `payment_lines.card_*` để **đối soát** với sao kê VCB.
