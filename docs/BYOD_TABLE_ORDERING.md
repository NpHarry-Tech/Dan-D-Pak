# BYOD Table Ordering — mô tả triển khai và bàn giao

## Kết luận kiến trúc

BYOD không tạo order engine mới. Nó là lớp public có ba trách nhiệm: xác thực QR → quản lý draft theo thiết bị → chuyển snapshot draft vào `Orders.createOrUpdateOrder()` với `source=self_order`. Từ thời điểm submit, order/turn, xác nhận của nhân viên, KDS, ticket bếp, máy in, giá/VAT và realtime dùng nguyên luồng Tablet Self Order/POS.

Luồng dữ liệu:

`QR đã ký` → `BYOD session/table` → `device draft cart` → `createOrUpdateOrder` → `pending_confirm` → nhân viên xác nhận → `KDS + station printer`.

## Audit bắt buộc trước triển khai

| Hạng mục | Nguồn chuẩn đã tái sử dụng |
|---|---|
| Chi nhánh, bàn, khu vực | `server/db.js:48`, `server/db.js:64`, `server/db.js:1221`; CRUD/sơ đồ tại `server/services/orders.js:1097` và `server/services/orders.js:1242` |
| Tablet Self Order UI/API | `flutter-apps/dandpak_core/lib/src/screens/self_order/self_order_menu_screen.dart:24`, cart tại dòng 55/252, submit tại dòng 482/505; API tại `flutter-apps/dandpak_core/lib/src/services/api/self_order_api.dart:46` và dòng 90 |
| Món được phép hiện cho khách | `server/services/catalog.js:37-119`: lọc category/món `self_order_hidden`, `hidden`, lịch bán và availability; public route `server/modules/catalog/routes.js:56-63` |
| Modifier/addon/combo/note | Chuẩn hóa menu tại `server/services/catalog.js:138-188`; validate/tính lại modifier và combo tại `server/services/orders.js:168-233`, dùng khi tạo dòng tại dòng 386-416; ghi chú con combo đi cùng `combo` |
| Draft, submit, order turn | Tablet draft tại `self_order_menu_screen.dart:55`; canonical submit tại `server/services/orders.js:235`; tìm đúng open order theo bàn tại dòng 321; trạng thái chờ xác nhận tại dòng 278-284 |
| Xác nhận gửi bếp | `server/services/orders.js:568-586`; chỉ sau xác nhận mới gọi `printKitchenTickets` |
| KDS, ticket, printer routing | `server/services/printing.js:3264-3365`: nhóm item theo station + printer; KDS UI/realtime tại `flutter-apps/dandpak_core/lib/src/screens/kds/kds_screen.dart:26-165` |
| Giá, VAT, khuyến mãi, tổng | Giá menu và modifier được resolve server tại `server/services/orders.js:386-403`; tổng/VAT tại dòng 131-137; toàn bộ total được recompute tại dòng 429, không nhận total từ browser |
| Socket/realtime | Whitelist và xóa PII tại `server/realtime.js:29-55`; broadcast chuẩn tại dòng 263; BYOD được khóa theo QR+bàn tại dòng 153-168 và 279-303 |
| Trạng thái món | `pending_confirm → new → accepted → preparing → ready → served`; cập nhật chuẩn tại `server/services/orders.js:919-934` |
| Chưa/đã gửi bếp và hủy | `pending_confirm` là draft order chưa in; `server/services/orders.js:977-980` chặn phiếu hủy cho món chưa gửi; batch print cũng loại trạng thái này tại dòng 1051 |
| Idempotency/rate limit | Cơ chế dùng chung tại `server/services/idempotency.js:45-100`; BYOD reservation tại `server/services/byod.js:288`; limiter mở rộng theo IP/QR/device tại `server/core/rateLimit.js:9-26` và `server/modules/byod/routes.js:5-14` |

## Phần BYOD đã thêm

- Schema ở `server/db.js:75-143`: QR (chỉ hash token), session bàn, device, cart item, submission và payment request.
- QR tự sinh khi tạo bàn và backfill bàn hiện có. Token gồm opaque ID ngẫu nhiên + HMAC; không chứa table ID, tên bàn hoặc ID tuần tự. Đổi tên bàn không đổi token. Regenerate/disable/delete thu hồi QR cũ và đóng session.
- Public API ở `server/modules/byod/routes.js`: bootstrap/menu/cart/order status, thêm–sửa–xóa draft, submit và yêu cầu thanh toán. Mọi thao tác suy ra branch/table từ token; không nhận table ID từ browser.
- Guest device ID ngẫu nhiên được tạo bằng Web Crypto và lưu local storage. Server chỉ lưu SHA-256 của device key, không fingerprint.
- Cart response có `mine` và `table`; write chỉ cho item thuộc device hiện tại. Submit giỏ bàn bắt buộc `confirm_table_cart=true` và UI luôn hỏi xác nhận.
- Submit dùng reservation idempotency trước khi gọi order service. Giá, VAT, trạng thái còn món, modifier/combo được canonical service xác nhận lại.
- Ghi chú bỏ control character/tag HTML và giới hạn 200 ký tự; UI luôn render bằng `textContent`/escape.
- Socket `device=byod` xác thực token hash và chỉ join room của đúng bàn. BYOD không được replay journal của cả chi nhánh.
- Trang responsive tại `/BYOD/{token}` nằm trong `server/assets/byod/`; có tìm kiếm, category, đa ngôn ngữ menu, modifier, số lượng, note, giỏ cá nhân/chung, món đã đặt, trạng thái bếp và yêu cầu thanh toán.
- Quản lý QR nằm trong form **Sửa bàn → Quản lý QR gọi món BYOD**: xem trạng thái/lần dùng, sao chép URL, tải PNG 1600×2100 có nhận diện Dan D Pak, in PDF A5, regenerate, disable/enable.

