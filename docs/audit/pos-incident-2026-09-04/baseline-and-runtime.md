# Baseline, Runtime & Measurements — 2026-09-04

Raw record of what was run and measured this session. All read-only except the
Gate-2 code change (`ring_controller.dart`, `socket_service.dart`) and its test.

## Git preflight (read-only)
```
HEAD    = 5839151e924e13ec70869568860ce4965365f61e (continuation preflight)
branch  = fix/universal-print-validation
status  = clean (git status --porcelain → empty)
upstream= origin/fix/universal-print-validation ; 15 ahead / 0 behind (cached)
worktree= single (D:/Dan D Pak)
remote  = https://github.com/NpHarry-Tech/Dan-D-Pak.git
```

## Runtime (measured on this machine)
- `node --version` → **v24.14.1**
- `SELECT sqlite_version()` via `node:sqlite` → **3.51.2** (experimental binding)
- Flutter → **3.44.4** stable; Dart present
- DB layer: `server/db/connection.js` (facade `server/db.js`), heavy concerns in `server/db/*`

### Startup cost (import probe, isolated temp DB)
```
db.js imported     : ~205 ms
migrate()          : ~11,557 ms   ← 11.5 s on a FRESH empty DB
services/orders.js : ~15,082 ms total to first service import
```
**Interpretation:** startup-only cost, not per-request; but 11.5 s for a fresh-DB
migration is worth profiling (many `addColumnIfMissing`/index/ANALYZE steps are the
usual suspects). This also explains why the isolated `.test.mjs` suites each take
~15–20 s wall-clock (they pay the migrate cost per process). NOT a fix target yet —
profile before touching.

## Gate-0 baseline test runs (P0 / money-critical, current source `fd4faee`)
Each suite boots its own temp DB; run with `node --test server/<name>.test.mjs`.
Reporter lines are `ℹ pass` / `ℹ fail` (not `# tests`).

| Suite | tests | pass | fail |
|---|---|---|---|
| `table-stuck-paid-reset` | 4 | 4 | 0 |
| `so-bill-cap-khi-thanh-toan` | 7 | 7 | 0 |
| `idempotency-chong-trung-don` | 7 | 7 | 0 |
| `retail-double-checkout` | 2 | 2 | 0 |
| `retail-checkout-lock` | 7 | 7 | 0 |
| `table-reset` | 4 | 4 | 0 |
| `payment-intent-state-machine` | 3 | 3 | 0 |
| `receipt-print-status` | 1 | 1 | 0 |
| `shift-report-bill-cap` | 3 | 3 | 0 |
| `shift-query-batching` | 4 | 4 | 0 |

These cover: no-erase of a paid-but-empty bill + refund exit; bill-number capping at
payment; anti-double-order idempotency; retail double-checkout lock; table reset;
staff-call close on reset. **All green.**

## P0 hardening evidence after baseline

| Run | Assertions | Pass | Fail |
|---|---:|---:|---:|
| Atomic payment + Retail audit fault injection | 5 | 5 | 0 |
| Two-process HTTP concurrency (50 same-key F&B, 50 different-key F&B, 50 Retail retries) | 3 | 3 | 0 |
| Payment/inventory/Retail focused regression | 33 | 33 | 0 |
| Printing routing/queue/status regression | 39 | 39 | 0 |

One first concurrency harness run returned `401` on process B because the harness
incorrectly reused process A's in-memory session. After logging in independently to
both processes, F&B passed; one subsequent Retail run saw a transient `ECONNRESET`.
The harness was instrumented to retain child output and the complete suite then
passed twice at the business assertion level, including the final post-refactor run.

> NOT a full regression. The complete server suite (~130 `.test.mjs`) and the Flutter
> analyze across 4 packages were NOT run to completion this session (each server suite
> ≈15–20 s ⇒ the full set is long). Do not report "all green" until the full runner
> exits 0. See remediation for the gate.

## Gate-2 fix verification (this branch)
```
flutter test test/ring_controller_dedup_test.dart   → 7/7 pass
flutter analyze lib/src/services/ring_controller.dart lib/src/services/socket_service.dart
                                                    → No issues found (37.7s)
```

## Commands used (for reproducibility)
- `git rev-parse HEAD` / `git status --porcelain` / `git worktree list` / `git rev-list --left-right --count HEAD...@{u}`
- runtime sqlite: `node -e "const {DatabaseSync}=require('node:sqlite'); new DatabaseSync(':memory:').prepare('select sqlite_version() v').get()"`
- import probe: dynamic `import(pathToFileURL('server/db.js'))` + `migrate()` with timers
- P0 suites: `node --test server/<name>.test.mjs`
- Dart: `flutter test test/ring_controller_dedup_test.dart`, `flutter analyze <files>`

## Observability gaps found
- Realtime `emit()` has no event id / order version → clients cannot dedup replays
  ([realtime.js:187-202](../../../server/realtime.js#L187-L202)).
- `item.cancel` audit not yet confirmed to carry a món snapshot (name/SKU/qty/table/bill)
  — see hypothesis S4.
- No captured Haravan failure body/status/scope available in-session (S13 blocked).
