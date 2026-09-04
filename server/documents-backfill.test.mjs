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
const { migrate, db, now, uid, audit } = await import('./db.js');
const { backfillDocuments, backfillAudit } = await import('./services/documentsBackfill.js');
const {
  saveDocumentReference, resolveReferenceContent, registerStorageFileDocument,
  registerStorageFileOrRollback, storeDmsUpload, WAREHOUSE_IMPORT_PERMS,
} = await import('./modules/documents/routes.js');
const { processUpdateEvent } = await import('./modules/appRelease/routes.js');
const { canUser } = await import('./services/auth.js');
const { storagePath } = await import('./config/env.js');
const { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } = await import('node:fs');
const { join: pjoin } = await import('node:path');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_EXT = { [XLSX_MIME]: '.xlsx' };
const b64 = (s) => Buffer.from(s).toString('base64');
const uploadsDoc = (stored) => storagePath('uploads', 'documents', stored);

const successRows = () =>
  db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE action='app.update_success'`).get().c;

migrate();

function seedDrawer({ image, actor = 'Anh Ba' }) {
  const id = uid('drw_');
  db.prepare(`INSERT INTO cash_drawer_entries (id,branch_id,kind,occurred_at,counterparty,reason,product,invoice_image,actor_name,amount,balance_before,balance_after,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, 'sala', 'expense', now(), 'NCC B', 'Mua đá', 'Đá cây', image, actor, 50000, 0, -50000, now());
  return id;
}

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

test('#2 drawer-receipt reference resolves for preview/download (not 410)', () => {
  const png = dataUrl('drawer-receipt');
  const drw = seedDrawer({ image: png });
  const rec = saveDocumentReference({
    branch_id: 'sala', module: 'cash_drawer_expense', field: 'invoice_image', record_id: drw,
    record_label: 'Chi từ két', category: 'receipt', source: 'cash_drawer_expense',
    uploaded_by: 'u', uploaded_by_name: 'Anh Ba', uploaded_at: now(),
    source_screen: 'Sổ quỹ / Két', value: png,
  });
  assert.equal(rec.storage_kind, 'reference');
  assert.equal(rec.ref_locator, `cash_drawer_expense:invoice_image:${drw}`);
  const resolved = resolveReferenceContent(rec, 'sala');
  assert.ok(resolved, 'drawer receipt must resolve, not 410');
  assert.equal(resolved.buf.toString(), 'drawer-receipt');
});

test('#3 reference updates mime/size/status when the source image changes + no-op when same', () => {
  const eid = seedExpense({ code: 'CP-CHG', image: dataUrl('v1') });
  const first = saveDocumentReference({
    branch_id: 'sala', module: 'expense', field: 'invoice_image', record_id: eid,
    name: 'Hóa đơn chi CP-CHG', source: 'expense', value: dataUrl('v1'),
  });
  const firstSize = first.file_size;
  // same value again -> idempotent no-op (row unchanged)
  const same = saveDocumentReference({
    branch_id: 'sala', module: 'expense', field: 'invoice_image', record_id: eid,
    name: 'Hóa đơn chi CP-CHG', source: 'expense', value: dataUrl('v1'),
  });
  assert.equal(same.id, first.id);
  assert.equal(same.file_size, firstSize);
  // source image changes -> reference updates size/mime/status, same id
  db.prepare(`UPDATE expenses SET invoice_image=? WHERE id=?`).run(dataUrl('v2-longer-bytes', 'image/jpeg'), eid);
  const changed = saveDocumentReference({
    branch_id: 'sala', module: 'expense', field: 'invoice_image', record_id: eid,
    name: 'Hóa đơn chi CP-CHG', source: 'expense', value: dataUrl('v2-longer-bytes', 'image/jpeg'),
  });
  assert.equal(changed.id, first.id, 'same document row (no duplicate)');
  assert.equal(changed.mime_type, 'image/jpeg');
  assert.notEqual(changed.file_size, firstSize);
  assert.equal(resolveReferenceContent(changed, 'sala').buf.toString(), 'v2-longer-bytes');
});

