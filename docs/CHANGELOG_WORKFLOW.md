# Changelog Workflow

## 2026-07-31 Printing Audit: zero-config printing, paper sizes, label templates

- Summary: A shop-floor incident (payment confirmed but nothing printed; test print came out as a ~20mm faint column on 80mm paper) turned into a full audit of the printing subsystem. Four real defects, all of which had been silently wasting the user's configuration effort.
- **Printing no longer requires route configuration.** Payment reported "chưa cấu hình tuyến máy in" while the POS machine had a printer attached and the agent had already reported it. Route config is an advanced feature for shops splitting bill/kitchen/bar/label across printers; a shop with one printer should just print. When no configured route matches, the system now derives an implicit route (`auto:<device>:<printer name>`) from the printer attached to the device taking the payment. A real configured route always wins. The implicit route is never written to `print_config`, so the route-config button in Settings is unchanged — it is simply no longer a precondition for printing. This had to be handled in **two** places (the scan loop and `resolveAgentJobFast`); handling only the first left the job looking orphaned and cancelled on the spot — the old bug with a new cause.
- **Labels never used the configured size or the designed template.** `renderLabel()` only received the job payload, and label jobs deliberately omit `print_config` (a label template with an embedded base64 logo bloats every `print_jobs` row). So every label ever printed used the hardcoded 40-character fallback, no matter what size was set or what template was designed. It now reads branch config the same way the bill and test-print paths already did, with a label-specific scale (30mm→16, 40mm→24, 60mm→32 characters).
- **Choosing K57 paper still rendered 48 characters and overflowed.** The template designer writes paper code `'K57'` and `widthMm: 57` (sheet width); the server compared the code against `'K58'` — never matching — and compared mm against a threshold of 50, so 57 fell through to the 48-character branch. Paper code is now checked first, and the mm thresholds cover both conventions in use: 48mm (printable) and 57/58mm (sheet).
- **Faint, magnified output**: `ESC @` is specified to reset everything, but many clone thermal printers do not reset character size or alignment, so text stays magnified from whatever ran before. Every job now sends an explicit `ESC ! 0` / `GS ! 0` / `ESC a 0` / `ESC 2` after init. Whether this was the shop's actual cause is still unconfirmed — see the diagnostic below.
- ESC/POS logic is duplicated between `services/printing.js` and `agent.cjs` and **cannot** be merged: the agent ships as a Node SEA binary, which packages exactly one file, so a `require('./escpos.cjs')` would work in development and die in the built `.exe`. `escpos-parity.test.mjs` now pins the two together — same constant names, identical byte sequences, `ESC_INIT` before `ESC_RESET`, and `ESC_RESET` still containing `GS ! 0`. An earlier version of this test compared function source text and produced false positives (`̀-ͯ` versus the literal characters, `??` versus an explicit null check); it compares byte constants only.
- Added `deploy/chan-doan-may-in.ps1`: run on the POS machine, it sends raw ESC/POS straight to the printer via `WritePrinter` with `pDataType='RAW'`, bypassing the app entirely, and prints a 48-character ruler. Clean output means the printer and the RAW path are fine and the machine is still running the old agent (the `.exe` is locked during install unless the agent is stopped first). Faint or narrow output means the printer's own firmware or DIP switches, which software cannot fix.
- Deliberately **not** done: labels do not fall back to the receipt printer when no label route exists — different media, and falling back wastes receipt paper. Five exports in `printing.js` are only used internally and could be unexported; left alone because it is cosmetic and the shop was waiting on a fix.
- Files changed: `server/services/printing.js`, `server/agent.cjs`, `server/printer-zero-config.test.mjs` (new), `server/print-paper-size.test.mjs` (new), `server/escpos-parity.test.mjs` (new), `deploy/chan-doan-may-in.ps1` (new).
- Database / API contract impact: none.
- Manual tests: server 121 pass, Flutter 62 pass, `flutter analyze` clean. The size tests measure the **actual rendered width** rather than trusting the config value.
- Deployment impact: server (VPS) and the Hardware Agent on each POS machine. Deploying only the VPS will not fix faint or narrow printing — that lives in the agent.
- Rollback plan: revert the listed files.
- Warning: `protected-write` — implicit routing changes which physical printer receives a receipt. Verified only against tests, not against a live printer.

## 2026-07-31 Phone Printers Screen

