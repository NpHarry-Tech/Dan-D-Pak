import { db } from '../../db.js';
import * as Idem from '../../services/idempotency.js';
import { emit } from '../../realtime.js';
import * as Auth from '../../services/auth.js';
import * as CashDrawer from '../../services/cashDrawer.js';
import * as Customers from '../../services/customers.js';
import * as Pay from '../../services/payments.js';
import * as PaymentIntents from '../../services/paymentIntents.js';
import * as Print from '../../services/printing.js';
import * as Shifts from '../../services/shifts.js';

export function paymentWebhookBranch(req, visibleBranch, legacyDefault = false) {
  if (!req.headers['x-branch-id'] && !req.query?.branch_id) {
    // Legacy SePay URLs predate branch routing. Authentication still fails
    // closed against this branch's configured API key.
    if (legacyDefault) return 'sala';
    const e = new Error('Webhook thanh toán phải chỉ rõ branch_id để định tuyến đúng chi nhánh.');
    e.status = 400;
    throw e;
  }
  return visibleBranch(req);
}

export function registerPaymentRoutes(api, {
  wrap,
  guard,
  guardAny,
  branch,
  visibleBranch,
  applyManualConfirm,
  fileCashDrawerReceipt,
  logRequestError,
  timedAuth,
  sendTimedJson,
}) {
  const webhookBranch = (req, legacyDefault = false) =>
    paymentWebhookBranch(req, visibleBranch, legacyDefault);

  api.post('/orders/:id/pay', guard('pay'), wrap((req) => {
    const branch_id = branch(req);
    // Giảm giá TAY + tự chọn voucher/CTKM đều cần quyền 'discount' (owner luôn qua).
    // Ưu đãi khách hàng (perk) là tự động theo hồ sơ khách nên KHÔNG chặn quyền —
    // giống hệt bên Retail.
    const manualDiscount = Number(req.body.manual_discount ?? req.body.discount) || 0;
    const orderVoucherId = req.body.voucher_id || null;
    const lineVouchers = req.body.line_vouchers || null;
    const picksDiscount = manualDiscount > 0 ||
      !!orderVoucherId ||
      !!(lineVouchers && Object.keys(lineVouchers).length);
    if (picksDiscount && !(req.user?.role === 'owner' || Auth.canUser(req.user, 'discount'))) {
      const e = new Error('Bạn không có quyền áp giảm giá / khuyến mại khi thanh toán.');
      e.status = 403;
      throw e;
    }
    // DÙNG CHUNG engine giảm giá với Retail: hàng RETAIL trong đơn F&B hưởng CTKM theo
    // sản phẩm y hệt bên Retail; MÓN F&B không dính CTKM sản phẩm (chặn ở vouchers.js),
    // chỉ nhận voucher đơn / ưu đãi khách / giảm tay.
    const plan = Pay.buildOrderDiscountPlan(req.params.id, {
      voucher_id: orderVoucherId,
      line_vouchers: lineVouchers,
      manual_discount: manualDiscount,
      customer: req.body.customer || null,
      branch_id,
    });
    // Ghi voucher đơn + CTKM từng dòng vào đơn để hóa đơn/lịch sử hiện giống Retail.
    const transactionalPromotions = (plan.appliedSkuPromos || []).map((promo) => ({
      ...promo,
      item_id: plan.lines[promo.line_index]?.item_id || null,
    }));
    const manual = applyManualConfirm(req, req.body.lines, branch_id);
    const receipt = Pay.payOrder(req.params.id, req.body.lines, {
      discount: plan.discount,
      discount_breakdown: plan.breakdown,
      voucher: plan.orderVoucher,
      promotions: transactionalPromotions,
      customer: req.body.customer || null,
      invoice_customer: req.body.invoice_customer || null,
      note: req.body.note || '',
      cashier: req.user?.name || req.user?.username || '',
      idempotency_key: req.body.idempotency_key || req.headers['idempotency-key'] || null,
      // MÁY đang thanh toán → bill ra ở máy in cắm vào chính máy đó. Trước đây
      // không truyền, nên tuyến in luôn phân giải giống nhau cho mọi máy POS
      // (thu ngân POS 2 phải chạy qua POS 1 lấy bill).
      device_id: String(req.headers['x-device-id'] || req.body.device_id || '').trim(),
      payment_intent_id: req.body.payment_intent_id || null,
      confirmation_source: req.body.payment_intent_id ? 'MANUAL' : null,
      confirmed_by: req.user?.username || req.user?.name || null,
    }, branch_id);
    if (manual) for (const tx of manual.txIds) Pay.markBankTxClaimed(tx, req.params.id, manual.approver.username, branch_id);
    if (receipt.fully_settled !== false && (req.body.customer?.id || req.body.customer?.phone)) {
      Customers.recordPurchase(req.body.customer, receipt.total, branch_id, req.params.id);
    } else if (receipt.fully_settled !== false) {
      Pay.recordLoyaltyFromOrder(db.prepare(`SELECT id,branch_id,total,customer_json FROM orders WHERE id=?`).get(req.params.id));
    }
    return receipt;
  }));

  api.post('/vietqr/webhook', wrap((req) => Pay.handleVietqrWebhook(req.body || {}, req.headers, webhookBranch(req))));
  api.post('/sepay/webhook', wrap((req) => Pay.handleSepayWebhook(req.body || {}, req.headers, webhookBranch(req, true))));
  api.post('/casso/webhook', wrap((req) => Pay.handleCassoWebhook(req.body || {}, req.headers, webhookBranch(req))));
  api.post('/payos/webhook', wrap((req) => Pay.handlePayosWebhook(req.body || {}, req.headers, webhookBranch(req))));
  api.get('/payments/bank-transactions', guardAny('reports', 'pay', 'settings.integrations'), wrap((req) => Pay.listBankTransactions(branch(req), req.query)));
  api.get('/payments/:id/print-status', guard('pay'), wrap((req) =>
    Print.receiptPrintStatus(req.params.id, branch(req))));
  api.get('/payos/payment-status/:orderCode', wrap((req) => Pay.getPayosPaymentStatus(req.params.orderCode, visibleBranch(req))));
  api.post('/payments', guard('pay'), wrap(() => {
    const e = new Error('Generic payment creation is planned. Current app uses /api/orders/:id/pay.');
    e.status = 501;
    throw e;
  }));
  api.get('/payments', guard('reports'), wrap(() => {
    const e = new Error('Payment list endpoint is planned. Current reports are available through dashboard/report center endpoints.');
    e.status = 501;
    throw e;
  }));
  api.post('/orders/:id/request-payment', wrap((req) => { Pay.requestPayment(req.body.table_id, visibleBranch(req)); return { ok: true }; }));
  api.post('/tables/:id/request-payment', wrap((req) => { Pay.requestPayment(req.params.id, visibleBranch(req)); return { ok: true }; }));
  api.post('/orders/:id/payment-qr', guard('pay'), wrap((req) => Pay.generateCustomerPaymentQr(req.params.id, req.body || {}, branch(req))));
  api.get('/orders/:id/payment-intent', guard('pay'), wrap((req) => PaymentIntents.intentStatusForOrder(req.params.id, branch(req))));
  api.post('/payment-qr', wrap((req) => Pay.buildStandalonePaymentQr(req.body || {}, visibleBranch(req))));
  api.post('/orders/:id/customer-qr-pay', wrap((req) => Pay.customerQrPay(req.params.id, req.body || {}, visibleBranch(req))));

  api.get('/shifts/current', timedAuth(guard('pay')), (req, res) =>
    sendTimedJson(req, res, () => Shifts.currentShift(branch(req))));
  api.post('/shifts/open', guard('pay'), wrap((req) => Shifts.openShift(req.body, req.user, branch(req))));
  api.post('/shifts/close', guard('pay'), wrap((req) => Shifts.closeShift(req.body, req.user, branch(req))));
  api.get('/shifts', guard('reports'), wrap((req) => Shifts.listShifts(branch(req), parseInt(req.query.limit) || 40)));

  api.get('/cash-drawer/current', guard('pay'), wrap((req) => CashDrawer.currentDrawer(branch(req))));
  api.get('/cash-drawer/entries', guardAny('reports', 'pay'), wrap((req) => CashDrawer.listEntries(branch(req), req.query)));
  api.post('/cash-drawer/expense', guard('pay'), wrap((req) => {
    const branch_id = branch(req);
    return Idem.withIdempotency('cash-drawer:expense', Idem.idempotencyKeyOf(req), branch_id, () => {
      const entry = CashDrawer.createEntry('expense', req.body, req.user, branch_id);
      let document = null;
      try { document = fileCashDrawerReceipt(entry, branch_id, req.user); }
      catch (e) { logRequestError(req, e); }
      emit('shift:updated', { cash_drawer: true, entry }, branch_id);
      emit('cash-drawer:updated', { entry }, branch_id);
      return { entry, document, drawer: CashDrawer.currentDrawer(branch_id) };
    });
  }));
  api.post('/cash-drawer/reimbursement', guard('pay'), wrap((req) => {
    const branch_id = branch(req);
    return Idem.withIdempotency('cash-drawer:reimbursement', Idem.idempotencyKeyOf(req), branch_id, () => {
      const entry = CashDrawer.createEntry('reimbursement', req.body, req.user, branch_id);
      emit('shift:updated', { cash_drawer: true, entry }, branch_id);
      emit('cash-drawer:updated', { entry }, branch_id);
      return { entry, drawer: CashDrawer.currentDrawer(branch_id) };
    });
  }));
}
