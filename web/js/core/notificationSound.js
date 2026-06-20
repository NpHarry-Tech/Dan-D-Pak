// Notification sound player — loads config from server, caches in localStorage.
const LS_KEY = 'notification_sound_config';

export const SOUND_EVENTS = {
  online_order: { label: 'Đơn hàng online mới', default: 'Doorbell' },
  table_order:  { label: 'Khách tự gọi món (iPad)', default: 'Information_Bell' },
  staff_call:   { label: 'Khách gọi nhân viên', default: 'Alarmed' },
  payment:      { label: 'Thanh toán thành công', default: 'Glass' },
};

const DEFAULT_CONFIG = {
  enabled: true,
  volume: 0.7,
  events: Object.fromEntries(
    Object.entries(SOUND_EVENTS).map(([k, v]) => [k, { enabled: true, sound: v.default }])
  ),
};

let _config = null;
let _catalog = null;

export function getConfig() {
  if (_config) return _config;
  try { _config = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch {}
  return _config || structuredClone(DEFAULT_CONFIG);
}

export function applyConfig(cfg) {
  _config = cfg && typeof cfg === 'object' ? cfg : structuredClone(DEFAULT_CONFIG);
  localStorage.setItem(LS_KEY, JSON.stringify(_config));
}

export async function loadCatalog() {
  if (_catalog) return _catalog;
  try {
    const r = await fetch('/assets/sounds/notifications/catalog.json');
    _catalog = await r.json();
  } catch {
    _catalog = { sounds: [], categories: [] };
  }
  return _catalog;
}

export async function playNotificationSound(event) {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  const ev = cfg.events?.[event];
  if (!ev?.enabled) return;
  await _play(ev.sound || SOUND_EVENTS[event]?.default || 'Doorbell', cfg.volume ?? 0.7);
}

export async function previewSound(soundId, volume) {
  await _play(soundId, volume ?? 0.7);
}

async function _play(soundId, volume) {
  const url = `/assets/sounds/notifications/${soundId}.ogg`;
  const audio = new Audio(url);
  audio.volume = Math.max(0, Math.min(1, Number(volume) || 0.7));
  try { await audio.play(); } catch (e) { console.warn('[sound]', e.message); }
}
