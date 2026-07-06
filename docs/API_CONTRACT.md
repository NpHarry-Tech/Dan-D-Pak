# API Contract

Last updated: 2026-06-20

## Response Shape

Successful endpoints return domain JSON. Errors should return:

```json
{
  "ok": false,
  "code": "BAD_REQUEST",
  "message": "Human readable message",
  "error": "Backward-compatible message"
}
```

Planned endpoints that are not implemented should return:

```json
{
  "ok": false,
  "code": "NOT_IMPLEMENTED",
  "message": "This endpoint is planned but not implemented yet."
}
```

## Required Core Endpoints

| Endpoint | Current status |
| --- | --- |
| `GET /health` | Implemented |
| `GET /api/dashboard` | Implemented |
| `GET /api/menu` | Implemented |
| `POST /api/orders` | Implemented |
| `GET /api/orders` | Planned; current app uses table/order-specific reads |
| `GET /api/orders/history` | Implemented |
| `GET /api/orders/:id` | Implemented |
| `PATCH /api/orders/:id` | Planned; current app uses action-specific POST routes |
| `POST /api/payments` | Planned; current app uses `POST /api/orders/:id/pay` |
| `GET /api/payments` | Planned/report-derived |
| `POST /api/orders/:id/payment-qr` | Implemented; creates a branch-scoped QR payload for the open order |
| `GET /api/kds/tickets` | Planned; current app uses `GET /api/kds/:station` |
| `PATCH /api/kds/tickets/:id` | Planned; current app uses `POST /api/orders/items/:id/status` |
| `GET /api/inventory` | Implemented |
| `POST /api/inventory/movements` | Planned; current app uses warehouse/receive/issue/transfer/stocktake routes |
| `GET /api/reports/sales` | Planned through report center |
| `GET /api/reports/inventory` | Planned through report center |
| `GET /api/reports/payments` | Planned through report center |
| `GET /api/reports/kds` | Planned through report center |
| `POST /api/print/reprint` | Planned; current app uses `POST /api/print/jobs/:id/reprint` |
| `GET /api/devices` | Planned through settings/connections |
| `POST /api/devices/pair` | Planned |
| `PATCH /api/devices/:id/approve` | Planned |

## Current Print Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/print/config` | Read current print template/device configuration for the active branch |
| `GET /api/print/printers` | List configured printer routes, connection type, target, status, and system-printer match |
| `POST /api/print/printers/:id/test` | Create and dispatch a test print for one configured route |
| `POST /api/print/cash-drawer/open` | Send an ESC/POS cash drawer pulse through the configured bill printer |
| `GET /api/print/jobs` | Branch-scoped print history and pending queue |
| `GET /api/print/jobs/:id` | Branch-scoped print job detail |
| `GET /api/print/jobs/:id/text` | Render the printable text preview for review/reprint |
| `POST /api/print/jobs/:id/print` | Force-dispatch a job to LAN/IP or OS printer transport |
| `POST /api/print/jobs/:id/printed` | Mark a browser/system-reviewed job as printed |
| `POST /api/print/jobs/:id/reprint` | Create a linked reprint job from an existing job |

All print endpoints require a logged-in user with `module.printing`, printer settings, print settings, payment, or settings management permission. Job reads and mutations are scoped to the active branch.

## Current Customer QR Payload

`POST /api/orders/:id/payment-qr` returns the QR metadata used by iPad Self-Order before a customer confirms payment.

```json
{
  "ok": true,
  "provider": "vietqr_api",
  "providerLabel": "VietQR API",
  "amount": 180000,
  "reference": "DANBILL000123",
  "orderId": "000123",
  "imageUrl": "https://...",
  "fallbackImageUrl": "https://img.vietqr.io/image/..."
}
```

If VietQR API credentials are incomplete or unavailable, the route returns a public VietQR image fallback plus a warning instead of closing the bill.

## Current Payment Invoice Request Payload

`POST /api/orders/:id/pay` and `POST /api/retail/checkout` accept an optional `invoice_customer` object for company invoice requests that are not saved into the customer directory.

```json
{
  "invoice_customer": {
    "invoice_request": true,
    "invoice_type": "company",
    "tax_code": "0312345678",
    "company": "Company legal name from MST",
    "name": "Invoice customer name or same as company",
    "address": "Registered tax address",
    "email": "accounting@example.com",
    "phone": "0900000000",
    "note": "Optional accounting note"
  }
}
```

When present and valid, the order is saved with `invoice_choice="requested"` and the bill `customer_json` contains the company invoice fields for accounting export.

## Current Route Families

Auth, modules, settings, book menu, device unlock, menu/categories, tables, orders, KDS, staff calls, payments, shifts, cash drawer, warehouses, inventory, SKUs, vouchers, retail, customers, online, print, invoices, sync, dashboard, reports, audit, and archive inspection are implemented in `server/api.js`.
