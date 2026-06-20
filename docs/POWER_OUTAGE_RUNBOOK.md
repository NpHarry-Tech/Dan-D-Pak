# Power Outage Runbook

Last updated: 2026-06-20

What happens, and what to do, when the company server loses power.

## Behavior during outage

- The company server (and its PostgreSQL) is offline.
- The VPS detects the company server is unreachable and enters **temporary buffer
  mode** — new write events are encrypted and queued (`VPS_PENDING`).
- Local devices that still have power may **queue actions locally**
  (`LOCAL_PENDING`).
- The UI shows: data server offline, VPS temporary mode, pending sync count.
- No payment is reported as official from a buffered event — see
  [PAYMENT_OFFLINE_POLICY.md](PAYMENT_OFFLINE_POLICY.md).

## When power returns

1. Bring the company server and PostgreSQL back up.
2. Verify the database started cleanly (check logs, run integrity checks).
3. Confirm the VPS↔company tunnel is healthy.
4. Run **sync-back**: validate hashes + idempotency, write pending events to
   PostgreSQL, ACK, then let the VPS cleanup job purge synced events.
5. Review any `CONFLICT` events (admin resolution, audited).
6. Confirm pending sync count returns to zero in the UI.

## Checklist

- [ ] Company server + PostgreSQL healthy
- [ ] Tunnel/VPN to VPS up
- [ ] Buffered events synced (pending count = 0)
- [ ] Device-queued actions synced
- [ ] Conflicts reviewed and resolved
- [ ] Shift/cash reconciliation reviewed if a shift spanned the outage

See [OFFLINE_FIRST_ARCHITECTURE.md](OFFLINE_FIRST_ARCHITECTURE.md),
[SYNC_BACK_TO_COMPANY_SERVER.md](SYNC_BACK_TO_COMPANY_SERVER.md), and
[FAILOVER_RUNBOOK.md](FAILOVER_RUNBOOK.md).
