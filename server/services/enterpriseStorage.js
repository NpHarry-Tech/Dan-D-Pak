// Enterprise Storage Service
// Toàn diện, phân tầng theo scope: system | branch | user
// Dữ liệu được lưu trong SQLite (đọc nhanh) và file backup (audit trail).

import { db, now } from '../db.js';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORAGE_ROOT = join(__dirname, '..', 'enterprise-storage');

// ── Scopes ──────────────────────────────────────────────────────────────────
// 'system'  → toàn hệ thống (scope_id = '')
// 'branch'  → theo chi nhánh (scope_id = branch_id)
// 'user'    → cá nhân hóa (scope_id = user_id)
const VALID_SCOPES = ['system', 'branch', 'user'];

function validateScope(scope) {
  if (!VALID_SCOPES.includes(scope)) throw Object.assign(new Error(`Scope không hợp lệ: ${scope}`), { status: 400 });
}

function safeScopeId(scope, scopeId) {
  if (scope === 'system') return '';
  if (!scopeId) throw Object.assign(new Error('scope_id bắt buộc cho scope ' + scope), { status: 400 });
  return String(scopeId).trim();
}

function safeKey(key) {
  if (!key || typeof key !== 'string') throw Object.assign(new Error('Key không hợp lệ'), { status: 400 });
  const k = key.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  if (k.length < 1 || k.length > 200) throw Object.assign(new Error('Key phải từ 1-200 ký tự'), { status: 400 });
  return k;
}

// ── Backup file helpers ──────────────────────────────────────────────────────
function backupDir(scope, scopeId) {
  if (scope === 'system') return join(STORAGE_ROOT, 'system');
  if (scope === 'branch') return join(STORAGE_ROOT, 'branches', scopeId);
  return join(STORAGE_ROOT, 'users', scopeId);
}

function writeBackup(scope, scopeId, key, value) {
  try {
    const dir = backupDir(scope, scopeId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, key + '.json'), JSON.stringify(value, null, 2), 'utf-8');
  } catch {}
}

// ── Core CRUD ────────────────────────────────────────────────────────────────
export function getStorageValue(scope, scopeId, key) {
  validateScope(scope);
  const sid = safeScopeId(scope, scopeId);
  const k = safeKey(key);
  const row = db.prepare(`SELECT value FROM enterprise_storage WHERE scope=? AND scope_id=? AND key=?`).get(scope, sid, k);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setStorageValue(scope, scopeId, key, value, updatedBy = 'system') {
  validateScope(scope);
  const sid = safeScopeId(scope, scopeId);
  const k = safeKey(key);
  const serialized = JSON.stringify(value);
  const ts = now();
  db.prepare(`
    INSERT INTO enterprise_storage (scope, scope_id, key, value, updated_at, updated_by)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(scope, scope_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
  `).run(scope, sid, k, serialized, ts, updatedBy);
  writeBackup(scope, sid || 'system', k, value);
  return { scope, scope_id: sid, key: k, updated_at: ts };
}

export function deleteStorageValue(scope, scopeId, key) {
  validateScope(scope);
  const sid = safeScopeId(scope, scopeId);
  const k = safeKey(key);
  db.prepare(`DELETE FROM enterprise_storage WHERE scope=? AND scope_id=? AND key=?`).run(scope, sid, k);
  return { ok: true };
}

export function listScopeKeys(scope, scopeId) {
  validateScope(scope);
  const sid = safeScopeId(scope, scopeId);
  return db.prepare(`SELECT key, updated_at, updated_by FROM enterprise_storage WHERE scope=? AND scope_id=? ORDER BY key`).all(scope, sid);
}

export function getScopeSnapshot(scope, scopeId) {
  validateScope(scope);
  const sid = safeScopeId(scope, scopeId);
  const rows = db.prepare(`SELECT key, value, updated_at, updated_by FROM enterprise_storage WHERE scope=? AND scope_id=? ORDER BY key`).all(scope, sid);
  const result = {};
  for (const r of rows) {
    try { result[r.key] = { value: JSON.parse(r.value), updated_at: r.updated_at, updated_by: r.updated_by }; }
    catch { result[r.key] = { value: r.value, updated_at: r.updated_at, updated_by: r.updated_by }; }
  }
  return result;
}

// ── User Preferences (personal settings) ────────────────────────────────────
export function getUserPref(userId, key) {
  const k = safeKey(key);
  const row = db.prepare(`SELECT value FROM user_preferences WHERE user_id=? AND key=?`).get(userId, k);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setUserPref(userId, key, value) {
  const k = safeKey(key);
  const serialized = JSON.stringify(value);
  const ts = now();
  db.prepare(`
    INSERT INTO user_preferences (user_id, key, value, updated_at)
    VALUES (?,?,?,?)
    ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(userId, k, serialized, ts);
  writeBackup('user', userId, k, value);
  return { key: k, updated_at: ts };
}

export function deleteUserPref(userId, key) {
  const k = safeKey(key);
  db.prepare(`DELETE FROM user_preferences WHERE user_id=? AND key=?`).run(userId, k);
  return { ok: true };
}

export function getAllUserPrefs(userId) {
  const rows = db.prepare(`SELECT key, value, updated_at FROM user_preferences WHERE user_id=? ORDER BY key`).all(userId);
  const result = {};
  for (const r of rows) {
    try { result[r.key] = JSON.parse(r.value); } catch { result[r.key] = r.value; }
  }
  return result;
}

export function setManyUserPrefs(userId, prefs = {}) {
  const ts = now();
  const stmt = db.prepare(`
    INSERT INTO user_preferences (user_id, key, value, updated_at)
    VALUES (?,?,?,?)
    ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `);
  const saved = [];
  for (const [rawKey, value] of Object.entries(prefs)) {
    try {
      const k = safeKey(rawKey);
      stmt.run(userId, k, JSON.stringify(value), ts);
      saved.push(k);
    } catch {}
  }
  writeBackup('user', userId, '_preferences_snapshot', prefs);
  return { saved, updated_at: ts };
}

// ── Bootstrap directory structure ────────────────────────────────────────────
export function ensureStorageDirectories() {
  const dirs = [
    join(STORAGE_ROOT, 'system'),
    join(STORAGE_ROOT, 'branches'),
    join(STORAGE_ROOT, 'users'),
  ];
  for (const d of dirs) mkdirSync(d, { recursive: true });
}
