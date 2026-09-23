import {
  LANGS, normalizeLang, detectLang, byodTokenFromPath, money, clampQty, statusMeta, comboOptionLabel,
  modsLabel, errorMessage, isFullPageError, t,
} from './lib.js';

// ---------------------------------------------------------------------------
// Device identity + token (unchanged contract from the previous minimal UI —
// server/services/byod.js validates this exact device-key shape).
const token = byodTokenFromPath(location.pathname);
const DEVICE_KEY_NAME = 'dandpak_byod_device';
const LANG_KEY_NAME = 'dandpak_byod_lang';
let device = localStorage.getItem(DEVICE_KEY_NAME);
if (!device || !/^[A-Za-z0-9_-]{20,128}$/.test(device)) {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  device = btoa(String.fromCharCode(...bytes)).replace(/[^A-Za-z0-9_-]/g, '').padEnd(24, 'x');
  localStorage.setItem(DEVICE_KEY_NAME, device);
}
const draftKey = `dandpak_byod_draft_${token}_${device}`;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function esc(v) { const d = document.createElement('div'); d.textContent = String(v ?? ''); return d.innerHTML; }
function attr(v) { return esc(v).replace(/"/g, '&quot;'); }

// Keep fixed/sticky controls inside the actually visible browser viewport.
// On iOS the visual viewport changes when browser chrome or the keyboard opens;
// iPhone Duo additionally has an asymmetric system-control area on the right.
function updateViewportLayout() {
  const viewport = window.visualViewport;
  const left = Math.max(0, viewport?.offsetLeft || 0);
  const top = Math.max(0, viewport?.offsetTop || 0);
  const width = viewport?.width || window.innerWidth;
  const height = viewport?.height || window.innerHeight;
  const right = Math.max(0, window.innerWidth - left - width);
  const bottom = Math.max(0, window.innerHeight - top - height);
  const root = document.documentElement;
  root.style.setProperty('--visual-l', `${left}px`);
  root.style.setProperty('--visual-t', `${top}px`);
  root.style.setProperty('--visual-r', `${right}px`);
  root.style.setProperty('--visual-b', `${bottom}px`);
  root.style.setProperty('--viewport-h', `${height}px`);

  const iosLike = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const shortestSide = Math.min(window.innerWidth, window.innerHeight);
  document.body.classList.toggle('iphone-duo-inner', iosLike && shortestSide >= 900);
}
updateViewportLayout();
window.visualViewport?.addEventListener('resize', updateViewportLayout, { passive: true });
window.visualViewport?.addEventListener('scroll', updateViewportLayout, { passive: true });
window.addEventListener('resize', updateViewportLayout, { passive: true });
window.addEventListener('orientationchange', updateViewportLayout, { passive: true });

// ---------------------------------------------------------------------------
const ICONS = {
  back: '<path d="M14.5 5.5 8 12l6.5 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3" stroke="currentColor" stroke-width="1.9"/><path d="M15.6 15.6 20 20" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  cart: '<path d="M4.5 8h15l-1.2 11.1a1.6 1.6 0 0 1-1.6 1.4H7.3a1.6 1.6 0 0 1-1.6-1.4L4.5 8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 8V6.6a3 3 0 0 1 6 0V8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  globe: '<circle cx="12" cy="12" r="8.6" stroke="currentColor" stroke-width="1.7"/><path d="M3.6 9.6h16.8M3.6 14.4h16.8M12 3.4c2.6 2.6 2.6 14.6 0 17.2M12 3.4c-2.6 2.6-2.6 14.6 0 17.2" stroke="currentColor" stroke-width="1.5"/>',
  pin: '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.4" stroke="currentColor" stroke-width="1.8"/>',
  note: '<path d="M15.6 4.8l3.6 3.6L8.9 18.7l-4.4.8.8-4.4L15.6 4.8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  trash: '<path d="M5 7h14M9.5 7V5.6A1.6 1.6 0 0 1 11.1 4h1.8a1.6 1.6 0 0 1 1.6 1.6V7M6.8 7l.9 12a1.6 1.6 0 0 0 1.6 1.5h5.4a1.6 1.6 0 0 0 1.6-1.5l.9-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  minus: '<path d="M5.5 12h13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  check: '<path d="M5.5 12.6 10 17l8.5-9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  clock: '<circle cx="12" cy="12" r="8.6" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.4V12l3.4 2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  flame: '<path d="M12 4.6c1 3 4 4 4 8a4 4 0 1 1-8 0c0-1.4.7-2.2 1.4-3-.1 1 .3 1.6.9 1.8C9.7 9.4 10 6.6 12 4.6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  bowl: '<path d="M4 17h16M7 17c0-3.5 2.2-6 5-6s5 2.5 5 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  x: '<path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  warn: '<circle cx="12" cy="12" r="8.6" stroke="currentColor" stroke-width="1.8"/><path d="M12 10.6v6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.1" fill="currentColor"/>',
  offline: '<path d="M3 8.4a13 13 0 0 1 18 0M6.4 12.2a8.4 8.4 0 0 1 11.2 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.5" fill="currentColor"/><path d="M3.4 3.4 20.6 20.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  scan: '<rect x="3.4" y="3.4" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.7"/><rect x="13.6" y="3.4" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.7"/><rect x="3.4" y="13.6" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.7"/><path d="M14 14.4l6.2 6.2M20.2 14.4 14 20.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  lock: '<path d="M4 10h16M6 10V7.5A1.5 1.5 0 0 1 7.5 6h9A1.5 1.5 0 0 1 18 7.5V10M7 10v8M17 10v8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="18.4" cy="17.6" r="4.2" fill="#fff" stroke="currentColor" stroke-width="1.6"/><path d="M16.8 17.6h3.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  receipt: '<rect x="3.2" y="6" width="17.6" height="12" rx="2.6" stroke="currentColor" stroke-width="1.8"/><path d="M3.2 10.2h17.6" stroke="currentColor" stroke-width="1.8"/><path d="M6.6 14.4h3.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  dish: '<path d="M4 15.5h16M6 15.5c0-4 2.7-7 6-7s6 3 6 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4 18.5h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  bell: '<path d="M12 4.2a5.6 5.6 0 0 1 5.6 5.6v3.4l1.5 2.6H4.9l1.5-2.6V9.8A5.6 5.6 0 0 1 12 4.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10 18.6a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
};
function icon(name, size = 18, extra = '') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true" ${extra}>${ICONS[name] || ''}</svg>`;
}

// ---------------------------------------------------------------------------
function loadLang() {
  const saved = localStorage.getItem(LANG_KEY_NAME);
  if (saved) return normalizeLang(saved);
  return detectLang(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

const state = {
  lang: loadLang(),
  screen: 'welcome', // welcome | menu | detail | cart
  cartTab: 'cart', // cart | ordered
  cartScope: 'mine', // mine | table
  category: 'all',
  search: '',
  detailId: null,
  detail: null, // { qty, selections:Map, comboSelections:Map<Map>, addonSelections:Set, itemNote }
  sheet: null, // language | note | confirmTable | success | null
  noteTarget: null,
  noteDraft: '',
  searchOpen: false,
  toast: null,
  data: null,
  gate: null, // { title, desc, code }
  scanning: false, // S0 · qr_scan camera screen open
  scanDenied: false, // camera permission was denied while scanning was true
  offline: !navigator.onLine,
  sessionClosed: false,
  busyAdd: false,
  busySubmit: false,
  busyPay: false,
  busyStaffCall: false,
  staffCallCooldownUntil: 0,
  socket: null,
  socketReady: false,
};

// ---------------------------------------------------------------------------
async function api(path = '', options = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-BYOD-Device': device, ...(options.headers || {}) };
  let response;
  try {
    response = await fetch(`/api/byod/${encodeURIComponent(token)}${path}`, { ...options, headers });
  } catch {
    throw Object.assign(new Error(t(state.lang, 'errNetwork')), { code: 'NETWORK' });
  }
  const body = await response.json().catch(() => ({ error: t(state.lang, 'errGeneric') }));
  if (!response.ok) throw Object.assign(new Error(body.error || t(state.lang, 'errGeneric')), { code: body.code, status: response.status });
  return body;
}

function menuById(id) { return (state.data?.menu || []).find(m => m.id === id) || null; }

function saveDraft() {
  if (state.data) try { localStorage.setItem(draftKey, JSON.stringify(state.data)); } catch { /* storage full/unavailable — non-fatal */ }
}
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { return null; }
}

// ---------------------------------------------------------------------------
async function bootstrap(silent = false) {
  try {
    const data = await api(`/bootstrap?lang=${encodeURIComponent(state.lang)}`);
    state.data = data;
    state.gate = null;
    state.offline = false;
    saveDraft();
    render({ background: silent });
    if (!state.socketReady) connectRealtime();
  } catch (e) {
    if (e.code === 'NETWORK') {
      state.offline = true;
      const cached = loadDraft();
      if (cached && !state.data) state.data = cached;
      if (!state.data) state.gate = { code: 'NETWORK', title: t(state.lang, 'errGeneric'), desc: t(state.lang, 'errNetwork') };
      render();
      return;
    }
    if (isFullPageError(e.code) || e.code === 'BYOD_SECRET_MISSING') {
      // Luôn dùng bản dịch trong STR — KHÔNG ưu tiên e.message (message của
      // server luôn là tiếng Việt cố định) — nếu không khách chọn ngôn ngữ khác
      // vẫn thấy nguyên câu tiếng Việt ở đúng những màn full-page này.
      const GATE_COPY_KEYS = {
        BYOD_BRANCH_INACTIVE: ['errBranchInactiveTitle', 'errBranchInactiveBody'],
        BYOD_SESSION_IDLE_TIMEOUT: ['sessionExpiredTitle', 'sessionExpiredBody'],
      };
      const [titleKey, bodyKey] = GATE_COPY_KEYS[e.code] || ['errQrInvalidTitle', 'errQrInvalidBody'];
      state.gate = { code: e.code, title: t(state.lang, titleKey), desc: t(state.lang, bodyKey) };
      render();
      return;
    }
    if (!silent) {
      state.gate = { code: e.code || 'ERROR', title: t(state.lang, 'errGeneric'), desc: errorMessage(e.code, e.message, state.lang) };
    }
    render();
  }
}

function connectRealtime() {
  if (typeof io !== 'function') return;
  state.socketReady = true;
  const socket = io({ auth: { device: 'byod', token } });
  state.socket = socket;
  const refresh = () => bootstrap(true);
  ['byod:cart', 'byod:submitted', 'byod:payment', 'order:new', 'order:updated', 'order:item',
    'order:confirmed', 'order:rejected', 'table:updated', 'menu:updated', 'payment:done']
    .forEach(evt => socket.on(evt, refresh));
  socket.on('byod:closed', () => {
    state.sessionClosed = true;
    render();
  });
  socket.on('connect', () => { state.offline = false; render(); bootstrap(true); });
  socket.on('disconnect', () => { state.offline = true; render(); });
}

addEventListener('online', () => { state.offline = false; bootstrap(true); });
addEventListener('offline', () => { state.offline = true; render(); });

// ---------------------------------------------------------------------------
let toastTimer = null;
function showToast(msg, kind = 'ok') {
  clearTimeout(toastTimer);
  state.toast = { msg, kind };
  renderToast();
  toastTimer = setTimeout(() => { state.toast = null; renderToast(); }, 3200);
}
function renderToast() {
  const root = $('#toast');
  root.innerHTML = state.toast
    ? `<div class="toast ${state.toast.kind}"><span class="dot">${icon(state.toast.kind === 'error' ? 'x' : state.toast.kind === 'warn' ? 'warn' : 'check', 12)}</span><span class="msg">${esc(state.toast.msg)}</span></div>`
    : '';
}

// ---------------------------------------------------------------------------
// Cart line helpers — cart rows only carry {group,name} mods and
// {ref_item_id,note} combo refs; human labels for combo choices must be
// resolved against the menu item's own option_groups (server never echoes them).
function cartLineOptionsText(row) {
  const item = menuById(row.menu_item_id);
  const parts = [...modsLabel(row.mods)];
  for (const c of row.combo || []) {
    const resolved = item ? comboOptionLabel(item, c.ref_item_id) : null;
    parts.push(resolved ? resolved.name : c.ref_item_id);
  }
  return parts.join(' · ');
}
function cartComboNotes(row) {
  return (row.combo || []).filter(c => c.note).map(c => {
    const item = menuById(row.menu_item_id);
    const resolved = item ? comboOptionLabel(item, c.ref_item_id) : null;
    return `${resolved ? resolved.name : c.ref_item_id}: ${c.note}`;
  });
}

// ---------------------------------------------------------------------------
// Màn hình gắn vào lịch sử trình duyệt thật (history.pushState/popstate) — thiếu
// cái này thì nút back của Safari/webview và cử chỉ vuốt-từ-mép không có gì để
// lùi về (báo lỗi "2 nút back, 1 cái không hoạt động"), và trên iOS cử chỉ
// vuốt-từ-mép còn có thể NUỐT MẤT cú chạm vào nút back nổi của ta (nút đặt gần
// mép trái) do hệ thống tưởng nhầm là đang vuốt-back — "lúc được lúc không".
// Giải pháp: cho vuốt-back/nút back hệ thống MỘT lịch sử thật để lùi, nút back
// riêng của ta gọi thẳng history.back() nên luôn khớp hành vi với hệ thống.
function navigate(screen, extra = {}) {
  Object.assign(state, { screen, sheet: null }, extra);
  history.pushState({ screen }, '');
  render();
}
addEventListener('popstate', (e) => {
  state.screen = e.state?.screen || 'welcome';
  state.sheet = null;
  render();
});

function render(opts = {}) {
  if (state.scanning) { renderScanner(); $('#app').classList.add('hidden'); return; }
  if (state.gate) { renderGate(); $('#app').classList.add('hidden'); return; }
  $('#gate-root').innerHTML = '';
  $('#app').classList.remove('hidden');
  renderOffline();
  renderHeader();
  renderScreens(opts);
  renderMenuCartFab();
  // A background refresh (realtime event, silent bootstrap) must never blow
  // away a note the guest is mid-typing — only (re)build the note sheet when
  // it isn't already open. Explicit open/save/chip handlers call renderSheet()
  // directly and bypass this guard.
  if (!(state.sheet === 'note' && $('#sheet-root .sheet'))) renderSheet();
  renderSearchSheet();
  renderToast();
}

function renderOffline() {
  const el = $('#offline-banner');
  const show = state.offline;
  el.classList.toggle('hidden', !show);
  document.body.classList.toggle('has-offline', show);
  if (show) el.textContent = t(state.lang, 'offlineBanner');
}

// Mã lỗi mà nút hành động chính nên mở MÀN QUÉT QR THẬT (S0) thay vì chỉ tải
// lại trang — QR không hợp lệ/đã bị thu hồi/bàn không tồn tại hay phiên đã hết
// hạn do rời quán đều cần khách quét một mã QR (đúng bàn hoặc bàn khác) để tiếp tục.
const SCAN_GATE_CODES = new Set(['BYOD_QR_INVALID', 'BYOD_QR_REVOKED', 'BYOD_TABLE_NOT_FOUND', 'BYOD_SESSION_IDLE_TIMEOUT']);
function renderGate() {
  const g = state.gate;
  const canRetry = g.code === 'NETWORK' || g.code === 'BYOD_SECRET_MISSING' || g.code === 'ERROR';
  const canScan = SCAN_GATE_CODES.has(g.code);
  const gateIcon = g.code === 'BYOD_BRANCH_INACTIVE' ? 'clock' : g.code === 'NETWORK' ? 'offline'
    : g.code === 'BYOD_SESSION_IDLE_TIMEOUT' ? 'clock' : 'scan';
  const actionHtml = canScan
    ? `<button type="button" class="btn btn-primary btn-md" data-act="open-scan">${esc(t(state.lang, 'rescanQr'))}</button>`
    : canRetry
      ? `<button type="button" class="btn btn-primary btn-md" data-act="gate-retry">${esc(t(state.lang, 'retry'))}</button>`
      : `<button type="button" class="btn btn-secondary btn-md" data-act="gate-reload">${esc(t(state.lang, 'reload'))}</button>`;
  $('#gate-root').innerHTML = `
    <div id="gate-screen">
      <div class="gate-header"><img src="/assets/DanOnLogo.png" alt="Dan D Pak" style="height:28px"></div>
      <div class="gate-body">
        <div class="gate-icon" style="background:rgba(216,31,38,.09)">${icon(gateIcon, 30, 'style="color:#D81F26"')}</div>
        <div class="gate-title">${esc(g.title)}</div>
        <div class="gate-desc">${esc(g.desc)}</div>
        <div class="gate-actions">${actionHtml}</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// S0 · qr_scan — quét QR THẬT bằng camera (getUserMedia + jsQR, xem index.html/
// jsQR.min.js — thư viện thuần JS, tự host, không cần BarcodeDetector vốn Safari/
// iOS không hỗ trợ, mà khách của quán chủ yếu dùng iPhone). Vào từ nút "Quét lại
// mã QR" ở các gate thuộc SCAN_GATE_CODES phía trên.
let scanStream = null;
let scanTimer = null;
let scanCanvas = null;
let scanCtx = null;
let scanGeneration = 0; // bumped on every open/close — lets a stale getUserMedia() resolving late tell it's no longer wanted, instead of leaking a live camera stream nobody stops.

function stopScanTracking() {
  scanGeneration += 1;
  clearInterval(scanTimer);
  scanTimer = null;
  if (scanStream) { scanStream.getTracks().forEach(tr => tr.stop()); scanStream = null; }
}

function closeScanner() {
  stopScanTracking();
  state.scanning = false;
  state.scanDenied = false;
  render();
}

async function openScanner() {
  stopScanTracking();
  const myGen = scanGeneration;
  state.scanning = true;
  state.scanDenied = false;
  render();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    if (myGen !== scanGeneration) return;
    state.scanDenied = true;
    render();
    return;
  }
  if (myGen !== scanGeneration || !state.scanning) { stream.getTracks().forEach(tr => tr.stop()); return; }
  scanStream = stream;
  const video = $('#scan-video');
  if (!video) { stopScanTracking(); return; }
  video.srcObject = scanStream;
  await video.play().catch(() => {});
  scanTimer = setInterval(scanTick, 220);
}

function scanTick() {
  const video = $('#scan-video');
  if (!video || video.readyState < 2 || typeof jsQR !== 'function') return;
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return;
  if (!scanCanvas) { scanCanvas = document.createElement('canvas'); scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true }); }
  scanCanvas.width = w; scanCanvas.height = h;
  scanCtx.drawImage(video, 0, 0, w, h);
  let code;
  try { code = jsQR(scanCtx.getImageData(0, 0, w, h).data, w, h); } catch { return; }
  if (code && code.data) handleScanResult(code.data);
}

// Mã QR in trên bàn luôn là link tuyệt đối "<PUBLIC_ORIGIN>/BYOD/<token>" (xem
// publicUrl() trong server/services/byod.js) — chỉ cần khớp đúng hình dạng
// đường dẫn này rồi ĐIỀU HƯỚNG THẬT sang đó, để trang mới tự bootstrap() và
// server xác thực token lại từ đầu (không tự chấm token ở client).
function handleScanResult(text) {
  stopScanTracking();
  let url = null;
  try { url = new URL(text, location.origin); } catch { /* not a URL at all */ }
  const validScheme = url && (url.protocol === 'https:' || url.protocol === 'http:');
  const match = validScheme && url.pathname.match(/^\/BYOD\/([A-Za-z0-9_-]{32,128})$/i);
  if (!match) {
    state.scanning = false;
    state.gate = { code: 'BYOD_QR_INVALID', title: t(state.lang, 'errQrInvalidTitle'), desc: t(state.lang, 'errQrInvalidBody') };
    render();
    return;
  }
  location.replace(url.href);
}

function renderScanner() {
  if (state.scanDenied) {
    $('#gate-root').innerHTML = `
      <div id="gate-screen">
        <div class="gate-header"><img src="/assets/DanOnLogo.png" alt="Dan D Pak" style="height:28px"></div>
        <div class="gate-body">
          <div class="gate-icon" style="background:rgba(216,31,38,.09)">${icon('lock', 30, 'style="color:#D81F26"')}</div>
          <div class="gate-title">${esc(t(state.lang, 'cameraDeniedTitle'))}</div>
          <div class="gate-desc">${esc(t(state.lang, 'cameraDenied'))}</div>
          <div class="gate-actions">
            <button type="button" class="btn btn-primary btn-md" data-act="scan-retry">${esc(t(state.lang, 'retry'))}</button>
            <button type="button" class="btn btn-secondary btn-md" data-act="scan-close">${esc(t(state.lang, 'back'))}</button>
          </div>
        </div>
      </div>`;
    return;
  }
  $('#gate-root').innerHTML = `
    <div id="gate-screen" class="scan-screen">
      <div class="scan-header">
        ${token
          ? `<button type="button" class="scan-close-btn" data-act="scan-close" aria-label="${attr(t(state.lang, 'back'))}">${icon('x', 18)}</button>`
          : '<span class="scan-header-side" aria-hidden="true"></span>'}
        <img class="scan-header-logo" src="/assets/DanOnLogo.png" alt="Dan D Pak">
        <span class="scan-header-side" aria-hidden="true"></span>
      </div>
      <div class="scan-title">${esc(t(state.lang, 'qrScanTitle'))}</div>
      <div class="scan-viewport">
        <div class="scan-square">
          <video id="scan-video" autoplay muted playsinline></video>
          <div class="scan-frame"><div class="scan-line"></div></div>
          <div class="scan-frame-hint">${esc(t(state.lang, 'qrScanFrameHint'))}</div>
        </div>
      </div>
      <div class="scan-footer">
        <div class="scan-hint">${esc(t(state.lang, 'qrScanHint'))}</div>
      </div>
    </div>`;
}

function cartCount() {
  return (state.data?.cart?.table || []).reduce((s, r) => s + (r.qty || 0), 0);
}

function renderHeader() {
  const header = $('#app-header');
  // Header is hidden on 'welcome' — the call-staff button lives inside it, so
  // this also removes the button from the welcome screen for free (by design:
  // welcome has no sticky footer, so a call-staff control there is unneeded).
  if (state.screen === 'welcome' || !state.data) { header.classList.add('hidden'); return; }
  header.classList.remove('hidden');
  $('#lang-flag').src = (LANGS.find(l => l.code === state.lang) || LANGS[0]).flag;
  const d = state.data;
  renderStaffCallButton();
  const busy = d.table?.status === 'busy';
  $('#header-info').innerHTML = `
    <span class="crumb">${icon('pin', 13)}${esc(d.branch?.name || 'Dan D Pak')}</span>
    <span class="sep"></span>
    <span class="crumb">${esc(t(state.lang, 'area'))} ${esc(d.table?.zone || '')}</span>
    <span class="sep"></span>
    <span class="crumb"><b>${esc(t(state.lang, 'tableWord'))} ${esc(d.table?.code || '')}</b></span>
    <span class="status-pill ${busy ? 'serving' : 'free'}"><span class="status-dot ${busy ? 'pulse' : ''}"></span>${esc(busy ? t(state.lang, 'serving') : t(state.lang, 'tableFree'))}</span>`;
}

// Header button, not a floating overlay — labelled (not a bare icon) and
// gated behind a confirm sheet (see 'call-staff'/'confirm-call-staff') so a
// stray tap on a guest's own phone can't page staff by accident.
function renderStaffCallButton() {
  const btn = $('#btn-staff-call');
  $('#staff-call-label').textContent = t(state.lang, 'callStaff');
  btn.setAttribute('aria-label', t(state.lang, 'callStaff'));
  const cooling = Date.now() < state.staffCallCooldownUntil;
  btn.disabled = state.busyStaffCall || cooling;
}

// Cart shortcut FAB: menu screen only — welcome has its own "view cart"
// button and every other screen is one tap from the grid, so this is the
// only place a floating cart shortcut earns its keep.
function renderMenuCartFab() {
  const btn = $('#btn-menu-cart');
  const count = state.data ? cartCount() : 0;
  const show = state.data && state.screen === 'menu' && count > 0;
  btn.classList.toggle('hidden', !show);
  if (show) $('#menu-cart-badge').textContent = String(count);
}

// Signature of everything about a menu item that could make an already-open
// Detail screen stale (price, sold-out, per-option/addon availability).
// Used to tell a genuine background data change apart from a realtime event
// that has nothing to do with what the guest is currently configuring.
function detailSignature(item) {
  if (!item) return '';
  const parts = [item.price, item.can_order ? 1 : 0];
  (item.option_groups || []).forEach(g => (g.options || [])
    .forEach(o => parts.push(o.available === false ? 0 : 1, o.sale_price ?? o.price)));
  (item.addons || []).forEach(a => parts.push(a.available === false ? 0 : 1, a.sale_price ?? a.price));
  return parts.join('|');
}
let lastDetailSig = null;

function renderScreens(opts = {}) {
  ['welcome', 'menu', 'detail', 'cart'].forEach(name => {
    $(`#screen-${name}`).classList.toggle('hidden', state.screen !== name);
  });
  if (!state.data) { renderMenuLoading(); return; }
  if (state.screen === 'welcome') renderWelcome();
  else if (state.screen === 'menu') renderMenu();
  else if (state.screen === 'detail') {
    const item = menuById(state.detailId);
    const sig = detailSignature(item);
    // A background silent refresh (realtime event, reconnect resync) must not
    // rebuild the whole screen — and drop the guest's scroll position — when
    // nothing about the item they're configuring actually changed.
    if (opts.background && sig === lastDetailSig && $('#screen-detail').childElementCount) return;
    lastDetailSig = sig;
    renderDetail();
  }
  else if (state.screen === 'cart') renderCart();
}

