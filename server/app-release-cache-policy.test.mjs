import assert from 'node:assert/strict';
import test from 'node:test';

import { registerAppReleaseRoutes } from './modules/appRelease/routes.js';

test('public release manifest is never reused across server origins', async () => {
  const routes = new Map();
  const api = {
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    post() {},
  };
  const wrap = (handler) => handler;
  registerAppReleaseRoutes(api, {
    wrap,
    guardAny: () => (_req, _res, next) => next(),
    logRequestError() {},
  });

  const headers = new Map();
  const req = { query: { platform: 'android-phone' } };
  const res = { setHeader: (name, value) => headers.set(name, value) };
  await routes.get('GET /app/version')(req, res);

  assert.equal(headers.get('Cache-Control'), 'no-store, max-age=0');
  assert.equal(headers.get('Vary'), 'Host');
});
