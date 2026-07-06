# 09 — SIMULATION / QA TEST MATRIX (phòng thủ)

Test case QA nội bộ mức phòng thủ. Không có payload độc hại — chỉ mô tả bước, kỳ vọng, finding liên quan.
Trạng thái: EXPECT-PASS (code đã phòng thủ) · EXPECT-FAIL / RISK (cần sửa) · VERIFY (cần chạy thực tế xác nhận).

## A. Thanh toán & đối soát
| # | Kịch bản | Kỳ vọng | KQ dự đoán | Ref |
| --- | --- | --- | --- | --- |
| A1 | Double-pay: 2 request `/orders/:id/pay` đồng thời | Chỉ 1 thành công (changes=0 chặn) | EXPECT-PASS | BL-OK-3 |
| A2 | Pay khi còn món pending_confirm | Bị từ chối | EXPECT-PASS | BL-OK-5 |
| A3 | Pay thiếu tiền (paid < total) | Từ chối | EXPECT-PASS | BL-OK-4 |
| A4 | Webhook payOS sai chữ ký | 401, không đóng bill, audit rejected | EXPECT-PASS | payments.js |
| A5 | Webhook SePay gửi lại cùng external_id | status duplicate, không double-credit | EXPECT-PASS | idempotency |
| A6 | Webhook VietQR KHÔNG kèm Basic Auth | Hiện tại: xử lý credit (không verify) | RISK | TP-02 |
| A7 | Webhook online kênh enabled thiếu secret | Nhận đơn, chỉ audit cảnh báo | RISK | TP-02 |
| A8 | Auto-confirm 2 bill bill_no trùng tiền tố | Có thể đóng nhầm bill | RISK | BL-04/TP-03 |
| A9 | Manual-confirm không gắn bank_tx | Đóng bill dù tiền chưa về | RISK (chủ ý) | BL-03 |
| A10 | Discount = subtotal bởi user có perm discount | total=0, chấp nhận | RISK | BL-02 |
| A11 | customer-qr-pay mặc định | Không đóng bill, chờ thu ngân | EXPECT-PASS | SEC/BL |
| A12 | Underpaid webhook | status underpaid, bill vẫn mở | EXPECT-PASS | payments.js |

## B. Quyền & xác thực
| # | Kịch bản | Kỳ vọng | KQ | Ref |
| --- | --- | --- | --- | --- |
| B1 | Login sai PIN 6 lần | Khóa 5 phút | EXPECT-PASS | SEC-OK-3 |
| B2 | Thu ngân gọi `/menu/:id/price` không PIN | Từ chối (cần PIN Manager) | EXPECT-PASS | api.js |
| B3 | Manager tự cấp quyền mình không có | Bị chặn (scoped delegation) | EXPECT-PASS | SEC-OK-7 |
| B4 | Đổi vai trò user thành owner bởi non-owner | Bị chặn (scopedUserBody) | EXPECT-PASS | api.js |
| B5 | Truy cập chi nhánh không được cấp | resolveBranch ném lỗi | EXPECT-PASS | auth.js |
| B6 | Gọi `/orders` (POST) không đăng nhập | Tạo order được (public) | RISK | SEC-02 |
| B7 | Gọi `/inventory/:id/receive` không quyền | Nhập kho được? | VERIFY/RISK | BL-01 |
| B8 | Xóa Admin cuối cùng | Bị chặn | EXPECT-PASS | auth.js |

## C. Tồn kho & FEFO
| # | Kịch bản | Kỳ vọng | KQ | Ref |
| --- | --- | --- | --- | --- |
| C1 | Bán SKU vượt tồn | Từ chối "Hết hàng" | EXPECT-PASS | orders.js |
| C2 | Trừ kho FEFO theo hạn dùng | Lô gần hết hạn trừ trước | VERIFY | inventory.js (chưa đọc) |
| C3 | Đơn online hủy sau khi trừ kho | Cộng kho lại | VERIFY/RISK | BL-05 |
| C4 | Stocktake lệch | Ghi delta + movement | VERIFY | inventory.js |
| C5 | Receive tạo lot + unit_cost | Giá vốn đúng, có audit | VERIFY | BL-01 |

## D. Ca / két / hóa đơn
| # | Kịch bản | Kỳ vọng | KQ | Ref |
| --- | --- | --- | --- | --- |
| D1 | Bán khi chưa mở ca | Từ chối | EXPECT-PASS | BL-OK-8 |
| D2 | Refund bill đã kết ca không PIN | 423 SHIFT_LOCKED | EXPECT-PASS | BL-OK-7 |
| D3 | Xuất HĐ công ty lần 2 cho 1 bill | upgradeBuyer, không sinh HĐ mới | EXPECT-PASS | BL-OK-9 |
| D4 | Kết ca lệch tiền két | Báo cáo chênh lệch | VERIFY | shifts.js/cashDrawer.js |
| D5 | Chi từ két vượt số dư | Chặn? | VERIFY | cashDrawer.js |

## E. Dữ liệu & mất mát
| # | Kịch bản | Kỳ vọng | KQ | Ref |
| --- | --- | --- | --- | --- |
| E1 | Mất điện giữa transaction | WAL rollback; reconcileAuditFromArchive khôi phục | EXPECT-PASS | index.js/db.js |
| E2 | reset-transactions | Xóa cả audit_log hot | RISK | BL-07 |
| E3 | Backup định kỳ | Snapshot backups/ giữ 14 ngày | EXPECT-PASS | index.js |
| E4 | DMS upload file sai MIME thật | Lưu theo MIME khai báo | RISK thấp | SEC-06 |

## F. Realtime & đa thiết bị
| # | Kịch bản | Kỳ vọng | KQ | Ref |
| --- | --- | --- | --- | --- |
| F1 | iPad tạo order → POS/KDS thấy ngay | emit theo branch | VERIFY | realtime.js |
| F2 | 50 thiết bị cùng ghi | busy_timeout 5000 retry | VERIFY | db.js |

> Test C/D/E/F đánh dấu VERIFY cần chạy thực tế + đọc thêm service (inventory/shifts/cashDrawer/retail) để kết luận chắc chắn.
