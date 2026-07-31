// Route ownership: Online channels (Grab/Shopee/Website webhook + fulfillment).
// Nghiệp vụ ở services/online.js; giữ NGUYÊN hành vi.
import * as Online from '../../services/online.js';
import { assertSalesModuleEnabled } from '../../services/settings.js';

export function registerOnlineRoutes(api, { wrap, guard, guardAny, branch, visibleBranch }) {
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
}
