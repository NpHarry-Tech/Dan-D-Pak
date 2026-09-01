// Route ownership: Retail POS + Vouchers (bán lẻ, checkout, đổi trả, voucher).
// Nghiệp vụ ở services/retail.js + vouchers.js; giữ NGUYÊN hành vi.
import * as Vouchers from '../../services/vouchers.js';
import * as Retail from '../../services/retail.js';
import * as RetailCart from '../../services/retailCart.js';
import * as Orders from '../../services/orders.js';
import * as Pay from '../../services/payments.js';
import * as Auth from '../../services/auth.js';
import { audit } from '../../db.js';
import { assertSalesModuleEnabled } from '../../services/settings.js';
import * as Print from '../../services/printing.js';
import * as Returns from '../../services/returns.js';
import * as Approval from '../../services/approval.js';
// Step 2 multi-device: canonical order commands + edit lease + checkout lock.
import * as OrderCmd from '../../services/retailOrderCommands.js';
import * as Lease from '../../services/retailLease.js';
import * as CheckoutLock from '../../services/retailCheckoutLock.js';

export function registerRetailRoutes(api, { wrap, guard, guardAny, branch, visibleBranch, actor, applyManualConfirm, assertBillEditable }) {
api.use('/retail', (req, _res, next) => {
  try {
    assertSalesModuleEnabled('retail', visibleBranch(req));
    next();
  } catch (error) {
    next(error);
  }
});
// --- Retail / vouchers ---
api.get('/vouchers', guardAny('discount', 'settings.promotions'), wrap((req) => Vouchers.listVouchers(branch(req))));
api.get('/vouchers/active', wrap((req) => Vouchers.listActiveVouchers(visibleBranch(req))));
// Voucher: chống gian lận giảm giá — người thao tác phải TỰ nhập PIN của CHÍNH
// MÌNH (định danh ai chịu trách nhiệm); PIN mượn của người khác (kể cả Manager)
// bị từ chối. Ngoại lệ duy nhất: PIN Admin/Owner. Người duyệt được ghi audit.
const VOUCHER_PIN_MSG = 'Cần nhập đúng mật khẩu (PIN) của CHÍNH BẠN — hoặc PIN Admin — để thao tác voucher. PIN của người khác không được chấp nhận.';
api.post('/vouchers', guardAny('discount', 'settings.promotions'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifySelfOrOwnerPin(pin, req.user?.id, branch_id);
  if (!approvedBy) throw new Error(VOUCHER_PIN_MSG);
  audit('voucher.create.approved', { by: approvedBy.username, actor: req.user?.username || '' }, branch_id, req.user?.username || '');
  return Vouchers.createVoucher(req.body, branch_id);
}));
api.post('/vouchers/:id/update', guardAny('discount', 'settings.promotions'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifySelfOrOwnerPin(pin, req.user?.id, branch_id);
  if (!approvedBy) throw new Error(VOUCHER_PIN_MSG);
  audit('voucher.update.approved', { id: req.params.id, by: approvedBy.username, actor: req.user?.username || '' }, branch_id, req.user?.username || '');
  return Vouchers.updateVoucher(req.params.id, req.body, branch_id);
}));
api.post('/vouchers/:id/toggle', guardAny('discount', 'settings.promotions'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifySelfOrOwnerPin(pin, req.user?.id, branch_id);
  if (!approvedBy) throw new Error(VOUCHER_PIN_MSG);
  audit('voucher.toggle.approved', { id: req.params.id, active: !!req.body.active, by: approvedBy.username, actor: req.user?.username || '' }, branch_id, req.user?.username || '');
  return Vouchers.toggleVoucher(req.params.id, req.body.active, branch_id);
}));
api.post('/vouchers/:id/delete', guardAny('discount', 'settings.promotions'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifySelfOrOwnerPin(pin, req.user?.id, branch_id);
  if (!approvedBy) throw new Error(VOUCHER_PIN_MSG);
  audit('voucher.delete.approved', { id: req.params.id, by: approvedBy.username, actor: req.user?.username || '' }, branch_id, req.user?.username || '');
  return Vouchers.deleteVoucher(req.params.id, branch_id);
}));
api.post('/retail/checkout', guard('pay'), wrap((req) => {
  const branch_id = branch(req);
  // CHỈNH GIÁ BÁN TỪNG DÒNG cần PIN Quản lý/Admin — xác thực TRƯỚC khi
  // applyManualConfirm xoá security_pin. Có bất kỳ dòng nào mang price_override =
  // đã đổi giá → bắt buộc PIN, không thì chặn (client tự set giá không được nhận).
  const hasOverride = Array.isArray(req.body?.items)
    && req.body.items.some(it => it && it.price_override != null && it.price_override !== '');
  if (hasOverride) {
    const approver = Auth.verifyManagerOwnerPin(req.body?.security_pin, branch_id);
    if (!approver) throw new Error('Chỉnh giá bán cần PIN Quản lý/Admin.');
    audit('retail.price_override', { by: approver.username, actor: req.user?.username || '' }, branch_id, req.user?.username || '');
  }
  // Step 2 multi-device: đơn theo mô hình canonical (có order_id) PHẢI đi qua
  // CHECKOUT LOCK — chỉ MỘT thiết bị finalize; double-click cùng client_request_id
  // = idempotent; thiết bị khác đang finalize = 409 ORDER_ALREADY_CHECKING_OUT;
  // đã PAID = 409 ORDER_FINALIZED. Đơn LEGACY (không order_id) giữ nguyên đường
  // cũ (đã có idempotency client_request_id) — không đổi hành vi.
  const mdOrderId = String(req.body?.order_id || '').trim();
  const mdDevice = String(req.headers['x-device-id'] || req.body?.device_id || '').trim();
  if (mdOrderId) {
    CheckoutLock.acquireCheckoutLock(branch_id, mdOrderId, {
      device: mdDevice, user_id: req.user?.id || req.user?.username || '', user_name: req.user?.name || '',
      idempotency_key: req.body?.client_request_id || req.headers['idempotency-key'] || mdOrderId,
      order_id: mdOrderId,
    });
  }
  // Cùng cơ chế xác nhận thủ công như /orders/:id/pay (PIN chính mình + audit).
  const manual = applyManualConfirm(req, req.body?.payments, branch_id);
  let receipt;
  try {
    receipt = Retail.checkout({
    ...req.body,
    client_request_id: req.body?.client_request_id || req.headers['idempotency-key'],
    branch_id,
    cashier: req.user?.name || req.user?.username || '',
    // MÁY đang thu tiền → bill ra ở máy in của CHÍNH máy đó.
    //
    // Thiếu dòng này là lỗi làm bill không bao giờ tự in trên máy POS cầm tay:
    // /orders/:id/pay có truyền, còn /retail/checkout (đường MỌI đơn bán lẻ đi
    // qua) thì không, nên resolveReceiptPrinter luôn nhận deviceId rỗng. Rỗng
    // thì cả ba bước ưu tiên "máy in của máy này" bị bỏ qua, và máy in gắn liền
    // của máy cầm tay — thứ chỉ tồn tại qua agent, không nằm trong print_config
    // — không còn đường nào để được chọn. In thử không dính vì nó gọi thẳng
    // theo id tuyến, không cần phân giải.
    device_id: String(req.headers['x-device-id'] || req.body?.device_id || '').trim(),
    });
  } catch (e) {
    // Checkout thất bại → NHẢ lock để máy khác thử lại (chưa paid).
    if (mdOrderId) CheckoutLock.releaseCheckoutLock(branch_id, mdOrderId, { device: mdDevice });
    throw e;
  }
  if (mdOrderId) {
    // PAID là terminal: chốt lock + đánh dấu draft + phát order.paid để A/C đóng.
    CheckoutLock.markCheckoutPaid(branch_id, mdOrderId, {
      device: mdDevice, order_id: receipt?.order_id || receipt?.id || '', bill_no: receipt?.bill_no || '',
    });
    OrderCmd.markDraftPaid(branch_id, mdOrderId);
  }
  if (manual) {
    const orderId = receipt?.order_id || receipt?.id || null;
    for (const tx of manual.txIds) Pay.markBankTxClaimed(tx, orderId, manual.approver.username, branch_id);
  }
  return receipt;
}));
api.post('/retail/receipt/preview/print', guard('pay'), wrap((req) => {
  const branch_id = branch(req);
  const receipt = Retail.previewReceipt({
    ...req.body,
    branch_id,
    cashier: req.user?.name || req.user?.username || '',
  });
  return Print.printReceipt(receipt, branch_id, {
    deviceId: String(req.headers['x-device-id'] || req.body?.device_id || '').trim(),
  });
}));
// Đơn nháp cho chuyển khoản: tạo đơn 'open' THẬT ngay khi thu ngân chọn "Chuyển
// khoản" (trước khi bấm Xác nhận), để webhook SePay/Casso/payOS có đơn để khớp và
// tự đóng ngay khi tiền về — thay vì phải đợi thu ngân xác nhận tay. Xem thêm
// comment ở Retail.createDraftOrder (services/retail.js).
api.post('/retail/draft', guard('pay'), wrap((req) => {
  const branch_id = branch(req);
  // CHỈNH GIÁ DÒNG cũng cần PIN Quản lý ở đường đơn nháp (QR) — không thì client
  // tạo nháp với giá tự đặt rồi settle qua đó, lách xác thực.
  const hasOverride = Array.isArray(req.body?.items)
    && req.body.items.some(it => it && it.price_override != null && it.price_override !== '');
  if (hasOverride) {
    const approver = Auth.verifyManagerOwnerPin(req.body?.security_pin, branch_id);
    if (!approver) throw new Error('Chỉnh giá bán cần PIN Quản lý/Admin.');
    audit('retail.price_override', { by: approver.username, actor: req.user?.username || '', draft: true }, branch_id, req.user?.username || '');
  }
  return Retail.createDraftOrder({
    ...req.body,
    client_request_id: req.body?.client_request_id || req.headers['idempotency-key'],
    branch_id,
    cashier: req.user?.name || req.user?.username || '',
    device_id: String(req.headers['x-device-id'] || req.body?.device_id || '').trim(),
  });
}));
api.post('/retail/draft/:id/void', guard('pay'), wrap((req) => Retail.voidDraftOrder(req.params.id, branch(req))));

