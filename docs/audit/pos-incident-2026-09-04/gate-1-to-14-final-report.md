# Báo cáo hoàn tất Gate 1–14 — 2026-09-05

Phạm vi: source local và cơ sở dữ liệu SQLite tạm trên nhánh
`fix/universal-print-validation`. Không push, build installer, deploy, dùng credential,
truy cập VPS hay sửa database thật.

## Gate 1 — Khép kín P0 client

**VERIFIED (source).** F&B và Retail dùng chung receipt tracker/banner với các trạng
thái pending/printed/failed đúng nghĩa; queued/claimed không bị gọi là đã in. Reconcile
qua endpoint/realtime có timeout hữu hạn, chống response cũ, duplicate event, logout,
đổi branch và dispose. Reprint kiểm tra quyền và ghi audit. Close-shift có route/dialog
singleton, provider single-flight, mounted/scope guard, cleanup và conditional update
server. Commit chính: `b346f3c`.

## Gate 2 — AES-256-GCM Secret Vault

**VERIFIED (source).** Envelope v2 có `key_id`, nonce ngẫu nhiên 96-bit, tag 128-bit,
AAD bắt buộc theo tenant/provider/record/field/version, active/previous key rotation,
v1 decrypt-only, migration dry-run/idempotent/transaction-safe và fail-closed. API/UI
không trả raw secret; log/audit redacted. Production/Review key material và restore thật
là **NEEDS-LIVE-CANARY**. Commit: `2d10d20`.

## Gate 3 — Import XLSX/CSV

**VERIFIED (source).** Header/alias không phụ thuộc vị trí; bảo toàn leading zero,
locale, kiểu text/number/date/formula; báo đúng row/column/value; archive trước mutation;
retry dedupe và transaction rollback. Golden XLSX chứa 91120090, 91080092, 91010579.
File khách hàng thật là **NEEDS-LIVE-CANARY**. Commit: `c233e41`.

## Gate 4 — Database và toàn vẹn dữ liệu

**VERIFIED (source).** Migration gom trong `BEGIN IMMEDIATE`, rollback toàn phần khi
fault; fresh migration giảm từ khoảng 24.067 ms xuống 245 ms. WAL contention,
checkpoint-reader, crash recovery, online backup, event-loop heartbeat và query plan đều
có test. Production-sized restore/host disk vẫn **NEEDS-LIVE-CANARY**. Commit: `c932c18`.

## Gate 5 — GET coalescing, ingress và debounce

**VERIFIED (source).** Coalescing key bao gồm origin/path/query chuẩn hóa/tenant/branch/
user/auth generation/representation; không áp dụng mutation và clear khi đổi scope.
Online/Omni burst dùng trailing 1.500 ms, max wait 5.000 ms, có flush/cancel/dispose và
fake-clock 1499/1500/1501. Timing diagnostic tách ingress/auth/DB/serialize/total, mặc
định tắt. Với 2.000 bill: server HTTP p95 24.947 ms, client-loopback p95 27.325 ms;
payload 61,786 bytes. Auth p95 giảm từ 52.823 ms ở probe trước sửa xuống 0.353 ms nhờ
không xác thực/touch session trùng và throttle `last_seen` một phút. Commits: `cb45125`,
`d833c1d`.

## Gate 6 — Floor, Desktop và thumbnail

**VERIFIED (source).** Floor dùng cùng canonical grid/viewport transform, test nhiều
viewport/aspect/DPI; không clip hoặc nhân đôi bàn. Windows mutex/focus/restore/flash và
customer-display exemption có static contract; chạy executable thật là
**NEEDS-LIVE-CANARY** do build bị cấm. Thumbnail có contract contain/cover/fallback,
magic-byte upload, SHA-256 content key, immutable ETag cache. Commits: `58117b0`,
`dce081f`, `d833c1d`.

## Gate 7 — CRM/chat và assets cache

