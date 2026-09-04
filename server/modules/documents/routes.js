// Route ownership: Document Management (DMS) — upload/list/download/preview/update/delete.
// Cụm DMS (consts + saveDocumentRecord + fileCashDrawerReceipt) ở MODULE-LEVEL vì
// fileCashDrawerReceipt được EXPORT cho payments module dùng (lưu ảnh hóa đơn chi từ két).
import * as Auth from '../../services/auth.js';
import { db, uid, audit, now } from '../../db.js';
import { emit } from '../../realtime.js';
import { errorPayload } from '../../core/errors.js';
import fs from 'node:fs';
import nodePath from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { rateLimit } from '../../core/rateLimit.js';
import { storagePath } from '../../config/env.js';
import { matchesSearch, searchTokens } from '../../core/search.js';
import { businessDateEndUtc, businessDateStartUtc } from '../../core/businessClock.js';

const UPLOADS_DIR = storagePath('uploads', 'documents');

const DMS_ALLOWED_MIME = new Set([
  'image/jpeg','image/png','image/webp','image/gif',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv','text/plain','application/json',
]);
const DMS_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const uploadLimiter = rateLimit({ key: 'documents-upload', windowMs: 60_000, max: 20 });

// ── Shared helper — also exported for internal use by other services ────────
function saveDocumentRecord({ branch_id, name, original_name, stored_name, mime_type, file_size, category = 'other', source = 'manual', related_id = null, related_type = null, tags = [], description = '', uploaded_by = 'system', uploaded_by_name = 'Hệ thống', content_hash = null, source_screen = '' }) {
  const id = uid('doc_');
  const created_at = now();
  db.prepare(`INSERT INTO document_files (id,branch_id,name,original_name,stored_name,mime_type,file_size,category,source,related_id,related_type,tags_json,description,uploaded_by,uploaded_by_name,is_archived,created_at,content_hash,source_screen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`)
    .run(id, branch_id, name, original_name, stored_name, mime_type, file_size, category, source, related_id, related_type, JSON.stringify(tags), description, uploaded_by, uploaded_by_name, created_at, content_hash, source_screen);
  audit('dms.upload', { id, name, category, source, original_name, file_size }, branch_id, uploaded_by);
  const rec = db.prepare(`SELECT * FROM document_files WHERE id=?`).get(id);
  // Post-write realtime: tab Tài liệu đang mở hiện file mới ngay (không polling).
  // Additive — b169 client không nghe 'document:new'. Chỉ vào staffRoom (không PII kiosk).
  try { emit('document:new', documentFileOut(rec), branch_id); } catch { /* best-effort */ }
  return rec;
}

// Hình dạng an toàn cho client: KHÔNG lộ stored_name/ref_locator (chi tiết nội bộ).
export function documentFileOut(r) {
  if (!r) return null;
  const { stored_name, ref_locator, ...safe } = r;
  return {
    ...safe,
    tags: (() => { try { return JSON.parse(r.tags_json || '[]'); } catch { return []; } })(),
    is_image: String(r.mime_type || '').startsWith('image/'),
    is_legacy: !!r.is_legacy,
    download_url: `/api/documents/files/${encodeURIComponent(r.id)}/download`,
    preview_url: `/api/documents/files/${encodeURIComponent(r.id)}/preview`,
  };
}

// Đăng ký một FILE THẬT đã lưu ở thư mục storage khác (vd ảnh sản phẩm Kho ở
// uploads/products) vào kho Tài liệu — storage_kind='storage_file', ref_locator =
// đường dẫn tương đối dưới gốc uploads. KHÔNG copy lại file; download/preview giải
// qua resolveReferenceContent. Phát 'document:new'. GỌI SAU khi file đã ghi xong.
export function registerStorageFileDocument({
  branch_id, name, original_name, mime_type, file_size, storageRelPath,
  source, source_screen = '', category = 'other', description = '',
  uploaded_by = 'system', uploaded_by_name = 'Hệ thống',
  related_id = null, related_type = null,
  is_legacy = 0, status = 'available', created_at = null,
}) {
  const id = uid('doc_');
  const ts = created_at || now();
  const finalOriginal = original_name || name || storageRelPath;
  db.prepare(`INSERT INTO document_files
    (id,branch_id,name,original_name,stored_name,mime_type,file_size,category,source,related_id,related_type,tags_json,description,uploaded_by,uploaded_by_name,is_archived,created_at,content_hash,storage_kind,ref_locator,source_screen,is_legacy,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,NULL,'storage_file',?,?,?,?)`)
    .run(id, branch_id, name || finalOriginal, finalOriginal, '', mime_type || 'application/octet-stream',
      Number(file_size) || 0, category, source || 'upload', related_id, related_type, '[]', description,
      uploaded_by, uploaded_by_name, ts, String(storageRelPath || ''), source_screen, is_legacy ? 1 : 0, status);
  const rec = db.prepare(`SELECT * FROM document_files WHERE id=?`).get(id);
  try { emit('document:new', documentFileOut(rec), branch_id); } catch { /* best-effort */ }
  return rec;
}

