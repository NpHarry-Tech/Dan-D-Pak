// Backfill kho Tài liệu — lập chỉ mục các file/ảnh HIỆN HỮU vào document_files để
// tab "Cơ sở dữ liệu & Tài liệu → Tài liệu" thấy được đầy đủ.
//
// AN TOÀN:
//  • Idempotent: chạy lại KHÔNG tạo trùng (bỏ qua bản ghi nguồn đã có document).
//  • KHÔNG tạo dữ liệu giả, KHÔNG đoán người upload/nguồn. Thiếu metadata lịch sử
//    → uploader 'Không xác định' + is_legacy=1 (bằng chứng thật thì giữ nguyên).
//  • Reference-mode: KHÔNG copy/di chuyển/xóa nội dung nguồn (ảnh vẫn nằm inline
//    trong cột nguồn). File thiếu/hỏng → status='missing', KHÔNG crash.
//  • KHÔNG xóa orphan trong lần này (chỉ liệt kê ở audit()).
//
// PHẠM VI (chứng từ inline — nguồn owner nêu: "ảnh hóa đơn/chứng từ khoản chi"):
//   expense.invoice_image (khoản chi trực tiếp) + cash_drawer_expense.invoice_image
//   (chi từ két; bản mới đã được fileCashDrawerReceipt lập chỉ mục → tự bỏ qua).
// DEFER (ghi rõ, không tự ý index): ảnh sản phẩm/menu là URL asset danh mục
//   (/assets/product-images, /uploads/menu) — không phải chứng từ; và không tìm
//   thấy kho file "import Kho" được lưu bền để backfill.
import { existsSync, statSync, readdirSync } from 'node:fs';
import { db, audit } from '../db.js';
import { storagePath } from '../config/env.js';
import { saveDocumentReference, registerStorageFileDocument } from '../modules/documents/routes.js';

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', pdf: 'application/pdf',
};
function mimeFromName(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

const INLINE_SOURCES = [
  {
    module: 'expense', field: 'invoice_image', table: 'expenses',
    idCol: 'id', labelCol: 'code', uploaderCol: 'actor_name', timeCol: 'created_at',
    screen: 'Chi phí', category: 'receipt',
    where: "invoice_image IS NOT NULL AND invoice_image != '' AND (drawer_entry_id IS NULL OR drawer_entry_id = '')",
    nameFor: (r) => `Hóa đơn chi ${r.code || ''}`.trim(),
  },
  {
    module: 'cash_drawer_expense', field: 'invoice_image', table: 'cash_drawer_entries',
    idCol: 'id', labelCol: 'reason', uploaderCol: 'actor_name', timeCol: 'created_at',
    screen: 'Sổ quỹ / Két', category: 'receipt',
    where: "invoice_image IS NOT NULL AND invoice_image != ''",
    nameFor: (r) => `Hóa đơn chi từ két${r.reason ? ': ' + r.reason : ''}`,
  },
];

function newStat() { return { scanned: 0, indexed: 0, skipped: 0, legacy: 0, missing: 0 }; }

// Đếm file vật lý (reference nguồn) và document đã lập chỉ mục để đối chiếu.
export function backfillAudit({ branchId = null } = {}) {
  const out = { sources: {}, indexed: 0, byModule: {} };
  for (const src of INLINE_SOURCES) {
    const bf = branchId ? ' AND branch_id=?' : '';
    const args = branchId ? [branchId] : [];
    const srcCount = db.prepare(`SELECT COUNT(*) c FROM ${src.table} WHERE ${src.where}${bf}`).get(...args).c;
    const idxCount = db.prepare(
      `SELECT COUNT(*) c FROM document_files WHERE related_type=? AND is_archived=0${branchId ? ' AND branch_id=?' : ''}`,
    ).get(...(branchId ? [src.module, branchId] : [src.module])).c;
    out.sources[src.module] = { sourceFiles: srcCount, indexed: idxCount, missing: Math.max(0, srcCount - idxCount) };
    out.byModule[src.module] = idxCount;
    out.indexed += idxCount;
  }
  return out;
}

export function backfillDocuments({ branchId = null, dryRun = false } = {}) {
  const stats = { scanned: 0, indexed: 0, skipped: 0, legacy: 0, missing: 0, orphan: 0, byModule: {}, dryRun: !!dryRun };
  for (const src of INLINE_SOURCES) {
    const bm = (stats.byModule[src.module] = newStat());
    const bf = branchId ? ' AND branch_id=?' : '';
    const args = branchId ? [branchId] : [];
    const rows = db.prepare(`SELECT * FROM ${src.table} WHERE ${src.where}${bf}`).all(...args);
    for (const r of rows) {
      stats.scanned++; bm.scanned++;
      const exists = db.prepare(
        `SELECT id FROM document_files WHERE branch_id=? AND related_type=? AND related_id=? AND is_archived=0 LIMIT 1`,
      ).get(r.branch_id, src.module, r[src.idCol]);
      if (exists) { stats.skipped++; bm.skipped++; continue; }

      const uploader = (r[src.uploaderCol] || '').toString().trim();
      const legacy = uploader ? 0 : 1; // metadata người upload thiếu → legacy
      if (dryRun) {
        stats.indexed++; bm.indexed++;
        if (legacy) { stats.legacy++; bm.legacy++; }
        continue;
      }
      const rec = saveDocumentReference({
        branch_id: r.branch_id, module: src.module, field: src.field,
        record_id: r[src.idCol], record_label: r[src.labelCol] || '',
        name: src.nameFor(r), category: src.category, source: src.module,
        uploaded_by: 'system', uploaded_by_name: uploader || 'Không xác định',
        uploaded_at: r[src.timeCol] || null, source_screen: src.screen,
        is_legacy: legacy, value: r[src.field],
      });
      stats.indexed++; bm.indexed++;
      if (legacy) { stats.legacy++; bm.legacy++; }
      if (rec?.status === 'missing') { stats.missing++; bm.missing++; }
    }
  }

  // ── Ảnh sản phẩm Kho đã tồn tại (file thật ở uploads/products) ─────────────
  // Index skus.image dạng '/uploads/products/...'. Phục hồi original_name/uploader/
  // thời gian từ audit 'sku.image_upload'; thiếu thì stored filename + 'Không xác
  // định' + is_legacy=1 (KHÔNG bịa). Idempotent theo ref_locator (một file → một
  // document, dù đã tạo bởi live upload hay backfill trước). File mất → status missing.
  {
    const bm = (stats.byModule.sku_image = newStat());
    const bf = branchId ? ' AND branch_id=?' : '';
    const args = branchId ? [branchId] : [];
    const skus = db.prepare(
      `SELECT id, branch_id, image, name FROM skus WHERE image LIKE '/uploads/products/%'${bf}`,
    ).all(...args);
    for (const s of skus) {
      stats.scanned++; bm.scanned++;
      const filename = String(s.image).split('/').pop();
      const rel = `products/${filename}`;
      const already = db.prepare(
        `SELECT id FROM document_files WHERE branch_id=? AND storage_kind='storage_file' AND ref_locator=? AND is_archived=0 LIMIT 1`,
      ).get(s.branch_id, rel);
      if (already) { stats.skipped++; bm.skipped++; continue; }
      const abs = storagePath('uploads', 'products', filename);
      const onDisk = existsSync(abs);
      // Metadata thật từ audit sku.image_upload (khớp url).
      const meta = db.prepare(
        `SELECT actor, detail, created_at FROM audit_log WHERE branch_id=? AND action='sku.image_upload' AND detail LIKE ? ORDER BY created_at DESC LIMIT 1`,
      ).get(s.branch_id, `%${s.image}%`);
      let original_name = filename;
      let uploaded_by_name = 'Không xác định';
      let created_at = null;
      let legacy = 1;
      if (meta) {
        try { const d = JSON.parse(meta.detail); if (d && d.original_name) original_name = String(d.original_name); } catch { /* giữ filename */ }
        uploaded_by_name = meta.actor || 'Không xác định';
        created_at = meta.created_at || null;
        legacy = meta.actor ? 0 : 1;
      }
      if (dryRun) {
        stats.indexed++; bm.indexed++;
        if (legacy) { stats.legacy++; bm.legacy++; }
        if (!onDisk) { stats.missing++; bm.missing++; }
        continue;
      }
      registerStorageFileDocument({
        branch_id: s.branch_id,
        name: `Ảnh sản phẩm: ${s.name || original_name}`,
        original_name,
        mime_type: mimeFromName(filename),
        file_size: onDisk ? statSync(abs).size : 0,
        storageRelPath: rel,
        source: 'warehouse', source_screen: 'Kho — Ảnh sản phẩm', category: 'product_image',
        uploaded_by: 'system', uploaded_by_name,
        related_id: s.id, related_type: 'sku_image',
        is_legacy: legacy, status: onDisk ? 'available' : 'missing', created_at,
      });
      stats.indexed++; bm.indexed++;
      if (legacy) { stats.legacy++; bm.legacy++; }
      if (!onDisk) { stats.missing++; bm.missing++; }
    }
    // Orphan: file trong uploads/products KHÔNG được document nào trỏ tới (không xóa,
    // chỉ thống kê). Chỉ tính ở phạm vi toàn hệ (không lọc theo chi nhánh vì file
    // trên đĩa không mang chi nhánh).
    let orphan = 0;
    try {
      const dir = storagePath('uploads', 'products');
      if (existsSync(dir)) {
        for (const f of readdirSync(dir)) {
          const ref = db.prepare(
            `SELECT 1 FROM document_files WHERE storage_kind='storage_file' AND ref_locator=? AND is_archived=0 LIMIT 1`,
          ).get(`products/${f}`);
          if (!ref) orphan++;
        }
      }
    } catch { /* thư mục chưa có */ }
    stats.orphan = orphan;
  }

  if (!dryRun && stats.indexed > 0) {
    try {
      audit('documents.backfill', {
        scanned: stats.scanned, indexed: stats.indexed, skipped: stats.skipped,
        legacy: stats.legacy, missing: stats.missing, orphan: stats.orphan,
      }, branchId || 'sala');
    } catch { /* backfill không được chặn vì logging */ }
  }
  return stats;
}
