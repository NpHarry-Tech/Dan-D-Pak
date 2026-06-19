// Shared frontend runtime: REST helper, realtime socket, formatting, toast, clock.
import { MODULES, TOPBAR_MODULES, MODULE_GROUPS } from './modules.js';
import { getLang, setLocalLang, t, translateText, TRANSLATIONS, applyDOMTranslations, watchAndTranslate, initI18n } from './i18n.js';
import { apiRequest, apiUrl as buildApiUrl } from '/js/core/apiClient.js';
import { connectRealtime } from '/js/core/realtimeClient.js';

export const DEFAULT_BRANCH = 'br1';
export const BRANCH = DEFAULT_BRANCH;
export const apiUrl = buildApiUrl;
const BRANCH_KEY = 'active_branch_id';
const BRANCH_CACHE_KEY = 'branches_cache';

export function getBranchId() {
  return localStorage.getItem(BRANCH_KEY) || DEFAULT_BRANCH;
}

export function getBranches() {
  try { return JSON.parse(localStorage.getItem(BRANCH_CACHE_KEY) || '[]'); } catch { return []; }
}

export function selectedBranch() {
  const id = getBranchId();
  return branchesForCurrentUser().find(b => b.id === id) || getBranches().find(b => b.id === id) || { id, name: id === DEFAULT_BRANCH ? 'Dan D Pak Sala' : id, code: id };
}

function branchesForCurrentUser() {
  const branches = getBranches();
  const user = getUser();
  if (!user) return branches;
  if ((user.branch_access || []).includes('*')) return branches;
  const allowed = new Set(Array.isArray(user.branch_ids) ? user.branch_ids : [user.branch_id || DEFAULT_BRANCH]);
  return branches.filter(b => allowed.has(b.id));
}

export function setBranchId(id, { reload = false } = {}) {
  const clean = String(id || DEFAULT_BRANCH).trim() || DEFAULT_BRANCH;
  localStorage.setItem(BRANCH_KEY, clean);
  if (reload) location.reload();
  return clean;
}

export async function syncBranches() {
  const rows = await apiRequest('/branches', {
    token: getToken() || '',
    headers: { 'x-branch-id': getBranchId() },
    cache: 'no-store',
  });
  const branches = Array.isArray(rows) ? rows : [];
  localStorage.setItem(BRANCH_CACHE_KEY, JSON.stringify(branches));
  if (!branches.some(b => b.id === getBranchId())) setBranchId(branches[0]?.id || DEFAULT_BRANCH);
  return branches;
}

export { getLang, t, translateText, TRANSLATIONS, applyDOMTranslations, watchAndTranslate };
export const setLang = async (l) => {
  const lang = setLocalLang(l);
  const user = getUser();
  const token = getToken();
  if (user?.id && token && !token.startsWith('demo_')) {
    try {
      const updated = await api('/me/lang', { method: 'POST', body: { lang } });
      localStorage.setItem('auth_user', JSON.stringify({ ...user, ...updated, lang }));
    } catch (e) {
      console.warn('[client] could not persist language preference:', e.message);
    }
  }
  location.reload();
};

export async function api(path, opts = {}) {
  try {
    return await apiRequest(path, {
      ...opts,
      token: getToken() || '',
      headers: { ...(opts.headers || {}), 'x-branch-id': getBranchId() },
    });
  } catch (e) {
    const demo = demoApiFallback(path);
    if (demo !== undefined) return demo;
    throw e;
  }
}

