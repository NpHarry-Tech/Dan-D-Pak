# Remediation Plan — POS Incident 2026-09-04

Ordered by risk and evidence. Each item states the invariant, the change, the test,
and the rollback. Three **separate** rollout groups (never conflated): Production,
Shopee Review, External connectors.

## Priority 0 — the money incident is a DEPLOY GAP, not a code gap
The F&B/Retail payment invariants are correct and test-green in `fd4faee`
(see README §2, hypothesis S2/S3). **Do NOT rewrite the checkout.**
- **Action:** after a full regression pass (see "Final gate"), rebuild and redeploy
  current source. The old installers (`1357b57`, `ae8c64d`, `fd4faee`) are *superseded*
  the moment source changed on this branch — mark them superseded, keep backups, do not
  reuse an ambiguous build number.
- **Add one runtime test** (cheap, high value): 20–50 concurrent `payOrder` on a single
  order → assert exactly one payment row, order `paid`, one print outbox row, table free.
  The existing suites cover the pieces but not the concurrency fan-out.
- **Rollback:** redeploy the prior installer (byte-identical backup retained).

## Priority 1 — Self-order repeat sound (Gate 2) — DONE on this branch
- **Invariant:** a sound fires once per *distinct* unhandled self-order event; confirm/
  reject stops it without a manual tap; reconnect/replay never re-rings an acked item.
- **Change:** key-based `RingController` + payload-aware `socket_service` wiring.
- **Test:** `test/ring_controller_dedup_test.dart` (7/7) + analyze clean.
- **Rollback:** revert the two files + delete the test (single commit).
- **Follow-up:** emit stable event id/order version server-side; `reconcile()` the ring
  set on `sync:reconnected` from the floor reload.

## Priority 2 — `/api/shifts/current` latency (Gate 5) — DESIGNED, not yet implemented
- **Root cause:** heavy per-call aggregation ([shifts.js:108-183](../../../server/services/shifts.js#L108-L183))
  × no client GET coalescing × SQLite single-writer contention.
- **Plan (in order, benchmark-gated):**
  1. Instrument duration + query count on the endpoint; split queue/DB/serialize time.
  2. Client: single-flight/coalesce identical in-flight `GET /api/shifts/current`.
  3. Server: consider a short event-driven cache keyed by (branch, shift, last-payment
     version); invalidate on `payment.done`/`shift`/`cash-drawer`. **Benchmark before/after
     on a synthetic near-real DB; target server p95 ≤ 500 ms, no request > 1.5 s. Report
     real numbers if unmet — do not tune the metric.**
- **Do NOT** add indexes blindly or VACUUM/checkpoint production.

## Priority 3 — App-wide single-flight + close-shift idempotency (Gate 3/6-S6) — DESIGNED
- **Invariant:** one click ⇒ one API call, one route/modal; late responses never push a
  route after dispose; mutation endpoints (esp. close-shift) are idempotent/conditional.
- **Plan:** shared `ActionGate`/single-flight keyed by action+entity for checkout,
  open/close shift, save, import, sync, connect, print/reprint. Server: make
  `closeShift` idempotent (idempotency key / conditional close).
- **Test:** 50 close-shift clicks during a delayed response → one call/one modal/one
  closure; retry after failure works once.

## Priority 4 — Desktop single-instance (Gate 3) — NEEDS-REPRO then implement
- Probe `flutter-apps/dandpak_desktop/windows/runner/` for a named OS mutex; if absent,
  add `CreateMutex` + activate/focus-first-instance IPC; second launch focuses & exits.

## Priority 5 — Audit `item.cancel` snapshot (Gate 4) — NEEDS-REPRO then implement
- Ensure the cancel handler writes món name/SKU/qty/table/bill/actor/reason **in the same
  transaction** as the mutation; failures never write a success audit.

## Priority 6 — Excel/CSV import fail-closed + accurate preview (Gate 6) — NEEDS-REPRO
- Reproduce the `633,705,997,308.678` case in `test/kv_import_orchestration_test.dart`
  first; fix decimal/locale + header-based (not positional) mapping; archive→parse→
  validate→preview→confirm→commit; commit callback must not fire on validation failure.

## Priority 7 — Floor plan parity (Gate 7) — NEEDS-REPRO then implement
- One canonical coordinate model from Settings; POS = viewport transform only; golden
  tests at 1366×768 / 1920×1080 / ultrawide / tablet portrait+landscape / DPI.

## Priority 8+ — UX/IA (Gate 9), thumbnails (S11) — AFTER 0–7 are green
- Sell-first IA (Bán hàng / Quản lý) behind a feature flag with route/role parity map;
  do not delete the current launcher until parity tests are 100%.
- Thumbnail centering: constrained box + `BoxFit` per asset + goldens.

## External connectors — separate rollout group, credential-gated
- **Chat (S12):** trace connector→ingest→DB→scope→UI; make the empty-state taxonomy
  explicit (not-configured / empty / loading / auth-error / no-permission / no-data).
  Live E2E **BLOCKED** until provider credentials are supplied.
- **Haravan (S13):** capture one real failure (status/scope/callback/HMAC, tokens
  redacted); compare to Haravan docs; idempotent subscribe reconcile. **BLOCKED** until a
  dev store/token is supplied. Do not assert cause from the modal.

## Final gate (before ANY deploy)
- Full server isolated runner to exit 0 (file/assert/pass/fail/timeout reported).
- Flutter core tests + `flutter analyze` across the 4 packages.
- `git diff --check`, secret scan, migration forward/backward/idempotency, worktree clean,
  `local == tracking == git ls-remote`.
- Only then rebuild Production `b170` and Review `b170-REVIEW` separately; record
  SHA-256/size/manifest commit/dirty=false/schema/signature/backup byte-identity.

## Standing rollout status
- **Production:** HOLD.
- **Shopee Review:** HOLD (still running `ae8c64d`; reviewer least-privilege at `fd4faee`
  intact — do not widen).
- **External (Haravan/chat) E2E:** BLOCKED (no credentials in-session).