// Xem trước giảm giá cho giỏ (CTKM tự động: combo, mua-X-tặng-1) — không tạo đơn.
api.post('/retail/discount-preview', guardAny('sell', 'pay'), wrap((req) => Retail.previewDiscount(req.body || {}, branch(req))));

// --- Giỏ hàng bán lẻ CHIA SẺ (sync đa thiết bị) ---
// POS/tablet/phone cùng chi nhánh thấy đúng cùng giỏ/khách/món trước khi thanh toán.
// Đây là bản NHÁP (chưa phải đơn); trở thành đơn khi /retail/checkout. Chứa PII khách
// nên chỉ phát cho thiết bị nhân viên (retail:cart không nằm trong IPAD_EVENTS).
const cartActor = (req) => req.user?.username || req.user?.name || 'system';
// device = client-id do máy gửi (chống echo: máy tự lọc event mang đúng id của mình).
const cartDevice = (req) => String(req.body?.device || req.headers['x-device-name'] || '');
api.get('/retail/carts', guardAny('sell', 'pay'), wrap((req) => ({ carts: RetailCart.listCarts(branch(req)) })));
api.post('/retail/cart/:slot', guardAny('sell', 'pay'), wrap((req) =>
  RetailCart.saveCart(branch(req), req.params.slot, req.body?.snapshot ?? req.body, {
    actor: cartActor(req), device: cartDevice(req), expectedVersion: req.body?.expected_version ?? null,
  })));
