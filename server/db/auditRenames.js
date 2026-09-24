// Chuẩn hoá định danh sự kiện audit về taxonomy CHẤM nhất quán (vd app.update.success,
// order.item.status). Chỉ gồm các tên LỆCH chuẩn cũ — phần lớn action đã sạch nên
// KHÔNG đụng tới (đổi bừa = rủi ro, không lợi ích). Áp cho cả:
//   • hàng SQLite nóng  → migrate 1 lần lúc boot (db.js)
//   • archive NDJSON cũ → rename-on-read (services/archive qua audit.js)
// Idempotent: tên mới không nằm trong khoá nên chạy lại vô hại.
//
// Lưu ý: `bill.split` ở đây là ACTION audit (huỷ/tách bill) — KHÁC quyền `bill.split`
// trong RBAC (không đụng). `perms.update` là quyền theo VAI TRÒ → role.perms.update
// (tách khỏi user.perms.update là quyền theo NGƯỜI, vốn đã tồn tại).
export const AUDIT_ACTION_RENAMES = Object.freeze({
  'app.update_success': 'app.update.success',
  'order.item_note': 'order.item.note',
  'item.status': 'order.item.status',
  'item.cancel': 'order.item.cancel',
  'bill.split': 'order.split',
  'bill.locked_edit': 'order.locked_edit',
  'perms.update': 'role.perms.update',
});

export function canonicalizeAction(action) {
  return AUDIT_ACTION_RENAMES[action] || action;
}
