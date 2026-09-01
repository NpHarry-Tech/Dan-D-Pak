# Environment

Last updated: 2026-07-13

Backend environment belongs to `server/` and deployment scripts. Flutter app API base URLs are app runtime configuration, not static HTML runtime config.

## Backend

Use `.env`/process environment for server settings such as JWT/session secrets, ports, database paths, integration keys, and backup retention.

## Flutter Apps

The native apps resolve backend URLs through their app services/local settings. Keep customer/company data on the server; clients only store local runtime configuration and session state needed for operation.