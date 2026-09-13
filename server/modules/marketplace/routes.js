import * as ConnectionPlatform from '../../services/connectionPlatform.js';
import { env } from '../../config/env.js';
import * as TikTok from '../../services/tiktokConnector.js';
import * as Lazada from '../../services/lazadaConnector.js';
import * as Shopee from '../../services/shopeeConnector.js';

function callbackBase() {
  const base = String(env.API_BASE_URL || env.APP_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    const e = new Error('Server chưa cấu hình API_BASE_URL/APP_URL cho marketplace callback.');
    e.status = 500;
    throw e;
  }
  return base;
}

export function registerMarketplaceRoutes(api, { wrap, guardAny, branch, actor }) {
  async function syncConnection(connection, branchId, since = '') {
    let orders;
    let products;
    const shops = (connection.mappings || []).filter(mapping => mapping.branch_id === branchId);
    if (connection.provider === 'tiktokshop') {
      const results = [];
      for (const mapping of shops) results.push({
        orders: await TikTok.pullTiktokOrders(branchId, { since, shopId: mapping.external_shop_id }),
        products: await TikTok.pullTiktokProducts(branchId, { shopId: mapping.external_shop_id }),
      });
      orders = { pulled: results.reduce((sum, row) => sum + Number(row.orders.pulled || 0), 0) };
      products = { synced: results.reduce((sum, row) => sum + Number(row.products.synced || 0), 0) };
    } else if (connection.provider === 'lazada') {
      const results = [];
      for (const mapping of shops) results.push({
        orders: await Lazada.pullLazadaOrders(branchId, { since, shopId: mapping.external_shop_id }),
        products: await Lazada.pullLazadaProducts(branchId, { shopId: mapping.external_shop_id }),
      });
      orders = { pulled: results.reduce((sum, row) => sum + Number(row.orders.pulled || 0), 0) };
      products = { synced: results.reduce((sum, row) => sum + Number(row.products.synced || 0), 0) };
    } else if (connection.provider === 'shopee') {
      orders = await Shopee.pullShopeeOrders(branchId, { since });
      products = await Shopee.pullShopeeProducts(branchId, {});
    } else {
      const error = new Error('Provider chưa hỗ trợ đồng bộ qua route này.'); error.status = 400; throw error;
    }
    return { orders, products };
  }
  api.get('/marketplace/connections',
    guardAny('marketplace.view', 'marketplace.connect'),
    wrap(req => ConnectionPlatform.listConnections(req.query.provider || '', branch(req))));

  api.post('/marketplace/:provider/connect',
    guardAny('marketplace.connect'),
    wrap(req => ConnectionPlatform.startConnect(req.params.provider, {
      branch_id: branch(req),
      user_id: req.user?.id || req.user?.username || '',
      // Không nhận redirect base từ client: chặn open-redirect/callback hijack.
      redirectBase: callbackBase(),
    })));

  api.get('/marketplace/connect-attempts/:id',
    guardAny('marketplace.view', 'marketplace.connect'),
    wrap(req => ConnectionPlatform.attemptStatus(req.params.id, branch(req))));

  api.patch('/marketplace/connections/:id',
    guardAny('marketplace.connect'),
    wrap(req => ConnectionPlatform.updateConnectionSettings(
      req.params.id, req.body || {}, branch(req), actor(req))));

  api.get('/marketplace/mapping-options',
    guardAny('marketplace.view', 'marketplace.connect'),
    wrap(req => ConnectionPlatform.mappingOptions(branch(req))));

  api.post('/marketplace/connections/:id/map-shop',
    guardAny('marketplace.connect'),
    wrap(req => ConnectionPlatform.selectAndMapShop(
      req.params.id, req.body || {}, branch(req), actor(req))));

  api.post('/marketplace/connections/:id/initial-sync',
    guardAny('marketplace.connect'),
    wrap(async req => {
      const branchId = branch(req);
      const connection = ConnectionPlatform.listConnections('', branchId).connections
        .find(row => row.id === req.params.id);
      if (!connection) throw new Error('Không tìm thấy kết nối marketplace.');
      const { orders, products } = await syncConnection(connection, branchId, req.body?.since || '');
      return ConnectionPlatform.completeInitialSync(req.params.id, branchId, { orders, products }, actor(req));
    }));

  api.post('/marketplace/connections/:id/reconcile',
    guardAny('marketplace.connect'),
    wrap(async req => {
      const branchId = branch(req);
      const connection = ConnectionPlatform.listConnections('', branchId).connections
        .find(row => row.id === req.params.id);
      if (!connection) throw new Error('Không tìm thấy kết nối marketplace.');
      const prior = Date.parse(connection.last_reconciliation_at || '');
      const since = Number.isFinite(prior) ? new Date(prior - 10 * 60 * 1000).toISOString() : '';
      const result = await syncConnection(connection, branchId, since);
      return ConnectionPlatform.completeReconciliation(req.params.id, branchId, result, actor(req));
    }));

  api.delete('/marketplace/connections/:id',
    guardAny('marketplace.connect'),
    wrap(req => ConnectionPlatform.disconnect(req.params.id, branch(req), actor(req))));
}
