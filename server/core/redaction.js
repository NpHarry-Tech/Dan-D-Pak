const SENSITIVE_KEY = /(?:authorization|bearer|token|secret|password|passwd|pin|api[_-]?key|private[_-]?key|encryption[_-]?key|signature|signed|credential|refresh[_-]?token|access[_-]?token)/i;

export function isSensitiveKey(key) {
  return SENSITIVE_KEY.test(String(key || ''));
}

export function sanitizeText(value) {
  return String(value ?? '')
    .replace(/-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(Apikey|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [REDACTED]')
    .replace(/((?:authorization|token|secret|password|passwd|pin|api[_-]?key|private[_-]?key|encryption[_-]?key|signature)\s*[:=]\s*)[^\s,;}&]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:authorization|token|secret|password|passwd|pin|api[_-]?key|signature|sig)\s*=)[^&#\s]*/gi, '$1[REDACTED]');
}

export function sanitizeObject(value, depth = 0) {
  if (depth > 5) return '[REDACTED_DEPTH]';
  if (Array.isArray(value)) return value.map(v => sanitizeObject(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : sanitizeObject(child, depth + 1),
    ]));
  }
  return typeof value === 'string' ? sanitizeText(value) : value;
}

export function sanitizeUrl(value) {
  const raw = String(value || '');
  try {
    const parsed = new URL(raw, 'https://redaction.invalid');
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveKey(key)) parsed.searchParams.set(key, '[REDACTED]');
    }
    return parsed.origin === 'https://redaction.invalid'
      ? `${parsed.pathname}${parsed.search}`
      : `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return sanitizeText(raw);
  }
}