- Summary: Replaces the desktop `PrintersScreen` on handsets with a phone-native one. Printer cards carry the real live status, print history is filterable by status, tapping a job shows the server's verbatim failure reason with a reprint action, and the cash drawer sits on the pinned action bar.
- Data: `GET /api/print/printers?live=1`, `GET /api/print/jobs`, `POST /api/print/printers/:id/test`, `POST /api/print/jobs/:id/reprint`, `POST /api/print/cash-drawer/open`.
- Regression guards: this screen sits directly on top of the printer fixes from 2026-07-30, and both are easy to undo from the app side, so they are now locked by test. Status is read from `state`/`statusText`/`online` — never from `active`, which is only the "Đang sử dụng" checkbox and stays true while the POS app is closed. A printer that is not ready has its "In thử" button disabled, because queueing a job that only prints once someone turns the printer on is what made staff believe a receipt had printed. The list always requests `live=1`; without it the server reports `ready` unconditionally.
- Server-side scoping still applies unchanged: staff without printer-management permission receive only the printers plugged into their own device plus shared LAN printers, and a 403 with a Vietnamese message if they aim at another POS's printer. The card marks the device's own printer with a "Máy này" badge so cross-machine mistakes are visible.
- Files changed: `screens/phone/phone_printers_screen.dart` (new), `phone_shell.dart`, `test/phone_printers_test.dart` (new).
- Database / API contract / realtime impact: none.
- Manual tests: Flutter 62 pass, `flutter analyze` clean apart from 2 pre-existing deprecations. The 9 new tests assert the disabled test-print button, the `live=1` query, the verbatim server message, and that each action hits the right endpoint.
- Deployment impact: phone APK only. Desktop and tablet keep the original `PrintersScreen`.
- Rollback plan: revert the listed files; `phone_shell.dart` falls back to `PrintersScreen`.
- Warning: `protected-read` plus test-print and drawer-open commands. Not yet run against a real printer from a handset.

## 2026-07-31 Phone Document Forms (product, purchase, transfer)

- Summary: Completes the phone write paths. Adds "Hàng hóa mới", "Phiếu nhập mới" and "Phiếu chuyển mới", each reachable from the `+` button on its own list screen, sharing one SKU picker sheet.
- Data: `POST /api/skus`, `POST /api/purchase`, `POST /api/warehouse/transfer`. Request bodies were written against the server functions, not guessed — `createSku` requires `name`; `savePurchaseOrder` requires at least one line with `item_id` and `qty > 0`; `transferStock` requires `from_warehouse_id != to_warehouse_id`.
- API client gap closed: `createSku` did not exist on the client although `/api/skus` has been live on the server. Products could only be created from desktop. Added to `warehouse_api.dart`.
- Deliberate choices: the phone never sends `total`/`subtotal` on a purchase order — the server recomputes both from the lines, and sending our own figure only creates a way for them to disagree. New product stock goes through `opening_stock` so the server writes an `OPENING` lot, rather than setting the `stock` column directly, which would leave the lot ledger and the stock count out of step.
- Files changed: `screens/phone/phone_doc_form_screens.dart` (new), `phone_catalog_screens.dart`, `phone_ops_screens.dart`, `services/api/warehouse_api.dart`, `test/phone_doc_form_test.dart` (new).
- Database / API contract / realtime impact: none. Existing endpoints only.
- Manual tests: Flutter 53 pass, server 102 pass, `flutter analyze` clean apart from 2 pre-existing deprecations. The write tests assert the exact request body and that invalid documents never reach the server: a product without a name, an empty purchase order, a transfer with no warehouses, and a transfer whose source equals its destination.
- Deployment impact: phone APK only.
- Rollback plan: revert the listed files.
- Warning: `protected-write` — these forms create SKUs, purchase orders and stock transfers against real inventory. Server-side guards still apply (transfer refuses the whole document if any line exceeds source stock), but none of this has been exercised against a live server or a physical handset yet. Test one of each on a non-critical warehouse before letting staff use them.

## 2026-07-31 Phone Field Mapping Audit, Forms and Reports

