# Feature preservation matrix — sell-first navigation

Status: **VERIFIED (source + local widget tests)** on 2026-09-05.

## Inventory boundary

- Flutter core: 130 files below `lib/src/screens`, containing 123 `*Screen` classes.
- Server: 407 declared Express GET/POST/PUT/PATCH/DELETE routes.
- Registry: 34 modules; 17 active/core and 17 explicitly planned.
- Roles: owner, manager, cashier, kitchen, warehouse, online_manager and
  marketplace_operator. Visibility remains server-authoritative through effective
  permissions plus branch sales-module switches.

The counts above are discovery evidence, not a promise that every class is an
independent menu destination. Dialogs, detail screens, forms and customer-display
surfaces are intentionally reached from their owning module.

## Entry and preservation matrix

| Role | Preferred entry | Other visible entry | Preserved destinations |
|---|---|---|---|
| cashier | POS FnB, then Retail fallback | Management only if returned by server | POS, Retail, Invoice, receipt printing |
| owner / manager | Management is marked preferred; Sales remains one tap away | Sales | Dashboard, reports, contacts, warehouse, purchase, expenses, settings, printing, invoice, accounting, database, every authorized sales surface |
| kitchen | KDS | Any server-authorized back office entry | KDS and authorized POS fallback |
| warehouse | First server-authorized back office module | Sales only when authorized | Warehouse, inventory, purchase, label printing |
| online_manager / marketplace_operator | Online, then Retail fallback | Any server-authorized back office entry | Online orders, product mapping, reconciliation, Omni chat, invoices, shipping labels |

The original grouped module grid remains intact below the new two-lane entry panel.
No route was removed, renamed or copied. Phone continues to use `PhoneShell`; its
cashier and manager permission matrices are covered by `phone_shell_test.dart`.

## UX contracts

- Loading, error/retry and loaded states remain explicit in `LauncherScreen`.
- The entry panel uses semantic grouping, normal keyboard-activatable `InkWell`
  controls, 108px touch targets and a wrapping 340px card layout.
- Narrow 360px, cashier role routing, hidden-module exclusion and role preference
  are runtime-tested in `launcher_entry_panel_test.dart`.
- Module filtering stays in this order: server visibility, active status, branch
  module switch, kiosk platform constraint, then app-flavor availability.

## External/live boundary

Golden screenshots on each physical Windows/tablet/phone target are
**NEEDS-LIVE-CANARY**. No installer was built and no device deployment was performed.