function renderMenuLoading() {
  $('#screen-welcome').innerHTML = `<div class="welcome-body"><div class="menu-loading">${esc(t(state.lang, 'loadingApp'))}</div></div>`;
  $('#screen-welcome').classList.remove('hidden');
  $('#screen-menu').classList.add('hidden');
  $('#screen-detail').classList.add('hidden');
  $('#screen-cart').classList.add('hidden');
}

// ---------------------------------------------------------------------------
function renderWelcome() {
  const d = state.data;
  const tableLabel = `${esc(t(state.lang, 'tableWord'))} ${esc(d.table?.code || '')}`;
  const hasAny = (d.cart?.table?.length || 0) > 0 || (d.orders?.length || 0) > 0;
  $('#screen-welcome').innerHTML = `
    <div class="welcome-top">
      <button type="button" class="welcome-lang" data-act="open-lang"><img class="lang-flag" src="${attr((LANGS.find(l => l.code === state.lang) || LANGS[0]).flag)}" alt=""><span>${esc((LANGS.find(l => l.code === state.lang) || LANGS[0]).name)}</span></button>
    </div>
    <div class="welcome-body">
      <img class="welcome-logo" src="/assets/DanOnLogo.png" alt="Dan D Pak">
      <div class="welcome-title">${esc(t(state.lang, 'welcome'))}</div>
      <div class="welcome-table-chip">${icon('receipt', 16, 'style="color:#D81F26"')}<span>${esc(d.branch?.name || '')} · ${tableLabel}</span></div>
      <div class="welcome-note">${icon('warn', 18, 'style="color:#9A6B00;flex:none;margin-top:1px"')}<span class="text">${esc(t(state.lang, 'shareNote', { table: tableLabel }))}</span></div>
    </div>
    <div class="welcome-actions">
      <button type="button" class="btn btn-primary btn-lg" data-act="go-menu">${esc(t(state.lang, 'viewMenu'))} ${icon('back', 18, 'style="transform:rotate(180deg)"')}</button>
      ${hasAny ? `<button type="button" class="btn btn-secondary btn-md" data-act="go-cart">${esc(t(state.lang, 'viewCart'))}</button>` : ''}
    </div>`;
}

