# Risk register

| ID | Severity | Rủi ro | Bằng chứng | Đích xử lý |
|---|---|---|---|---|
| R-01 | P0 | Payment rollback vì print; event trước commit | `payments.js` | Transactional outbox |
| R-02 | P0 | Bán âm kho/oversell đồng thời | `orders.js`, `retail.js`; movement thiếu semantic key | Atomic stock guard + ledger idempotency |
| R-03 | P0 | Retry thanh toán dùng key mới | `pos_provider.dart` | Stable persisted operation key |
| R-04 | P0 | Giá sau bán drift giữa consumer | Không có shared sale snapshot | Immutable snapshot + hash |
| R-05 | P1 | Promo/item ghi dù pay fail | Payment route ghi trước transaction | Đưa pricing apply vào unit of work |
| R-06 | P1 | Duplicate print copies | `print_jobs` không semantic unique | Intent key + copy index unique |
| R-07 | P1 | Business date lệch tại 00:00 | Time usage phân tán | BusinessClock + boundary tests |
| R-08 | P1 | Mất Internet làm dừng mutation | Không outbox/edge | Hybrid architecture theo giai đoạn |
| R-09 | P1 | Schema drift không phát hiện | `user_version=0`, migration table riêng | Canonical schema manifest |
| R-10 | P1 | Code cũ quay lại | 46 file dư; không image labels | Clean immutable image |
| R-11 | P2 | Hai nguồn app version | pubspec khác release constants | Một generated version source |
| R-12 | P2 | Test suite false negative | Shared DB/fixture thiếu migration | Per-test DB harness |
| R-13 | P2 | UI nói “đã in” khi chỉ gửi driver | Print state model | Capability-aware wording |
| R-14 | P2 | Camera không continuous SKU | Screen pop sau scan đầu | Product decision + device test |

Không risk nào cho phép sửa trực tiếp dữ liệu production. Migration phải additive, restore-tested và canary.

## Tái kiểm 2026-08-09

- R-01 đến R-07, R-09, R-12: đã có implementation và regression/integration test tự động; vẫn phải đối chiếu trên bản sao production trước deploy.
- R-08: protocol và Store Edge package đã triển khai, WAN-cut tự động pass; hardware canary chưa chạy nên chưa được bật production.
- R-09 (đã sửa trong source, chưa deploy): migration từng xóa các hàng `sync_queue` pending trùng entity để tạo unique index, vi phạm nguyên tắc chỉ bỏ mutation sau durable ACK. Rehearsal định lượng đã bắt được 18 pending bị mất trên local copy. Đã thay bằng migration bảo toàn toàn bộ pending legacy; production-copy thật vẫn bắt buộc trước rollout để xác định dữ liệu production có từng chịu migration cũ hay không.
- R-10: import graph/legacy cleanup local đã hoàn tất; immutable image mới chưa build được vì Docker Linux daemon chưa chạy và chưa deploy.
- R-11: release constants/build slots đã được test, nhưng binary production chưa đủ chữ ký.
- R-13: print state/ACK và routing đã harden; giấy ra thật chỉ được chứng minh bằng canary máy in.
- R-14: continuous barcode logic và cấu hình format đã test; camera model thật/lifecycle/low-light còn là cổng bắt buộc.
- Dependency audit: high `socket.io-parser` advisory đã được vá bằng 4.2.7; `npm audit
  --omit=dev --audit-level=high` pass. Còn 6 moderate từ dependency tree mới nhất của
  `@google-cloud/storage 7.21.0` (`uuid 9`); không dùng `npm audit fix --force` vì npm đề
  xuất downgrade `firebase-admin` breaking. Theo dõi upstream và không gọi UUID v3/v5/v6
  với caller-provided buffer trong code ứng dụng hiện tại.
