// §4 document registry — backfill/hook fixture test. SELF-ISOLATES on a fresh temp
// DB (như các test DB khác) — không bao giờ chạm production. Đặt SQLITE_PATH TRƯỚC
// khi import db.js.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const _tmp = mkdtempSync(join(tmpdir(), 'dandpak-docbackfill-'));
process.env.SQLITE_PATH = join(_tmp, 'store.db');
process.env.STORAGE_PATH = join(_tmp, 'storage');
// TẤT CẢ import chạm db.js phải là DYNAMIC và SAU khi đặt env — vì connection.js
// khoá DB_PATH ngay lúc import (const DB_PATH = resolveDbPath()), còn `import`
// tĩnh bị hoisted lên trước cả dòng đặt env → sẽ mở nhầm DB mặc định.
const { migrate, db, now, uid } = await import('./db.js');
const { backfillDocuments, backfillAudit } = await import('./services/documentsBackfill.js');
const { saveDocumentReference, resolveReferenceContent } = await import('./modules/documents/routes.js');

migrate();

function seedExpense({ code, image, actor = 'Chị Hoa', drawer = null }) {
  const id = uid('exp_');
  db.prepare(`INSERT INTO expenses (id,branch_id,code,category_name,payee_name,source,method,amount,expense_date,note,invoice_image,drawer_entry_id,actor_name,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, 'sala', code, 'Marketing', 'NCC A', drawer ? 'drawer' : 'direct', 'bank', 1000, now(), 'note', image, drawer, actor, now(), now());
  return id;
}
const dataUrl = (txt, mime = 'image/png') => `data:${mime};base64,` + Buffer.from(txt).toString('base64');

test('backfill indexes direct-expense receipts, skips drawer, flags legacy + missing', () => {
  const good = seedExpense({ code: 'CP-1', image: dataUrl('receipt-1') });
  const legacy = seedExpense({ code: 'CP-2', image: dataUrl('receipt-2'), actor: '' });     // no uploader → legacy
  const broken = seedExpense({ code: 'CP-3', image: 'data:image/png;base64,' });               // empty payload → missing
  seedExpense({ code: 'CP-4', image: dataUrl('drawer-1'), drawer: 'drw_1' });                 // drawer → skipped by WHERE

  const dry = backfillDocuments({ branchId: 'sala', dryRun: true });
  assert.equal(dry.scanned >= 3, true);
  assert.equal(dry.byModule.expense.indexed, 3);       // 3 direct expenses (drawer excluded)
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM document_files`).get().c, 0, 'dry-run writes nothing');

  const run = backfillDocuments({ branchId: 'sala' });
  assert.equal(run.byModule.expense.indexed, 3);
  assert.equal(run.legacy >= 1, true, 'legacy counted when uploader missing');
  assert.equal(run.missing >= 1, true, 'missing counted when content undecodable');

  const goodDoc = db.prepare(`SELECT * FROM document_files WHERE related_type='expense' AND related_id=?`).get(good);
  assert.equal(goodDoc.storage_kind, 'reference');
  assert.equal(goodDoc.ref_locator, `expense:invoice_image:${good}`);
  assert.equal(goodDoc.uploaded_by_name, 'Chị Hoa');
  assert.equal(goodDoc.is_legacy, 0);
  assert.equal(goodDoc.status, 'available');

  const legacyDoc = db.prepare(`SELECT * FROM document_files WHERE related_type='expense' AND related_id=?`).get(legacy);
  assert.equal(legacyDoc.is_legacy, 1);
  assert.equal(legacyDoc.uploaded_by_name, 'Không xác định');

  const brokenDoc = db.prepare(`SELECT * FROM document_files WHERE related_type='expense' AND related_id=?`).get(broken);
  assert.equal(brokenDoc.status, 'missing');

  // content round-trips through the reference resolver (no copy on disk)
  const resolved = resolveReferenceContent(goodDoc, 'sala');
  assert.equal(resolved.buf.toString(), 'receipt-1');
});

test('backfill is idempotent — a second run creates no duplicates', () => {
  const before = db.prepare(`SELECT COUNT(*) c FROM document_files`).get().c;
  const run2 = backfillDocuments({ branchId: 'sala' });
  const after = db.prepare(`SELECT COUNT(*) c FROM document_files`).get().c;
  assert.equal(after, before, 'no new rows on re-run');
  assert.equal(run2.indexed, 0);
  assert.equal(run2.skipped >= 3, true);
});

test('saveDocumentReference does not clobber an existing (copy-mode) doc for the same record', () => {
  const eid = seedExpense({ code: 'CP-9', image: dataUrl('x') });
  // simulate an existing COPY-mode DMS entry (like fileCashDrawerReceipt) for this record
  db.prepare(`INSERT INTO document_files (id,branch_id,name,original_name,stored_name,mime_type,file_size,category,source,related_id,related_type,tags_json,description,uploaded_by,uploaded_by_name,is_archived,created_at,storage_kind,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`)
    .run(uid('doc_'), 'sala', 'copy', 'copy.png', 'f_abc.png', 'image/png', 5, 'receipt', 'expense', eid, 'expense', '[]', '', 'u', 'U', now(), 'file', 'available');
  const ret = saveDocumentReference({ branch_id: 'sala', module: 'expense', field: 'invoice_image', record_id: eid, value: dataUrl('x') });
  assert.equal(ret.storage_kind, 'file', 'existing copy entry preserved, not converted to reference');
  assert.equal(ret.stored_name, 'f_abc.png');
  const count = db.prepare(`SELECT COUNT(*) c FROM document_files WHERE related_type='expense' AND related_id=?`).get(eid).c;
  assert.equal(count, 1, 'no duplicate created');
});

test('backfillAudit reports source vs indexed counts', () => {
  const a = backfillAudit({ branchId: 'sala' });
  assert.ok(a.sources.expense.sourceFiles >= 3);
  assert.ok(a.indexed >= 3);
});
