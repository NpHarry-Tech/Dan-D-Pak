# POS/ERP Module Roadmap

Last updated: 2026-06-29

## Principles

1. Each module has `key`, `label`, `group`, `perm`, `depends`, and `status`.
2. Module visibility follows effective user permissions.
3. Backend guards enforce every sensitive API action.
4. Active modules have real native screens. Planned modules are visible only in
   roadmap/admin metadata.
5. Role permissions are defaults; per-user overrides are the final effective
   permissions.

## Current Module Groups

- Sales: POS FnB, retail, self-order tablet, KDS, online channels
- Supply chain: inventory, warehouse, lot/serial/expiry, purchase
- Finance: payment providers, cashbook, invoicing, tax/localization, reports
- Operations: users, branches, devices, printers, shifts, settings
- Platform: sync, audit, backup/restore, integrations

## Target Source Layout

```text
server/
  api.js
  db.js
  services/
    modules.js
    auth.js
    catalog.js
    inventory.js
    retail.js
    orders.js
    payments.js
    invoices.js
    printing.js
    sync.js
    reports.js

flutter-apps/
  dandpak_core/
  dandpak_pos/
  dandpak_tablet/
  dandpak_kds/
  dandpak_backoffice/

docs/
  ERP_MODULE_ROADMAP.md
```

## Implementation Phases

1. Module registry, permissions, and native navigation.
2. Shared product/contact/document model.
3. Sales, purchase, warehouse, and inventory workflows.
4. Finance, reconciliation, invoice, and tax workflows.
5. Metadata, automation, backup/restore, and developer tools.
