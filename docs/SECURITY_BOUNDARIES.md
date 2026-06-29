# Security Boundaries

Last updated: 2026-06-29

## Never Commit

- `.env`, `.env.*` except `.env.example`
- real database files
- database dumps, backups, exports
- customer, staff, payment, or invoice data
- bank secrets, integration secrets, service/API tokens

## Secret Handling

- Passwords/PINs are hashed only.
- Provider secrets are encrypted at rest or held in environment/secret manager.
- Full card PAN/CVV is never stored.
- Bank account numbers are masked in UI.
- Token creation, rotation, and deletion are audited.

## Network Boundaries

- Databases are never public.
- Backend accepts traffic only from trusted LAN/VPN/proxy origins.
- Optional gateways proxy API/realtime only and avoid sensitive body logging.
- Hardware agent binds to loopback and requires a shared token for write routes.

## Access Control

- Every sensitive action has a permission guard.
- Branch-scoped data uses the authenticated branch context.
- Privileged changes write audit logs.
- Orders, payments, inventory, and settings use append-only history patterns.

## Client Rules

- Native apps receive connection targets and user-scoped tokens only.
- No direct database connection from clients.
- No backend service secrets in client code or local config.
- Client UI must show pending/synced/failed states honestly.
