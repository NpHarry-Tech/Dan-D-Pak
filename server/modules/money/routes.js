// Route ownership: Money / Cash Automation — sổ cái dòng tiền trung tâm,
// dashboard dòng tiền, exception queue đối soát bank, rule engine phân loại.
// Nghiệp vụ ở services/moneyLedger.js (chỉ TỔNG HỢP từ payments/drawer/expenses/
// purchase/bank đã có — không tạo domain tiền thứ hai).
import * as Money from '../../services/moneyLedger.js';

export function registerMoneyRoutes(api, { wrap, guardAny, branch, actor }) {
  // Xem: 'reports' (xem báo cáo) hoặc 'module.accounting' (thấy module này) là đủ.
  const view = guardAny('reports', 'module.accounting');
  // Sửa/xoá dòng tiền: KHÔNG dùng chung với quyền xem — xem services/auth.js
  // 'money.manage' (tách khỏi 'reports' để vai trò chỉ-xem-báo-cáo không vô
  // tình sửa/xoá được rule, đối soát bank, nghĩa vụ định kỳ).
  const manage = guardAny('money.manage');

  // Dashboard dòng tiền realtime (tự chiếu ledger trước khi tổng hợp).
  api.get('/money/cashflow', view, wrap((req) =>
    Money.cashFlowSummary(branch(req), req.query)));
  // Sổ cái chi tiết.
  api.get('/money/transactions', view, wrap((req) =>
    Money.listMoneyTransactions(branch(req), req.query)));
  // Backfill / chiếu lại thủ công.
  api.post('/money/project', manage, wrap((req) =>
    Money.projectMoneyLedger(branch(req), req.body || {})));

  // Exception queue — giao dịch bank lệch, chỉ xử lý bất thường.
  api.get('/money/exceptions', view, wrap((req) =>
    Money.exceptionQueue(branch(req))));
  api.post('/money/exceptions/:id/resolve', manage, wrap((req) =>
    Money.resolveBankException(req.params.id, req.body?.action, req.body, branch(req), actor(req))));

  // Rule engine phân loại tự động.
  api.get('/money/rules', view, wrap((req) =>
    Money.listMoneyRules(branch(req))));
  api.post('/money/rules', manage, wrap((req) =>
    Money.upsertMoneyRule(req.body, branch(req), actor(req))));
  api.post('/money/rules/:id/delete', manage, wrap((req) =>
    Money.deleteMoneyRule(req.params.id, branch(req), actor(req))));
  api.post('/money/reclassify', manage, wrap((req) =>
    Money.reclassifyLedger(branch(req))));

  // Dự báo dòng tiền 7/30/90 ngày + cảnh báo thiếu hụt.
  api.get('/money/forecast', view, wrap((req) =>
    Money.cashFlowForecast(branch(req), {})));
  // Nghĩa vụ định kỳ (lương/thuê/điện…) để dự báo biết trước dòng ra.
  api.get('/money/obligations', view, wrap((req) =>
    Money.listObligations(branch(req))));
  api.post('/money/obligations', manage, wrap((req) =>
    Money.upsertObligation(req.body, branch(req), actor(req))));
  api.post('/money/obligations/:id/delete', manage, wrap((req) =>
    Money.deleteObligation(req.params.id, branch(req), actor(req))));
}
