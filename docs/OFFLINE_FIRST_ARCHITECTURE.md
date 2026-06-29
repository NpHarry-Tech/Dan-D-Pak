# Offline-First Architecture

Last updated: 2026-06-29

Dan D Pak must keep operating through network and power interruptions without
faking success or losing business actions.

## Operating Modes

| Mode | When | Where writes go |
| --- | --- | --- |
| Local LAN | Devices reach company server on LAN | Company server |
| Gateway online | Remote/proxy path healthy | Company server through proxy |
| Temporary buffer | Company server unreachable from gateway | Encrypted pending queue |
| Device offline | Device cannot reach any server | Local pending queue |

## Event Statuses

```text
LOCAL_PENDING
BUFFER_PENDING
SYNCED
SYNC_FAILED
CONFLICT
EXPIRED
```

## Honesty Rules

- Pending orders/payments are shown as pending, never as official success.
- Payments become official only after provider/backend approval.
- Duplicate delivery is prevented with stable event IDs and idempotency checks.
- Conflicts require review instead of silent overwrite.

## Required Native App States

- data server online/offline
- current branch
- current user/session
- pending sync count
- last sync time
- failed sync items
- conflict items
- device status
