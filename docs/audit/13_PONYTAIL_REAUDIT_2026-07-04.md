# 13 - PONYTAIL RE-AUDIT 2026-07-04

Scope: re-check current workspace after previous Pass 1-3 audit, run available tooling, and add a ponytail audit for code/tree simplification. This pass did not change production code because the attached audit rules say: report first, do not edit production before confirmation.

## Executive Summary

Status: not ready to enable real online channels. Counter POS / retail / FnB is close, but the same P1s from Pass 3 are still open in current code.

Blockers before real go-live:

1. Online webhook is not idempotent: `server/services/online.js receive()` always creates a new order, records payment, sets paid, deducts stock, and prints. There is no dedup by `online_ref` and no unique index for `(branch_id, online_channel, online_ref)`.
2. Online return flow is incomplete: `server/services/online.js returnOrder()` only sets `orders.status='void'`; it does not restore stock, reverse/mark payment, or cancel/adjust e-invoice.
3. Two stock receive routes are still public to any visible branch flow: `server/api.js:911` and `server/api.js:924` call `Inv.receiveStock/receiveSku` without `guard('inventory.adjust')`.
4. Integration secrets still round-trip plaintext: `server/services/settings.js getIntegrations()` returns full channel config; `web/admin.html` renders secret fields into password inputs.
5. Payment/online webhook hardening is partial: payOS uses `timingSafeEqual`; SePay/Casso/VietQR/Online still use normal string comparison or optional auth paths.

## Tooling Results

| Check | Result |
| --- | --- |
| `node --check server/index.js; node --check server/api.js; node --check server/services/*.js` | PASS, no syntax output |
| `npm audit --omit=dev` | PASS, 0 vulnerabilities |
| `flutter analyze` in `flutter-apps/dandpak_core` | PASS, 0 issues |
| `flutter analyze` in `flutter-apps/dandpak_pos` | FAIL, 65 analyzer issues |
| `flutter analyze` in `flutter-apps/dandpak_tablet` | FAIL, 24 analyzer issues |
| `flutter analyze` in `flutter-apps/dandpak_kds` | FAIL, 2 analyzer issues |
| `flutter analyze` in `flutter-apps/dandpak_backoffice` | FAIL, 13 analyzer issues |
| `flutter pub outdated --no-dev-dependencies` in POS app | Outdated direct deps: `desktop_multi_window 0.2.1 -> 0.3.0`, `intl 0.19.0 -> 0.20.3`; transitive `js` is discontinued |
| `gitleaks detect --source . --no-git --redact --verbose` | Not run: `gitleaks` not installed |
| `semgrep scan --config auto --error --timeout 30 .` | Not run: `semgrep` not installed |
| `trivy fs --quiet --scanners vuln,secret,misconfig .` | Not run: `trivy` not installed |
| High-confidence source secret regex, excluding `scratch`, runtime storage, binary assets | PASS: no OpenAI/AWS/GCP/JWT/private-key style literal found in source |

Manual tool install commands if needed:

```powershell
winget install Gitleaks.Gitleaks
pipx install semgrep
winget install AquaSecurity.Trivy
```

## Flutter Analyze Triage

`dandpak_pos` has 65 issues. Highest-signal cleanup:

- `flutter-apps/dandpak_pos/lib/screens/kds/kds_screen.dart:7` unused import.
- `flutter-apps/dandpak_pos/lib/screens/kds/kds_screen.dart:36` unused `_events`.
- `flutter-apps/dandpak_pos/lib/screens/management/settings_more_panels.dart:1`, `:4`, `:8`, `:16` unused import/shown name/helper.
- `flutter-apps/dandpak_pos/lib/screens/online/online_screen.dart:6`, `:54` unused import/field.
- `flutter-apps/dandpak_pos/lib/widgets/einvoice_status_view.dart:25` unused `_error`.
- `flutter-apps/dandpak_pos/lib/widgets/window_controls.dart:6` unused import.
- Several `use_build_context_synchronously` findings in `documents_screen.dart`, `expenses_screen.dart`, `invoices_screen.dart`, `payment_dialog.dart`, `pos_screen.dart`.

