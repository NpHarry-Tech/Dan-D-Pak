# Changelog Workflow

## 2026-08-04 Catalogue got the menu-book builder instead of a copy of it

- Summary: the retail catalogue shipped with a cut-down settings panel - no PubHTML5 import, no Save button, no way to link a page to a product. The fix was not to grow that panel but to delete it and point catalogue at the builder F&B already uses.
- **One builder, two kinds.** `BookMenuPanel` now takes `kind: 'fnb' | 'retail'`. The kind selects the item source (menu items vs. retail SKUs), the hotspot key (`menu_item_id` vs. `sku_id`), the active-book key (`activeBookId` vs. `activeRetailBookId`) and the on/off key (`enabled` vs. `retailEnabled`). Everything else - page upload, PubHTML5 import, hotspot placement, Save - is shared. Two panels would have meant fixing every page-flip bug twice, which is exactly how the catalogue ended up missing four features.
- **Adding a page now uploads a real image.** The old builder only asked for a path like `/assets/menu-book/03.webp`; a shop had no way to get its own artwork in, and a wrong path rendered a blank page. `_addPage`/`_deletePage` go through `/api/settings/book-menu/page`, so the file lands on the server and every device sees it. Both operations save the in-progress config first - the server returns the whole config, and an unsaved hotspot would have been overwritten by that response.
- **Empty retail books survive sanitising.** `sanitizeConfig` dropped any book with zero pages. A catalogue is created first and filled after, so the new book vanished before the first page could attach to it. Retail books are now kept while empty; FnB books still need at least one default so `activeBookId` can never point at a retail book.
- **Catalogue is divided into categories.** Each page carries a `category`; `getPublicRetailCatalogue` returns the categories in page order with the first page of each. The customer screen renders a chip bar that jumps straight to that page - no flip animation across twenty pages - and highlights the category the current page belongs to. A thirty-page catalogue is unusable if the only navigation is swiping.
- **Flip direction came from the wrong signal.** `_startDrag` decided forward/backward from where the finger landed (`localPosition.dx > width/2`). Start a right-to-left swipe on the left half and the widget read it as "go back", so the page ran the wrong way or sat still. Direction now comes from the first real horizontal movement: swipe left to go forward, swipe right to go back, wherever the finger starts.
- **The page is as large as the box allows.** The old geometry forced a portrait A4 shape (`height * .72`, ratio 1.5) - on a landscape tablet that shrank the page to a strip between two empty margins. It now takes the book's own `pageWidth`/`pageHeight` ratio and scales to fit. The white card behind the image is gone too: with the frame matching the image ratio there is nothing to letterbox, and `contain`-on-white was what produced the white bands the shop complained about.
- **Tap no longer flips.** Hotspot dots are off for retail (they cover the product being looked at). Instead a small button sits at the bottom-centre *of the image* - inside the page box, not the screen, so it tracks the artwork - and only appears on pages that actually have a product linked. It fades out while the page is tilted so it cannot swallow a swipe. The page counter moved to the top-right to stay out of its way.
- **Customer picker is the counter's picker.** `_CustomerPickerDialog` was `part of retail_screen.dart` and therefore unreachable, so the catalogue had grown its own three-field form: an existing customer got retyped by hand, losing their loyalty points, tax code and perks, and leaving the shop to merge duplicates later. It is now `lib/src/widgets/customer_picker_dialog.dart` and both screens use it.
- **One exit password.** Catalogue's separate `exitPin` is gone; `/api/catalogue/exit` verifies the iPad staff PIN. Two codes for the same act - unlocking a customer-facing device - meant forgetting the rarer one locked that device out.
- **Payment left the catalogue settings.** The panel now points at Settings then Lien ket for QR and Settings then Thiet bi khach for the PIN, and keeps only the welcome text. A second copy of payment config is how a catalogue ends up showing one QR while the customer display shows another.
- Files changed: `server/services/bookMenu.js`, `server/services/catalogue.js`, `server/modules/catalogue/routes.js`, `server/modules/settings/routes.js`, `server/catalogue-retail.test.mjs`, `flutter-apps/dandpak_core/lib/src/screens/management/book_menu_panel.dart`, `.../catalogue_panel.dart`, `.../screens/catalogue/retail_catalogue_screen.dart`, `.../screens/retail/retail_screen.dart`, `.../widgets/book_page_view.dart`, `.../widgets/customer_picker_dialog.dart` (new, moved out of `retail_customer_dialogs.dart` which is deleted), `.../services/api/management_api.dart`, `flutter-apps/dandpak_core/test/lat_trang_sach_test.dart` (new).
- Database / API contract impact: `book_menu_config` pages gain `category` (optional, defaults to empty); `/api/catalogue/book` gains `categories`; `/api/settings/book-menu/import-pubhtml5` accepts `kind`. `catalogue_config.exitPin` is dropped - stored values are ignored, not migrated. No schema change.
- Manual tests: server 301 pass, Flutter 98 pass, analyze clean. The new Flutter test drives real drags and asserts the left-half-start case that used to fail, plus that a plain tap does not flip.
- Rollback plan: revert the listed files. Pages saved with a `category` stay readable by the old code, which ignores the field.