// Đăng ký một file storage ĐÃ GHI vào Tài liệu với COMPENSATION: nếu ghi
// document_files THẤT BẠI thì XÓA file vừa ghi rồi NÉM lỗi — kết quả cuối cùng
// KHÔNG bao giờ là "file upload thành công nhưng thiếu document_files" (không mồ
// côi). Caller (saveBase64Image) không được nuốt lỗi này → upload phải fail.
export function registerStorageFileOrRollback({ absFile, doc }) {
  try {
    return registerStorageFileDocument(doc);
  } catch (e) {
    try { fs.unlinkSync(absFile); } catch { /* file có thể đã mất */ }
    throw e;
  }
}

// ── Reference-mode: index nội dung ĐANG NẰM ở nguồn (vd ảnh hóa đơn inline trong
// expenses.invoice_image) mà KHÔNG copy blob ra đĩa. storage_kind='reference',
// ref_locator="module:field:recordId" — chỉ giải phía server qua whitelist cứng
// bên dưới (không cho đọc bảng/cột tùy ý; chống truy cập dữ liệu bừa bãi).
const INLINE_REFERENCE_SOURCES = {
  'expense:invoice_image': { table: 'expenses', column: 'invoice_image' },
  // Ảnh chi từ két cũ (backfill dạng reference) — phải giải được để preview/tải,
  // không được trả 410.
  'cash_drawer_expense:invoice_image': { table: 'cash_drawer_entries', column: 'invoice_image' },
};

function sha256Hex(buf) {
  try { return createHash('sha256').update(buf).digest('hex'); } catch { return null; }
}

function decodeDataUrl(value) {
  const s = String(value ?? '');
  if (!s) return null;
  const m = s.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  try {
    if (m) {
      const mime = (m[1] || 'application/octet-stream').trim().toLowerCase();
      const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
      return buf.byteLength ? { mime, buf } : null;
    }
    const buf = Buffer.from(s, 'base64');
    return buf.byteLength ? { mime: 'application/octet-stream', buf } : null;
  } catch { return null; }
}

// Giải nội dung của một document reference/storage_file về {mime,buf}. Trả null
// nếu nguồn đã mất/hỏng (→ caller trả 410).
export function resolveReferenceContent(rec, branch_id) {
  // storage_file: file THẬT nằm ở thư mục storage khác (vd uploads/products cho ảnh
  // sản phẩm Kho). ref_locator = đường dẫn TƯƠNG ĐỐI dưới gốc uploads. Chặn path
  // traversal tuyệt đối — chỉ phục vụ file nằm trong cây uploads.
  if (rec.storage_kind === 'storage_file') {
    const rel = String(rec.ref_locator || '').replace(/\\/g, '/');
    if (!rel || rel.includes('..') || rel.startsWith('/')) return null;
    const uploadsRoot = nodePath.resolve(storagePath('uploads'));
    const abs = nodePath.resolve(nodePath.join(uploadsRoot, rel));
    if (abs !== uploadsRoot && !abs.startsWith(uploadsRoot + nodePath.sep)) return null;
    if (!fs.existsSync(abs)) return null;
    return { mime: rec.mime_type || 'application/octet-stream', buf: fs.readFileSync(abs) };
  }
  const parts = String(rec.ref_locator || '').split(':');
  const key = `${parts[0]}:${parts[1]}`;
  const recordId = parts.slice(2).join(':');
  const allow = INLINE_REFERENCE_SOURCES[key];
  if (!allow || !recordId) return null;
  const row = db.prepare(`SELECT ${allow.column} v FROM ${allow.table} WHERE id=? AND branch_id=?`).get(recordId, branch_id);
  const decoded = decodeDataUrl(row?.v);
  if (!decoded) return null;
  return { mime: rec.mime_type || decoded.mime, buf: decoded.buf };
}

