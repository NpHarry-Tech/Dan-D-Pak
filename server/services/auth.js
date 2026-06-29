// Authentication & role-based permissions. PIN login (typical for POS).
// Tokens are persisted in SQLite so refreshes and local server restarts do not
// force staff to log in again.
import { db, uid, now, audit } from '../db.js';
import { archiveStaff } from './archive.js';
import { MODULE_PERMISSIONS } from './modules.js';
import { REPORTS } from './reportCenter.js';
import { hashPin, verifyPin, newToken } from './pin.js';

const sessions = new Map(); // token -> { user, at }

// Chá»‘ng dÃ² PIN: khÃ³a Ä‘Äƒng nháº­p táº¡m thá»i sau nhiá»u láº§n sai liÃªn tiáº¿p (theo username).
const loginFails = new Map(); // username -> { count, until }
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 5 * 60 * 1000; // khÃ³a 5 phÃºt sau khi vÆ°á»£t ngÆ°á»¡ng
function loginLockState(uname) {
  const e = loginFails.get(uname);
  if (!e) return null;
  if (e.until && e.until <= Date.now()) { loginFails.delete(uname); return null; }
  return e;
}
function registerLoginFail(uname, branch_id, ip = '') {
  const e = loginFails.get(uname) || { count: 0, until: 0 };
  e.count += 1;
  if (e.count >= LOGIN_MAX_FAILS) e.until = Date.now() + LOGIN_LOCK_MS;
  loginFails.set(uname, e);
  audit('auth.login.failed', { user: uname, attempts: e.count, locked: !!e.until, ip }, branch_id, uname || 'unknown');
}

// Tá»± dá»n cÃ¡c session quÃ¡ háº¡n trong Map â€” trÃ¡nh memory leak khi thiáº¿t bá»‹ táº¯t mÃ  khÃ´ng logout.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngÃ y
function cleanupSessionMap() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [token, entry] of sessions) {
    const entryMs = new Date(entry.at).getTime();
    if (Number.isNaN(entryMs) || entryMs < cutoff) sessions.delete(token);
  }
}
setInterval(cleanupSessionMap, 6 * 60 * 60 * 1000).unref(); // cháº¡y 6 tiáº¿ng/láº§n, khÃ´ng block shutdown

const REPORT_PERMISSIONS = REPORTS.map(r => ({
  key: `report.${r.key}`,
  label: `BÃ¡o cÃ¡o â€” ${r.label}`,
}));