// ---- Auth ----
export const getToken = () => localStorage.getItem('auth_token');
export const getUser = () => { try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); } catch { return null; } };
export const getPerms = () => { try { return JSON.parse(localStorage.getItem('auth_perms') || '[]'); } catch { return []; } };
export const hasPerm = (p) => { const ps = getPerms(); return ps.includes('*') || ps.includes(p) || getUser()?.role === 'owner'; };
function ensureBranchForUser(user) {
  const allowed = Array.isArray(user?.branch_ids) ? user.branch_ids : [];
  if (allowed.length && !allowed.includes(getBranchId())) setBranchId(user.branch_id || allowed[0] || DEFAULT_BRANCH);
}
export const canOpenModule = (keyOrModule) => {
  const m = typeof keyOrModule === 'string' ? MODULES.find(x => x.key === keyOrModule) : keyOrModule;
  if (!m || m.status !== 'active') return false;
  if (m.key === 'settings') return hasPerm('settings.manage') || getPerms().some(p => p.startsWith('settings.') || p === 'warehouse.manage');
  if (m.key === 'reports') return hasPerm('reports') || hasPerm(m.perm) || getPerms().some(p => p.startsWith('report.'));
  return !m.perm || hasPerm(m.perm);
};
export async function requireModuleAccess(moduleKey) {
  await requireLogin();
  const m = MODULES.find(x => x.key === moduleKey);
  if (!m || canOpenModule(m)) return true;
  document.body.innerHTML = `<div class="view"><div class="panel" style="max-width:520px;margin:60px auto;text-align:center">
    <h3>Không có quyền truy cập</h3>
    <div class="empty">Tài khoản này chưa được cấp quyền mở module ${esc(m?.label || moduleKey)}.</div>
    <a class="btn primary" href="/" style="display:inline-flex;margin-top:12px">Về màn hình ứng dụng</a>
  </div></div>`;
  throw new Error('No module access: ' + moduleKey);
}
export async function logout() {
  try { await api('/logout', { method: 'POST' }); } catch {}
  localStorage.removeItem('auth_token'); localStorage.removeItem('auth_user'); localStorage.removeItem('auth_perms'); location.reload();
}

const ROLE_LABEL = getLang() === 'en' ?
  { owner: 'Owner', manager: 'Manager', cashier: 'Cashier', kitchen: 'Kitchen', warehouse: 'Warehouse Keeper' } :
  { owner: 'Chủ quán', manager: 'Quản lý', cashier: 'Thu ngân', kitchen: 'Bếp', warehouse: 'Thủ kho' };
const DEMO_LOGIN_USERS = [
  { id:'demo_owner', username:'owner', name:'Chủ quán', role:'owner', pin:'1234' },
  { id:'demo_manager', username:'manager', name:'Quản lý', role:'manager', pin:'2222' },
  { id:'demo_cashier', username:'cashier', name:'Thu ngân', role:'cashier', pin:'1111' },
  { id:'demo_kitchen', username:'kitchen', name:'Bếp', role:'kitchen', pin:'3333' },
  { id:'demo_warehouse', username:'warehouse', name:'Thủ kho', role:'warehouse', pin:'4444' },
];
const DEMO_PERMS = {
  owner: ['*'],
  manager: ['menu.manage','inventory.adjust','warehouse.manage','refund','void','discount','reports','invoice','online','sell','pay','audit.view','settings.manage','module.ipad','module.pos','module.retail','module.kds','module.online','module.warehouse','module.inventory','module.printing','module.crm','module.sales','module.purchase','module.accounting','module.invoice','module.expense','module.website','module.payment','module.contacts','module.reports','module.import_export','module.calendar','module.discuss','module.documents','module.knowledge','module.project'],
  cashier: ['sell','pay','discount','invoice','module.pos','module.retail','module.invoice'],
  kitchen: ['module.kds'],
  warehouse: ['inventory.adjust','warehouse.manage','module.warehouse','module.inventory'],
};
const isDemoToken = () => (getToken() || '').startsWith('demo_');
function demoLogin(username, pin) {
  const u = DEMO_LOGIN_USERS.find(x => x.username === String(username || '').toLowerCase());
  if (!u || u.pin !== String(pin)) throw new Error('Sai tài khoản hoặc mã PIN');
  const user = { id:u.id, username:u.username, name:u.name, role:u.role };
  return { token:'demo_' + u.username + '_' + Date.now(), user, perms:DEMO_PERMS[u.role] || [] };
}
function demoApiFallback(path) {
  if (path === '/me' && isDemoToken()) {
    const user = getUser();
    return user ? { ...user, perms:DEMO_PERMS[user.role] || [] } : undefined;
  }
  if (path === '/modules' && isDemoToken()) {
    return { groups: MODULE_GROUPS, modules: MODULES.filter(m => canOpenModule(m)) };
  }
  return undefined;
}

