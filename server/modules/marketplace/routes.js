import * as ConnectionPlatform from '../../services/connectionPlatform.js';
import { env } from '../../config/env.js';

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

  api.delete('/marketplace/connections/:id',
    guardAny('marketplace.connect'),
    wrap(req => ConnectionPlatform.disconnect(req.params.id, branch(req), actor(req))));
}
