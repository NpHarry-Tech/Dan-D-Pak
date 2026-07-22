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
