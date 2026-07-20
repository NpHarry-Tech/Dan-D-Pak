// Route ownership: Database Management (status, integrity-check, reset-transactions,
// decrypt-audit, docs). NHẠY CẢM: có thao tác HUỶ/tái tạo dữ liệu —
// route dời NGUYÊN VĂN, không đổi logic.
import * as Auth from '../../services/auth.js';
import { db, audit, decryptDecompress, listBackups } from '../../db.js';

export function registerDatabaseRoutes(api, { wrap, guardAny, branch }) {
// --- Database Management & Documentation APIs ---

// GET /api/database/status
api.get('/database/status', guardAny('settings.manage'), wrap(async () => {
  const fs = await import('node:fs');
  const { DB_PATH } = await import('../../db.js');

  let dbSize = 0;
  try {
    dbSize = fs.statSync(DB_PATH).size;
  } catch {}

  const configTables = [
    'branches', 'users', 'warehouses', 'categories', 'menu_items',
    'inventory_items', 'skus', 'tables', 'recipes', 'app_settings',
    'role_perms', 'user_perms', 'vouchers'
  ];

  const transactionTables = [
    'orders', 'order_items', 'payments', 'payment_lines', 'shifts',
    'cash_drawer_entries', 'purchase_orders', 'purchase_order_lines',
    'expenses', 'audit_log', 'print_jobs', 'invoices', 'bank_transactions'
  ];

  const configCounts = {};
  for (const table of configTables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get();
      configCounts[table] = row.n;
    } catch {
      configCounts[table] = 0;
    }
  }

  const transactionCounts = {};
  for (const table of transactionTables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get();
      transactionCounts[table] = row.n;
    } catch {
      transactionCounts[table] = 0;
    }
  }

  let sqliteVersion = 'Unknown';
  let journalMode = 'Unknown';
  try {
    sqliteVersion = db.prepare('SELECT sqlite_version() as v').get().v;
    journalMode = db.prepare('PRAGMA journal_mode').get().journal_mode;
  } catch {}

  let pendingSyncCount = 0;
  try {
    const row = db.prepare(`SELECT COUNT(*) as n FROM sync_queue WHERE status = 'pending'`).get();
    pendingSyncCount = row.n;
  } catch {}

  return {
    dbType: 'SQLite (node:sqlite)',
    dbPath: DB_PATH,
    dbSize,
    sqliteVersion,
    journalMode,
    configCounts,
    transactionCounts,
    pendingSyncCount,
    // Báo cáo TRUNG THỰC: trạng thái sao lưu/đồng bộ phản ánh đúng thực tế hệ thống.
    backups: (() => {
      const list = listBackups();
      return {
        provider: 'local-snapshot',
        retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS) || 14,
        count: list.length,
        latest: list[0] || null,
        dir: 'backups/',
      };
    })(),
    cloudSync: {
      mode: process.env.DATABASE_PROVIDER === 'postgres' ? 'postgres' : 'local-only',
      offsiteReplication: false,
      pending: pendingSyncCount,
      note: 'Đẩy đồng bộ ngoại vi CHƯA bật. An toàn dữ liệu dựa vào sao lưu local định kỳ (backups/) + nhật ký NDJSON fsync. Hãy copy thư mục backups/ ra ổ ngoài/VPS định kỳ.',
    },
    auditArchive: { durable: true, format: 'ndjson-fsync' },
  };
}));

// POST /api/database/integrity-check
api.post('/database/integrity-check', guardAny('settings.manage'), wrap(async () => {
  let result = 'failed';
  try {
    const row = db.prepare('PRAGMA integrity_check').get();
    result = row.integrity_check || row['integrity_check'] || 'ok';
  } catch (e) {
    result = e.message;
  }
  return { ok: result === 'ok', result };
}));

