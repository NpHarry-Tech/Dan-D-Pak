export function createCorsMiddleware(env) {
  const origins = env.CORS_ORIGINS || [];
  const allowAny = !env.isProduction && origins.length === 0;

  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;
    const allowedOrigin = allowAny
      ? (origin || '*')
      : origins.includes(origin)
        ? origin
        : origins.includes('*')
          ? '*'
          : '';

    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      return res.status(allowedOrigin ? 204 : 403).end();
    }

    return next();
  };
}
