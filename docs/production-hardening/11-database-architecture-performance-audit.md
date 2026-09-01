# Production database, architecture and performance audit

Audit date: 2026-08-09 (Asia/Saigon)  
Scope: production SQLite database on `42.96.18.70` and the current local source tree.  
Method: read-only SQL/PRAGMA inspection on production plus static source inspection. No migration, checkpoint, VACUUM, ANALYZE, delete, update, restart, or deployment was performed.

## Executive conclusion

The database is physically healthy but not structurally hardened enough for production growth. `PRAGMA quick_check` is `ok`, every table has a primary key, and no internal corruption was found. The main risks are logical integrity and write amplification: all 62 tables have zero declared foreign keys, the live connection reports `foreign_keys=OFF`, migration state has two competing mechanisms, large base64 images are embedded in settings and invoice snapshots, webhook success payloads dominate the database, and 97 sync triggers enqueue duplicate work.

The current database is 110,227,456 bytes, with a 32,968,272-byte WAL. Only 35 of 26,911 database pages are free, so the size is real live content rather than reclaimable fragmentation. The largest single table is `sync_logs` at about 60.44 MiB.

Do not enable foreign keys, drop indexes, rewrite snapshots, or purge logs directly on production. Each requires a tested migration, backup, dry run, and rollback plan.

## Verified production facts

| Area | Result | Assessment |
|---|---:|---|
| SQLite | 3.40.1, WAL, `synchronous=FULL` | Durable baseline |
| Integrity | `quick_check=ok` | Healthy physical file |
| Schema | 62 tables, 82 indexes, 97 triggers | Large trigger-driven schema |
| Primary keys | 62/62 tables | Good |
| Foreign keys | 0 constraints; connection `foreign_keys=OFF` | Critical logical-integrity gap |
| Versioning | `user_version=0`; `schema_migrations` contains versions 1-3 | Conflicting/incomplete migration authority |
| File sizes | DB 110.23 MB; WAL 32.97 MB | WAL needs workload-aware monitoring |
| Free pages | 35/26,911 | VACUUM would currently recover almost nothing |
| Connection tuning | `busy_timeout=0`, cache about 2 MiB, `mmap_size=0`, autocheckpoint 1,000 pages | Conservative defaults; contention risk |

## Where the data is concentrated

| Object/column | Measured size | Cause | Recommended shape |
|---|---:|---|---|
| `sync_logs` | ~60.44 MiB; 12,642 rows | 54.50 MB of raw webhook bodies; 12,629 successes | Short hot retention, compact metadata, optional compressed/archive payload |
| `sync_logs`, topic `orders/updated` | 47.71 MB | 8,220 successful webhook payloads | Retain dedupe key/hash, not full success body indefinitely |
| `e_invoices.request_snapshot` | 11.71 MB total | Four old rows contain repeated base64 product images, 0.73-4.95 MB each | Immutable fiscal text/numbers only; image URL/object reference, never image bytes |
| `app_settings.customer_display` | 5.69 MB in one value | Five data-URI images; largest is ~4.13 MB | Upload assets to object/file storage; settings retain IDs/URLs and ordering |
| `print_jobs.payload_json` | 4.19 MB | Full printable payload per job | Retention + compact canonical print model; preserve only required audit data |
| `audit_log.detail` | 2.68 MB | Long-lived detailed events | Existing archive path is suitable; enforce hot/cold policy |

The four largest invoice snapshots contain the same base64 image multiple times across line items. This is both storage duplication and JSON parse/serialization overhead. Removing images from future snapshots is higher value and lower risk than rewriting historical fiscal evidence.

## Structural findings and priorities

Priority formula: `(Impact + Risk) × (6 - Effort)`, each input scored 1-5. Higher is earlier.

| Rank | Finding | Category | I | R | E | Score | Estimated effort |
|---:|---|---|---:|---:|---:|---:|---|
| 1 | No declared foreign keys and FK enforcement off | Data integrity | 5 | 5 | 3 | 30 | 4-8 engineer-days plus staged migration |
| 2 | Base64 media embedded in settings and invoice snapshots | Performance/storage | 5 | 4 | 2 | 36 | 2-4 days for future writes; historical cleanup separate |
| 3 | Successful webhook payload retention dominates DB | Performance/operations | 5 | 4 | 2 | 36 | 1-3 days plus retention approval |
| 4 | Sync triggers do not semantically deduplicate queue entries | Correctness/performance | 4 | 4 | 2 | 32 | 2-4 days |
| 5 | Migration authority is split (`user_version=0` vs table versions) | Maintainability/risk | 4 | 5 | 3 | 27 | 2-4 days |
| 6 | `busy_timeout=0` and very small default cache | Concurrency/performance | 4 | 4 | 2 | 32 | 1 day plus load test |
| 7 | Exact/redundant indexes increase writes and file size | Performance | 3 | 3 | 1 | 30 | 0.5-1 day after plan verification |
| 8 | Large service/UI files combine many responsibilities | Maintainability/performance delivery | 4 | 3 | 3 | 21 | Incremental, 2-10 days per domain |
| 9 | Operational docs describe a different DB topology | Operations | 4 | 4 | 2 | 32 | 1-2 days |