- Summary: Audited every field the phone screens read against the actual server services and SQLite schema, and fixed the mismatches. Added the first write-capable phone screens (expense, customer/supplier) plus the reports catalog and preview.
- Why this mattered: the phone screens rendered fine and threw no errors, but most of the field names had been guessed. They would have shipped showing zeros and blanks to the shop. Every mapping below is now taken from server code, not inferred.
- Field corrections: dashboard returns `bills`/`avg`/`openOrders`/`topItems` (not `orders`/`top_products`) and has **no refunds field** — that tile was invented and always read 0. Cash drawer nests its money under `summary` (`opening_cash`, `cash_sales`, `expenses`, `expected_cash`), not at the root. The `customers` table has **no `debt` column**; totals are `total_spent`, `total_orders`, `loyalty_points`. Expenses use `payee_name`/`category_name`/`expense_date`/`source`. Purchase orders expose `amount_due`/`amount_paid`. Warehouse transfer rows name the source warehouse `warehouse_name`. Order history has no `customer_name` and does not include line items — invoice detail now fetches `/api/orders/:id/receipt`.
- Permission corrections: menu tiles were gated on permissions the routes do not check, so a user could see a tile and then get 403. Now each tile uses the route's real guard — `module.contacts` for partners, `module.expenses`, `module.purchase`, `warehouse.manage`, `inventory.adjust`. Module `admin` declares `perm: null` in `modules.js`, so Tổng quan is visible to any signed-in user exactly as on desktop; the earlier test expectation was the thing that was wrong.
- API client: `getMovements` gained `itemId`/`itemType`. The server has always supported these filters (`inventory.listMovements`), but the client never sent them, so the stock card was pulling hundreds of rows and filtering on the device. It now filters server-side.
- New screens: expense create/edit, customer & supplier create/edit, reports catalog, report preview with period selector.
- Files changed: `screens/phone/phone_form_screens.dart` (new), `phone_overview_screens.dart`, `phone_catalog_screens.dart`, `phone_ops_screens.dart`, `phone_shell.dart`, `phone_scaffolds.dart`, `services/api/warehouse_api.dart`, `test/phone_form_test.dart` (new), `test/phone_shell_test.dart`.
- Database / API contract / realtime impact: none. Existing endpoints and payloads only.
- Manual tests: Flutter 46 pass, server 102 pass, `flutter analyze` clean apart from 2 pre-existing deprecations. Test fakes now mirror the real server envelopes (`{partners:…}`, `{expenses:…}`, `{shift:…}`, `{summary:…}`) so a future rename on either side turns the suite red instead of silently zeroing a screen. Write-path tests assert the exact request body: an expense of 0đ and a nameless partner never reach the server, and `partner_type` distinguishes customer from supplier.
- Deployment impact: phone APK only.
- Rollback plan: revert the listed files.
- Warning: `protected-write` — expense and partner creation write real records. Not yet exercised against a live server or a physical handset.

## 2026-07-31 Phone Navigation Shell and Module Screens

- Summary: Handsets now boot straight into a phone shell with a 5-item bottom bar (Tổng quan · Bán lẻ · Hàng hóa · Hóa đơn · Nhiều hơn) instead of the desktop launcher grid. Adds phone screens for dashboard, shift/cash drawer, products, product detail, stock card, invoices, invoice detail (with reprint), customers, suppliers, expenses, purchases, transfers and stocktakes.
- Architecture: three reusable scaffolds in `phone_scaffolds.dart` (list / info-card detail / form field) carry most screens, so a new module screen is ~40 lines of business wiring rather than a fresh copy of the layout. `PhonePartnersScreen` serves both customers and suppliers off the one `/api/partners` endpoint so the two cannot drift apart.
- Data: real only, no sample data. `/api/dashboard`, `/api/shifts/current`, `/api/cash-drawer/current`, `/api/skus`, `/api/movements`, `/api/orders/history`, `/api/partners`, `/api/expenses`, `/api/purchase`, `/api/warehouse/documents`, `/api/warehouse/stocktakes`.
- Permissions: the bottom bar and the "Nhiều hơn" grid are both gated on `AuthProvider.hasPermission` plus `AppFlavor.showsModule`, matching desktop. Covered by tests for the real cashier and manager permission sets, and for a user with no permissions at all.
- Files changed: `screens/phone/phone_scaffolds.dart`, `phone_overview_screens.dart`, `phone_catalog_screens.dart`, `phone_ops_screens.dart`, `phone_shell.dart` (all new), `bootstrap.dart`, `test/phone_shell_test.dart` (new).
- Database / API contract / realtime impact: none. Read-only against existing endpoints, except invoice reprint which reuses the existing print-job path.
- Deployment impact: phone APK only.
- Manual tests: `flutter analyze` clean, phone screen tests pass at 393x852 including overflow checks on every new screen.
- Bug found while testing: `PhoneMetricStrip` used `CrossAxisAlignment.stretch` inside a `Column`, which forces infinite height and threw during layout on every screen that showed metrics. Fixed with `IntrinsicHeight` so the cells stay equal-height without unbounded constraints.
- Known gaps: `/api/movements` has no sku filter, so the stock card fetches 400 rows and filters on the client — fine at current volumes, but it should move server-side. Create/edit forms (new product, new customer, new expense, new purchase/transfer, printer setup) are not built yet; those modules are read-only on the phone and still edited from desktop.
- Rollback plan: revert the listed files; `bootstrap.dart` falls back to `LauncherScreen` for handsets.
- Warning: `protected-read` for the new screens. Still not verified on a physical handset — no Android device has been reachable over ADB.

