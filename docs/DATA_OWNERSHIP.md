# Data Ownership & Security Boundary

Last updated: 2026-06-29

## Company Server

The company server is the source of truth. It permanently owns:

- users, roles, sessions, and permissions
- branches, tables, menu, prices, and settings
- orders, order items, KDS state, payments, cash movements, invoices
- inventory, purchase, warehouse movements, stocktake records
- integrations, provider tokens, audit logs, reports, backups

## Native Clients

Flutter apps store only what is required to operate the current device:

- backend base URL
- user-scoped token/session state
- local draft or pending queue when offline support is enabled
- non-secret UI preferences

Native clients must not store backend secrets, service-role keys, database
credentials, payment provider secrets, or permanent business ledgers.

## Optional Gateway

A LAN/VPS proxy may route API and realtime traffic. It may keep short-lived,
encrypted retry events only when explicitly configured. It must not own business
data or connect directly to the database.

## Hard Rules

- PostgreSQL/SQLite files are never exposed publicly.
- Backend secrets stay server-side.
- Temporary queued business data must expire or sync back to the company server.
- Sensitive values are masked in client UI and logs.
- Every privileged mutation should be auditable.