## Frontend Claude Design đã tích hợp (2026-09)

Giao diện BYOD được thay bằng thiết kế "Dan D Pak BYOD · Table Ordering" (Claude Design), giữ nguyên contract ở trên — không có order engine hay API path mới.

- `server/assets/byod/index.html` — shell trang, không mock dữ liệu.
- `server/assets/byod/app.css` — design token thật (màu, type scale Be Vietnam Pro, radius, spacing, shadow) port từ design; font self-host tại `server/assets/byod/fonts/` (không gọi Google Fonts — CSP `default-src 'self'` không cho phép).
- `server/assets/byod/lib.js` — logic thuần (format tiền, mapping trạng thái món, chuỗi UI 5 ngôn ngữ, mapping mã lỗi `BYOD_*` → thông điệp khách), import được cả từ trình duyệt (`type="module"`) lẫn `node --test`.
- `server/assets/byod/app.js` — state machine màn hình (welcome/menu/detail/cart+ordered), nối thẳng vào API/socket thật, không có màn hay trạng thái nào tồn tại thuần ở mockup.

Thay đổi backend nhỏ đi kèm: `bootstrap()` nay trả thêm `categories: [{id,name}]` (tên category thật từ bảng `categories`, trước đây khách chỉ có `category_id` không tên) — additive, không đổi field cũ, có test ở `server/byod-table-ordering.test.mjs`.

Cập nhật sau phản hồi chủ dự án (2026-09-16):

- **Gọi nhân viên** đã nối vào ĐÚNG cơ chế có sẵn của Tablet Self Order: `Byod.callStaff()` (`server/services/byod.js`) gọi thẳng `Orders.createStaffCall(table_id, reason, branch_id)` — cùng bảng `staff_calls`, cùng sự kiện `staff:call`/`table:updated`, cùng đường chuông/banner trên F&B POS (`RingController`/`socket_service.dart`), không tạo kênh thông báo riêng cho BYOD. Khác biệt duy nhất so với route `/api/calls` gốc: `table_id`/`branch_id` được resolve từ token đã ký (như mọi route BYOD khác), không tin trực tiếp body của khách. Fire-and-forget, không confirmation sheet, khớp đúng hành vi nút "Gọi nhân viên" trên tablet (`self_order_menu_screen.dart`). Có cooldown 90 giây/bàn ở server để không tạo nhiều dòng `staff_calls` khi khách bấm liên tục — riêng route `POST /api/calls` gốc (tablet) không có cooldown này.
- Tóm tắt giá **cả giỏ nháp lẫn đơn đã đặt** chỉ hiện **Tổng cộng**, không hiện tạm tính/thuế tách riêng — theo yêu cầu rõ ràng của chủ dự án, không phải hạn chế kỹ thuật (dữ liệu tạm tính/thuế thật vẫn có ở `orders[].goods_amount/vat_amount`, chỉ là không hiển thị).
- Banner carousel quảng cáo và badge "bán chạy/món mới": chủ dự án xác nhận đây là việc cấu hình lại sau (nhóm món riêng cho badge; banner sẽ dùng chung với tính năng "Màn hình phụ" đã có ở **Cài đặt → Màn hình phụ**, đang được tách thành cấu hình banner riêng) — chưa có API/field ổn định để nối, cố tình chưa làm trong đợt này.
- "Tìm kiếm gần đây": xác nhận không cần lưu lịch sử, chỉ lọc live theo từ khoá hiện tại — khớp đúng những gì đã triển khai.

## API contract rút gọn

Public (không cần login, bắt buộc token và header `X-BYOD-Device`):

- `GET /api/byod/:token/bootstrap?lang=vi`
- `POST /api/byod/:token/cart`
- `PATCH|DELETE /api/byod/:token/cart/:itemId`
- `POST /api/byod/:token/submit` + `Idempotency-Key`
- `POST /api/byod/:token/request-payment`
- `POST /api/byod/:token/call-staff` — dùng chung `Orders.createStaffCall` với Tablet Self Order, cooldown 90s/bàn

Quản trị (login + quyền `settings.tables`; mutation cần PIN Manager/Admin):