// ---------------------------------------------------------------------------
// Banner quảng cáo đầu menu (Cài đặt → Hiển thị khách hàng → BYOD). Xoay bằng
// cách CHỈNH TRỰC TIẾP transform/dot trên node đã có, không gọi lại render() —
// tránh việc cứ vài giây lại rebuild toàn bộ lưới món (mất vị trí cuộn, giật
// UI), đúng nguyên nhân đã sửa cho nút gạt "Hiển thị" ở app Cài đặt.
let bannerTimer = null;
function stopBannerRotation() { clearInterval(bannerTimer); bannerTimer = null; }
function bannerHtml(banner) {
  const images = banner?.enabled ? (banner.images || []) : [];
  if (!images.length) return '';
  const slides = images.map(src => `<div class="menu-banner-slide" style="width:${100 / images.length}%"><img src="${attr(src)}" alt="" loading="lazy"></div>`).join('');
  const dots = images.length > 1 ? `<div class="menu-banner-dots">${images.map((_, i) => `<i class="${i === 0 ? 'active' : ''}"></i>`).join('')}</div>` : '';
  return `<div class="menu-banner"><div class="menu-banner-track" id="menu-banner-track" style="width:${images.length * 100}%">${slides}</div>${dots}</div>`;
}
function startBannerRotation(banner) {
  stopBannerRotation();
  const images = banner?.enabled ? (banner.images || []) : [];
  if (images.length < 2) return;
  let i = 0;
  const seconds = Math.max(3, Math.min(30, Number(banner.secondsPerImage) || 5));
  bannerTimer = setInterval(() => {
    const track = document.getElementById('menu-banner-track');
    if (!track || state.screen !== 'menu') { stopBannerRotation(); return; }
    i = (i + 1) % images.length;
    track.style.transform = `translateX(-${i * (100 / images.length)}%)`;
    $$('.menu-banner-dots i').forEach((dot, idx) => dot.classList.toggle('active', idx === i));
  }, seconds * 1000);
}