// Catalog of every permission with a plain-language label (shown on the settings page).
export const PERMISSIONS = [
  { key: 'sell', label: 'BÃ¡n hÃ ng â€” má»Ÿ bÃ n, thÃªm mÃ³n, gá»­i báº¿p' },
  { key: 'pay', label: 'Thanh toÃ¡n bill' },
  { key: 'discount', label: 'Ãp giáº£m giÃ¡ vÃ  voucher' },
  { key: 'refund', label: 'HoÃ n tiá»n vÃ  Ä‘á»•i tráº£' },
  { key: 'void', label: 'Há»§y bill, há»§y mÃ³n Ä‘Ã£ gá»­i' },
  { key: 'menu.manage', label: 'Quáº£n lÃ½ thá»±c Ä‘Æ¡n â€” thÃªm, sá»­a, xÃ³a mÃ³n vÃ  danh má»¥c' },
  { key: 'inventory.adjust', label: 'Äiá»u chá»‰nh tá»“n kho vÃ  kiá»ƒm kho' },
  { key: 'warehouse.manage', label: 'Quáº£n lÃ½ kho â€” táº¡o kho, nháº­p, xuáº¥t, chuyá»ƒn kho' },
  { key: 'invoice', label: 'Xuáº¥t hÃ³a Ä‘Æ¡n Ä‘iá»‡n tá»­' },
  { key: 'online', label: 'Xá»­ lÃ½ Ä‘Æ¡n hÃ ng online' },
  { key: 'kds', label: 'Sá»­ dá»¥ng mÃ n hÃ¬nh báº¿p' },
  { key: 'reports', label: 'BÃ¡o cÃ¡o â€” xem toÃ n bá»™ trung tÃ¢m bÃ¡o cÃ¡o' },
  ...REPORT_PERMISSIONS,
  { key: 'audit.view', label: 'Xem nháº­t kÃ½ hoáº¡t Ä‘á»™ng' },
  { key: 'settings.manage', label: 'Quáº£n lÃ½ ngÆ°á»i dÃ¹ng vÃ  phÃ¢n quyá»n' },
  { key: 'settings.users', label: 'CÃ i Ä‘áº·t â€” Quáº£n lÃ½ nhÃ¢n viÃªn' },
  { key: 'settings.perms', label: 'CÃ i Ä‘áº·t â€” Quáº£n lÃ½ quyá»n vÃ  vai trÃ²' },
  { key: 'settings.branches', label: 'CÃ i Ä‘áº·t â€” Quáº£n lÃ½ chi nhÃ¡nh & phÃ¢n vÃ¹ng' },
  { key: 'settings.sync', label: 'CÃ i Ä‘áº·t â€” Cloud Sync & Äá»“ng bá»™ ngoáº¡i tuyáº¿n' },
  { key: 'settings.integrations', label: 'CÃ i Ä‘áº·t â€” LiÃªn káº¿t dá»‹ch vá»¥ (MISA, PayOS...)' },
  { key: 'settings.connections', label: 'CÃ i Ä‘áº·t â€” Káº¿t ná»‘i há»‡ thá»‘ng (Máº¡ng, mÃ¡y in, POS...)' },
  { key: 'settings.operations', label: 'CÃ i Ä‘áº·t â€” PhÆ°Æ¡ng thá»©c thanh toÃ¡n & Ca lÃ m viá»‡c' },
  { key: 'settings.invoices', label: 'CÃ i Ä‘áº·t â€” Quáº£n lÃ½ hÃ³a Ä‘Æ¡n Ä‘iá»‡n tá»­' },
  { key: 'settings.einvoice', label: 'CÃ i Ä‘áº·t â€” Cáº¥u hÃ¬nh hÃ³a Ä‘Æ¡n Ä‘iá»‡n tá»­ MISA' },
  { key: 'settings.print', label: 'CÃ i Ä‘áº·t â€” Thiáº¿t káº¿ Bill & Tem nhÃ£n' },
  { key: 'settings.devices', label: 'CÃ i Ä‘áº·t â€” Quáº£n lÃ½ thiáº¿t bá»‹ khÃ¡ch' },
  { key: 'settings.menu', label: 'CÃ i Ä‘áº·t â€” Cáº¥u hÃ¬nh thá»±c Ä‘Æ¡n FnB' },
  { key: 'settings.tables', label: 'CÃ i Ä‘áº·t â€” Cáº¥u hÃ¬nh sÆ¡ Ä‘á»“ bÃ n' },
  { key: 'settings.printers', label: 'CÃ i Ä‘áº·t â€” Quáº£n lÃ½ danh má»¥c mÃ¡y in' },
  { key: 'settings.audit', label: 'CÃ i Ä‘áº·t â€” Nháº­t kÃ½ hoáº¡t Ä‘á»™ng quáº£n lÃ½' },
  { key: 'settings.notification_sound', label: 'CÃ i Ä‘áº·t â€” Ã‚m thanh thÃ´ng bÃ¡o' },
  ...MODULE_PERMISSIONS,
];
export const ALL_PERMS = PERMISSIONS.map(p => p.key);