api.delete('/retail/cart/:slot', guardAny('sell', 'pay'), wrap((req) =>
  RetailCart.clearCart(branch(req), req.params.slot, { actor: cartActor(req), device: cartDevice(req) })));
api.post('/retail/cart/:slot/presence', guardAny('sell', 'pay'), wrap((req) =>
  RetailCart.touchCartPresence(branch(req), req.params.slot, { actor: cartActor(req), device: cartDevice(req) })));
api.delete('/retail/cart/:slot/presence', guardAny('sell', 'pay'), wrap((req) =>
  RetailCart.leaveCartPresence(branch(req), req.params.slot, { device: cartDevice(req) })));

// ── Step 2 multi-device: CANONICAL ORDER + LEASE + CHECKOUT LOCK ─────────────
// Hợp đồng mutation: order_id + lease_token + expected_revision + command_id.
// Server cấp display_sequence ATOMIC (client KHÔNG tự đánh "Hóa đơn N").
const uid = (req) => req.user?.id || req.user?.username || '';
const uname = (req) => req.user?.name || req.user?.username || '';

api.post('/retail/orders', guardAny('sell', 'pay'), wrap((req) =>
  OrderCmd.createDraft(branch(req), {
    device: cartDevice(req), user_id: uid(req), user_name: uname(req),
    register_id: String(req.body?.register_id || ''), session_id: String(req.body?.session_id || ''),
  })));
