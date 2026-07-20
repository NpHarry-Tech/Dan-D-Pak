# Inventory Module

Inventory movements, stock counts, stock transfers, SKU/product master data, lots, expiry data, and warehouse documents are business-critical.

Live code:
- `server/services/inventory.js`
- `server/services/purchase.js` receives PO lines through inventory functions
- `server/services/retail.js` validates/restocks SKU lots
- `server/services/payments.js` deducts stock after paid orders

AI/Agent Safety:
This folder contains business-critical logic or data. Do not delete, reset, rewrite, or migrate destructively without documenting impact and warning the user first.