## 2026-08-04 A blank Retail POS that could not explain itself

- Summary: the Vietfoods branch linked a warehouse to Retail and the POS product grid stayed empty, with no indication why. The warehouse filtering turned out to be correct; what was missing was any way for the shop to see what the filter had done.
- **The rules, now pinned by tests.** Two places describe which warehouse feeds a sales channel: `retail_config.standalone.warehouse_id` (naming one warehouse outright) and the per-warehouse `sales_channels` ticks. Naming a warehouse wins and suppresses the tick filter - applying both would guarantee an empty list whenever they disagree. `retail-kho-kenh-ban.test.mjs` locks that down, along with the fact that browsing a physical warehouse in the Kho hang screen ignores the retail config entirely.
- **`empty_reason`.** When a paged `listSkus` returns nothing, the server now says why: which warehouse the channel is drawing from, which warehouses the branch's stock actually sits in, and where to change it. It stays quiet when zero is the honest answer - no SKUs created yet, or the user typed a search term - because blaming configuration for an empty search box would be worse than saying nothing.
- **Shown where it matters.** Retail POS renders it in place of "Khong co san pham". The catalogue customer screen treats it as a load error, since a book whose detail buttons all resolve to nothing is not usable. The catalogue builder shows it too - with no SKUs there is nothing to attach a hotspot to.
- **Catalogue draws from the same warehouse as the counter.** It always did (both ask for channel `retail`), but nothing said so and nothing tested it. Tests now assert the two lists match, that changing the retail warehouse moves the catalogue with it, and that the channel price book applies - a customer must not read one price on the tablet and be charged another at the till.
- Files changed: `server/services/inventory.js`, `server/retail-kho-kenh-ban.test.mjs` (new), `flutter-apps/dandpak_core/lib/src/screens/retail/retail_screen.dart`, `.../screens/catalogue/retail_catalogue_screen.dart`, `.../screens/management/book_menu_panel.dart`.
- Database / API contract impact: paged `/api/skus` may include `empty_reason: {code, message}`. Additive; absent when the list is non-empty or the emptiness is unremarkable.
- Manual tests: server 301 pass, Flutter 98 pass, analyze clean.
- Rollback plan: revert the listed files. Clients ignore an absent `empty_reason`.

## 2026-08-04 Stock could not be edited from the item it belonged to

- Summary: opening a product in Kho hang offered every field except the one the shop wanted - the stock count. "Ton dau ky" only existed while creating an item, so an existing item had no editable stock anywhere on the form.
- **The field is back for existing items**, for anyone holding `warehouse.item` or `inventory.adjust` - the same pair the `/api/skus/:id/adjust` route already accepts, so the field never appears to someone the server would refuse. Saving calls `adjustSkuStock` only when the number actually changed, and separately from `updateSku`: changing stock has to produce a stocktake movement so it stays clear who changed it and by how much.
- **Lot-tracked items are excluded on purpose.** Their stock is the sum of their lots; typing a single figure gives no way to decide which lot to debit. Those go through a stocktake sheet, which names the lots.
- **The description field stopped looking like an afterthought.** It was pressed straight against the grid of one-line fields above it. It now sits under its own "Noi dung cho khach" heading with room around it - it is the only multi-line field on the form and the only one a customer will read.
- Files changed: `flutter-apps/dandpak_core/lib/src/screens/warehouse/warehouse_screen_methods.dart`, `flutter-apps/dandpak_core/lib/src/services/api/warehouse_api.dart`.
- Database / API contract impact: none - `/api/skus/:id/adjust` already existed and was unreachable from this screen.
- Manual tests: Flutter 98 pass, analyze clean.
- Rollback plan: revert the listed files.