api.get('/retail/orders/:id', guardAny('sell', 'pay'), wrap((req) =>
  OrderCmd.getCanonical(branch(req), req.params.id)));
api.post('/retail/orders/:id/command', guardAny('sell', 'pay'), wrap((req) =>
  OrderCmd.applyCommand(branch(req), req.params.id, {
    command_id: String(req.body?.command_id || ''),
    expected_revision: req.body?.expected_revision,
    lease_token: String(req.body?.lease_token || ''),
    device: cartDevice(req), user_id: uid(req),
    command: String(req.body?.command || ''), payload: req.body?.payload || {},
  })));
api.post('/retail/orders/:id/lease', guardAny('sell', 'pay'), wrap((req) =>
  Lease.acquireLease(branch(req), req.params.id, { device: cartDevice(req), user_id: uid(req), user_name: uname(req) })));
api.post('/retail/orders/:id/lease/heartbeat', guardAny('sell', 'pay'), wrap((req) =>
  Lease.heartbeatLease(branch(req), req.params.id, { device: cartDevice(req), lease_token: String(req.body?.lease_token || '') })));
api.post('/retail/orders/:id/lease/release', guardAny('sell', 'pay'), wrap((req) =>
  Lease.releaseLease(branch(req), req.params.id, { device: cartDevice(req), lease_token: String(req.body?.lease_token || '') })));
// Takeover: tiếp quản quyền sửa của thiết bị khác. Chặn quyền takeover; nếu
// không có quyền, buộc kèm approval_token đã cấp bởi Quản lý (ManagerApproval).
api.post('/retail/orders/:id/lease/takeover', guardAny('sell', 'pay'), wrap((req) => {
  const branch_id = branch(req);
  const canTakeover = Auth.canUser(req.user, 'retail.order.takeover');
  if (!canTakeover) {
    const token = String(req.body?.approval_token || '');
    if (!token || !Approval.consumeApproval(token, { branch_id, action: 'order.takeover', target_id: req.params.id })) {
      const e = new Error('Cần quyền tiếp quản (retail.order.takeover) hoặc duyệt của Quản lý.');
      e.status = 403; e.code = 'TAKEOVER_APPROVAL_REQUIRED'; throw e;
    }
  }
  const out = Lease.takeoverLease(branch_id, req.params.id, { device: cartDevice(req), user_id: uid(req), user_name: uname(req) });
  audit('retail.order.takeover', { order: req.params.id, revoked: out.revoked?.device || null }, branch_id, cartActor(req));
  return out;
}));
api.post('/retail/orders/:id/checkout/lock', guard('pay'), wrap((req) =>
  CheckoutLock.acquireCheckoutLock(branch(req), req.params.id, {
    device: cartDevice(req), user_id: uid(req), user_name: uname(req),
    idempotency_key: String(req.body?.idempotency_key || req.body?.command_id || ''),
    order_id: req.params.id,
  })));