function renderMenu() {
  const d = state.data;
  const cats = Array.isArray(d.categories) ? d.categories : [];
  const catChips = [{ id: 'all', name: t(state.lang, 'all') }, ...cats];
  const menu = d.menu || [];
  const q = state.search.trim().toLocaleLowerCase();
  const filtered = menu.filter(it => (state.category === 'all' || it.category_id === state.category)
    && (!q || `${it.name} ${it.description || ''}`.toLocaleLowerCase().includes(q)));

  const catsHtml = catChips.map(c => `<button type="button" class="chip-cat ${state.category === c.id ? 'active' : ''}" data-act="pick-cat" data-cat="${attr(c.id)}">${esc(c.name)}</button>`).join('');

  const gridHtml = filtered.length ? filtered.map(it => {
    const soldOut = !it.can_order;
    return `<button type="button" class="dish-card" data-act="open-item" data-id="${attr(it.id)}" aria-label="${attr(it.name)}">
      <div class="dish-photo">
        ${it.image ? `<img src="${attr(it.image)}" alt="" loading="lazy">` : `<span class="ph-icon">${icon('dish', 34, 'style="color:#C9BFAF"')}</span>`}
        ${soldOut ? `<span class="dish-soldout-badge">${esc(t(state.lang, 'soldOut'))}</span>` : ''}
      </div>
      <div class="dish-body">
        <div class="dish-name">${esc(it.name)}</div>
        ${it.description ? `<div class="dish-desc">${esc(it.description)}</div>` : ''}
        <div class="dish-foot">
          <span class="dish-price-col">
            <span class="dish-price">${esc(money(it.price))}</span>
            ${it.sla_minutes ? `<span class="dish-prep-time">${icon('clock', 11)}${esc(t(state.lang, 'prepTime', { min: it.sla_minutes }))}</span>` : ''}
          </span>
          <span class="dish-add ${soldOut ? 'disabled' : ''}">${icon(soldOut ? 'x' : 'plus', 15)}</span>
        </div>
      </div>
    </button>`;
  }).join('') : `<div class="menu-empty">${esc(t(state.lang, 'searchEmpty'))}</div>`;

  $('#screen-menu').innerHTML = `
    ${bannerHtml(d.banner)}
    <div class="menu-cats"><div class="menu-cats-row">${catsHtml}</div></div>
    <div class="menu-heading"><span class="title">${esc((catChips.find(c => c.id === state.category) || catChips[0]).name)}</span><span class="count">${filtered.length} ${esc(t(state.lang, 'items'))}</span></div>
    <div class="menu-grid">${gridHtml}</div>
    <div class="menu-vat-note">
      ${esc(t(state.lang, 'vatIncluded'))}
      <div class="menu-credit-note"><a href="https://deron.vn/#about" target="_blank" rel="noopener noreferrer">${esc(t(state.lang, 'poweredBy'))}</a></div>
    </div>
    <div class="floating-bottom">
      <button type="button" class="pill-btn back" data-act="go-welcome" aria-label="${attr(t(state.lang, 'back'))}">${icon('back', 20)}</button>
      <button type="button" class="pill-btn search-bubble" data-act="open-search">${icon('search', 18, 'style="color:#677084;flex:none"')}<span class="q ${state.search ? 'filled' : ''}">${esc(state.search || t(state.lang, 'searchPlaceholder'))}</span></button>
    </div>`;
  startBannerRotation(d.banner);
}

// ---------------------------------------------------------------------------
function detailGroupKey(i) { return `g${i}`; }

function detailUnitPrice(item, d) {
  let extra = 0;
  (item.option_groups || []).forEach((g, i) => {
    if (g.mode === 'combo') return;
    const sel = d.selections.get(detailGroupKey(i));
    if (!sel) return;
    (g.options || []).forEach(o => { if (sel.has(o.name)) extra += Number(o.sale_price ?? o.price) || 0; });
  });
  (item.addons || []).forEach(a => { if (d.addonSelections.has(a.name)) extra += Number(a.sale_price ?? a.price) || 0; });
  (item.option_groups || []).forEach((g, i) => {
    if (g.mode !== 'combo') return;
    const sel = d.comboSelections.get(detailGroupKey(i));
    if (!sel) return;
    for (const ref of sel.keys()) {
      const opt = (g.options || []).find(o => o.ref_item_id === ref);
      if (opt) extra += Number(opt.sale_price ?? opt.price) || 0;
    }
  });
  return (Number(item.price) || 0) + extra;
}

function detailValid(item, d) {
  return (item.option_groups || []).every((g, i) => {
    const sel = g.mode === 'combo' ? d.comboSelections.get(detailGroupKey(i)) : d.selections.get(detailGroupKey(i));
    const n = sel ? sel.size : 0;
    const min = Math.max(0, Number(g.min) || 0);
    const max = Math.max(0, Number(g.max) || 0);
    return n >= min && (!max || n <= max);
  });
}

function groupHintText(g) {
  const min = Math.max(0, Number(g.min) || 0);
  const max = Math.max(0, Number(g.max) || 0);
  if (min > 0 && max === 1) return t(state.lang, 'required');
  if (min > 0 && min === max) return t(state.lang, 'chooseExact', { n: min });
  if (min > 0) return max ? t(state.lang, 'chooseUpTo', { n: max }) : t(state.lang, 'required');
  if (max === 1) return `${t(state.lang, 'optional')} · ${t(state.lang, 'chooseOne')}`;
  if (max) return t(state.lang, 'chooseUpTo', { n: max });
  return t(state.lang, 'optional');
}

function openItem(id) {
  const item = menuById(id);
  if (!item) return;
  if (!item.can_order) { showToast(`${t(state.lang, 'soldOut')} · ${item.name}`, 'warn'); return; }
  state.detailId = id;
  state.detail = { qty: 1, selections: new Map(), comboSelections: new Map(), addonSelections: new Set(), itemNote: '' };
  navigate('detail');
  $('#screens').scrollTo({ top: 0 });
}

