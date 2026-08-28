# Final review gate

Trạng thái: **đã hoàn thành Phase A và Wave 0–3 nền tảng; chưa deploy production**.

## Đã hoàn thành

- Fingerprint local/VPS/container/source/release/schema.
- Baseline backend và Flutter trong môi trường test tách biệt.
- System/domain/data-flow map, RCA, risk, implementation/test/deploy plan.
- Chứng minh payment-side-effect coupling, idempotency không xuyên suốt, thiếu shared snapshot, negative-stock rule conflict, time ownership, thiếu offline outbox và deploy residue.

## Đã triển khai và xác minh local

- Chặn âm kho cho SKU và nguyên liệu công thức; kiểm tra lại trong transaction payment.
- Payment operation ID phía Flutter được persist qua timeout/restart.
- Voucher/promo metadata được ghi trong payment transaction; failure rollback sạch.
- `sale_snapshots` immutable, unique theo order, có SHA-256, UTC, timezone và business date.
- Receipt print outbox bền, worker retry và print-job semantic key theo payment/copy.
- Payment success không rollback khi printer job lỗi; test failure injection và recovery pass.
- Bỏ lần gọi tạo e-invoice trùng sau commit.
- Ma trận 1.200 combo cases pass, bao gồm premium fixed combo và total không âm.
- Backend 393/393 test pass từ 69 file test được enumerate đệ quy; Flutter 109 pass, 1 E2E updater skip có chủ đích; analyze sạch (2026-08-10).
- Camera quét mã có đường thử lại tại chỗ sau lỗi khởi tạo; lifecycle vẫn do `mobile_scanner` quản lý để tránh start/stop trùng lặp.
- Trạng thái offline chỉ chuyển sau 2 lỗi mạng liên tiếp, phản hồi HTTP bất kỳ khôi phục reachability; 3 lỗi 5xx liên tiếp mới đánh dấu API không khỏe.
- DB schema v6 thêm index đo bằng query plan cho lịch sử một năm, hóa đơn theo branch/order và payment theo ca. Lịch sử 200 bill/trang giảm từ mô hình 601 statement xuống tối đa 4 statement; canonical invoice lookup không còn materialize/xếp hạng toàn bảng.
- Pricing combo/CTKM preload metadata SKU và lô đúng một lần cho cả giỏ, loại truy vấn trong vòng lặp combo×item. Báo cáo ca gom payment lines một lần cho toàn ca; danh sách két gom hoàn chi/phân bổ bằng tối đa bốn query thay vì tối đa hai query cho từng dòng, đồng thời loại quan hệ hoàn chi chéo chi nhánh khỏi số liệu/response.
- Trạng thái hủy đang chờ provider (`CANCELLING`) được hiển thị nhất quán là đang xử lý; reconciliation/shift summary chọn đúng một hóa đơn chuẩn cho mỗi bill, không nhân đôi bill hoặc doanh thu khi có bản thay thế/phân bổ, và khóa theo chi nhánh.
- Regression tạo thật hai phân bổ trên một bill xác minh reconciliation vẫn chỉ ghi một bill/một lần doanh thu; `PENDING_PROVIDER` và `PENDING_EDGE_SYNC` được tính vào nhóm đang chờ thay vì biến mất khỏi summary.
- Store Edge sender-only, ACK/idempotency, catalogue pull, WAN-cut/reconnect và split-brain guard đã có test tự động; package triển khai nằm ở `deploy/store-edge/`.
- Flutter không còn sở hữu hoặc tự khởi chạy Node. Mọi lớp mặc định dùng VPS; URL Edge phải được chọn rõ ràng và không tự fallback.
- Database có online encrypted backup, schema gate, guard trigger hai chiều dùng chung scanner cho 31 quan hệ và compaction CLI fail-closed; rehearsal trên DB local copy đã pass, giữ đủ 54/54 pending rows.
- Publish gate chặn installer Windows chưa ký và APK debug trước khi đăng nhập/upload; Android release build fail-closed khi thiếu keystore production.
- Server dependency high-severity audit pass sau khi nâng `socket.io-parser` 4.2.7; 6 moderate upstream transitive `uuid` findings được ghi trong risk register, không force-downgrade Firebase.
- Build fingerprint đã nối xuyên suốt immutable builder/OCI label/runtime `/health`: version, Git commit, source-tree SHA-256, build UTC và `PRAGMA user_version` thực tế. Integration test khởi động server với DB cô lập và xác minh response; production hiện tại chưa có metadata này cho tới khi immutable deploy đạt đủ gate.
- Desktop, tablet và phone đã dùng chung build-diagnostics card để hiện app ID, version/build, commit, source SHA-256, build UTC, API base URL đang chọn, device ID và schema target; widget test bảo vệ giao diện này.
- Registry thiết bị sống `/api/devices` giờ hợp nhất Socket.IO và print-agent theo stable `device_id`; các route pair/approve và alias order/report/KDS/print/inventory chỉ trả `NOT_IMPLEMENTED`, không có client sử dụng, đã bị xóa để không còn hai giao diện API mâu thuẫn. Hai test registry mới bảo vệ merge/legacy identity.
- Lịch sử bán hàng/đổi trả và ledger hóa đơn dùng cửa sổ mặc định 365 ngày, phân trang server (200 bill/trang cho lịch sử, 100 bill/trang cho hóa đơn), tìm trên toàn cửa sổ theo số bill/order/HĐ/MST/tên khách và có nút tải tiếp trên cả desktop lẫn phone. Ledger tính summary/count bằng SQL rồi chỉ materialize đúng trang, tránh nạp cả năm vào RAM.
- Danh sách hóa đơn hiển thị `bill_code` ngay cả khi chưa được cấp số HĐĐT và tìm được trực tiếp theo số bill. Hồ sơ HĐ “Bán cho người tiêu dùng” chưa gửi provider được nâng tại chỗ bằng buyer vừa nhập, cập nhật tên bill và tự lưu/bổ sung mục Khách hàng theo SĐT → MST → email → tên khớp chính xác trong chi nhánh. Trường hợp chỉ nhập tên vẫn được lưu một lần, không fuzzy-match; hồ sơ đã bắt đầu gửi bị chặn thay đổi và yêu cầu quy trình điều chỉnh/thay thế.
- Luồng self-order/QR nâng thông tin người mua giờ cập nhật đồng thời cột ledger, `request_snapshot` gửi provider, `orders.customer_json` và receipt. UPDATE dùng CAS theo trạng thái/attempt/provider ID; khi worker đã bắt đầu gửi thì trả 409 thay vì race ghi đè buyer.
- API HĐĐT đọc theo order, retry, sync, cancel và upgrade buyer đều khóa `branch_id` tại service lẫn route. Regression cross-branch chứng minh user hợp lệ của chi nhánh A không thể xem hoặc retry HĐ của chi nhánh B.
- Worker HĐĐT claim job bằng CAS theo trạng thái, nên hai vòng worker song song chỉ một vòng được gọi provider. Lease `SENDING` quá 10 phút được audit/reclaim sang retry và đánh dấu `attempt_count>=1` để bắt buộc tra MISA trước publish; lease còn mới không bị cướp.
- Bảng hóa đơn legacy đã thành read-only compatibility và khóa branch tại `get`/`byOrder`. Route/service/API Flutter hủy local-only đã bị xóa; hủy HĐ thật chỉ còn `/einvoice/:id/cancel`, có PIN, branch scope và gọi provider trước khi ghi local.
- Hai hàm ghi legacy `Invoices.issue/customerRequest` không còn caller đã bị xóa; chúng từng cấp số mock bằng `COUNT(*)+1` và tạo implementation phát hành thứ hai. `invoices.js` giờ chỉ giữ read-only compatibility cho dữ liệu cũ; mọi HĐ mới đi duy nhất qua durable queue `einvoice.js`, có static regression chống tái sinh đường ghi cũ.
- Contract hủy MISA đã sửa từ ba positional arguments sai sang `{snapshot,cfg,reason}`. Service claim `CANCELLING` bằng CAS trước external call; provider thành công mới ghi `CANCELLED`, provider lỗi phục hồi `ISSUED` kèm error, và hai lệnh đồng thời chỉ một request qua provider.
- Windows release build 118 đã build thành công local; SHA-256 và kích thước artifact phải đọc từ manifest đi kèm, không chép hash sinh ra vào file source này vì sẽ làm source-tree fingerprint thay đổi theo vòng lặp. Artifact vẫn `NotSigned` và manifest ghi `worktreeDirty=true`, nên publish gate dừng đúng thiết kế và artifact này không được phép phát hành.
- Production-copy rehearsal tự động đã phát hiện migration cũ xóa pending `sync_queue` khi deduplicate (local copy: 54→36 pending). Root cause là `DELETE` trước unique index trong `initSyncTriggers`. Migration mới không xóa mutation chưa ACK, dùng non-unique lookup index + trigger `NOT EXISTS`; fixture có hai pending legacy cùng entity giữ nguyên 2/2, backup nguồn giữ nguyên SHA, không mất bảng/dòng, quick-check `ok`, 31/31 quan hệ zero orphan.
- Legacy source-overlay deploy đã retire. Immutable image path pin base digest, allow-list Docker context, loại runtime archives/enterprise storage/releases/import reports/test/secret-key khỏi image và Git, hash/label source+image, pin SSH host key, bắt live backup và health-triggered rehearsed rollback; hiện vẫn fail-closed vì chưa đủ evidence thật.

## Gate còn lại

- Chạy restore/migration rehearsal trên bản sao production và review diff độc lập.
- Xác minh SUNMI/Handy/Print Agent trên thiết bị thật.
- Rehearse backup/restore/migration/rollback; canary và production reconciliation.
- Cấp keystore Android production và chứng thư Authenticode Windows; không publish binary debug/chưa ký.
- Chạy Store Edge hardware canary với UPS/LAN cố định, WAN-cut và đối chiếu payment–stock–invoice sau reconnect.

Không đánh dấu hoàn thành vì unit test pass. Không deploy/migration production từ báo cáo Phase A này.
