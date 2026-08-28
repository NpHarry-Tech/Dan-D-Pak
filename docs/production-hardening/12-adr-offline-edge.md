# ADR-012: Store-local edge is the authority during WAN outages

**Status:** Protocol implemented but disabled; production activation requires hardware canary  
**Date:** 2026-08-09  
**Deciders:** Dan D Pak owner and POS engineering

## Context

Store devices currently depend on the VPS/WAN. Caching screens alone cannot safely
sell offline because pricing, promotions, stock, payment numbering and printing are
server-authoritative. Reimplementing those rules in Flutter would create two pricing
engines and make reconciliation unsafe.

## Decision

Run the existing Node/SQLite service as one Local Edge per branch. Store POS,
tablet, KDS, customer display and printer agent use it over LAN. The edge remains
the branch authority while WAN is unavailable. It synchronizes append-only business
events to the VPS with stable `hub_id + sequence + event_id`; VPS acknowledgements
are persisted before an edge event can be removed.

Rollout is deliberately split:

1. Edge shadow/canary: replicate a production copy, no store writes routed to it.
2. LAN authority for one device, with WAN still available and reconciliation checks.
3. WAN-cut cash-sale test; cash is explicitly pending until synced.
4. Append-only orders/payments/shifts and inventory movement deltas.
5. VPS-to-edge catalogue/config pull.
6. Wider device rollout only after zero duplicate/lost events and hardware tests.

Bank/QR/card payments are never fabricated as approved offline. Bank confirmation
still comes from the provider; card requires terminal reference; offline cash is
recorded as pending and reconciled with the shift.

## Options considered

| Option | Complexity | Outage capability | Data risk | Decision |
|---|---:|---:|---:|---|
| Flutter-only cache/outbox | Medium | Partial | High: duplicate business rules | Rejected |
| Every device owns a DB | High | High | Very high merge/conflict risk | Rejected |
| Store Local Edge + VPS | Medium | High | Controlled by single branch writer | Accepted |
| Cloud-only VPS | Low | None | Low consistency risk, unacceptable availability | Rejected |

## Consequences

- Flutter stays light; pricing/promo/payment logic remains one server implementation.
- A store needs a stable edge host, UPS, fixed LAN address and monitored backups.
- Sync is an acknowledged protocol. If the four Edge environment values are
  incomplete, `sync_queue` remains a local outbox and manual sync fails closed;
  when configured, only a durable upstream ACK can advance an event to `done`.
- Offline rollout cannot share a deployment with destructive schema work.

## Implemented protocol boundary

- Critical outbox events persist a stable `event_id`, `hub_id`, monotonic sequence,
  operation and full row payload for orders, order items, payments, payment lines,
  immutable sale snapshots, stock movements and shifts.
- The HTTPS sender orders batches by sequence and marks a row `done` only when the
  upstream ACK contains its event ID and the local payload is still byte-for-byte
  the payload that was sent. Concurrent local edits therefore remain pending.
- The receiver requires an HMAC-SHA256 signature over timestamp + full body,
  rejects requests outside a five-minute window, and requires an explicit JSON
  mapping of hub IDs to allowed branches. The secret never crosses the network.
  It applies each batch in one SQLite transaction,
  records a content hash in `sync_inbox`, advances a per-hub cursor, and rejects
  event-ID reuse, stale unseen sequences, schema drift and branch mismatch.
- Applying a remote batch suppresses local outbox triggers transactionally, so an
  accepted remote event cannot echo back into an infinite replication loop.
- While an edge is offline, cash and locally validated vouchers remain usable.
  Bank/QR/wallet methods are rejected rather than fabricated as paid; card is
  accepted only with non-mock terminal transaction/approval/terminal evidence.
- With no complete configuration, status remains `local-outbox-only` and no row
  can be acknowledged. The feature is therefore safe-by-default and inactive.
- After the critical outbox is fully ACKed, the edge automatically pulls a
  content-addressed VPS snapshot of branch layout, catalogue, recipes, stock,
  promotions, customers and a strict allowlist of sell-side settings. Applying
  it is atomic, idempotent and rejects stale/tampered snapshots or any pull while
  local business events remain pending. Integration credentials, Firebase keys
  and tax secrets are deliberately excluded and must be provisioned separately.

## Production gates

- Stable event IDs and receiver inbox uniqueness proven under retries/concurrency.
- Production-copy restore and edge migration pass `quick_check` and reconciliation.
- WAN cut/reconnect produces exactly one order, payment, snapshot and stock delta.
- Pending/approved payment states are visible and honest.
- Edge failure and VPS rollback procedures tested on store hardware.

## Client routing and split-brain rule

- Flutter never owns or silently starts the Node service. A Store Edge is an
  independently monitored service with its own SQLite volume, backup and UPS.
- Fresh installations use `https://api.dandpakpos.io.vn`; an Edge canary build
  may set `--dart-define=STORE_EDGE_URL=http://<fixed-lan-ip>:3000`, or an
  operator may save that URL on the branch-selection screen.
- Every selling/KDS/tablet device in the branch must point to the same Edge.
  Clients do **not** automatically fail over from Edge to VPS: that would create
  two writable authorities during an Edge-only failure and split orders, stock,
  shifts and payment references.
- Losing WAN therefore keeps the store operational through LAN Edge. Losing the
  Edge itself is a separate incident and requires restoring/replacing that Edge;
  it must not be hidden by writing directly to cloud.

## Automated WAN-cut evidence

`server/offline-edge-wan-cut.test.mjs` launches two independent server processes
with two independent SQLite files. It creates a cash sale while the edge is
disconnected, reconnects through the authenticated transport, and proves:

- exactly one payment, payment line and immutable sale snapshot reach the VPS;
- Store Edge never calls MISA: its local legal intent moves from
  `PENDING_EDGE_SYNC` to `SYNCED_TO_CLOUD` only after the sale snapshot ACK;
  the VPS creates exactly one cloud e-invoice request/allocation and remains the
  sole provider authority;
- stock converges from 10 to 9;
- the edge pulls the newer VPS menu price only after its outbox reaches zero;
- a later retry cycle does not add an inbox event or duplicate financial rows;
- VPS `PRAGMA quick_check` remains `ok`.

Loopback HTTP is accepted only under `NODE_ENV=test`; every non-test transport
still requires HTTPS. This automated gate does not replace the UPS/LAN/printer
hardware canary required before production activation.