function renderDetail() {
  const item = menuById(state.detailId);
  if (!item) { navigate('menu'); return; }
  const d = state.detail;
  const groups = item.option_groups || [];

  const groupsHtml = groups.map((g, i) => {
    const key = detailGroupKey(i);
    const isCombo = g.mode === 'combo';
    const selSet = isCombo ? (d.comboSelections.get(key) || new Map()) : (d.selections.get(key) || new Set());
    const min = Math.max(0, Number(g.min) || 0);
    const required = min > 0;
    const optsHtml = (g.options || []).map(o => {
      const picked = isCombo ? selSet.has(o.ref_item_id) : selSet.has(o.name);
      const soldOut = o.available === false;
      const note = isCombo ? (selSet.get(o.ref_item_id) || '') : '';
      return `<div class="opt-row ${picked ? 'picked' : ''} ${soldOut ? 'soldout' : ''}">
        <button type="button" class="opt-main" data-act="pick-opt" data-gi="${i}" data-combo="${isCombo ? 1 : 0}" data-val="${attr(isCombo ? o.ref_item_id : o.name)}" ${soldOut ? 'aria-disabled="true"' : ''}>
          <span class="opt-dot ${g.max === 1 ? '' : 'square'}">${picked ? icon('check', 12, 'style="color:#fff"') : ''}</span>
          <span class="opt-label">${esc(o.name)}${soldOut ? ` — ${esc(t(state.lang, 'soldOut'))}` : ''}</span>
          <span class="opt-price">+${esc(money(o.sale_price ?? o.price))}</span>
        </button>
        ${isCombo && picked ? `<button type="button" class="opt-note-btn ${note ? 'filled' : ''}" data-act="open-combo-note" data-gi="${i}" data-ref="${attr(o.ref_item_id)}" aria-label="${attr(t(state.lang, 'noteComp'))}">${icon('note', 15, `style="color:${note ? '#9A6B00' : '#677084'}"`)}</button>` : ''}
      </div>
      ${isCombo && picked && note ? `<div class="opt-note-line">${icon('note', 12, 'style="color:#9A6B00;flex:none;margin-top:2px"')}<span>${esc(note)}</span></div>` : ''}`;
    }).join('');
    return `<div class="opt-group">
      <div class="opt-group-head"><span class="opt-group-title">${esc(g.name)}</span><span class="opt-group-hint ${required ? 'required' : ''}">${esc(groupHintText(g))}</span></div>
      <div class="opt-list">${optsHtml}</div>
    </div>`;
  }).join('');

  const addonsHtml = (item.addons || []).length ? `<div class="opt-group">
    <div class="opt-group-head"><span class="opt-group-title">${esc(t(state.lang, 'addItems'))}</span><span class="opt-group-hint">${esc(t(state.lang, 'optional'))}</span></div>
    <div class="opt-list">${item.addons.map(a => {
      const picked = d.addonSelections.has(a.name);
      const soldOut = a.available === false;
      return `<div class="opt-row ${picked ? 'picked' : ''} ${soldOut ? 'soldout' : ''}">
        <button type="button" class="opt-main" data-act="pick-addon" data-val="${attr(a.name)}" ${soldOut ? 'aria-disabled="true"' : ''}>
          <span class="opt-dot square">${picked ? icon('check', 12, 'style="color:#fff"') : ''}</span>
          <span class="opt-label">${esc(a.name)}${soldOut ? ` — ${esc(t(state.lang, 'soldOut'))}` : ''}</span>
          <span class="opt-price">+${esc(money(a.sale_price ?? a.price))}</span>
        </button>
      </div>`;
    }).join('')}</div>
  </div>` : '';

  const hasCombo = groups.some(g => g.mode === 'combo');
  const valid = detailValid(item, d);
  const unit = detailUnitPrice(item, d);

  $('#screen-detail').innerHTML = `
    <div class="detail-photo">
      <button type="button" class="detail-back-btn" data-act="nav-back" aria-label="${attr(t(state.lang, 'back'))}">${icon('back', 19)}</button>
      ${item.image ? `<img src="${attr(item.image)}" alt="">` : `<span class="ph-icon">${icon('dish', 56, 'style="color:#DCD2C0"')}</span>`}
    </div>
    <div class="detail-head">
      <div class="detail-title">${esc(item.name)}</div>
      ${item.description ? `<div class="detail-desc">${esc(item.description)}</div>` : ''}
      <div class="detail-price-row">
        <span class="detail-price">${esc(money(item.price))}</span>
        <span class="detail-vat-tag">${esc(t(state.lang, 'vatIncluded'))}</span>
        ${item.sla_minutes ? `<span class="detail-prep-time">${icon('clock', 12)}${esc(t(state.lang, 'prepTime', { min: item.sla_minutes }))}</span>` : ''}
        ${!item.can_order ? `<span class="detail-soldout-tag">${esc(t(state.lang, 'soldOut'))}</span>` : ''}
      </div>
    </div>
    ${groupsHtml}
    ${addonsHtml}
    ${hasCombo ? `<div class="combo-hint">${icon('warn', 17, 'style="color:#0A6E85;flex:none;margin-top:1px"')}<span>${esc(t(state.lang, 'comboNoteHint'))}</span></div>` : ''}
    <div style="height:8px"></div>
    <div class="detail-bottom">
      <button type="button" class="detail-note-row" data-act="open-item-note">${icon('note', 17, 'style="color:#9AA3B2;flex:none"')}<span class="${d.itemNote ? 'filled' : ''}">${esc(d.itemNote || t(state.lang, 'itemNoteEmpty'))}</span></button>
      <div class="detail-add-row">
        <div class="detail-add-top">
          <div class="stepper">
            <button type="button" data-act="detail-qty" data-delta="-1" aria-label="${attr(t(state.lang, 'remove'))}" ${d.qty <= 1 ? 'disabled' : ''}>${icon('minus', 14)}</button>
            <span class="qty">${d.qty}</span>
            <button type="button" data-act="detail-qty" data-delta="1" aria-label="+">${icon('plus', 14)}</button>
          </div>
          <div class="detail-total"><div class="lbl">${esc(t(state.lang, 'total'))}</div><div class="val">${esc(money(unit * d.qty))}</div></div>
        </div>
        <button type="button" class="btn btn-primary detail-add-btn" data-act="add-to-cart" ${(!valid || !item.can_order || state.busyAdd) ? 'disabled' : ''}>${icon('cart', 18, 'style="color:#fff"')}${esc(t(state.lang, 'addToCart'))}</button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
function renderCart() {
  const d = state.data;
  const payStatus = d.payment_request?.status || 'none';
  const bannerHtml = payStatus === 'paid'
    ? `<div class="pay-banner done">${esc(t(state.lang, 'payPaid'))}</div>`
    : payStatus === 'acknowledged'
      ? `<div class="pay-banner ack">${esc(t(state.lang, 'payAcknowledged'))}</div>`
      : payStatus === 'requested'
        ? `<div class="pay-banner">${esc(t(state.lang, 'paySent'))}</div>`
        : '';
  const closedHtml = state.sessionClosed ? `<div class="pay-banner">${esc(t(state.lang, 'errSessionClosed'))}</div>` : '';

  const tabsHtml = `<div class="cart-tabs"><div class="cart-tabs-row">
    <button type="button" class="cart-tab ${state.cartTab === 'cart' ? 'active' : ''}" data-act="cart-tab" data-tab="cart"><span class="lbl">${esc(t(state.lang, 'cart'))}</span>${(d.cart?.table?.length) ? `<span class="count draft">${d.cart.table.reduce((s, r) => s + r.qty, 0)}</span>` : ''}</button>
    <button type="button" class="cart-tab ${state.cartTab === 'ordered' ? 'active' : ''}" data-act="cart-tab" data-tab="ordered"><span class="lbl">${esc(t(state.lang, 'ordered'))}</span>${(d.orders?.length) ? `<span class="count ordered">${d.orders.reduce((s, o) => s + (o.items?.length || 0), 0)}</span>` : ''}</button>
  </div></div>`;

  const body = state.cartTab === 'cart' ? renderCartTab() : renderOrderedTab();

  $('#screen-cart').innerHTML = `${tabsHtml}${bannerHtml}${closedHtml}${body}`;
}

function renderCartTab() {
  const d = state.data;
  const mineQty = (d.cart?.mine || []).reduce((s, r) => s + r.qty, 0);
  const tableQty = (d.cart?.table || []).reduce((s, r) => s + r.qty, 0);
  const rows = state.cartScope === 'mine' ? (d.cart?.mine || []) : (d.cart?.table || []);
  const total = state.cartScope === 'mine' ? (d.cart?.my_total || 0) : (d.cart?.table_total || 0);

  const scopeHtml = `<div class="scope-list">
    <button type="button" class="scope-row ${state.cartScope === 'mine' ? 'active' : ''}" data-act="cart-scope" data-scope="mine">
      <span class="scope-dot"><i></i></span><span class="scope-label">${esc(t(state.lang, 'viewMine'))}</span><span class="scope-count ${mineQty ? 'has' : ''}">${mineQty}</span>
    </button>
    <button type="button" class="scope-row ${state.cartScope === 'table' ? 'active' : ''}" data-act="cart-scope" data-scope="table">
      <span class="scope-dot"><i></i></span><span class="scope-label">${esc(t(state.lang, 'viewMembers'))}</span><span class="scope-count ${tableQty ? 'has' : ''}">${tableQty}</span>
    </button>
  </div>`;

  const listHtml = rows.length ? `<div class="cart-list">${rows.map(r => cartRowHtml(r)).join('')}</div>` : `<div class="cart-empty">
    <div class="title">${esc(t(state.lang, 'empty'))}</div>
    <div class="hint">${esc(t(state.lang, 'emptyHint', { table: `${t(state.lang, 'tableWord')} ${d.table?.code || ''}` }))}</div>
  </div>`;

  const summaryHtml = rows.length ? `<div class="summary-card"><div class="summary-row total"><span class="lbl">${esc(t(state.lang, 'grandTotal'))}</span><span class="val">${esc(money(total))}</span></div></div>` : '';

  const canOrder = rows.length > 0;
  const payStatus = d.payment_request?.status || 'none';
  const hasOrders = (d.orders?.length || 0) > 0;
  let primaryHtml;
  if (canOrder) {
    primaryHtml = `<button type="button" class="btn btn-primary" data-act="submit-scope" data-scope="${state.cartScope}" ${state.busySubmit ? 'disabled' : ''}>${esc(t(state.lang, 'placeOrder'))}</button>`;
  } else if (hasOrders) {
    const disabled = payStatus !== 'none' || state.busyPay || state.sessionClosed;
    primaryHtml = `<button type="button" class="btn btn-dark" data-act="request-payment" ${disabled ? 'disabled' : ''}>${esc(payStatus === 'none' ? t(state.lang, 'requestPayment') : t(state.lang, 'payAlready'))}</button>`;
  } else {
    primaryHtml = `<button type="button" class="btn btn-primary" disabled>${esc(t(state.lang, 'requestPayment'))}</button>`;
  }

  return `${scopeHtml}${listHtml}${summaryHtml}
    <div style="height:8px"></div>
    <div class="cart-bottom">
      <button type="button" class="btn btn-secondary" data-act="go-menu">${icon('plus', 16)}${esc(t(state.lang, 'addItems'))}</button>
      ${primaryHtml}
    </div>`;
}

function cartRowHtml(r) {
  const optsText = cartLineOptionsText(r);
  const comboNotes = cartComboNotes(r);
  return `<div class="cart-row">
    <div class="cart-thumb">${r.image ? `<img src="${attr(r.image)}" alt="">` : icon('dish', 26, 'style="color:#C9BFAF"')}</div>
    <div class="cart-body">
      <div class="cart-title-row"><span class="name">${esc(r.name)}</span><span class="amount">${esc(money(r.amount))}</span></div>
      ${optsText ? `<div class="cart-options">${esc(optsText)}</div>` : ''}
      ${r.note ? `<div class="cart-note">${icon('note', 12, 'style="color:#9A6B00;flex:none;margin-top:3px"')}<span>${esc(r.note)}</span></div>` : ''}
      ${comboNotes.map(n => `<div class="cart-note">${icon('note', 12, 'style="color:#9A6B00;flex:none;margin-top:3px"')}<span>${esc(n)}</span></div>`).join('')}
      <div class="cart-meta">${esc(money(r.unit_price))} · ${esc(r.device_name || '')}${!r.available ? ` · ${esc(t(state.lang, 'errItemUnavailable'))}` : ''}</div>
      <div class="cart-controls">
        ${r.mine ? `
          <div class="stepper">
            <button type="button" data-act="cart-qty" data-id="${attr(r.id)}" data-delta="-1" aria-label="-">${icon('minus', 13)}</button>
            <span class="qty">${r.qty}</span>
            <button type="button" data-act="cart-qty" data-id="${attr(r.id)}" data-delta="1" aria-label="+">${icon('plus', 13)}</button>
          </div>
          <button type="button" class="btn-note" data-act="open-cart-note" data-id="${attr(r.id)}">${icon('note', 13)}${esc(t(state.lang, 'edit'))}</button>
          <button type="button" class="btn-remove" data-act="cart-remove" data-id="${attr(r.id)}" aria-label="${attr(t(state.lang, 'remove'))}">${icon('trash', 15, 'style="color:#D81F26"')}</button>
        ` : `<span class="cart-readonly-tag">×${r.qty}</span>`}
      </div>
    </div>
  </div>`;
}

function renderOrderedTab() {
  const d = state.data;
  const orders = d.orders || [];
  if (!orders.length) return `<div class="ordered-empty">${esc(t(state.lang, 'empty'))}</div>`;

  let grand = 0;
  const turnsHtml = orders.map((o, idx) => {
    grand += Number(o.total) || 0;
    const byParent = new Map();
    const top = [];
    for (const it of o.items || []) {
      if (it.parent_item_id) { if (!byParent.has(it.parent_item_id)) byParent.set(it.parent_item_id, []); byParent.get(it.parent_item_id).push(it); }
      else top.push(it);
    }
    const rowsHtml = top.map(it => orderItemHtml(it) + (byParent.get(it.id) || []).map(child => orderItemHtml(child, true)).join('')).join('');
    return `<div class="turn-group">
      <div class="turn-head"><span class="turn-badge">${esc(t(state.lang, 'orderTurn'))} ${idx + 1}</span><span class="turn-time">${esc(formatTime(o.created_at))}</span></div>
      <div class="order-list">${rowsHtml}</div>
    </div>`;
  }).join('');

  const summaryHtml = `<div class="summary-card">
    <div class="summary-row total"><span class="lbl">${esc(t(state.lang, 'grandTotal'))}</span><span class="val">${esc(money(grand))}</span></div>
  </div>`;

  return `<div style="height:8px"></div>${turnsHtml}${summaryHtml}<div style="height:96px"></div>`;
}

function orderItemHtml(it, isChild = false) {
  const meta = statusMeta(it.status, state.lang);
  return `<div class="order-row ${isChild ? 'child' : ''}">
    <div class="order-body">
      <div class="order-title-row"><span class="name">${esc(it.name)}</span><span class="amount">${esc(money((Number(it.unit_price) || 0) * it.qty))}</span></div>
      ${it.note ? `<div class="order-note">${esc(it.note)}</div>` : ''}
      ${it.status === 'cancelled' && it.reject_reason ? `<div class="order-reject">${esc(it.reject_reason)}</div>` : ''}
      <div class="order-foot">
        <span class="order-qty">×${it.qty}</span>
        <span class="status-chip" style="background:${meta.bg};border-color:${meta.bd};color:${meta.fg}">${icon(meta.icon, 12, `style="color:${meta.fg}"`)}${esc(meta.label)}</span>
      </div>
    </div>
  </div>`;
}

function formatTime(iso) {
  try { return new Date(String(iso).replace(' ', 'T') + 'Z').toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

// ---------------------------------------------------------------------------
function renderSheet() {
  const root = $('#sheet-root');
  if (!state.sheet) { root.innerHTML = ''; return; }
  const overlay = `<div id="sheet-overlay" data-act="close-sheet"></div>`;
  let inner = '';
  if (state.sheet === 'language') inner = languageSheetHtml();
  else if (state.sheet === 'note') inner = noteSheetHtml();
  else if (state.sheet === 'confirmTable') inner = confirmTableSheetHtml();
  else if (state.sheet === 'confirmStaffCall') inner = confirmStaffCallSheetHtml();
  else if (state.sheet === 'success') inner = successSheetHtml();
  root.innerHTML = overlay + inner;
  if (state.sheet === 'note') { const ta = $('#note-textarea'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
}

function languageSheetHtml() {
  return `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>
    <div class="sheet-title">${esc(t(state.lang, 'langTitle'))}</div>
    <div class="lang-list">${LANGS.map(l => `<button type="button" class="lang-row ${l.code === state.lang ? 'active' : ''}" data-act="pick-lang" data-lang="${l.code}">
      <img class="lang-flag lang-flag-lg" src="${attr(l.flag)}" alt=""><span class="lang-name">${esc(l.name)}</span>${l.code === state.lang ? icon('check', 18, 'style="color:#D81F26"') : ''}
    </button>`).join('')}</div>
  </div>`;
}

function noteSheetHtml() {
  const nt = state.noteTarget || {};
  const isComp = nt.kind === 'combo';
  return `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>
    <div class="sheet-title">${esc(isComp ? t(state.lang, 'noteComp') : t(state.lang, 'noteItem'))}</div>
    <div class="sheet-sub">${esc(isComp ? (nt.label ? `${nt.label} — ` : '') + t(state.lang, 'noteCompSub') : t(state.lang, 'noteItemSub'))}</div>
    <div class="sheet-body">
      <textarea id="note-textarea" class="note-textarea" rows="3" maxlength="200" placeholder="${attr(t(state.lang, 'notePlaceholder'))}" data-act="note-input">${esc(state.noteDraft)}</textarea>
      <div class="note-chips"><div class="note-chips-row">${noteChipOptions().map(c => `<button type="button" class="note-chip" data-act="note-chip" data-val="${attr(c)}">${esc(c)}</button>`).join('')}</div></div>
    </div>
    <div class="sheet-actions">
      <button type="button" class="btn btn-secondary" data-act="close-sheet">${esc(t(state.lang, 'back'))}</button>
      <button type="button" class="btn btn-primary" data-act="save-note">${esc(t(state.lang, 'saveNote'))}</button>
    </div>
  </div>`;
}
function noteChipOptions() {
  const byLang = {
    vi: ['Ít cay', 'Không hành', 'Mang ra trước', 'Nóng'],
    en: ['Less spicy', 'No onion', 'Serve first', 'Hot'],
    zh: ['少辣', '不要葱', '先上', '热的'],
    ja: ['辛さ控えめ', 'ネギ抜き', '先に提供', '熱いまま'],
    ko: ['덜 맵게', '파 빼고', '먼저 주세요', '뜨겁게'],
  };
  return byLang[state.lang] || byLang.vi;
}

function confirmTableSheetHtml() {
  const d = state.data;
  const rows = d.cart?.table || [];
  const total = d.cart?.table_total || 0;
  const mineQty = (d.cart?.mine || []).reduce((s, r) => s + r.qty, 0);
  const othersQty = rows.reduce((s, r) => s + r.qty, 0) - mineQty;
  return `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>
    <div class="sheet-center">
      <div class="sheet-icon" style="background:rgba(247,183,51,.18)">${icon('warn', 26, 'style="color:#9A6B00"')}</div>
      <div class="gate-title" style="font-size:17.5px">${esc(t(state.lang, 'confirmTitle'))}</div>
      <div class="gate-desc">${esc(t(state.lang, 'confirmBody', { table: `${t(state.lang, 'tableWord')} ${d.table?.code || ''}` }))}</div>
    </div>
    <div class="confirm-lines">
      <div class="confirm-line-row"><span class="lbl">${esc(t(state.lang, 'subtotal'))}</span><span class="val">${esc(money(total))}</span></div>
      <div class="confirm-line-row"><span class="lbl">${esc(t(state.lang, 'viewMine'))}</span><span class="val">${mineQty} ${esc(t(state.lang, 'items'))}</span></div>
      <div class="confirm-line-row"><span class="lbl">${esc(t(state.lang, 'viewMembers'))}</span><span class="val">${Math.max(0, othersQty)} ${esc(t(state.lang, 'items'))}</span></div>
    </div>
    <div class="sheet-actions">
      <button type="button" class="btn btn-secondary" data-act="close-sheet">${esc(t(state.lang, 'backCheck'))}</button>
      <button type="button" class="btn btn-primary" data-act="confirm-send-table" ${state.busySubmit ? 'disabled' : ''}>${esc(t(state.lang, 'confirmSend'))}</button>
    </div>
  </div>`;
}

function confirmStaffCallSheetHtml() {
  return `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>
    <div class="sheet-center">
      <div class="sheet-icon" style="background:rgba(26,34,48,.08)">${icon('bell', 26, 'style="color:#1A2230"')}</div>
      <div class="gate-title" style="font-size:17.5px">${esc(t(state.lang, 'callStaffConfirmTitle'))}</div>
      <div class="gate-desc">${esc(t(state.lang, 'callStaffConfirmBody'))}</div>
    </div>
    <div class="sheet-actions">
      <button type="button" class="btn btn-secondary" data-act="close-sheet">${esc(t(state.lang, 'cancel'))}</button>
      <button type="button" class="btn btn-primary" data-act="confirm-call-staff">${esc(t(state.lang, 'callStaff'))}</button>
    </div>
  </div>`;
}

function successSheetHtml() {
  return `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>
    <div class="sheet-center">
      <div class="sheet-icon" style="background:rgba(22,163,74,.12)">${icon('check', 28, 'style="color:#16A34A"')}</div>
      <div class="gate-title" style="font-size:18px">${esc(t(state.lang, 'successTitle'))}</div>
      <div class="gate-desc">${esc(t(state.lang, 'successBody'))}</div>
    </div>
    <div class="sheet-body" style="padding-top:16px">
      <button type="button" class="btn btn-dark" style="width:100%;height:52px" data-act="goto-ordered">${esc(t(state.lang, 'viewOrdered'))}</button>
    </div>
  </div>`;
}

function searchResultsHtml() {
  const d = state.data;
  const q = state.search.trim().toLocaleLowerCase();
  if (!q) return `<div class="search-empty">${esc(t(state.lang, 'searchHint'))}</div>`;
  const results = (d.menu || []).filter(it => `${it.name} ${it.description || ''}`.toLocaleLowerCase().includes(q));
  if (!results.length) return `<div class="search-empty">${esc(t(state.lang, 'searchEmpty'))}</div>`;
  return `<div class="search-section-title">${esc(t(state.lang, 'searchResult'))}</div>
    <div class="search-results">${results.map(it => `<button type="button" class="search-row" data-act="open-item-from-search" data-id="${attr(it.id)}">
      <div class="search-thumb">${it.image ? `<img src="${attr(it.image)}" alt="">` : icon('dish', 20, 'style="color:#C9BFAF"')}</div>
      <div style="flex:1;min-width:0"><div class="name">${esc(it.name)}</div>${it.description ? `<div class="sub">${esc(it.description)}</div>` : ''}</div>
      <span class="price">${esc(money(it.price))}</span>
    </button>`).join('')}</div>`;
}

// The search input is created ONCE per open — re-rendering it on every
// keystroke (as a naive innerHTML replace would) destroys focus/cursor
// position after the first character. Only `.search-results-scroll` is
// refreshed while typing; the shell (and the input node itself) is rebuilt
// only on open/close/background-refresh-while-closed.
function renderSearchSheet() {
  let host = document.getElementById('search-host');
  if (!state.searchOpen) { if (host) host.remove(); return; }
  if (host) { updateSearchResults(); return; }
  host = document.createElement('div');
  host.id = 'search-host';
  document.body.appendChild(host);
  host.innerHTML = `<div id="search-sheet" role="dialog" aria-modal="true">
    <div class="search-head">
      <div class="search-input-wrap">${icon('search', 18, 'style="color:#D81F26;flex:none"')}<input id="search-input" type="text" value="${attr(state.search)}" placeholder="${attr(t(state.lang, 'searchPlaceholder'))}" autocomplete="off"></div>
      <button type="button" class="search-cancel" data-act="close-search">${esc(t(state.lang, 'back'))}</button>
    </div>
    <div class="search-scroll" id="search-results-scroll"></div>
  </div>`;
  const input = document.getElementById('search-input');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  updateSearchResults();
}
function updateSearchResults() {
  const scroll = document.getElementById('search-results-scroll');
  if (scroll) scroll.innerHTML = searchResultsHtml();
}

// ---------------------------------------------------------------------------
// Mutations
async function addItemToCart() {
  const item = menuById(state.detailId);
  const d = state.detail;
  if (!item || !detailValid(item, d) || state.busyAdd) return;
  const mods = [];
  (item.option_groups || []).forEach((g, i) => {
    if (g.mode === 'combo') return;
    const sel = d.selections.get(detailGroupKey(i));
    if (sel) sel.forEach(name => mods.push({ group: g.name, name }));
  });
  d.addonSelections.forEach(name => mods.push({ group: '__addon__', name }));
  const combo = [];
  (item.option_groups || []).forEach((g, i) => {
    if (g.mode !== 'combo') return;
    const sel = d.comboSelections.get(detailGroupKey(i));
    if (sel) sel.forEach((note, ref) => combo.push({ ref_item_id: ref, note: note || '' }));
  });
  state.busyAdd = true; render();
  try {
    const cart = await api('/cart', { method: 'POST', body: JSON.stringify({ menu_item_id: item.id, qty: d.qty, note: d.itemNote, mods, combo }) });
    state.data.cart = cart;
    state.busyAdd = false;
    saveDraft();
    navigate('menu');
    showToast(t(state.lang, 'addedToCart'));
  } catch (e) {
    state.busyAdd = false;
    showToast(errorMessage(e.code, e.message, state.lang), 'error');
    render();
    if (e.code === 'BYOD_ITEM_UNAVAILABLE' || e.code === 'BYOD_OPTION_INVALID' || e.code === 'BYOD_OPTION_COUNT') await bootstrap(true);
  }
}

async function mutateCartQty(id, delta) {
  const rows = state.data.cart?.mine || [];
  const row = rows.find(r => r.id === id);
  if (!row) return;
  const nextQty = row.qty + delta;
  try {
    const cart = nextQty < 1
      ? await api(`/cart/${encodeURIComponent(id)}`, { method: 'DELETE' })
      : await api(`/cart/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ qty: clampQty(nextQty) }) });
    state.data.cart = cart;
    saveDraft();
    render();
  } catch (e) {
    showToast(errorMessage(e.code, e.message, state.lang), 'error');
    await bootstrap(true);
  }
}