// POST /api/database/reset-transactions
api.post('/database/reset-transactions', guardAny('settings.manage'), wrap(async (req) => {
  const { pin } = req.body;
  if (!pin) throw new Error('Cần cung cấp mã PIN xác nhận.');

  const user = Auth.verifyManagerOwnerPin(pin, branch(req));
  if (!user) {
    throw new Error('Mã PIN không đúng hoặc không có quyền Admin/Manager.');
  }

  const transactionTables = [
    'orders', 'order_items', 'payments', 'payment_lines', 'shifts',
    'cash_drawer_entries', 'cash_drawer_reimbursement_allocations',
    'purchase_orders', 'purchase_order_lines', 'purchase_payments',
    'expenses', 'print_jobs', 'invoices', 'bank_transactions', 'sync_queue',
    'audit_log', 'staff_calls'
  ];

  // node:sqlite (DatabaseSync) không có .transaction() — dùng BEGIN/COMMIT/ROLLBACK.
  db.exec('BEGIN');
  try {
    for (const table of transactionTables) {
      try {
        db.exec(`DELETE FROM ${table}`);
      } catch (e) {
        console.error(`Lỗi khi dọn dẹp bảng ${table}:`, e.message);
      }
    }
    try {
      db.exec(`UPDATE tables SET status = 'free'`);
    } catch {}
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  audit('db.reset_transactions', 'Dọn dẹp toàn bộ dữ liệu giao dịch về trạng thái sạch.', branch(req), user.username);

  return { ok: true, message: 'Đã dọn dẹp sạch toàn bộ dữ liệu giao dịch thành công.' };
}));

// POST /api/database/decrypt-audit
api.post('/database/decrypt-audit', guardAny('settings.manage'), wrap(async (req) => {
  const { id } = req.body;
  if (!id) throw new Error('Cần cung cấp ID audit log.');
  const row = db.prepare(`SELECT detail FROM audit_log WHERE id = ?`).get(id);
  if (!row) throw new Error('Không tìm thấy bản ghi nhật ký hoạt động.');
  const decrypted = decryptDecompress(row.detail);
  return { decrypted };
}));

// GET /api/database/docs
api.get('/database/docs', guardAny('settings.manage'), wrap(async () => {
  return [
    { file: 'README.md', title: 'Tổng quan & Stack dự án' },
    { file: 'docs/ARCHITECTURE.md', title: 'Kiến trúc & Vùng triển khai' },
    { file: 'docs/OFFLINE_FIRST_ARCHITECTURE.md', title: 'Kiến trúc Offline-First' },
    { file: 'docs/COMPANY_DATABASE_MEMORY.md', title: 'Chính sách Bộ nhớ vĩnh viễn' },
    { file: 'docs/VPS_TEMPORARY_BUFFER.md', title: 'Bộ đệm sự kiện tạm thời VPS' },
    { file: 'docs/SYNC_BACK_TO_COMPANY_SERVER.md', title: 'Quy trình Đồng bộ ngược' }
  ];
}));

// GET /api/database/docs/:file
api.get('/database/docs/:file', guardAny('settings.manage'), wrap(async (req) => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const reqFile = req.params.file;
  const whitelist = [
    'README.md',
    'docs/ARCHITECTURE.md',
    'docs/OFFLINE_FIRST_ARCHITECTURE.md',
    'docs/COMPANY_DATABASE_MEMORY.md',
    'docs/VPS_TEMPORARY_BUFFER.md',
    'docs/SYNC_BACK_TO_COMPANY_SERVER.md'
  ];

  if (!whitelist.includes(reqFile)) {
    throw new Error('Tài liệu không nằm trong danh mục cho phép.');
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const ROOT = path.join(__dirname, '..');
  const targetPath = path.resolve(ROOT, reqFile);

  let content = '';
  try {
    content = fs.readFileSync(targetPath, 'utf8');
  } catch (e) {
    throw new Error('Không thể đọc nội dung tài liệu.');
  }

  return { file: reqFile, content };
}));

// ══════════════════════════════════════════════════════════════════════════════
// DMS — Document Management System
// POST /documents/upload     — upload 1 file (base64 trong JSON body)
// GET  /documents/files      — danh sách tài liệu
// GET  /documents/files/:id/download  — tải file
// GET  /documents/files/:id/preview   — preview (ảnh/pdf inline)
// PUT  /documents/files/:id  — cập nhật metadata
// DEL  /documents/files/:id  — xóa (cần PIN)
// ══════════════════════════════════════════════════════════════════════════════

}