Scores prioritize value, not permission to modify production.

### Foreign-key remediation order

Add constraints in dependency slices, not all at once:

1. Order money path: `orders -> order_items`, `orders -> payments -> payment_lines`, `orders -> e_invoices/invoices`, allocations and invoice audit.
2. Inventory path: documents -> lines, SKU/item/warehouse/lot -> stock movements.
3. Procurement path: purchase orders/returns -> lines/payments.
4. Identity/config path: branches -> users/settings/preferences and branch-scoped records.

Before each slice: encode intended `ON DELETE` behavior, scan orphans with explicit joins, repair/quarantine anomalies, rebuild tables in a copy, run integration tests, and only then enable `foreign_keys=ON` for every connection. Turning the PRAGMA on before constraints exist provides no protection.

### Index findings

High-confidence candidates for removal after `EXPLAIN QUERY PLAN` and a backup:

- `idx_audit_branch_created(branch_id, created_at DESC)` and `idx_audit_branch_time(branch_id, created_at)` are the same B-tree ordering for SQLite traversal purposes. Keep one. Together they consume roughly 2.76 MiB.
- `idx_haravan_sync_state_shop_resource` duplicates the table's unique auto-index on the same columns.
- `idx_customers_code` overlaps the partial unique index but is not automatically removable: rows with null/empty code and query predicates must be checked first.
- Prefix indexes on `enterprise_storage`, `price_book_items`, `user_preferences`, and `orders` may still support narrower queries. Measure rather than deleting them by shape alone.

### Sync write amplification

There are 97 triggers, generally insert/update triggers on 41 tables. Each writes a new random `sync_queue.id`; consequently `INSERT OR IGNORE` cannot collapse repeated changes to the same entity unless another semantic unique constraint exists. The current queue has 1,000 completed rows, with 63 duplicate groups and 464 extra rows by `(branch_id, kind, ref, status)`.

Recommended design:

- Add a semantic unique key for active work, such as a partial unique index on `(branch_id, kind, ref)` where status is pending, or use a deterministic queue key.
- Use UPSERT to refresh the pending timestamp/version rather than add another row.
- Do not enqueue updates when sync-relevant fields did not change.
- Separate an outbox/event sequence from the operational retry queue if a complete history is required.

## Runtime tuning assessment

- Keep WAL and `synchronous=FULL` until durability requirements are explicitly changed.
- Add and test a finite `busy_timeout` for every connection; zero means transient writer contention fails immediately.
- Benchmark a larger negative `cache_size` and nonzero `mmap_size` against actual RAM/container limits. These are workload settings, not universal fixes.
- The 1,000-page autocheckpoint is normal. A large live WAL can indicate long-lived readers or sustained writes; monitor checkpoint age and reader duration before changing it.
- Do not run VACUUM now for “optimization”: only 35 pages are free, so expected recovery is negligible and it would create unnecessary production I/O.
- Run `ANALYZE` only in a maintenance-tested deployment and verify plans before/after; it was intentionally not run during this audit.

## Modules that are too concentrated

Measured against the current local working tree (which contains uncommitted work):

| File | Lines | Approx. functions | Suggested boundaries |
|---|---:|---:|---|
| `server/services/printing.js` | 2,870 | 128 | job lifecycle, routing, template/rendering, ESC/POS encoding, device/agent transport |
| `server/db.js` | 1,595 | 7 | connection/config, canonical migrations, schema modules, indexes/triggers, seed/backfill |
| `server/services/inventory.js` | 1,563 | 88 | documents, stock ledger, lots, stocktake, validation/query repository |
| `server/services/reportCenter.js` | 1,473 | 67 | report definitions, query layer, aggregations, export/formatting |
| `server/services/payments.js` | 1,252 | 51 | payment orchestration, provider/webhook, allocations, reconciliation |
| `server/services/einvoice.js` | 902 | 16 | state machine, provider adapter, snapshot builder, retry worker, audit |
| `phone_sell_screen.dart` | 2,523 | UI | controller/state, cart, product grid, checkout/navigation sections |
| `retail_screen.dart` | 2,332 | UI | screen shell, catalog, cart, customer, checkout orchestration |
| `warehouse_screen_methods.dart` | 1,927 | UI/domain | stocktake, documents, transfers, queries and dialogs by workflow |
| `translation_map.dart` | 3,190 | generated/static data | Generate per locale/feature; do not hand-maintain one giant map |

Splitting should preserve public APIs first, move pure functions and adapters with characterization tests, then separate stateful orchestration. A line-count-only rewrite would add risk without improving runtime.

