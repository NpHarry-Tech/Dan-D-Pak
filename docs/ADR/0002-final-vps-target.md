# ADR 0002: Final VPS Target

Date: 2026-06-18

## Status

Accepted as production direction.

## Decision

The final target is a VPS or cloud VM running reverse proxy, Node backend, PostgreSQL, backend realtime, local/S3-compatible storage, SSL, firewall, backups, logs, and GitHub-based deployment.

## Consequences

- Keep provider seams for database, realtime, and storage.
- Add deployment docs and Docker Compose scaffold.
- Migrate data safely from SQLite/Supabase to PostgreSQL only after schema and backup plans are verified.
