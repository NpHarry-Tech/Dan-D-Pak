// Production-safe database compaction runner. Default is read-only dry-run.
// Mutations require an explicit existing backup path; VACUUM is a separate flag.
import fs from 'node:fs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage: node server/scripts/database-compaction.mjs [options]

Default: read-only dry-run against the configured SQLite database.

  --apply-assets                  Materialize legacy customer-display data URIs
  --apply-retention               Apply tested log/print/sync retention policies
  --apply-orphan-outbox           Delete payload-less rows that no transport can send
  --apply-backfill-noise          Deduplicate legacy system_backfill buyer audit noise
  --vacuum                        VACUUM then checkpoint/truncate WAL
  --confirmed-backup=<path>       Required existing backup for every write mode
  --help, -h                      Show this help without opening the database`);
  process.exit(0);
}

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key, rest.length ? rest.join('=') : true];
}));
const applyAssets = args.has('--apply-assets');
const applyRetention = args.has('--apply-retention');
const applyOrphanOutbox = args.has('--apply-orphan-outbox');
const applyBackfillNoise = args.has('--apply-backfill-noise');
const vacuum = args.has('--vacuum');
const mutating = applyAssets || applyRetention || applyOrphanOutbox || applyBackfillNoise || vacuum;
const confirmedBackup = String(args.get('--confirmed-backup') || '');

// Dry-run mở SQLite read-only/query_only thật sự: không đổi journal mode, không
// tạo WAL và không được phép ghi kể cả khi code phía dưới có lỗi.
if (!mutating) process.env.DATABASE_READ_ONLY = 'true';

const { db, DB_PATH } = await import('../db.js');
const { scanCriticalOrphans } = await import('../db/integrity.js');
const { materializeLegacyCustomerDisplayAssets } = await import('../services/settings/customerDisplay.js');

if (mutating && (!confirmedBackup || !fs.existsSync(confirmedBackup))) {
  throw new Error('Thao tác ghi cần --confirmed-backup=<đường dẫn backup đã kiểm tra tồn tại>');
}

const scalar = (sql) => Number(Object.values(db.prepare(sql).get() || {})[0] || 0);
const hasTable = (name) => !!db.prepare(
  `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`,
).get(name);
const hasColumn = (table, column) => hasTable(table) &&
  db.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all().some((item) => item.name === column);
const edgeSchema = hasColumn('sync_queue', 'payload_json');
const before = {
  databaseBytes: fs.statSync(DB_PATH).size,
  walBytes: fs.existsSync(`${DB_PATH}-wal`) ? fs.statSync(`${DB_PATH}-wal`).size : 0,
  pageCount: scalar('PRAGMA page_count'),
  freePages: scalar('PRAGMA freelist_count'),
  quickCheck: Object.values(db.prepare('PRAGMA quick_check').get() || {})[0],
  logical: scanCriticalOrphans(db),
  syncLogs: scalar('SELECT COUNT(*) FROM sync_logs'),
  syncPayloadBytes: scalar(`SELECT COALESCE(SUM(LENGTH(raw_payload)),0) FROM sync_logs`),
  edgeOutboxPending: edgeSchema
    ? scalar(`SELECT COUNT(*) FROM sync_queue WHERE status='pending' AND payload_json IS NOT NULL`)
    : 0,
  edgeOutboxPayloadBytes: edgeSchema
    ? scalar(`SELECT COALESCE(SUM(LENGTH(payload_json)),0) FROM sync_queue WHERE status='pending'`)
    : 0,
  edgeOutboxDoneRetained: edgeSchema
    ? scalar(`SELECT COUNT(*) FROM sync_queue WHERE status='done'`)
    : 0,
  edgeInboxAcknowledged: hasTable('sync_inbox') ? scalar(`SELECT COUNT(*) FROM sync_inbox`) : 0,
  printJobs: scalar('SELECT COUNT(*) FROM print_jobs'),
  printPayloadBytes: scalar(`SELECT COALESCE(SUM(LENGTH(payload_json)),0) FROM print_jobs`),
};
const customerDisplay = materializeLegacyCustomerDisplayAssets({ dryRun: !applyAssets });
let retention = null;
if (applyRetention) {
  const { maintainHaravanLogs } = await import('../services/haravanConnector.js');
  const { maintainPrintJobs } = await import('../services/printing.js');
  const { pruneDoneQueue } = await import('../services/sync.js');
  retention = {
    haravan: maintainHaravanLogs(),
    printing: maintainPrintJobs(),
    edgeOutbox: pruneDoneQueue(),
  };
}
let orphanOutboxRemoved = 0;
if (applyOrphanOutbox && edgeSchema) {
  // payload_json=NULL is intentionally excluded by syncBatch and can never be
  // acknowledged. Source rows remain in their authoritative business tables.
  orphanOutboxRemoved = db.prepare(`DELETE FROM sync_queue WHERE payload_json IS NULL`).run().changes;
}
let backfillNoise = null;
if (applyBackfillNoise) {
  const main = db.prepare(`DELETE FROM audit_log
    WHERE actor='system_backfill' AND action='invoice.buyer_updated'`).run().changes;
  // Keep the earliest legal trace for each invoice; remove only repeated rows
  // emitted by the historical 10-second branch-key loop.
  const legal = db.prepare(`DELETE FROM invoice_audit_logs
    WHERE actor_id='system_backfill' AND action='BUYER_UPDATED'
      AND rowid NOT IN (
        SELECT MIN(rowid) FROM invoice_audit_logs
        WHERE actor_id='system_backfill' AND action='BUYER_UPDATED'
        GROUP BY e_invoice_id
      )`).run().changes;
  // A historical retry loop also attempted to allocate zero-value paid orders
  // every 10 seconds. These rows describe the retry defect, not distinct legal
  // invoice actions; retain normal ERROR_OCCURRED records from every other actor/reason.
  const zeroValueRetries = db.prepare(`DELETE FROM invoice_audit_logs
    WHERE actor_id='system_backfill'
      AND action='ERROR_OCCURRED'
      AND reason='Invoice allocation amount must be greater than zero'`).run().changes;
  backfillNoise = {
    mainActivityRemoved: main,
    repeatedLegalAuditRemoved: legal,
    zeroValueRetryErrorsRemoved: zeroValueRetries,
  };
}
let checkpoint = null;
if (vacuum) {
  db.exec('VACUUM;');
  // Trong WAL mode, VACUUM ghi các page mới vào WAL trước. Đo file ngay lúc
  // này sẽ báo sai rằng DB chưa thu nhỏ và để lại WAL lớn cho lần khởi động sau.
  // Đây là CLI maintenance có backup bắt buộc, nên checkpoint/truncate là một
  // phần của thao tác VACUUM. `busy` vẫn được báo ra để operator không hiểu nhầm.
  checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
}

const after = {
  databaseBytes: fs.statSync(DB_PATH).size,
  walBytes: fs.existsSync(`${DB_PATH}-wal`) ? fs.statSync(`${DB_PATH}-wal`).size : 0,
  pageCount: scalar('PRAGMA page_count'),
  freePages: scalar('PRAGMA freelist_count'),
  quickCheck: Object.values(db.prepare('PRAGMA quick_check').get() || {})[0],
  logical: scanCriticalOrphans(db),
};

console.log(JSON.stringify({
  mode: mutating ? 'apply' : 'dry-run',
  database: DB_PATH,
  confirmedBackup: mutating ? confirmedBackup : null,
  before,
  customerDisplay,
  retention,
  orphanOutboxRemoved,
  backfillNoise,
  vacuum,
  checkpoint,
  after,
}, null, 2));

if (after.quickCheck !== 'ok' || !after.logical.ok) process.exitCode = 2;
