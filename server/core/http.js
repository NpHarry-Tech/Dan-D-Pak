import { errorPayload } from './errors.js';
import { logger } from './logger.js';

export function notImplemented(message = 'This endpoint is planned but not implemented yet.') {
  return {
    ok: false,
    code: 'NOT_IMPLEMENTED',
    message,
  };
}

export function apiNotFound(req, res) {
  return res.status(404).json({
    ok: false,
    code: 'API_NOT_FOUND',
    message: `API route not found: ${req.method} ${req.originalUrl}`,
    error: 'API route not found',
  });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  logger.error('request failed', {
    method: req.method,
    url: req.originalUrl,
    status,
    message: err.message,
  });
  return res.status(status).json(errorPayload(err, status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'));
}
