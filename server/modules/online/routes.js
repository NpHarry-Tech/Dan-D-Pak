// Route ownership: Online channels (Grab/Shopee/Website webhook + fulfillment).
// Nghiệp vụ ở services/online.js; giữ NGUYÊN hành vi.
import * as Online from '../../services/online.js';
import * as Haravan from '../../services/haravanConnector.js';
import * as Shopee from '../../services/shopeeConnector.js';
import { assertSalesModuleEnabled } from '../../services/settings.js';

export function registerOnlineRoutes(api, { wrap, guard, guardAny, branch, visibleBranch, actor }) {
api.use('/online', (req, _res, next) => {
  try {
    assertSalesModuleEnabled('fnb', visibleBranch(req));
    next();
  } catch (error) {
    next(error);
  }
});
// --- Online channels ---
api.post('/online/webhook', wrap((req) => {
  if (!req.headers['x-branch-id'] && !req.query?.branch_id) {
    const e = new Error('Webhook kênh bán phải chỉ rõ branch_id.');
    e.status = 400;
    throw e;
  }
  return Online.receive(req.body, visibleBranch(req), req.headers);
}));
api.get('/online/orders', guard('online'), wrap((req) => Online.listOnline(visibleBranch(req))));
api.get('/online/channels', guardAny('online', 'settings.integrations'), wrap((req) => Online.listChannels(visibleBranch(req))));
api.post('/online/orders/:id/status', guard('online'), wrap((req) => Online.setStatus(req.params.id, req.body.status, branch(req))));
api.post('/online/orders/:id/confirm-payment', guard('online'), wrap((req) => Online.confirmPayment(req.params.id, branch(req))));
api.post('/online/orders/:id/confirm-delivery', guard('online'), wrap((req) => Online.confirmDelivery(req.params.id, branch(req))));
api.post('/online/orders/:id/return', guard('online'), wrap((req) => Online.returnOrder(req.params.id, branch(req))));
api.get('/online/operations/summary', guardAny('online.order.manage', 'online'), wrap((req) =>
  Online.onlineOperationsSummary(visibleBranch(req))));
api.get('/online/operations/orders', guardAny('online.order.manage', 'online'), wrap((req) =>
  Online.listOnlineOperations(visibleBranch(req), req.query)));
api.get('/online/operations/orders/:id', guardAny('online.order.manage', 'online'), wrap((req) =>
  Online.getOnlineOperation(req.params.id, visibleBranch(req))));
api.post('/online/operations/orders/:id/assign', guardAny('online.order.assign', 'online'), wrap((req) =>
  Online.assignOnlineOperation(req.params.id, req.body.user_id, branch(req), actor(req))));
api.post('/online/operations/orders/:id/transition', guardAny('online.order.manage', 'online'), wrap((req) => {
  if (['cancel', 'refund'].includes(String(req.body.action || ''))) {
    const error = new Error('Hủy/hoàn tiền phải dùng endpoint có quyền chuyên biệt.');
    error.status = 403;
    throw error;
  }
  return Online.transitionOnlineOperation(req.params.id, req.body.action, req.body, branch(req), actor(req));
}));
api.post('/online/operations/orders/:id/cancel', guardAny('online.order.cancel', 'online'), wrap((req) =>
  Online.transitionOnlineOperation(req.params.id, 'cancel', req.body, branch(req), actor(req))));
api.post('/online/operations/orders/:id/refund', guardAny('online.order.refund', 'online'), wrap((req) =>
  Online.transitionOnlineOperation(req.params.id, 'refund', req.body, branch(req), actor(req))));
api.get('/online/operations/product-mappings', guardAny('online.product_mapping', 'online'), wrap((req) =>
  Haravan.listHaravanProductMappings({ ...req.query, branchId: visibleBranch(req) })));
api.post('/online/operations/product-mappings/link', guardAny('online.product_mapping', 'online'), wrap((req) =>
  Haravan.linkHaravanProduct({
    branchId: branch(req),
    shopDomain: req.body.shop_domain,
    externalProductId: req.body.external_product_id,
    externalVariantId: req.body.external_variant_id,
    skuId: req.body.sku_id,
    actor: actor(req),
  })));
api.get('/online/operations/reconciliation/inventory', guardAny('online.reconciliation', 'online'), wrap((req) =>
  Haravan.listHaravanInventoryReconciliation({ ...req.query, branchId: visibleBranch(req) })));
api.get('/online/operations/reconciliation/summary', guardAny('online.reconciliation', 'online'), wrap((req) =>
  Online.reconciliationSummary(visibleBranch(req), req.query)));
api.get('/online/operations/reconciliation/orders', guardAny('online.reconciliation', 'online'), wrap((req) =>
  Online.reconciliationRows(visibleBranch(req), req.query)));

// ── Connector Shopee (Open Platform v2) ─────────────────────────────────────
api.get('/online/connectors/shopee/capabilities', guardAny('omni.connector', 'online.connector', 'online'), wrap((req) =>
  Shopee.shopeeCapabilities(visibleBranch(req))));
api.get('/online/connectors/shopee/auth-link', guardAny('omni.connector', 'online.connector'), wrap((req) => {
  const redirect = req.query.redirect
    || `${req.protocol}://${req.get('host')}/auth/shopee/callback?branch_id=${encodeURIComponent(branch(req))}`;
  return { url: Shopee.shopeeAuthLink(branch(req), redirect), redirect };
}));
api.post('/online/connectors/shopee/refresh-token', guardAny('omni.connector', 'online.connector'), wrap((req) =>
  Shopee.shopeeRefreshToken(branch(req))));
api.post('/online/connectors/shopee/sync', guardAny('omni.connector', 'online.connector', 'online.order.manage'), wrap((req) =>
  Shopee.pullShopeeOrders(branch(req), { since: req.body?.since || '', orderStatus: req.body?.order_status || '' })));
// Waybill Shopee: trả PDF thật của sàn (khác tem văn bản tự dựng). Không đi qua
// `wrap` vì cần ghi nhị phân trực tiếp.
api.get('/online/connectors/shopee/waybill/:orderSn', guardAny('online.order.manage', 'online'), async (req, res) => {
  try {
    const pdf = await Shopee.shopeeWaybill(branch(req), req.params.orderSn, { type: req.query.type || 'THERMAL_AIR_WAYBILL' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="shopee-${req.params.orderSn}.pdf"`);
    res.status(200).send(pdf);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Không tải được waybill Shopee' });
  }
});
}
