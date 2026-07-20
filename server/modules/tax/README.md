# Tax Module

Owns VAT/PIT profile normalization, Vietnamese MST lookup, and receipt/invoice
tax display helpers.

Live code:
- `server/services/tax.js`
- `server/services/settings.js` delegates `tax_filing_profile` here
- `server/services/customers.js` delegates MST lookup here
- `server/services/payments.js` and `server/services/printing.js` use shared receipt tax helpers

Invoice issuing stays in `server/services/einvoice.js` / `invoices.js`; this
module owns tax data shape and lookup.
