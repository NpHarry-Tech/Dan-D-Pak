// Route ownership: Retail POS + Vouchers (bán lẻ, checkout, đổi trả, voucher).
// Nghiệp vụ ở services/retail.js + vouchers.js; giữ NGUYÊN hành vi.
import * as Vouchers from '../../services/vouchers.js';
import * as Retail from '../../services/retail.js';
import * as RetailCart from '../../services/retailCart.js';
import * as Orders from '../../services/orders.js';
import * as Pay from '../../services/payments.js';
import * as Auth from '../../services/auth.js';
import { audit } from '../../db.js';

export function registerRetailRoutes(api, { wrap, guard, guardAny, branch, visibleBranch, applyManualConfirm, assertBillEditable }) {
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
api.post('/retail/checkout', guard('pay'), wrap((req) => {
  const branch_id = branch(req);
  // Cùng cơ chế xác nhận thủ công như /orders/:id/pay (PIN chính mình + audit).
  const manual = applyManualConfirm(req, req.body?.payments, branch_id);
  const receipt = Retail.checkout({ ...req.body, branch_id, cashier: req.user?.name || req.user?.username || '' });
  if (manual) {
    const orderId = receipt?.order_id || receipt?.id || null;
    for (const tx of manual.txIds) Pay.markBankTxClaimed(tx, orderId, manual.approver.username, branch_id);
  }
  return receipt;
}));
// --- Giỏ hàng bán lẻ CHIA SẺ (sync đa thiết bị) ---
// POS/tablet/phone cùng chi nhánh thấy đúng cùng giỏ/khách/món trước khi thanh toán.
// Đây là bản NHÁP (chưa phải đơn); trở thành đơn khi /retail/checkout. Chứa PII khách
// nên chỉ phát cho thiết bị nhân viên (retail:cart không nằm trong IPAD_EVENTS).
const cartActor = (req) => req.user?.username || req.user?.name || 'system';
// device = client-id do máy gửi (chống echo: máy tự lọc event mang đúng id của mình).
const cartDevice = (req) => String(req.body?.device || req.headers['x-device-name'] || '');
api.get('/retail/carts', guardAny('sell', 'pay'), wrap((req) => ({ carts: RetailCart.listCarts(branch(req)) })));
api.post('/retail/cart/:slot', guardAny('sell', 'pay'), wrap((req) =>
  RetailCart.saveCart(branch(req), req.params.slot, req.body?.snapshot ?? req.body, { actor: cartActor(req), device: cartDevice(req) })));
api.delete('/retail/cart/:slot', guardAny('sell', 'pay'), wrap((req) =>
  RetailCart.clearCart(branch(req), req.params.slot, { actor: cartActor(req), device: cartDevice(req) })));

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
  return Retail.refund(req.params.id, req.body.reason, branch(req));
}));
}