- `GET /api/settings/tables/:id/byod`
- `POST /api/settings/tables/:id/byod/regenerate`
- `POST /api/settings/tables/:id/byod/status`

## Cấu hình và vận hành

1. Đặt `BYOD_TOKEN_SECRET` bằng secret ngẫu nhiên tối thiểu 32 ký tự và giữ ổn định qua mọi lần restart/replica. Không đổi secret tùy tiện vì toàn bộ QR đang in sẽ không còn tái dựng đúng URL quản trị.
2. Đặt `BYOD_PUBLIC_ORIGIN=https://dandpakpos.io.vn` (không có dấu `/` cuối).
3. Reverse proxy phải chuyển `/BYOD/*`, `/byod-assets/*`, `/api/byod/*` và `/socket.io/*` tới cùng server; bật WebSocket upgrade cho Socket.IO.
4. HTTPS là bắt buộc để Web Crypto/local storage và token trên đường truyền được bảo vệ.
5. Sau khi rollout migration, mở **Cài đặt → Cấu hình bàn → Sửa bàn → Quản lý QR BYOD**, tải/in QR và quét thử bằng ít nhất hai điện thoại.
6. Khi bàn kết thúc qua thanh toán hoặc reset, session được đóng. Khi chuyển bàn, session bàn nguồn được đóng; khách phải quét QR của bàn đích.

Không cần cài app/đăng nhập cho khách. Nút thanh toán chỉ tạo yêu cầu tới POS; không mở cổng thanh toán và không tự đánh dấu paid.

## Kiểm thử và tiêu chí nghiệm thu

Test tích hợp mới: `server/byod-table-ordering.test.mjs`, gồm tự sinh QR, rename giữ QR, lọc món nội bộ, đa thiết bị, ownership cart, sanitize note, giá modifier server-side, submit giỏ chung, idempotency, hết món giữa chừng, thu hồi/regenerate, và tên category thật trong bootstrap.

`server/byod-frontend-lib.test.mjs` — unit test cho `server/assets/byod/lib.js`: format tiền, biên qty [1,50], đủ khoá dịch ở cả 5 ngôn ngữ, mapping đủ 7 trạng thái `order_item` thật, và mọi mã lỗi `BYOD_*` mà `byod.js` thực sự throw (đọc trực tiếp từ source, không hard-code danh sách) đều có bản dịch — hỏng contract lỗi ở backend sẽ tự làm fail test này.

Kiểm thử hiện hữu tiếp tục khóa combo/addon, KDS/printer, VAT, cancel draft, move/merge/reset và realtime. Lệnh bàn giao:

```powershell
node --test server/*.test.mjs
cd flutter-apps/dandpak_core
flutter test
flutter analyze
```

Đã chạy live sanity-check thủ công: khởi động `server/index.js` trên SQLite tạm (không đụng dữ liệu thật), quét đủ luồng qua HTTP thật — bootstrap trả đúng category/option_groups/addons, `POST /cart` với mods+addon+combo tính đúng giá server-side, `POST /submit` idempotent (retry cùng key không tạo trùng), món combo tách `parent_item_id` đúng như thiết kế, `POST /request-payment` và đường lỗi token không hợp lệ (410 `BYOD_QR_REVOKED`) đều đúng.

**BLOCKED_E2E** — chưa có Playwright/Puppeteer hay thiết bị thật trong môi trường này để tự động hoá:
- Trải nghiệm chạm/scroll thật trên iPhone notch, Android, foldable, tablet portrait/landscape (CSS responsive đã viết theo đúng breakpoint của thiết kế nhưng chưa có ảnh chụp màn hình thật).
- Realtime hai thiết bị cùng bàn qua Socket.IO thật (đã xác nhận đúng qua `node --test`, nhưng chưa bấm tay hai trình duyệt song song).
- Bàn phím mềm che Notes/Search trên iOS/Android thật.

Test thủ công bắt buộc trước khi go-live: quét QR thật bằng ít nhất iPhone + Android, đi hết luồng chọn combo → giỏ chung → gửi → theo dõi trạng thái → yêu cầu thanh toán, đổi ngôn ngữ giữa chừng, và rút mạng khi đang gõ ghi chú để xác nhận draft không mất.

Không chạy build hoặc deploy trong thay đổi này.

## Rủi ro vận hành còn lại

- Realtime phụ thuộc reverse proxy hỗ trợ WebSocket; client vẫn tự refresh/poll bootstrap khi reconnect.
- Secret phải giống nhau trên mọi instance. Nếu vận hành nhiều Node instance, sticky session/Socket.IO adapter và kho rate-limit dùng chung là bước hạ tầng cần cấu hình; code hiện tại phù hợp mô hình một local store server như kiến trúc repo.
- PNG dùng wordmark “DAN D PAK”; nếu cần đúng file logo vector theo brand kit, thay wordmark bằng asset logo đã được marketing phê duyệt trước khi in hàng loạt.
