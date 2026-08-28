// Bảng ánh xạ POS → BC (mission #26). KHÔNG hard-code mapping trong source: mã
// hàng, khách, kho, dimension, VAT, phương thức TT… quản lý qua UI, lưu erp_mapping.
import { db, uid } from '../../db.js';

export const MAPPING_KINDS = Object.freeze([
  'company', 'branch', 'location', 'dimension', 'payment', 'vat', 'customer', 'item', 'uom',
]);

export function setMapping(branch_id, kind, posKey, navValue, extra = null) {
  const ts = new Date(Date.now()).toISOString();
  const existing = db.prepare(`SELECT id FROM erp_mapping WHERE branch_id=? AND kind=? AND pos_key=?`)
    .get(branch_id, kind, String(posKey));
  if (existing) {
    db.prepare(`UPDATE erp_mapping SET nav_value=?, extra_json=?, updated_at=? WHERE id=?`)
      .run(navValue == null ? null : String(navValue), extra ? JSON.stringify(extra) : null, ts, existing.id);
    return existing.id;
  }
  const id = uid('map_');
  db.prepare(`INSERT INTO erp_mapping (id, branch_id, kind, pos_key, nav_value, extra_json, updated_at)
    VALUES (?,?,?,?,?,?,?)`)
    .run(id, branch_id, kind, String(posKey), navValue == null ? null : String(navValue),
      extra ? JSON.stringify(extra) : null, ts);
  return id;
}

export function resolveMapping(branch_id, kind, posKey, fallback = '') {
  const row = db.prepare(`SELECT nav_value FROM erp_mapping WHERE branch_id=? AND kind=? AND pos_key=?`)
    .get(branch_id, kind, String(posKey));
  return row?.nav_value || fallback;
}

export function listMappings(branch_id, kind = null) {
  const rows = kind
    ? db.prepare(`SELECT * FROM erp_mapping WHERE branch_id=? AND kind=? ORDER BY pos_key`).all(branch_id, kind)
    : db.prepare(`SELECT * FROM erp_mapping WHERE branch_id=? ORDER BY kind, pos_key`).all(branch_id);
  return rows.map((r) => ({ ...r, extra: r.extra_json ? safeJson(r.extra_json) : null }));
}

export function deleteMapping(branch_id, id) {
  return db.prepare(`DELETE FROM erp_mapping WHERE branch_id=? AND id=?`).run(branch_id, id).changes > 0;
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }
