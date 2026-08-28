# Whole-system audit — 2026-08-18

## Executive result

The production data-growth incident is contained. The 10-second e-invoice
backfill loop is stopped, payload-less sync rows can no longer grow, and the
known retry noise has been removed after proving a restorable encrypted backup.
The live SQLite database passes `PRAGMA quick_check`.

This audit does **not** claim that the entire product is ready for an unguarded
release. The local worktree contains hundreds of changes from several sessions;
an immutable release must be cut only after the protected-domain test matrix and
hardware acceptance pass against one exact artifact.

## Production evidence

| Check | Result |
|---|---:|
| Encrypted backup | `store-2026-08-18T02-21-10.db.enc` preserved |
| Decrypted size | 768,962,560 bytes |
| Restored backup `quick_check` | `ok` |
| Live DB `quick_check` after cleanup | `ok` |
| Payload-less `sync_queue` rows | 826,968 → 0 |
| Repeated main buyer-backfill activity | 74,536 → 0 |
| Legal buyer audit | 382,573 → 8 (one earliest row per invoice) |
| Zero-value invoice retry errors | 56,559 → 0 |
| Repeated missing-printer warnings | 51,297 → 11 (one branch/day trace) |
| SQLite free pages after logical cleanup | 157,761 / 187,735 |
| Reclaimable bytes | 646,189,056 |
| Daily encrypted backups retained | 22 |
| Server disk after WAL checkpoint | 7.5 GiB free (84% used) |
| Focused backend regression suite | 33/33 pass |

`VACUUM` is intentionally deferred to a maintenance window because it requires
an exclusive write operation. Logical data is already small; the 646 MB is free
pages inside the database file, not live business data.

## Priority ledger

Priority uses `(Impact + Risk) × (6 − Effort)`.

| Rank | Debt | Type | I/R/E | Score | State |
|---:|---|---|---:|---:|---|
| 1 | E-invoice backfill generated audit/outbox every 10 seconds | architecture/data | 5/5/2 | 40 | fixed + deployed |
| 2 | Print checkout treated durable `queued` as a failure | correctness | 5/5/1 | 50 | fixed + regression-tested; requires next desktop artifact |
| 3 | Firebase credential cannot decrypt with the active key | infrastructure/security | 5/5/2 | 40 | diagnosed; service-account must be uploaded again |
| 4 | Real daily backup filename rejected by restore rehearsal | infrastructure | 5/5/1 | 50 | fixed + tested |
| 5 | Settings preview, Windows driver document and history text are separate renderers | architecture | 4/4/5 | 8 | open; migrate to one semantic receipt document |
| 6 | Hard-coded Flutter colors outside the theme layer | UI architecture | 3/3/5 | 6 | audited only; dark mode not requested |
| 7 | Dirty release tree lacks a single artifact fingerprint | release engineering | 5/5/4 | 20 | release blocker |

## Structure and ownership

- Backend route ownership is under `server/modules/*/routes.js`; the scan found
  no duplicate HTTP method/path pair.
- `server/services/*` import reachability found no orphan service module.
- Desktop, tablet and phone are thin shells; shared behavior belongs in
  `flutter-apps/dandpak_core`.
- Runtime data, releases, uploads, backups and generated build trees are not
  source modules and must stay excluded from immutable artifacts.
- No big-bang directory move is recommended while the production worktree is
  dirty. Move only behind import checks and one protected-domain test slice.

## Receipt single-source gap

Current paths are:

1. Windows/GDI physical print: semantic document in
   `server/services/receipt_doc.js`.
2. ESC/POS and print-history text: `renderJobText` in
   `server/services/printing.js`.
3. Settings preview: a Flutter sample renderer in
   `print_template_designer_methods.dart`.

Golden tests protect important item/discount layouts, but three renderers can
still drift. The target is a versioned `ReceiptDocument` DTO produced by the
server from the order snapshot and print configuration. Physical printing,
settings preview and history should be consumers of that same document. Until
that migration is complete, changes to item columns, CTKM, totals, K57/K80 or
offset must update all three consumers and their parity fixtures.

## Data boundaries

- Order lines must be immutable sale-time snapshots: product name, SKU/code,
  unit, unit price, original price, discount/promotion, VAT rate and totals.
- Product/warehouse tables answer “what is true now”; order/invoice snapshots
  answer “what was sold then”. Deleting or repricing a product must not rewrite
  an old bill.
- Product references may be nullable after deletion; snapshot fields may not be
  recomputed from the current catalog when rendering history, accounting or a
  reprint.
- Haravan notification idempotency keys are event-specific:
  `purchase_success:<order_id>` and `invoice_issued:<invoice_id>`.

## Firebase push

The mobile client now retries registration after transient initialization/token
failures instead of permanently marking the process registered too early.
Production has device tokens, but branch `sala` reports Firebase status
`unreadable`: the stored encrypted service-account was written with a different
data-encryption key. This is fail-closed and the secret is not exposed by the
settings API. Recovery requires a fresh Firebase service-account JSON uploaded
through `deploy/set-firebase-key.ps1`, followed by a background-message test on
a real Android device with screen off and app terminated.

## UI theme readiness (audit only)

The shared Flutter library currently contains 2,586 source lines referencing
`Color(0x...)` or `Colors.*` outside `app_theme.dart`, across 116 files. The app
theme declares only `Brightness.light`; there is no semantic `ThemeExtension`.
Dark mode would therefore produce invisible text/actions in multiple screens.
Do not implement dark mode by adding per-screen conditions. First define
semantic roles (surface, raised surface, primary text, muted text, border,
success, warning, destructive, focus) and migrate protected screens in slices.

## External design lessons

- WooCommerce HPOS separates operational order storage from posts and uses a
  declared authoritative store plus synchronization/verification tooling. The
  applicable lesson is explicit data ownership and snapshot boundaries, not a
  literal copy of its schema.
- WooCommerce CRUD/data-store abstractions keep callers away from physical
  tables. Dan D Pak should keep checkout, invoice and reporting code behind
  domain services rather than adding direct SQL in UI-facing routes.
- ToolJet themes centralize semantic values and reusable modules centralize UI
  composition. The applicable lesson is a theme contract and reusable feature
  modules, not introducing ToolJet as a runtime dependency.

## Release gates still required

1. Re-upload and validate Firebase service-account for each active branch.
2. Build one desktop release containing the queued-print fix; test a real
   checkout with the agent online, delayed and offline.
3. Run receipt parity tests for K57/K80, normal/CTKM/combo and kitchen updates.
   The focused print-designer smoke test, Excel/responsive tests and
   payment/queued-print suites pass. The full hardware matrix is still required.
4. Run warehouse import reconciliation fixtures and snapshot/reprice tests.
5. Create one immutable artifact manifest and publish only that exact artifact.
6. Run `VACUUM` only in an announced maintenance window, then repeat backup
   restore rehearsal and `quick_check`.