## 2026-08-03 A table nobody could clear, not even admin

- Summary: table A06 held bill `Dan260726023` with 30.000đ recorded and no items left. Every exit was closed, so the table sat dead through service. The safety rule that blocked it was right; what was missing was a legitimate way out.
- **The deadlock.** Paying was impossible — the bill had nothing left to sell. Refunding was impossible — the refund path requires an order already in `paid`. Clearing was impossible — `resetTable()` refuses any bill with recorded money, on the sound grounds that erasing it destroys the trail. Admin rights made no difference, because this was never a permission problem.
- **The fix keeps the rule and adds the missing door.** `resetTable()` gains `refundPaid`. Instead of deleting the money it writes a **counter-payment of exactly the negative amount**, then voids the bill and frees the table. The original payment row stays untouched, so the ledger holds both directions and the bill's net revenue is zero — which is what "để còn chứng từ" actually asks for. Without the flag the refusal behaves exactly as before.
- **Authorisation.** Refund-and-clear needs a manager/owner PIN — the `void` permission alone is not enough, because this one moves money — plus a written reason of at least three characters. A negative entry nobody can explain later is worse than the stuck table.
- **In the app**, the 409 is no longer a dead end: the POS recognises "đã ghi nhận" and offers *Hoàn tiền và dọn bàn*, stating plainly what will be written before asking for the reason and the PIN.
- Files changed: `server/services/orders.js`, `server/modules/orders/routes.js`, `server/table-stuck-paid-reset.test.mjs` (new), `flutter-apps/dandpak_core/lib/src/services/api/pos_api.dart`, `flutter-apps/dandpak_core/lib/src/screens/pos_screen.dart`.
- Database / API contract impact: none. Refunds use the existing `payments` / `payment_lines` tables with a negative amount; no new table, no migration.
- Manual tests: server 206 pass, Flutter 82 pass, analyze clean. The new test rebuilds table A06's exact state — open bill, money recorded, zero items — and asserts both halves: erasing is still refused, and refunding frees the table while leaving **two** payment rows summing to zero.
- Deployment impact: VPS server for the escape hatch itself; the POS needs a client build to show the new dialog. Until then the table can be freed by calling `/api/tables/:id/reset` with `refund_paid`, a reason and a manager PIN.
- Rollback plan: revert the listed files. Any counter-payments already written stay valid — they are ordinary payment rows.

## 2026-08-03 Printed date/time was the server's clock, not the shop's

- Summary: the test-print ticket showed a time seven hours off and, after 17:00 UTC, the wrong day. Root cause was not in the print code — the VPS container runs with no `TZ`, so it runs on UTC, and several places built display timestamps from the machine clock and labelled them as Vietnam time.
- **Test print.** `testPrinter()` froze a string at job-creation time with `new Date().toLocaleString('vi-VN')`. Two defects in one line: it is the machine clock (UTC on the VPS, not Vietnam), and it is the moment the job was *queued*, not the moment paper came out. `renderTest()` already had a correct fallback via `vietnamParts()` (which pins `timeZone: 'Asia/Ho_Chi_Minh'` through `Intl`) but the frozen string always won. The payload field is gone; the time is now computed when the ticket is rendered.
- **Kitchen tickets** had the same defect (`toLocaleTimeString`/`toLocaleDateString` on a `Date`), in three places. All now go through `vietnamParts()`.
- **E-invoice date.** `misa/payload.js localInvDate()` used `getFullYear()/getHours()` — machine clock again. A bill paid at 00:10 Vietnam time is 17:10 UTC *the previous day*, so the invoice would have carried the wrong date and therefore the wrong tax period. Now formatted through `Intl` with a fixed timezone.
- **Container timezone.** `TZ: Asia/Ho_Chi_Minh` added to `deploy/company-server/docker-compose.yml`. This is the systemic fix, but the code no longer depends on it — every timestamp above is timezone-explicit and stays correct if the variable is ever dropped or the service runs elsewhere.
- **Reprint.** Investigated with a probe running under `TZ=UTC` to reproduce the VPS exactly: reprint already carried the original payment time correctly (`vietnamParts(paid_at || created_at)`, and `Print.reprint()` copies the parsed payload). No defect found; a regression test now pins it so a future change cannot silently make a reprint stamp itself with the reprint moment.
- **Guard against recurrence.** The new test scans `printing.js` and fails if any non-comment line builds a display timestamp from `new Date().toLocale*String`. That pattern reads the machine clock and is only ever safe for formatting money.
- Files changed: `server/services/printing.js`, `server/services/misa/payload.js`, `deploy/company-server/docker-compose.yml`, `server/print-datetime-timezone.test.mjs` (new).
- Database / API contract impact: none.
- Manual tests: server 201 pass. The timezone test forces `TZ=UTC` so it reproduces the VPS environment rather than the developer's machine, which is on Vietnam time and would have hidden the bug entirely.
- Deployment impact: VPS server. The `TZ` change requires `docker compose up -d` (the deploy script does this), not just a code copy.
- Rollback plan: revert the listed files.

