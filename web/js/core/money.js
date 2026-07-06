export function formatVnd(value, locale = 'vi-VN') {
  return (value || 0).toLocaleString(locale) + (locale === 'vi-VN' ? 'đ' : ' VND');
}