test('#4 storage_file (product image) registers + resolves from uploads, rejects traversal', () => {
  const dir = storagePath('uploads', 'products');
  mkdirSync(dir, { recursive: true });
  const fname = 'product_test.png';
  writeFileSync(join(dir, fname), Buffer.from('PNGDATA'));
  const rec = registerStorageFileDocument({
    branch_id: 'sala', name: 'anh-sp.png', original_name: 'anh-sp.png',
    mime_type: 'image/png', file_size: 7, storageRelPath: `products/${fname}`,
    source: 'warehouse', source_screen: 'Kho — Ảnh sản phẩm', category: 'product_image',
    uploaded_by: 'u1', uploaded_by_name: 'Chị Kho',
  });
  assert.equal(rec.storage_kind, 'storage_file');
  const resolved = resolveReferenceContent(rec, 'sala');
  assert.ok(resolved);
  assert.equal(resolved.buf.toString(), 'PNGDATA');
  // path traversal must be rejected
  const evil = { storage_kind: 'storage_file', ref_locator: '../../etc/passwd', mime_type: 'text/plain' };
  assert.equal(resolveReferenceContent(evil, 'sala'), null);
  // missing file -> null (caller returns 410, no crash)
  const gone = { storage_kind: 'storage_file', ref_locator: 'products/does-not-exist.png', mime_type: 'image/png' };
  assert.equal(resolveReferenceContent(gone, 'sala'), null);
});

// ── #1 update-event FAIL-CLOSED (runtime) ───────────────────────────────────
test('#1 update-event: valid header==toBuild logs success', () => {
  const before = successRows();
  const r = processUpdateEvent({
    headers: { 'x-build-number': '170' },
    body: { fromBuild: 169, toBuild: 170, version: '2026.09.03.01', key: 'k_ok_1' },
    branch_id: 'sala', actor: 'admin',
  });
  assert.equal(r.logged, true);
  assert.equal(successRows(), before + 1);
});

test('#1 update-event: MISSING build header never audits', () => {
  const before = successRows();
  const r = processUpdateEvent({ headers: {}, body: { fromBuild: 169, toBuild: 170, key: 'k_missing' }, branch_id: 'sala' });
  assert.equal(r.ignored, 'missing-build-header');
  assert.equal(successRows(), before, 'no audit row written');
});

test('#1 update-event: INVALID build header never audits', () => {
  const before = successRows();
  const r = processUpdateEvent({ headers: { 'x-build-number': 'abc' }, body: { toBuild: 170, key: 'k_invalid' }, branch_id: 'sala' });
  assert.equal(r.ignored, 'invalid-build-header');
  assert.equal(successRows(), before);
});

test('#1 update-event: MISMATCH header != toBuild never audits', () => {
  const before = successRows();
  const r = processUpdateEvent({ headers: { 'x-build-number': '169' }, body: { toBuild: 170, key: 'k_mismatch' }, branch_id: 'sala' });
  assert.equal(r.ignored, 'build-mismatch');
  assert.equal(successRows(), before);
});

test('#1 update-event: idempotent by key (same key twice -> one row)', () => {
  const before = successRows();
  const body = { fromBuild: 169, toBuild: 170, key: 'k_dupe' };
  const h = { 'x-build-number': '170' };
  assert.equal(processUpdateEvent({ headers: h, body, branch_id: 'sala' }).logged, true);
  assert.equal(processUpdateEvent({ headers: h, body, branch_id: 'sala' }).deduped, true);
  assert.equal(successRows(), before + 1);
});

// ── #2 reference content-hash change detection ──────────────────────────────
test('#2 different bytes, SAME mime & SAME length -> same doc updated + hash changes; same bytes -> no update', () => {
  const eid = seedExpense({ code: 'CP-HASH', image: dataUrl('AAAA') }); // 4 bytes
  const a = saveDocumentReference({ branch_id: 'sala', module: 'expense', field: 'invoice_image', record_id: eid, name: 'x', source: 'expense', value: dataUrl('AAAA') });
  const h1 = a.ref_content_hash;
  assert.ok(h1, 'hash stored for reference');
  // same bytes again -> no update (id + hash identical)
  const same = saveDocumentReference({ branch_id: 'sala', module: 'expense', field: 'invoice_image', record_id: eid, name: 'x', source: 'expense', value: dataUrl('AAAA') });
  assert.equal(same.ref_content_hash, h1);
  // different content, SAME mime (image/png) and SAME byte length (4) -> must update
  db.prepare(`UPDATE expenses SET invoice_image=? WHERE id=?`).run(dataUrl('BBBB'), eid);
  const changed = saveDocumentReference({ branch_id: 'sala', module: 'expense', field: 'invoice_image', record_id: eid, name: 'x', source: 'expense', value: dataUrl('BBBB') });
  assert.equal(changed.id, a.id, 'same document id');
  assert.notEqual(changed.ref_content_hash, h1, 'hash changed even though mime+length identical');
  assert.equal(changed.file_size, a.file_size, 'byte length identical (proves hash, not size, detected it)');
});

