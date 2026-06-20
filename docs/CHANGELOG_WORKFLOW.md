# Changelog Workflow

Last updated: 2026-06-18

For every meaningful change, append a changelog entry in the PR/commit notes or a future `CHANGELOG.md`.

## Required Entry Fields

- Date
- Summary
- Files changed
- Protected domains touched
- Database or migration impact
- API contract impact
- Realtime event impact
- Deployment impact
- Manual tests performed
- Rollback plan
- Warnings or approvals needed

## Safety Labels

- `docs-only`: documentation or comments only.
- `config-only`: env/deployment/config behavior only.
- `protected-read`: reads protected data but does not mutate it.
- `protected-write`: creates or updates protected data.
- `destructive-risk`: deletes, resets, migrates, or rewrites protected data. Requires explicit warning and approval.

## Current Change Note

This restructuring pass adds docs, config/adapters, frontend API/realtime seams, VPS scaffolding, and protected-zone warnings. It does not intentionally change order/payment/inventory business behavior.

## 2026-06-18 Warehouse Channel Configuration

- Summary: Added warehouse-to-sales-channel configuration, moved warehouse create/config controls into Settings, and improved the Warehouse stock screen search/filter UI.
- Files changed: `server/db.js`, `server/services/inventory.js`, `web/admin.html`, `web/warehouse.html`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: warehouse configuration, product/SKU master visibility, inventory read UI.
- Database impact: adds `warehouses.sales_channels_json`; no stock quantity, lot, movement, order, or payment records are changed.
- API contract impact: `POST /warehouses` and `POST /warehouses/:id/update` now require `security_pin`/PIN from an active Owner, Manager, or Thủ kho account.
- Deployment impact: backend restart required so the SQLite migration can add the new column.
- Manual tests: run syntax checks, verify `/health`, open `/warehouse`, open `/settings?tab=warehouse`, read `/api/warehouses?all=1`, confirm missing/wrong PIN is rejected, and confirm a no-op update with Owner PIN succeeds.

## 2026-06-18 POS 1024x768 Responsive Layout

- Summary: Added compact responsive breakpoints for 1024x768 POS terminals across shared chrome, BCM Retail POS, FnB POS, and Warehouse screens.
- Files changed: `web/shared/app.css`, `web/retail.html`, `web/pos.html`, `web/warehouse.html`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: UI only; no order, payment, stock, lot, warehouse, or customer data changes.
- Deployment impact: static frontend refresh only.
- Manual tests: run frontend module syntax checks and verify `/retail`, `/pos`, `/warehouse`, `/settings?tab=warehouse` return 200 locally.

## 2026-06-18 Retail POS UX Polish

- Summary: Tightened BCM Retail POS layout, unified product card image/placeholder rendering, added DanDPak branded empty-cart state, and renumbered bill tabs after checkout/close.
- Files changed: `web/retail.html`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: UI state only; checkout API behavior and inventory quantities unchanged.
- Manual tests: run Retail module syntax check and verify `/retail` returns 200 locally.

## 2026-06-18 FnB POS UX Polish

- Summary: Tightened POS Cashier table/bill layout, added DanDPak branded empty-bill states, clearer floor status counts, and more consistent table cards for POS terminal screens.
- Files changed: `web/pos.html`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: UI state only; order/payment APIs and table business rules unchanged.
- Manual tests: run POS module syntax check and verify `/pos` returns 200 locally.

## 2026-06-18 Warehouse UX Cleanup

- Summary: Removed warehouse channel/settings prompts from the Warehouse screen and tightened the stock UI with active-warehouse status pills, clickable quick-filter chips, cleaner search/filter layout, and clearer empty states.
- Files changed: `web/warehouse.html`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: UI only; warehouse configuration remains managed from Settings.
- Manual tests: run Warehouse module syntax check and verify `/warehouse` and `/settings?tab=warehouse` return 200 locally.

## 2026-06-18 Warehouse Config PIN UX