export function requestPinCode(opts = {}) {
  const {
    title = 'Nhập mã PIN',
    subtitle = '',
    roleLabel = '',
    length = 4,
    cancelText = 'Hủy',
    onSubmit = null,
    errorText = 'Mã PIN không đúng',
  } = opts;
  injectPinCodeCss();
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'overlay show pin-code-overlay';
    ov.innerHTML = `<div class="pin-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <button class="pin-cancel" type="button" id="pinCancel">${esc(cancelText)}</button>
      <div class="pin-title">${esc(title)}</div>
      ${subtitle ? `<div class="pin-sub">${esc(subtitle)}</div>` : ''}
      ${roleLabel ? `<div class="pin-role">${esc(roleLabel)}</div>` : ''}
      <div class="pin-dots" id="pinDots">${Array.from({ length }, () => '<i></i>').join('')}</div>
      <div class="pin-error" id="pinError" aria-live="polite"></div>
      <div class="pin-pad">
        ${[1,2,3,4,5,6,7,8,9,'blank',0,'back'].map(k => {
          if (k === 'blank') return '<span></span>';
          if (k === 'back') return '<button class="pin-key pin-back" type="button" data-pin-key="back" aria-label="Xóa">⌫</button>';
          return `<button class="pin-key" type="button" data-pin-key="${k}">${k}</button>`;
        }).join('')}
      </div>
    </div>`;
    document.body.appendChild(ov);
    const card = ov.querySelector('.pin-card');
    const dots = ov.querySelector('#pinDots');
    const err = ov.querySelector('#pinError');
    let pin = '';
    let busy = false;
    const cleanup = () => {
      document.removeEventListener('keydown', onKey, true);
      ov.remove();
    };
    const draw = () => {
      dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < pin.length));
    };
    const fail = (message) => {
      err.textContent = message || errorText;
      pin = '';
      draw();
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      busy = false;
    };
    const submit = async () => {
      if (busy || pin.length !== length) return;
      busy = true;
      err.textContent = '';
      try {
        const result = onSubmit ? await onSubmit(pin) : pin;
        cleanup();
        resolve(result ?? pin);
      } catch (e) {
        fail(e?.message || errorText);
      }
    };
    const press = (key) => {
      if (busy) return;
      err.textContent = '';
      if (key === 'back') { pin = pin.slice(0, -1); draw(); return; }
      if (!/^\d$/.test(String(key)) || pin.length >= length) return;
      pin += String(key);
      draw();
      if (pin.length === length) setTimeout(submit, 90);
    };
    const cancel = () => { cleanup(); resolve(null); };
    function onKey(e) {
      if (!ov.isConnected) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); press('back'); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); submit(); }
    }
    ov.querySelector('#pinCancel').onclick = cancel;
    ov.querySelectorAll('[data-pin-key]').forEach(b => b.onclick = () => press(b.dataset.pinKey));
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => ov.querySelector('[data-pin-key="1"]')?.focus(), 30);
  });
}

function injectPinCodeCss() {
  if (document.getElementById('pinCodeCss')) return;
  const s = document.createElement('style');
  s.id = 'pinCodeCss';
  s.textContent = `
  .pin-code-overlay{z-index:620;background:rgba(10,18,28,.58);backdrop-filter:blur(7px)}
  .pin-card{position:relative;width:min(360px,calc(100vw - 32px));border-radius:28px;background:rgba(255,255,255,.96);border:1px solid rgba(148,163,184,.35);box-shadow:0 28px 90px rgba(15,23,42,.28);padding:22px 20px 20px;color:#0f172a;text-align:center}
  .pin-cancel{position:absolute;top:14px;left:15px;background:transparent;border:0;color:#0ea5c2;font-size:13px;font-weight:750;padding:7px 8px;border-radius:10px}
  .pin-cancel:hover{background:rgba(14,165,194,.08)}
  .pin-title{font-size:17px;font-weight:850;line-height:1.25;margin:14px 36px 4px}
  .pin-sub{font-size:12px;color:#64748b;font-weight:650;line-height:1.45;margin:0 auto;max-width:270px}
  .pin-role{display:inline-flex;margin-top:8px;border-radius:999px;background:#eef6fa;color:#0a8aa6;padding:5px 10px;font-size:10.5px;font-weight:850;text-transform:uppercase;letter-spacing:.35px}
  .pin-dots{display:flex;align-items:center;justify-content:center;gap:14px;height:24px;margin:18px 0 8px}
  .pin-dots i{width:13px;height:13px;border-radius:999px;border:1.8px solid #94a3b8;background:transparent;transition:.12s}
  .pin-dots i.on{background:#0ea5c2;border-color:#0ea5c2;box-shadow:0 0 0 5px rgba(14,165,194,.10)}
  .pin-error{min-height:17px;font-size:11px;font-weight:750;color:#ef4444;margin-bottom:6px}
  .pin-pad{display:grid;grid-template-columns:repeat(3,74px);justify-content:center;gap:10px 14px;margin-top:4px}
  .pin-key{width:74px;height:58px;border-radius:999px;border:1px solid rgba(148,163,184,.28);background:#f8fafc;color:#0f172a;font-family:var(--mono,monospace);font-size:24px;font-weight:800;box-shadow:0 1px 0 rgba(15,23,42,.05);transition:.1s}
  .pin-key:hover,.pin-key:focus-visible{border-color:#0ea5c2;background:#eefbff;outline:none}
  .pin-key:active{transform:scale(.96);background:#dff6fd}
  .pin-back{font-size:21px;color:#475569;background:transparent;border-color:transparent;box-shadow:none}
  .pin-card.shake{animation:pinShake .36s}
  @keyframes pinShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(5px)}}
  @media(max-width:420px){.pin-card{border-radius:26px;padding:20px 14px}.pin-pad{grid-template-columns:repeat(3,68px);gap:9px 12px}.pin-key{width:68px;height:54px}}`;
  document.head.appendChild(s);
}

