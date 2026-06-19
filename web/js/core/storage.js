// Enterprise Storage Manager — DanDPak
//
// Phân tầng lưu trữ:
//   system           → cấu hình toàn hệ thống (owner)
//   branch.{id}      → cài đặt theo chi nhánh
//   user.{id}        → preferences cá nhân hóa
//
// Chiến lược: local-first (localStorage cache) + async sync với backend.
// Namespace localStorage: "ddp.{scope}.{scopeId}.{key}"

import { apiRequest } from './apiClient.js';

const NS = 'ddp';

// ── Key helpers ──────────────────────────────────────────────────────────────

function lsKey(scope, scopeId, key) {
  const sid = scopeId ? `.${scopeId}` : '';
  return `${NS}.${scope}${sid}.${key}`;
}

// ── Core local read/write ────────────────────────────────────────────────────

export function localGet(scope, scopeId, key, fallback = null) {
  try {
    const raw = localStorage.getItem(lsKey(scope, scopeId, key));
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function localSet(scope, scopeId, key, value) {
  try {
    localStorage.setItem(lsKey(scope, scopeId, key), JSON.stringify(value));
  } catch {}
}

export function localRemove(scope, scopeId, key) {
  localStorage.removeItem(lsKey(scope, scopeId, key));
}

export function localKeys(scope, scopeId) {
  const prefix = lsKey(scope, scopeId, '');
  return Object.keys(localStorage)
    .filter(k => k.startsWith(prefix))
    .map(k => k.slice(prefix.length));
}

export function localClearScope(scope, scopeId) {
  const prefix = lsKey(scope, scopeId, '');
  Object.keys(localStorage)
    .filter(k => k.startsWith(prefix))
    .forEach(k => localStorage.removeItem(k));
}

// ── Remote API helpers ───────────────────────────────────────────────────────

function getToken() {
  return localStorage.getItem('auth_token') || '';
}

function getBranchId() {
  return localStorage.getItem('active_branch_id') || 'br1';
}

async function remoteGet(endpoint) {
  return apiRequest(endpoint, {
    token: getToken(),
    headers: { 'x-branch-id': getBranchId() },
    cache: 'no-store',
  });
}

async function remotePut(endpoint, value) {
  return apiRequest(endpoint, {
    method: 'PUT',
    token: getToken(),
    headers: { 'x-branch-id': getBranchId() },
    body: { value },
  });
}

async function remotePost(endpoint, body) {
  return apiRequest(endpoint, {
    method: 'POST',
    token: getToken(),
    headers: { 'x-branch-id': getBranchId() },
    body,
  });
}

async function remoteDelete(endpoint) {
  return apiRequest(endpoint, {
    method: 'DELETE',
    token: getToken(),
    headers: { 'x-branch-id': getBranchId() },
  });
}

// ── System storage (toàn hệ thống) ──────────────────────────────────────────

export const systemStorage = {
  get(key, fallback = null) {
    return localGet('system', '', key, fallback);
  },
  set(key, value) {
    localSet('system', '', key, value);
  },
  async load(key) {
    try {
      const r = await remoteGet(`/storage/system/${encodeURIComponent(key)}`);
      if (r?.value !== undefined) {
        localSet('system', '', key, r.value);
        return r.value;
      }
    } catch {}
    return localGet('system', '', key);
  },
  async save(key, value) {
    localSet('system', '', key, value);
    try { await remotePut(`/storage/system/${encodeURIComponent(key)}`, value); } catch {}
    return value;
  },
  async loadAll() {
    try {
      const snapshot = await remoteGet('/storage/system');
      for (const [k, entry] of Object.entries(snapshot || {})) {
        localSet('system', '', k, entry.value);
      }
      return snapshot;
    } catch {}
    return null;
  },
};

// ── Branch storage (theo chi nhánh) ─────────────────────────────────────────

export const branchStorage = {
  get(branchId, key, fallback = null) {
    return localGet('branch', branchId, key, fallback);
  },
  set(branchId, key, value) {
    localSet('branch', branchId, key, value);
  },
  async load(branchId, key) {
    try {
      const r = await remoteGet(`/storage/branch/${encodeURIComponent(key)}`);
      if (r?.value !== undefined) {
        localSet('branch', branchId, key, r.value);
        return r.value;
      }
    } catch {}
    return localGet('branch', branchId, key);
  },
  async save(branchId, key, value) {
    localSet('branch', branchId, key, value);
    try { await remotePut(`/storage/branch/${encodeURIComponent(key)}`, value); } catch {}
    return value;
  },
  async loadAll(branchId) {
    try {
      const snapshot = await remoteGet('/storage/branch');
      for (const [k, entry] of Object.entries(snapshot || {})) {
        localSet('branch', branchId, k, entry.value);
      }
      return snapshot;
    } catch {}
    return null;
  },
};

// ── User preferences (cá nhân hóa theo từng người dùng) ─────────────────────

export const userStorage = {
  get(userId, key, fallback = null) {
    return localGet('user', userId, key, fallback);
  },
  set(userId, key, value) {
    localSet('user', userId, key, value);
  },
  async load(userId, key) {
    try {
      const r = await remoteGet(`/storage/user/preferences/${encodeURIComponent(key)}`);
      if (r?.value !== undefined) {
        localSet('user', userId, key, r.value);
        return r.value;
      }
    } catch {}
    return localGet('user', userId, key);
  },
  async save(userId, key, value) {
    localSet('user', userId, key, value);
    try { await remotePut(`/storage/user/preferences/${encodeURIComponent(key)}`, value); } catch {}
    return value;
  },
  async saveMany(userId, prefs) {
    for (const [k, v] of Object.entries(prefs)) localSet('user', userId, k, v);
    try { await remotePost('/storage/user/preferences', prefs); } catch {}
    return prefs;
  },
  async loadAll(userId) {
    try {
      const prefs = await remoteGet('/storage/user/preferences');
      for (const [k, v] of Object.entries(prefs || {})) {
        localSet('user', userId, k, v);
      }
      return prefs;
    } catch {}
    return null;
  },
  async delete(userId, key) {
    localRemove('user', userId, key);
    try { await remoteDelete(`/storage/user/preferences/${encodeURIComponent(key)}`); } catch {}
  },
};

// ── Legacy compatibility ─────────────────────────────────────────────────────
// Các key cũ trực tiếp trong localStorage (không có namespace) vẫn hoạt động.
// Dùng khi cần đọc auth/branch state.

export function readJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── StorageManager: unified API ──────────────────────────────────────────────
// Cú pháp ngắn gọn, dễ dùng trong toàn bộ frontend.

export const StorageManager = {
  // System-wide config (owner-only writes)
  system: systemStorage,

  // Per-branch settings
  branch: branchStorage,

  // Per-user personal preferences
  user: userStorage,

  // Quick helpers (sync only, no API call)
  getSystemPref: (key, fallback) => systemStorage.get(key, fallback),
  getBranchPref: (branchId, key, fallback) => branchStorage.get(branchId, key, fallback),
  getUserPref: (userId, key, fallback) => userStorage.get(userId, key, fallback),

  setSystemPref: (key, value) => systemStorage.set(key, value),
  setBranchPref: (branchId, key, value) => branchStorage.set(branchId, key, value),
  setUserPref: (userId, key, value) => userStorage.set(userId, key, value),
};

export default StorageManager;
