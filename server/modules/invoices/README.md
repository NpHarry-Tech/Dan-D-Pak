# Invoices Module

Invoices, MISA/e-invoice data, lookup codes, cancellation history, and tax-customer fields are business-critical.

Live code:
- `server/services/invoices.js` legacy/local invoice records
- `server/services/einvoice.js` provider queue, status sync, cancel/retry
- `server/services/misa.js` MISA provider integration
- `server/services/tax.js` shared tax profile/MST helpers

AI/Agent Safety:
This folder contains business-critical logic or data. Do not delete, reset, rewrite, or migrate destructively without documenting impact and warning the user first.
