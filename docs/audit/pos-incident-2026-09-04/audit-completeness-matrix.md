# Audit completeness matrix

Status: **VERIFIED (local)** on 2026-09-05 for the shared audit contract and
high-risk transactional domains.

## Shared contract

All non-technical activity entries are normalized at `buildAuditEntry` and carry:

- stable event ID plus request/correlation ID;
- actor ID, display name and role when a request actor exists;
- device ID/name, app/build/platform/OS metadata;
- branch ID and durable branch-name snapshot;
- timestamp and source;
- caller-provided reason, previous/new state and business identifiers;
- best-effort durable order/bill/table/item name, SKU, quantity and price snapshots
  when those IDs identify existing POS rows.

Secret-like fields (`authorization`, cookie, password, PIN, secret, token, private
or access key) are recursively replaced with `[REDACTED]`. Cycles, excessive depth,
oversized collections and strings are bounded before JSON persistence.

## Transaction and side-effect matrix

| Domain | Audit failure behavior | Realtime/archive behavior | Evidence |
|---|---|---|---|
| F&B order/payment | mutation, inventory, payment, table and outbox roll back | success emit after commit | `fnb-double-pay-guard.test.mjs` |
| Retail checkout | order, stock, payment and side effects roll back | success emit after commit | `fnb-double-pay-guard.test.mjs` |
| Inventory receive/issue/adjust/return and warehouse documents | mandatory audit insert participates in re-entrant transaction | audit activity/archive finalizes only if row committed | `audit-context-atomicity.test.mjs`, `inventory-transaction.test.mjs` |
| Expense create/update/delete and linked cash drawer | mandatory audit failure rolls back ledger/cash mutation | cash archive deferred and suppressed on rollback | `audit-context-atomicity.test.mjs`, `shift-report-batching.test.mjs` |
| Purchase create/confirm/receive/pay/cancel/delete/return | operations run in re-entrant transactions; nested inventory/cash joins owner transaction | audit finalization after commit | purchase paths exercised by inventory/retail regression and final isolated suite |
| Documents | file registration and audit row use savepoint; file cleanup on failure | archive/realtime after commit | existing document transaction tests |

For code already inside a transaction, `audit()` no longer swallows insertion
failure. It schedules archive and `activity:new` only after the event loop observes
the committed audit row; rollback therefore creates neither a durable false-success
archive entry nor a success event. Legacy non-transactional, low-risk configuration
callers retain archive-first behavior for compatibility.

## Operator UI

The Flutter audit detail viewer maps the shared fields to Vietnamese labels and
recognizes both legacy `__ENC__` and authenticated `__ENC_GCM__` archive values.
Raw secret material is never intentionally displayed because it is removed before
persistence.
