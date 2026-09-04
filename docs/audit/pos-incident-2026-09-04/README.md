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
| HEAD | `fd4faee7…eddb5` | `fd4faee7fdd452708a4e0e7dacee6f0c755eddb5` | ✓ |
| Worktree | clean | clean (`git status --porcelain` empty) | ✓ |
| Upstream | — | `origin/fix/universal-print-validation`, 0 ahead / 0 behind | ✓ |
| Worktrees | single | single (`git worktree list`) | ✓ |

No `AGENTS.md` exists in the repo (searched to depth 3, `.agents/` is empty).
Architecture guidance lives in `docs/` (ARCHITECTURE.md, MODULE_MAP.md, REPO_STRUCTURE.md, DATABASE_SCHEMA.md).

## 1. Runtime facts (measured on this machine, not inferred)

- **Node**: `v24.14.1`
- **SQLite**: `3.51.2` via **`node:sqlite`** (experimental) — confirmed at runtime
  (`SELECT sqlite_version()`), not from a CLI.
- **Relevance to the brief's WAL-reset warning**: the old multi-connection
  WAL-reset defect affected much older SQLite builds. **3.51.2 is not affected** —
  no dependency bump is warranted on that basis. (Do NOT panic-upgrade.)
- **Test runner**: Node built-in `node:test` (`.test.mjs`), each suite boots an
  isolated temp DB via `SQLITE_PATH`. Reporter prints `ℹ pass/fail`, not `# tests`.
- **Flutter**: `3.44.4` stable; Dart present; `flutter-apps/dandpak_core/test/`
  holds a real Dart suite → client fixes are verifiable here.

## 2. Headline conclusion (the thing that changes what we do next)

**The F&B/Retail P0 money invariants are already implemented and test-green in
`fd4faee`.** The reported "checkout succeeds, no bill, table stays open, second
payment possible → double charge" behavior **could not be reproduced against
current source** and is contradicted by the code and passing tests below. The most
probable cause of the observed incident is that the **deployed build is older than
current source** (the brief itself notes Review runs `ae8c64d` and production is an
untouched older installer). 

➡️ **The correct P0 remediation is a controlled redeploy of current source after
full regression — not a UI rewrite and not new payment logic.** Rewriting the
checkout now would risk regressing invariants that are currently correct.

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

## 3. Genuine remaining gaps (defects that DO exist in current source)

These are real, reproduced-by-reading (and, where noted, by test) and are the
legitimate targets for code change. See `hypothesis-matrix.md` for the full matrix.

1. **Self-order repeat sound (Gate 2) — REAL → FIXED + TESTED this branch.** Root
   cause: the server's confirm/reject handlers **re-emit `order:pending`** (with a
   `confirmed`/`rejected` field) — [orders.js:430](../../../server/services/orders.js#L430),
   [orders.js:477](../../../server/services/orders.js#L477) — and the client rang on every
   `order:pending`, so *confirming an item fired another ring*. Fixed with a key-based
   `RingController` (dedup + per-key clear + reconcile) and payload-aware wiring in
   `socket_service`. Verified: `flutter test` 7/7 + `flutter analyze` clean. See
   `hypothesis-matrix.md` S1.
2. **`/api/shifts/current` cost + no GET coalescing (Gate 5) — REAL.** Every poll runs
   `shiftReport` (4 payment-scan queries) + `operationDayReport` + drawer summaries —
   O(payments-in-shift) — and the client has no single-flight/coalesce, so rapid
   clicks multiply heavy reads that queue behind the SQLite single writer → the
   4.7–28.7 s pile-ups. Evidence: [shifts.js:108-183](../../../server/services/shifts.js#L108-L183).
3. **Realtime `emit()` carries no event id / order version / dedup token (systemic).**
   [realtime.js:187-202](../../../server/realtime.js#L187-L202). Underlies both the ring
   duplication and any client-side replay-on-reconnect.
4. **`migrate()` ≈ 11.5 s on a fresh DB (startup perf).** Measured this session
   (import probe). Startup-only, but worth profiling — see `baseline-and-runtime.md`.
5. **Excel import "633 billion" (Gate 6) — to be reproduced in the Dart import
   suite.** Symptom points to decimal-comma / column-shift in the client parser
   (`kv_import_*`). Not yet root-caused to a line; tracked as open.

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
