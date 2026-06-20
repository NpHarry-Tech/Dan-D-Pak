# Failover Runbook

Last updated: 2026-06-20

Handling loss of connectivity between zones and recovery, without data loss or
fake success.

## Scenarios

### A. Company server reachable on LAN, internet down

- Local POS/iPad/KDS keep working directly against the company server.
- Remote/VPS access is unavailable; local operation is unaffected.
- Action: none locally; restore internet for remote access.

### B. VPS up, company server unreachable (tunnel/power/network)

- VPS enters temporary buffer mode (`VPS_PENDING` events).
- UI shows data server offline + pending count.
- Action: restore the company server / tunnel, then run sync-back.

### C. Device offline (cannot reach any server)

- Device queues actions locally (`LOCAL_PENDING`).
- Action: reconnect device; queued actions sync (idempotent).

### D. Both internet and company server down (power outage)

- See [POWER_OUTAGE_RUNBOOK.md](POWER_OUTAGE_RUNBOOK.md).

## Recovery procedure (general)

1. Identify which link failed (device↔server, VPS↔server, internet).
2. Restore the failed link.
3. Verify health endpoints on both sides.
4. Run sync-back: hash + idempotency validation, transactional writes, ACK.
5. Resolve any `CONFLICT` events (admin, audited).
6. Confirm pending sync counts reach zero.

## Conflict workflow

- Duplicate / conflicting offline data is marked `CONFLICT`.
- Admin reviews and resolves; resolution is audited.
- No silent overwrite of existing business records.

## Do / don't

- Do keep TTL in mind: buffered events expire in 1–7 days — sync before expiry.
- Don't restore an old backup over newer synced data without checking the buffer.
- Don't mark offline payments official; reconcile on sync.

See [SYNC_BACK_TO_COMPANY_SERVER.md](SYNC_BACK_TO_COMPANY_SERVER.md) and
[VPS_TEMPORARY_BUFFER.md](VPS_TEMPORARY_BUFFER.md).
