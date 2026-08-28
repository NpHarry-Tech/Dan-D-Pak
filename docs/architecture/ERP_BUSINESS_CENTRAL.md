# ERP — Microsoft Dynamics 365 Business Central Integration

> Mission #18-28. Kiến trúc tích hợp POS → Business Central. Module CỘNG THÊM,
> mặc định TẮT (enabled=false) — không đụng code đang chạy; POS bán bình thường
> khi ERP tắt hoặc BC down. Build 2026-08-14, 7/7 test outbox pass (mock adapter).

## L. Kiến trúc (ERP Adapter + Outbox)
```
Thanh toán ĐỦ (commit local) ──▶ enqueueSale() ──▶ erp_outbox (pending)
                                                        │  (worker 30s)
                                     BusinessCentralAdapter.postSale(canonicalDoc)
                                                        │
                                          synced / retry(backoff) / dead
```
- `integrations/erp/erp_adapter.js` — interface canonical + phân loại lỗi + external_id.
- `integrations/erp/business_central.js` — BusinessCentralAdapter (OAuth2 client-credentials
  Azure AD, REST API v2.0, timeout, phân loại HTTP→errorClass). POS KHÔNG biết protocol (#20).
- `integrations/erp/outbox.js` — enqueue idempotent + worker retry/backoff/dead-letter.
- `services/settings/erp.js` — config (clientSecret MÃ HOÁ AES-256-GCM), mặc định TẮT.
- `modules/erp/routes.js` — control center API. UI: `settings_erp_panel.dart`.
- Hook: `services/payments.js` enqueueErpSaleSafe() SAU commit + cấp bill_no, bọc try/catch
  → BC lỗi KHÔNG bao giờ rollback thanh toán (#23).

## M. Mapping (#26)
`erp_mapping` (branch_id, kind, pos_key, nav_value). kind: company/branch/location/
dimension/payment/vat/customer/item/uom. Quản lý qua API `/erp/mapping` (UI iterate sau).
KHÔNG hard-code trong source.

## N. Retry + Idempotency (#24/#25)
- **Idempotency**: `external_id` UNIQUE = `DDP-SALE-<BRANCH>-<bill_no>`. Enqueue trùng bị bỏ.
  BC nhận trùng (409/"already exists") → DUPLICATE → coi như đã post = synced.
- **Phân loại lỗi**: AUTH/TIMEOUT/NETWORK/RATE_LIMIT/NAV_POSTING = TẠM THỜI → retry;
  VALIDATION/MAPPING = VĨNH VIỄN → dead-letter ngay (không đấm mãi).
- **Backoff**: 1m,5m,15m,30m,1h,2h,6h,12h → hết lượt → dead-letter.
- **Không rollback** payment đã thành công vì ERP lỗi.

## O. Reconciliation (#28)
`integrations/erp/reconcile.js` — so hoá đơn POS đã thanh toán vs erp_outbox:
MATCHED / PENDING / DEAD / MISSING_ERP + drill-down. API `/erp/reconcile?from=&to=`.

## Bảo mật
- clientSecret mã hoá (AES-256-GCM, `core/crypto`), API chỉ trả masked `********`.
- Ghi/cấu hình cần quyền `settings.integrations`; đọc cần đăng nhập.

## Cần cửa hàng cung cấp / cấu hình (Cài đặt → ERP — Business Central)
- Azure AD: tenantId, App registration clientId + clientSecret (quyền BC API,
  admin-consent), companyId (GUID/tên), environment (production/sandbox).
- (Khuyên #22) Dựng extension **"DDP Integration Inbox"** trong BC nhận nguyên
  canonical doc → tự map/dimension/posting group/post/trả document number; khi đó
  đặt `salesEndpoint` = tên custom API đó. Nếu để 'salesInvoices' (API chuẩn) thì
  adapter gửi header BC tối giản (nghiệp vụ đầy đủ nên dùng inbox).
- Bấm **Kiểm tra kết nối** để xác thực OAuth + company TRƯỚC khi bật.

## Còn lại (fast-follow)
- postSale cho API chuẩn 'salesInvoices' hiện gửi header tối giản; nghiệp vụ đầy đủ
  (lines + post) nên qua extension inbox — cần BC admin của cửa hàng chốt shape.
- UI editor mapping chi tiết (API đã sẵn).
- postReturn / postStockAdjustment / postStockTransfer (khung đã có ở doc types).
