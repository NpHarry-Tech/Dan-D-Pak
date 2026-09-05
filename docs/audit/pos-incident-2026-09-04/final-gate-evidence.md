# Final Gate Evidence — 2026-09-05

Scope: local source and isolated temporary databases on `fix/universal-print-validation`.
No production/Review deployment, installer build, credentialed provider call, or real
database mutation was performed.

## Results

| Gate | Status | Result | Evidence / command |
|---|---|---|---|
| Server full regression (`ac56e24`) | **VERIFIED (source)** | 143/143 files; 726 pass; 0 fail/timeout/error; 1,265.3 s | `final-server-test.log`; `TEST_TIMEOUT_MS=240000 TEST_CONCURRENCY=1 node scripts/run-backend-tests.mjs` |
| Flutter core tests | **VERIFIED (source)** | 251 pass; 0 fail; 1 E2E-only skip; 152.8 s | `final-flutter-test.log`; `flutter test` in `flutter-apps/dandpak_core` |
| Flutter static analysis | **VERIFIED (source)** | core, desktop, tablet, phone: 0 issues | `final-flutter-analyze.log` |
| Production dependency audit | **VERIFIED (source)** | 9 moderate before; 0 after; 0 high/critical in either snapshot | `final-npm-audit-before.json`; `final-npm-audit-after.json`; `npm audit --omit=dev` |
| Shift-current benchmark | **VERIFIED (source)** | 2,000 bills / 100 iterations: p50 19.982, p95 23.042, p99 23.672, max 26.467 ms; 61,786 bytes | `final-performance-benchmark.json`; `node scripts/benchmark-shift-current.mjs 2000 100` |
| HTTP ingress phase benchmark | **VERIFIED (source)** | server p95 24.947 ms; ingress/auth/DB/serialize p95 0.056/0.353/24.040/0.366 ms; client-loopback p95 27.325 ms | `final-ingress-benchmark.json`; `node scripts/benchmark-shift-http.mjs 2000 100` |
| Asset cold/warm benchmark | **VERIFIED (source)** | 256 KiB cold-200 p95 8.691 ms; warm ETag/304 p95 0.702 ms | `final-assets-benchmark.json`; `node scripts/benchmark-assets-cache.mjs` |
| Secret scan | **VERIFIED (source)** | no server/private credential found; two PEM markers are fake fixtures; tracked Firebase Android client keys are public client config, with live restrictions not inspected | repository scan; `security-inventory.md` |
| Transaction/migration recovery | **VERIFIED (source)** | atomic rollback, WAL recovery, backup and contention suites included in the checkpoint matrix | server matrix and `baseline-and-runtime.md` |

The independent release review after `ac56e24` replaced event-loop commit inference with
a connection-owned BEGIN/COMMIT/SAVEPOINT lifecycle. Focused tests cover a transaction
held across multiple ticks, rollback, commit-once, savepoint rollback, outer rollback
after inner release, callback failure, and cash-drawer archival. It also enforces
active-v2 secret writes, production/review key separation at startup, tracked Aevum
hooks, and isolated release artifact paths with embedded-backend verification. Exact
final-HEAD totals are reported only after the final commit.

The single Flutter skip is the AppUpdater download E2E that requires a local release
server on port 3000, release build 2 and `--dart-define=E2E=true`. It is an explicitly
environment-gated integration check, not a failed or silently skipped unit contract.

Timing headers and generated correlation IDs are available only when
`REQUEST_TIMING_DIAGNOSTICS=1`; they are disabled by default and therefore do not expose
internal phase timing in production.

## External boundaries

| Boundary | Status | Required next authority/evidence |
|---|---|---|
| Production/Review DB backup, restore, migration and host-load timing | **NEEDS-LIVE-CANARY** | approved isolated copy and operational rollback window |
| Physical printer, customer display, multi-device disconnect/reconnect | **NEEDS-LIVE-CANARY** | target hardware/network canary |
| Windows packaged executable singleton/focus behavior | **NEEDS-LIVE-CANARY** | authorized Windows build and launch test |
| Haravan/chat real ingest, subscribe and send | **BLOCKED-EXTERNAL** | dev-store/provider credentials |
| Firebase/Storage real provider call | **BLOCKED-EXTERNAL** | approved non-production credential/project |
| Production or Shopee Review deployment | **BLOCKED-EXTERNAL** | explicit deployment authorization; both remain HOLD |

## Repository hook

The Aevum session/config remains correctly machine-local and ignored. The executable
entrypoint is now repo-owned at `.githooks/pre-commit` + `pre-commit.cjs`, compatible
with this ESM package, and enabled through `core.hooksPath=.githooks`. Hook bypass is not
part of the release workflow.
