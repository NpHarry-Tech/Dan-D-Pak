# App–Web Linking

Last updated: 2026-06-20

How devices, apps, and web sessions are paired and linked to the company server.

## Tables

- `devices`
- `device_pairing_requests`
- `device_authorizations`
- `device_heartbeats`
- `device_roles`
- `device_route_assignments`
- `app_web_links`
- `app_web_link_tokens`
- `app_web_sessions`
- `client_installations`

## Workflow

1. A device/app starts pairing by scanning a QR code or entering a pairing code.
2. The company server creates a `device_pairing_request`.
3. An admin **approves** the request (if approval is required for the device role).
4. A linking token (`app_web_link_tokens`) is issued and a session
   (`app_web_sessions` / `device_sessions`) is created.
5. The pairing, approval, and session are **audited**.
6. Linking can be **revoked**; revocation ends the session and is audited.

## Stored per device

- device identity (iPad / POS / KDS / printer agent / warehouse)
- device role and branch
- device status (online/offline via `device_heartbeats`)
- route assignments (e.g. which station/printer)
- last heartbeat timestamp

## Security rules

- Linking tokens are issued by the company server, encrypted/opaque, and revocable.
- Approval gating for sensitive device roles.
- Heartbeats drive the device status shown in the UI.
- All pairing/approval/revocation actions are audited.

See [AUDIT_LOGGING.md](AUDIT_LOGGING.md) and
[DEVICE_WORKFLOWS.md](DEVICE_WORKFLOWS.md).