async function removeCartRow(id) {
  try {
    const cart = await api(`/cart/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.data.cart = cart;
    saveDraft();
    render();
  } catch (e) {
    showToast(errorMessage(e.code, e.message, state.lang), 'error');
    await bootstrap(true);
  }
}

async function saveCartRowNote(id, note) {
  try {
    const cart = await api(`/cart/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ note }) });
    state.data.cart = cart;
    saveDraft();
  } catch (e) {
    showToast(errorMessage(e.code, e.message, state.lang), 'error');
    await bootstrap(true);
  }
}

async function doSubmit(scope) {
  if (state.busySubmit) return;
  state.busySubmit = true; render();
  const key = crypto.randomUUID();
  try {
    const res = await api('/submit', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ scope, confirm_table_cart: scope === 'table' }),
    });
    state.busySubmit = false;
    state.sheet = null;
    await bootstrap(true);
    if (res.skipped_items?.length) {
      showToast(`${t(state.lang, 'someItemsSkipped')} ${res.skipped_items.map(s => s.reason).join('; ')}`, 'warn');
    } else if (scope === 'table') {
      state.sheet = 'success';
    } else {
      state.cartTab = 'ordered';
      showToast(t(state.lang, 'successTitle'));
    }
    render();
  } catch (e) {
    state.busySubmit = false;
    showToast(e.code === 'BYOD_ITEM_UNAVAILABLE' || e.code === 'BYOD_OPTION_INVALID'
      ? `${errorMessage(e.code, e.message, state.lang)} ${t(state.lang, 'submitFailedKeep')}`
      : errorMessage(e.code, e.message, state.lang), 'error');
    render();
    await bootstrap(true);
  }
}