## 2026-08-03 MISA meInvoice: integration that could never have worked, rebuilt

- Summary: the integration was structurally incapable of issuing a single invoice, regardless of credentials. Rebuilt as an eight-file module with a mock-MISA end-to-end test. One unknown remains and it is now a settings field, not a code change.
- **The blocking defect.** `activationBlockers()` required `configurationTestPassed === true`, and **no line of code anywhere wrote that value**. It was declared `false` in the schema, read in one place, and briefly forced true inside `testConnection` for its own local check. `isLive()` therefore always returned false, so `processJob` took the `PENDING_PROVIDER` branch and returned before contacting MISA. Nothing surfaced as an error, because this is not an error path — it is "configuration incomplete".
- **Two more, each independently fatal.** `activationBlockers()` also required `templateId`, but there was **no endpoint to fetch templates and no field on the settings screen** to hold one. And `isLive()` demanded `environment === 'production'`, so a sandbox account could never issue — meaning the only way to test was to publish real invoices to the tax authority.
- **`testConnection` reported success after authenticating only.** A token proves the account can log in. It proves nothing about the tax code belonging to that company, or about any usable invoice template existing. It now runs three steps — auth → company → templates — reports which step failed, and persists the outcome (`configurationTestPassed`, `companyName`, `invoiceCodeType`, `availableTemplates`, `series`, `lastTestedAt`).
- **Duplicate-invoice risk on timeout.** A publish that timed out was retried as a fresh invoice; MISA may well have accepted the first one. Every attempt after the first now queries invoice status first and adopts an existing invoice instead of publishing again. `DUPLICATE_REFID` is treated as "already issued", not as a failure. The mock server holds the connection open after recording the invoice so the test exercises exactly this.
- **Retry classification.** Errors now carry `retryable`. Data errors (wrong tax code, missing field, retired template, unbalanced totals) stop immediately instead of burning ten attempts over half an hour before showing the real message.
- **Token lifecycle.** Every operation used to log in again — ten invoices in a row meant ten logins. Now cached per account+environment, refreshed on expiry, with single-flight so concurrent jobs produce exactly one login (asserted in the test).
- **Contract tolerance.** MISA issues per-customer API contracts. All six endpoint paths are overridable from Settings (`endpointAuth`, `endpointCompany`, …) with v3 defaults, and response fields are read across naming variants. A contract mismatch is a settings change, not a rebuild.
- **Environment guard, corrected.** The first version rejected any base URL that did not contain `testapi`, which would have blocked legitimate on-prem gateways. It now only objects when the URL is definitively the *other* environment's public host. The test suite caught this.
- **Settings screen.** Added the controls the schema always expected but never exposed: environment, integration type, invoice business type, tax method, rounding policy, and a template dropdown populated from MISA (invoice symbol follows the template and cannot be typed). Invoice-with-code is read-only, taken from MISA.
- Files changed: `server/services/misa/` (8 files, replacing the 297-line `misa.js`), `server/services/{einvoice.js,invoices.js}`, `server/modules/settings/routes.js`, `server/services/settings/integrations.js`, `server/misa-end-to-end.test.mjs` (new), `server/misa-production-blockers.test.mjs`, `flutter-apps/dandpak_core/lib/src/screens/management/settings_integrations_panel.dart`, `docs/MISA_EINVOICE.md` (new).
- Database / API contract impact: no schema change. New settings keys (`series`, `lastTestError`, `lastTestStatus`, `availableTemplates`, `endpoint*`) default to empty and are backwards compatible.
- Manual tests: server 196 pass (16 of them the new MISA end-to-end), Flutter 82 pass, analyze clean on both packages.
- **Not verified**: the real MISA endpoint paths and field names, because that requires the customer's own integration contract and a sandbox account. Neither exists in this repo — `.env` holds only `PRINT_DISPATCH`.
- Deployment impact: VPS server. No app rebuild required for the server-side fixes; the settings screen needs a client build.
- Rollback plan: revert the listed files.

