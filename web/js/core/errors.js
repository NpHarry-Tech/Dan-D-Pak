export class ApiError extends Error {
  constructor(message, { status = 0, code = 'API_ERROR', details = undefined } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class BackendOfflineError extends ApiError {
  constructor(message = 'Backend offline or unreachable') {
    super(message, { status: 0, code: 'BACKEND_OFFLINE' });
    this.name = 'BackendOfflineError';
  }
}