// Fire-and-forget, no confirmation sheet — matches the Tablet Self Order
// "Gọi nhân viên" button exactly (self_order_menu_screen.dart: immediate POST
// + one toast, no dialog). Same server call, same staff:call/table:updated
// events, same F&B POS ring — BYOD is just another caller of it.
async function doCallStaff() {
  if (state.busyStaffCall || Date.now() < state.staffCallCooldownUntil) return;
  state.busyStaffCall = true; renderStaffCallButton();
  try {
    const res = await api('/call-staff', { method: 'POST', body: '{}' });
    state.staffCallCooldownUntil = Date.now() + 90_000;
    showToast(res.already ? t(state.lang, 'callStaffAlready') : `${t(state.lang, 'callStaffSent')} ${state.data.table?.code || ''}`);
  } catch (e) {
    showToast(errorMessage(e.code, e.message, state.lang), 'error');
  } finally {
    state.busyStaffCall = false;
    renderStaffCallButton();
  }
}

async function doRequestPayment() {
  if (state.busyPay) return;
  state.busyPay = true; render();
  try {
    const pr = await api('/request-payment', { method: 'POST', body: '{}' });
    state.data.payment_request = pr;
    state.busyPay = false;
    showToast(t(state.lang, 'paySent'));
    render();
  } catch (e) {
    state.busyPay = false;
    showToast(errorMessage(e.code, e.message, state.lang), 'error');
    render();
  }
}