// Đăng ký (idempotent) một document REFERENCE cho một bản ghi nguồn. Không copy
// file. Idempotency theo (branch, related_type, related_id): gọi lại/backfill lại
// KHÔNG tạo trùng — cập nhật metadata rồi trả bản ghi cũ. GỌI SAU khi bản ghi
// nguồn đã lưu (nội dung đã có ở cột nguồn). Trả record hoặc null (không có ảnh).
export function saveDocumentReference({
  branch_id, module, field, record_id, record_label,
  name, original_name, category = 'other', source, description = '',
  uploaded_by = 'system', uploaded_by_name = 'Hệ thống', uploaded_at = null,
  source_screen = '', is_legacy = 0, value = null,
}) {
  const related_type = module;
  const related_id = record_id;
  const decoded = value != null ? decodeDataUrl(value) : null;
  const mime_type = decoded?.mime || 'application/octet-stream';
  const file_size = decoded?.buf?.byteLength || 0;
  // SHA-256 nội dung THẬT (không phải chỉ mime/size) → phát hiện đổi nội dung kể cả
  // khi trùng MIME và trùng byte-length. null khi không giải được (missing).
  const ref_content_hash = decoded?.buf ? sha256Hex(decoded.buf) : null;
  const status = value != null && !decoded ? 'missing' : 'available';
  const ref_locator = `${module}:${field}:${record_id}`;
  const created_at = uploaded_at || now();
  const finalName = name || original_name || record_label || `${module}-${record_id}`;
  const finalOriginal = original_name || finalName;

  const existing = db.prepare(
    `SELECT * FROM document_files WHERE branch_id=? AND related_type=? AND related_id=? AND is_archived=0 LIMIT 1`,
  ).get(branch_id, related_type, related_id);
  if (existing) {
    // COPY-mode (file thật trên đĩa) là nguồn tự quản → KHÔNG đụng (giữ no-clobber,
    // không biến entry copy đang chạy thành reference). Backfill/hook chạy lại vô hại.
    if (existing.storage_kind !== 'reference') return existing;
    // REFERENCE-mode: đổi NỘI DUNG (so ref_content_hash) hoặc metadata → CẬP NHẬT
    // đúng mime/size/status/tên/thời gian/người tải/hash và phát 'document:updated'.
    // Không đổi gì thì trả nguyên (KHÔNG phát ồn). Backfill hash cho reference cũ
    // (ref_content_hash NULL) sẽ chạy nhánh update một lần rồi ổn định (idempotent).
    const changed =
      (existing.ref_content_hash || null) !== (ref_content_hash || null) ||
      existing.mime_type !== mime_type ||
      (existing.status || 'available') !== status ||
      existing.name !== finalName ||
      existing.original_name !== finalOriginal ||
      (!!uploaded_at && existing.created_at !== created_at) ||
      (!!uploaded_by_name && existing.uploaded_by_name !== uploaded_by_name);
    if (!changed) return existing;
    db.prepare(`UPDATE document_files SET name=?, original_name=?, mime_type=?, file_size=?, status=?,
        source_screen=?, uploaded_by=?, uploaded_by_name=?, created_at=?, ref_locator=?, is_legacy=?, ref_content_hash=? WHERE id=?`)
      .run(finalName, finalOriginal, mime_type, file_size, status,
        source_screen || existing.source_screen || '',
        uploaded_by || existing.uploaded_by, uploaded_by_name || existing.uploaded_by_name,
        created_at, ref_locator, is_legacy ? 1 : 0, ref_content_hash, existing.id);
    const updated = db.prepare(`SELECT * FROM document_files WHERE id=?`).get(existing.id);
    try { emit('document:updated', documentFileOut(updated), branch_id); } catch { /* best-effort */ }
    return updated;
  }

  const id = uid('doc_');
  db.prepare(`INSERT INTO document_files
    (id,branch_id,name,original_name,stored_name,mime_type,file_size,category,source,related_id,related_type,tags_json,description,uploaded_by,uploaded_by_name,is_archived,created_at,content_hash,storage_kind,ref_locator,source_screen,is_legacy,status,ref_content_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,NULL,'reference',?,?,?,?,?)`)
    .run(id, branch_id, finalName, finalOriginal, '', mime_type, file_size, category, source || module,
      related_id, related_type, '[]', description, uploaded_by, uploaded_by_name, created_at, ref_locator, source_screen, is_legacy ? 1 : 0, status, ref_content_hash);
  const rec = db.prepare(`SELECT * FROM document_files WHERE id=?`).get(id);
  // Không audit mỗi backfill (tránh ồn); chỉ realtime cho tab Tài liệu đang mở.
  try { emit('document:new', documentFileOut(rec), branch_id); } catch { /* best-effort */ }
  return rec;
}

