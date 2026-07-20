// Route ownership: Dashboard + Report Center (preview/export) + report access checks.
// Nghiệp vụ ở services/reports.js + services/reportCenter.js; module giữ NGUYÊN hành vi.
import * as ReportCenter from '../../services/reportCenter.js';
import * as Reports from '../../services/reports.js';
import * as Auth from '../../services/auth.js';
import * as Branches from '../../services/branches.js';
import { notImplemented } from '../../core/http.js';

export function registerReportRoutes(api, { wrap, guard, branch, visibleBranch }) {
  // --- Report access helpers (chỉ dùng trong module này) ---
function normalizedReportType(type) {
  const raw = String(type || 'sales_overview');
  if (['sales_fnb', 'sales_retail', 'sales_by_product'].includes(raw)) return 'sales_overview';
  return ReportCenter.REPORTS.some(r => r.key === raw) ? raw : 'sales_overview';
}
function reportPerm(type) {
  return `report.${normalizedReportType(type)}`;
}
function reportForbidden() {
  const e = new Error('Không đủ quyền xem báo cáo này.');
  e.status = 403;
  return e;
}
function canViewReport(req, type) {
  return !!req.user && (req.user.role === 'owner' || Auth.canUser(req.user, 'reports') || Auth.canUser(req.user, reportPerm(type)));
}
function canOpenReportCenter(req) {
  return !!req.user && (req.user.role === 'owner' || Auth.canUser(req.user, 'reports') || ReportCenter.REPORTS.some(r => Auth.canUser(req.user, reportPerm(r.key))));
}
function requireReportCenter(req) {
  if (!canOpenReportCenter(req)) throw reportForbidden();
}
function requireReportType(req, type) {
  if (!canViewReport(req, type)) throw reportForbidden();
}
function reportCatalogForUser(req) {
  const catalog = ReportCenter.catalog(branch(req));
  const allowed = new Set(Auth.userBranchIds(req.user));
  const branches = Branches.listBranches()
    .filter(b => allowed.has(b.id))
    .map(b => ({ id: b.id, name: b.name, code: b.code || b.id }));
  const enriched = { ...catalog, branches, default_branch_id: branch(req) };
  if (req.user?.role === 'owner' || Auth.canUser(req.user, 'reports')) return enriched;
  const reports = catalog.reports.filter(r => Auth.canUser(req.user, reportPerm(r.key)));
  const groupKeys = new Set(reports.map(r => r.group));
  return {
    ...enriched,
    groups: catalog.groups.filter(g => groupKeys.has(g.key)),
    reports,
  };
}
function reportScopeForUser(req) {
  const allowed = new Set(Auth.userBranchIds(req.user));
  const branches = Branches.listBranches()
    .filter(b => allowed.has(b.id))
    .map(b => ({ id: b.id, name: b.name, code: b.code || b.id }));
  const raw = req.query.branch_ids ?? req.query.branches ?? '';
  let requested = [];
  if (String(raw || '').toLowerCase() === 'all') {
    requested = branches.map(b => b.id);
  } else if (Array.isArray(raw)) {
    requested = raw.flatMap(x => String(x).split(','));
  } else if (String(raw || '').trim()) {
    requested = String(raw).split(',');
  }
  requested = [...new Set(requested.map(x => String(x || '').trim()).filter(Boolean))];
  if (!requested.length) requested = [branch(req)];
  const invalid = requested.filter(id => !allowed.has(id) || !branches.some(b => b.id === id));
  if (invalid.length) throw reportForbidden();
  const selected = branches.filter(b => requested.includes(b.id));
  return { branch_ids: requested, branches: selected, default_branch_id: branch(req) };
}

// --- Reports ---
// BẢO MẬT: dashboard trả doanh thu, số bill, top món… — dữ liệu kinh doanh nhạy cảm.
// BẮT BUỘC đăng nhập (trước đây trống guard → người chưa đăng nhập đọc được doanh thu).
api.get('/dashboard', guard(), wrap((req) => Reports.dashboard(visibleBranch(req))));
api.get('/dashboard/trends', guard(), wrap((req) => Reports.revenueTrends(visibleBranch(req))));
api.get('/reports/sales', guard('reports'), wrap(() => notImplemented('Sales report endpoint is planned. Current app uses /api/reports/preview?type=sales_overview.')));
api.get('/reports/inventory', guard('reports'), wrap(() => notImplemented('Inventory report endpoint is planned. Current app uses /api/reports/preview with inventory report types.')));
api.get('/reports/payments', guard('reports'), wrap(() => notImplemented('Payments report endpoint is planned. Current app uses dashboard/report center endpoints.')));
api.get('/reports/kds', guard('reports'), wrap(() => notImplemented('KDS timing report endpoint is planned.')));
api.get('/reports/catalog', guard(), wrap((req) => {
  requireReportCenter(req);
  return reportCatalogForUser(req);
}));
api.get('/reports/preview', guard(), wrap((req) => {
  const type = normalizedReportType(req.query.type);
  requireReportType(req, type);
  return ReportCenter.buildReport(type, reportScopeForUser(req), req.query);
}));
api.get('/reports/export', guard(), async (req, res) => {
  try {
    const type = normalizedReportType(req.query.type);
    requireReportType(req, type);
    const report = ReportCenter.buildReport(type, reportScopeForUser(req), req.query);
    const format = String(req.query.format || 'html').toLowerCase();
    if (format === 'json') return res.json(report);
    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${ReportCenter.reportFilename(report, 'html')}"`);
      return res.send(ReportCenter.renderReportHtml(report, { mode: 'preview' }));
    }
    if (format === 'doc' || format === 'word') {
      const file = ReportCenter.reportFilename(report, 'doc');
      res.setHeader('Content-Type', 'application/msword; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      return res.send(ReportCenter.renderReportDoc(report));
    }
    if (format === 'xls' || format === 'xlsx' || format === 'sheet' || format === 'gsheet') {
      const file = ReportCenter.reportFilename(report, 'xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      return res.send(await ReportCenter.renderReportXlsx(report));
    }
    if (format === 'pdf') {
      const file = ReportCenter.reportFilename(report, 'pdf');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      return res.send(await ReportCenter.renderReportPdf(report));
    }
    return res.status(400).json({ error: 'Định dạng báo cáo không hợp lệ' });
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }
});
}