// Block the page with a PIN login until a valid session exists. Returns the user.
export async function requireLogin(opts = {}) {
  const { branchLocked = false } = opts;
  try { await syncBranches(); } catch {}
  if (getToken()) {
    if (isDemoToken()) {
      const user = getUser();
      if (user) {
        localStorage.setItem('auth_perms', JSON.stringify(DEMO_PERMS[user.role] || []));
        const userLang = user.lang || 'vi';
        const currentPreferred = localStorage.getItem('preferred_lang') || 'vi';
        localStorage.setItem('preferred_lang', userLang);
        if (userLang !== currentPreferred) {
          location.reload();
        }
        return user;
      }
    }
    try {
      const me = await api('/me');
      ensureBranchForUser(me);
      localStorage.setItem('auth_user', JSON.stringify(me));
      localStorage.setItem('auth_perms', JSON.stringify(me.perms || []));
      const userLang = me.lang || 'vi';
      const currentPreferred = localStorage.getItem('preferred_lang') || 'vi';
      localStorage.setItem('preferred_lang', userLang);
      if (userLang !== currentPreferred) {
        location.reload();
      }
      return me;
    }
    catch { localStorage.removeItem('auth_token'); localStorage.removeItem('auth_user'); }
  }
  return new Promise(async (resolve) => {
    let demoMode = false;
    let branches = getBranches();
    try { branches = await syncBranches(); } catch {}
    const loadLoginUsers = async () => {
      try {
        const rows = await api('/users');
        const list = Array.isArray(rows) ? rows : [];
        if (list.length) { demoMode = false; return list; }
      } catch {}
      demoMode = true;
      return DEMO_LOGIN_USERS;
    };
    let users = await loadLoginUsers();
    const ov = document.createElement('div');
    ov.id = 'loginGate';
    const activeBranch = selectedBranch();
    const activeBranchName = activeBranch.name || activeBranch.code || activeBranch.id || 'Dan D Pak Sala';
    const branchOptions = branches.length
      ? branches.map(b => `<option value="${esc(b.id)}" ${b.id === getBranchId() ? 'selected' : ''}>${esc(b.name || b.code || b.id)}</option>`).join('')
      : `<option value="${DEFAULT_BRANCH}">Dan D Pak Sala</option>`;
    const branchBlock = branchLocked
      ? `<div class="lg-branch lg-branch-locked"><span>Chi nhánh đăng nhập</span><b>${esc(activeBranchName)}</b><small>Đổi chi nhánh ở màn hình chọn module trước khi đăng nhập.</small></div>`
      : `<label class="lg-branch"><span>Cửa hàng / chi nhánh</span><select id="loginBranch">${branchOptions}</select></label>`;
    const usersHtml = () => users.map(u => `<button class="lg-user" data-u="${esc(u.username)}"><span class="lg-av">${esc((u.name||'?')[0])}</span><span><b>${esc(u.name)}</b><small>${esc(ROLE_LABEL[u.role] || u.role)}</small></span></button>`).join('');
    ov.innerHTML = `
      <div class="lg-card">
        <div class="lg-logo"><img class="lg-brand-logo" src="/assets/DanOnLogo.png" alt="DanDPak"><div class="lg-sub">Đăng nhập nhân viên</div></div>
        ${branchBlock}
        <div class="lg-users">${usersHtml()}</div>
        <div class="lg-hint">PIN demo — Chủ quán:1234 · Quản lý:2222 · Thu ngân:1111 · Bếp:3333 · Kho:4444</div>
      </div>`;
    document.body.appendChild(ov);
    injectLoginCss();
    const usersBox = ov.querySelector('.lg-users');
    const branchSel = ov.querySelector('#loginBranch');
    if (branchSel) {
      branchSel.onchange = async () => {
        setBranchId(branchSel.value);
        usersBox.innerHTML = '<div class="lg-loading">Äang táº£i nhÃ¢n viÃªn...</div>';
        users = await loadLoginUsers();
        usersBox.innerHTML = usersHtml();
      };
    }
    ov.addEventListener('click', async (e) => {
      const b = e.target.closest?.('.lg-user');
      if (!b || !ov.contains(b)) return;
      const pickedUser = b.dataset.u;
      const name = b.querySelector('b')?.textContent || pickedUser;
      const role = b.querySelector('small')?.textContent || '';
      const r = await requestPinCode({
        title: 'Nhập mã PIN',
        subtitle: `Đăng nhập ${name}`,
        roleLabel: role,
        cancelText: 'Chọn lại',
        onSubmit: (pin) => demoMode ? demoLogin(pickedUser, pin) : api('/login', { method: 'POST', body: { username: pickedUser, pin, branch_id: getBranchId() } }),
      });
      if (!r) return;
      ensureBranchForUser(r.user);
      localStorage.setItem('auth_token', r.token); localStorage.setItem('auth_user', JSON.stringify(r.user));
      localStorage.setItem('auth_perms', JSON.stringify(r.perms || []));
      const userLang = r.user.lang || 'vi';
      const currentPreferred = localStorage.getItem('preferred_lang') || 'vi';
      localStorage.setItem('preferred_lang', userLang);
      ov.remove();
      if (userLang !== currentPreferred) {
        location.reload();
      } else {
        resolve(r.user);
      }
    });
  });
}