// ---------------------------------------------------------------------------
// Event delegation
document.addEventListener('click', (e) => {
  const t0 = e.target.closest('[data-act]');
  if (!t0) return;
  const act = t0.dataset.act;
  switch (act) {
    case 'gate-retry': state.gate = null; render(); bootstrap(); break;
    case 'gate-reload': location.reload(); break;
    case 'open-scan': openScanner(); break;
    case 'scan-close': closeScanner(); break;
    case 'scan-retry': openScanner(); break;
    case 'go-menu': navigate('menu'); $('#screens').scrollTo({ top: 0 }); break;
    // "Back" thật sự (menu→welcome, chi tiết→menu) dùng history.back() thay vì
    // push thêm — giữ lịch sử ĐÚNG ngăn xếp để vuốt-back/nút back hệ thống và
    // nút back riêng của ta luôn khớp nhau (xem navigate() phía trên).
    case 'go-welcome': case 'nav-back': history.back(); break;
    case 'go-cart': navigate('cart', { cartTab: 'cart' }); break;
    case 'open-lang': state.sheet = 'language'; render(); break;
    case 'close-sheet': state.sheet = null; render(); break;
    case 'pick-lang': changeLang(t0.dataset.lang); break;
    case 'pick-cat': state.category = t0.dataset.cat; render(); break;
    case 'open-item': openItem(t0.dataset.id); break;
    case 'open-item-from-search': state.searchOpen = false; openItem(t0.dataset.id); break;
    case 'open-search': state.searchOpen = true; render(); break;
    case 'close-search': state.searchOpen = false; render(); break;
    case 'detail-qty': {
      const delta = Number(t0.dataset.delta) || 0;
      state.detail.qty = clampQty(state.detail.qty + delta);
      renderDetail();
      break;
    }
    case 'pick-opt': pickOption(t0); break;
    case 'pick-addon': {
      const name = t0.dataset.val;
      if (state.detail.addonSelections.has(name)) state.detail.addonSelections.delete(name);
      else state.detail.addonSelections.add(name);
      renderDetail();
      break;
    }
    case 'open-item-note': state.sheet = 'note'; state.noteTarget = { kind: 'item' }; state.noteDraft = state.detail.itemNote; render(); break;
    case 'open-combo-note': {
      const gi = t0.dataset.gi, ref = t0.dataset.ref;
      const sel = state.detail.comboSelections.get(detailGroupKey(gi));
      const item = menuById(state.detailId);
      const resolved = item ? comboOptionLabel(item, ref) : null;
      state.sheet = 'note'; state.noteTarget = { kind: 'combo', gi, ref, label: resolved?.name || '' };
      state.noteDraft = sel ? (sel.get(ref) || '') : '';
      render();
      break;
    }
    case 'open-cart-note': {
      const id = t0.dataset.id;
      const row = (state.data.cart?.mine || []).find(r => r.id === id);
      state.sheet = 'note'; state.noteTarget = { kind: 'cartRow', id }; state.noteDraft = row?.note || '';
      render();
      break;
    }
    case 'note-chip': {
      const ta = $('#note-textarea');
      const cur = ta ? ta.value : state.noteDraft;
      state.noteDraft = cur ? `${cur}, ${t0.dataset.val}` : t0.dataset.val;
      renderSheet();
      break;
    }
    case 'save-note': saveNoteFromSheet(); break;
    case 'add-to-cart': addItemToCart(); break;
    case 'cart-tab': state.cartTab = t0.dataset.tab; render(); break;
    case 'cart-scope': state.cartScope = t0.dataset.scope; render(); break;
    case 'cart-qty': mutateCartQty(t0.dataset.id, Number(t0.dataset.delta) || 0); break;
    case 'cart-remove': removeCartRow(t0.dataset.id); break;
    case 'submit-scope': {
      const scope = t0.dataset.scope;
      if (scope === 'table') { state.sheet = 'confirmTable'; render(); }
      else doSubmit('mine');
      break;
    }
    case 'confirm-send-table': doSubmit('table'); break;
    case 'goto-ordered': navigate('cart', { cartTab: 'ordered' }); break;
    case 'request-payment': doRequestPayment(); break;
    case 'call-staff': state.sheet = 'confirmStaffCall'; render(); break;
    case 'confirm-call-staff': state.sheet = null; doCallStaff(); break;
    default: break;
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'search-input') { state.search = e.target.value; updateSearchResults(); }
  else if (e.target.id === 'note-textarea') { state.noteDraft = e.target.value; }
});

function pickOption(t0) {
  const gi = Number(t0.dataset.gi);
  const isCombo = t0.dataset.combo === '1';
  const val = t0.dataset.val;
  const item = menuById(state.detailId);
  const g = item.option_groups[gi];
  const key = detailGroupKey(gi);
  const max = Math.max(0, Number(g.max) || 0);
  const opt = (g.options || []).find(o => (isCombo ? o.ref_item_id : o.name) === val);
  if (opt && opt.available === false) { showToast(`${t(state.lang, 'soldOut')} · ${opt.name}`, 'warn'); return; }
  if (isCombo) {
    let sel = state.detail.comboSelections.get(key);
    if (!sel) { sel = new Map(); state.detail.comboSelections.set(key, sel); }
    if (sel.has(val)) sel.delete(val);
    else {
      if (max === 1) sel.clear();
      else if (max && sel.size >= max) return;
      sel.set(val, '');
    }
  } else {
    let sel = state.detail.selections.get(key);
    if (!sel) { sel = new Set(); state.detail.selections.set(key, sel); }
    if (sel.has(val)) sel.delete(val);
    else {
      if (max === 1) sel.clear();
      else if (max && sel.size >= max) return;
      sel.add(val);
    }
  }
  renderDetail();
}

function saveNoteFromSheet() {
  const nt = state.noteTarget || {};
  const value = String(state.noteDraft || '').slice(0, 200);
  if (nt.kind === 'combo') {
    const sel = state.detail.comboSelections.get(detailGroupKey(nt.gi));
    if (sel && sel.has(nt.ref)) sel.set(nt.ref, value);
    state.sheet = null;
    render();
  } else if (nt.kind === 'cartRow') {
    state.sheet = null;
    render();
    saveCartRowNote(nt.id, value).then(() => render());
  } else {
    state.detail.itemNote = value;
    state.sheet = null;
    render();
  }
}

async function changeLang(lang) {
  state.lang = normalizeLang(lang);
  localStorage.setItem(LANG_KEY_NAME, state.lang);
  state.sheet = null;
  document.documentElement.lang = state.lang;
  render();
  await bootstrap(true);
}

// ---------------------------------------------------------------------------
document.documentElement.lang = state.lang;
// Never leave the table credential in browser history. It remains only in this
// page's memory; reload/history restore starts from the scanner root again.
if (token) {
  history.replaceState({ screen: 'welcome' }, '', '/BYOD');
  bootstrap();
} else {
  history.replaceState({ screen: 'scan' }, '', '/BYOD');
  openScanner();
}

addEventListener('pageshow', (event) => {
  if (event.persisted && token) location.replace('/BYOD');
});
