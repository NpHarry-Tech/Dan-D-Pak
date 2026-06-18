# API Contract

Last updated: 2026-06-18

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

## Current Route Families

Auth, modules, settings, book menu, device unlock, menu/categories, tables, orders, KDS, staff calls, payments, shifts, cash drawer, warehouses, inventory, SKUs, vouchers, retail, customers, online, print, invoices, sync, dashboard, reports, audit, and archive inspection are implemented in `server/api.js`.
