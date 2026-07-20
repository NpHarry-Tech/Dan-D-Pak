# Module Map

Last updated: 2026-07-13

**Ranh giới module = tầng `server/services/*`** (34 file, một domain một file). Tầng
`server/modules/<domain>/` là *route ownership* (routes.js + index.js re-export service).

Trạng thái tách route ownership (THỰC TẾ, không phải kế hoạch):

- ✅ Đã tách HẾT route vào module (**23 module**): inventory, invoices, payments, tax, orders,
  reports, audit, purchase, expenses, online, printing, retail, contacts, catalog, agent,
  appRelease, sync, auth, clientLog, config, settings, database, documents.
- ⏳ `api.js` còn ~320 dòng: chỉ giữ helper cross-cutting dùng chung (wrap/guard/branch/…,
  saveBase64Image/applyManualConfirm/assertBillEditable/scopedUserBody/logRequestError — truyền
  vào module) + route dev `/dev/seed`. Đây là vai trò registrar, đúng thiết kế.
- Gotcha: `fileCashDrawerReceipt` export từ `modules/documents` (api.js import lại để truyền cho
  `payments`); `saveBase64Image` là helper chung của settings/catalog/contacts.

| Domain | Current files | Target module zone | Protected |
| --- | --- | --- | --- |
| Auth/users/roles/permissions | `server/services/auth.js` | `server/modules/auth`, `users`, `roles`, `permissions` | Yes |
| Branches/tables/devices | `server/services/orders.js`, `server/services/system.js` | `server/modules/branches`, `devices` | Yes |
| Menu/catalog/pricing | `server/services/catalog.js`, `server/services/bookMenu.js`, `server/services/vouchers.js` | `server/modules/menu`, `pricing`, `promotions`, `vouchers` | Yes |
| Orders/KDS | `server/services/orders.js` | `server/modules/orders`, `kds` | Yes |
| Payments/shifts/cash drawer | `server/services/payments.js`, `shifts.js`, `cashDrawer.js` | `server/modules/payments` | Yes |
| Invoices/MISA | `server/services/invoices.js`, `misa.js` | `server/modules/invoices`, `integrations/misa` | Yes |
| Inventory/warehouse/SKU | `server/services/inventory.js` | `server/modules/inventory` | Yes |
| Tax/VAT/MST | `server/services/tax.js`, `settings.js`, `customers.js` | `server/modules/tax` | Yes |
| Retail | `server/services/retail.js` | `server/modules/pos`, `inventory` | Yes |
| Customers | `server/services/customers.js` | `server/modules/customers` | Yes |
| Reports/audit/archive | `server/services/reports.js`, `reportCenter.js`, `archive.js` | `server/modules/reports`, `audit` | Yes |
| Printing | `server/services/printing.js` | `server/modules/print` | Operational |
| Online channels | `server/services/online.js` | `server/modules/integrations/grab`, `shopee` | Yes |
| Sync/offline | `server/services/sync.js` | `server/modules/realtime` | Operational |

## Extraction Rules

- Public functions must have validation and predictable errors.
- Sensitive actions need permission checks and audit logs.
- Deletion must be reviewed for append-only alternatives.
- Shared business logic belongs in services/modules, not copied across app screens.
- Backend route ownership lives in `server/modules/<domain>/routes.js`; `server/api.js`
  stays as the top-level registrar and shared compatibility layer.
- Flutter domain API methods move from `lib/services/api_service.dart` into
  `lib/services/api/<domain>_api.dart` parts when a group grows.