`dandpak_tablet` has 24 issues. Highest-signal cleanup:

- `flutter-apps/dandpak_tablet/lib/screens/inventory_module/inventory_screen.dart:95` unnecessary cast.
- `flutter-apps/dandpak_tablet/lib/screens/inventory_module/movement_dialog.dart:38` override should call `super`.
- The rest is mostly deprecated `withOpacity` / `value` usage.

`dandpak_kds` and `dandpak_backoffice` are mostly deprecated `withOpacity` / form-field `value` usage.

## Security Re-check

### Confirmed Still Open

SEC-R4-01 P1: stock receive routes lack permission guard.

- Evidence: `server/api.js:911` `api.post('/inventory/:id/receive', wrap(...))`; `server/api.js:924` `api.post('/skus/:id/receive', wrap(...))`.
- Shared service does not compensate: `server/services/inventory.js receiveStock/receiveSku -> receiveGeneric()` has validation but no auth/permission concept.
- Minimal patch after confirmation: add `guard('inventory.adjust')` to both routes.

SEC-R4-02 P1: integration secret response is not masked.

- Evidence: `server/services/settings.js getIntegrations()` returns `sanitizeIntegrations(JSON.parse(row.value))`; `mergeChannel()` copies all defined fields as strings, including `password`, `apiKey`, `checksumKey`, `secretKey`, `webhookSecret`, `clientSecret`.
- UI evidence: `web/admin.html` uses `value="${integVal(c,'password')}"`, `apiKey`, `checksumKey`, `webhookSecret`, `clientSecret`.
- Minimal patch after confirmation: return masked fields to UI and preserve stored secret when client sends mask placeholder.

SEC-R4-03 P1: online webhook fails open when secret missing.

- Evidence: `server/services/online.js assertWebhookSecret()` audits `online.webhook.unverified` then returns when `webhookSecret` is empty.
- Route is public: `server/api.js:1049` `api.post('/online/webhook', wrap(...))`.
- Minimal patch after confirmation: if channel is enabled and no secret is configured, reject with 400/401.

SEC-R4-04 P1/P2: non-payOS webhook comparisons are normal string comparisons.

- Evidence: `server/services/payments.js handleSepayWebhook`, `handleCassoWebhook`, `handleVietqrWebhook`; `server/services/online.js assertWebhookSecret`.
- payOS already does the better thing with `crypto.timingSafeEqual`.
- Minimal patch after confirmation: shared `safeEqual()` helper using `timingSafeEqual`.

SEC-R4-05 P2: auth tokens are stored in browser/local app storage.

- Evidence: `web/shared/client.js` uses `localStorage.setItem('auth_token', r.token)`; Flutter POS and tablet providers use local store/shared preferences; Android WebView enables DOM storage for `auth_token`.
- Risk: acceptable for local POS if devices are locked down, but not hardened for stolen device/shared OS account.
- Minimal patch later: secure storage on Flutter/mobile, short session TTL, device registration/revoke.

SEC-R4-06 P2: runtime data is inside the repo workspace.

- Evidence: `server/permanent-storage` is about 228MB in the workspace.
- Risk: accidental commit/zip/share of real operational payments/orders/staff data.
- Minimal patch: keep runtime data outside source root or hard-ignore concrete storage folders.

## Business Logic Re-check

BL-R4-01 P1: online order duplicate creates double revenue and double stock deduction.

- Evidence: `server/services/online.js receive()` calls `createOrUpdateOrder`, updates `online_ref`, inserts `payments/payment_lines`, sets paid, calls `deductForOrder`, with no existing `online_ref` lookup.
- DB evidence: `server/db.js` has `orders.online_ref` but no unique index for online ref.
- Minimal patch: add lookup and unique index, return existing order on duplicate webhook.

BL-R4-02 P1: online return does not restore stock/payment/invoice state.

