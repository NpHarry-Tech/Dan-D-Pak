# Bug reproduction ledger

| ID | Hiện tượng | Bằng chứng/cách kiểm chứng | Trạng thái |
|---|---|---|---|
| PAY-01 | Retry có thể dùng key khác | Client sinh key theo thời điểm mỗi call | Cần network-timeout test |
| PAY-02 | Payment phụ thuộc print | `printReceipt` nằm trước COMMIT | Cần test đỏ bằng injected failure |
| PRICE-01 | Promo ghi dù payment fail | Route UPDATE trước `payOrder` | Cần integration test đỏ |
| STOCK-01 | Bán âm kho | Code chủ ý cho retail/F&B-retail âm | Xung đột rule đã chốt |
| SNAP-01 | Downstream đọc operational order | Không có shared sale snapshot | Cần characterization test |
| PRINT-01 | Trùng bản in | Lặp `printReceipt` tạo jobs mới | Đã chứng minh tĩnh |
| PRINT-02 | “printed” không chắc giấy ra | Agent ACK chuyển thẳng `printed` | Đã chứng minh tĩnh |
| TIME-01 | Lệch business date | Host-local, UTC slice và +7 trộn lẫn | Cần boundary test |
| OFF-01 | Mất mạng dừng mutation | Không có business outbox/edge | Đã chứng minh kiến trúc |
| CAM-01 | Scanner chỉ nhận lần đầu | `DetectionSpeed.normal`, timeout 120ms; frame không hợp lệ không khóa handler; test cấu hình/format pass | Đã sửa tự động, chờ canary camera thật |

## Baseline

- Backend: 49 file test với DB riêng từng file; 47 pass.
- Hai file fail trên DB sạch vì fixture không migrate: `handy-device-routing-isolation.test.mjs`, `receipt-golden-parity.test.mjs`.
- Flutter: analyze sạch; core test 98 pass, 1 E2E skip.
- Combo có 11 case pass, gồm fixed total cao hơn tổng item; chưa đạt 1.000+.

Không dùng dữ liệu production để tái hiện. Tất cả reproduction tiếp theo dùng DB tạm độc lập.
