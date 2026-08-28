// ONLINE-ONLY (quyết định owner 2026-08-26): offline-first Edge/Hub replication
// bị NGƯNG mặc định. Đây là NEGATIVE TEST cho cổng runtime: mặc định phải là
// online-only, và chỉ bật lại edge khi có override tường minh (đường rollback).
//
// KHÔNG drop bảng/dữ liệu — legacy giữ inert. Test này chỉ chốt SEMANTICS của cờ
// runtime + đảm bảo index.js gate startSyncEngine() sau cờ này.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv } from './config/env.js';

const HERE = dirname(fileURLToPath(import.meta.url));

test('mặc định là ONLINE-ONLY: offline-first bị ngưng khi không cấu hình gì', () => {
  assert.equal(loadEnv({}).OFFLINE_DECOMMISSIONED, true);
});

test('override rollback: OFFLINE_DECOMMISSIONED=false bật lại edge runtime', () => {
  assert.equal(loadEnv({ OFFLINE_DECOMMISSIONED: 'false' }).OFFLINE_DECOMMISSIONED, false);
  assert.equal(loadEnv({ OFFLINE_DECOMMISSIONED: '0' }).OFFLINE_DECOMMISSIONED, false);
});

test('giá trị khác "false"/"0" vẫn giữ online-only (fail-safe về online)', () => {
  assert.equal(loadEnv({ OFFLINE_DECOMMISSIONED: 'true' }).OFFLINE_DECOMMISSIONED, true);
  assert.equal(loadEnv({ OFFLINE_DECOMMISSIONED: '1' }).OFFLINE_DECOMMISSIONED, true);
  assert.equal(loadEnv({ OFFLINE_DECOMMISSIONED: 'yes' }).OFFLINE_DECOMMISSIONED, true);
});

test('index.js gate startSyncEngine() SAU cờ OFFLINE_DECOMMISSIONED (không khởi động offline engine mặc định)', () => {
  const src = readFileSync(join(HERE, 'index.js'), 'utf8');
  // startSyncEngine chỉ được gọi trong nhánh else của cờ; không có lời gọi trần.
  assert.match(src, /if \(env\.OFFLINE_DECOMMISSIONED\)[\s\S]*?\} else \{\s*startSyncEngine\(\);/,
    'startSyncEngine() phải nằm sau gate env.OFFLINE_DECOMMISSIONED');
  // startSyncEngine chỉ xuất hiện đúng 1 lần (trong nhánh else của gate).
  assert.equal((src.match(/startSyncEngine\(\)/g) || []).length, 1,
    'startSyncEngine() chỉ được gọi 1 lần, nằm trong gate');
});

test('edge/offline receive routes fail-close (410) khi online-only', () => {
  const src = readFileSync(join(HERE, 'modules', 'sync', 'routes.js'), 'utf8');
  assert.match(src, /if \(env\.OFFLINE_DECOMMISSIONED\)[\s\S]*?status = 410/,
    'guard phải trả 410 GONE khi OFFLINE_DECOMMISSIONED');
  // 4 đường offline phải gọi guard: edge/push, edge/catalogue, offline, now.
  assert.ok((src.match(/assertEdgeRuntimeEnabled\(\)/g) || []).length >= 4,
    'edge push/catalogue + offline toggle + sync now phải fail-close');
});