## 2026-08-01 Phone build 31: the real cause of "bill won't print", and auto-confirm that stops being a lottery

- Summary: Build 30's printing fix was real but was not the cause. Two deeper defects were: the retail checkout path never told the server which machine was taking the money, and the default `bill` route (connection `browser`) short-circuited printer resolution. Auto-confirm was flaky because the client invented the bank transfer reference.
- **`/retail/checkout` never forwarded `x-device-id`.** `/orders/:id/pay` reads it and passes it to `printReceipt`, with a comment explaining why. `/retail/checkout` — the path **every** retail sale takes — did not, so `resolvePrinterForOutput` always saw an empty `deviceId` and skipped all three "this machine's own printer" steps. A handheld's built-in printer exists only through the agent, never in `print_config`, so it had no way left to be chosen. Threaded `device_id` through the route → `Retail.checkout` → `payOrder` → `printReceipt` (including the idempotent-replay path).
- **The default `bill` route silently ate every receipt.** `DEFAULT_PRINT_CONFIG` ships a route `id: 'bill', connection: 'browser'`. Printer resolution checks `legacyId: 'bill'` *before* looking for real printers, and returned it. In agent mode a `browser` route can never produce paper — the queue scanner only hands out `lan`/`system` jobs — so the job sat `queued` forever. A shop that never opened print settings could not print a receipt, while "In thử" worked because it addresses a route by id and skips resolution entirely. The legacy-id branch now refuses `browser` routes when `PRINT_DISPATCH=agent`.
- **The app now shows the real reason.** `printReceipt` already logged a precise diagnostic server-side and then returned an empty array; the app turned that into "Không thấy lệnh in bill vừa thanh toán", which describes the symptom and helps nobody. It now sets `receipt.print_error` (same object `payOrder` returns), and the sell screen prints that sentence verbatim.
- **Auto-confirm ("hên xui").** The phone built the bank reference itself — bill number with punctuation stripped. The server matches with `paymentReferenceForOrder` = `transferPrefix + billNoDigits`. Those agree only by coincidence when the shop's prefix happens to equal the bill number's letters; change the prefix in Kế toán and matching dies silently. Worse, when the draft order had not been created the client fell back to `DANBILL<timestamp>` — a reference no order carries, so the money always landed as `unmatched`. The phone now asks `POST /orders/:id/payment-qr`, which derives the reference with the **same function the webhook matcher uses**. When there is no order to attach to, the screen says so instead of promising an auto-close that cannot happen.
- **SePay's "Xác thực thanh toán: Thất bại"** is SePay's own payment-code check (`Mã thanh toán` is empty on that transaction) — our integration matches on transfer content, not payment codes, so it does not by itself mean our webhook rejected anything. What to check on our side is Kế toán → bank transactions: every incoming credit is recorded with a status (`paid` / `unmatched` / `already_paid` / `error`), which names the failure directly.
- Files changed: `server/modules/retail/routes.js`, `server/services/{retail.js,printing.js}`, `server/retail-checkout-print-device.test.mjs` (new), `flutter-apps/dandpak_core/lib/src/services/api/retail_api.dart`, `screens/phone/phone_sell_screen.dart`, `flutter-apps/dandpak_phone/lib/app_version.dart` (build 31), `docs/REPO_STRUCTURE.md`.
- Database / API contract impact: none. `/retail/checkout` now honours the `x-device-id` header it was already being sent.
- Manual tests: server 163 pass, Flutter 77 pass, analyze clean. The device-routing test drives the real `Retail.checkout` flow (open shift → SKU with stock → checkout) and asserts the job lands on `auto:dev_sunmi:*`. Still **not verified against a live printer or a live bank webhook**.
- Deployment impact: VPS server **and** phone APK. The printing and reference fixes are both server-side plus app-side; deploying only one leaves the bug.
- Rollback plan: revert the listed files; republish build 30.