// Display roles with plain-language names.
export const ROLES = [
  { key: 'owner', label: 'Admin', note: 'ToÃ n quyá»n há»‡ thá»‘ng, khÃ´ng thá»ƒ chá»‰nh.' },
  { key: 'manager', label: 'Quáº£n lÃ½', note: 'Quáº£n lÃ½ váº­n hÃ nh cá»­a hÃ ng.' },
  { key: 'cashier', label: 'Thu ngÃ¢n', note: 'BÃ¡n hÃ ng vÃ  thu tiá»n.' },
  { key: 'kitchen', label: 'Báº¿p', note: 'Cháº¿ biáº¿n mÃ³n.' },
  { key: 'warehouse', label: 'Thá»§ kho', note: 'Quáº£n lÃ½ nháº­p xuáº¥t kho.' },
];

// Built-in defaults used to seed the editable matrix on first run.
const DEFAULT_ROLE_PERMS = {
  owner: ['*'],
  manager: ['menu.manage', 'inventory.adjust', 'warehouse.manage', 'refund', 'void', 'discount', 'reports', 'invoice', 'online', 'sell', 'pay', 'audit.view', 'settings.manage',
    'module.ipad', 'module.pos', 'module.retail', 'module.kds', 'module.online', 'module.warehouse', 'module.inventory', 'module.printing',
    'module.invoice', 'module.reports', 'module.contacts', 'module.purchase', 'module.expenses', 'module.database'],
  cashier: ['sell', 'pay', 'discount', 'invoice', 'module.pos', 'module.retail', 'module.invoice'],
  kitchen: ['kds', 'module.kds'],
  warehouse: ['inventory.adjust', 'warehouse.manage', 'warehouse', 'module.warehouse', 'module.inventory', 'module.purchase'],
};
export const ROLE_PERMS = DEFAULT_ROLE_PERMS; // kept for backwards-compat imports

// Editable roleâ†’permission mapping is persisted so admins can change it live.
db.exec(`CREATE TABLE IF NOT EXISTS role_perms (role TEXT NOT NULL, perm TEXT NOT NULL, PRIMARY KEY(role,perm));`);
db.exec(`CREATE TABLE IF NOT EXISTS user_perms (
  user_id TEXT NOT NULL,
  perm TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('allow','deny')),
  PRIMARY KEY(user_id,perm)
);`);
function seedRolePerms() {
  const has = db.prepare(`SELECT COUNT(*) n FROM role_perms`).get().n;
  if (has) return;
  const ins = db.prepare(`INSERT OR IGNORE INTO role_perms (role,perm) VALUES (?,?)`);
  for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMS)) {
    if (role === 'owner') continue; // owner is always all-powerful, no rows needed
    for (const p of perms) ins.run(role, p);
  }
}
seedRolePerms();
function seedNewModulePerms() {
  const ins = db.prepare(`INSERT OR IGNORE INTO role_perms (role,perm) VALUES (?,?)`);
  for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMS)) {
    if (role === 'owner') continue;
    for (const p of perms.filter(x => x.startsWith('module.'))) ins.run(role, p);
  }
}
seedNewModulePerms();
function seedNewSettingsPerms() {
  const ins = db.prepare(`INSERT OR IGNORE INTO role_perms (role,perm) VALUES (?,?)`);
  const rolesWithSettingsManage = db.prepare(`SELECT DISTINCT role FROM role_perms WHERE perm='settings.manage'`).all().map(r => r.role);
  if (!rolesWithSettingsManage.includes('manager')) {
    rolesWithSettingsManage.push('manager');
  }
  const settingsPermKeys = PERMISSIONS.filter(p => p.key.startsWith('settings.')).map(p => p.key);
  for (const role of rolesWithSettingsManage) {
    for (const p of settingsPermKeys) {
      ins.run(role, p);
    }
  }
}
seedNewSettingsPerms();

