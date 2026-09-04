# Hypothesis Matrix — POS Incident 2026-09-04

Verdict legend:
- **DEPLOY-GAP** — current source is correct + test-green; symptom fits an older build.
- **CONFIRMED-REAL** — defect present in current source, proven by file:line (and test where noted).
- **NEEDS-REPRO** — plausible root cause identified by reading; not yet reproduced with a test.
- **BLOCKED-EXTERNAL** — cannot verify without credentials/live provider.
- **UNKNOWN** — insufficient evidence; next probe named.

Each row: symptom → leading hypothesis → evidence → verdict → how to falsify.

---

### S1 — Tablet self-order confirmed, but sound keeps repeating — **FIXED + TESTED**
- **Precise root cause (proven):** the server's staff **confirm** and **reject**
  handlers do NOT emit `order:confirmed`/`order:rejected` for the self-order flow —
  they **re-emit `order:pending`** with a `confirmed`/`rejected` field:
  [orders.js:430](../../../server/services/orders.js#L430) (confirm),
  [orders.js:477](../../../server/services/orders.js#L477) (reject). The client rang on
  **every** `order:pending` — [socket_service.dart old:401-404] — so *confirming an
  item literally fired another ring*. Compounded by a blind counter cleared only by a
  manual bell-tap ([ring_controller.dart old:37-46]) and `emit()` carrying no event id
  ([realtime.js:187-202](../../../server/realtime.js#L187-L202)), any redelivery/replay
  re-rang too.
- **Fix (this branch):**
  - `RingController` is now **key-based**: `ring(key)` dedups, `clear(key)` removes one,
    `reconcile(keys)` converges to server truth, `acknowledge()` clears all; the loop
    plays iff the key set is non-empty. `pending` is derived from the set —
    [ring_controller.dart:14-96](../../../flutter-apps/dandpak_core/lib/src/services/ring_controller.dart#L14-L96).
  - `socket_service` now **distinguishes** a genuine new pending (has `newItems`) from a
    resolution re-emit (has `confirmed`/`rejected`): rings on the former, **clears** on
    the latter — unconditionally, so it works even if sound was muted mid-ring —
    [socket_service.dart:401-459](../../../flutter-apps/dandpak_core/lib/src/services/socket_service.dart#L401-L459).
- **Verdict:** **CONFIRMED-REAL → FIXED.**
- **Verification (run this session):** `flutter test test/ring_controller_dedup_test.dart`
  → **7/7 pass**; `flutter analyze` on both changed files → **No issues**. Tests cover:
  dedup of duplicate `ring`, `clear` after confirm stops the ring (the reported bug),
  `reconcile` after reconnect, keyless-source fallback, and `acknowledge`.
- **Residual/next:** server should also emit a stable event id/order version on realtime
  events, and the client should `reconcile()` the ring set on `sync:reconnected` using the
  authoritative pending set from the floor reload (wiring left for a follow-up; the API is
  in place).

### S2 — F&B checkout reports success, returns to table select, no bill prints
- **Hypothesis A (current source):** payment commits atomically; print is a durable
  outbox side-effect after commit; UI success ⇒ payment committed. A print failure
  would be logged and retried, not silent — so "success + no bill" on current source
  would mean the *print agent* is offline, not that money/bill state is wrong.
- **Hypothesis B (more likely for the field report):** deployed build predates the
  outbox/print-config-per-device hardening.
- **Evidence:** print enqueued in tx then dispatched post-commit with error logging —
  [payments.js:675, 748-758](../../../server/services/payments.js#L675);
  device-scoped print routing added — [payments.js:81 comment](../../../server/modules/payments/routes.js#L78-L81).
- **Verdict:** **DEPLOY-GAP** for the "no bill at all" report; residual real gap =
  the UI does not surface *print-job status* ("đang in / in lỗi / reprint") — the
  brief's Gate-1 requirement. Tracked as **CONFIRMED-REAL (UX surface only)**.
- **Falsify:** with print agent offline, run `/orders/:id/pay` → assert exactly one
  payment, order `paid`, one `print_jobs`/outbox row in a retryable state, and the
  receipt payload carries a print status the client can render.

### S3 — Table stays open/has items; reopen allows edit + second payment (double charge)  — **P0**
- **Hypothesis:** On current source this is prevented; symptom fits an old build.
- **Evidence:** conditional close guard [payments.js:588-592](../../../server/services/payments.js#L588-L592);
  immutable-once-closed [payments.js:491](../../../server/services/payments.js#L491);
  table freed in-tx [payments.js:643-649](../../../server/services/payments.js#L643-L649);
  no duplicate open order per table [orders.js:191-228](../../../server/services/orders.js#L191-L228);
  idempotent replay [payments.js:466-484](../../../server/services/payments.js#L466-L484).
  Suites green: `idempotency-chong-trung-don` 7/7, `so-bill-cap-khi-thanh-toan` 7/7,
  `retail-double-checkout` 2/2, `table-stuck-paid-reset` 4/4 (this session).
- **Verdict:** **DEPLOY-GAP.** Not reproducible on current source — now proven by a
  direct assertion.
- **Falsify / verification (added this session):** `server/fnb-double-pay-guard.test.mjs`
  — pay fully, then a second pay with a **different** key → rejected (`Order đã đóng`),
  still exactly one payment row, revenue unchanged; same-key retry → idempotent replay of
  the same `payment_id`; appending items to the closed order is rejected. **3/3 pass**
  (Node 24 / SQLite 3.51.2). (A multi-process concurrency fan-out remains a further
  hardening test — the synchronous `node:sqlite` API serializes intra-process calls, so
  true concurrency needs separate connections; the conditional-close guard covers it.)

### S4 — `item.cancel` audit shows only opaque item ID + generic reason
- **Hypothesis:** cancel audit logs the technical `order_item.id` and a generic reason
  without a snapshot (name/SKU/qty/table/bill/actor) captured in the same tx.
- **Evidence:** NOT yet traced to the exact `audit('item.cancel', …)` call. Next probe:
  `rg "item.cancel" server/` and the cancel handler in
  `server/services/orders.js` / `server/modules/orders/routes.js`.
- **Verdict:** **NEEDS-REPRO** (leaning real; matches brief's Gate-4 requirement of a
  structured envelope + snapshot).
- **Falsify:** cancel an item then rename/delete it → audit detail still shows the
  original món name, SKU, qty, table, bill, actor, reason.

### S5 — `GET /api/shifts/current` slow 4.7–28.7 s, multiplied by repeated clicks
- **Hypothesis:** Heavy per-call aggregation + no client GET coalescing + SQLite
  single-writer contention during concurrent `payOrder` (`BEGIN IMMEDIATE`).
- **Evidence:** `currentShift` → `shiftReport` (4 payment-scan queries) +
  `operationDayReport` + `currentDrawer` on every call —
  [shifts.js:108-183](../../../server/services/shifts.js#L108-L183). Client `loadShift`
  sets a flag but does not single-flight the request. `migrate()` ≈ 11.5 s shows the DB
  layer is not cheap on this runtime.
- **Verdict:** **CONFIRMED-REAL** (cause identified). Fix requires: (a) instrument
  duration + query count, (b) client coalesce identical in-flight GET, (c) evaluate a
  short event-driven cache / lighter query, **with a before/after benchmark** — not a
  blind index.
- **Falsify:** benchmark on a synthetic near-real DB; assert server p95 ≤ 500 ms and no
  request > 1.5 s in the recorded environment (report real numbers if not met).

### S6 — "Kết ca" clicked repeatedly during lag → stacked modals/screens
- **Hypothesis:** No app-wide single-flight (`ActionGate`) keyed by action+entity; each
  click pushes a route/dialog and fires the request; `closeShift` server side is not
  guarded idempotent/conditional against concurrent close.
- **Evidence:** `closeShift` closes the active shift with no idempotency key —
  [shifts.js:62-64](../../../server/services/shifts.js#L62-L64). Client `closeShift`
  toggles `_isLoadingShift` but does not prevent concurrent dispatch —
  [pos_provider.dart:701-714](../../../flutter-apps/dandpak_core/lib/src/providers/pos_provider.dart#L701-L714).
- **Verdict:** **CONFIRMED-REAL.**
- **Falsify:** fire 50 close-shift calls during a delayed response → one API call, one
  modal, one closure; late error does not push a route after dispose.

### S7 — Prevent multiple Desktop instances; focus the running one
- **Hypothesis:** No single-instance guard at the Windows entrypoint/native runner.
- **Evidence:** NOT yet traced. Next probe: `flutter-apps/dandpak_desktop/windows/runner/`
  (`main.cpp`) for a named mutex / `CreateMutex` / activation IPC.
- **Verdict:** **NEEDS-REPRO** (leaning real — feature typically absent unless added).
- **Falsify:** launch the desktop app twice → second process focuses the first and exits;
  named OS mutex present in the runner.

### S8 — Excel import: many "Khớp mã", column shift, absurd total 633,705,997,308.678đ
- **Hypothesis:** Client Excel parser mis-parses money (decimal-comma vs thousands
  separator) and/or maps by fragile column position, concatenating cells → giant number.
- **Evidence:** import tests exist — `flutter-apps/dandpak_core/test/kv_import_orchestration_test.dart`,
  `kv_excel_compatibility_test.dart`. Exact defective parse line NOT yet identified.
- **Verdict:** **NEEDS-REPRO.**
- **Falsify:** golden fixture with decimal-comma + reordered columns → preview shows the
  real per-cell values and totals; a value like `633,705,997,308.678` is flagged as an
  error before any commit; the commit callback is not invoked when validation fails.

### S9 — Floor plan differs POS vs Settings (tables missing/clipped, ratio drifts)
- **Hypothesis:** POS renders the floor with an independent layout/reflow instead of a
  shared canonical coordinate model + single viewport transform.
- **Evidence:** NOT yet traced. Next probe: floor renderers under
  `flutter-apps/dandpak_core/lib/src/screens/**` (POS floor vs Settings floor editor) and
  server `floor-plan` (there is `server/floor-plan.test.mjs`).
- **Verdict:** **NEEDS-REPRO** (matches Gate-7 description).
- **Falsify:** golden tests at 1366×768 / 1920×1080 / ultrawide / tablet portrait+landscape /
  DPI scaling → every table id appears exactly once, in-canvas, stable relative geometry.

### S10 — Launcher is a flat module list; want sell-first IA (Bán hàng / Quản lý)
- **Verdict:** **UX (Gate 9)** — deliberately deferred until S1–S8 gates are green, per
  brief. Not a defect; an IA change requiring a feature/route/role parity map first.

### S11 — Settings thumbnails misaligned across aspect ratios
- **Verdict:** **NEEDS-REPRO / low-risk.** Fix = centered constrained box + `BoxFit`
  chosen per asset + golden tests (portrait/landscape/square/missing). Next probe:
  settings image widgets under `screens/management/` and `screens/**/settings_*`.

### S12 — Multi-channel chat shows blank "Chưa có hội thoại"
- **Hypothesis:** Cannot tell "no data" from "not configured / auth error / no permission"
  without tracing connector→ingest→DB→scope→list.
- **Evidence:** Omni module present (`server/modules/omni/`, `server/services/omni/`,
  `omni-core.test.mjs`, `online-omni-operations.test.mjs`). End-to-end ingest/send/realtime
  NOT verified; no provider credentials available in-session.
- **Verdict:** **BLOCKED-EXTERNAL** for live E2E; **NEEDS-REPRO** for the empty-state
  taxonomy (configured-but-empty vs error vs unauthorized).
- **Falsify:** mock provider with real signature → 2 duplicate webhook ids = 1 message;
  reconnect no dup; branch isolation holds; UI distinguishes the five empty/error states.

### S13 — Haravan "Nhận từ Haravan • 1" failing at webhook/subscribe
- **Hypothesis:** subscribe/callback misconfig (token/scope/HTTPS callback/HMAC/duplicate
  subscription) — must be read from a real failure with a correlation id, not guessed.
- **Evidence:** connector present — `server/services/haravanConnector.js`, routes at
  [api.js:287-299](../../../server/api.js#L287-L299), webhook verify/handle at
  [index.js:138-152](../../../server/index.js#L138-L152). No captured failure body/status/
  scope available in-session; must not be invented.
- **Verdict:** **BLOCKED-EXTERNAL.** Do not assert cause without a logged failure.
- **Falsify:** capture one failure (method/host+path/status/Haravan code/scopes/shop/
  callback/topic/latency, tokens redacted); compare against Haravan docs (HTTPS callback,
  subscribe/receive/authenticate/unsubscribe/list); reconcile idempotently.

---

## Known / Inferred / Unknown (Gate-0 close-out)

- **Known (proven):** S1 real; S3 deploy-gap (source correct, suites green); S5 cause
  identified; S6 real; runtime = Node 24.14.1 / SQLite 3.51.2; migrate ≈ 11.5 s.
- **Inferred (read, not yet reproduced):** S2 (deploy-gap + UX surface), S4, S7, S8, S9,
  S11.
- **Unknown / blocked:** S12, S13 external E2E (no credentials in-session).
