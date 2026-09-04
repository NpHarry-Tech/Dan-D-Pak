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

### S4 — `item.cancel` audit shows only opaque item ID + generic reason — **FIXED + TESTED**
- **Root cause (proven):** the cancel handler logged only `{ item: item_id, reason }` —
  [orders.js:792 (before)] — even though the full item row (`cancelledItem`) and order
  (`beforeCancel`) were already loaded two lines above
  ([orders.js:786-788](../../../server/services/orders.js#L786-L788)). The snapshot data
  was in hand and simply not recorded.
- **Fix (this branch):** enrich the `item.cancel` detail with `item_name`, `sku`, `qty`,
  `unit_price`, `station`, `order_id`, `table_id`, `bill_no` — captured in the same call,
  keeping `item`+`reason` for backward compatibility —
  [orders.js:792-805](../../../server/services/orders.js#L792-L805).
- **Verdict:** **CONFIRMED-REAL → FIXED.**
- **Verification (this session):** `server/audit-item-cancel-snapshot.test.mjs` — cancel
  an item → audit detail carries the món name/SKU/qty/table/order; renaming the menu item
  afterward does not change the logged name (it is a snapshot). **2/2 pass.**

### S5 — `GET /api/shifts/current` slow 4.7–28.7 s, multiplied by repeated clicks
- **Hypothesis:** Heavy per-call aggregation + no client GET coalescing + SQLite
  single-writer contention during concurrent `payOrder` (`BEGIN IMMEDIATE`).
- **Evidence:** `currentShift` → `shiftReport` (4 payment-scan queries) +
  `operationDayReport` + `currentDrawer` on every call —
  [shifts.js:108-183](../../../server/services/shifts.js#L108-L183). Client `loadShift`
  sets a flag but does not single-flight the request. `migrate()` ≈ 11.5 s shows the DB
  layer is not cheap on this runtime.
- **Verdict:** **CONFIRMED-REAL — client mitigation FIXED + TESTED; server work remains.**
  - **(b) Client GET coalescing — DONE.** Added `coalesceGet` single-flight in the HTTP
    client and enabled it on both `/api/shifts/current` reads
    ([api_client.dart:324-372](../../../flutter-apps/dandpak_core/lib/src/api_client.dart#L324-L372),
    [pos_api.dart:161-210](../../../flutter-apps/dandpak_core/lib/src/services/api/pos_api.dart#L161-L210)):
    20 rapid clicks → **1** in-flight request; opt-in (default off) so no other GET changes.
    Test `test/get_coalesce_test.dart` **3/3**; analyze clean.
  - **(a) server instrument + (c) lighter query / short event-driven cache — REMAINING,
    benchmark-gated.** Do NOT add a blind cache/index. Next: instrument duration + query
    count, benchmark on a synthetic near-real DB, target server p95 ≤ 500 ms / none > 1.5 s
    (report real numbers if unmet).
- **Falsify (server):** the benchmark above.

### S6 — "Kết ca" clicked repeatedly during lag → stacked modals/screens
- **Hypothesis:** No app-wide single-flight (`ActionGate`) keyed by action+entity; each
  click pushes a route/dialog and fires the request; `closeShift` server side is not
  guarded idempotent/conditional against concurrent close.
- **Evidence:** `closeShift` closes the active shift with no idempotency key —
  [shifts.js:62-64](../../../server/services/shifts.js#L62-L64). Client `closeShift`
  toggles `_isLoadingShift` but does not prevent concurrent dispatch —
  [pos_provider.dart:701-714](../../../flutter-apps/dandpak_core/lib/src/providers/pos_provider.dart#L701-L714).
- **Verdict:** **CONFIRMED-REAL — client single-flight FIXED + TESTED; UI modal-singleton
  + server conditional close remain.**
  - **Client single-flight — DONE.** Added `PosProvider.singleFlight(key, action)` and
    wrapped `openShiftCounts`/`closeShiftCounts` (the ShiftDialog mutations) so rapid
    "Kết ca" clicks fire the API **once**; the lock releases in `finally` (errors don't
    wedge it) — [pos_provider.dart:716-772](../../../flutter-apps/dandpak_core/lib/src/providers/pos_provider.dart#L716-L772).
    Test `test/shift_single_flight_test.dart` **3/3**; analyze clean.
  - **Remaining:** singleton route/modal key + `mounted` checks so a late response can't
    push a dialog after dispose (UI); server `closeShift` is already double-close-safe in
    the single-process synchronous runtime (2nd close → `getActiveShift` null → clear
    error, [shifts.js:62-64](../../../server/services/shifts.js#L62-L64)) but a conditional
    `UPDATE … WHERE status='open'` would harden multi-process deploys.
- **Falsify:** widget test — 50 close-shift taps during a delayed response → one API call,
  one modal, one closure; late error does not push a route after dispose.

### S7 — Prevent multiple Desktop instances; focus the running one — **IMPLEMENTED (build-gated)**
- **Confirmed gap:** the Windows runner `main.cpp` had **no** single-instance guard —
  each launch created a new window.
- **Fix (this branch):** named mutex `Local\DanDPakPOS_SingleInstance` at the entrypoint;
  on `ERROR_ALREADY_EXISTS` it `FindWindowW("Dan-D Pak POS")` → `ShowWindow(SW_RESTORE)`
  if minimized → `SetForegroundWindow` → exits. The `--customer-display` secondary window
  is **exempt** (it is intentionally a separate process) —
  [main.cpp:26-51](../../../flutter-apps/dandpak_desktop/windows/runner/main.cpp#L26-L51).
- **Verdict:** **CONFIRMED-REAL → IMPLEMENTED.** Uses only standard `windows.h` APIs.
- **Verification:** by inspection this session; **build/run verification deferred to the
  final gate** (the incident rules forbid building artifacts mid-phase). Falsify at the
  gate: launch twice → one window, second focuses the first and exits; customer-display
  still opens as its own window.

### S8 — Excel import: many "Khớp mã", column shift, absurd total 633,705,997,308.678đ
- **Hypothesis:** Client Excel parser mis-parses money (decimal-comma vs thousands
  separator) and/or maps by fragile column position, concatenating cells → giant number.
- **Evidence:** import tests exist — `flutter-apps/dandpak_core/test/kv_import_orchestration_test.dart`,
  `kv_excel_compatibility_test.dart`. Exact defective parse line NOT yet identified.
- **Verdict:** **PARTIALLY FIXED.** Two independent issues:
  - **(a) Locale parse bug — FIXED + TESTED.** `kvParseNum` only did `,`→`.` then
    `num.tryParse`, so VN-grouped money mis-scaled 1000× (`"1.000.000"`→`1.0`) and mixed
    `"1.234,56"`→`null`. Rewrote it locale-aware (last separator = decimal; grouped forms
    stripped) — [kv_shared.dart:28-63](../../../flutter-apps/dandpak_core/lib/src/screens/warehouse/kv_shared.dart#L28-L63).
    Test `test/kv_parse_num_locale_test.dart` **8/8**; existing `kv_excel_compatibility` +
    `kv_import_orchestration` still green (no regression).
  - **(b) The specific `633,705,997,308.678` — NEEDS-REPRO with the real file.** Most
    likely a **column shift** placing a 12-digit barcode into the cost column (the parser
    faithfully parses `"633705997308"`; verified in the test). The fix is header-based
    (not positional) mapping + a **plausibility guard** that flags implausible unit cost
    before commit. Requires the actual failing xlsx to pin the mapping — not fabricated.
- **Falsify (remaining):** golden fixture with a barcode in the cost column → preview
  flags it and the commit callback is not invoked.

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
- **Verdict:** **BLOCKED-EXTERNAL for live E2E — but the failure is now CAPTURABLE
  (diagnostics FIXED + TESTED).** The subscribe path previously threw a bare message.
  Now `webhookSubscribeRequest` builds a **structured, token-free** `diagnostic`
  (stage, method, endpoint host+path, http_status, haravan_code, haravan_message,
  shop_domain, latency_ms) and `subscribeWebhook`/`unsubscribeWebhook` persist it to
  `sync_logs` (raw_payload) on failure — [haravanConnector.js:294-364](../../../server/services/haravanConnector.js#L294-L364).
  Test `server/haravan-subscribe-diagnostics.test.mjs` **3/3** (401 → structured
  diagnostic; sync_logs row written; DNS/network → `stage:network`; the secret token
  never appears in the diagnostic or the log).
- **Still BLOCKED:** the actual live subscribe against a real shop needs a Haravan dev
  store/token (none in-session). But when it next fails in the field, the cause
  (status/scope/callback/latency) will be recorded instead of an opaque "• 1".
- **Falsify (remaining):** with a dev store, compare a real captured failure against
  Haravan docs (HTTPS callback; subscribe/receive/authenticate/unsubscribe/list) and
  confirm idempotent reconcile.

---

## Known / Inferred / Unknown (Gate-0 close-out)

- **Known (proven):** S1 real; S3 deploy-gap (source correct, suites green); S5 cause
  identified; S6 real; runtime = Node 24.14.1 / SQLite 3.51.2; migrate ≈ 11.5 s.
- **Inferred (read, not yet reproduced):** S2 (deploy-gap + UX surface), S4, S7, S8, S9,
  S11.
- **Unknown / blocked:** S12, S13 external E2E (no credentials in-session).
