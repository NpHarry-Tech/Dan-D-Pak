// Route ownership: Money / Cash Automation — sổ cái dòng tiền trung tâm,
// dashboard dòng tiền, exception queue đối soát bank, rule engine phân loại.
// Nghiệp vụ ở services/moneyLedger.js (chỉ TỔNG HỢP từ payments/drawer/expenses/
// purchase/bank đã có — không tạo domain tiền thứ hai).
import * as Money from '../../services/moneyLedger.js';

export function registerMoneyRoutes(api, { wrap, guardAny, branch, actor }) {
  const guard = (_p) => guardAny('reports', 'module.accounting');
  // Dashboard dòng tiền realtime (tự chiếu ledger trước khi tổng hợp).
  api.get('/money/cashflow', guard('reports'), wrap((req) =>
    Money.cashFlowSummary(branch(req), req.query)));
  // Sổ cái chi tiết.
  api.get('/money/transactions', guard('reports'), wrap((req) =>
    Money.listMoneyTransactions(branch(req), req.query)));
  // Backfill / chiếu lại thủ công.
  api.post('/money/project', guard('reports'), wrap((req) =>
    Money.projectMoneyLedger(branch(req), req.body || {})));

  // Exception queue — giao dịch bank lệch, chỉ xử lý bất thường.
  api.get('/money/exceptions', guard('reports'), wrap((req) =>
    Money.exceptionQueue(branch(req))));
  api.post('/money/exceptions/:id/resolve', guard('reports'), wrap((req) =>
    Money.resolveBankException(req.params.id, req.body?.action, req.body, branch(req), actor(req))));

  // Rule engine phân loại tự động.
  api.get('/money/rules', guard('reports'), wrap((req) =>
    Money.listMoneyRules(branch(req))));
  api.post('/money/rules', guard('reports'), wrap((req) =>
    Money.upsertMoneyRule(req.body, branch(req), actor(req))));
  api.post('/money/rules/:id/delete', guard('reports'), wrap((req) =>
    Money.deleteMoneyRule(req.params.id, branch(req), actor(req))));
  api.post('/money/reclassify', guard('reports'), wrap((req) =>
    Money.reclassifyLedger(branch(req))));

  // Dự báo dòng tiền 7/30/90 ngày + cảnh báo thiếu hụt.
  api.get('/money/forecast', guard('reports'), wrap((req) =>
    Money.cashFlowForecast(branch(req), {})));
  // Nghĩa vụ định kỳ (lương/thuê/điện…) để dự báo biết trước dòng ra.
  api.get('/money/obligations', guard('reports'), wrap((req) =>
    Money.listObligations(branch(req))));
  api.post('/money/obligations', guard('reports'), wrap((req) =>
    Money.upsertObligation(req.body, branch(req), actor(req))));
  api.post('/money/obligations/:id/delete', guard('reports'), wrap((req) =>
    Money.deleteObligation(req.params.id, branch(req), actor(req))));
}
