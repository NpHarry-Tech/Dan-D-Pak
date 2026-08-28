import { sanitizeObject, sanitizeText } from './redaction.js';

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
  const status = Number(error?.status || 0);
  // An unclassified Error (no explicit HTTP status) is an implementation
  // failure, not a safe business message. Keep database paths/provider text
  // out of the client even when an older wrapper happens to answer HTTP 400.
  const internal = status === 0 || status >= 500 || fallbackCode === 'INTERNAL_ERROR';
  const message = internal
    ? 'Request failed'
    : sanitizeText(error?.message || 'Request failed');
  return {
    ok: false,
    code: internal ? fallbackCode : sanitizeText(error.code || fallbackCode),
    message,
    error: message,
    ...(!internal && error.details
      ? { details: sanitizeObject(error.details) }
      : {}),
  };
}
