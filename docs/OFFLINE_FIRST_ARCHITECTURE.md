# Offline-First Architecture

Last updated: 2026-06-20

Dan-D-Pak must keep operating through network and power interruptions without ever
faking success or losing business actions.

## Operating modes

| Mode | When | Where writes go |
| --- | --- | --- |
| Local LAN | Devices reach company server on LAN | Company server (immediate truth) |
| Online via VPS | Remote access, tunnel healthy | Company server through VPS proxy |
| VPS temporary buffer | Company server unreachable from VPS | VPS encrypted buffer (pending) |
| Offline device queue | Device cannot reach any server | Local device queue (pending) |

## Event lifecycle / statuses

```text
LOCAL_PENDING  -> queued on the device, not yet sent
VPS_PENDING    -> buffered (encrypted) on the VPS, not yet in company DB
SYNCED         -> written to company PostgreSQL and acknowledged
SYNC_FAILED    -> delivery/validation failed, will retry
CONFLICT       -> duplicate or conflicting data, needs admin review
EXPIRED        -> TTL elapsed before sync (buffer cleanup)
```

## Honesty rules (no fake success)

- A pending order/payment is shown as **pending**, never as an official success.
- Payments are never marked "approved/official" purely from a buffered event — see
  [PAYMENT_OFFLINE_POLICY.md](PAYMENT_OFFLINE_POLICY.md).
- The UI surfaces real state at all times (see UI states below).

## Required UI states

The frontend must show:

- Data server online / offline
- VPS temporary mode active
- Pending sync count
- Last sync time
- Failed sync items
- Conflict items
- Device status
- Current branch
- Current user / session

The frontend config layer (`web/js/core/config.js`, `apiClient.js`,
`realtimeClient.js`) already distinguishes backend-offline errors
(`BackendOfflineError`) from API errors, which is the hook for these states.

## Idempotency

Every event carries an `event_id`. The company server records processed ids so
replays/duplicates are ignored. See
[SYNC_BACK_TO_COMPANY_SERVER.md](SYNC_BACK_TO_COMPANY_SERVER.md).
