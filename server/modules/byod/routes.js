import * as Auth from '../../services/auth.js';
import * as Byod from '../../services/byod.js';
import { rateLimit } from '../../core/rateLimit.js';

const ipLimit = rateLimit({ key: 'byod-ip', windowMs: 60_000, max: 120 });
const qrLimit = rateLimit({ key: 'byod-qr', windowMs: 60_000, max: 240,
  keyFn: req => req.params?.token || 'none' });
const deviceLimit = rateLimit({ key: 'byod-device', windowMs: 60_000, max: 120,
  keyFn: req => req.headers?.['x-byod-device'] || req.body?.device_id || 'none' });
const writeLimit = rateLimit({ key: 'byod-write', windowMs: 60_000, max: 40,
  keyFn: req => `${req.params?.token || ''}:${req.headers?.['x-byod-device'] || req.body?.device_id || ''}` });

const device = req => req.headers?.['x-byod-device'] || req.body?.device_id || '';
const hint = req => req.headers?.['user-agent'] || '';

export function registerByodRoutes(api, { wrap, guardAny, branch, actor }) {
  function adminPin(req) {
    const branchId = branch(req);
    const pin = req.body?.security_pin;
    if (req.body) delete req.body.security_pin;
    if (!Auth.verifyManagerOwnerPin(pin, branchId)) {
      throw Object.assign(new Error('Cần PIN của Manager hoặc Admin để thay đổi QR BYOD.'), { status: 403 });
    }
    return branchId;
  }

  api.get('/settings/tables/:id/byod', guardAny('settings.tables'), wrap(req =>
    Byod.getTableQr(req.params.id, branch(req))));
  api.post('/settings/tables/:id/byod/regenerate', guardAny('settings.tables'), wrap(req =>
    Byod.regenerateTableQr(req.params.id, adminPin(req), actor(req))));
  api.post('/settings/tables/:id/byod/status', guardAny('settings.tables'), wrap(req => {
    const enabled = req.body?.enabled === true;
    return Byod.setTableQrEnabled(req.params.id, enabled, adminPin(req), actor(req));
  }));

  const publicRead = [ipLimit, qrLimit, deviceLimit];
  const publicWrite = [ipLimit, qrLimit, deviceLimit, writeLimit];

  api.get('/byod/:token/bootstrap', ...publicRead, wrap(req =>
    Byod.bootstrap(req.params.token, device(req), hint(req), req.query?.lang || 'vi')));
  api.post('/byod/:token/cart', ...publicWrite, wrap(req =>
    Byod.addCartItem(req.params.token, device(req), req.body || {}, hint(req))));
  api.patch('/byod/:token/cart/:itemId', ...publicWrite, wrap(req =>
    Byod.updateCartItem(req.params.token, device(req), req.params.itemId, req.body || {}, hint(req))));
  api.delete('/byod/:token/cart/:itemId', ...publicWrite, wrap(req =>
    Byod.removeCartItem(req.params.token, device(req), req.params.itemId, hint(req))));
  api.post('/byod/:token/submit', ...publicWrite, wrap(req =>
    Byod.submitCart(req.params.token, device(req),
      req.headers?.['idempotency-key'] || req.body?.idempotency_key,
      { scope: req.body?.scope === 'table' ? 'table' : 'mine', confirm_table_cart: req.body?.confirm_table_cart === true }, hint(req))));
  api.post('/byod/:token/request-payment', ...publicWrite, wrap(req =>
    Byod.requestPayment(req.params.token, device(req), hint(req))));
  api.post('/byod/:token/call-staff', ...publicWrite, wrap(req =>
    Byod.callStaff(req.params.token, device(req), hint(req))));
}
