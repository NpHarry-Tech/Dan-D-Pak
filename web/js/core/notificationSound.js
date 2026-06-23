// Notification sound player — loads config from server, caches in localStorage.
const LS_KEY = 'notification_sound_config';

export const SOUND_EVENTS = {
  online_order:  { label: 'Đơn hàng online mới', default: 'Doorbell' },
  table_order:   { label: 'Khách tự gọi món (iPad)', default: 'Information_Bell' },
  staff_call:    { label: 'Khách gọi nhân viên', default: 'Alarmed' },
  payment:       { label: 'Thanh toán thành công', default: 'Glass' },
  kds_new_order: { label: 'Món mới lên màn hình bếp (KDS)', default: 'Beeper' },
};

const DEFAULT_CONFIG = {
  enabled: true,
  volume: 1.0,
  events: Object.fromEntries(
    Object.entries(SOUND_EVENTS).map(([k, v]) => [k, { enabled: true, sound: v.default }])
  ),
};

let _config = null;
let _catalog = null;

// Background keep-alive & audio unlock variables
let keepAliveInterval = null;
let _unlocked = false;

function playTinySilence() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const buffer = ctx.createBuffer(1, 1, 22050); // 1 single sample
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    // Auto-close after play to let audio hardware sleep
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 100);
  } catch (e) {
    // ignore
  }
}

function startBackgroundKeepAlive() {
  if (keepAliveInterval) return;
  // Play a tiny silent sample every 20 seconds to keep tab active without draining battery
  keepAliveInterval = setInterval(() => {
    if (_unlocked) {
      playTinySilence();
    }
  }, 20000);
  // Also play once immediately
  playTinySilence();
  console.log('[sound] Battery-friendly periodic background keep-alive started.');
}

async function unlockAudio() {
  if (_unlocked) return;
  
  _unlocked = true;
  startBackgroundKeepAlive();
  removeAudioUnlockBanner();
  
  // Play a silent test sound to ensure HTML5 Audio is fully unlocked
  try {
    const url = '/assets/sounds/notifications/Doorbell.ogg';
    const audio = new Audio(url);
    audio.volume = 0.001; // nearly silent test
    await audio.play();
    console.log('[sound] Audio engine successfully unlocked by user interaction!');
  } catch (e) {
    console.warn('[sound] Silent unlock attempt failed:', e);
  }
}

function showAudioUnlockBanner() {
  if (typeof document === 'undefined' || document.getElementById('audioUnlockBanner')) return;
  
  const banner = document.createElement('div');
  banner.id = 'audioUnlockBanner';
  banner.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(100px);
    z-index: 999999;
    background: rgba(15, 23, 42, 0.9);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(8, 145, 178, 0.4);
    padding: 16px 24px;
    border-radius: 16px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    gap: 18px;
    color: #fff;
    font-family: 'Be Vietnam Pro', system-ui, -apple-system, sans-serif;
    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    width: max-content;
    max-width: 90vw;
  `;
  
  banner.innerHTML = `
    <div style="font-size: 26px; animation: pulse 1.5s infinite;">🔔</div>
    <div style="flex: 1;">
      <div style="font-weight: 700; font-size: 14.5px; margin-bottom: 3px; color: #34d2ee;">Bật âm thanh thông báo</div>
      <div style="font-size: 11.5px; color: rgba(255, 255, 255, 0.75); line-height: 1.4;">Cho phép phát tiếng chuông báo khi có đơn hàng hoặc yêu cầu mới.</div>
    </div>
    <button id="audioUnlockBtn" style="
      background: #0891b2;
      color: #fff;
      border: none;
      padding: 9px 18px;
      border-radius: 10px;
      font-weight: 700;
      font-size: 12.5px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s, transform 0.1s;
      box-shadow: 0 4px 6px rgba(8, 145, 178, 0.25);
    ">Kích hoạt</button>
    <style>
      @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.12); }
        100% { transform: scale(1); }
      }
    </style>
  `;
  
  document.body.appendChild(banner);
  
  // Slide in
  setTimeout(() => {
    banner.style.transform = 'translateX(-50%) translateY(0)';
  }, 100);
  
  const btn = banner.querySelector('#audioUnlockBtn');
  btn.onclick = (e) => {
    e.stopPropagation();
    unlockAudio();
  };
  btn.onmouseover = () => {
    btn.style.background = '#06b6d4';
    btn.style.transform = 'scale(1.03)';
  };
  btn.onmouseout = () => {
    btn.style.background = '#0891b2';
    btn.style.transform = 'scale(1)';
  };
}

function removeAudioUnlockBanner() {
  if (typeof document === 'undefined') return;
  const banner = document.getElementById('audioUnlockBanner');
  if (banner) {
    banner.style.transform = 'translateX(-50%) translateY(120px)';
    setTimeout(() => banner.remove(), 400);
  }
}

async function tryAutoplay() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      const ctx = new AudioContextClass();
      if (ctx.state === 'suspended') {
        showAudioUnlockBanner();
        ctx.close();
      } else {
        _unlocked = true;
        ctx.close();
        startBackgroundKeepAlive();
      }
    } else {
      const audio = new Audio();
      await audio.play();
      _unlocked = true;
      startBackgroundKeepAlive();
    }
  } catch (e) {
    showAudioUnlockBanner();
  }
}

// Automatically bind events for user interaction to unlock audio
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const unlockEvents = ['click', 'touchstart', 'keydown', 'mousedown'];
  const handleAutoUnlock = () => {
    unlockAudio();
    unlockEvents.forEach(evt => document.removeEventListener(evt, handleAutoUnlock));
  };
  unlockEvents.forEach(evt => document.addEventListener(evt, handleAutoUnlock, { once: true }));
  
  // Run permission check after page loads
  if (document.readyState === 'complete') {
    setTimeout(tryAutoplay, 800);
  } else {
    window.addEventListener('load', () => setTimeout(tryAutoplay, 800));
  }
}

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
  // Sự kiện đã cấu hình → theo đúng bật/tắt. Sự kiện mới (vd KDS) chưa có trong
  // config đã lưu → mặc định bật nếu nó là sự kiện hợp lệ trong SOUND_EVENTS.
  if (ev) { if (!ev.enabled) return; }
  else if (!SOUND_EVENTS[event]) return;
  await _play(ev?.sound || SOUND_EVENTS[event]?.default || 'Doorbell', cfg.volume ?? 1.0);
}

export async function previewSound(soundId, volume) {
  await _play(soundId, volume ?? 1.0);
}

async function _play(soundId, volume) {
  const url = `/assets/sounds/notifications/${soundId}.ogg`;
  const audio = new Audio(url);
  // Ensure the sound is sufficiently loud by defaulting to max
  audio.volume = Math.max(0, Math.min(1, Number(volume) || 1.0));
  try { 
    await audio.play(); 
  } catch (e) { 
    console.warn('[sound] Play failed:', e.message); 
    showAudioUnlockBanner();
  }
}