let permCache = null;
function loadPerms() {
  permCache = {};
  for (const r of db.prepare(`SELECT role,perm FROM role_perms`).all()) {
    (permCache[r.role] ||= new Set()).add(r.perm);
  }
}
export function can(role, perm) {
  if (role === 'owner') return true;
  if (!permCache) loadPerms();
  const set = permCache[role];
  return !!set && (set.has('*') || set.has(perm));
}
export function effectivePerms(role) {
  if (role === 'owner') return ['*', ...ALL_PERMS];
  if (!permCache) loadPerms();
  return [...(permCache[role] || [])].filter(p => p === '*' || ALL_PERMS.includes(p));
}
function rolePermSet(role) {
  return new Set(effectivePerms(role).filter(p => p !== '*'));
}
function userPermRows(user_id) {
  return db.prepare(`SELECT perm,mode FROM user_perms WHERE user_id=?`).all(user_id)
    .filter(r => ALL_PERMS.includes(r.perm));
}
export function effectivePermsForUser(userOrId) {
  const u = typeof userOrId === 'object'
    ? userOrId
    : db.prepare(`SELECT id,role FROM users WHERE id=? AND active=1`).get(userOrId);
  if (!u) return [];
  if (u.role === 'owner') return ['*', ...ALL_PERMS];
  const set = rolePermSet(u.role);
  for (const r of userPermRows(u.id)) {
    if (r.mode === 'allow') set.add(r.perm);
    if (r.mode === 'deny') set.delete(r.perm);
  }
  return [...set];
}
export function userPermDetails(userOrId) {
  const u = typeof userOrId === 'object'
    ? userOrId
    : db.prepare(`SELECT id,role FROM users WHERE id=?`).get(userOrId);
  if (!u) return { perms: [], role_perms: [], allow_perms: [], deny_perms: [], customized: false };
  const role_perms = u.role === 'owner' ? ALL_PERMS : [...rolePermSet(u.role)];
  const rows = userPermRows(u.id);
  const allow_perms = rows.filter(r => r.mode === 'allow').map(r => r.perm);
  const deny_perms = rows.filter(r => r.mode === 'deny').map(r => r.perm);
  return {
    perms: effectivePermsForUser(u),
    role_perms,
    allow_perms,
    deny_perms,
    customized: !!(allow_perms.length || deny_perms.length),
  };
}
export function setUserPerms(user_id, perms, branch_id = 'br1') {
  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(user_id);
  if (!u) throw new Error('NgÆ°á»i dÃ¹ng khÃ´ng tá»“n táº¡i');
  db.prepare(`DELETE FROM user_perms WHERE user_id=?`).run(user_id);
  if (u.role === 'owner') return userPermDetails(u);
  const wanted = new Set((Array.isArray(perms) ? perms : []).filter(p => ALL_PERMS.includes(p)));
  const base = rolePermSet(u.role);
  const ins = db.prepare(`INSERT OR REPLACE INTO user_perms (user_id,perm,mode) VALUES (?,?,?)`);
  let allow = 0, deny = 0;
  for (const p of wanted) {
    if (!base.has(p)) { ins.run(user_id, p, 'allow'); allow++; }
  }
  for (const p of base) {
    if (!wanted.has(p)) { ins.run(user_id, p, 'deny'); deny++; }
  }
  audit('user.perms.update', { username: u.username, role: u.role, allow, deny, total: wanted.size }, branch_id);
  return userPermDetails(u);
}
export function canUser(user, perm) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  const perms = effectivePermsForUser(user);
  return perms.includes('*') || perms.includes(perm);
}
// Returns the full matrix for the settings UI.
export function permMatrix() {
  if (!permCache) loadPerms();
  return ROLES.map(r => ({
    ...r,
    perms: r.key === 'owner' ? ALL_PERMS : [...(permCache[r.key] || [])],
    locked: r.key === 'owner',
  }));
}
export function setRolePerms(role, perms, branch_id = 'br1') {
  if (role === 'owner') throw new Error('Vai trÃ² Admin luÃ´n toÃ n quyá»n, khÃ´ng thá»ƒ chá»‰nh');
  if (!ROLES.some(r => r.key === role)) throw new Error('Vai trÃ² khÃ´ng há»£p lá»‡');
  const valid = (Array.isArray(perms) ? perms : []).filter(p => ALL_PERMS.includes(p));
  db.prepare(`DELETE FROM role_perms WHERE role=?`).run(role);
  const ins = db.prepare(`INSERT OR IGNORE INTO role_perms (role,perm) VALUES (?,?)`);
  for (const p of valid) ins.run(role, p);
  loadPerms();
  audit('perms.update', { role, count: valid.length }, branch_id);
  return permMatrix();
}