function injectLoginCss() {
  if (document.getElementById('lgCss')) return;
  const s = document.createElement('style'); s.id = 'lgCss';
  s.textContent = `
  #loginGate{position:fixed;inset:0;z-index:500;background:radial-gradient(circle at 50% 25%,#ffffff,#edf3f8);display:flex;align-items:center;justify-content:center;padding:20px}
  .lg-card{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:26px;width:100%;max-width:420px;box-shadow:0 24px 70px rgba(15,23,42,.16)}
  .lg-logo{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:7px;margin:0 auto 22px}
  .lg-brand-logo{width:min(218px,62vw);height:88px;object-fit:contain;display:block;filter:drop-shadow(0 8px 14px rgba(15,23,42,.08))}
  .lg-sub{font-size:13px;color:var(--muted);font-weight:700}
  .lg-branch{display:flex;flex-direction:column;gap:6px;margin:-6px 0 14px}
  .lg-branch span{font-size:10.5px;font-weight:850;text-transform:uppercase;color:var(--faint);letter-spacing:.45px}
  .lg-branch select{width:100%;height:42px;border-radius:12px;font-weight:800;background:#fff}
  .lg-branch-locked{border:1px solid var(--border2);background:var(--surface2);border-radius:14px;padding:10px 12px;margin:-6px 0 14px}
  .lg-branch-locked b{font-size:14px;color:var(--text);font-weight:850}
  .lg-branch-locked small{font-size:11px;color:var(--muted);font-weight:650;line-height:1.35}
  .lg-users{display:flex;flex-direction:column;gap:8px}
  .lg-user{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;background:var(--surface2);border:1px solid var(--border2);color:var(--text);text-align:left}
  .lg-user:hover{border-color:var(--brand)}
  .lg-av{width:34px;height:34px;border-radius:50%;background:var(--brand-dim);color:var(--brand);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px}
  .lg-user b{font-size:13.5px}.lg-user small{display:block;color:var(--muted);font-size:11px}
  .lg-loading{font-size:12px;color:var(--muted);font-weight:750;text-align:center;padding:16px 8px;background:var(--surface2);border:1px dashed var(--border2);border-radius:12px}
  .lg-hint{margin-top:18px;font-size:10.5px;color:var(--faint);text-align:center;line-height:1.5}`;
  document.head.appendChild(s);
}

// Socket.IO is served by the server at /socket.io/socket.io.js
export function connect(device, handlers = {}) {
  const s = connectRealtime(device, getBranchId(), handlers, setOnline);
  startPingMonitor();
  return s;
}

