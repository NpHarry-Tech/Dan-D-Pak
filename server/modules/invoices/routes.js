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
  // BẢO MẬT: trước đây route này MỞ (không cần đăng nhập) và chỉ định danh bằng
  // order_id. Cộng với uid() cũ đoán được (xem db/ids.js), kẻ tấn công có thể ghi
  // mã số thuế của mình lên hoá đơn của bill người khác — khấu trừ VAT đầu vào
  // không phải của mình, còn khách thật thì mất hoá đơn. Cũng có thể 'decline'
  // hàng loạt. Client hợp lệ DUY NHẤT là màn thanh toán self-order, và màn đó đã
  // dựng ApiService kèm staffToken, nên yêu cầu đăng nhập không phá luồng nào.
  api.post('/orders/:id/customer-invoice', guard(), wrap((req) => {
    assertBillEditable(req.params.id, req, 'customer_invoice');
    if (req.body) delete req.body.security_pin;
    return Einvoices.customerRequest(req.params.id, req.body || {}, visibleBranch(req));
  }));

  api.get('/orders/:id/einvoice', guard('pay'), wrap((req) =>
    Einvoices.getInvoiceByOrder(req.params.id, branch(req))
  ));

  api.post('/orders/:id/einvoice/retry', guard('pay'), wrap((req) => {
    const pin = req.body?.security_pin;
    const approvedBy = Auth.verifyManagerOwnerPin(pin, branch(req));
    if (!approvedBy) throw new Error('Can nhap PIN Manager hoac Admin de phat hanh lai hoa don.');
    if (!req.body.e_invoice_id) {
      return Einvoices.createInvoiceRequest(req.params.id, 'NO_BUYER_INFO', {}, branch(req), actor(req));
    }
    return Einvoices.retryInvoice(req.body.e_invoice_id, actor(req), branch(req));
  }));

  api.post('/einvoice/:id/sync', guard('pay'), wrap((req) =>
    Einvoices.syncInvoiceStatus(req.params.id, branch(req))
  ));

  api.post('/einvoice/:id/cancel', guard('pay'), wrap((req) => {
    const pin = req.body?.security_pin;
    const approvedBy = Auth.verifyManagerOwnerPin(pin, branch(req));
    if (!approvedBy) throw new Error('Can nhap PIN Manager hoac Admin de huy hoa don.');
    return Einvoices.cancelInvoice(req.params.id, req.body.reason, actor(req), branch(req));
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
    const customer = req.body.customer || {};
    const mode = customer.tax_code
      ? 'COMPANY_TAX_INFO'
      : (customer.name || customer.email || customer.phone ? 'BUYER_PROVIDED_INFO' : 'NO_BUYER_INFO');
    return Einvoices.createInvoiceRequest(
      req.body.order_id,
      mode,
      customer,
      branch_id,
      actor(req),
      { idempotency_key: req.body.idempotency_key || req.headers['idempotency-key'] || null },
    );
  }));

  // BẢO MẬT: danh sách HĐĐT chứa PII (tên, MST, địa chỉ, SĐT, email) + số tiền —
  // BẮT BUỘC đăng nhập & đúng quyền, và khóa theo chi nhánh. Trước đây 2 route này
  // để trống guard → bất kỳ ai (kể cả chưa đăng nhập) cũng liệt kê/đọc được hóa đơn.
  api.get('/invoices', guardAny('invoice', 'pay', 'reports', 'settings.invoices'), wrap((req) => Invoices.ledger(branch(req), req.query)));
  api.get('/invoices/:orderId/detail', guardAny('invoice', 'pay', 'reports', 'settings.invoices'), wrap((req) => Invoices.ledgerDetail(req.params.orderId, branch(req))));
  api.get('/invoices/order/:id', guard('pay'), wrap((req) => Invoices.byOrder(req.params.id, branch(req))));
}
