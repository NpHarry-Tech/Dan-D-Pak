# POS Incident Dossier — 2026-09-04

> Forensic record for the multi-symptom POS incident. **No production or Shopee
> Review deployment, DB mutation, credential run, or build was performed for this
> investigation.** All conclusions are backed by file:line, a runtime test, or a
> measured timing. No secrets/PII are stored in this folder.

## Final local close-out (2026-09-05; authoritative)

All source changes requested by the incident brief are complete and committed locally.
The final dependency graph and application source passed the canonical server runner
(**143/143 files, 726 assertions, 0 fail/timeout/error**), Flutter core tests
(**251 pass, 1 explicitly gated E2E skip, 0 fail**) and analysis of all four Flutter
packages (**0 issues**). Production dependencies report **0 vulnerabilities**.

The final `/api/shifts/current` service benchmark at 2,000 bills and 100 iterations is
p50 19.982 ms, p95 23.042 ms, p99 23.672 ms, max 26.467 ms. The real loopback HTTP
server p95 is 24.947 ms (client p95 27.325 ms), with separate ingress/auth/DB/serialize
evidence. Payload is 61,786 bytes with 200 bill details and total count 2,000. See
`final-gate-evidence.md` for the exact evidence index and remaining external boundaries.

Local completion does not authorize a deploy. Production/Review DB restore, real
printer/display/device validation, Windows executable launch, credentialed Haravan/chat
and Firebase provider calls remain **NEEDS-LIVE-CANARY** or **BLOCKED-EXTERNAL**. No
installer/build/deploy, credential use, or real DB mutation occurred.

## 0. Preflight (verified, read-only)

| Item | Reported | Verified | Match |
|---|---|---|---|
| Repo | `D:/Dan D Pak` | `D:/Dan D Pak` | ✓ |
| Branch | `fix/universal-print-validation` | same | ✓ |
| Reviewed checkpoint | `add0b75` | `add0b75ed9dc8711eb7190e07c33690e7ea2f2ba` (verified at re-entry) | ✓ |
| HEAD (after review commits) | — | `62461ea` (+ concurrency-proof, risk-1B, print-state, comment fixes) | ✓ |
| Worktree | clean | clean (`git status --porcelain` empty) | ✓ |
| Upstream | — | live remote `fd4faee` (`git ls-remote`); **19 local commits ahead, NOT pushed** | ✓ |
| Worktrees | single | single (`git worktree list`) | ✓ |

No `AGENTS.md` exists in the repo (searched to depth 3, `.agents/` is empty).
Architecture guidance lives in `docs/` (ARCHITECTURE.md, MODULE_MAP.md, REPO_STRUCTURE.md, DATABASE_SCHEMA.md).

## 1. Runtime facts (measured on this machine, not inferred)

- **Node**: `v24.14.1`
- **SQLite**: `3.51.2` via **`node:sqlite`** (experimental) — confirmed at runtime
  (`SELECT sqlite_version()`), not from a CLI.
- **Relevance to the brief's WAL/reset warning**: the runtime version is a fact,
  not proof that application-level transaction ordering is safe. No dependency
  change was made; the payment paths were verified with two real server processes.
- **Test runner**: Node built-in `node:test` (`.test.mjs`), each suite boots an
  isolated temp DB via `SQLITE_PATH`. Reporter prints `ℹ pass/fail`, not `# tests`.
- **Flutter**: `3.44.4` stable; Dart present; `flutter-apps/dandpak_core/test/`
  holds a real Dart suite → client fixes are verifiable here.

## 2. Headline conclusion (the thing that changes what we do next)

The conditional close/idempotency guards were present, but the original conclusion
"deploy gap only" was too strong. Source inspection plus fault injection found a
real P0 ordering defect: payment/order/inventory/e-invoice activity, realtime and
filesystem callbacks could run before the owning transaction committed; legacy
`audit()` also swallowed a required SQLite audit failure. The payment could then
roll back while observers had already seen success.

The affected paths now insert required audit rows inside the transaction and stage
archive, realtime, push, print and customer/e-invoice filesystem work until after
`COMMIT`. A failed required audit rolls back order/payment/table/stock/outbox with no
success event. This is a source fix, not merely a redeploy recommendation.

Evidence (all in `server/services/payments.js` `payOrder`, and the F&B client):

