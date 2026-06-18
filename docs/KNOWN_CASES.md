# Known Cases

Last updated: 2026-06-18

## Vercel `/admin` Route Returned 404

- Cause: static file was `admin.html`, not `/admin` route.
- Fix: use `/admin.html` or add a Vercel rewrite.
- Affected files: `web/vercel.json`.
- Status: documented and rewrite scaffold added.

## Admin Page Loaded But API Returned HTTP 404

- Cause: frontend on Vercel had no backend API at the same origin.
- Fix: deploy backend to Render temporarily and configure frontend `API_BASE_URL`; later use same-origin `/api` on VPS.
- Affected files: `web/runtime-config.js`, `web/js/core/apiClient.js`.
- Status: documented.

## cPanel DNS/Subdomain Issue

- Cause: cPanel/Viettel DNS was not suited for fast temporary demo and could affect the Deron domain.
- Decision: avoid cPanel/Deron domain for temporary demo.
- Status: documented.

## Temporary Stack Is Not Final Production Stack

- Cause: Vercel/Render/Supabase are temporary demo infrastructure.
- Fix: create VPS-ready architecture and deployment docs.
- Status: documented.

## Protected Files Were Tracked

- Cause: local database/archive files existed in git before safety hardening.
- Fix: expand `.gitignore` and remove protected files from git index only.
- Status: remediation planned/executed in this pass.

Future issues must be appended here with cause, fix, affected files, and status.