## 2026-07-31 Phone Retail Selling Flow (one-handed)

- Summary: First slice of the phone-native UI. Handsets now open a one-handed retail flow — product grid → cart → payment → done — instead of the shrunken desktop layout. Desktop and tablet are untouched; the branch is on `AppFlavor.current.isHandset` at the single `retail` launcher route.
- Scope: this is 4 of the 53 screens in the `Dan D Pak POS Mobile` design project. The rest (products, invoices, warehouse, purchase, transfers, reports, supplier/customer detail, printer/label setup) are not built yet. F&B was explicitly deferred by the owner.
- Data: real only. `GET /api/skus` (paged, retail channel), `GET /api/shifts/current`, `POST /api/retail/checkout`, plus the existing background `forcePrintReceiptJob`. No sample data ships in the app; the design file's mock arrays were used for layout reference only.
- Files changed: `screens/phone/phone_kit.dart` (new), `screens/phone/phone_sell_screen.dart` (new), `screens/launcher_screen.dart`, `services/app_notifier.dart`, `test/phone_sell_flow_test.dart` (new), `dandpak_phone` version + `android/gradle.properties`.
- Protected domains touched: retail checkout is called with the same contract the desktop uses, including `client_request_id` for idempotency. No new server behaviour, no schema change, no migration.
- API contract impact: none. Existing endpoints only.
- Realtime event impact: none.
- Deployment impact: phone APK only (build 14, `2026.07.31.01`). Backend unchanged. `kotlin.incremental=false` added to the phone's `gradle.properties` — the tablet already carried this for the same Windows cross-drive cache failure; the phone lacked it, which is why phone APK builds failed while tablet builds succeeded.
- Manual tests: 28 Flutter tests pass (9 new), `flutter analyze` clean apart from 2 pre-existing deprecations, release APK builds (104 MB). Guard rails covered by test: out-of-stock items cannot enter the cart, short payment cannot complete, and a closed shift blocks checkout entirely.
- Bugs found and fixed while testing: (1) `AppNotifier._osNotification` wrapped an **async** `LocalNotification.show()` in a **sync** try/catch, so a notification failure escaped as an unhandled async error — this could knock over any screen, desktop included, and it did knock over the phone sell screen while reporting a print failure; (2) the post-payment print branch could throw back into the sell screen after money was already taken — now contained and logged to the black box.
- Rollback plan: revert the listed files. Handsets fall back to `RetailScreen` immediately; nothing persists.
- Warning: `protected-write` via the existing checkout endpoint. Not yet verified on a physical handset — no Android device was reachable over ADB during this session, so the flow has only been exercised in widget tests at 393x852. It must be run against a real device and a real shift before any cashier uses it.

## 2026-07-30 Thermal RAW Printing and Test-Slip Layout