- Summary: Changed the warehouse configuration re-auth prompt in Settings to accept only a 4-digit numeric PIN and request the numeric keypad on touch/POS screens.
- Files changed: `web/admin.html`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: UI validation for warehouse configuration re-auth only; backend permissions unchanged.
- Manual tests: run Admin module syntax check and verify `/admin` returns 200 locally.

## 2026-06-18 Shared 4-Digit PIN Pad

- Summary: Added a reusable iPhone-style 4-digit PIN pad module and applied it to staff login, Admin re-auth prompts, POS sent-item cancellation, and iPad staff unlock.
- Files changed: `web/shared/client.js`, `web/admin.html`, `web/pos.html`, `web/ipad.html`, `web/index.html`, `server/services/auth.js`, `server/services/settings.js`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: authentication UI and PIN validation; role/permission checks are unchanged.
- API contract impact: staff user PINs and iPad staff unlock PIN now validate as exactly 4 digits.
- Manual tests: run frontend module syntax checks, backend syntax checks, and verify `/`, `/admin`, `/pos`, and `/ipad` return 200 locally.

## 2026-06-18 Retail Warehouse Channel Filtering

- Summary: Retail POS now loads and scans SKUs only from active retail warehouses connected to the `retail` sales channel, and the warehouse Settings save button is enabled only after actual form changes.
- Files changed: `server/services/inventory.js`, `server/api.js`, `web/retail.html`, `web/admin.html`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: SKU visibility by warehouse channel and warehouse configuration UI; stock quantities, lots, checkout totals, and payments are unchanged.
- API contract impact: `GET /skus` and `GET /skus/barcode/:code` support optional `channel=retail` filtering.
- Deployment impact: backend restart required so Retail POS uses the new filtered API behavior.
- Manual tests: restart local server, run backend syntax checks, verify `/api/warehouses?all=1`, verify `/api/skus?channel=retail` returns 0 when only empty `Showroom BCM` is connected to Retail POS, and verify `/retail` and `/admin` return 200 locally.

## 2026-06-19 Multi-Store Branch Context

- Summary: Added branch/store context across REST, realtime, Settings, login, POS, Retail, Warehouse, reports, shifts, cash drawer, print jobs, online orders, and invoices.
- Files changed: `server/db.js`, `server/api.js`, `server/services/auth.js`, `server/services/branches.js`, `server/services/inventory.js`, `server/services/orders.js`, `web/shared/client.js`, `web/shared/app.css`, `web/admin.html`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: branch/store configuration, user access scope, warehouse/SKU visibility, order/payment/report reads by branch.
- Database impact: adds branch metadata columns and `users.branch_access_json`; creates branch-specific default warehouses/tables for active branches.
- API contract impact: clients send `x-branch-id`; new `/branches` public read plus `/settings/branches` create/update endpoints protected by `settings.branches`.
- Deployment impact: backend restart required for SQLite migration and branch bootstrap.
- Manual tests: run backend/client syntax checks, login with a branch selected, verify `/api/skus?channel=retail` and reports change with `x-branch-id`, and verify Settings can create/update a branch and assign user branch access.

## 2026-06-19 Launcher Branch + Granular Admin Permissions

- Summary: Moved branch selection to the launcher before PIN login, removed the top-right branch switcher, made the Admin dashboard available to logged-in staff, and gated Reports/Settings by granular permissions.
- Files changed: `server/api.js`, `server/services/auth.js`, `server/services/modules.js`, `web/shared/client.js`, `web/shared/modules.js`, `web/shared/app.css`, `web/index.html`, `web/admin.html`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: authentication context, branch/store selection, permission catalog, report access control.
- API contract impact: report center endpoints now accept either `reports` or the matching `report.<type>` permission; `/api/modules` treats Admin as a general dashboard and Settings as visible only for real settings permissions.
- Manual tests: run backend/client syntax checks, parse Admin/Launcher inline modules, restart local server, verify `/`, `/admin`, `/retail`, `/pos`, `/warehouse` return 200, verify cashier can see Admin but receives 403 on report catalog, and verify Owner sees Settings plus all `report.*` permissions.

