# Production acceptance checklist — Dan D Pak POS

## Mục đích và điều kiện bắt đầu

Runbook này là cổng manual/hardware cuối trước immutable production deploy. Chỉ chạy trong cửa
sổ canary đã thông báo, với một ca/nhân viên/thiết bị được định danh. Không sửa trực tiếp DB để
“làm case pass”. Nếu tiền, giá, VAT, tồn kho, payment, invoice hoặc sync lệch: dừng case, giữ nguyên
evidence và escalation; không tiếp tục các case phụ thuộc.

Điều kiện bắt buộc:

- Production-copy rehearsal, 69 file / 393 server tests và Flutter analyze/test đã pass.
- Ghi app version/build/device ID/API endpoint; ghi server `/health.build` và schema version.
- Máy in, camera, Desktop/Tablet/Phone và Store Edge canary có tên/ID duy nhất.
- Chụp baseline tồn kho, payment, invoice/accounting/report và pending outbox của các SKU/bill dùng.
- Tạo thư mục evidence ngoài Git: `acceptance/<UTC-date>/<case-id>/`; không lưu PIN, token, QR secret,
  private key hoặc ảnh có thông tin nhạy cảm không được che.

Mỗi dòng chỉ được đánh `PASS` khi đã điền Observed, Logs và Screenshot/Artifact. `N/A` không tính
vào 19 case pass. Tổng yêu cầu: `manualAcceptanceCasesPassed=19`, failed `=0`.

## Checklist 19 case