let _pingTimer = null;
function setOnline(ok, pingMs = null) {
  const slow = ok && pingMs !== null && pingMs > 500;
  document.querySelectorAll('.onlinedot').forEach(el => {
    el.classList.toggle('off', !ok);
    el.classList.toggle('slow', slow);
    const lbl = el.querySelector('span');
    if (lbl) {
      if (!ok) lbl.textContent = getLang() === 'en' ? 'Offline' : 'Mất kết nối';
      else lbl.textContent = pingMs === null ? 'Online' : `Online · ${pingMs}ms`;
    }
  });
}
function startPingMonitor() {
  if (_pingTimer) return;
  const run = async () => {
    const start = performance.now();
    try {
      await apiRequest('/ping?ts=' + Date.now(), { cache: 'no-store', token: getToken() || '', headers: { 'x-branch-id': getBranchId() } });
      setOnline(true, Math.max(1, Math.round(performance.now() - start)));
    } catch {
      setOnline(false);
    }
  };
  run();
  _pingTimer = setInterval(run, 5000);
}

export const money = (n) => getLang() === 'en'
  ? (n || 0).toLocaleString('en-US') + ' VND'
  : (n || 0).toLocaleString('vi-VN') + 'đ';
export const moneyShort = (n) => { n = n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : '' + n; };

export function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  const m = Math.floor(s / 60);
  return m < 1 ? s + 's' : m + ':' + String(s % 60).padStart(2, '0');
}

let _toastT;
export function toast(msg, isErr = false) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.toggle('err', isErr); t.classList.add('show');
  clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