// GỘP giỏ Retail vào MỘT BILL F&B đang mở → thanh toán CHUNG một lần.
// Hàng retail được nối vào đơn F&B thành dòng SKU (giá theo bảng giá kênh 'fnb_retail'),
// rồi giỏ retail được giải phóng cho mọi máy. Sau đó thanh toán bằng /orders/:id/pay như
// bình thường: CTKM theo sản phẩm vẫn áp ĐÚNG cho các dòng retail, món F&B không dính.
api.post('/retail/cart/:slot/merge-to-order', guardAny('sell', 'pay'), wrap((req) => {
  const branch_id = branch(req);
  const actor = cartActor(req);
  const orderId = String(req.body?.order_id || '').trim();
  if (!orderId) throw new Error('Thiếu bill F&B cần gộp vào.');
  const slot = Number(req.params.slot);
  const cart = RetailCart.listCarts(branch_id).find(c => c.slot === slot);
  if (!cart || !cart.lines?.length) throw new Error('Giỏ hàng bán lẻ đang trống, không có gì để gộp.');
  const items = cart.lines
    .map(l => ({ sku_id: l?.sku?.id, qty: Number(l?.qty) || 1, lot_id: l?.lot_id || null }))
    .filter(i => i.sku_id);
  if (!items.length) throw new Error('Giỏ hàng bán lẻ không có mặt hàng hợp lệ.');
  const order = Orders.createOrUpdateOrder({
    branch_id,
    order_id: orderId,
    items,
    actor,
    // Khách của giỏ retail chỉ được gắn nếu bill F&B CHƯA có khách (không đè).
    customer: cart.customer || null,
  });
  RetailCart.clearCart(branch_id, slot, { actor, device: cartDevice(req) });
  audit('retail.cart.merged_to_order', { slot, order: orderId, lines: items.length }, branch_id, actor);
  return { ok: true, order };
}));

api.get('/retail/sales', guardAny('pay', 'reports'), wrap((req) => Retail.listRetailSales(visibleBranch(req))));
api.post('/retail/:id/refund', guard('refund'), wrap((req) => {
  assertBillEditable(req.params.id, req, 'refund');
  return Retail.refund(req.params.id, req.body.reason, branch(req), actor(req));
}));
// TRẢ HÀNG (return) — bill đã thanh toán GIỮ NGUYÊN; tạo giao dịch trả riêng, hỗ
// trợ trả một phần + disposition + phương thức hoàn (§6-§10). approved_by lấy từ
// assertBillEditable (nếu ca đã kết ca cần PIN Quản lý). Idempotent theo header.
// guard() = chỉ yêu cầu ĐĂNG NHẬP; quyền được quyết định TRONG handler: user có
// 'refund' → chạy trực tiếp; nếu KHÔNG → BẮT BUỘC uỷ quyền Quản lý (approval_token
// one-shot, scope tenant/branch/action/target). Không có đường nào khác.
api.post('/retail/:id/return', guard(), wrap((req) => {
  const bid = branch(req);
  const approver = assertBillEditable(req.params.id, req, 'return'); // gác ca (shift-lock) độc lập
  // One-shot approval token: consume ATOMIC (đánh dấu used trong 1 UPDATE) — chống
  // replay; scope khớp (branch,action,target). approvedBy = người duyệt thật.
  let approvedBy = approver?.username || null;
  if (req.body?.approval_token) {
    approvedBy = Approval.consumeApproval(req.body.approval_token,
      { branch_id: bid, action: 'return', target_id: req.params.id });
  }
  // Authorization: refund trực tiếp HOẶC có uỷ quyền hợp lệ. Thiếu cả hai → 403.
  if (!Auth.canUser(req.user, 'refund') && !approvedBy) {
    const e = new Error('Cần quyền Trả hàng, hoặc uỷ quyền Quản lý/Admin để thực hiện.');
    e.status = 403; e.code = 'RETURN_APPROVAL_REQUIRED';
    throw e;
  }
  return Returns.createReturn(req.params.id, {
    items: req.body?.items || null,
    reason: req.body?.reason || '',
    refund_method: req.body?.refund_method || 'original',
    branch_id: bid,
    actor: actor(req),
    approved_by: approvedBy,
    idempotency_key: req.get('Idempotency-Key') || req.body?.idempotency_key || null,
  });
}));
api.get('/retail/:id/returns', guardAny('pay', 'reports', 'refund'), wrap((req) =>
  Returns.listReturnsForOrder(req.params.id, branch(req))));
// Cấp uỷ quyền Quản lý/Admin ONE-SHOT (§1/§13) — UI gọi trước khi thực hiện thao
// tác nhạy cảm cần duyệt. Trả token có scope + TTL; KHÔNG nhận/không trả PIN.
api.post('/approvals/grant', guard(), wrap((req) => Approval.grantApproval({
  branch_id: branch(req),
  action: String(req.body?.action || ''),
  target_id: String(req.body?.target_id || ''),
  required_perm: String(req.body?.required_perm || ''),
  pin: req.body?.pin,
  requested_by: actor(req),
})));
}
