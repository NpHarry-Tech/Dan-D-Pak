# POS Incident Dossier — 2026-09-04

> Forensic record for the multi-symptom POS incident. **No production or Shopee
> Review deployment, DB mutation, credential run, or build was performed for this
> investigation.** All conclusions are backed by file:line, a runtime test, or a
> measured timing. No secrets/PII are stored in this folder.

## 0. Preflight (verified, read-only)

| Item | Reported | Verified | Match |
|---|---|---|---|
| Repo | `D:/Dan D Pak` | `D:/Dan D Pak` | ✓ |
| Branch | `fix/universal-print-validation` | same | ✓ |
| HEAD | continuation checkpoint | `5839151e924e13ec70869568860ce4965365f61e` at preflight | ✓ |
| Worktree | clean | clean (`git status --porcelain` empty) | ✓ |
| Upstream | — | `origin/fix/universal-print-validation`, 15 local commits ahead | ✓ |
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

Every fix below is committed on `fix/universal-print-validation` (local, **not pushed**),
each with a passing test and clean analyze. Full detail per symptom in `hypothesis-matrix.md`.

| Sym | Symptom | Status | Test |
|---|---|---|---|
| S1 | Self-order bell keeps ringing after confirm | **FIXED** — key-based ring dedup + clear on the confirm/reject re-emit ([orders.js:430](../../../server/services/orders.js#L430)/[477](../../../server/services/orders.js#L477)) | `ring_controller_dedup_test.dart` 7/7 |
| S3 | Double charge / stuck table | **SOURCE GAP FOUND + FIXED LOCALLY** — transactional audit/side-effect staging + explicit 409 | fault injection 5/5; two-process HTTP 3/3 |
| S4 | `item.cancel` opaque id | **FIXED** — món snapshot in audit | `audit-item-cancel-snapshot.test.mjs` 2/2 |
| S5 | `/api/shifts/current` 4.7–28.7 s pile-ups | **FIXED** — client coalescing + server payload cap (577 KB→61 KB, −89%; benchmarked, server p95 ≤24 ms so CPU/indexes were never the issue) | `get_coalesce_test.dart` 3/3 · `shift-report-bill-cap.test.mjs` 3/3 |
| S6 | "Kết ca" stacked calls/modals | **Client single-flight FIXED**; UI modal-singleton remains | `shift_single_flight_test.dart` 3/3 |
| S7 | Multiple Desktop instances | **IMPLEMENTED** (named mutex); build-verify at gate | inspection (C++) |
| S8 | Import "633 billion" | **FIXED** — locale parser + fail-closed plausibility guard (blocks implausible cost at commit); header-mapping remains (needs real file) | `kv_parse_num_locale_test.dart` 8/8 · `import_plausibility_test.dart` 4/4 |
| S9 | Floor plan clipped / ratio drift | **FIXED** — fit both dims + center | `floor_cell_size_test.dart` 6/6 |
| S12 | Chat blank "Chưa có hội thoại" | **Empty-state taxonomy FIXED**; live E2E blocked | `chat_empty_state_test.dart` 6/6 |
| S13 | Haravan subscribe fails opaquely | **Structured redacted diagnostics FIXED**; live E2E blocked | `haravan-subscribe-diagnostics.test.mjs` 3/3 |

**Deliberately NOT done (documented, not started):**
- **S2** print-status — **server state semantics DONE + TESTED** (`queued/claimed/printed/pending`,
  never `sent == printed`; `receipt-print-status.test.mjs` 1/1); the remaining piece is the persistent client banner + audited
  reprint at the F&B/retail success points.
- **S10** sell-first launcher IA (Gate 9) — by the brief, only after S1–S9 are green; needs
  a feature/route/role parity map first.
- **S11** settings thumbnail centering — the instance checked (`settings_users_panel`
  avatar) is already correct (`ClipOval` + `BoxFit.cover`); the specific misaligned
  thumbnail was not identified this session.
- Systemic follow-ups: realtime `emit()` has no event id/version
  ([realtime.js:187-202](../../../server/realtime.js#L187-L202)); `migrate()` ≈ 11.5 s
  startup; server-side `/api/shifts/current` benchmark + lighter query.

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
