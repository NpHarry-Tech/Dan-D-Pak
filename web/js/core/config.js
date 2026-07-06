export const LOCAL_API_KEY = 'dan_d_pak_api_base_url';

function trimSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function viteEnv(name) {
  try {
    return import.meta?.env?.[name] || '';
  } catch {
    return '';
  }
}

function isLocalHost(hostname = location.hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function appConfig() {
  return window.APP_CONFIG || {};
}

export function resolveApiBaseUrl() {
  const cfg = appConfig();
  const configured = trimSlash(cfg.API_BASE_URL || viteEnv('VITE_API_BASE_URL'));
  if (configured) return configured;

  const saved = trimSlash(localStorage.getItem(LOCAL_API_KEY));
  if (saved) return saved;

  if (location.protocol === 'file:') return 'http://localhost:3000';
  if (isLocalHost()) return '';
  return '';
}

export function resolveRealtimeUrl() {
  const cfg = appConfig();
  const configured = trimSlash(cfg.REALTIME_URL || cfg.API_BASE_URL || viteEnv('VITE_API_BASE_URL'));
  if (configured) return configured.replace(/\/api$/, '');
  const saved = trimSlash(localStorage.getItem(LOCAL_API_KEY));
  if (saved) return saved.replace(/\/api$/, '');
  if (location.protocol === 'file:') return 'http://localhost:3000';
  return '';
}

export function apiUrl(path = '') {
  const cleanPath = String(path || '').startsWith('/') ? String(path || '') : '/' + String(path || '');
  const base = resolveApiBaseUrl();
  if (!base) return '/api' + cleanPath;
  if (base.endsWith('/api')) return base + cleanPath;
  return base + '/api' + cleanPath;
}

export function isDemoMode() {
  return appConfig().DEMO_MODE === true || appConfig().DEMO_MODE === 'true';
}