function parseBranchAccess(raw) {
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    return Array.isArray(list) ? list.map(x => String(x)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function listBranches({ all = false } = {}) {
  const rows = db.prepare(`SELECT * FROM branches ORDER BY sort,name`).all()
    .map(b => ({ ...b, active: b.active !== 0 }));
  return all ? rows : rows.filter(b => b.active);
}

function branchExists(id, { includeInactive = false } = {}) {
  if (!id) return false;
  const row = db.prepare(`SELECT id,active FROM branches WHERE id=?`).get(id);
  return !!row && (includeInactive || row.active !== 0);
}

export function userBranchIds(user) {
  if (!user) return ['br1'];
  if (user.role === 'owner') return listBranches().map(b => b.id);
  const access = parseBranchAccess(user.branch_access_json || user.branch_access || user.branch_ids);
  if (access.includes('*')) return listBranches().map(b => b.id);
  const ids = new Set([user.branch_id || 'br1', ...access]);
  return [...ids].filter(id => branchExists(id));
}

export function canAccessBranch(user, branch_id) {
  if (!branch_id || !branchExists(branch_id)) return false;
  return userBranchIds(user).includes(branch_id);
}

export function publicBranch(req) {
  const requested = String(req?.headers?.['x-branch-id'] || req?.query?.branch_id || req?.body?.branch_id || 'br1');
  return branchExists(requested) ? requested : 'br1';
}

export function resolveBranch(req) {
  const requested = String(req?.headers?.['x-branch-id'] || req?.query?.branch_id || req?.body?.branch_id || req?.user?.branch_id || 'br1');
  if (!req?.user) return publicBranch(req);
  if (canAccessBranch(req.user, requested)) return requested;
  const fallback = req.user.branch_id || userBranchIds(req.user)[0] || 'br1';
  if (canAccessBranch(req.user, fallback)) return fallback;
  throw new Error('TÃ i khoáº£n nÃ y khÃ´ng cÃ³ quyá»n truy cáº­p chi nhÃ¡nh Ä‘Ã£ chá»n.');
}

function normalizeBranchAccess(body = {}, role = 'cashier', homeBranch = 'br1') {
  if (role === 'owner') return ['*'];
  const raw = body.branch_access || body.branch_ids || body.branchAccess || [];
  const ids = Array.isArray(raw) ? raw : [];
  const clean = [...new Set([homeBranch, ...ids].map(x => String(x || '').trim()).filter(Boolean))]
    .filter(id => branchExists(id));
  return clean.length ? clean : [homeBranch];
}

export function login(username, pin, branch_id = 'br1', meta = {}) {
  const ip = String(meta?.ip || '').slice(0, 64);
  const uname = String(username || '').toLowerCase();
  const lock = loginLockState(uname);
  if (lock && lock.until && lock.until > Date.now()) {
    const mins = Math.max(1, Math.ceil((lock.until - Date.now()) / 60000));
    audit('auth.login.locked', { user: uname, ip }, branchExists(branch_id) ? branch_id : 'br1', uname || 'unknown');
    throw new Error(`ÄÄƒng nháº­p táº¡m khÃ³a do nháº­p sai nhiá»u láº§n. Thá»­ láº¡i sau ~${mins} phÃºt.`);
  }
  const u = db.prepare(`SELECT * FROM users WHERE username=? AND active=1`).get(uname);
  if (!u || !verifyPin(pin, u.pin)) {
    registerLoginFail(uname, branchExists(branch_id) ? branch_id : 'br1', ip);
    throw new Error('Sai tÃ i khoáº£n hoáº·c mÃ£ PIN');
  }
  loginFails.delete(uname);
  const selectedBranch = branchExists(branch_id) ? branch_id : (u.branch_id || 'br1');
  if (!canAccessBranch(u, selectedBranch)) throw new Error('TÃ i khoáº£n nÃ y chÆ°a Ä‘Æ°á»£c cáº¥p quyá»n vÃ o chi nhÃ¡nh Ä‘Ã£ chá»n.');
  const token = newToken();
  const user = publicUser(u);
  const ts = now();
  sessions.set(token, { user, at: ts });
  db.prepare(`INSERT INTO auth_sessions (token,user_id,branch_id,created_at,last_seen_at) VALUES (?,?,?,?,?)`)
    .run(token, u.id, selectedBranch, ts, ts);
  audit('auth.login', { user: u.username, role: u.role, ip }, selectedBranch, u.username);
  return { token, user, perms: effectivePermsForUser(u) };
}

export function verifyManagerOwnerPin(pin, branch_id = 'br1') {
  const clean = String(pin || '').trim();
  if (!clean) return null;
  // PIN nay duoc bam (scrypt) nen khong the tra theo `WHERE pin=?`: nap ung vien
  // theo vai tro roi so khop bang verifyPin (so luong owner/manager nho).
  const rows = db.prepare(`
    SELECT * FROM users
    WHERE active=1
      AND role IN ('owner','manager')
    ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, name
    LIMIT 200`).all();
  const row = rows.find(u => verifyPin(clean, u.pin) && canAccessBranch(u, branch_id));
  return row ? publicUser(row) : null;
}

export function verifyWarehouseConfigPin(pin, branch_id = 'br1') {
  const clean = String(pin || '').trim();
  if (!clean) return null;
  const rows = db.prepare(`
    SELECT * FROM users
    WHERE active=1
      AND role IN ('owner','manager','warehouse')
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, name
    LIMIT 200`).all();
  const row = rows.find(u => verifyPin(clean, u.pin) && canAccessBranch(u, branch_id));
  return row ? publicUser(row) : null;
}

export function logout(token) {
  if (!token) return;
  sessions.delete(token);
  db.prepare(`DELETE FROM auth_sessions WHERE token=?`).run(token);
}

export function userFor(token) {
  if (!token) return null;
  const cached = sessions.get(token);
  if (cached) {
    const fresh = db.prepare(`SELECT * FROM users WHERE id=? AND active=1`).get(cached.user.id);
    if (!fresh) { sessions.delete(token); return null; }
    cached.user = publicUser(fresh);
    db.prepare(`UPDATE auth_sessions SET last_seen_at=? WHERE token=?`).run(now(), token);
    return cached.user;
  }
  const row = db.prepare(`
    SELECT u.* FROM auth_sessions s
    JOIN users u ON u.id=s.user_id
    WHERE s.token=? AND u.active=1`).get(token);
  if (!row) return null;
  const user = publicUser(row);
  sessions.set(token, { user, at: now() });
  db.prepare(`UPDATE auth_sessions SET last_seen_at=? WHERE token=?`).run(now(), token);
  return user;
}

function publicLoginUser(u) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
  };
}

