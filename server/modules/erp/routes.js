// ERP Control Center API (mission #27) — Cài đặt → Tích hợp → Business Central.
// Cấu hình kết nối, kiểm tra, hàng đợi outbox, mapping, đối soát. Ghi cấu
// hình/mapping cần quyền settings.integrations; đọc cần đăng nhập.
import { db } from '../../db.js';
import {
  getErpConfig, publicErpConfig, updateErpConfig, getErpRuntimeConfig,
} from '../../services/settings/erp.js';
import {
  listMappings, setMapping, deleteMapping, MAPPING_KINDS,
} from '../../integrations/erp/mapping.js';
import { reconcileSales } from '../../integrations/erp/reconcile.js';
import { processErpOutbox } from '../../integrations/erp/outbox.js';
import { createBusinessCentralAdapter } from '../../integrations/erp/business_central.js';

export function registerErpRoutes(api, { wrap, guard, guardAny, branch }) {
  const canManage = guardAny ? guardAny('settings.integrations') : guard();

  // ── Cấu hình ──
  api.get('/erp/config', guard(), wrap((req) => publicErpConfig(branch(req))));

  api.post('/erp/config', canManage, wrap((req) => updateErpConfig(req.body || {}, branch(req))));

  // Kiểm tra kết nối (OAuth + tenant + company).
  api.post('/erp/test-connection', canManage, wrap(async (req) => {
    const cfg = getErpRuntimeConfig(branch(req));
    if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret || !cfg.companyId) {
      return { ok: false, error: 'Chưa đủ tenantId/clientId/clientSecret/companyId' };
    }
    try {
      const health = await createBusinessCentralAdapter(cfg).getHealth();
      return { ok: true, ...health };
    } catch (e) {
      return { ok: false, error: e.message, error_class: e.errorClass || 'UNKNOWN' };
    }
  }));

  // Liệt kê company trong BC (để chọn companyId).
  api.get('/erp/companies', canManage, wrap(async (req) => {
    const cfg = getErpRuntimeConfig(branch(req));
    try { return { ok: true, companies: await createBusinessCentralAdapter(cfg).getCompanies() }; }
    catch (e) { return { ok: false, error: e.message }; }
  }));

  // ── Hàng đợi outbox ──
  api.get('/erp/status', guard(), wrap((req) => {
    const b = branch(req);
    const rows = db.prepare(`SELECT status, COUNT(*) n FROM erp_outbox WHERE branch_id=? GROUP BY status`).all(b);
    const counts = { pending: 0, processing: 0, synced: 0, dead: 0 };
    for (const r of rows) counts[r.status] = r.n;
    const cfg = getErpConfig(b);
    return { ok: true, enabled: cfg.enabled, provider: cfg.provider, counts };
  }));

  api.get('/erp/queue', guard(), wrap((req) => {
    const b = branch(req);
    const status = String(req.query?.status || '').trim();
    const limit = Math.max(1, Math.min(200, parseInt(req.query?.limit) || 50));
    const rows = status
      ? db.prepare(`SELECT id, external_id, doc_type, status, error_class, last_error, retry_count,
          next_attempt_at, nav_document_no, created_at, updated_at FROM erp_outbox
          WHERE branch_id=? AND status=? ORDER BY updated_at DESC LIMIT ?`).all(b, status, limit)
      : db.prepare(`SELECT id, external_id, doc_type, status, error_class, last_error, retry_count,
          next_attempt_at, nav_document_no, created_at, updated_at FROM erp_outbox
          WHERE branch_id=? ORDER BY updated_at DESC LIMIT ?`).all(b, limit);
    return { ok: true, rows };
  }));

  // In lại 1 sự kiện dead/lỗi → đưa về pending, chạy nhịp kế.
  api.post('/erp/retry/:id', canManage, wrap((req) => {
    const b = branch(req);
    const r = db.prepare(`UPDATE erp_outbox SET status='pending', next_attempt_at=NULL, retry_count=0,
      updated_at=? WHERE id=? AND branch_id=? AND status IN ('dead','processing','pending')`)
      .run(new Date(Date.now()).toISOString(), req.params.id, b);
    return { ok: r.changes > 0 };
  }));

  // Đẩy hàng đợi ngay (không chờ nhịp 30s).
  api.post('/erp/process-now', canManage, wrap(async () => ({ ok: true, stats: await processErpOutbox({ limit: 50 }) })));

  // ── Mapping ──
  api.get('/erp/mapping', guard(), wrap((req) =>
    ({ ok: true, kinds: MAPPING_KINDS, rows: listMappings(branch(req), req.query?.kind || null) })));

  api.post('/erp/mapping', canManage, wrap((req) => {
    const { kind, pos_key, nav_value, extra } = req.body || {};
    if (!MAPPING_KINDS.includes(kind)) return { ok: false, error: 'kind không hợp lệ' };
    const id = setMapping(branch(req), kind, pos_key, nav_value, extra || null);
    return { ok: true, id };
  }));

  api.delete('/erp/mapping/:id', canManage, wrap((req) => ({ ok: deleteMapping(branch(req), req.params.id) })));

  // ── Đối soát ──
  api.get('/erp/reconcile', guard(), wrap((req) =>
    ({ ok: true, ...reconcileSales(branch(req), { fromDate: req.query?.from, toDate: req.query?.to }) })));
}