const DATA_URL_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'image/gif': '.gif', 'application/pdf': '.pdf',
};

// When a cash-drawer expense carries a receipt photo (sent as a data URL), also
// file it into the DMS so it appears under Cơ sở dữ liệu → Tài liệu, linked back
// to the drawer entry. Returns the document record, or null when there is no
// (valid) attachment. Never throws to the caller — failures are swallowed so a
// bad photo can't block recording the expense itself.
export function fileCashDrawerReceipt(entry = {}, branch_id = 'sala', user = {}) {
  const raw = String(entry?.invoice_image || '');
  const m = raw.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return null;
  const mime_type = m[1].trim().toLowerCase();
  if (!DMS_ALLOWED_MIME.has(mime_type)) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.byteLength || buf.byteLength > DMS_MAX_BYTES) return null;
  const ext = DATA_URL_EXT[mime_type] || '';
  const stored_name = uid('f_') + ext;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(nodePath.join(UPLOADS_DIR, stored_name), buf);
  const label = entry.counterparty || entry.reason || entry.product || 'Chi từ két';
  return saveDocumentRecord({
    branch_id,
    name: `Hóa đơn chi: ${label}`,
    original_name: `chi-tu-ket-${entry.id}${ext}`,
    stored_name,
    mime_type,
    file_size: buf.byteLength,
    category: 'receipt',
    source: 'cash_drawer',
    related_id: entry.id,
    related_type: 'cash_drawer_expense',
    tags: ['chi-từ-két'],
    description: [entry.reason, entry.counterparty, entry.note].filter(Boolean).join(' · '),
    uploaded_by: user?.username || user?.id || 'system',
    uploaded_by_name: user?.name || user?.username || 'Hệ thống',
  });
}