export function startClock(sel = '#clock') {
  const el = document.querySelector(sel); if (!el) return;
  const tick = () => el.textContent = new Date().toLocaleTimeString(getLang() === 'en' ? 'en-US' : 'vi-VN');
  tick(); setInterval(tick, 1000);
}

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Turn a raw audit record (action + detail) into a plain Vietnamese sentence.
const _ROLE_VN = { owner: 'Chủ quán', manager: 'Quản lý', cashier: 'Thu ngân', kitchen: 'Bếp', warehouse: 'Thủ kho' };
const _CHAN_VN = { grabfood: 'GrabFood', shopeefood: 'ShopeeFood', website: 'Website' };
const _ST_VN = { received: 'đã nhận', confirmed: 'đã xác nhận', preparing: 'đang chế biến', ready: 'sẵn sàng', completed: 'hoàn tất', accepted: 'đã nhận', served: 'đã phục vụ', cancelled: 'đã hủy', new: 'mới' };
export function describeAudit(action, detailRaw) {
  let d = {};
  try { d = typeof detailRaw === 'string' ? JSON.parse(detailRaw) : (detailRaw || {}); } catch { d = {}; }
  const src = (d.source || '').replace(/^https?:\/\//, '').split('/')[0];
  const M = {
    'auth.login': () => 'Đăng nhập hệ thống',
    'menu.create': () => `Tạo món mới: ${d.name || ''}`,
    'menu.update': () => 'Cập nhật thông tin món',
    'menu.hide': () => `Ẩn món khỏi thực đơn${d.name ? ': ' + d.name : ''}`,
    'menu.unhide': () => `Hiện lại món${d.name ? ': ' + d.name : ''}`,
    'menu.archive': () => `Lưu trữ món${d.name ? ': ' + d.name : ''} (đã từng có đơn)`,
    'menu.delete': () => `Xóa món${d.name ? ': ' + d.name : ''}`,
    'category.create': () => `Tạo danh mục: ${d.name || ''}`,
    'category.update': () => 'Sửa danh mục',
    'category.delete': () => `Xóa danh mục${d.name ? ': ' + d.name : ''}`,
    'perms.update': () => `Cập nhật quyền của vai trò ${_ROLE_VN[d.role] || d.role} (${d.count} quyền)`,
    'user.perms.update': () => `Tùy chỉnh quyền riêng cho ${d.username || ''}`,
    'user.create': () => `Tạo người dùng ${d.username || ''} — vai trò ${_ROLE_VN[d.role] || d.role}`,
    'user.update': () => `Cập nhật người dùng ${d.username || ''}`,
    'user.delete': () => `Xóa người dùng ${d.username || ''}`,
    'payment.done': () => `Thanh toán đơn — ${money(d.total)}${d.lines ? ` · ${d.lines} phương thức` : ''}`,
    'order.send': () => `Gửi bếp ${d.items || ''} món`,
    'order.pending': () => `Khách vừa gửi ${d.items || ''} món, đang chờ nhân viên xác nhận`,
    'order.confirm': () => `Nhân viên đã xác nhận ${d.items || ''} món và chuyển xuống bếp/bar`,
    'order.reject': () => `Nhân viên đã từ chối ${d.items || ''} món${d.reason ? ': ' + d.reason : ''}`,
    'item.status': () => `Món chuyển trạng thái: ${_ST_VN[d.status] || d.status}`,
    'item.cancel': () => `Hủy một món${d.reason ? ': ' + d.reason : ''}`,
    'staff.call': () => `Khách gọi nhân viên${d.reason ? ': ' + d.reason : ''}`,
    'table.move': () => `Chuyển bill từ bàn ${d.from_code || d.from || ''} sang bàn ${d.to_code || d.to || ''}`,
    'table.merge': () => `Gộp bàn ${d.from_code || d.from || ''} vào bàn ${d.to_code || d.to || ''}`,
    'bill.split': () => `Tách ${d.items || 0} dòng sang bill thanh toán riêng${d.table_code ? ` tại bàn ${d.table_code}` : ''}`,
    'settings.update': () => Array.isArray(d.keys) && d.keys.includes('integrations_config') ? 'Cập nhật cấu hình kết nối dịch vụ' : (Array.isArray(d.keys) && d.keys.includes('operations_config') ? 'Cập nhật cấu hình thanh toán, QR và ca làm việc' : (Array.isArray(d.keys) && d.keys.includes('print_config') ? 'Cập nhật cấu hình hóa đơn, bill, tem nhãn và máy in' : (Array.isArray(d.keys) && d.keys.includes('ipad_staff_pin') ? 'Đổi mật khẩu mở chọn bàn trên iPad' : 'Cập nhật cài đặt hệ thống'))),
    'settings.drawer_cash.reauth': () => `Xác thực đổi tiền két gốc từ ${money(d.from || 0)} sang ${money(d.to || 0)}`,
    'shift.open': () => `Mở ${d.shift || 'ca làm việc'} với tiền đầu ca ${money(d.opening_cash || 0)}`,
    'shift.close': () => `Kết ${d.shift || 'ca làm việc'}: doanh thu ${money(d.revenue || 0)}, tiền mặt dự kiến ${money(d.expected_cash || 0)}`,
    'cash.expense': () => `Chi ${money(d.amount || 0)} từ két${d.product ? ` cho ${d.product}` : ''}${d.counterparty ? ` tại ${d.counterparty}` : ''}`,
    'cash.reimbursement': () => `Hoàn ${money(d.amount || 0)} vào két${d.counterparty ? ` từ ${d.counterparty}` : ''}`,
    'retail.refund': () => `Hoàn trả đơn bán lẻ — ${money(d.total)}${d.reason ? ` (${d.reason})` : ''}`,
    'online.receive': () => `Nhận đơn ${_CHAN_VN[d.channel] || d.channel} ${d.ref || ''} — ${money(d.total)}`,
    'online.status': () => `Đơn online chuyển sang: ${_ST_VN[d.status] || d.status}`,
    'invoice.issue': () => `Phát hành hóa đơn điện tử ${d.invoice_no || ''}`,
    'invoice.cancel': () => `Hủy hóa đơn ${d.invoice_no || ''}${d.reason ? ` (${d.reason})` : ''}`,
    'print.reprint': () => 'In lại phiếu',
    'warehouse.config.reauth': () => `Xác nhận PIN để ${d.action === 'create' ? 'tạo kho mới' : 'cấu hình kho'}`,
    'warehouse.create': () => `Tạo kho: ${d.name || ''}`,
    'warehouse.update': () => `Cập nhật kho: ${d.name || ''}`,
    'sku.create': () => 'Tạo sản phẩm bán lẻ',
    'sku.update': () => 'Cập nhật sản phẩm bán lẻ',
    'sku.delete': () => 'Xóa sản phẩm bán lẻ',
    'sku.receive': () => `Nhập kho bán lẻ +${d.qty || ''}${d.lot ? ` (lô ${d.lot})` : ''}`,
    'sku.issue': () => `Xuất kho bán lẻ ${d.qty || ''}`,
    'inventory.item.create': () => 'Tạo nguyên liệu / vật dụng kho',
    'inventory.item.update': () => 'Cập nhật mặt hàng kho',
    'inventory.item.delete': () => 'Xóa mặt hàng kho',
    'inventory.receive': () => `Nhập kho bếp +${d.qty || ''}${d.lot ? ` (lô ${d.lot})` : ''}`,
    'inventory.issue': () => `Xuất kho bếp ${d.qty || ''}`,
    'stock.transfer': () => `Chuyển kho ${d.qty || ''} mặt hàng${d.from ? ` từ ${d.from}` : ''}${d.to ? ` sang ${d.to}` : ''}`,
    'stocktake.approve': () => `Chốt kiểm kho — ${d.changed || 0} mặt hàng điều chỉnh`,
    'bcm.import': () => `Nhập dữ liệu BCM: ${d.skus || 0} sản phẩm${src ? ` từ ${src}` : ''}`,
  };
  return M[action] ? M[action]() : action.replace(/\./g, ' › ');
}

// Standard topbar (device nav) injected into every device page.
let _activeTopbar = null;
export function topbar(active) {
  _activeTopbar = active;
  const br = selectedBranch();
  const branchName = esc(br.name || br.code || br.id);
  const branchLabel = getLang() === 'en' ? `Branch: ${branchName} · Live` : `Chi nhánh: ${branchName} · Trực tiếp`;
  const homeTitle = getLang() === 'en' ? 'Back to Launcher' : 'Quay lại Launcher (chọn module khác)';
  // Module navigation lives on the Launcher (home). The topbar only carries
  // identity (logo + branch), live clock and the current user / logout.
  return `<header class="topbar">
    <div class="logo brand-mark" onclick="location.href = '/'" style="cursor:pointer" title="${homeTitle}"><img src="/assets/DanOnLogo.png" alt="DanDPak"><small>${branchLabel}</small></div>
    <div class="topright">
      <span class="clock" id="clock"></span>
      <span class="onlinedot"><i></i><span>Online</span></span>
      <span id="userchip"></span>
    </div>
  </header>`;
}

const ROLE_LABEL2 = getLang() === 'en' ?
  { owner: 'Owner', manager: 'Manager', cashier: 'Cashier', kitchen: 'Kitchen', warehouse: 'Warehouse Keeper' } :
  { owner: 'Chủ quán', manager: 'Quản lý', cashier: 'Thu ngân', kitchen: 'Bếp', warehouse: 'Thủ kho' };
export function renderUserChip() {
  if (_activeTopbar && document.getElementById('top')) {
    document.getElementById('top').innerHTML = topbar(_activeTopbar);
  }
  const el = document.getElementById('userchip'); const u = getUser(); if (!el || !u) return;
  el.innerHTML = `<span style="display:inline-flex;align-items:center;gap:7px;background:var(--surface2);border:1px solid var(--border2);border-radius:99px;padding:4px 6px 4px 11px;font-size:12px;font-weight:600">
    👤 ${u.name} <small style="color:var(--muted)">· ${ROLE_LABEL2[u.role] || u.role}</small>
    <button id="logoutBtn" style="background:var(--surface3);border-radius:99px;width:22px;height:22px;color:var(--muted)" title="${getLang() === 'en' ? 'Logout' : 'Đăng xuất'}">⏻</button></span>`;
  document.getElementById('logoutBtn').onclick = () => logout();
}

// Global click event: language switches
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'langViBtn') {
    setLang('vi');
  }
  if (e.target && e.target.id === 'langEnBtn') {
    setLang('en');
  }
});

function installUiHardening() {
  if (window.__danDpakUiHardening) return;
  window.__danDpakUiHardening = true;
  const editableSelector = 'input,textarea,select,[contenteditable="true"],.allow-select';
  const isEditable = (target) => !!target?.closest?.(editableSelector);
  const stop = (e) => {
    if (isEditable(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener('contextmenu', stop, true);
  document.addEventListener('selectstart', stop, true);
  document.addEventListener('dragstart', stop, true);
  document.addEventListener('copy', stop, true);
  document.addEventListener('cut', stop, true);
  document.addEventListener('keydown', (e) => {
    const key = String(e.key || '').toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const devCombo =
      e.key === 'F12' ||
      (ctrl && e.shiftKey && ['i', 'j', 'c', 'k'].includes(key)) ||
      (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(key)) ||
      (ctrl && ['u', 's'].includes(key));
    if (devCombo) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, true);
}

installUiHardening();
initI18n();
