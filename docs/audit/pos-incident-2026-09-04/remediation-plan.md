# Remediation Plan — POS Incident 2026-09-04

## Final local gate (2026-09-05)

- Server canonical isolated runner at `ac56e24`: **VERIFIED (source)** — 143/143 files, 726/726
  assertions, 0 fail, 0 timeout, 0 error on the final dependency lockfile.
- Flutter core: **VERIFIED (source)** — 251 pass, 0 fail, 1 E2E-only skip; analyze is
  clean for core, desktop, tablet and phone.
- Production dependency audit: **VERIFIED (source)** — 0 vulnerabilities after the
  supported Firebase dependency refresh and bounded `qs`/`uuid` overrides.
- Performance: **VERIFIED (source)** — shift-current service p95 23.042 ms; loopback
  HTTP server p95 24.947 ms and client p95 27.325 ms at 2,000 bills. Ingress/auth/DB/
  serialize are measured separately; payload is bounded to 61,786 bytes.
- Deployment/build/live provider/real DB/device validation was not authorized and
  remains **NEEDS-LIVE-CANARY** or **BLOCKED-EXTERNAL**. Production and Review stay HOLD.

The reproducible evidence index is `final-gate-evidence.md`. The ordered sections below
record the original risk sequence; their headings and the continuation status carry the
authoritative completion state.

## Continuation status (2026-09-05)

- Gate 5 is **VERIFIED locally**. Opt-in GET single-flight includes method, base URL,
  branch, auth generation, normalized path/query and an explicit representation variant
  for locale/content-vary cases. Scope changes clear inflight entries; success/error
  completion also removes them. Measured test: 20 callers → 1 request / 19 coalesced.
- Keyed trailing-edge buffering is used only for Online Orders and Omni Chat noisy
  realtime refreshes: 1,500 ms trailing delay, 5,000 ms maximum wait; key = server
  origin + branch + user + stream. It exposes flush/cancel/dispose and counters for
  received, executed, coalesced, cancelled, errors and total latency.
- Fake-clock tests cover exact 1499/1500/1501 ms boundaries, continuous burst,
  final-event render, different keys, logout/branch cancellation, exception and dispose.
  Payment, close-shift, confirmation, inventory and print ACK remain immediate.
- Floor Settings and POS now use one `FloorViewportGeometry`; saved `(pos_x,pos_y)`
  always stays in grid units and only the viewport transform changes. Responsive widget
  tests cover 1366×768, 1920×1080, ultrawide, tablet portrait/landscape and DPI=2;
  focused floor/layout tests are **20/20 pass**.
- Windows runner singleton source is hardened for minimized/hung first windows with
  async restore, foreground attempt and taskbar flash fallback; the display process is
  deliberately exempt. Static runner contract tests are **3/3 pass**. Building/running
  packaged launch remains **NEEDS-LIVE-CANARY** even after an authorized local build.
- Asset/thumbnail source is **VERIFIED locally**: uploads validate JPEG/PNG/WebP/GIF
  magic bytes instead of trusting MIME, return `nosniff`, cache unique upload URLs for
  one year with ETag/304, use SHA-256 content-addressed version keys, and revalidate bundled assets hourly. Settings integration
  logos use one centered aspect-safe contract. Flutter already applies an LRU image-cache
  budget (48 MiB / 300 images on constrained devices) and bounded thumbnail decode sizes;
  no custom persistent disk cache exists. Cold-200 p95 is 8.691 ms and warm-304 p95 is
  0.702 ms for 256 KiB assets. Focused server/UI contracts are green.
- Omni/chat source is **VERIFIED locally**: webhook dedupe acquires the write lock before
  checking and scopes event keys by branch; two real Node processes produce one message.
  Cross-branch reads return no data/404. Attachments are HTTPS-only and bounded (10,
  20MB each, 50MB total). Real provider E2E remains **BLOCKED-EXTERNAL**.
- Haravan fake-provider behavior is **VERIFIED locally**: structured redacted subscribe
  diagnostics, outbound-session persistence, order/product idempotency and truthful
  capability flags. Real dev-store subscribe remains **BLOCKED-EXTERNAL**.
- Sell-first navigation is **VERIFIED locally**: desktop/tablet login presents explicit
  Sales and Management entries with role-aware preference while retaining the complete
  permission-filtered module grid. Phone keeps its dedicated RBAC shell. Inventory and
  preservation evidence is in `feature-preservation-matrix.md`; focused tests **15/15**.
