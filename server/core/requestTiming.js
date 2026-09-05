import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const timingKey = Symbol('requestTiming');
const enabled = () => process.env.REQUEST_TIMING_DIAGNOSTICS === '1';

function cleanCorrelationId(value) {
  const candidate = String(value || '').trim().slice(0, 80);
  return /^[A-Za-z0-9._:-]+$/.test(candidate) ? candidate : randomUUID();
}

export function beginRequestTiming(req, res, next) {
  if (!enabled() || req.method !== 'GET' || !/^\/api\/shifts\/current(?:\?|$)/.test(req.originalUrl || '')) {
    return next();
  }
  const correlationId = cleanCorrelationId(
    req.headers?.['x-correlation-id'] || req.headers?.['x-request-id'],
  );
  req.headers['x-correlation-id'] = correlationId;
  req[timingKey] = { started: performance.now(), authMs: 0, correlationId };
  res.setHeader('x-correlation-id', correlationId);
  next();
}

export function markAuthAttached(req, _res, next) {
  const timing = req[timingKey];
  if (timing) {
    timing.authMs += performance.now() - timing.started;
    timing.afterAuth = performance.now();
  }
  next();
}

export function timedAuth(middleware) {
  return (req, res, next) => {
    const timing = req[timingKey];
    if (!timing) return middleware(req, res, next);
    const started = performance.now();
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      timing.authMs += performance.now() - started;
    };
    const result = middleware(req, res, (...args) => {
      record();
      next(...args);
    });
    record();
    return result;
  };
}

export function sendTimedJson(req, res, producer) {
  const timing = req[timingKey];
  if (!timing) return res.json(producer());

  const dbStarted = performance.now();
  const payload = producer();
  const dbMs = performance.now() - dbStarted;
  const serializeStarted = performance.now();
  const body = JSON.stringify(payload);
  const serializeMs = performance.now() - serializeStarted;
  const totalMs = performance.now() - timing.started;
  const ingressMs = Math.max(0, totalMs - timing.authMs - dbMs - serializeMs);
  const value = (number) => Math.max(0, number).toFixed(3);
  res.setHeader('Server-Timing', [
    `ingress;dur=${value(ingressMs)}`,
    `auth;dur=${value(timing.authMs)}`,
    `db;dur=${value(dbMs)}`,
    `serialize;dur=${value(serializeMs)}`,
    `total;dur=${value(totalMs)}`,
  ].join(', '));
  return res.type('application/json').send(body);
}
