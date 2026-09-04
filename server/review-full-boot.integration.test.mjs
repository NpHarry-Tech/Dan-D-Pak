// §14 FULL STARTUP INTEGRATION — boot CHÍNH `node server/index.js` (đúng path
// production dùng), APP_ENV=review, DB hoàn toàn mới; rồi assert trạng thái DB.
// Đây là test bắt được bug runtime mà unit test (gọi thẳng reviewSeed) bỏ sót.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';

import { spawnSync } from 'node:child_process';
const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SERVER_DIR, '..');
const DBP = resolve(REPO_ROOT, 'runtime/server-data/__review_fullboot_test.db');
// Port cao, ngẫu nhiên theo giờ để tránh đụng process bootcũ còn giữ cổng.
const PORT = 39000 + (Date.now() % 2000);

function clean() {
  for (const s of ['', '-wal', '-shm']) if (existsSync(DBP + s)) { try { rmSync(DBP + s); } catch {} }
}
function killTree(pid) {
  // child.kill KHÔNG diệt cả cây tiến trình (node spawn worker) trên Windows →
  // dùng taskkill /T /F; *nix dùng SIGKILL.
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);
    else process.kill(pid, 'SIGKILL');
  } catch { /* đã chết */ }
}
function waitHealth(ms) {
  const deadline = Date.now() + ms;
  return new Promise((res) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health', timeout: 1500 }, (r) => {
        r.resume();
        if (r.statusCode && r.statusCode < 500) return res(true);
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => { if (Date.now() > deadline) return res(false); setTimeout(tick, 500); };
    tick();
  });
}

test('FULL BOOT review: node index.js trên DB mới → chỉ Shopee Review Store + shopee-reviewer', async () => {
  clean();
  const child = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      APP_ENV: 'review',
      NODE_ENV: 'development',        // isReview độc lập NODE_ENV; tránh yêu cầu khoá mã hoá
      DEPLOYMENT_TARGET: 'local',     // tránh guard canonical /app/server-data/review.db
      DISABLE_DEMO_SEED: 'false',     // như .env review thật
      ALLOW_PRODUCTION_DATA: 'false',
      SHOPEE_REVIEWER_PIN: '8421',
      SQLITE_PATH: DBP,
      PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => { out += d.toString(); });
  child.stderr.on('data', d => { out += d.toString(); });

  const healthy = await waitHealth(45000);
  killTree(child.pid);
  await new Promise(r => setTimeout(r, 1200)); // nhả file lock

  assert.ok(healthy, `server review không healthy trong 30s. Log:\n${out.slice(-2000)}`);

  const db = new DatabaseSync(DBP, { readOnly: true });
  try {
    const branches = db.prepare('SELECT id,name FROM branches').all();
    const users = db.prepare('SELECT username,active,branch_id,branch_access_json FROM users').all();
    const reviewerPerms = db.prepare(
      `SELECT perm FROM role_perms WHERE role='shopee_reviewer' ORDER BY perm`).all().map(r => r.perm);
    const warehouses = db.prepare('SELECT COUNT(*) n FROM warehouses').get().n;
    const tables = db.prepare('SELECT COUNT(*) n FROM tables').get().n;

    assert.equal(branches.length, 1, `branches phải =1, thực tế: ${JSON.stringify(branches)}`);
    assert.equal(branches[0].id, 'review', `branch id phải =review (§2): ${JSON.stringify(branches)}`);
    assert.equal(branches[0].name, 'Shopee Review Store', `branch name sai: ${JSON.stringify(branches)}`);
    assert.equal(users.length, 1, `users phải =1 (shopee-reviewer), thực tế: ${JSON.stringify(users)}`);
    assert.equal(users[0].username, 'shopee-reviewer');
    assert.equal(users[0].branch_id, 'review');
    assert.equal(users[0].branch_access_json, '["review"]');
    assert.deepEqual(reviewerPerms, [
      'marketplace.connect',
      'module.online',
      'online.order.manage',
      'online.product_mapping',
    ]);
    assert.equal(warehouses, 0, `warehouses phải =0, thực tế ${warehouses}`);
    assert.equal(tables, 0, `tables phải =0, thực tế ${tables}`);
  } finally {
    db.close();
    clean();
  }
});