- Realtime systemic hardening is **VERIFIED locally**: every central broadcast carries
  stable event/branch/entity/version metadata; a bounded per-branch journal replays a
  reconnect cursor or explicitly requests full resync after expiry/server restart.
  Flutter rejects duplicate and out-of-order envelopes before notification/ring/state
  listeners, while legacy payloads remain accepted. Server/Dart focused tests **10/10**;
  physical multi-device network interruption remains **NEEDS-LIVE-CANARY**.
- Audit completeness is **VERIFIED locally** for the shared contract and high-risk
  mutation paths: identity/device/branch/request/domain snapshots are centralized,
  secret fields are recursively redacted, transactional audit failures escape and
  roll back stock/expense/payment/order changes, and activity realtime is post-commit.
  Vietnamese detail labels cover the new fields. Focused server checks **20/20** plus
  inventory/retail/shift regression **37/37**; see `audit-completeness-matrix.md`.

Ordered by risk and evidence. Each item states the invariant, the change, the test,
and the rollback. Three **separate** rollout groups (never conflated): Production,
Shopee Review, External connectors.

## Priority 0 — source ordering gap found; fixed and regression-tested locally
The pre-existing conditional close and idempotency constraints were necessary but
not sufficient. Required audit plus realtime/archive/print/customer callbacks crossed
the transaction boundary before commit. The fix stages them and flushes only after
commit; audit-row insertion is mandatory and can roll back the financial transaction.

- **Completed test:** 50 same-key F&B requests across two server processes produce one
  payment/snapshot/invoice/outbox; 50 different keys produce one `200` and 49 explicit
  `409 ORDER_ALREADY_PAID`; 50 Retail retries produce one order/payment/stock movement.
- **Completed fault tests:** forced `payment.done` and Retail `order.send` audit failures
  leave no payment/order mutation/outbox/archive footprint/success realtime event.
- **Rollback:** revert the isolated P0 commit. No deploy or installer build is authorized
  in this session; Production and Review remain HOLD.

## Priority 1 — Self-order repeat sound (Gate 2) — DONE on this branch
- **Invariant:** a sound fires once per *distinct* unhandled self-order event; confirm/
  reject stops it without a manual tap; reconnect/replay never re-rings an acked item.
- **Change:** key-based `RingController` + payload-aware `socket_service` wiring.
- **Test:** `test/ring_controller_dedup_test.dart` (7/7) + analyze clean.
- **Rollback:** revert the two files + delete the test (single commit).
- **Follow-up:** emit stable event id/order version server-side; `reconcile()` the ring
  set on `sync:reconnected` from the floor reload.

## Priority 2 — `/api/shifts/current` latency (Gate 5) — VERIFIED (source)
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

## Priority 3 — App-wide single-flight + close-shift idempotency (Gate 3/6-S6) — VERIFIED (source)
- **Invariant:** one click ⇒ one API call, one route/modal; late responses never push a
  route after dispose; mutation endpoints (esp. close-shift) are idempotent/conditional.
- **Plan:** shared `ActionGate`/single-flight keyed by action+entity for checkout,
  open/close shift, save, import, sync, connect, print/reprint. Server: make
  `closeShift` idempotent (idempotency key / conditional close).
- **Test:** 50 close-shift clicks during a delayed response → one call/one modal/one
  closure; retry after failure works once.

## Priority 4 — Desktop single-instance (Gate 3) — VERIFIED (source) / NEEDS-LIVE-CANARY
- Probe `flutter-apps/dandpak_desktop/windows/runner/` for a named OS mutex; if absent,
  add `CreateMutex` + activate/focus-first-instance IPC; second launch focuses & exits.

## Priority 5 — Audit `item.cancel` snapshot (Gate 4) — VERIFIED (source)
- Ensure the cancel handler writes món name/SKU/qty/table/bill/actor/reason **in the same
  transaction** as the mutation; failures never write a success audit.

## Priority 6 — Excel/CSV import fail-closed + accurate preview (Gate 6) — VERIFIED
- Header/alias mapping is non-positional across stocktake/purchase/issue; golden XLSX
  includes the three reported SKUs. CSV, locale, typed/formula cells, exact diagnostics,
  archive-before-import, retry dedupe and transactional server save are covered by tests.
- Exact customer workbook replay remains **NEEDS-LIVE-CANARY**, not a local code gap.

## Priority 7 — Floor plan parity (Gate 7) — VERIFIED (source)
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
- Only then rebuild Production `b171` and Review `b171-REVIEW` separately; record
  SHA-256/size/manifest commit/dirty=false/schema/signature/backup byte-identity.

## Standing rollout status
- **Production:** HOLD.
- **Shopee Review:** HOLD (still running `ae8c64d`; reviewer least-privilege at `fd4faee`
  intact — do not widen).
- **External (Haravan/chat) E2E:** BLOCKED (no credentials in-session).
