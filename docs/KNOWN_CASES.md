# Known Cases

Last updated: 2026-06-27

## Static `/admin` Route Returned 404

- Cause: static file was `admin.html`, not `/admin` route.
- Fix: serve the static route from Express or use `/admin.html` directly.
- Affected files: `server/index.js`, `web/admin.html`.
- Status: documented.

## Admin Page Loaded But API Returned HTTP 404

- Cause: frontend and backend were split across different origins.
- Fix: use same-origin `/api` through the app server or VPS gateway; configure frontend `API_BASE_URL` only when required.
- Affected files: `web/runtime-config.js`, `web/js/core/apiClient.js`.
- Status: documented.

## cPanel DNS/Subdomain Issue

- Cause: cPanel/Viettel DNS was not suited for fast temporary demo and could affect the Deron domain.
- Decision: avoid cPanel/Deron domain for temporary demo.
- Status: documented.

## Hosted Demo Stack Is Not Final Production Stack

- Cause: the earlier split hosted demo infrastructure is not the production architecture.
- Fix: create VPS-ready architecture and deployment docs.
- Status: documented.

## Protected Files Were Tracked

- Cause: local database/archive files existed in git before safety hardening.
- Fix: expand `.gitignore` and remove protected files from git index only.
- Status: remediation planned/executed in this pass.

Future issues must be appended here with cause, fix, affected files, and status.
