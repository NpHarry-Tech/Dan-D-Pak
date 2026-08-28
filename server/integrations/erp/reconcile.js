// ĐỐI SOÁT POS ↔ BC (mission #28). So hoá đơn POS đã thanh toán với sự kiện ERP
// đã đồng bộ. Kết quả có bucket + drill-down để người xử lý biết chỗ lệch.
import { db } from '../../db.js';
import { buildExternalId } from './erp_adapter.js';

/**
 * @param branch_id
 * @param range { fromDate, toDate } (ISO 'YYYY-MM-DD') — theo paid_at.
 * @returns { summary, rows } — rows có status MATCHED/PENDING/DEAD/MISSING_ERP.
 */
export function reconcileSales(branch_id = 'sala', { fromDate, toDate } = {}) {
  const from = fromDate ? `${fromDate}T00:00:00` : '0000';
  const to = toDate ? `${toDate}T23:59:59` : '9999';
  const bills = db.prepare(`
    SELECT id, bill_no, pay_ref, total, paid_at FROM orders
     WHERE branch_id=? AND status='paid' AND COALESCE(paid_at,'') BETWEEN ? AND ?
     ORDER BY paid_at DESC LIMIT 5000
  `).all(branch_id, from, to);

  const outboxByExt = new Map(
    db.prepare(`SELECT external_id, status, nav_document_no FROM erp_outbox WHERE branch_id=?`)
      .all(branch_id).map((r) => [r.external_id, r]));

  const summary = { MATCHED: 0, PENDING: 0, DEAD: 0, MISSING_ERP: 0, total: bills.length };
  const rows = [];
  for (const b of bills) {
    const key = b.bill_no || b.pay_ref || '';
    const ext = buildExternalId('SALE', branch_id, key);
    const ob = outboxByExt.get(ext);
    let status;
    if (!ob) status = 'MISSING_ERP';
    else if (ob.status === 'synced') status = 'MATCHED';
    else if (ob.status === 'dead') status = 'DEAD';
    else status = 'PENDING';
    summary[status] = (summary[status] || 0) + 1;
    rows.push({
      bill_no: b.bill_no || b.pay_ref, total: b.total, paid_at: b.paid_at,
      status, nav_document_no: ob?.nav_document_no || null, external_id: ext,
    });
  }
  return { summary, rows };
}
