// Route ownership: Online channels (Grab/Shopee/Website webhook + fulfillment).
// Nghiệp vụ ở services/online.js; giữ NGUYÊN hành vi.
import * as Online from '../../services/online.js';
import * as Haravan from '../../services/haravanConnector.js';
import * as Shopee from '../../services/shopeeConnector.js';
import * as ConnPlat from '../../services/connectionPlatform.js';
import * as Lazada from '../../services/lazadaConnector.js';
import * as Tiktok from '../../services/tiktokConnector.js';
import * as Meta from '../../services/metaConnector.js';
import * as Zalo from '../../services/zaloConnector.js';
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
// Xác nhận / chuyển trạng thái NHIỀU đơn (chọn tất cả). Chặn cancel/refund ở đây.
api.post('/online/operations/orders/bulk-transition', guardAny('online.order.manage', 'online'), wrap((req) => {
  const action = String(req.body?.action || '');
  if (['cancel', 'refund'].includes(action)) {
    const error = new Error('Hủy/hoàn tiền không dùng thao tác hàng loạt ở đây.');
    error.status = 403;
    throw error;
  }
  return Online.bulkTransitionOnlineOperations(req.body?.ids, action, req.body, branch(req), actor(req));
}));
api.post('/online/operations/orders/:id/cancel', guardAny('online.order.cancel', 'online'), wrap((req) =>
  Online.transitionOnlineOperation(req.params.id, 'cancel', req.body, branch(req), actor(req))));
api.post('/online/operations/orders/:id/refund', guardAny('online.order.refund', 'online'), wrap((req) =>
  Online.transitionOnlineOperation(req.params.id, 'refund', req.body, branch(req), actor(req))));
api.get('/online/operations/product-mappings', guardAny('online.product_mapping', 'online'), wrap((req) =>
  Online.listProductMappings(visibleBranch(req), req.query)));
api.post('/online/operations/product-mappings/link', guardAny('online.product_mapping', 'online'), wrap((req) =>
  Online.linkProduct({
    branch_id: branch(req),
    provider: req.body.provider,
    shop_domain: req.body.shop_domain,
    external_product_id: req.body.external_product_id,
    external_variant_id: req.body.external_variant_id,
    sku_id: req.body.sku_id,
    actor: actor(req),
  })));
// "Sao chép" — tự đối chiếu SKU/ID listing sàn với kho; khớp thì liên kết luôn,
// không khớp trả matched=false để app cho chọn tay.
api.post('/online/operations/product-mappings/auto-link', guardAny('online.product_mapping', 'online'), wrap((req) =>
  Online.autoLinkProduct({
    branch_id: branch(req),
    provider: req.body.provider,
    shop_domain: req.body.shop_domain,
    external_product_id: req.body.external_product_id,
    external_variant_id: req.body.external_variant_id,
    actor: actor(req),
  })));
