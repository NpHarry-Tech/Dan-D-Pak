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

const ROLE_LABEL = { owner: 'Chủ quán', manager: 'Quản lý', cashier: 'Thu ngân', kitchen: 'Bếp', warehouse: 'Thủ kho' };
const DEMO_LOGIN_USERS = [
  { id:'demo_owner', username:'owner', name:'Chủ quán', role:'owner', pin:'1234' },
  { id:'demo_manager', username:'manager', name:'Quản lý', role:'manager', pin:'2222' },
  { id:'demo_cashier', username:'cashier', name:'Thu ngân', role:'cashier', pin:'1111' },
  { id:'demo_kitchen', username:'kitchen', name:'Bếp', role:'kitchen', pin:'3333' },
  { id:'demo_warehouse', username:'warehouse', name:'Thủ kho', role:'warehouse', pin:'4444' },
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
        <div class="lg-logo"><img class="lg-brand-logo" src="/assets/DanOnLogo.png" alt="DanDPak"><div class="lg-sub">Đăng nhập nhân viên</div></div>
        <div class="lg-users">${users.map(u => `<button class="lg-user" data-u="${u.username}"><span class="lg-av">${(u.name||'?')[0]}</span><span><b>${u.name}</b><small>${ROLE_LABEL[u.role] || u.role}</small></span></button>`).join('')}</div>
        <div class="lg-pin" id="lgPin">
          <button class="lg-back" id="lgBack">← Chọn lại</button>
          <div class="lg-who" id="lgWho"></div>
          <div class="lg-dots" id="lgDots"></div>
          <div class="lg-pad">${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k => k === '' ? '<span></span>' : `<button class="lg-key" data-k="${k}">${k}</button>`).join('')}</div>
        </div>
        <div class="lg-hint">PIN demo — Chủ quán:1234 · Quản lý:2222 · Thu ngân:1111 · Bếp:3333 · Kho:4444</div>
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
    const lbl = el.querySelector('span'); if (lbl) lbl.textContent = ok ? 'Online' : 'Mất kết nối';
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
  const tick = () => el.textContent = new Date().toLocaleTimeString('vi-VN');
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
    'shift.open': () => `Mở ${d.shift || 'ca làm việc'} với tiền đầu ca ${money(d.opening_cash || 0)}`,
    'shift.close': () => `Kết ${d.shift || 'ca làm việc'}: doanh thu ${money(d.revenue || 0)}, tiền mặt dự kiến ${money(d.expected_cash || 0)}`,
    'retail.refund': () => `Hoàn trả đơn bán lẻ — ${money(d.total)}${d.reason ? ` (${d.reason})` : ''}`,
    'online.receive': () => `Nhận đơn ${_CHAN_VN[d.channel] || d.channel} ${d.ref || ''} — ${money(d.total)}`,
    'online.status': () => `Đơn online chuyển sang: ${_ST_VN[d.status] || d.status}`,
    'invoice.issue': () => `Phát hành hóa đơn điện tử ${d.invoice_no || ''}`,
    'invoice.cancel': () => `Hủy hóa đơn ${d.invoice_no || ''}${d.reason ? ` (${d.reason})` : ''}`,
    'print.reprint': () => 'In lại phiếu',
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

const ROLE_LABEL2 = { owner: 'Chủ quán', manager: 'Quản lý', cashier: 'Thu ngân', kitchen: 'Bếp', warehouse: 'Thủ kho' };
export function renderUserChip() {
  if (_activeTopbar && document.getElementById('top')) {
    document.getElementById('top').innerHTML = topbar(_activeTopbar);
  }
  const el = document.getElementById('userchip'); const u = getUser(); if (!el || !u) return;
  el.innerHTML = `<span style="display:inline-flex;align-items:center;gap:7px;background:var(--surface2);border:1px solid var(--border2);border-radius:99px;padding:4px 6px 4px 11px;font-size:12px;font-weight:600">
    👤 ${u.name} <small style="color:var(--muted)">· ${ROLE_LABEL2[u.role] || u.role}</small>
    <button id="logoutBtn" style="background:var(--surface3);border-radius:99px;width:22px;height:22px;color:var(--muted)" title="Đăng xuất">⏻</button></span>`;
  document.getElementById('logoutBtn').onclick = () => logout();
}