export function registerDocumentRoutes(api, { wrap, logRequestError, SECURE_MIME_EXT }) {
// ── Upload ──────────────────────────────────────────────────────────────────
api.post('/documents/upload', uploadLimiter, wrap(async (req) => {
  const { branch_id, actor } = Auth.requirePermission(req, 'module.documents');
  const { name, category = 'other', source = 'manual', source_screen = '', related_id, related_type, tags = [], description = '', data, mime_type, original_name } = req.body;

  if (!data || !original_name) throw new Error('Thiếu dữ liệu file (data, original_name)');
  if (!DMS_ALLOWED_MIME.has(mime_type)) throw new Error(`Định dạng file không được hỗ trợ: ${mime_type}`);

  // data is base64
  const buf = Buffer.from(data, 'base64');
  if (buf.byteLength > DMS_MAX_BYTES) throw new Error(`File quá lớn — tối đa 25MB`);

  const contentHash = createHash('sha256').update(buf).digest('hex');
  let duplicate = db.prepare(`SELECT * FROM document_files WHERE branch_id=? AND content_hash=? AND is_archived=0 LIMIT 1`).get(branch_id, contentHash);
  if (!duplicate) {
    for (const candidate of db.prepare(`SELECT * FROM document_files WHERE branch_id=? AND content_hash IS NULL AND file_size=? AND is_archived=0`).all(branch_id, buf.byteLength)) {
      try {
        if (createHash('sha256').update(fs.readFileSync(nodePath.join(UPLOADS_DIR, candidate.stored_name))).digest('hex') !== contentHash) continue;
        db.prepare(`UPDATE document_files SET content_hash=? WHERE id=?`).run(contentHash, candidate.id);
        duplicate = candidate;
        break;
      } catch { /* missing legacy file: not a duplicate */ }
    }
  }
  if (duplicate) return { ...duplicate, tags: JSON.parse(duplicate.tags_json || '[]'), duplicate: true };

  const ext = SECURE_MIME_EXT[mime_type] || '.bin';
  const stored_name = uid('f_') + ext;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(nodePath.join(UPLOADS_DIR, stored_name), buf);


  const rec = saveDocumentRecord({
    branch_id, name: name || original_name, original_name, stored_name, mime_type, file_size: buf.byteLength,
    category, source, source_screen, related_id, related_type, tags,
    description, uploaded_by: actor.username || actor.id, uploaded_by_name: actor.name, content_hash: contentHash,
  });
  return rec;
}));

// ── List files ───────────────────────────────────────────────────────────────
api.get('/documents/files', wrap(async (req) => {
  const { branch_id } = Auth.requirePermission(req, 'module.documents');
  const { category, source, q, from, to, archived = '0', limit = '100', offset = '0' } = req.query;

  let sql = `SELECT * FROM document_files WHERE branch_id=? AND is_archived=?`;
  const params = [branch_id, archived === '1' ? 1 : 0];

  if (category && category !== 'all') { sql += ` AND category=?`; params.push(category); }
  if (source && source !== 'all')     { sql += ` AND source=?`;   params.push(source); }
  if (from)  { sql += ` AND created_at>=?`; params.push(businessDateStartUtc(from).toISOString()); }
  if (to)    { sql += ` AND created_at<=?`; params.push(businessDateEndUtc(to).toISOString()); }
  sql += ` ORDER BY created_at DESC LIMIT 10000`;
  const matched = db.prepare(sql).all(...params)
    .filter(row => matchesSearch([row.name, row.original_name, row.description, row.tags_json], searchTokens(q)));
  const start = Math.max(0, parseInt(offset) || 0);
  const rows = matched.slice(start, start + Math.min(Math.max(parseInt(limit) || 100, 1), 500));
  const total = matched.length;

  return { files: rows.map(documentFileOut), total };
}));

// ── Download ─────────────────────────────────────────────────────────────────
api.get('/documents/files/:id/download', async (req, res) => {
  try {
    const { branch_id } = Auth.requirePermission(req, 'module.documents');
    const rec = db.prepare(`SELECT * FROM document_files WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
    if (!rec) return res.status(404).json({ error: 'Tài liệu không tồn tại' });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(rec.original_name)}"`);
    res.setHeader('Content-Type', rec.mime_type || 'application/octet-stream');
    if (rec.storage_kind === 'reference' || rec.storage_kind === 'storage_file') {
      const resolved = resolveReferenceContent(rec, branch_id);
      if (!resolved) return res.status(410).json({ error: 'File nguồn không còn' });
      return res.end(resolved.buf);
    }
    const filePath = nodePath.join(UPLOADS_DIR, rec.stored_name);
    if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'File đã bị xóa khỏi ổ đĩa' });
    await pipeline(fs.createReadStream(filePath), res);
  } catch(e) {
    logRequestError(req, e);
    if (res.headersSent) { res.destroy(); return; }
    res.status(e.status || 400).json(errorPayload(e));
  }
});

// ── Preview (inline) ─────────────────────────────────────────────────────────
api.get('/documents/files/:id/preview', async (req, res) => {
  try {
    const { branch_id } = Auth.requirePermission(req, 'module.documents');
    const rec = db.prepare(`SELECT * FROM document_files WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
    if (!rec) return res.status(404).json({ error: 'Tài liệu không tồn tại' });

    res.setHeader('Content-Type', rec.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(rec.original_name)}"`);
    if (rec.storage_kind === 'reference' || rec.storage_kind === 'storage_file') {
      const resolved = resolveReferenceContent(rec, branch_id);
      if (!resolved) return res.status(410).json({ error: 'File nguồn không còn' });
      return res.end(resolved.buf);
    }
    const filePath = nodePath.join(UPLOADS_DIR, rec.stored_name);
    if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'File đã bị xóa khỏi ổ đĩa' });
    await pipeline(fs.createReadStream(filePath), res);
  } catch(e) {
    logRequestError(req, e);
    if (res.headersSent) { res.destroy(); return; }
    res.status(e.status || 400).json(errorPayload(e));
  }
});

