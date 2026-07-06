# 02 — ARCHITECTURE MAP

## Sơ đồ hệ thống hiện tại

```text
┌──────────────────────────────────────────────────────────────────────┐
│ THIẾT BỊ (cùng LAN / tunnel)                                          │
│  iPad self-order · POS thu ngân · KDS bếp · Retail · Warehouse ·      │
│  Admin/Settings · Printers · Online · Flutter apps (pos/tablet/kds)   │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │ HTTP REST (/api/*)             │ Socket.IO (?branch,&device)
                ▼                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ server/index.js  (Express, 1 process)                                 │
│  • Security headers (no CSP) · CORS middleware · gzip · json 35mb     │
│  • GET /health  (+ DB check)                                          │
│  • /api  → requestLogger → api.js (Router)                            │
│  • static web/ + assets/ + uploads/ + route từng trang HTML           │
│  • initRealtime(server) → realtime.js (Socket.IO hub, phòng chi nhánh)│
│  • Workers: backup(24h), audit maint(24h), einvoice queue(10s), sync  │
└───────────────┬──────────────────────────────────────────────────────┘
                │ api.js: attachUser() → guard(perm)/guardAny() → wrap(fn)
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ services/*  (business logic)                                          │
│  auth · orders · payments · inventory · retail · purchase · expenses  │
│  shifts · cashDrawer · vouchers · invoices · einvoice · misa · online │
│  printing · reports · reportCenter · catalog · customers · settings   │
│  → audit(...)  → emit(event, payload, branch)                         │
└───────────────┬───────────────────────────────┬──────────────────────┘
                ▼                                ▼
┌────────────────────────────┐   ┌─────────────────────────────────────┐
│ node:sqlite store.db (WAL) │   │ permanent-storage/ (NDJSON fsync)   │
│  ~50 bảng cấu hình+giao dịch│   │  audit/orders/payments/... append   │
│  sync triggers → sync_queue │   │  eternal_replica.db                 │
└────────────────────────────┘   └─────────────────────────────────────┘
                │
                ▼ webhook công khai (không cần đăng nhập)
┌──────────────────────────────────────────────────────────────────────┐
│ Bên thứ ba: SePay / Casso / VietQR / payOS (thanh toán)              │
│              GrabFood / ShopeeFood / BeFood / Website (online)        │
│              MISA (HĐĐT)                                              │
└──────────────────────────────────────────────────────────────────────┘
```

## Luồng request chuẩn (api.js)
1. `Auth.attachUser()` gắn `req.user` cho MỌI route (kể cả route mở).
2. `guard(perm)` / `guardAny(...perms)` kiểm quyền (owner bypass).
3. `wrap(fn)` chuẩn hóa JSON response + bắt lỗi (`errorPayload`), hỗ trợ async, ghi `logRequestError` (bỏ qua 401).
4. Service thao tác DB → `audit(...)` → `emit(...)` realtime.
5. Route `/api` không tồn tại → JSON `apiNotFound`; endpoint chưa làm → `notImplemented(...)`.

## Cổng bảo mật (defense-in-depth) đã có
- **Permission**: `role_perms` + `user_perms` (allow/deny) editable; scoped delegation (chỉ cấp quyền mình có).
- **PIN Manager/Owner** cho thao tác nhạy cảm (đổi giá, xóa món, cấu hình POS thẻ, máy in, PIN thiết bị, tiền két gốc, phân quyền, reset dữ liệu, clone staging).
- **PIN chính-mình** (verifySelfOrOwnerPin) cho voucher + xác nhận thủ công thanh toán → định danh trách nhiệm.
- **Shift-lock** (`assertBillEditable`): bill đã kết ca → cần PIN Manager/Admin mới sửa (refund/invoice), HTTP 423.
- **Branch scoping**: `resolveBranch`/`canAccessBranch`; báo cáo lọc theo `userBranchIds`.
- **Rate-limit login**: 5 lần sai → khóa 5 phút theo username.

## Mô hình triển khai đích (docs, chưa live)
- VPS gateway công khai (chỉ proxy + buffer mã hóa 1-7 ngày, KHÔNG là nguồn dữ liệu).
- Company server riêng tư (PostgreSQL, nguồn dữ liệu thật) — adapter Postgres còn scaffold.
- Offline-first + sync-back idempotent (planned).

## Kiến trúc — đánh giá ngắn
- Ưu: seam config/adapters rõ, audit kép (SQLite hot + NDJSON durable), permission model chi tiết, thanh toán idempotent.
- Nhược (kiến trúc): logic nghiệp vụ + HTTP còn trộn trong `api.js` (1614 dòng); `services/*` truy cập DB trực tiếp (không repository); HTML lớn lẫn UI+workflow. Xem file 10.