- Evidence: `server/services/online.js returnOrder()` only runs `UPDATE orders SET status='void'`.
- Minimal patch: reverse stock lines, mark/reverse online payment line, cancel/adjust e-invoice if issued, all in one transaction.

BL-R4-03 P1: manual confirm can close a transfer payment without a matched bank transaction.

- Evidence: `server/api.js applyManualConfirm()` accepts `manual_confirm` with self/admin PIN and reason; `bank_tx_id` is optional.
- Existing protection: audit exists and optional `markBankTxClaimed()` exists.
- Minimal patch: manager approval or end-of-shift exception report for manual confirms without `bank_tx_id`.

BL-R4-04 P1/P2: order discount has no cap.

- Evidence: `server/services/payments.js payOrder()` sets `discount` and recalculates `total=MAX(0,subtotal-discount)`.
- Existing protection: `server/api.js` requires `discount` permission.
- Minimal patch: cap by percent/amount and require reason/PIN above threshold.

BL-R4-05 P2: voucher has no redemption ledger.

- Evidence already in Pass 3: `server/services/vouchers.js` is stateless; no `voucher_redemptions` table in `server/db.js`.
- Minimal patch: `voucher_redemptions(voucher_id, order_id UNIQUE, customer_id, created_at)` plus `max_uses`.

## Ponytail Audit Output

delete: runtime data under source tree. Move `server/permanent-storage` out of repo or hard-ignore concrete data folders. [server/permanent-storage]

delete: generated scratch output. Delete or ignore `scratch/` outputs; it is about 44MB and not app code. [scratch]

delete: root screenshots. Move `flutter-*.png` root screenshots to ignored artifacts; they are about 1.3MB. [./flutter-*.png]

yagni: unimplemented provider adapters. Cut stub factories until Postgres/S3/WebSocket are wired. [server/adapters/database/postgres.adapter.js, server/adapters/storage/s3.adapter.js, server/adapters/realtime/websocket.adapter.js]

yagni: planned-but-unimplemented public API routes. Delete 15 `notImplemented()` routes or keep only documented live routes; dead route surface is noise for clients and audits. [server/api.js]

shrink: duplicate API clients. `dandpak_backoffice` has its own `ApiClient`; reuse `dandpak_core` like POS/tablet. [flutter-apps/dandpak_backoffice/lib/main.dart]

shrink: duplicate bundled web assets. `web/assets` and `flutter-apps/dandpak_pos/assets/web/assets` duplicate logos/menu-book files; copy at package/build time instead of storing two sources. [web/assets, flutter-apps/dandpak_pos/assets/web/assets]

stdlib: ad-hoc search scripts can be deleted. `rg -n` replaces `server/find_pin.js` and `web/find_calc.js`. [server/find_pin.js, web/find_calc.js]

shrink: Flutter lint dead code. Remove unused imports/fields flagged by `flutter analyze`; no abstraction needed. [flutter-apps/dandpak_pos/lib/screens/kds/kds_screen.dart, flutter-apps/dandpak_pos/lib/screens/online/online_screen.dart, flutter-apps/dandpak_pos/lib/screens/management/settings_more_panels.dart]

yagni: full Clean Architecture re-folder is premature before P1 fixes. Keep current shape; extract only the payment/webhook/online use cases touched by fixes. [docs/audit/10_CLEAN_ARCHITECTURE_REFACTOR_PLAN.md]

net: about -70 code lines, -0 deps possible, plus about -45MB obvious artifact noise and -228MB runtime data risk if moved out of the source tree.

## Recommended Minimal Fix Order

1. Add guards to the two receive routes.
2. Mask integration secret responses.
3. Make online webhook fail-closed and constant-time.
4. Add online webhook idempotency and DB unique index.
5. Fix online return to reverse stock/payment/invoice in one transaction.
6. Add manual-confirm exception report and discount threshold.
7. Move runtime data/artifacts out of repo; do not delete live data blindly.

## Production Code Change Status

No production code was changed in this pass. Only audit documentation was updated.