api.post('/online/operations/product-mappings/unlink', guardAny('online.product_mapping', 'online'), wrap((req) =>
  Online.unlinkProduct({
    branch_id: branch(req),
    provider: req.body.provider,
    shop_domain: req.body.shop_domain,
    external_product_id: req.body.external_product_id,
    external_variant_id: req.body.external_variant_id,
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
api.post('/online/connectors/shopee/sync-products', guardAny('omni.connector', 'online.connector', 'online.product_mapping'), wrap((req) =>
  Shopee.pullShopeeProducts(branch(req), {})));

// ── Kết nối sàn "1 chạm" (Connection Platform — credential ở ENV nền tảng) ───
// Generic theo :provider (shopee/lazada/…). Backward-compatible với client cũ
// gọi thẳng /integrations/shopee/*.
api.post('/integrations/:provider/connect/start', guardAny('marketplace.connect', 'omni.connector', 'online.connector', 'settings.integrations'), wrap((req) => {
  const redirectBase = req.body?.redirect_base || `${req.protocol}://${req.get('host')}`;
  return ConnPlat.startConnect(req.params.provider, { branch_id: branch(req), user_id: actor(req), redirectBase });
}));
api.get('/integrations/:provider/attempts/:id', guardAny('marketplace.view', 'marketplace.connect', 'omni.connector', 'online.connector', 'settings.integrations', 'online'), wrap((req) =>
  ConnPlat.attemptStatus(req.params.id)));
api.get('/integrations/:provider/connections', guardAny('marketplace.view', 'marketplace.connect', 'omni.connector', 'online.connector', 'settings.integrations', 'online'), wrap((req) =>
  ConnPlat.listConnections(req.params.provider, visibleBranch(req))));
api.post('/integrations/:provider/connections/:id/settings', guardAny('marketplace.connect', 'omni.connector', 'online.connector', 'settings.integrations'), wrap((req) =>
  ConnPlat.updateConnectionSettings(req.params.id, req.body || {}, branch(req), actor(req))));
api.post('/integrations/:provider/connections/:id/disconnect', guardAny('marketplace.connect', 'omni.connector', 'online.connector', 'settings.integrations'), wrap((req) =>
  ConnPlat.disconnect(req.params.id, branch(req), actor(req))));
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

// ── Connector Lazada (Open Platform, Alibaba TOP sign) ──────────────────────
api.get('/online/connectors/lazada/capabilities', guardAny('omni.connector', 'online.connector', 'online'), wrap((req) =>
  Lazada.lazadaCapabilities(visibleBranch(req))));
api.get('/online/connectors/lazada/auth-link', guardAny('omni.connector', 'online.connector'), wrap((req) => {
  const redirect = req.query.redirect
    || `${req.protocol}://${req.get('host')}/auth/lazada/callback?branch_id=${encodeURIComponent(branch(req))}`;
  return { url: Lazada.lazadaAuthLink(branch(req), redirect), redirect };
}));
api.post('/online/connectors/lazada/refresh-token', guardAny('omni.connector', 'online.connector'), wrap((req) =>
  Lazada.lazadaRefreshToken(branch(req))));
api.post('/online/connectors/lazada/sync', guardAny('omni.connector', 'online.connector', 'online.order.manage'), wrap((req) =>
  Lazada.pullLazadaOrders(branch(req), { since: req.body?.since || '' })));
api.post('/online/connectors/lazada/sync-products', guardAny('omni.connector', 'online.connector', 'online.product_mapping'), wrap((req) =>
  Lazada.pullLazadaProducts(branch(req), {})));
api.get('/online/connectors/lazada/waybill', guardAny('online.order.manage', 'online'), async (req, res) => {
  try {
    const opts = { docType: req.query.doc_type || 'shippingLabel' };
    const pdf = req.query.order_id
      ? await Lazada.lazadaWaybillByOrder(branch(req), req.query.order_id, opts)
      : await Lazada.lazadaWaybill(branch(req),
          String(req.query.order_item_ids || '').split(',').map(s => s.trim()).filter(Boolean), opts);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="lazada-waybill.pdf"');
    res.status(200).send(pdf);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Không tải được waybill Lazada' });
  }
});

// ── Connector TikTok Shop (Open API 202309) ─────────────────────────────────
api.get('/online/connectors/tiktok/capabilities', guardAny('omni.connector', 'online.connector', 'online'), wrap((req) =>
  Tiktok.tiktokCapabilities(visibleBranch(req))));
api.get('/online/connectors/tiktok/auth-link', guardAny('omni.connector', 'online.connector'), wrap((req) =>
  ({ url: Tiktok.tiktokAuthLink(branch(req)) })));
api.post('/online/connectors/tiktok/refresh-token', guardAny('omni.connector', 'online.connector'), wrap((req) =>
  Tiktok.tiktokRefreshToken(branch(req))));
api.post('/online/connectors/tiktok/sync', guardAny('omni.connector', 'online.connector', 'online.order.manage'), wrap((req) =>
  Tiktok.pullTiktokOrders(branch(req), { since: req.body?.since || '' })));
api.post('/online/connectors/tiktok/sync-products', guardAny('omni.connector', 'online.connector', 'online.product_mapping'), wrap((req) =>
  Tiktok.pullTiktokProducts(branch(req), {})));
api.get('/online/connectors/tiktok/waybill/:orderId', guardAny('online.order.manage', 'online'), async (req, res) => {
  try {
    const pdf = await Tiktok.tiktokWaybill(branch(req), req.params.orderId, { size: req.query.size || 'A6' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="tiktok-${req.params.orderId}.pdf"`);
    res.status(200).send(pdf);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Không tải được shipping label TikTok' });
  }
});

// ── Connector mạng xã hội (Omni chat) — capabilities ────────────────────────
api.get('/online/connectors/meta/capabilities', guardAny('omni.connector', 'omni.view', 'online'), wrap((req) =>
  Meta.metaCapabilities(visibleBranch(req))));
api.get('/online/connectors/zalo/capabilities', guardAny('omni.connector', 'omni.view', 'online'), wrap((req) =>
  Zalo.zaloCapabilities(visibleBranch(req))));
api.post('/online/connectors/zalo/refresh-token', guardAny('omni.connector'), wrap((req) =>
  Zalo.zaloRefreshToken(branch(req))));
}