## 2026-06-19 Settings Standalone Module

- Summary: Turned Settings into a standalone launcher module at `/settings`, removed the Settings button from the Admin dashboard, and kept Settings out of the topbar by request.
- Files changed: `server/index.js`, `server/services/modules.js`, `web/shared/modules.js`, `web/admin.html`, `web/settings.html`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: navigation and permission-gated Settings shell only; settings APIs and stored configuration data unchanged.
- Manual tests: run syntax checks, parse Admin/Launcher inline modules, restart local server, verify `/admin`, `/settings`, and `/settings?tab=invoices` return 200, verify Settings module href is `/settings`, and verify topbar does not include Settings.

## 2026-06-19 Global Kiosk Interaction Hardening

- Summary: Disabled text selection, long-press/context menus, drag, copy/cut outside form fields, and common DevTools keyboard shortcuts across the shared web UI.
- Files changed: `web/shared/app.css`, `web/shared/client.js`, `web/sim.html`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: frontend interaction hardening only; real data protection remains enforced by authenticated, permission-gated APIs.
- Manual tests: run client syntax checks, parse key HTML module scripts, and verify `/`, `/admin`, `/ipad`, `/sim`, `/retail`, `/pos`, `/warehouse`, and `/settings` return 200 locally.

## 2026-06-19 Printer Hardware Runtime

- Summary: Rebuilt Printer Monitor around connected printer status, branch-scoped print history, detail-first reprint review, LAN/IP ESC/POS dispatch, OS printer dispatch, test print, and cash drawer open control.
- Files changed: `server/db.js`, `server/api.js`, `server/services/printing.js`, `server/services/settings.js`, `web/admin.html`, `web/printers.html`, `README.md`, `docs/API_CONTRACT.md`, `docs/DEVICE_WORKFLOWS.md`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: print jobs, receipt/order/payment payloads in print history, branch-scoped printer configuration, cash drawer hardware control.
- Database impact: adds print job audit columns for attempts, last attempt, error, transport, target, reprint source, and printed-by metadata.
- API contract impact: adds guarded print device/test/detail/text/dispatch/cash-drawer endpoints and scopes print job reads/mutations to the active branch.
- Realtime event impact: Printer Monitor listens to `print:new`, `print:done`, and `print:failed`.
- Deployment impact: backend restart required for SQLite migration and new printer routes. Real LAN printers/cash drawers require a store-local server or agent on the same network; cloud-only Render cannot directly reach private printer IP addresses.
- Manual tests: run backend syntax/import checks, parse Printer Monitor inline module, verify `/printers` route, verify guarded print routes return JSON, and manually test LAN/IP printer plus cash drawer on store network.
- Rollback plan: revert `server/services/printing.js`, print API route changes, print job column migration additions, and `web/printers.html`; existing queued print jobs remain in SQLite.
- Warnings: browser DevTools can still inspect frontend assets by nature of the web; sensitive print data protection must rely on authenticated, permission-gated, branch-scoped APIs.

## 2026-06-19 POS/Retail Receipt Print Dialog

- Summary: Retail checkout and FnB POS payment/temporary bill now open the browser/system print dialog instead of only showing a receipt preview, with a remembered per-device receipt copy count.
- Files changed: `web/retail.html`, `web/pos.html`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: UI printing behavior only; orders, payments, inventory, and print job records are unchanged.
- Deployment impact: frontend refresh required. Browser print uses the device's installed printer selection; LAN/IP backend printer dispatch remains configured through Settings and Printer Monitor.
- Manual tests: parse Retail/POS inline modules, verify `/retail` and `/pos` return 200 locally, and manually complete a checkout/payment to confirm the system print dialog opens.

## 2026-06-19 Receipt Customer Wording