// ── #3 storage_file registration failure -> NO orphan file ──────────────────
test('#3 registration failure deletes the file (no orphan, no partial entry)', () => {
  const dir = storagePath('uploads', 'products');
  mkdirSync(dir, { recursive: true });
  const abs = pjoin(dir, 'orphan_test.png');
  writeFileSync(abs, Buffer.from('DATA'));
  assert.equal(existsSync(abs), true);
  // branch_id null -> NOT NULL constraint -> registration throws
  assert.throws(() => registerStorageFileOrRollback({
    absFile: abs,
    doc: { branch_id: null, original_name: 'x.png', mime_type: 'image/png', file_size: 4, storageRelPath: 'products/orphan_test.png', source: 'warehouse' },
  }));
  assert.equal(existsSync(abs), false, 'file rolled back (deleted) on registration failure');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM document_files WHERE ref_locator='products/orphan_test.png'`).get().c, 0, 'no document row left');
});

// ── #4 product-image backfill (metadata recovery, legacy, missing, orphan, idempotent) ──
test('#4 product-image backfill indexes uploads/products with metadata + legacy/missing + idempotent', () => {
  const dir = storagePath('uploads', 'products');
  mkdirSync(dir, { recursive: true });
  writeFileSync(pjoin(dir, 'product_withmeta.png'), Buffer.from('IMG1'));
  // sku with audit metadata
  const s1 = uid('sku_');
  db.prepare(`INSERT INTO skus (id,branch_id,code,name,image,price) VALUES (?,?,?,?,?,?)`).run(s1, 'sala', 'SP01', 'Cà phê', '/uploads/products/product_withmeta.png', 0);
  db.prepare(`INSERT INTO audit_log (id,branch_id,actor,action,detail,created_at) VALUES (?,?,?,?,?,?)`)
    .run(uid('a_'), 'sala', 'Chị Kho', 'sku.image_upload', JSON.stringify({ url: '/uploads/products/product_withmeta.png', original_name: 'anh-ca-phe.png', size: 4 }), now());
  // sku whose file is missing on disk, no audit -> legacy + missing
  const s2 = uid('sku_');
  db.prepare(`INSERT INTO skus (id,branch_id,code,name,image,price) VALUES (?,?,?,?,?,?)`).run(s2, 'sala', 'SP02', 'Trà', '/uploads/products/product_gone.png', 0);
  // an orphan file (no sku points to it)
  writeFileSync(pjoin(dir, 'product_orphan.png'), Buffer.from('ORPH'));

  const run = backfillDocuments({ branchId: 'sala' });
  assert.equal(run.byModule.sku_image.indexed, 2);
  const d1 = db.prepare(`SELECT * FROM document_files WHERE related_type='sku_image' AND related_id=?`).get(s1);
  assert.equal(d1.storage_kind, 'storage_file');
  assert.equal(d1.original_name, 'anh-ca-phe.png');   // recovered from audit
  assert.equal(d1.uploaded_by_name, 'Chị Kho');
  assert.equal(d1.is_legacy, 0);
  assert.equal(d1.status, 'available');
  assert.equal(resolveReferenceContent(d1, 'sala').buf.toString(), 'IMG1');
  const d2 = db.prepare(`SELECT * FROM document_files WHERE related_type='sku_image' AND related_id=?`).get(s2);
  assert.equal(d2.is_legacy, 1);
  assert.equal(d2.uploaded_by_name, 'Không xác định');
  assert.equal(d2.status, 'missing');
  assert.ok(run.orphan >= 1, 'orphan files counted (not deleted)');
  assert.equal(existsSync(pjoin(dir, 'product_orphan.png')), true, 'orphan NOT deleted');

  const run2 = backfillDocuments({ branchId: 'sala' });
  assert.equal(run2.byModule.sku_image.indexed, 0, 'second run creates no product-image duplicates');
  assert.ok(run2.byModule.sku_image.skipped >= 2);
});

// ── #3 /documents/upload atomic + idempotent (via storeDmsUpload) ───────────
const actorObj = { username: 'kho1', id: 'u_kho1', name: 'Chị Kho' };

test('#3 storeDmsUpload: success writes file + row; download bytes match', () => {
  const rec = storeDmsUpload({
    branch_id: 'sala', actor: actorObj, secureMimeExt: XLSX_EXT,
    body: { data: b64('EXCEL-CONTENT-1'), original_name: 'nhap-hang.xlsx', mime_type: XLSX_MIME, source_screen: 'Kho — Nhập dữ liệu' },
  });
  assert.ok(rec.stored_name, 'file stored');
  assert.equal(rec.source_screen, 'Kho — Nhập dữ liệu');
  assert.equal(existsSync(uploadsDoc(rec.stored_name)), true);
  assert.equal(readFileSync(uploadsDoc(rec.stored_name)).toString(), 'EXCEL-CONTENT-1'); // download bytes == original
});

test('#3 storeDmsUpload: retry SAME content is idempotent (no duplicate file/row)', () => {
  const body = { data: b64('EXCEL-RETRY'), original_name: 'a.xlsx', mime_type: XLSX_MIME };
  const first = storeDmsUpload({ branch_id: 'sala', actor: actorObj, secureMimeExt: XLSX_EXT, body });
  const countBefore = db.prepare(`SELECT COUNT(*) c FROM document_files`).get().c;
  const second = storeDmsUpload({ branch_id: 'sala', actor: actorObj, secureMimeExt: XLSX_EXT, body });
  assert.equal(second.duplicate, true);
  assert.equal(second.id, first.id, 'same document row returned');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM document_files`).get().c, countBefore, 'no new row');
});

