export class AppError extends Error {
  constructor(message, { code = 'APP_ERROR', status = 400, details = undefined } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function errorPayload(error, fallbackCode = 'BAD_REQUEST') {
  return {
    ok: false,
    code: error.code || fallbackCode,
    message: error.message || 'Request failed',
    error: error.message || 'Request failed',
    ...(error.details ? { details: error.details } : {}),
  };
}
