# Tích hợp MISA meInvoice

Cập nhật: 2026-08-03

## 1. Mã nguồn nằm ở đâu

```text
server/services/misa/
  index.js       cửa vào DUY NHẤT — cả hệ thống chỉ import từ đây
  config.js      địa chỉ API (cấu hình được), điều kiện kích hoạt, trạng thái
  client.js      HTTP + timeout + PHÂN LOẠI lỗi tạm thời / lỗi dữ liệu + che secret
  auth.js        token: cache, tự gia hạn, single-flight
  company.js     thông tin doanh nghiệp + danh sách mẫu hóa đơn
  payload.js     snapshot bill → payload MISA (toán VAT, kiểm cân đối tiền)
  invoice.js     phát hành / tra trạng thái / hủy
  connection.js  kiểm tra kết nối 3 bước

server/services/einvoice.js   hàng đợi, trạng thái, retry, đối soát
server/modules/settings/routes.js   API cấu hình + kiểm tra kết nối
```

Nơi gọi: `einvoice.js` (hàng đợi) và `invoices.js` (phát hành trực tiếp). Cả hai
dùng CHUNG một hàm dựng payload — không còn hai công thức tính tiền song song.

## 2. Luồng cấu hình

```text
Thiết lập → Tích hợp → MISA meInvoice
  nhập: môi trường, mã số thuế, tài khoản, mật khẩu, appId
  bấm "Kiểm tra kết nối"
    → server: đăng nhập lấy token
    → server: GET company?taxcode=…   (xác nhận đúng pháp nhân, lấy có mã/không mã)
    → server: GET invoice-templates   (danh sách mẫu còn hiệu lực)
    → server GHI xuống DB: configurationTestPassed, companyName,
       invoiceCodeType, availableTemplates, lastTestedAt
  chọn Mẫu hóa đơn (ký hiệu tự đi theo mẫu)
  chọn Loại nghiệp vụ / Phương pháp thuế / Quy tắc làm tròn
  bấm "Lưu"  → trạng thái READY
```

Trạng thái: `DISCONNECTED → AUTHENTICATED → REQUIRES_TEMPLATE → READY | ERROR`.

**Chỉ khi READY** thì `isLive()` mới trả true và hóa đơn mới được gửi đi.

## 3. Luồng phát hành

```text
thanh toán thành công → đóng bill → tạo e_invoices + request_snapshot (bất biến)
  → QUEUED  (MISA chưa bật thì PENDING_PROVIDER, KHÔNG bỏ sót hóa đơn đầu ra)
  → worker mỗi 10 giây (server/index.js)
  → lần thử > 1: TRA TRẠNG THÁI trước khi gửi lại  ← chống hóa đơn trùng
  → POST publish
  → lưu invoice_no / lookup_code / tax_authority_code / transaction_id
  → ISSUED
```

Snapshot là **nguồn sự thật**: sửa giá hay tên hàng sau khi bán KHÔNG làm đổi
hóa đơn đã chốt.

## 4. Quy tắc tiền

Giá khách trả là **giá đã gồm VAT**. Tách thuế:

```text
VAT = gross × r / (100 + r)
net = gross − VAT
```

Giảm giá được phân bổ theo tỷ trọng từng dòng, dòng cuối nhận phần dư làm tròn.
`assertBalanced()` chặn không cho gửi hóa đơn lệch tiền.

## 5. Khi hợp đồng API của MISA khác mặc định

MISA cấp hợp đồng riêng theo gói dịch vụ. Mặc định trong code là **API v3**:

| Thao tác | Mặc định | Ô ghi đè trong Cài đặt |
|---|---|---|
| Đăng nhập | `/auth/token` | `endpointAuth` |
| Doanh nghiệp | `/company` | `endpointCompany` |
| Mẫu hóa đơn | `/invoice-templates` | `endpointTemplates` |
| Phát hành | `/code/itg/invoice-calculating/invoiceandpublish` | `endpointPublish` |
| Tra trạng thái | `/invoice/status` | `endpointStatus` |
| Hủy | `/invoice/cancel` | `endpointCancel` |

Ghi đè nhận cả đường dẫn tương đối lẫn URL tuyệt đối. **Lệch hợp đồng thì sửa
Cài đặt, KHÔNG phải sửa code và build lại.**

Tên trường trong response được đọc theo nhiều biến thể (`InvNo`/`invoiceNo`/
`invoice_no`…) nên khác cách đặt tên vẫn chạy.

## 6. Bảo mật

- Mật khẩu/secret mã hóa khi lưu; API trả xuống đã che.
- `sanitize()` cắt token/password/appId khỏi mọi log và mọi bản ghi
  request/response lưu trong DB.
- Token chỉ nằm trong RAM của server, không bao giờ xuống client.

## 7. Chống hóa đơn trùng

- `idempotency_key` UNIQUE trên bảng `e_invoices`.
- `RefID` gửi MISA = `einv:<mst>:<chi nhánh>:<bill>:v<phiên bản snapshot>` —
  hai máy cùng xử lý một bill vẫn ra cùng một khóa.
- Lần thử thứ hai trở đi **luôn tra trạng thái trước**.
- MISA báo `DUPLICATE_REFID` thì đồng bộ về, không coi là lỗi.

## 8. Kiểm chứng

`server/misa-end-to-end.test.mjs` dựng một **máy chủ MISA giả** nói đúng giao
thức v3 và chạy trọn: kiểm tra kết nối 3 bước → sai mật khẩu → sai mã số thuế →
chọn mẫu → bán một đơn thật → snapshot → hàng đợi → phát hành → chạy lại hàng
đợi không sinh hóa đơn thứ hai → MISA đã nhận nhưng POS hết giờ → bật MISA muộn
vẫn phát hành bù.

```bash
node --test server/misa-end-to-end.test.mjs
```

## 9. Còn lại đúng một ẩn số

Toàn bộ phía Dan D Pak đã chạy được và có test. Thứ **chưa thể xác nhận** là
đường dẫn + tên trường THẬT trong hợp đồng MISA cấp cho doanh nghiệp, vì đó là
dữ liệu chỉ chủ tài khoản có.

Nghiệm thu bằng tài khoản sandbox:

1. Nhập thông tin ở Thiết lập → Tích hợp → MISA.
2. Bấm **Kiểm tra kết nối**. Sai bước nào màn hình nói rõ bước đó
   (`auth` / `company` / `templates`).
3. Lệch đường dẫn thì điền ô `endpoint…` tương ứng rồi kiểm tra lại.
4. Chọn mẫu → Lưu → trạng thái `READY`.
5. Bán một đơn thử, xem hóa đơn xuất hiện trong danh sách với số hóa đơn và mã
   tra cứu.