test('#3 storeDmsUpload: DB insert failure deletes the just-written file (no orphan)', () => {
  const dir = storagePath('uploads', 'documents');
  mkdirSync(dir, { recursive: true });
  const before = readdirSync(dir).length;
  // branch_id null -> saveDocumentRecord INSERT (branch_id NOT NULL) throws
  assert.throws(() => storeDmsUpload({
    branch_id: null, actor: actorObj, secureMimeExt: XLSX_EXT,
    body: { data: b64('ORPHAN-CHECK'), original_name: 'x.xlsx', mime_type: XLSX_MIME },
  }));
  assert.equal(readdirSync(dir).length, before, 'file rolled back — upload dir unchanged (no orphan)');
});

// ── #2 least-privilege: warehouse role can import-upload; module.documents NOT required ──
test('#2 warehouse permission grants import-upload without module.documents', () => {
  const whId = uid('u_');
  db.prepare(`INSERT INTO users (id,branch_id,username,name,pin,role,active) VALUES (?,?,?,?,?,?,1)`)
    .run(whId, 'sala', 'wh_' + whId, 'NV Kho', '0000', 'zzz_test_role');
  db.prepare(`INSERT OR REPLACE INTO user_perms (user_id,perm,mode) VALUES (?,?,?)`).run(whId, 'warehouse.item', 'allow');
  const wh = { id: whId, role: 'zzz_test_role' };
  assert.equal(WAREHOUSE_IMPORT_PERMS.some((p) => canUser(wh, p)), true, 'warehouse.item satisfies import-upload guard');
  assert.equal(canUser(wh, 'module.documents'), false, 'does NOT have the broad admin doc permission');

  const noneId = uid('u_');
  db.prepare(`INSERT INTO users (id,branch_id,username,name,pin,role,active) VALUES (?,?,?,?,?,?,1)`)
    .run(noneId, 'sala', 'none_' + noneId, 'NV Bán', '0000', 'zzz_test_role');
  db.prepare(`INSERT OR REPLACE INTO user_perms (user_id,perm,mode) VALUES (?,?,?)`).run(noneId, 'sell', 'allow');
  const none = { id: noneId, role: 'zzz_test_role' };
  assert.equal(WAREHOUSE_IMPORT_PERMS.some((p) => canUser(none, p)), false, 'non-warehouse staff blocked');
});

// ── #4 product-image upload ordering: failure -> no file, no document, NO fake audit ──
test('#4 registration failure leaves no file, no document row, and NO success audit', () => {
  const dir = storagePath('uploads', 'products');
  mkdirSync(dir, { recursive: true });
  const abs = pjoin(dir, 'atomic_fail.png');
  writeFileSync(abs, Buffer.from('IMG'));
  const auditsBefore = db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE action='sku.image_upload'`).get().c;
  // Replicate saveBase64Image ordering: rollback register FIRST, audit only AFTER success.
  assert.throws(() => {
    registerStorageFileOrRollback({ absFile: abs, doc: { branch_id: null, original_name: 'x', mime_type: 'image/png', file_size: 3, storageRelPath: 'products/atomic_fail.png', source: 'warehouse' } });
    audit('sku.image_upload', { url: '/uploads/products/atomic_fail.png' }, 'sala', 'kho'); // unreachable
  });
  assert.equal(existsSync(abs), false, 'file deleted on failure');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM document_files WHERE ref_locator='products/atomic_fail.png'`).get().c, 0, 'no document row');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE action='sku.image_upload'`).get().c, auditsBefore, 'NO fake success audit');
});
