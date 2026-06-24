import { apiUrl } from './config.js';
import { ApiError, BackendOfflineError } from './errors.js';

export async function apiRequest(path, opts = {}) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(opts.token ? { 'x-auth-token': opts.token } : {}),
    ...(opts.headers || {}),
  };

  const timeoutMs = opts.timeout !== undefined ? opts.timeout : 10000;
  let controller;
  let timeoutId;
  
  if (timeoutMs > 0) {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  let res;
  try {
    res = await fetch(apiUrl(path), {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: opts.cache,
      signal: controller ? controller.signal : undefined,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new BackendOfflineError('Yêu cầu kết nối máy chủ quá hạn (Timeout)');
    }
    throw new BackendOfflineError(error.message);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, code: 'NON_JSON_RESPONSE', message: text.slice(0, 180), error: text.slice(0, 180) };
    }
  }

  if (!res.ok) {
    throw new ApiError(data.message || data.error || ('HTTP ' + res.status), {
      status: res.status,
      code: data.code || 'HTTP_ERROR',
      details: data.details,
    });
  }

  return data;
}

export { apiUrl };