export function listUsers(branch_id = 'br1', { loginPublic = false } = {}) {
  return db.prepare(`SELECT * FROM users WHERE active=1 ORDER BY role,name`).all()
    .filter(u => canAccessBranch(u, branch_id))
    .map(loginPublic ? publicLoginUser : publicUser);
}

// ---- User management (settings.manage) ----
export function listAllUsers(branch_id = 'br1') {
  return db.prepare(`SELECT * FROM users ORDER BY active DESC, role, name`).all()
    .filter(u => canAccessBranch(u, branch_id))
    .map(u => ({ ...publicUser(u), active: !!u.active, lang: u.lang || 'vi', ...userPermDetails(u) }));
}
function validRole(r) { return ROLES.some(x => x.key === r); }
export function createUser(body, branch_id = 'br1') {
  const username = String(body.username || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const pin = String(body.pin || '').trim();
  const lang = String(body.lang || 'vi').trim();
  const homeBranch = branchExists(body.branch_id) ? String(body.branch_id) : branch_id;
  if (!username || !name) throw new Error('Cáº§n nháº­p tÃªn vÃ  tÃªn Ä‘Äƒng nháº­p');
  if (!/^\d{4}$/.test(pin)) throw new Error('MÃ£ PIN pháº£i Ä‘Ãºng 4 chá»¯ sá»‘');
  if (!validRole(body.role)) throw new Error('Vai trÃ² khÃ´ng há»£p lá»‡');
  if (db.prepare(`SELECT 1 FROM users WHERE username=?`).get(username)) throw new Error('TÃªn Ä‘Äƒng nháº­p Ä‘Ã£ tá»“n táº¡i');
  const id = uid('u_');
  const access = normalizeBranchAccess(body, body.role, homeBranch);
  db.prepare(`INSERT INTO users (id,branch_id,username,name,pin,role,active,lang,branch_access_json) VALUES (?,?,?,?,?,?,1,?,?)`)
    .run(id, homeBranch, username, name, hashPin(pin), body.role, lang, JSON.stringify(access));
  if (Array.isArray(body.perms)) setUserPerms(id, body.perms, homeBranch);
  audit('user.create', { username, role: body.role, branch_id: homeBranch, branch_access: access }, homeBranch);
  const row = db.prepare(`SELECT * FROM users WHERE id=?`).get(id);
  const out = { ...publicUser(row), active: !!row.active, lang: row.lang || 'vi', ...userPermDetails(row) };
  archiveStaff(out);
  return out;
}
export function updateUser(id, body, branch_id = 'br1') {
  const cur = db.prepare(`SELECT * FROM users WHERE id=?`).get(id);
  if (!cur) throw new Error('NgÆ°á»i dÃ¹ng khÃ´ng tá»“n táº¡i');
  const name = body.name !== undefined ? String(body.name).trim() || cur.name : cur.name;
  const role = body.role !== undefined && validRole(body.role) ? body.role : cur.role;
  const lang = body.lang !== undefined ? String(body.lang).trim() || cur.lang || 'vi' : cur.lang || 'vi';
  const homeBranch = body.branch_id !== undefined && branchExists(body.branch_id) ? String(body.branch_id) : (cur.branch_id || branch_id);
  let pin = cur.pin;
  if (body.pin) { if (!/^\d{4}$/.test(String(body.pin))) throw new Error('MÃ£ PIN pháº£i Ä‘Ãºng 4 chá»¯ sá»‘'); pin = hashPin(String(body.pin)); }
  const active = body.active !== undefined ? (body.active ? 1 : 0) : cur.active;
  if (cur.role === 'owner' && role !== 'owner' && db.prepare(`SELECT COUNT(*) n FROM users WHERE role='owner' AND active=1`).get().n <= 1)
    throw new Error('Pháº£i cÃ²n Ã­t nháº¥t má»™t Admin');
  const access = normalizeBranchAccess(body, role, homeBranch);
  db.prepare(`UPDATE users SET name=?, role=?, pin=?, active=?, lang=?, branch_id=?, branch_access_json=? WHERE id=?`).run(name, role, pin, active, lang, homeBranch, JSON.stringify(access), id);
  if (Array.isArray(body.perms)) setUserPerms(id, body.perms, homeBranch);
  else if (role !== cur.role) db.prepare(`DELETE FROM user_perms WHERE user_id=?`).run(id);
  // revoke sessions if deactivated
  if (!active) db.prepare(`DELETE FROM auth_sessions WHERE user_id=?`).run(id);
  audit('user.update', { username: cur.username, role, branch_id: homeBranch, branch_access: access }, homeBranch);
  const row = db.prepare(`SELECT * FROM users WHERE id=?`).get(id);
  const out = { ...publicUser(row), active: !!row.active, lang: row.lang || 'vi', ...userPermDetails(row) };
  archiveStaff(out);
  return out;
}

export function updateOwnLang(user_id, lang, branch_id = 'br1') {
  const clean = lang === 'en' ? 'en' : 'vi';
  const cur = db.prepare(`SELECT * FROM users WHERE id=? AND active=1`).get(user_id);
  if (!cur) throw new Error('NgÆ°á»i dÃ¹ng khÃ´ng tá»“n táº¡i');
  db.prepare(`UPDATE users SET lang=? WHERE id=?`).run(clean, user_id);
  audit('user.lang.update', { username: cur.username, lang: clean }, branch_id, cur.username);
  const row = db.prepare(`SELECT * FROM users WHERE id=?`).get(user_id);
  const out = { ...publicUser(row), active: !!row.active, lang: row.lang || 'vi', ...userPermDetails(row) };
  archiveStaff(out);
  return publicUser(out);
}
export function deleteUser(id, branch_id = 'br1') {
  const cur = db.prepare(`SELECT * FROM users WHERE id=?`).get(id);
  if (!cur) throw new Error('NgÆ°á»i dÃ¹ng khÃ´ng tá»“n táº¡i');
  if (cur.role === 'owner' && db.prepare(`SELECT COUNT(*) n FROM users WHERE role='owner'`).get().n <= 1)
    throw new Error('KhÃ´ng thá»ƒ xÃ³a Admin cuá»‘i cÃ¹ng');
  db.prepare(`DELETE FROM auth_sessions WHERE user_id=?`).run(id);
  db.prepare(`DELETE FROM user_perms WHERE user_id=?`).run(id);
  db.prepare(`DELETE FROM users WHERE id=?`).run(id);
  audit('user.delete', { username: cur.username }, branch_id);
  return { ok: true };
}

function tokenFromReq(req) {
  const h = req.headers['authorization'];
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  return req.headers['x-auth-token'] || null;
}

function publicUser(u) {
  const branch_ids = userBranchIds(u);
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    username: u.username,
    lang: u.lang || 'vi',
    branch_id: u.branch_id || branch_ids[0] || 'br1',
    branch_ids,
    branch_access: parseBranchAccess(u.branch_access_json || u.branch_access || u.branch_ids),
  };
}

