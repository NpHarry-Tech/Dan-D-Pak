import { db } from '../../db.js';
import * as Auth from '../../services/auth.js';
import * as Einvoices from '../../services/einvoice.js';
import * as Invoices from '../../services/invoices.js';

export function registerInvoiceRoutes(api, {
  wrap,
  guard,
  guardAny,
  branch,
  visibleBranch,
  actor,
  assertBillEditable,
}) {
  api.post('/orders/:id/customer-invoice', wrap((req) => {
    assertBillEditable(req.params.id, req, 'customer_invoice');
    if (req.body) delete req.body.security_pin;
    return Einvoices.customerRequest(req.params.id, req.body || {}, visibleBranch(req));
  }));

  api.get('/orders/:id/einvoice', guard('pay'), wrap((req) =>
    Einvoices.getInvoiceByOrder(req.params.id)
  ));

  api.post('/orders/:id/einvoice/retry', guard('pay'), wrap((req) => {
    const pin = req.body?.security_pin;
    const approvedBy = Auth.verifyManagerOwnerPin(pin, branch(req));
    if (!approvedBy) throw new Error('Can nhap PIN Manager hoac Admin de phat hanh lai hoa don.');
    if (!req.body.e_invoice_id) {
      return Einvoices.createInvoiceRequest(req.params.id, 'NO_BUYER_INFO', {}, branch(req), actor(req));
    }
    return Einvoices.retryInvoice(req.body.e_invoice_id, actor(req));
  }));

  api.post('/einvoice/:id/sync', guard('pay'), wrap((req) =>
    Einvoices.syncInvoiceStatus(req.params.id)
  ));

  api.post('/einvoice/:id/cancel', guard('pay'), wrap((req) => {
    const pin = req.body?.security_pin;
    const approvedBy = Auth.verifyManagerOwnerPin(pin, branch(req));
    if (!approvedBy) throw new Error('Can nhap PIN Manager hoac Admin de huy hoa don.');
    return Einvoices.cancelInvoice(req.params.id, req.body.reason, actor(req));
  }));

  api.get('/einvoice/reconciliation', guardAny('reports', 'pay'), wrap((req) =>
    Einvoices.getReconciliation(branch(req), req.query)
  ));

  api.get('/einvoice/shift-summary', guard('pay'), wrap((req) =>
    Einvoices.getShiftInvoiceSummary(branch(req), req.query)
  ));

  api.post('/invoices/issue', guard('invoice'), wrap((req) => {
    const branch_id = branch(req);
    assertBillEditable(req.body.order_id, req, 'invoice_issue');
    const existing = Einvoices.getInvoiceByOrder(req.body.order_id);
    if (existing) {
      return Einvoices.upgradeBuyer(req.body.order_id, req.body.customer || {}, branch_id, actor(req));
    }
    return Invoices.issue(req.body.order_id, req.body.customer, branch_id);
  }));

  // BẢO MẬT: danh sách HĐĐT chứa PII (tên, MST, địa chỉ, SĐT, email) + số tiền —
  // BẮT BUỘC đăng nhập & đúng quyền, và khóa theo chi nhánh. Trước đây 2 route này
  // để trống guard → bất kỳ ai (kể cả chưa đăng nhập) cũng liệt kê/đọc được hóa đơn.
  api.get('/invoices', guardAny('invoice', 'pay', 'reports', 'settings.invoices'), wrap((req) => Invoices.list(branch(req))));
  api.get('/invoices/order/:id', guard('pay'), wrap((req) => Invoices.byOrder(req.params.id, branch(req))));
  api.post('/invoices/:id/cancel', guard('invoice'), wrap((req) => {
    const ord = db.prepare(`SELECT id FROM orders WHERE invoice_id=? AND branch_id=?`).get(req.params.id, branch(req));
    if (ord) assertBillEditable(ord.id, req, 'invoice_cancel');
    return Invoices.cancel(req.params.id, req.body.reason, branch(req));
  }));
}
