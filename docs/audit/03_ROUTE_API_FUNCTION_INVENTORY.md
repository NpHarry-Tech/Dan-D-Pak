# 03 — ROUTE / API / FUNCTION INVENTORY

Nguồn: `server/api.js` (mount `/api`), `server/index.js` (static + page routes). guard = requireAuth(perm); guardAny = 1 trong nhiều perm hoặc settings.manage; route KHÔNG guard = public (attachUser vẫn gắn user nếu có token).

## Auth & user
| Method | Route | Guard | Handler |
| --- | --- | --- | --- |
| GET | /branches | public | Branches.listBranches |
| POST | /login | public | Auth.login (rate-limited) |
| POST | /auth/verify-branch-switch | guard() | verifyManagerOwnerPin |
| POST | /logout | public | Auth.logout |
| GET | /me | guard() | effectivePermsForUser |
| POST | /me/lang | guard() | updateOwnLang |
| GET | /users | public | Auth.listUsers (scoped branch) |
| GET | /ping | public | ok |

## Settings (đa số guardAny + PIN Manager/Owner khi ghi)
- GET/POST `/settings/permissions`, `/settings/roles/:role/permissions` (PIN), `/settings/users` (+ create/update/delete, PIN), `/settings/users/:id/permissions`, `/settings/branches` (+update), `/settings/app` (GET/POST — POST có nhiều cổng PIN theo field: cardTerminal, printers, ipad_staff_pin, defaultDrawerCash), `/settings/integrations` (+`:channel/test`, PIN), `/settings/connections/status`, `/settings/system/printers`, `/settings/tables` (+update/delete, PIN), `/settings/book-menu` (+import-pubhtml5).
- Upload ảnh: `/settings/users/avatar-upload`, `/menu/image-upload`, `/partners/avatar-upload` — whitelist MIME ảnh, max 20MB, base64.
- `/devices*` → `notImplemented`.

## Catalog / Menu / Categories
- GET `/menu` (public, forCustomer), `/menu/manage` (menu.manage)
- POST `/menu` (+`:id/update`,`:id/price`,`:id/delete` — PIN Manager/Owner), `/menu/:id/availability`, `/menu/:id/hide`
- `/categories` (+create/update/delete — PIN)

## Tables / Orders / KDS / Calls
- `/tables`, `/tables/:id`, `/tables/:id/move`, `/tables/:id/merge` (sell)
- `/orders` (POST create/update, public), `/orders/history` (pay), `/orders/:id/receipt(+/text,/print)` (pay), `/orders/:id` (GET public)
- `/orders/:id/confirm|reject` (sell), `/split` (pay)
- `/orders/items/:id/status` (public — CANCEL bị chặn tại đây), `/orders/items/:id/cancel` (PIN nếu đã gửi bếp), `/kds-dismiss`
- `/kds/:station` (public visibleBranch), `/calls` (public)
- Nhiều generic endpoint (`/orders` GET, `/payments`, `/kds/tickets`, `/inventory/movements`, `/print/reprint`) → `notImplemented`.

## Payments / Shifts / Cash drawer  (rủi ro cao — xem file 08)
- `/orders/:id/request-payment`, `/tables/:id/request-payment` (public)
- `/orders/:id/payment-qr`, `/payment-qr` (standalone), `/orders/:id/customer-qr-pay` (public — KHÔNG tự đóng bill trừ khi bật allowCustomerSelfConfirm)
- `/orders/:id/customer-invoice` (public — khách iPad chọn VAT)
- `/orders/:id/pay` (pay; discount cần perm 'discount'; manual-confirm cần PIN self/owner)
- **Webhook công khai**: `/vietqr/webhook`, `/sepay/webhook`, `/casso/webhook`, `/payos/webhook` — xác thực bằng key/chữ ký provider (xem 08)
- `/payos/payment-status/:orderCode` (public poll)
- `/payments/bank-transactions` (reports/pay/settings.integrations)
- `/shifts/current|open|close` (pay), `/shifts` (reports)
- `/cash-drawer/current` (pay), `/entries` (reports/pay), `/expense`, `/reimbursement` (pay)

## Inventory / Retail / Warehouse / Vouchers
- `/warehouses` (public GET; create/update guard warehouse.manage + PIN thủ kho/manager/owner)
- `/inventory*`, `/skus*` (adjust cần inventory.adjust; receive route KHÔNG guard — xem file 07)
- `/vouchers` (discount; create/update/toggle cần PIN self/owner), `/vouchers/active` (public)
- `/retail/checkout` (pay), `/retail/sales` (public), `/retail/:id/refund` (refund + shift-lock)
- `/warehouse/{receive,issue,transfer,stocktake}` (inventory.adjust), `/movements`,`/lots`,`/documents` (public GET)

## Customers / Contacts / Purchase / Expenses
- `/customers*` (guard()), `/customers/:id/delete` (settings.manage), `/customers/lookup/tax/:mst`
- `/partners*` (module.contacts)
- `/purchase*` (module.purchase — save/confirm/receive/pay/cancel/delete)
- `/expenses*` (module.expenses)

## Online / Printing / Invoices
- `/online/webhook` (public — secret nếu cấu hình), `/online/orders|channels` (public GET), status/confirm/return (online)
- `/print/*` (printGuard = module.printing/settings.printers/settings.print/pay)
- `/invoices/issue|:id/cancel` (invoice + shift-lock), `/einvoice/*` (pay; retry/cancel cần PIN)

## Reports / Audit / Archive / Sync / Config / Database / DMS
- `/dashboard(+/trends)` (public visibleBranch), `/reports/{catalog,preview,export}` (guard() + report perm scoping)
- `/audit` (audit.view), `/archive/*` (reports)
- `/sync/{status,offline,now}` (status public; offline/now cần reports)
- `/config/{export,import}` (settings.manage)
- `/database/{status,integrity-check,reset-transactions(PIN),clone-to-staging(PIN),decrypt-audit,docs,docs/:file(whitelist)}` (settings.manage)
- **DMS**: `/documents/upload|files|files/:id/{download,preview}|:id(PUT)|:id(DELETE, PIN)` — `requirePermission('module.documents')`, whitelist MIME, 25MB.

## Page routes (index.js, KHÔNG auth ở tầng route — trang tự gọi API có guard)
`/`, `/settings(+/:tab)`, `/reports(+/:type)`, `/contacts/:tab`, `/database/:tab`, và loop cho ipad/pos/kds/admin/retail/warehouse/sim/printers/online/contacts/purchase/expenses/invoices/database/documents.

## Hàm bảo mật lõi (auth.js / pin.js)
`login`, `verifyPin` (scrypt + legacy plaintext fallback), `hashPin`, `newToken` (crypto 24 bytes),
`verifyManagerOwnerPin`, `verifySelfOrOwnerPin`, `verifyWarehouseConfigPin`, `can/canUser`, `effectivePermsForUser`,
`grantablePermSet`, `setUserPerms`/`setRolePerms` (scoped delegation), `resolveBranch`/`canAccessBranch`.
