# Audit Logging

Last updated: 2026-06-20

The company server records who did what, when, and from where for every sensitive
action. Audit logs are append-only.

## Tables

- `audit_logs`
- `security_logs`
- `system_logs`
- `data_change_logs`
- `permission_change_logs`
- `config_change_logs`
- `error_logs`

## Each audit log captures

- who (user / actor)
- did what (action)
- when (timestamp)
- from which device
- from which IP
- old value summary
- new value summary
- affected table / entity
- reason (where required)

## Audited actions

- login / logout / failed login
- role / permission changes
- price changes
- menu changes
- order void / cancel / refund
- payment changes
- bank config changes
- integration config changes
- inventory adjustment
- stocktake closing
- report closing
- print / reprint
- device pairing / approval / revocation
- data sync conflict
- backup / restore

## Rules

- Audit logs are append-only; entries are never edited or deleted.
- Secret values (tokens, passwords, full card/bank numbers) are never written to
  audit logs — only masked references and value summaries.
- Sensitive value changes store a **summary**, not the raw secret.

## Current implementation

`server/db.js` already defines `audit_log`; `server/services/archive.js` and the
`server/modules/audit` zone are the target home for the expanded log set above.
