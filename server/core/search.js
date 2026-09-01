export const MAX_SEARCH_LENGTH = 200;

export function normalizeSearch(value = '', maxLength = MAX_SEARCH_LENGTH) {
  return String(value ?? '')
    .slice(0, maxLength)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchTokens(value = '') {
  return [...new Set(normalizeSearch(value).split(' ').filter(Boolean))];
}

export function matchesSearch(values, query) {
  const tokens = Array.isArray(query) ? query : searchTokens(query);
  if (!tokens.length) return true;
  const haystack = normalizeSearch(Array.isArray(values) ? values.join(' ') : values, Number.MAX_SAFE_INTEGER);
  return tokens.every(token => haystack.includes(token));
}

export function searchScore(values, query) {
  const fields = (Array.isArray(values) ? values : [values])
    .map(value => normalizeSearch(value, Number.MAX_SAFE_INTEGER))
    .filter(Boolean);
  const normalized = normalizeSearch(query);
  if (!normalized) return 0;
  if (fields.some(field => field === normalized)) return 1000;
  if (fields.some(field => field.startsWith(normalized))) return 750;
  const tokens = searchTokens(normalized);
  const joined = fields.join(' ');
  if (!tokens.length || !tokens.every(token => joined.includes(token))) return -1;
  return 500 - Math.min(200, joined.indexOf(tokens[0]));
}