// ── Update metadata ───────────────────────────────────────────────────────────
api.put('/documents/files/:id', wrap(async (req) => {
  const { branch_id, actor } = Auth.requirePermission(req, 'module.documents');
  const rec = db.prepare(`SELECT * FROM document_files WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
  if (!rec) throw new Error('Tài liệu không tồn tại');

  const { name, description, tags, category, is_archived } = req.body;
  db.prepare(`UPDATE document_files SET name=COALESCE(?,name), description=COALESCE(?,description), tags_json=COALESCE(?,tags_json), category=COALESCE(?,category), is_archived=COALESCE(?,is_archived) WHERE id=?`)
    .run(name ?? null, description ?? null, tags ? JSON.stringify(tags) : null, category ?? null, is_archived != null ? (is_archived ? 1 : 0) : null, req.params.id);

  audit('dms.update', { id: req.params.id, name, category }, branch_id, actor.username || actor.id);
  const updated = db.prepare(`SELECT * FROM document_files WHERE id=?`).get(req.params.id);
  return { ...updated, tags: JSON.parse(updated.tags_json || '[]') };
}));

// ── Delete ────────────────────────────────────────────────────────────────────
api.delete('/documents/files/:id', wrap(async (req) => {
  const { branch_id, actor } = Auth.requirePermission(req, 'module.documents');
  // Require Manager/Owner PIN for permanent deletion
  const { pin } = req.body || {};
  if (!pin || !Auth.verifyManagerOwnerPin(pin, branch_id)) throw new Error('Cần PIN Quản lý hoặc Admin để xóa vĩnh viễn tài liệu.');


  const rec = db.prepare(`SELECT * FROM document_files WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
  if (!rec) throw new Error('Tài liệu không tồn tại');

  // Delete physical file
  const filePath = nodePath.join(UPLOADS_DIR, rec.stored_name);
  try { fs.unlinkSync(filePath); } catch (_) { /* already gone */ }

  db.prepare(`DELETE FROM document_files WHERE id=?`).run(req.params.id);
  audit('dms.delete', { id: rec.id, name: rec.name, original_name: rec.original_name }, branch_id, actor.username || actor.id);
  return { ok: true };
}));

// ── Registry stats (header tab Tài liệu) ─────────────────────────────────────
api.get('/documents/stats', wrap(async (req) => {
  const { branch_id } = Auth.requirePermission(req, 'module.documents');
  const total = db.prepare(`SELECT COUNT(*) c FROM document_files WHERE branch_id=? AND is_archived=0`).get(branch_id).c;
  const legacy = db.prepare(`SELECT COUNT(*) c FROM document_files WHERE branch_id=? AND is_archived=0 AND is_legacy=1`).get(branch_id).c;
  const missing = db.prepare(`SELECT COUNT(*) c FROM document_files WHERE branch_id=? AND is_archived=0 AND status='missing'`).get(branch_id).c;
  const byModule = db.prepare(`SELECT source, COUNT(*) c FROM document_files WHERE branch_id=? AND is_archived=0 GROUP BY source ORDER BY c DESC`).all(branch_id);
  return { total, legacy, missing, byModule };
}));

// ── Backfill (idempotent) — lập chỉ mục file/ảnh hiện hữu vào kho Tài liệu ────
// Gọi bởi quy trình bảo trì (Block 1 sau deploy). requirePermission + manager/owner
// PIN cho lần chạy THẬT (không phải dry-run) vì đây là thao tác hàng loạt.
api.post('/documents/backfill', wrap(async (req) => {
  const { branch_id } = Auth.requirePermission(req, 'module.documents');
  const dryRun = String(req.query.dry ?? req.body?.dry ?? '') === '1' || req.body?.dry === true;
  if (!dryRun) {
    const { pin } = req.body || {};
    if (!pin || !Auth.verifyManagerOwnerPin(pin, branch_id)) {
      throw new Error('Cần PIN Quản lý hoặc Admin để chạy backfill thật (dry-run thì không cần).');
    }
  }
  const allBranches = String(req.query.all ?? '') === '1';
  const { backfillDocuments, backfillAudit } = await import('../../services/documentsBackfill.js');
  const auditReport = backfillAudit({ branchId: allBranches ? null : branch_id });
  const stats = backfillDocuments({ branchId: allBranches ? null : branch_id, dryRun });
  return { dryRun, audit: auditReport, stats };
}));
}
