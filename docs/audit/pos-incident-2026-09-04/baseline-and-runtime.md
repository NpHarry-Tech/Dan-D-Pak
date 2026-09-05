# Baseline, Runtime & Measurements — 2026-09-04

## Final shift-current benchmark (2026-09-05)

Reproducible command: `node scripts/benchmark-shift-current.mjs 2000 100`.
This measures the service path and intentionally excludes HTTP/network serialization.

| Metric | Earlier before-cap baseline | Final verified result |
|---|---:|---:|
| Bills | 2,000 | 2,000 |
| p50 | 19.8 ms | **19.982 ms** |
| p95 | 23.8 ms | **23.042 ms** |
| p99 | 26.4 ms | **23.672 ms** |
| max | not recorded | **26.467 ms** |
| Serialized payload | about 577 KB | **61,786 bytes** |
| Returned bill details / total count | uncapped / 2,000 | **200 / 2,000** |

Status: **VERIFIED (source)** on Win32, Node v24.14.1, SQLite 3.51.2. Raw evidence is
`final-performance-benchmark.json`. This does not substitute for production disk,
network, concurrency and host-load canaries, which remain **NEEDS-LIVE-CANARY**.

## Gate 4 database measurements (continuation 2026-09-05)

All measurements below used isolated temporary SQLite files; no production or
review database was opened, copied, checkpointed, migrated, or modified.

| Probe | Result |
|---|---|
| Fresh import | 259 ms |
| Fresh canonical migration, before atomic batching | 24,067 ms |
| Fresh canonical migration, after atomic batching | **245 ms** |
| First `services/orders.js` import, total from process start | 7,414 ms |
| Two-process writer contention (700 ms held lock) | second writer succeeded after 970–1,580 ms; 2/2 rows, no leaked `SQLITE_BUSY` |
| Online encrypted backup (8 MiB payload) | concurrent write succeeded; 28–88 heartbeat ticks; worst observed event-loop gap 281.7 ms |
| WAL checkpoint with active reader | PASS; 2,100/2,100 rows; final TRUNCATE not busy |
| Forced process abort inside transaction | committed row survived; uncommitted row absent; `integrity_check=ok` |
| Hot query plans | history, invoice, and shift queries use their measured composite indexes |

The startup fix wraps the rerunnable schema migration in one `BEGIN IMMEDIATE`
transaction, including DDL and the final `schema_meta` marker. A late injected
constraint failure proves the whole migration rolls back (no half-created
`branches` table and `user_version` remains 0). Runtime remains
`synchronous=FULL`; the speed-up does not weaken money/inventory durability.

Reproducible suite: `node --test server/database-legacy-migration.test.mjs
server/database-contention-recovery.test.mjs server/database-online-backup.test.mjs
server/database-hot-query-plan.test.mjs` → **9 pass, 0 fail**.

Production-sized database timing, real host disk latency, operational restore,
and production/review DB validation remain **NEEDS-LIVE-CANARY**. A local temp-DB
result is not represented as proof about those external environments.

## Earlier baseline record (2026-09-04)

Raw record of what was run and measured this session. All read-only except the
Gate-2 code change (`ring_controller.dart`, `socket_service.dart`) and its test.

## Git preflight (read-only)
```
reviewed checkpoint = add0b75ed9dc8711eb7190e07c33690e7ea2f2ba (P0 side-effect staging)
HEAD    = 62461ea (after review commits: concurrency proof, risk-1B, print-state, comment)
branch  = fix/universal-print-validation
status  = clean (git status --porcelain → empty)
upstream= origin/fix/universal-print-validation ; 19 ahead / 0 behind
remote  = fd4faee (git ls-remote — NOT pushed)
worktree= single (D:/Dan D Pak)
```

## Runtime (measured on this machine)
- `node --version` → **v24.14.1**
- `SELECT sqlite_version()` via `node:sqlite` → **3.51.2** (experimental binding)
- Flutter → **3.44.4** stable; Dart present
- DB layer: `server/db/connection.js` (facade `server/db.js`), heavy concerns in `server/db/*`

### Earlier startup cost (superseded by Gate 4 measurement above)
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
