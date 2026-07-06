# Company Database Memory

Last updated: 2026-06-20

The company PostgreSQL database is the **permanent memory** of the restaurant. It
remembers not just the latest state, but the **history of important changes**.

## Core principle

> Do not destructively overwrite important business records. Use append-only ledger
> design where appropriate.

Examples:

- Do not delete an order. Mark it cancelled/voided and log who did it.
- Do not overwrite a price without history. Create a new price version.
- Do not overwrite inventory quantity directly. Create inventory movement records.
- Do not delete a payment. Create refund/reversal/void records.
- Do not overwrite settings silently. Create setting version history.
- Do not overwrite bank account config silently. Create secure config history.
- Do not overwrite integration tokens silently. Rotate and log.

## What the database must remember

### Restaurant & configuration
restaurant personalization settings, branch/store configuration, table layout,
business hours, tax/service-charge settings, receipt templates, kitchen/bar/salad
routing — **with version history**.

### Menu, products, pricing
menu categories, menu items, options/toppings, variants, product/SKU data, units,
recipes/BOM, price books, **price history**, promotions, vouchers, availability
history. Old orders keep their **original price snapshot**.

### Orders & service
order history, order item history, order status history, kitchen/bar/salad ticket
history, preparation timing, notes, discounts, tax/service lines, cancellation/void
reasons.

### Printing
print jobs, reprint logs (who/why/when), print attempts and failures.

### Payments & cash
invoice history, payment history, payment lines, refund history, void history, cash
in, cash out, opening cash, shift open/close, drawer counts.

### Banking & integrations
bank accounts (masked), payment terminal config, QR/bank transfer config, app-web
linking, integration connections, API credential **metadata** (never raw secrets),
token rotation history.

### People & devices
staff accounts, roles, permissions, login/session history, failed logins, device
pairing, device sessions, customers, customer notes, loyalty/voucher usage.

### Inventory
inventory in/out, transfer stock, stocktake, stock adjustment, purchase orders,
supplier information, cost layers — all **ledger-based**.

### Reporting & system
report snapshots, sync events, offline pending events, conflict records, audit
logs, system logs, security logs.

## Canonical memory checklist

The company database must be able to reconstruct these business facts later:

- Restaurant personalization settings, branch/store configuration, business
  hours, tax/service-charge settings, receipt templates, table maps, kitchen/bar
  routing, and station settings.
- Menu categories, menu items, options/toppings, variants, products, SKUs, units,
  recipes/BOM, price books, price versions, price change logs, promotions,
  vouchers, voucher redemptions, and menu availability changes.
- Orders, order items, modifiers, order notes, discounts, tax/service charge
  lines, source links, status history, item status history, cancellation reasons,
  void reasons, and staff/device/customer snapshots.
- Kitchen/bar/salad tickets, station queues, preparation timing, KDS events,
  reroutes, ready/served status, and SLA delay information.
- Print jobs, print job items, print attempts, failures, reprint logs, who
  reprinted, why, and when.
- Payments, payment lines, payment approvals, bank transfer records, QR/payment
  reconciliation logs, refunds, voids, cash drawers, cash shifts, cash in/out,
  cash counts, and payment method configuration.
- Bank accounts, bank account links, payment terminals, integration token
  metadata, token rotation/revocation history, and masked config summaries.
- Invoices, invoice lines, MISA links/status, invoice exports, corrections, voids,
  tax lookup data, buyer email/phone, and invoice status history.
- Warehouses, stock locations, suppliers, purchase orders, goods receipts,
  inventory movement ledgers, stocktake sessions, stock adjustments, stock
  transfers, inventory snapshots, and cost layers.
- Customers, contacts, addresses, notes, loyalty accounts, voucher usage, privacy
  flags, and customer activity logs.
- Users, staff profiles, roles, permissions, role assignments, login events,
  failed logins, PIN credential rotations, sessions, device sessions, and device
  pairing/authorization history.
- Integrations, integration connections, mapping rules, webhook logs, sync jobs,
  app-web links, app-web sessions, client installations, and device heartbeats.
- Official report snapshots, dashboard snapshots, daily sales/payment/inventory
  summaries, KDS timing summaries, shift reports, backups, restore actions,
  sync events, processed event ids, sync batches, acknowledgements, conflicts,
  security logs, system logs, data change logs, config change logs, permission
  change logs, and error logs.

## Write patterns by risk

| Area | Required pattern |
| --- | --- |
| Orders | Status history + audit; never hard-delete real orders |
| Pricing | New price version; old orders keep price snapshot |
| Inventory | Movement ledger; snapshots derive from movements |
| Payments | Payment status history; refunds/voids as separate records |
| Settings | Version row for every important config change |
| Bank/integration secrets | Encrypted/tokenized storage + masked audit summary |
| Reports | Live dashboard can calculate; official reports are locked snapshots |
| Sync/offline | Idempotent event ids; conflicts require admin resolution |

## History pattern

For each sensitive entity, keep:

- the current row (latest state), and
- a history/version/ledger table (every important change), or
- status-history rows (every status transition with actor + reason).

This makes the database traceable and safe: you can always answer **who changed
what, when, and what the value was before**.

See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) for the table groups and
[AUDIT_LOGGING.md](AUDIT_LOGGING.md) for the audit trail.
