# Sync Back To Company Server

Last updated: 2026-06-20

When the company server returns online, buffered (VPS) and queued (device) events
are synced into PostgreSQL — the source of truth.

## Company-server sync tables

- `sync_events`
- `processed_event_ids`
- `sync_batches`
- `sync_conflicts`
- `sync_acknowledgements`
- `offline_device_actions`

## Sync flow

```text
1. Company server detects it is online (or VPS pushes when tunnel restored).
2. Sync worker pulls pending events from the VPS buffer / device queue.
3. For each event:
   a. Verify payload_hash (integrity).
   b. Verify signature / source (authenticity).
   c. Check processed_event_ids for the event_id (idempotency).
        - if already processed -> ACK, skip (no duplicate write).
   d. Apply business rules and write to PostgreSQL inside a transaction.
   e. Record event_id in processed_event_ids.
   f. Send ACK (sync_acknowledgements).
4. VPS marks event SYNCED and the cleanup job purges it.
```

## Idempotency (critical)

- The company server records every processed `event_id`.
- Duplicate or replayed events **must not** create duplicate orders, payments, or
  inventory movements.
- Writes for an event are transactional: either the full event applies or none of
  it does.

## Conflict handling

- If an event conflicts with existing state (e.g. an order already closed, a
  duplicate that is not idempotent-safe), it is marked `CONFLICT` in
  `sync_conflicts`.
- Conflicts require **admin review**; resolution is audited.
- No silent overwrite of existing business records.

## Failure handling

- `SYNC_FAILED` events are retried with backoff up to a configured limit.
- Events still within TTL are retained; expired unsynced events are escalated, not
  silently dropped.

See [VPS_TEMPORARY_BUFFER.md](VPS_TEMPORARY_BUFFER.md),
[OFFLINE_FIRST_ARCHITECTURE.md](OFFLINE_FIRST_ARCHITECTURE.md), and
[FAILOVER_RUNBOOK.md](FAILOVER_RUNBOOK.md).
