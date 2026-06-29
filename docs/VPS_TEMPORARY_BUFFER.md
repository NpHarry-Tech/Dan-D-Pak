# VPS Temporary Buffer

Last updated: 2026-06-20

While the company server is unreachable, the VPS holds write events in a
**temporary, encrypted, expiring** buffer. This is a relay, not a database.

## Buffer tables (VPS only)

- `temporary_events`
- `temporary_event_attempts`
- `temporary_event_cleanup_logs`

Planned DDL: `vps-gateway/temp-buffer/schema.sql`.

## Event record fields

Every buffered event has:

```text
event_id            unique id (also used for idempotency on company server)
branch_id
device_id
event_type          e.g. order.create, payment.record, inventory.move
payload_encrypted   encrypted payload (no plaintext business data)
payload_hash        integrity hash, verified on sync
created_at
expires_at          created_at + TTL
sync_status         VPS_PENDING | SYNCED | SYNC_FAILED | CONFLICT | EXPIRED
retry_count
last_sync_attempt_at
acknowledged_at
```

## Rules

- Payloads are **encrypted**; the VPS never stores plaintext sensitive data.
- Retention is configurable **1–7 days**, default **7 days** (`BUFFER_TTL_DAYS`).
- A cleanup job removes events that are `SYNCED` (acknowledged) or `EXPIRED`.
- The buffer never serves as a read source of truth for business reporting.
- On overflow or repeated failure, operators are alerted; data is not silently
  dropped before TTL.

## Cleanup job

- Runs on a schedule (e.g. hourly).
- Deletes acknowledged + expired events, writing a `temporary_event_cleanup_logs`
  row (counts only, no payloads).
- Never deletes events that are still `VPS_PENDING` and within TTL.

## Lifecycle

```text
device write (company server offline)
  -> VPS encrypts + stores temporary_event (VPS_PENDING)
  -> company server returns online
  -> sync-back validates hash + idempotency, writes to PostgreSQL
  -> company server ACK -> event SYNCED
  -> cleanup job purges SYNCED/EXPIRED events
```

See [SYNC_BACK_TO_COMPANY_SERVER.md](SYNC_BACK_TO_COMPANY_SERVER.md) and
[DATA_OWNERSHIP.md](DATA_OWNERSHIP.md).
