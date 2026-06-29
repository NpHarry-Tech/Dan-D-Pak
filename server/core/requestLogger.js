import { logger } from './logger.js';

const verboseRequestLog = () =>
  process.env.REQUEST_LOG_VERBOSE === '1' ||
  process.env.REQUEST_LOG_VERBOSE === 'true' ||
  process.env.REQUEST_LOG_VERBOSE === 'all';

export function requestLogger(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    const status = res.statusCode;
    if (!verboseRequestLog() && status < 400 && ms < 1000) return;
    const level = status >= 500 ? 'error' : (status >= 400 || ms >= 1000 ? 'warn' : 'info');
    logger[level]('http request', {
      method: req.method,
      url: req.originalUrl,
      status,
      ms,
    });
  });
  next();
}
