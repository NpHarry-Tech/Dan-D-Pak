// Shared frontend runtime: REST helper, realtime socket, formatting, toast, clock.
import { MODULES, TOPBAR_MODULES, MODULE_GROUPS } from './modules.js';

export const BRANCH = 'br1';

export async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': getToken() || '' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const demo = demoApiFallback(path);
    if (demo !== undefined) return demo;
    const e = new Error(data.error || ('HTTP ' + res.status)); e.status = res.status; throw e;
  }
  return data;
}

// ---- Auth ----
export const getToken = () => localStorage.getItem('auth_token');
export const getUser = () => { try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); } catch { return null; } };
export const getPerms = () => { try { return JSON.parse(localStorage.getItem('auth_perms') || '[]'); } catch { return []; } };
export const hasPerm = (p) => { const ps = getPerms(); return ps.includes('*') || ps.includes(p) || getUser()?.role === 'owner'; };
export const canOpenModule = (keyOrModule) => {
  const m = typeof keyOrModule === 'string' ? MODULES.find(x => x.key === keyOrModule) : keyOrModule;
  return !!m && (m.status === 'active') && (!m.perm || hasPerm(m.perm));
};
export async function requireModuleAccess(moduleKey) {
  await requireLogin();
  const m = MODULES.find(x => x.key === moduleKey);
  if (!m || canOpenModule(m)) return true;
  document.body.innerHTML = `<div class="view"><div class="panel" style="max-width:520px;margin:60px auto;text-align:center">
    <h3>Access Denied</h3>
    <div class="empty">This account does not have permission to open module ${esc(m?.label || moduleKey)}.</div>
    <a class="btn primary" href="/" style="display:inline-flex;margin-top:12px">Back to app</a>
  </div></div>`;
  throw new Error('No module access: ' + moduleKey);
}
export async function logout() {
  try { await api('/logout', { method: 'POST' }); } catch {}
  localStorage.removeItem('auth_token'); localStorage.removeItem('auth_user'); localStorage.removeItem('auth_perms'); location.reload();
}