| ID | Setup | Device | Steps | Expected | Observed | Pass/Fail | Logs | Screenshot / artifact |
|---|---|---|---|---|---|---|---|---|
| ACC-01 Cash checkout | Ca canary mở; 1 SKU biết giá/tồn | POS chính + printer | Tạo bill; checkout cash; xác nhận một lần | Một order/payment/snapshot; đúng total; tồn trừ đúng một lần; bill đúng giờ/giá | _Điền_ | _Điền_ | request/order/payment IDs | checkout, bill, stock |
| ACC-02 Bank QR | Tài khoản nhận và số tiền canary được duyệt | POS + điện thoại ngân hàng | Tạo QR; đối chiếu memo ẩn; chuyển đúng một lần; chờ xác minh | Memo duy nhất/tăng đúng sequence; một bank transaction/payment; không double apply | _Điền_ | _Điền_ | pay_ref, bank txn, payment ID | QR đã che TK, giao dịch, bill |
| ACC-03 Combo 500k | Combo granola + pistachio configured `FIXED_TOTAL=500000` | POS | Chọn combo; checkout; pay; in/reprint; mở invoice/report | Mọi nơi đúng 500.000đ dù tổng item tham chiếu 450.000đ | _Điền_ | _Điền_ | pricing hash, snapshot ID | cart, payment, receipt, report |
| ACC-04 Manual item discount | Bill mới; manager/cashier riêng | POS | Giảm item lần đầu nhập PIN; sửa lại trong cùng bill; sang bill mới thử lại | Bill đầu chỉ hỏi lần đầu; bill mới hỏi lại; adjustment/snapshot đúng | _Điền_ | _Điền_ | approval + order IDs, không ghi PIN | hai bill và adjustment |
| ACC-05 Voucher | Voucher hợp lệ có scope/min-spend rõ | POS | Apply một lần; thử apply trùng; checkout | Không double apply; base/discount/final total đúng; không âm | _Điền_ | _Điền_ | voucher, pricing hash | cart, receipt |
| ACC-06 CTKM stacking | Item có CTKM đã chốt rule | POS | Thêm item; manual adjustment nếu rule cho phép; apply CTKM/voucher; checkout | Priority/stacking đúng rule; một adjustment không áp hai lần | _Điền_ | _Điền_ | adjustment IDs | pricing breakdown |
| ACC-07 Multi-device cart | Hai thiết bị cùng branch, giờ đồng bộ | POS A + POS B | A mở/sửa cart; B mở cùng cart và xác nhận takeover; hai bên tiếp tục sửa lần lượt | Presence/chấm đỏ; latest state xuất hiện; không silent overwrite/đá thiết bị | _Điền_ | _Điền_ | cart ID, revision, device IDs | cả hai màn hình |
| ACC-08 Simultaneous finalize | Cart có mặt trên A/B | POS A + POS B | Hai người bấm finalize gần đồng thời | Chỉ một payment/finalization thành công; bên kia nhận trạng thái canonical | _Điền_ | _Điền_ | request/idempotency/payment IDs | kết quả A/B |
| ACC-09 Print one copy | Default copies=1; queue sạch cho bill | POS + printer | Thanh toán và auto print một lần | Một semantic job, một logical copy; trạng thái capability đúng | _Điền_ | _Điền_ | print job/copy/agent IDs | giấy + queue |
| ACC-10 Print two copies | Default copies=2 | POS + printer | Thanh toán một bill mới | Hai logical copies được track; không 1/3 bản | _Điền_ | _Điền_ | two copy IDs | hai tờ + queue |
| ACC-11 Printer offline | Tắt printer/agent có kiểm soát | POS + printer | Thanh toán; quan sát; bật lại; retry/reprint đúng nút | Payment vẫn PAID; print pending/failed trung thực; retry không nhân đôi | _Điền_ | _Điền_ | payment + print transitions | UI trước/sau |
| ACC-12 Reprint | Bill paid có snapshot | POS + printer | Mở lịch sử; reprint | Giá/giờ/discount/VAT bằng snapshot và bill gốc; job mới mang semantic reprint | _Điền_ | _Điền_ | snapshot + print job | bill gốc/reprint |
| ACC-13 Temporary bill | Cart chưa paid có adjustment | POS + printer | In tạm tính; sau đó checkout | Tạm tính đúng quote hiện tại; payment/receipt cuối đúng immutable snapshot | _Điền_ | _Điền_ | quote/pricing hash | tạm tính + receipt |
| ACC-14 Sales report | Dùng các bill ACC-01..13 | Desktop report | Lọc đúng business date/branch; mở summary/detail | Tổng/detail khớp sale snapshots, paid time Asia/Ho_Chi_Minh | _Điền_ | _Điền_ | report filters/export hash | summary/detail |
| ACC-15 Accounting | Cùng tập bill canary | Desktop accounting | Mở payment/ca/kế toán; đối chiếu từng method | Cash/bank/discount/VAT/total và paid time khớp payment/snapshot | _Điền_ | _Điền_ | shift/payment IDs | accounting rows |
| ACC-16 Invoice | Bill canary có điều kiện xuất hóa đơn | Desktop invoice | Tạo/queue invoice theo staged provider; kiểm payload/result | Không phát hai lần; amount/VAT/time khớp snapshot; pending không giả success | _Điền_ | _Điền_ | invoice/idempotency IDs | invoice/payload đã che |
| ACC-17 Camera barcode | Quyền camera đã cấp; SKU barcode thật | Phone/Tablet | Mở scanner; scan ngay, sau 2s, sau 10s; scan SKU khác; background/resume | Camera usable; stream tiếp tục sau frame fail; debounce chỉ chặn trùng ngắn hạn | _Điền_ | _Điền_ | device log/timestamps | video hoặc ảnh chuỗi scan |
| ACC-18 Internet offline | Store Edge/LAN/UPS sẵn sàng; WAN có công tắc | Hai POS + Edge + printer | Cắt WAN; login cached; xem SKU; cash checkout; print; sửa cart hai máy | LAN bán cash/in/giỏ hoạt động; online-only ở pending verification; không mất mutation | _Điền_ | _Điền_ | outbox before/offline, IDs | WAN status + bill |
| ACC-19 Internet recovery | Tiếp tục từ ACC-18 | Hai POS + Edge + VPS | Bật WAN; chờ sync/ACK; restart/reconnect một thiết bị; đối chiếu | QUEUED→SYNCING→ACK; không duplicate order/payment/stock/print/invoice; canonical fetch khớp | _Điền_ | _Điền_ | outbox after, ACK/event IDs | sync + reconciliation |

## Đối soát và kết thúc

Sau ACC-19, chọn ít nhất 10 transaction canary và đối chiếu theo ID:

`order → payment → sale snapshot → stock movement → print job → invoice/accounting/report`.

Ghi `reconciliationTransactionsChecked >= 10`, `reconciliationMismatchCount = 0`. Hash ba artifact
đã ký (Windows/Phone/Tablet), hash evidence bundle và điền production evidence trong cùng cửa sổ
24 giờ. Không dùng ảnh chụp thay cho log/ID khi hệ thống có ID canonical.

## Dừng, rollback và escalation

- Dừng ngay nếu có double charge, sai total, mất pending mutation, tồn trừ hai lần, sai business
  date hoặc hai thiết bị finalize cùng bill.
- Không void/refund/sửa kho tự động để che lỗi. Ghi exact IDs, UTC time, device ID, build fingerprint,
  expected/observed và bảo toàn DB/log snapshot.
- Nếu canary chưa activation: giữ production image hiện tại. Nếu activation lỗi: chạy immutable
  rollback; chỉ công nhận khi image ID và app/DB health hậu rollback đạt.
- Báo chủ hệ thống với severity P0/P1 và thư mục evidence. Mọi failed case làm
  `manualAcceptanceCasesFailed > 0`, do đó verifier phải trả `NO_GO`.