- Summary: Thermal printers attached to a POS now receive raw ESC/POS bytes through the Windows spooler instead of driver-rendered text, which fixes the extremely faint output and restores density, auto-cut, and drawer pulses. The test slip no longer dumps raw JSON and is laid out to the configured paper width.
- Root cause (faint print): for `connection: 'system'` the agent called `Out-Printer`, so the Windows **driver** rasterised the text as an anti-aliased greyscale bitmap. A thermal head can only fire dots, so it dithered that bitmap — hence very faint, smeared output — and every ESC/POS command (density, cut, drawer) was swallowed as literal text. Only the LAN path ever sent real ESC/POS.
- Root cause (wrong format): `renderGeneric()` ended with `JSON.stringify(payload, null, 2).slice(0, 1200)`, so the test slip printed the whole printer config object. It also rendered at a fixed 40 columns regardless of paper width.
- Files changed: `server/services/printing.js`, `server/agent.cjs`, `server/services/settings/print.js`, `deploy/build-agent.ps1` (new), `server/receipt-printer-routing.test.mjs`, `flutter-apps/dandpak_desktop/windows/hardware-agent/dandpak-agent.exe` (rebuilt).
- Protected domains touched: print output only. No order, payment, inventory, or customer data is read or written.
- Database impact: none. `bill.printDensity` gains a default of `dark`; it is an additive key in an existing JSON setting and older code ignores it.
- API contract impact: agent job payloads gain `raw` (boolean). Older agents ignore it and keep the previous driver path, so a partial rollout is safe.
- Realtime event impact: none.
- Deployment impact: the Hardware Agent binary changed, so the desktop installer must be reinstalled/updated on each POS — a backend-only deploy will not fix the faint print. `deploy/build-agent.ps1` now rebuilds the SEA binary reproducibly; previously it was hand-built with no script, so agent changes could silently ship stale.
- Manual tests: 94/94 Node tests pass. The RAW spooler script was verified twice on this machine — it fails cleanly with "Khong mo duoc may in" for a non-existent printer (proving the P/Invoke compiles) and returns exit 0 after writing 14 bytes to a real installed printer. Rendering was dumped at both K80 and K58 to confirm no line exceeds the paper width and that the slip reports the same paper size it renders at.
- Rollback plan: revert the listed files and restore the previous `dandpak-agent.exe` from git, then rebuild and reinstall the desktop app. No data migration is involved.
- Warning: `protected-read`. Raw ESC/POS is sent only to routes whose `output` is not `report`, so an A4 driver printer keeps the text path — sending ESC/POS to a laser printer would print garbage. Real paper output on the store's POS-80C has not been verified by the author; it needs a physical test print after the update.

## 2026-07-30 Receipt Auto-Print, Real Printer Status, Per-Device Printer Scope

- Summary: Receipts, kitchen tickets, cup labels, and runner slips now resolve a **real** printer route by output type instead of hard-coded route ids, so bills print automatically again. The Máy in screen reports true printer liveness instead of a config flag. Each POS prints to the printer plugged into itself, and staff without printer-management permission only see and control the printers they may actually use.
- Root cause: every print hook wrote a fixed route id (`bill`, `kitchen`, `bar`, `label`, `runner`). The store replaced the default routes with its own ids (`POS-80C`, `AP-250`, `BEP`), so every receipt job pointed at a route that no longer existed; `pendingAgentJobs` classified it as orphaned and set it to `cancelled`. Symptom: payment completed, print history showed "Hóa đơn / Tạm tính — cancelled", printer silent.
- Files changed: `server/services/printing.js`, `server/services/system.js`, `server/services/payments.js`, `server/modules/printing/routes.js`, `server/modules/payments/routes.js`, `flutter-apps/dandpak_core/lib/src/services/api/printing_api.dart`, `flutter-apps/dandpak_core/lib/src/screens/printers/printers_screen.dart`, `server/receipt-printer-routing.test.mjs`.
- Protected domains touched: print jobs and printer configuration reads. Orders, payments, payment lines, inventory, and archives are untouched.
- Database impact: none. No schema change and no migration; only `print_jobs` rows created/updated through existing columns.
- API contract impact: `GET /api/print/printers` accepts `live=1` and now scopes its result by the caller's `x-device-id` unless the caller manages printers; each row adds `owner_device_id`, `owner_device_name`, `attached_to_me`. `POST /api/print/printers/:id/test` and `POST /api/print/cash-drawer/open` return 403 when the target printer is plugged into a different POS and the caller is not Admin/Manager. `POST /api/orders/:id/pay` reads `x-device-id` to choose the receipt printer.
- Realtime event impact: none added. `POST /api/print/jobs/:id/print` now emits `print:new` (re-queue) instead of attempting a server-side print in agent mode.
- Deployment impact: deploy backend and apps together, then restart the backend. Agent liveness TTL drops 90s → 60s so a closed POS app is reflected within one minute.
- Manual tests: 88/88 Node tests pass; the 16 new routing/permission tests were verified to fail 15/15 against the previous code before the fix. `flutter analyze` clean (2 pre-existing deprecation infos), `flutter test` 19 pass / 1 skipped. Printer suites `agent-printers-per-device` and `print-queue-orphan` still pass unchanged.
- Rollback plan: revert the listed files. No data migration to undo; queued print jobs stay in SQLite and older code reads them normally.
- Warning: `protected-read` only. Note the intentional deviation from a literal reading of the request — LAN printers stay visible to non-privileged staff because they are shared network devices and `assertPrinterUsableBy` permits them; hiding them would create routes that are usable but invisible. Only another machine's directly-attached (USB/`system`) printers are hidden.

