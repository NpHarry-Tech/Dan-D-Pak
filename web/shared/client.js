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
  if (user?.id && token) {
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
  return apiRequest(path, {
    ...opts,
    token: getToken() || '',
    headers: { ...(opts.headers || {}), 'x-branch-id': getBranchId() },
  });
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
  { owner: 'Admin', manager: 'Manager', cashier: 'Cashier', kitchen: 'Kitchen', warehouse: 'Warehouse Keeper' } :
  { owner: 'Admin', manager: 'Quản lý', cashier: 'Thu ngân', kitchen: 'Bếp', warehouse: 'Thủ kho' };

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
  const { mode = 'gate' } = opts;
  try { await syncBranches(); } catch {}
  // Gate: đã có phiên hợp lệ thì vào thẳng, không hiện wizard.
  if (mode === 'gate' && getToken()) {
    try {
      const me = await api('/me');
      ensureBranchForUser(me);
      localStorage.setItem('auth_user', JSON.stringify(me));
      localStorage.setItem('auth_perms', JSON.stringify(me.perms || []));
      const userLang = me.lang || 'vi';
      const currentPreferred = localStorage.getItem('preferred_lang') || 'vi';
      localStorage.setItem('preferred_lang', userLang);
      if (userLang !== currentPreferred) location.reload();
      return me;
    }
    catch { localStorage.removeItem('auth_token'); localStorage.removeItem('auth_user'); }
  }
  return openLoginWizard({ mode });
}

// Mở wizard "Đổi chi nhánh" từ màn hình chọn module (đang đăng nhập).
// Đổi sang chi nhánh KHÁC cần PIN Quản lý/Admin; reload khi đổi xong.
export async function changeBranchFlow() {
  const result = await openLoginWizard({ mode: 'switch' });
  if (result) location.reload();
  return result;
}

