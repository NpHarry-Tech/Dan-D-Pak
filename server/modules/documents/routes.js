// Route ownership: Document Management (DMS) — upload/list/download/preview/update/delete.
// Cụm DMS (consts + saveDocumentRecord + fileCashDrawerReceipt) ở MODULE-LEVEL vì
// fileCashDrawerReceipt được EXPORT cho payments module dùng (lưu ảnh hóa đơn chi từ két).
import * as Auth from '../../services/auth.js';
import { db, uid, audit, now } from '../../db.js';
import { errorPayload } from '../../core/errors.js';
import fs from 'node:fs';
import nodePath from 'node:path';
import { createHash } from 'node:crypto';
import { rateLimit } from '../../core/rateLimit.js';
import { storagePath } from '../../config/env.js';
import { matchesSearch, searchTokens } from '../../core/search.js';

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
function saveDocumentRecord({ branch_id, name, original_name, stored_name, mime_type, file_size, category = 'other', source = 'manual', related_id = null, related_type = null, tags = [], description = '', uploaded_by = 'system', uploaded_by_name = 'Hệ thống', content_hash = null }) {
  const id = uid('doc_');
  const created_at = now();
  db.prepare(`INSERT INTO document_files (id,branch_id,name,original_name,stored_name,mime_type,file_size,category,source,related_id,related_type,tags_json,description,uploaded_by,uploaded_by_name,is_archived,created_at,content_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`)
    .run(id, branch_id, name, original_name, stored_name, mime_type, file_size, category, source, related_id, related_type, JSON.stringify(tags), description, uploaded_by, uploaded_by_name, created_at, content_hash);
  audit('dms.upload', { id, name, category, source, original_name, file_size }, branch_id, uploaded_by);
  return db.prepare(`SELECT * FROM document_files WHERE id=?`).get(id);
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
export function fileCashDrawerReceipt(entry = {}, branch_id = 'br1', user = {}) {
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
  const { name, category = 'other', source = 'manual', related_id, related_type, tags = [], description = '', data, mime_type, original_name } = req.body;

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
    category, source, related_id, related_type, tags,
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
  if (from)  { sql += ` AND created_at>=?`; params.push(from); }
  if (to)    { sql += ` AND created_at<=?`; params.push(to + 'T23:59:59'); }
  sql += ` ORDER BY created_at DESC LIMIT 10000`;
  const matched = db.prepare(sql).all(...params)
    .filter(row => matchesSearch([row.name, row.original_name, row.description, row.tags_json], searchTokens(q)));
  const start = Math.max(0, parseInt(offset) || 0);
  const rows = matched.slice(start, start + Math.min(Math.max(parseInt(limit) || 100, 1), 500));
  const total = matched.length;

  return { files: rows.map(r => ({ ...r, tags: JSON.parse(r.tags_json || '[]') })), total };
}));

// ── Download ─────────────────────────────────────────────────────────────────
api.get('/documents/files/:id/download', async (req, res) => {
  try {
    const { branch_id } = Auth.requirePermission(req, 'module.documents');
    const rec = db.prepare(`SELECT * FROM document_files WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
    if (!rec) return res.status(404).json({ error: 'Tài liệu không tồn tại' });

    const filePath = nodePath.join(UPLOADS_DIR, rec.stored_name);
    if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'File đã bị xóa khỏi ổ đĩa' });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(rec.original_name)}"`);
    res.setHeader('Content-Type', rec.mime_type || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } catch(e) { logRequestError(req, e); res.status(e.status || 400).json(errorPayload(e)); }
});

// ── Preview (inline) ─────────────────────────────────────────────────────────
api.get('/documents/files/:id/preview', async (req, res) => {
  try {
    const { branch_id } = Auth.requirePermission(req, 'module.documents');
    const rec = db.prepare(`SELECT * FROM document_files WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
    if (!rec) return res.status(404).json({ error: 'Tài liệu không tồn tại' });

    const filePath = nodePath.join(UPLOADS_DIR, rec.stored_name);
    if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'File đã bị xóa khỏi ổ đĩa' });

    res.setHeader('Content-Type', rec.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(rec.original_name)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch(e) { logRequestError(req, e); res.status(e.status || 400).json(errorPayload(e)); }
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
}