| Invariant demanded by the brief | Where it already lives |
|---|---|
| Server is source of truth; client success not blindly optimistic | client clears table only when `receipt['fully_settled'] != false` — [pos_provider.dart:658](../../../flutter-apps/dandpak_core/lib/src/providers/pos_provider.dart#L658) |
| High-entropy idempotency key, survives timeout/retry/restart | persistent `paymentOperationId` — [pos_provider.dart:633-651](../../../flutter-apps/dandpak_core/lib/src/providers/pos_provider.dart#L633-L651); server replay guard — [payments.js:465-486](../../../server/services/payments.js#L465-L486) |
| Single SQLite tx: validate payable + version, transition, write tender, close, relink table | `BEGIN IMMEDIATE` … `COMMIT` — [payments.js:457-724](../../../server/services/payments.js#L457-L724) |
| Conditional close prevents race, not just UI disable | `UPDATE orders SET status='paid' WHERE … status IN ('open','partially_paid')` + `upd.changes===0` guard — [payments.js:588-592](../../../server/services/payments.js#L588-L592) |
| Retry after post-commit timeout returns same result, no second charge | idempotent replay returns canonical receipt — [payments.js:466-484](../../../server/services/payments.js#L466-L484) |
| Paid/closed order immutable | `order.status !== 'open'` → throw — [payments.js:491](../../../server/services/payments.js#L491) |
| Table state reconciled from authoritative open orders | `stillOpen` check → set busy/free inside tx — [payments.js:643-649](../../../server/services/payments.js#L643-L649) |
| Printing is a durable outbox side-effect, NOT in the money tx | `enqueueReceiptPrint` row in tx; `processReceiptPrintOutbox` after commit — [payments.js:675, 748-758](../../../server/services/payments.js#L675) |
| One canonical sale snapshot per payment | `sale_snapshots` insert in tx — [payments.js:669-674](../../../server/services/payments.js#L669-L674) |
| No duplicate open orders per table | `BEGIN IMMEDIATE` + `getOpenOrderForTable` reuse — [orders.js:191-228](../../../server/services/orders.js#L191-L228) |

**Baseline P0 suites run this session (each isolated temp DB, Node 24 / SQLite 3.51.2):**

| Suite | tests | pass | fail |
|---|---|---|---|
| `table-stuck-paid-reset` | 4 | 4 | 0 |
| `so-bill-cap-khi-thanh-toan` | 7 | 7 | 0 |
| `idempotency-chong-trung-don` | 7 | 7 | 0 |
| `retail-double-checkout` | 2 | 2 | 0 |
| `retail-checkout-lock` | 7 | 7 | 0 |
| `table-reset` | 4 | 4 | 0 |
| `fnb-double-pay-guard` *(fault injection included)* | 5 | 5 | 0 |
| `payment-concurrency-http.integration` *(2 server processes, 150 requests)* | 3 | 3 | 0 |
| printing regression group | 39 | 39 | 0 |

## 3. Status ledger — what was landed this branch vs. what remains

All work below is committed on `fix/universal-print-validation` (local, **NOT pushed**).
Status vocabulary (used consistently across all four dossier files):

- **VERIFIED (source)** — code fix + a runtime test that was actually run this session at
  the right layer. Not the same as production-verified.
- **PARTIAL** — only part of the fix landed, or the right-layer test is missing.
- **BLOCKED-EXTERNAL** — needs a real credential/provider/dev-store to finish.
- **NEEDS-LIVE-CANARY** — local/source green, but never exercised on production hardware.
- **NOT RUN** — implemented but the required verification (e.g. Windows build) has not run.

> Everything here is at most **VERIFIED (source)** — none has had a production canary, so
> the whole branch is collectively **NEEDS-LIVE-CANARY** before any deploy. No "FIXED"
> label is used bare.

| Sym | Symptom | Status | Evidence (runtime test) |
|---|---|---|---|
| S1 | Self-order bell keeps ringing after confirm | **VERIFIED (source)** — key-based ring dedup + clear on the confirm/reject re-emit | `ring_controller_dedup_test.dart` 7/7 (unit) |
| S2 | "Checkout success but no bill" / silent print loss | **VERIFIED (source)** — shared finite receipt tracker/banner for F&B and Retail; truthful pending/printed/failed reconciliation; stale/scope/dispose safety; permissioned audited reprint | receipt tracker 6/6; reprint API; server receipt/print suites |
| S3 | Double charge / stuck table / pre-commit side effects | **VERIFIED (source)** — transactional required-audit + post-commit staging + explicit 409 `ORDER_ALREADY_PAID` | fault-injection 6/6; **two-process HTTP 4/4** |
| S4 | `item.cancel` opaque id | **VERIFIED (source)** — món snapshot in audit | `audit-item-cancel-snapshot.test.mjs` 2/2 |
| S5 | `/api/shifts/current` 4.7–28.7 s pile-ups | **VERIFIED (source)** — scoped GET coalescing, payload cap and throttled session touch; measured HTTP server p95 24.947 ms and client-loopback p95 27.325 ms at 2,000 bills | `get_coalesce_test.dart`; `request-timing.test.mjs`; final ingress benchmark |
| S6 | "Kết ca" stacked calls/modals | **VERIFIED (source)** — route/dialog singleton, provider single-flight, mounted/scope cleanup and conditional server close | shift singleton suites; `shift-close-idempotency.test.mjs` |
| S7 | Multiple Desktop instances | **VERIFIED (source)** / **NEEDS-LIVE-CANARY** — hardened named mutex/focus/flash contract; executable launch requires the prohibited build step | `windows-single-instance-contract.test.mjs` 3/3 |
| S8 | Import "633 billion" | **VERIFIED** — non-positional header mapping + golden reported SKUs + CSV/XLSX typing/locale + archive/retry/transaction rollback | import Flutter 21/21 · `inventory-transaction.test.mjs` 14/14 |
| S9 | Floor plan clipped / ratio drift | **VERIFIED (source)** — canonical grid/viewport transform and responsive widget coverage across desktop/tablet/aspect/DPI | floor/layout focused tests 20/20 |
| S12 | Chat blank "Chưa có hội thoại" | **VERIFIED (source)** / **BLOCKED-EXTERNAL** — truthful taxonomy, branch isolation, locked dedupe and bounded HTTPS attachments; real provider E2E needs credentials | chat UI + Omni fake/two-process suites |
| S13 | Haravan subscribe fails opaquely | **VERIFIED (source)** / **BLOCKED-EXTERNAL** — structured redacted diagnostics and fake-provider contracts; real subscribe needs dev-store credentials | Haravan suites |

**Additional completed systemic gates:** S10 sell-first launcher and route/role parity,
S11 aspect-safe thumbnails plus content-addressed immutable uploads, replayable realtime
envelopes for central broadcasts, atomic ~245 ms fresh migration, and the complete
versioned/rotating AES-256-GCM Secret Vault are all **VERIFIED (source)**. Their physical,
credentialed and production-copy checks remain explicitly isolated in
`final-gate-evidence.md`.

## 4. Files in this dossier

- `README.md` — this file (summary, preflight, runtime, headline conclusion).
- `hypothesis-matrix.md` — per-symptom hypothesis / evidence / verdict / falsification.
- `baseline-and-runtime.md` — commands run, raw measurements, test outputs.
- `remediation-plan.md` — ordered, rollback-aware plan; three separate rollout groups.

## 5. Standing constraints honored

Production **HOLD**, Shopee Review **HOLD**, reviewer least-privilege at `fd4faee`
left intact, no deploy/DB mutation/credential run/build performed. External
connector (Haravan/chat) E2E remains **BLOCKED** pending credentials — see
`hypothesis-matrix.md`.

## 6. Continuation session (reviewing checkpoint `add0b75`)

**5-risk review of `add0b75` — all closed, each with a runtime test:**
1. post-commit side-effect failure → `fnb-double-pay-guard` realtime-throw test (6/6).
2. shared-DB two-process test → same-absolute-path + both-processes-served proofs
   (`payment-concurrency-http.integration` 4/4).
3. print state machine canonical → `print-state-machine` (6/6) + stale `'sent'` comment fixed.
4. claimed-job lease recovery → 60 s reclaim proven (same suite).
5. dossier contradictions → reconciled to HEAD + standardized status vocabulary.

**Full regression gate — VERIFIED (source), this session:**
- Server: **132/132 files, 688 tests, 0 fail, 0 timeout** (isolated per-file runner).
- Flutter test dandpak_core: **216 passed, 1 skipped, 0 fail**.
- `flutter analyze` **4/4 packages clean**.
- **Regression caught + fixed:** last session's S5 `getJson(coalesce:)` broke ~13 fake-API
  overrides — reverted to a non-breaking `getJsonCoalesced`; analyze clean.
- Static gates (pipefail + explicit emptiness): diff-check / conflict-marker / secret-diff
  all **PASS** (regex-on-diff only — **not** a comprehensive scan; no gitleaks/trufflehog
  installed). No orphan test processes (2 `node` = MCP servers).

**Continuation gates (2026-09-05):**
- Import mapping now has actual runtime-generated golden XLSX coverage; printing status
  reconciliation/banner, close-shift route singleton, rotating Secret Vault, atomic
  migration and the 1.5 s scoped refresh buffer are implemented and focused-tested.
- GET coalescing now normalizes query ordering, separates representation variants, and
  measures 20 callers → 1 request. Debounce + GET focused tests: **11/11 pass**.
- External/physical proof remains explicit: CRM/chat provider E2E, credentialed Haravan,
  production-sized restore and real printer/display/device canaries.

Historical intermediate snapshots are available in Git history. They are intentionally
not repeated here because every locally actionable gap they listed has since closed.
The final HEAD/ahead count is recorded after the last clean-boundary verification.