// Wizard đăng nhập từng bước: Chi nhánh → Nhân viên → (PIN qua requestPinCode).
// mode 'gate'  : chặn trang tới khi đăng nhập (bước chi nhánh chỉ hiện khi >1 chi nhánh).
// mode 'switch': mở từ trạng thái đã đăng nhập để đổi chi nhánh (luôn bắt đầu ở bước chi nhánh,
//                cho phép Hủy; chọn chi nhánh khác cần PIN Quản lý).
function openLoginWizard({ mode = 'gate' } = {}) {
  injectLoginCss();
  return new Promise((resolve) => {
    (async () => {
      let branches = getBranches();
      try { branches = await syncBranches(); } catch {}
      if (!branches.length) branches = [{ id: getBranchId(), name: 'Dan D Pak', code: getBranchId() }];
      const originBranch = getBranchId();
      let selBranch = originBranch;
      let users = [];

      // Smart: gate hiện bước chi nhánh chỉ khi >1; switch luôn có bước chi nhánh.
      const hasBranchStep = mode === 'switch' ? branches.length >= 1 : branches.length > 1;
      const paneList = hasBranchStep ? ['branch', 'user'] : ['user'];
      let step = hasBranchStep ? 'branch' : 'user';

      const branchName = (id) => { const b = branches.find(x => x.id === id); return b ? (b.name || b.code || b.id) : id; };
      const loadUsers = async () => {
        try { const rows = await api('/users'); users = Array.isArray(rows) ? rows : []; }
        catch { users = []; }
      };
      await loadUsers();

      const branchRowsHtml = () => branches.map(b => {
        const id = b.id, isCur = id === originBranch, isSel = id === selBranch;
        return `<button type="button" class="lg-branch-row${isSel ? ' sel' : ''}" data-b="${esc(id)}">
          <span class="lg-branch-ic">${isCur ? '📍' : '🏬'}</span>
          <span class="lg-branch-meta"><b>${esc(b.name || b.code || id)}</b><small>${isCur ? 'Chi nhánh hiện tại' : esc(b.code || id)}</small></span>
          <span class="lg-branch-chev">${isSel ? '✓' : '›'}</span>
        </button>`;
      }).join('');
      const usersHtml = () => users.length
        ? users.map(u => `<button class="lg-user" data-u="${esc(u.username)}"><span class="lg-av">${esc((u.name || '?')[0])}</span><span><b>${esc(u.name)}</b><small>${esc(ROLE_LABEL[u.role] || u.role)}</small></span></button>`).join('')
        : `<div class="lg-loading">Chưa có tài khoản nhân viên ở chi nhánh này.</div>`;
      const userPaneHtml = () => `${hasBranchStep ? `<div class="lg-branch-chip"><span>Chi nhánh</span><b>${esc(branchName(selBranch))}</b></div>` : ''}<div class="lg-users">${usersHtml()}</div>`;

      const ov = document.createElement('div');
      ov.id = 'loginGate';
      ov.innerHTML = `
        <div class="lg-card">
          <div class="lg-head">
            <button class="lg-back" type="button" id="lgBack" aria-label="Quay lại">‹</button>
            <div class="lg-logo"><img class="lg-brand-logo" src="/assets/DanOnLogo.png" alt="DanDPak"><div class="lg-sub" id="lgSub"></div></div>
            ${mode === 'switch' ? `<button class="lg-x" type="button" id="lgCancel">Hủy</button>` : `<span class="lg-x-spacer"></span>`}
          </div>
          <div class="lg-viewport" id="lgVp">
            <div class="lg-track" id="lgTrack">
              ${hasBranchStep ? `<div class="lg-pane" data-step="branch"><div class="lg-branch-list" id="lgBranchList">${branchRowsHtml()}</div></div>` : ''}
              <div class="lg-pane" data-step="user"><div id="lgUserPane">${userPaneHtml()}</div></div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(ov);

      const close = (val) => { ov.remove(); resolve(val); };
      const setSub = () => { const s = ov.querySelector('#lgSub'); if (s) s.textContent = step === 'branch' ? 'Chọn chi nhánh' : 'Đăng nhập nhân viên'; };
      const setBack = () => { const b = ov.querySelector('#lgBack'); if (b) b.style.visibility = (step === 'user' && hasBranchStep) ? 'visible' : 'hidden'; };
      const fit = () => { const vp = ov.querySelector('#lgVp'); const pane = ov.querySelector(`.lg-pane[data-step="${step}"]`); if (vp && pane) vp.style.height = pane.offsetHeight + 'px'; };
      const slide = () => { const tr = ov.querySelector('#lgTrack'); if (tr) tr.style.transform = `translateX(-${paneList.indexOf(step) * 100}%)`; };
      const goStep = (name) => { step = name; setSub(); setBack(); slide(); fit(); };
      const refreshBranchList = () => { const l = ov.querySelector('#lgBranchList'); if (l) l.innerHTML = branchRowsHtml(); };
      const refreshUserPane = () => { const p = ov.querySelector('#lgUserPane'); if (p) p.innerHTML = userPaneHtml(); };

      const pickBranch = async (id) => {
        if (mode === 'switch' && id === originBranch) { close(null); return; }    // chọn lại chính nó: đóng, không đổi
        if (mode === 'switch' && id !== originBranch) {
          const ok = await requestPinCode({
            title: 'PIN Quản lý / Admin',
            subtitle: `Mở chi nhánh "${branchName(id)}"`,
            roleLabel: 'Cần quyền Quản lý',
            cancelText: 'Hủy',
            errorText: 'PIN không đúng hoặc không đủ quyền',
            onSubmit: (pin) => api('/auth/verify-branch-switch', { method: 'POST', body: { branch_id: id, pin } }),
          });
          if (!ok) return;                                                         // hủy / sai PIN → ở lại bước chi nhánh
          localStorage.removeItem('auth_token'); localStorage.removeItem('auth_user'); localStorage.removeItem('auth_perms');
        }
        selBranch = id;
        setBranchId(id);
        refreshBranchList();
        await loadUsers();
        refreshUserPane();
        goStep('user');
      };

      const pickUser = async (username, name, role) => {
        const r = await requestPinCode({
          title: 'Nhập mã PIN',
          subtitle: `Đăng nhập ${name}`,
          roleLabel: role,
          cancelText: 'Chọn lại',
          onSubmit: (pin) => api('/login', { method: 'POST', body: { username, pin, branch_id: getBranchId() } }),
        });
        if (!r) return;                                                            // "Chọn lại" → ở lại danh sách nhân viên
        ensureBranchForUser(r.user);
        localStorage.setItem('auth_token', r.token);
        localStorage.setItem('auth_user', JSON.stringify(r.user));
        localStorage.setItem('auth_perms', JSON.stringify(r.perms || []));
        const userLang = r.user.lang || 'vi';
        const currentPreferred = localStorage.getItem('preferred_lang') || 'vi';
        localStorage.setItem('preferred_lang', userLang);
        ov.remove();
        if (mode === 'gate' && userLang !== currentPreferred) location.reload();
        else resolve(r.user);
      };

      ov.addEventListener('click', async (e) => {
        const branchBtn = e.target.closest?.('.lg-branch-row');
        if (branchBtn && ov.contains(branchBtn)) { await pickBranch(branchBtn.dataset.b); return; }
        const userBtn = e.target.closest?.('.lg-user');
        if (userBtn && ov.contains(userBtn)) {
          const name = userBtn.querySelector('b')?.textContent || userBtn.dataset.u;
          const role = userBtn.querySelector('small')?.textContent || '';
          await pickUser(userBtn.dataset.u, name, role);
          return;
        }
        if (e.target.closest?.('#lgBack')) { goStep('branch'); return; }
        if (e.target.closest?.('#lgCancel')) { close(null); return; }
      });

      setSub(); setBack(); slide();
      requestAnimationFrame(fit);   // đo chiều cao sau khi layout xong
    })();
  });
}

function injectLoginCss() {
  if (document.getElementById('lgCss')) return;
  const s = document.createElement('style'); s.id = 'lgCss';
  s.textContent = `
  #loginGate{position:fixed;inset:0;z-index:500;background:radial-gradient(circle at 50% 45%,#ffffff,#edf3f8);display:flex;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;padding:20px;box-sizing:border-box}
  .lg-card{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:26px;width:100%;max-width:420px;box-shadow:0 24px 70px rgba(15,23,42,.16)}
  .lg-logo{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:7px;margin:0 auto 22px}
  .lg-brand-logo{width:min(218px,62vw);height:88px;object-fit:contain;display:block;filter:drop-shadow(0 8px 14px rgba(15,23,42,.08))}
  .lg-sub{font-size:13px;color:var(--muted);font-weight:700}
  .lg-branch{display:flex;flex-direction:column;gap:6px;margin:-6px 0 14px}
  .lg-branch span{font-size:10.5px;font-weight:850;text-transform:uppercase;color:var(--faint);letter-spacing:.45px}
  .lg-branch select{width:100%;height:42px;border-radius:12px;font-weight:800;background:#fff}
  .lg-branch-locked{border:1px solid var(--border2);background:var(--surface2);border-radius:14px;padding:10px 12px;margin:-6px 0 14px;text-align:center}
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

// Auto-detect thanh toán payOS: hỏi ngược payOS "đơn này trả chưa?" (chiều RA → chạy
// được cả ở localhost, không cần webhook). Gọi onPaid() khi PAID. Trả về hàm stop().
export function pollPayosPaid(orderCode, { onPaid, intervalMs = 4000, timeoutMs = 600000 } = {}) {
  if (!orderCode) return () => {};
  let stopped = false;
  const start = Date.now();
  const tick = async () => {
    if (stopped) return;
    try {
      const r = await api('/payos/payment-status/' + encodeURIComponent(orderCode));
      if (r && r.paid) { stopped = true; try { onPaid && onPaid(r); } catch {} return; }
    } catch {}
    if (!stopped && Date.now() - start < timeoutMs) setTimeout(tick, intervalMs);
  };
  setTimeout(tick, intervalMs);
  return () => { stopped = true; };
}

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Turn a raw audit record (action + detail) into a plain Vietnamese sentence.
const _ROLE_VN = { owner: 'Admin', manager: 'Quản lý', cashier: 'Thu ngân', kitchen: 'Bếp', warehouse: 'Thủ kho' };
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
// Single unified app-header shared by every module/tab:
//   [ brand + branch ] · [ page title + subtitle ] · [ actions · clock · online · user ]
// Pass opts = { title, sub, actions } to give a page its contextual heading.
let _activeTopbar = null;
let _activeTopbarOpts = {};
export function topbar(active, opts = {}) {
  _activeTopbar = active;
  _activeTopbarOpts = opts;
  const { title = '', sub = '', actions = '' } = opts;
  const br = selectedBranch();
  const branchName = esc(br.name || br.code || br.id);
  const liveLabel = getLang() === 'en' ? 'Live' : 'Trực tiếp';
  const homeTitle = getLang() === 'en' ? 'Back to Launcher' : 'Quay lại Launcher (chọn module khác)';
  return `<header class="topbar">
    <div class="tb-brand" onclick="location.href = '/'" title="${homeTitle}">
      <img class="tb-logo" src="/assets/DanOnLogo.png" alt="DanDPak">
      <span class="tb-branch"><b>${branchName}</b><small><i class="tb-live"></i>${liveLabel}</small></span>
    </div>
    ${title ? `<div class="tb-heading"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>` : ''}
    <div class="tb-right">
      ${actions ? `<div class="tb-actions">${actions}</div>` : ''}
      <span class="clock" id="clock"></span>
      <span class="onlinedot"><i></i><span>Online</span></span>
      <span id="userchip"></span>
    </div>
  </header>`;
}

const ROLE_LABEL2 = getLang() === 'en' ?
  { owner: 'Admin', manager: 'Manager', cashier: 'Cashier', kitchen: 'Kitchen', warehouse: 'Warehouse Keeper' } :
  { owner: 'Admin', manager: 'Quản lý', cashier: 'Thu ngân', kitchen: 'Bếp', warehouse: 'Thủ kho' };
export function renderUserChip() {
  if (_activeTopbar && document.getElementById('top')) {
    document.getElementById('top').innerHTML = topbar(_activeTopbar, _activeTopbarOpts);
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

export async function openCameraScanner(callback) {
  injectScannerCss();
  await loadHtml5Qrcode().catch(e => {
    toast('Không thể tải thư viện quét mã vạch', true);
    throw e;
  });

  const ov = document.createElement('div');
  ov.className = 'scanner-overlay';
  ov.innerHTML = `
    <div class="scanner-modal">
      <div class="scanner-header">
        <button class="scanner-close" id="scannerCloseBtn">Đóng</button>
        <div class="scanner-title">Quét mã vạch</div>
        <button class="scanner-flash" id="scannerFlashBtn" style="display:none">🔦</button>
      </div>
      <div class="scanner-viewport">
        <div id="scanner-reader" style="width: 100%; height: 100%;"></div>
        <div class="scanner-overlay-box">
          <div class="corner top-left"></div>
          <div class="corner top-right"></div>
          <div class="corner bottom-left"></div>
          <div class="corner bottom-right"></div>
          <div class="scanner-laser"></div>
        </div>
      </div>
      <div class="scanner-footer">
        <span class="barcode-icon">║▌║█║▌│</span>
        <span>Đặt mã vạch vào trong khung để quét</span>
      </div>
    </div>
  `;
  document.body.appendChild(ov);

  const playBeep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
    } catch (e) {}
  };

  const html5QrCode = new window.Html5Qrcode("scanner-reader");
  const formats = window.Html5QrcodeSupportedFormats ? [
    window.Html5QrcodeSupportedFormats.EAN_13,
    window.Html5QrcodeSupportedFormats.EAN_8,
    window.Html5QrcodeSupportedFormats.CODE_128,
    window.Html5QrcodeSupportedFormats.CODE_39,
    window.Html5QrcodeSupportedFormats.UPC_A,
    window.Html5QrcodeSupportedFormats.UPC_E,
    window.Html5QrcodeSupportedFormats.QR_CODE
  ] : undefined;

  const stopScanner = async () => {
    if (html5QrCode.isScanning) {
      await html5QrCode.stop().catch(() => {});
    }
    ov.remove();
  };

  ov.querySelector('#scannerCloseBtn').onclick = stopScanner;

  const startWithConfig = (cameraConfig, scanConfig) => {
    return html5QrCode.start(
      cameraConfig,
      scanConfig,
      (decodedText) => {
        playBeep();
        stopScanner().then(() => {
          if (callback) callback(decodedText);
        });
      },
      () => {}
    );
  };

  const initializeTorch = () => {
    try {
      const capabilities = typeof html5QrCode.getRunningTrackCameraCapabilities === 'function'
        ? html5QrCode.getRunningTrackCameraCapabilities()
        : null;
      if (capabilities && typeof capabilities.torchFeature === 'function' && capabilities.torchFeature().isSupported()) {
        const torch = capabilities.torchFeature();
        const flashBtn = ov.querySelector('#scannerFlashBtn');
        if (flashBtn) {
          flashBtn.style.display = 'flex';
          flashBtn.onclick = async () => {
            try {
              const nextVal = !torch.value();
              await torch.apply(nextVal);
              flashBtn.classList.toggle('active', nextVal);
            } catch (ex) {}
          };
        }
      }
    } catch (e) {
      console.warn("Torch feature not supported or failed to initialize:", e);
    }
  };

  startWithConfig(
    { facingMode: "environment" },
    {
      fps: 60,
      formatsToSupport: formats,
      videoConstraints: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60 },
        facingMode: "environment"
      },
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true
      }
    }
  ).then(() => {
    initializeTorch();
  }).catch(err => {
    console.warn("Failed to start with Full HD 60FPS constraints, falling back to default...", err);
    startWithConfig(
      { facingMode: "environment" },
      {
        fps: 60,
        formatsToSupport: formats,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        }
      }
    ).then(() => {
      initializeTorch();
    }).catch(err2 => {
      const errMsg = err2 ? (err2.message || String(err2)) : "Unknown error";
      toast('Không thể mở camera: ' + errMsg, true);
      ov.remove();
    });
  });
}

function loadHtml5Qrcode() {
  return new Promise((resolve, reject) => {
    if (window.Html5Qrcode) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/html5-qrcode';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function injectScannerCss() {
  if (document.getElementById('scannerCss')) return;
  const s = document.createElement('style');
  s.id = 'scannerCss';
  s.textContent = `
  .scanner-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: #000;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
  }
  .scanner-modal {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #121212;
    color: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .scanner-header {
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    background: #1a1a1a;
    position: relative;
  }
  .scanner-close {
    background: transparent;
    border: none;
    color: #0ea5c2;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
  }
  .scanner-title {
    font-size: 17px;
    font-weight: 700;
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
  }
  .scanner-flash {
    background: rgba(255,255,255,0.1);
    border: none;
    color: #fff;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .scanner-flash.active {
    background: #eab308;
    color: #000;
  }
  .scanner-viewport {
    flex: 1;
    position: relative;
    background: #000;
    overflow: hidden;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .scanner-overlay-box {
    position: absolute;
    width: 280px;
    height: 200px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
    box-sizing: border-box;
    pointer-events: none;
    z-index: 10;
  }
  .scanner-overlay-box .corner {
    position: absolute;
    width: 24px;
    height: 24px;
    border: 4px solid #0ea5c2;
  }
  .scanner-overlay-box .top-left {
    top: -4px;
    left: -4px;
    border-right: none;
    border-bottom: none;
  }
  .scanner-overlay-box .top-right {
    top: -4px;
    right: -4px;
    border-left: none;
    border-bottom: none;
  }
  .scanner-overlay-box .bottom-left {
    bottom: -4px;
    left: -4px;
    border-right: none;
    border-top: none;
  }
  .scanner-overlay-box .bottom-right {
    bottom: -4px;
    right: -4px;
    border-left: none;
    border-top: none;
  }
  .scanner-laser {
    position: absolute;
    left: 4%;
    width: 92%;
    height: 2px;
    background-color: #ef4444;
    box-shadow: 0 0 8px #ef4444;
    top: 0;
    animation: scanning 2s linear infinite;
  }
  @keyframes scanning {
    0% { top: 0%; }
    50% { top: 100%; }
    100% { top: 0%; }
  }
  .scanner-footer {
    padding: 20px 16px;
    text-align: center;
    background: #1a1a1a;
    font-size: 14px;
    color: rgba(255,255,255,0.7);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    border-top: 1px solid rgba(255,255,255,0.1);
  }
  .barcode-icon {
    font-size: 24px;
    letter-spacing: -2px;
    color: #fff;
    opacity: 0.8;
  }
  #scanner-reader video {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
  }
  `;
  document.head.appendChild(s);
}