const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier', kitchen: 'Kitchen', warehouse: 'Warehouse' };
const DEMO_LOGIN_USERS = [
  { id:'demo_owner', username:'owner', name:'Owner', role:'owner', pin:'1234' },
  { id:'demo_manager', username:'manager', name:'Manager', role:'manager', pin:'2222' },
  { id:'demo_cashier', username:'cashier', name:'Cashier', role:'cashier', pin:'1111' },
  { id:'demo_kitchen', username:'kitchen', name:'Kitchen', role:'kitchen', pin:'3333' },
  { id:'demo_warehouse', username:'warehouse', name:'Warehouse', role:'warehouse', pin:'4444' },
];
const DEMO_PERMS = {
  owner: ['*'],
  manager: ['menu.manage','inventory.adjust','warehouse.manage','refund','void','discount','reports','invoice','online','sell','pay','audit.view','settings.manage','module.ipad','module.pos','module.retail','module.kds','module.online','module.warehouse','module.inventory','module.admin','module.settings','module.printing','module.crm','module.sales','module.purchase','module.accounting','module.invoice','module.expense','module.website','module.payment','module.contacts','module.reports','module.import_export','module.calendar','module.discuss','module.documents','module.knowledge','module.project'],
  cashier: ['sell','pay','discount','invoice','module.pos','module.retail','module.invoice'],
  kitchen: ['module.kds'],
  warehouse: ['inventory.adjust','warehouse.manage','module.warehouse','module.inventory'],
};
const isDemoToken = () => (getToken() || '').startsWith('demo_');
function demoLogin(username, pin) {
  const u = DEMO_LOGIN_USERS.find(x => x.username === String(username || '').toLowerCase());
  if (!u || u.pin !== String(pin)) throw new Error('Wrong account or PIN');
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

// Block the page with a PIN login until a valid session exists. Returns the user.
export async function requireLogin() {
  if (getToken()) {
    if (isDemoToken()) {
      const user = getUser();
      if (user) {
        localStorage.setItem('auth_perms', JSON.stringify(DEMO_PERMS[user.role] || []));
        return user;
      }
    }
    try { const me = await api('/me'); localStorage.setItem('auth_user', JSON.stringify(me)); localStorage.setItem('auth_perms', JSON.stringify(me.perms || [])); return me; }
    catch { localStorage.removeItem('auth_token'); localStorage.removeItem('auth_user'); }
  }
  return new Promise(async (resolve) => {
    let demoMode = false;
    let users = [];
    try {
      const rows = await api('/users');
      users = Array.isArray(rows) ? rows : [];
    } catch {
      demoMode = true;
      users = DEMO_LOGIN_USERS;
    }
    if (!users.length) {
      demoMode = true;
      users = DEMO_LOGIN_USERS;
    }
    const ov = document.createElement('div');
    ov.id = 'loginGate';
    ov.innerHTML = `
      <div class="lg-card">
        <div class="lg-logo"><img class="lg-brand-logo" src="/assets/DanOnLogo.png" alt="DanDPak"><div class="lg-sub">Staff Login</div></div>
        <div class="lg-users">${users.map(u => `<button class="lg-user" data-u="${u.username}"><span class="lg-av">${(u.name||'?')[0]}</span><span><b>${u.name}</b><small>${ROLE_LABEL[u.role] || u.role}</small></span></button>`).join('')}</div>
        <div class="lg-pin" id="lgPin">
          <button class="lg-back" id="lgBack">← Select again</button>
          <div class="lg-who" id="lgWho"></div>
          <div class="lg-dots" id="lgDots"></div>
          <div class="lg-pad">${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k => k === '' ? '<span></span>' : `<button class="lg-key" data-k="${k}">${k}</button>`).join('')}</div>
        </div>
        <div class="lg-hint">Demo PIN — Owner:1234 · Manager:2222 · Cashier:1111 · Kitchen:3333 · Warehouse:4444</div>
      </div>`;
    document.body.appendChild(ov);
    injectLoginCss();
    let pickedUser = null, pin = '';
    const pinPanel = ov.querySelector('#lgPin'), dots = ov.querySelector('#lgDots'), who = ov.querySelector('#lgWho');
    const pinLength = 4;
    const drawDots = () => dots.innerHTML = Array.from({length:pinLength},(_,i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('');
    ov.querySelectorAll('.lg-user').forEach(b => b.onclick = () => {
      pickedUser = b.dataset.u; pin = ''; drawDots();
      who.textContent = b.querySelector('b').textContent;
      ov.classList.add('show-pin');
    });
    ov.querySelector('#lgBack').onclick = () => { ov.classList.remove('show-pin'); pin = ''; };
    ov.querySelectorAll('.lg-key').forEach(k => k.onclick = async () => {
      const v = k.dataset.k;
      if (v === '⌫') { pin = pin.slice(0, -1); drawDots(); return; }
      if (pin.length >= pinLength) return;
      pin += v; drawDots();
      if (pin.length === pinLength) {
        try {
          const r = demoMode ? demoLogin(pickedUser, pin) : await api('/login', { method: 'POST', body: { username: pickedUser, pin } });
          localStorage.setItem('auth_token', r.token); localStorage.setItem('auth_user', JSON.stringify(r.user));
          localStorage.setItem('auth_perms', JSON.stringify(r.perms || []));
          ov.remove(); resolve(r.user);
        } catch (e) {
          pinPanel.classList.add('shake'); setTimeout(() => pinPanel.classList.remove('shake'), 400);
          pin = ''; drawDots();
        }
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
  .lg-users{display:flex;flex-direction:column;gap:8px}
  .lg-user{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;background:var(--surface2);border:1px solid var(--border2);color:var(--text);text-align:left}
  .lg-user:hover{border-color:var(--brand)}
  .lg-av{width:34px;height:34px;border-radius:50%;background:var(--brand-dim);color:var(--brand);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px}
  .lg-user b{font-size:13.5px}.lg-user small{display:block;color:var(--muted);font-size:11px}
  .lg-pin{display:none}
  #loginGate.show-pin .lg-users{display:none}
  #loginGate.show-pin .lg-pin{display:block}
  .lg-back{background:none;color:var(--muted);font-size:12px;font-weight:600;margin-bottom:8px}
  .lg-who{text-align:center;font-weight:700;font-size:15px;margin-bottom:12px}
  .lg-dots{display:flex;gap:12px;justify-content:center;margin-bottom:18px}
  .lg-dots i{width:13px;height:13px;border-radius:50%;border:2px solid var(--border2)}
  .lg-dots i.on{background:var(--brand);border-color:var(--brand)}
  .lg-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .lg-key{padding:15px;border-radius:12px;background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-size:19px;font-weight:700;font-family:var(--mono)}
  .lg-key:hover{border-color:var(--brand);color:var(--brand)}
  .lg-pin.shake{animation:lgshake .4s}
  @keyframes lgshake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
  .lg-hint{margin-top:18px;font-size:10.5px;color:var(--faint);text-align:center;line-height:1.5}`;
  document.head.appendChild(s);
}

// Socket.IO is served by the server at /socket.io/socket.io.js
export function connect(device, handlers = {}) {
  if (typeof io === 'undefined') {
    console.warn('[client] socket.io client not loaded — realtime disabled, REST still works');
    return { on() {}, emit() {}, disconnect() {} };
  }
  const s = io({ query: { branch: BRANCH, device } });
  s.on('connect', () => setOnline(true));
  s.on('disconnect', () => setOnline(false));
  for (const [ev, fn] of Object.entries(handlers)) s.on(ev, fn);
  return s;
}

function setOnline(ok) {
  document.querySelectorAll('.onlinedot').forEach(el => {
    el.classList.toggle('off', !ok);
    const lbl = el.querySelector('span'); if (lbl) lbl.textContent = ok ? 'Online' : 'Disconnected';
  });
}

export const money = (n) => (n || 0).toLocaleString('vi-VN') + 'đ';
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
  const tick = () => el.textContent = new Date().toLocaleTimeString('en-US');
  tick(); setInterval(tick, 1000);
}

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Turn a raw audit record (action + detail) into a plain English sentence.
const _ROLE_VN = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier', kitchen: 'Kitchen', warehouse: 'Warehouse' };
const _CHAN_VN = { grabfood: 'GrabFood', shopeefood: 'ShopeeFood', website: 'Website' };
const _ST_VN = { received: 'received', confirmed: 'confirmed', preparing: 'preparing', ready: 'ready', completed: 'completed', accepted: 'received', served: 'served', cancelled: 'cancelled', new: 'new' };
export function describeAudit(action, detailRaw) {
  let d = {};
  try { d = typeof detailRaw === 'string' ? JSON.parse(detailRaw) : (detailRaw || {}); } catch { d = {}; }
  const src = (d.source || '').replace(/^https?:\/\//, '').split('/')[0];
  const M = {
    'auth.login': () => 'System login',
    'menu.create': () => `Created new item: ${d.name || ''}`,
    'menu.update': () => 'Updated item info',
    'menu.hide': () => `Hidden item from menu${d.name ? ': ' + d.name : ''}`,
    'menu.unhide': () => `Showed item again${d.name ? ': ' + d.name : ''}`,
    'menu.archive': () => `Archived item${d.name ? ': ' + d.name : ''} (had previous orders)`,
    'menu.delete': () => `Deleted item${d.name ? ': ' + d.name : ''}`,
    'category.create': () => `Created category: ${d.name || ''}`,
    'category.update': () => 'Updated category',
    'category.delete': () => `Deleted category${d.name ? ': ' + d.name : ''}`,
    'perms.update': () => `Updated permissions for role ${_ROLE_VN[d.role] || d.role} (${d.count} permissions)`,
    'user.perms.update': () => `Customized individual permissions for ${d.username || ''}`,
    'user.create': () => `Created user ${d.username || ''} — role ${_ROLE_VN[d.role] || d.role}`,
    'user.update': () => `Updated user ${d.username || ''}`,
    'user.delete': () => `Deleted user ${d.username || ''}`,
    'payment.done': () => `Payment completed — ${money(d.total)}${d.lines ? ` · ${d.lines} methods` : ''}`,
    'order.send': () => `Sent to kitchen ${d.items || ''} items`,
    'order.pending': () => `Customer sent ${d.items || ''} items, awaiting staff confirmation`,
    'order.confirm': () => `Staff confirmed ${d.items || ''} items and sent to kitchen/bar`,
    'order.reject': () => `Staff rejected ${d.items || ''} items${d.reason ? ': ' + d.reason : ''}`,
    'item.status': () => `Item status changed: ${_ST_VN[d.status] || d.status}`,
    'item.cancel': () => `Cancelled item${d.reason ? ': ' + d.reason : ''}`,
    'staff.call': () => `Customer called staff${d.reason ? ': ' + d.reason : ''}`,
    'table.move': () => `Moved bill from table ${d.from_code || d.from || ''} to table ${d.to_code || d.to || ''}`,
    'table.merge': () => `Merged table ${d.from_code || d.from || ''} into table ${d.to_code || d.to || ''}`,
    'bill.split': () => `Split ${d.items || 0} lines to separate payment bill${d.table_code ? ` at table ${d.table_code}` : ''}`,
    'settings.update': () => Array.isArray(d.keys) && d.keys.includes('integrations_config') ? 'Updated service connection configuration' : (Array.isArray(d.keys) && d.keys.includes('operations_config') ? 'Updated payment, QR and shift configuration' : (Array.isArray(d.keys) && d.keys.includes('print_config') ? 'Updated invoice, bill, label and printer configuration' : (Array.isArray(d.keys) && d.keys.includes('ipad_staff_pin') ? 'Changed iPad table selection password' : 'Updated system settings'))),
    'shift.open': () => `Opened ${d.shift || 'work shift'} with opening cash ${money(d.opening_cash || 0)}`,
    'shift.close': () => `Closed ${d.shift || 'work shift'}: revenue ${money(d.revenue || 0)}, expected cash ${money(d.expected_cash || 0)}`,
    'retail.refund': () => `Retail order refund — ${money(d.total)}${d.reason ? ` (${d.reason})` : ''}`,
    'online.receive': () => `Received ${_CHAN_VN[d.channel] || d.channel} order ${d.ref || ''} — ${money(d.total)}`,
    'online.status': () => `Online order status changed to: ${_ST_VN[d.status] || d.status}`,
    'invoice.issue': () => `Issued e-invoice ${d.invoice_no || ''}`,
    'invoice.cancel': () => `Cancelled invoice ${d.invoice_no || ''}${d.reason ? ` (${d.reason})` : ''}`,
    'print.reprint': () => 'Reprinted ticket',
    'warehouse.create': () => `Created warehouse: ${d.name || ''}`,
    'warehouse.update': () => `Updated warehouse: ${d.name || ''}`,
    'sku.create': () => 'Created retail product',
    'sku.update': () => 'Updated retail product',
    'sku.delete': () => 'Deleted retail product',
    'sku.receive': () => `Received retail stock +${d.qty || ''}${d.lot ? ` (lot ${d.lot})` : ''}`,
    'sku.issue': () => `Issued retail stock ${d.qty || ''}`,
    'inventory.item.create': () => 'Created ingredient / warehouse item',
    'inventory.item.update': () => 'Updated warehouse item',
    'inventory.item.delete': () => 'Deleted warehouse item',
    'inventory.receive': () => `Received kitchen stock +${d.qty || ''}${d.lot ? ` (lot ${d.lot})` : ''}`,
    'inventory.issue': () => `Issued kitchen stock ${d.qty || ''}`,
    'stock.transfer': () => `Transferred ${d.qty || ''} items${d.from ? ` from ${d.from}` : ''}${d.to ? ` to ${d.to}` : ''}`,
    'stocktake.approve': () => `Approved stocktake — ${d.changed || 0} items adjusted`,
    'bcm.import': () => `Imported BCM data: ${d.skus || 0} products${src ? ` from ${src}` : ''}`,
  };
  return M[action] ? M[action]() : action.replace(/\./g, ' › ');
}

// Standard topbar (device nav) injected into every device page.
let _activeTopbar = null;
export function topbar(active) {
  _activeTopbar = active;
  const activeKey = active === 'printers' ? 'printing' : active;
  const devs = TOPBAR_MODULES
    .map(k => MODULES.find(m => m.key === k))
    .filter(Boolean)
    .filter(m => canOpenModule(m) || activeKey === m.key);
  return `<header class="topbar">
    <div class="logo brand-mark"><img src="/assets/DanOnLogo.png" alt="DanDPak"><small>Branch: Dan D Pak Sala · Live</small></div>
    <nav class="devtabs">${devs.map(m =>
      `<a class="devtab ${m.key === activeKey ? 'active' : ''}" href="${m.href}">${m.icon} ${m.label.replace(' Self-Order','').replace('FnB ','')}</a>`).join('')}</nav>
    <div class="topright">
      <span class="clock" id="clock"></span>
      <span class="onlinedot"><i></i><span>Online</span></span>
      <span id="userchip"></span>
    </div>
  </header>`;
}

const ROLE_LABEL2 = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier', kitchen: 'Kitchen', warehouse: 'Warehouse' };
export function renderUserChip() {
  if (_activeTopbar && document.getElementById('top')) {
    document.getElementById('top').innerHTML = topbar(_activeTopbar);
  }
  const el = document.getElementById('userchip'); const u = getUser(); if (!el || !u) return;
  el.innerHTML = `<span style="display:inline-flex;align-items:center;gap:7px;background:var(--surface2);border:1px solid var(--border2);border-radius:99px;padding:4px 6px 4px 11px;font-size:12px;font-weight:600">
    👤 ${u.name} <small style="color:var(--muted)">· ${ROLE_LABEL2[u.role] || u.role}</small>
    <button id="logoutBtn" style="background:var(--surface3);border-radius:99px;width:22px;height:22px;color:var(--muted)" title="Logout">⏻</button></span>`;
  document.getElementById('logoutBtn').onclick = () => logout();
}