// Express middleware factory. Pass a permission string to gate an endpoint.
export function requireAuth(perm) {
  return (req, res, next) => {
    const user = userFor(tokenFromReq(req));
    if (!user) return res.status(401).json({ error: 'Cáº§n Ä‘Äƒng nháº­p' });
    if (perm && !canUser(user, perm)) return res.status(403).json({ error: `KhÃ´ng Ä‘á»§ quyá»n (${perm})` });
    req.user = user;
    next();
  };
}

// Imperative permission check for handlers that need branch + actor in one call
// (dÃ¹ng trong cÃ¡c route DMS). NÃ©m lá»—i cÃ³ status Ä‘á»ƒ wrap() tráº£ Ä‘Ãºng mÃ£ HTTP.
export function requirePermission(req, perm) {
  const user = req.user || userFor(tokenFromReq(req));
  if (!user) { const e = new Error('Cáº§n Ä‘Äƒng nháº­p'); e.status = 401; throw e; }
  if (perm && !canUser(user, perm)) { const e = new Error(`KhÃ´ng Ä‘á»§ quyá»n (${perm})`); e.status = 403; throw e; }
  req.user = user;
  return { branch_id: resolveBranch(req), actor: user, user };
}

// Optional auth: attach req.user when a valid token is present, but never block.
// Lets unguarded routes (POS/iPad) record who acted in the activity log.
export function attachUser() {
  return (req, _res, next) => {
    if (!req.user) req.user = userFor(tokenFromReq(req)) || null;
    next();
  };
}

// NgÆ°á»i phá»¥ trÃ¡ch thao tÃ¡c, dÃ¹ng cho nháº­t kÃ½ hoáº¡t Ä‘á»™ng. Máº·c Ä‘á»‹nh 'system'.
export function actorName(req) {
  return req?.user?.name || req?.user?.username || 'system';
}

