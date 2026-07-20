// Route ownership: Online channels (Grab/Shopee/Website webhook + fulfillment).
// Nghiệp vụ ở services/online.js; giữ NGUYÊN hành vi.
import * as Online from '../../services/online.js';

export function registerOnlineRoutes(api, { wrap, guard, guardAny, branch, visibleBranch }) {
// --- Online channels ---
api.post('/online/webhook', wrap((req) => Online.receive(req.body, visibleBranch(req), req.headers)));
api.get('/online/orders', guard('online'), wrap((req) => Online.listOnline(visibleBranch(req))));
api.get('/online/channels', guardAny('online', 'settings.integrations'), wrap((req) => Online.listChannels(visibleBranch(req))));
api.post('/online/orders/:id/status', guard('online'), wrap((req) => Online.setStatus(req.params.id, req.body.status, branch(req))));
api.post('/online/orders/:id/confirm-payment', guard('online'), wrap((req) => Online.confirmPayment(req.params.id, branch(req))));
api.post('/online/orders/:id/confirm-delivery', guard('online'), wrap((req) => Online.confirmDelivery(req.params.id, branch(req))));
api.post('/online/orders/:id/return', guard('online'), wrap((req) => Online.returnOrder(req.params.id, branch(req))));
}
