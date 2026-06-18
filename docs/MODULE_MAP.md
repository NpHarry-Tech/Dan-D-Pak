# Module Map

Last updated: 2026-06-18

| Domain | Current files | Target module zone | Protected |
| --- | --- | --- | --- |
| Auth/users/roles/permissions | `server/services/auth.js` | `server/modules/auth`, `users`, `roles`, `permissions` | Yes |
| Branches/tables/devices | `server/services/orders.js`, `server/services/system.js` | `server/modules/branches`, `devices` | Yes |
| Menu/catalog/pricing | `server/services/catalog.js`, `server/services/bookMenu.js`, `server/services/vouchers.js` | `server/modules/menu`, `pricing`, `promotions`, `vouchers` | Yes |
| Orders/KDS | `server/services/orders.js` | `server/modules/orders`, `kds` | Yes |
| Payments/shifts/cash drawer | `server/services/payments.js`, `shifts.js`, `cashDrawer.js` | `server/modules/payments` | Yes |
| Invoices/MISA | `server/services/invoices.js`, `misa.js` | `server/modules/invoices`, `integrations/misa` | Yes |
| Inventory/warehouse/SKU | `server/services/inventory.js` | `server/modules/inventory` | Yes |
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
- Shared business logic belongs in services/modules, not copied across HTML pages.
