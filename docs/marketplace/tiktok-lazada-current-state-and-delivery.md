# TikTok Shop + Lazada current state and delivery record

Audit started at `b6ee2f45042a738b41c7b9cada1253ecfc8a1e4d` (2026-09-13).
The worktree already contained many owner changes; implementation was additive
and did not reset, checkout, build, publish or deploy.

During implementation, an external workspace process committed the in-flight
changes as `cb26858f09860d6326a7835e7e91fcce9eef54d9`, then committed the
reconciliation worker as `51f3856`. A later external release commit `c62ea5c`
and catalog commit `2e8fe7a` also included then-current marketplace files.
Those commits were not rewritten or reset.

## Current-state audit

| Area | Before this delivery | Evidence | Result |
|---|---|---|---|
| Shared lifecycle | Shopee/Lazada adapters existed; TikTok used an unsafe branch-derived callback | `server/services/connectionPlatform.js`, `server/index.js` | TikTok is registered in the shared one-use lifecycle; its legacy callback now fails closed. |
| Token storage | TikTok and connector runtime primarily read branch integration tokens | `server/services/tiktokConnector.js`, `server/services/lazadaConnector.js` | Runtime prefers encrypted marketplace vault credentials; legacy values are read only as migration compatibility. |
| Multi-shop | TikTok swallowed shop-discovery errors and selected the first shop | `server/services/tiktokConnector.js` | All returned shops are stored; zero fails; UI requires explicit shop/branch/warehouse mapping. |
| Status | OAuth completion could look active | `server/services/connectionStore.js` | State progresses through `pending_shop_selection` / `pending_mapping` / `initial_sync` / `active`. |
| Webhooks | TikTok/Lazada processed provider API work before HTTP ACK; unknown shops could fall back to `sala` | both connector webhook handlers | Exact mapped routing, rejection/quarantine, durable dedupe inbox and async retry/dead-letter worker. |
| Orders/money | Shipping-like statuses could call `payOrder`; totals collapsed provider components | both connector order normalizers | Default shadow mode blocks payment/stock settlement writes and stores separate financial facts/components. |
| SKU | Exact mapping could fall through to product-name matching | both connector SKU resolvers | Explicit mapping → exact unique seller SKU → exact unique barcode; otherwise `mapping_required`. No name match. |
| Lazada host | Branch/client `apiBase` could select the host | `server/services/lazadaConnector.js` | Authorized country resolves through a server-owned regional allowlist. |

## Additive schema

- Extended `marketplace_connections` with account/environment/scopes/credential version and health timestamps.
- Added `marketplace_shops` and `marketplace_shop_mappings`.
- Added `marketplace_capabilities` and `marketplace_sync_cursors`.
- Added `marketplace_webhook_inbox` and `marketplace_webhook_quarantine`.
- Added `marketplace_order_financials` and `marketplace_mapping_required`.

No destructive table/column migration is used. Existing encrypted token context
is preserved, mappings/cursors survive reauthorization, and disconnect clears
seller tokens without deleting order history.

## Capability verdict

| Capability | TikTok Shop | Lazada |
|---|---|---|
| One-click authorization + encrypted vault | COMPLETE (fixture-tested; real credential pending) | COMPLETE (existing adapter; real credential pending) |
| Multi-shop discovery and explicit mapping | COMPLETE contract/UI; owner credential and sandbox evidence BLOCKED | COMPLETE contract/UI; owner credential and sandbox evidence BLOCKED |
| Token proactive refresh / rotation | COMPLETE contract; real rotation BLOCKED | COMPLETE contract; real rotation BLOCKED |
| Read order/product shadow sync | PARTIAL; endpoint/app evidence BLOCKED | PARTIAL; endpoint/app evidence BLOCKED |
| Durable webhook inbox | COMPLETE infrastructure; production signature evidence BLOCKED | COMPLETE infrastructure; production signature evidence BLOCKED |
| Exact SKU mapping queue | COMPLETE | COMPLETE |
| Monetary evidence model | COMPLETE schema/fixtures; provider-field coverage PARTIAL | COMPLETE schema; provider-field fixtures BLOCKED |
| Waybill read | PARTIAL; sandbox evidence BLOCKED | PARTIAL; sandbox evidence BLOCKED |
| Inventory/product/fulfillment writes | BLOCKED | BLOCKED |
| Cancellation/returns/refunds/claims | BLOCKED | BLOCKED |
| Finance/fees/settlement reconciliation | BLOCKED | BLOCKED |

Verdict: **READY_FOR_OWNER_INPUT**. The exact owner steps, private environment
locations and evidence gates are in `docs/marketplace/owner-credential-onboarding.md`.
No outbound/write capability is enabled.

## Verification record

- Focused marketplace suite: callback replay/provider/expiry/denial, encrypted
  vault, multi-shop mapping, token refresh concurrency, unknown-shop quarantine,
  inbox dedupe/crash recovery, reconciliation overlap/watermark, exact-SKU shadow
  order evidence.
- Full server suite on the final working tree: 832/832 passed. The final focused
  marketplace foundation gate passed 18/18, including zero/one/multiple shops,
  multi-branch initial-sync gating, pre-routing signatures, worker leases,
  evidence-only cancellations, disconnect/reconnect and legacy-token migration.
- Lazada connector gate: 5/5 passed (TOP signing, auth URL, fail-closed webhook
  signature and honest capability status).
- Social connector gate: 6/6 passed, including TikTok API/webhook signing and
  honest connector capability status.
- Flutter: `flutter analyze` reported no issues; 262 tests passed and one
  environment-dependent updater E2E test was skipped. The two subsequent
  marketplace copy/comment edits were formatted and analyzed with no issues.
- No production credential, seller authorization, app review, subscription,
  deployment or real marketplace mutation was attempted.