## 2026-07-29 Warehouse Product Editing and Unit Conversion

- Summary: Authorized warehouse users can edit retail product identity, image, VAT, purchase/sale prices, and alternate units from the expanded stock row. Purchase documents accept an alternate unit and convert received quantity and cost back to the base unit.
- Files changed: Flutter warehouse/purchase UI and API client; inventory/purchase backend services and routes; inventory regression test.
- Protected domains touched: SKU master data, purchase lines, stock lots, stock movements, and warehouse documents.
- Data impact: extends the existing `skus.units_json` objects; no destructive migration. Product deletion is now a soft delete (`active=0`) so stock lots and movement history remain intact.
- API impact: `POST /api/skus/image-upload`; existing SKU create/update accepts unit objects containing `name`, `factor`, `barcode`, `cost`, `price`, `price_includes_vat`, and `vat`. Purchase line `unit` is used as the receive UOM.
- Validation: focused Flutter analysis, Node syntax checks, inventory conversion regression test, and existing inventory/retail regression suites.
- Rollback: revert application code; the additional JSON keys are ignored safely by older code. Uploaded images may remain as harmless unreferenced files.

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

## 2026-07-22 Item-level VAT Pricing

- Summary: F&B menu items and retail SKUs can store tax-inclusive or tax-exclusive configured prices with an item VAT rate; checkout always uses the backend-calculated customer price and snapshots VAT on the order.
- Database impact: adds VAT configuration to menu/SKU masters, `order_items.vat_rate`, and order `goods_amount`/`vat_amount`; existing paid totals are not rewritten.
- UI impact: VAT appears in F&B POS, retail POS, checkout, printed/history receipts, QR payment view, and the customer display.
- Deployment impact: deploy backend and desktop together, then restart the backend once for migration.
- Validation: Node regression tests passed 6/6, full server syntax and Dart analysis passed, and the Windows release build succeeded.

## 2026-07-22 Checkout Reconciliation and Idempotency

- Summary: Separated cash tender/change from recognized revenue, made retail checkout retries idempotent, blocked unpriced SKUs, honored `STORAGE_PATH`, restored fresh-install demo seeding, repaired desktop launch targets, and fixed the missing history import that blocked refunds.
- Files changed: payment/retail/order/history/shift services, SQLite migration, storage path users, desktop checkout/launcher, tests, and safety documentation.
- Protected domains touched: orders, payments, payment lines, refunds, shifts, inventory, audit archives, DMS files, and SKU pricing.
- Database impact: adds `payment_lines.tendered_amount` and `orders.client_request_id`; first startup backfills tendered values and caps legacy payment allocations to `payments.total` exactly once.
- API contract impact: `POST /api/retail/checkout` accepts `client_request_id` or `Idempotency-Key`; replay returns the original receipt with `idempotent_replay=true`.
- Deployment impact: back up SQLite, deploy backend and Flutter desktop together, restart backend for migration, then verify the configured `STORAGE_PATH` volume is writable.
- Manual tests: 82 server files passed syntax checks; Node tests passed 6/6; focused Dart analysis and the Windows release build passed; a real fresh DB seeded six demo users and wrote archives only below its temporary `STORAGE_PATH`.
- Production rollout: backend restarted successfully on 2026-07-22, the three reported overpayment bills now reconcile at 300,000đ revenue while retaining 450,000đ tendered for receipt display, and Windows build 48 (`2026.07.22.1`) was published as an optional update.
- Rollback plan: restore the pre-deploy SQLite backup before reverting code because the migration rewrites legacy overpayment allocations; durable files remain under configured `STORAGE_PATH`.
- Warning: this is a `destructive-risk` migration limited to correcting payment allocation rows where recorded line totals exceeded the authoritative payment total.

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

- Summary: Changed the no-customer/no-tax-invoice fallback wording to `Bán cho người tiêu dùng` across receipt rendering, bill template preview, order history reprint, customer picker, and report fallback display.
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
