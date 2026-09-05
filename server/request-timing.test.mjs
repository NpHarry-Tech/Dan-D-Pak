import test from 'node:test';
import assert from 'node:assert/strict';

process.env.REQUEST_TIMING_DIAGNOSTICS = '1';
const {
  beginRequestTiming,
  markAuthAttached,
  timedAuth,
  sendTimedJson,
} = await import('./core/requestTiming.js');

test('shift timing diagnostics split ingress/auth/db/serialize/total and preserve correlation', () => {
  const req = {
    method: 'GET',
    originalUrl: '/api/shifts/current',
    headers: { 'x-correlation-id': 'bench-correlation-1' },
  };
  const headers = new Map();
  let body = '';
  const res = {
    setHeader(name, value) { headers.set(name.toLowerCase(), String(value)); },
    type(value) { headers.set('content-type', value); return this; },
    send(value) { body = value; return this; },
    json(value) { body = JSON.stringify(value); return this; },
  };

  beginRequestTiming(req, res, () => {});
  markAuthAttached(req, res, () => {});
  timedAuth((_req, _res, next) => next())(req, res, () => {});
  sendTimedJson(req, res, () => ({ ok: true, rows: [1, 2, 3] }));

  assert.equal(headers.get('x-correlation-id'), 'bench-correlation-1');
  assert.deepEqual(JSON.parse(body), { ok: true, rows: [1, 2, 3] });
  assert.match(headers.get('server-timing'),
    /^ingress;dur=\d+\.\d{3}, auth;dur=\d+\.\d{3}, db;dur=\d+\.\d{3}, serialize;dur=\d+\.\d{3}, total;dur=\d+\.\d{3}$/);
});

test('timing diagnostics stay absent for unrelated routes', () => {
  const req = { method: 'GET', originalUrl: '/api/health', headers: {} };
  const headers = new Map();
  const res = {
    setHeader(name, value) { headers.set(name.toLowerCase(), String(value)); },
    json(value) { return value; },
  };
  beginRequestTiming(req, res, () => {});
  const result = sendTimedJson(req, res, () => ({ ok: true }));
  assert.deepEqual(result, { ok: true });
  assert.equal(headers.has('server-timing'), false);
});

test('shift timing diagnostics are disabled by default', () => {
  process.env.REQUEST_TIMING_DIAGNOSTICS = '0';
  try {
    const req = { method: 'GET', originalUrl: '/api/shifts/current', headers: {} };
    const headers = new Map();
    const res = {
      setHeader(name, value) { headers.set(name.toLowerCase(), String(value)); },
      json(value) { return value; },
    };
    beginRequestTiming(req, res, () => {});
    const result = sendTimedJson(req, res, () => ({ ok: true }));
    assert.deepEqual(result, { ok: true });
    assert.equal(headers.has('server-timing'), false);
    assert.equal(headers.has('x-correlation-id'), false);
  } finally {
    process.env.REQUEST_TIMING_DIAGNOSTICS = '1';
  }
});
