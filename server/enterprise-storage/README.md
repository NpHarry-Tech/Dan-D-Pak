# Enterprise Storage

This folder stores JSON backup copies for system, branch, and user-scoped
configuration.

## Rules

- Treat files here as read-only backups.
- Mutations must go through authenticated backend APIs so SQLite and archive
  storage stay consistent.
- Do not commit real customer, staff, payment, or secret data.
- The `users/` folder may contain sensitive preferences and must stay private.

## API Shape

```text
GET  /storage/system
GET  /storage/system/:key
PUT  /storage/system/:key

GET  /storage/branch
GET  /storage/branch/:key
PUT  /storage/branch/:key

GET  /storage/user/preferences
GET  /storage/user/preferences/:key
PUT  /storage/user/preferences/:key
POST /storage/user/preferences
```

Native apps should call these endpoints through authenticated API clients.