**VERIFIED (source).** Chat phân biệt loading/error/not-configured/empty/data; webhook
dedupe giữ write lock và scope theo branch; hai process tạo đúng một message; reads tách
branch; attachment HTTPS-only và có giới hạn. Server pagination và Flutter ListView
virtualization giữ payload/render bounded; PerfMode theo dõi frame/freeze, dùng LRU image
cache và hạ trần xuống 48 MiB/300 ảnh trên máy yếu. Asset benchmark 256 KiB: cold-200
p95 8.691 ms, warm-304 p95 0.702 ms. Provider thật **BLOCKED-EXTERNAL**. Commit:
`dce081f`.

## Gate 8 — Haravan

**VERIFIED (source)** bằng fake-provider: subscribe diagnostics có stage/status/code/
latency/correlation và redaction; outbound session, idempotency, branch/location mapping,
timeout/network và capability flags được kiểm tra. Dev-store subscribe thật
**BLOCKED-EXTERNAL**. Commits: `3743388`, `dce081f`.

## Gate 9 — Sell-first UX và bảo toàn tính năng

**VERIFIED (source).** Desktop/tablet có lựa chọn Sales/Management, preference theo role
(cashier→Retail, kitchen→KDS, online→Online, owner/manager→Management), vẫn giữ toàn bộ
module grid theo quyền. Phone giữ RBAC shell riêng. Matrix kiểm kê 130 screen files,
123 Screen classes, 407 Express routes, 34 module và 7 role. Commit: `27ebe61`.

## Gate 10 — Realtime systemic hardening

**VERIFIED (source).** Mọi central broadcast có event/branch/entity/version/sequence/
server metadata; journal 512 event/branch hỗ trợ replay hoặc yêu cầu full resync khi
cursor hết hạn/restart. Flutter dedupe và chặn out-of-order trước side effect; đổi tenant/
branch/token reset cursor; legacy payload vẫn tương thích. Mạng/thiết bị thật là
**NEEDS-LIVE-CANARY**. Commit: `c4a7e05`.

## Gate 11 — Audit toàn diện

**VERIFIED (source).** Contract chung có event/request/correlation, actor/role, device,
branch, timestamp/source và snapshot domain; redaction đệ quy có bounds/cycle guard.
Audit bắt buộc nằm trong transaction và lỗi audit rollback stock/expense/payment/order;
archive/activity realtime chỉ chạy post-commit. UI có nhãn tiếng Việt. Commit:
`a0f708c`.

## Gate 12 — Full final gate

**VERIFIED (source) at `ac56e24`.** Server: 143/143 files, 726/726 assertions, 0 fail/timeout/error,
1.265,3 giây. Flutter core: 251 pass, 0 fail, 1 E2E-only skip, 152,8 giây. Analyze
core/desktop/tablet/phone: 0 issue. `npm audit --omit=dev`: 0 vulnerability. Conflict
markers: none. Private/server secret scan: only two explicit fake PEM fixtures; tracked
Firebase Android client keys are public client configuration, with live restrictions
not inspected. Raw logs and JSON live beside this report.

## Gate 13 — Git và release boundary

**VERIFIED (local boundary).** Mỗi nhóm có commit riêng; không amend/reset/rebase/push.
Desktop release config là `2026.9.5+171`; mọi b170 cũ bị đánh dấu
superseded/do-not-publish. Builder tách cứng thư mục production/review, ghi backend vào
manifest và kiểm tra URL đã nhúng trong executable trước đóng gói. Production và Review
vẫn HOLD cho tới canary.

## Gate 14 — Điều kiện kết thúc

Toàn bộ hạng mục làm được local đã hoàn thành và có runtime evidence. Những phần còn lại
đều thực sự cần quyền/môi trường ngoài: DB production/review, hardware/network canary,
Windows packaged launch, Firebase console restrictions và provider credential. Chúng
được cô lập thành **NEEDS-LIVE-CANARY** hoặc **BLOCKED-EXTERNAL**, không bị báo nhầm là
đã chạy. Final Git SHA, ahead/behind, remote SHA, worktree và process inventory được báo
từ kiểm tra read-only cuối sau commit tài liệu này.
