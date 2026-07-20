// Route ownership: Hardware Agent (in vật lý + mở két tại cửa hàng khi server ở VPS).
// Nghiệp vụ ở services/printing.js + system.js. Giữ NGUYÊN hành vi.
import * as Print from '../../services/printing.js';
import * as System from '../../services/system.js';

export function registerAgentRoutes(api, { wrap, guardAny, branch }) {
const printGuard = guardAny('module.printing', 'settings.printers', 'settings.print', 'pay');
api.get('/agent/print/pending', printGuard, wrap((req) => ({
  jobs: Print.pendingAgentJobs(branch(req), { limit: parseInt(req.query.limit) || 40 }),
  serverTime: Date.now(),
})));
api.get('/agent/print/jobs/:id', printGuard, wrap((req) => {
  const j = Print.agentJob(req.params.id, branch(req));
  if (!j) throw new Error('Job không cần agent in (browser/không tồn tại)');
  return j;
}));
api.post('/agent/print/jobs/:id/result', printGuard, wrap((req) =>
  Print.agentReportResult(req.params.id, branch(req), {
    ok: req.body.ok === true || req.body.ok === 'true',
    error: req.body.error,
  })));
api.post('/agent/printers/report', printGuard, wrap((req) => ({
  ok: true,
  count: System.setAgentPrinters(branch(req), req.body.printers || []).length,
})));
}