- Summary: Changed the no-customer/no-tax-invoice fallback wording to `Khách không xuất hóa đơn` across receipt rendering, bill template preview, order history reprint, customer picker, and report fallback display.
- Files changed: `web/admin.html`, `web/retail.html`, `web/pos.html`, `web/shared/orderHistory.js`, `web/shared/customer.js`, `web/shared/i18n.js`, `server/services/reportCenter.js`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: display text only; historical orders, payments, customers, invoices, and archived payment files are unchanged.
- Manual tests: parse Admin/Retail/POS inline modules and search active code paths for remaining old no-customer wording.

## 2026-06-19 POS/Retail Customer Box Sync

- Summary: Synced the customer selection display between Retail POS and FnB POS by using matching customer fallback text, action labels, payment-modal customer rows, and receipt/template customer variables.
- Files changed: `web/retail.html`, `web/pos.html`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: UI and receipt-rendering text only; customer, order, payment, and invoice records are unchanged.
- Manual tests: parse Retail/POS inline modules and verify `/retail` plus `/pos` return 200 locally.

## 2026-06-19 POS/Retail Company Invoice Request

- Summary: Added a synced `Xuất hóa đơn công ty` block to Retail POS and FnB POS payment modals with MST lookup, invoice name/company/address/email/phone/note fields, and renamed the visible retail module label to `Retail POS`.
- Files changed: `server/api.js`, `server/services/payments.js`, `server/services/retail.js`, `server/services/modules.js`, `web/shared/invoiceRequest.js`, `web/shared/app.css`, `web/shared/modules.js`, `web/index.html`, `web/admin.html`, `web/retail.html`, `web/pos.html`, `docs/API_CONTRACT.md`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: order payment payloads, order customer snapshot metadata, invoice request status, audit log, and receipt/template customer display.
- API contract impact: `POST /api/orders/:id/pay` and `POST /api/retail/checkout` accept optional `invoice_customer`; valid requests set `orders.invoice_choice` to `requested` and store company invoice data in `orders.customer_json`.
- Deployment impact: backend restart required for the new payment payload handling; frontend refresh required for the shared invoice UI.
- Manual tests: run backend syntax checks, parse Retail/POS inline modules plus the new shared invoice module, verify `/retail` and `/pos` return 200 locally.

## 2026-06-20 iPad Kiosk Table Unlock Topbar

- Summary: Restored the customer iPad topbar to use `/assets/logo.png` as the hidden staff unlock target, moved the 3-tap PIN flow from the table label to the logo, gated table selection behind the staff PIN when the iPad has no assigned table, and made the staff table-pick screen use the standard app topbar so staff can return to the launcher/tools.
- Files changed: `web/ipad.html`, `web/index.html`, `web/shared/modules.js`, `server/services/modules.js`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: iPad device table assignment UI only; order, payment, menu, and stored table records are unchanged.
- Manual tests: parse iPad inline module, verify `/ipad` returns 200 locally, verify launcher iPad links use `/ipad?pick=1`, and confirm the table label is display-only while the logo opens PIN after 3 taps; on the unlocked table-pick screen the standard topbar logo exits to the launcher.

## 2026-06-20 VietQR Payment QR Integration

- Summary: Added a VietQR API integration card in Settings, added a payment QR provider selector, and added `POST /api/orders/:id/payment-qr` so iPad Self-Order can request a unique QR payload for each open bill before customer confirmation.
- Files changed: `server/api.js`, `server/services/payments.js`, `server/services/settings.js`, `web/admin.html`, `web/ipad.html`, `docs/API_CONTRACT.md`, `docs/CHANGELOG_WORKFLOW.md`.
- Protected domains touched: payment configuration and open-order QR metadata generation; orders are not marked paid until the existing customer QR confirmation endpoint runs.
- API contract impact: new branch-scoped QR generation endpoint returns VietQR API metadata or a public VietQR image fallback with a warning when API credentials are incomplete/unavailable.
- Deployment impact: backend restart required for the new route and payment service helpers; frontend refresh required for Settings and iPad.
- Manual tests: run backend syntax checks, parse Admin/iPad inline modules, verify `/settings`, `/ipad`, and the new QR route return JSON locally.
