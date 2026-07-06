import { logger } from './logger.js';

export function requestLogger(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    logger.info('http request', {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      ms: Date.now() - started,
    });
  });
  next();
}
