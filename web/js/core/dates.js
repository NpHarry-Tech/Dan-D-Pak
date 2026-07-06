export function isoNow() {
  return new Date().toISOString();
}

export function formatLocalTime(date = new Date(), locale = 'vi-VN') {
  return new Date(date).toLocaleTimeString(locale);
}
