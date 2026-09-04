import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-review-env-gate-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.NODE_ENV = 'development';
delete process.env.APP_ENV;
delete process.env.SHOPEE_REVIEWER_PIN;

const { db, migrate } = await import('./db.js');
const { seedShopeeReview } = await import('./db/reviewSeed.js');
migrate();

test('non-review APP_ENV does not seed the Shopee reviewer role or account', () => {
  assert.throws(() => seedShopeeReview(), /APP_ENV=review/);
  assert.equal(db.prepare(
    `SELECT COUNT(*) n FROM role_perms WHERE role='shopee_reviewer'`).get().n, 0);
  assert.equal(db.prepare(
    `SELECT COUNT(*) n FROM users WHERE username='shopee-reviewer'`).get().n, 0);
});

test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
