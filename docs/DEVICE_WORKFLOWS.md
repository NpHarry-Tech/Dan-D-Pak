# Device Workflows

Last updated: 2026-06-18

## iPad

- Entry file: `web/ipad.html`
- Shared code: `web/shared/client.js`
- Main APIs: `/api/menu`, `/api/tables`, `/api/orders`, `/api/orders/:id/customer-qr-pay`, `/api/orders/:id/customer-invoice`
- Realtime: `menu:updated`, `book-menu:updated`, `order:item`, `order:pending`, `order:updated`, `payment:done`
- Protected data: orders, order items, invoice choice, customers/tax lookup
- Failure states: backend offline, no table selected, unavailable menu item, payment failure

## POS

- Entry file: `web/pos.html`
- Main APIs: tables, orders, pending confirmations, payment, shifts, cash drawer, vouchers
- Realtime: `order:new`, `order:pending`, `order:updated`, `order:item`, `payment:done`, `table:updated`, `staff:call`
- Protected data: orders, payments, shifts, cash drawer, inventory deduction
- Failure states: unauthorized user, payment mismatch, manager PIN required, backend offline

## KDS

- Entry file: `web/kds.html`
- Main APIs: `/api/kds/:station`, `/api/orders/items/:id/status`, `/api/orders/items/:id/kds-dismiss`
- Realtime: `kds:refresh`, `order:new`, `order:item`
- Protected data: kitchen ticket/order item status
- Failure states: wrong station, stale socket, item already cancelled/served

## Retail

- Entry file: `web/retail.html`
- Main APIs: `/api/skus`, `/api/skus/barcode/:code`, `/api/retail/checkout`, `/api/retail/:id/refund`, vouchers, customers
- Realtime: `inventory:updated`, `payment:done`, `stats:dirty`
- Protected data: SKU stock, payments, refunds, customer purchase history
- Failure states: out of stock, invalid barcode, refund permission failure

## Warehouse

- Entry file: `web/warehouse.html`
- Main APIs: warehouses, inventory, SKUs, movements, lots, documents, receive, issue, transfer, stocktake
- Realtime: `inventory:updated`, `inventory:alert`
- Protected data: inventory movements, stock lots, documents, stocktake sessions
- Failure states: insufficient stock, invalid lot/expiry, unauthorized adjustment

## Admin

- Entry file: `web/admin.html`
- Main APIs: dashboard, reports, menu, settings, integrations, users, permissions, audit, archive
- Realtime: dashboard/order/payment/inventory/settings events
- Protected data: users, permissions, reports, menu, pricing, integrations, audit
- Failure states: permission denied, CORS/API offline, report export failure

## Printers

- Entry file: `web/printers.html`
- Main APIs: `/api/print/config`, `/api/print/jobs`, `/api/print/jobs/:id/printed`, `/api/print/jobs/:id/reprint`
- Realtime: `print:new`, `print:done`
- Protected data: receipt/invoice payloads may include payment/customer/order data
- Failure states: printer unavailable, duplicate print, missing template