## 2026-08-01 Phone build 30: printing regression, settings that never saved, header Save button, scan-to-cart

- Summary: Two silent data-loss defects and one printing defect, all of the same shape — the code reported success while doing nothing.
- **"Đã thu tiền, nhưng chưa in được" while test print worked.** A handheld POS prints on a built-in printer nobody has configured a route for, so the receipt goes to an *implicit* route `auto:<device>:<printer>`. That route is not in `print_config`, so `printerById()` never finds it. The queue scanner and `resolveAgentJobFast` already knew to rebuild it — `dispatchJob()` (the path `/print/jobs/:id/print` uses, which the app calls right after payment) did not, so it threw `Chưa cấu hình tuyến máy in auto:…`. Test print was unaffected because it always picks from *configured* routes. Whether the message appeared was a race with the agent's 1.5s poll, which is why build 28 looked fine and 29 looked broken with no code change between them. Fixed in `dispatchJob` and `resolveAgentJob`; `print-now-implicit-route.test.mjs` pins it (verified failing before the fix).
- **"In lại bill" in Hóa đơn did nothing.** It called `forcePrintReceiptJob`, which by design returns success as soon as the existing job is `printed` — correct right after payment, wrong for a reprint button: it reported "Đã gửi lệnh in lại" and no paper came out. Reprint now goes through `POST /print/jobs/:id/reprint`, which creates a new job.
- **Settings in "Thiết lập bán hàng" were never saved.** The screen posts `sell_config` to `/api/settings/app`, but the server had no such key anywhere in the repo — `updateSettings` only writes whitelisted keys, so the request returned 200 and reopening showed defaults. Reads were broken the same way as `notification_routing_config` (raw value is a JSON string, so the client's `is Map` check always failed). Added `settings/sell.js` with defaults + sanitizing, merged writes so posting one switch does not reset the others, and canonicalised `default_method` to the system's four keys (the app was sending `transfer`/`qr`/`card`, which nothing else uses).
- **Save button in the header.** Phone settings screens now show a "Lưu" button at the top right *only when something changed*, mark the subtitle "Có thay đổi chưa lưu", and ask before leaving with unsaved edits (`PhoneSaveAction`, `PhoneUnsavedGuard`). Applied to Thiết lập bán hàng, Cấu hình thông báo, Mẫu bill, Kho & kênh bán, and the warehouse form. Screens that used to fire a request on every toggle no longer do; device-local habits (beep, vibrate) still save instantly since they are per-device and reversible.
- **Scan from the retail search box.** The magnifier is replaced by a QR/barcode button (40x40 touch target). Scanning looks the code up via `/api/skus/barcode/:code` and adds it straight to the cart; unknown codes fall back to a text search instead of a dead end.
- **Test defect fixed in passing**: the two settings-persistence tests set `DB_PATH`, which nothing reads — the real variable is `SQLITE_PATH`. They ran against the local dev database, so they passed once and failed on the second run. Both now use a temp DB; the two junk rows they wrote to `runtime/server-data/store.db` were deleted.
- Files changed: `server/services/printing.js`, `server/services/settings/{sell.js (new),core.js,shared.js}`, `server/{print-now-implicit-route,sell-config-persist,notification-routing-persist}.test.mjs`, `flutter-apps/dandpak_core/lib/src/services/api/printing_api.dart`, `screens/phone/{phone_kit,phone_sell_screen,phone_sell_settings_screen,phone_settings_panels,phone_bill_template_screen,phone_catalog_screens}.dart`, `flutter-apps/dandpak_phone/lib/app_version.dart` (build 30).
- Database / API contract impact: `sell_config` starts being stored. No schema change.
- Manual tests: server 158 pass, Flutter 77 pass, `dart analyze` clean on both packages. The printing fix is verified against tests only — **not against a live printer**.
- Deployment impact: phone APK (build 30) **and** the VPS server. The printing fix is server-side: publishing only the APK will not fix "chưa in được".
- Rollback plan: revert the listed files; republish build 28.

## 2026-08-01 Phone build 28: shift control, customer & voucher, QR payment, four native settings screens

- Summary: The handheld POS could not open its own shift, could not attach a customer, had no QR transfer flow, and four Settings entries were desktop panels squeezed into a phone frame. Build 28 closes all of it plus the three items carried as debt (price-book picker, K57 paper, four panels).
- **Shift open/close on the phone** (`phone_shift_screen.dart`, new). Uses the desktop's own path — `PosProvider.openShiftCounts` / `closeShiftCounts` → `POST /api/shifts/open|close` — so phone and desktop share one shift, one drawer, one report. Shift names come from `operations_config.shifts.labels` (branch settings), not a hardcoded list. Entry points: red banner on the sell screen, header button, payment step, and *Nhiều hơn → Ca & két tiền*. Closing a shift logs the device out, matching desktop.
- **Customer on the retail order** (`phone_customer_screen.dart`, new). Server-side search (`GET /api/customers?q=`) rather than filtering a preloaded page — the same defect already fixed on desktop. Customer perk is computed with `RetailCustomer.perkAmount` in the same order the server applies it (order voucher → customer perk), so the displayed total matches what checkout charges. Add-customer form exposes only fields `upsertCustomer` actually persists.
- **Cart totals completed**: customer row, voucher/CTKM row, subtotal, order discount, customer perk, and a "trong đó VAT" line using desktop's proportional allocation formula. VAT is inside the price, so it is a breakdown line and is not added to the total.
- **QR transfer payment**: payment tabs now come from `operations_config.payment.methods` (a branch that disables a method no longer shows it). Choosing the transfer tab creates a real draft order so the bank webhook can auto-close the bill, then renders the QR from `POST /api/payment-qr`. Screen shows the code and the amount only. Manual confirm is withheld for 25s so an early tap cannot close the bill ahead of the webhook. Settlement of a draft goes through `payOrder`, not `retailCheckout` — calling checkout again on the same `client_request_id` returns "checkout chưa hoàn tất". Leaving the payment step voids the draft; if the server refuses (money already arrived) the screen stays put and says so.
- **Printer auto-detect** now also queries `/api/settings/system/printers?force=1` and filters by this device's `x-device-id`. `/api/print/printers` only returns *configured* routes, so on a machine with a printer plugged in but nothing configured the picker was permanently empty and manual typing was the only option. The arrow button is always present, on phone and in desktop Settings → Kết nối.
- **Debt cleared**: (1) price-book picker read `retail_config.standalone.price_list_name`, a key that does not exist — the real key is `price_book_id`, so the field always read "Chưa chọn" and did nothing; it now lists `/api/warehouse/price-books` and writes the key the pricing engine reads. (2) `Mẫu bill` screen (new) sets paper K57/K80 plus header/footer text with a monospace preview at the true character width — the Sunmi V2 prints 57mm while the system default is K80, and the drag-and-drop designer is desktop-only. (3) The four wrapped desktop panels (Kho & kênh bán, Cấu hình bàn, Cấu hình thông báo, Chi nhánh) are now native phone screens calling the same APIs with the same manager-PIN rules.
- **Server defect found while porting**: `notification_routing_config` was never persisted. Settings posted it to `/api/settings/app`, `updateSettings` only writes whitelisted keys and this was not one, so the request returned 200, the UI said "Đã lưu", and reopening showed defaults. Reads were broken too — the raw value is a JSON string, so the client's `is Map` check always failed. Added a parsing getter and a merging writer (posting only `roles` keeps `overrides`).
- Files changed: `flutter-apps/dandpak_core/lib/src/screens/phone/*` (4 new: shift, customer, bill template, settings panels), `phone_sell_screen.dart`, `phone_shell.dart`, `phone_kit.dart`, `phone_scaffolds.dart`, `phone_settings_screen.dart`, `phone_sell_settings_screen.dart`, `phone_printer_setup.dart`, `phone_printers_screen.dart`, `phone_overview_screens.dart`, `screens/management/settings_connections_panel.dart`, `server/services/settings/notifications.js`, `server/services/settings/core.js`, `server/notification-routing-persist.test.mjs` (new), `flutter-apps/dandpak_phone/lib/app_version.dart` (build 28).
- Database / API contract impact: none new. `notification_routing_config` starts being stored where it previously was not.
- Manual tests: `dart analyze` clean on `dandpak_core` and `dandpak_phone`; server tests pass including the new routing-persistence test. **Not exercised against real hardware**: QR payment end-to-end with a live bank webhook, and shift close on a branch with pending e-invoices.
- Deployment impact: phone APK (build 28) **and** the VPS server — notification routing will not persist until the server is deployed. Everything else works with the current server.
- Rollback plan: revert the listed files; republish build 27.

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