## Phased remediation plan

### Phase 0 — measurement and guardrails (1-2 days)

- Add DB metrics: file/WAL bytes, write latency, busy/locked errors, checkpoint age, queue depth/age, payload bytes by table/topic.
- Establish one canonical migration runner and record schema checksum/version.
- Create production-copy tests for migrations and rollback.

### Phase 1 — low-risk size and speed wins (2-5 days)

- Stop storing base64 media in new customer-display settings and new invoice snapshots.
- Introduce a documented `sync_logs` success-retention policy; retain failures longer and preserve hashes/dedupe metadata.
- Add `busy_timeout` consistently and load-test.
- Verify query plans and remove only exact redundant indexes.

Expected result: future database growth falls sharply; JSON/API payloads become much lighter; write cost drops modestly. Exact percentage requires before/after workload measurement.

### Phase 2 — queue and schema correctness (1-2 weeks)

- Add semantic pending-work deduplication and idempotent UPSERT behavior.
- Make migrations authoritative and repeatable.
- Introduce foreign keys one dependency slice at a time after orphan scans.
- Add semantic idempotency constraints for high-value ledgers such as stock movement and payment/order workflows.

### Phase 3 — modularization (incremental)

- Start with printing because it has the largest server surface and highest change coupling.
- Split DB bootstrap/migrations before further schema evolution.
- Then separate inventory, payments/e-invoice, and report domains.
- Split Flutter screens around controller/state and independently testable widgets, not arbitrary line counts.

### Phase 4 — capacity decision

SQLite remains viable for a single-writer service at the current data size if the above issues are corrected and contention stays low. Consider PostgreSQL only when measured concurrent-write demand, multi-instance deployment, analytical workload, or operational requirements exceed SQLite's model. A database engine migration should not substitute for fixing payload bloat, idempotency, retention, or schema ownership.

## Acceptance criteria before production changes

- Restorable backup verified; migration tested against a production copy.
- `quick_check=ok`, orphan scans clean, and critical row counts/reconciliations unchanged.
- Representative `EXPLAIN QUERY PLAN` results recorded before/after index changes.
- Checkout, payment, invoice, inventory, print, sync and restart regression tests pass.
- Load test shows no increase in p95/p99 latency or `SQLITE_BUSY` errors.
- Health check and rollback image/database paths are recorded in the deployment log.

## Remediation evidence — local source/copy, 2026-08-09

The production facts above remain the read-only baseline from the old deployed image. The current
local source now implements the following; none of these statements imply production deployment:

- Canonical `PRAGMA user_version=6` plus `schema_meta`; the legacy migrations table is history only.
- `busy_timeout=5000`, `synchronous=FULL`, 64 MiB negative cache, 128 MiB mmap and WAL checkpoint policy.
- Semantic unique pending queue key and UPSERT-like trigger behavior; completed queue retention is bounded.
- Future e-invoice snapshots exclude base64 images; customer-display data URIs have a backed-up materialization path.
- Haravan success payload, print-job and completed outbox retention policies have fail-closed maintenance tooling.
- One shared integrity relation list drives both scanner and SQLite triggers. It currently covers 31
  money, invoice, inventory, procurement, cash-allocation, warehouse, category, table and lot relations;
  it blocks new/updated orphans and deletion/key mutation of referenced parents without rewriting history.
- The exact redundant Haravan index and legacy duplicate `idx_audit_branch_time` are dropped by the
  additive migration; production-copy plan comparison remains mandatory before rollout.
- Schema v6 adds measured composite indexes for rolling-year history, branch/order invoice lookup
  and shift payments. History page enrichment is batched (one base query plus three page-wide
  queries) instead of three extra statements per bill; at the 200-row page cap this removes the
  former 601-statement N+1 pattern. `EXPLAIN QUERY PLAN` regressions pin all three hot indexes.
- Pricing no longer queries SKU metadata for every combo×line or lot metadata for every line;
  two cart-wide preloads feed the authoritative 1,200-case engine. Shift reporting fetches all bill
  payment lines once, and cash-drawer pages bulk-resolve reimbursement totals/links with branch-aware
  keys, removing another pair of unbounded N+1 paths without changing stored rows.

Local-copy rehearsal evidence:

- Source/backup: 1,040,384 bytes, 254 pages; backup SHA-256 remained unchanged.
- Working copy after retention/VACUUM/checkpoint: 1,019,904 bytes, 249 pages, WAL 0.
- All 63 table row counts were unchanged except `sync_queue`: 199 → 137 by removing exactly 62
  old `done` rows. All 54 `pending` rows were retained.
- Before and after: `quick_check=ok`, 31 relations checked, zero logical orphans.

Still mandatory: repeat this rehearsal on a freshly acquired production backup, review every count
and orphan finding independently, then restore-test it before any production migration.
