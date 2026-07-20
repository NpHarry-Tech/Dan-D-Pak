import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { safeEqual } from './core/util.js';

test('webhook secrets use timing-safe comparison and document uploads deduplicate by content', () => {
  assert.equal(safeEqual('same-secret', 'same-secret'), true);
  assert.equal(safeEqual('same-secret', 'wrong-secret'), false);

  const payments = fs.readFileSync(new URL('./services/payments.js', import.meta.url), 'utf8');
  for (const secret of ['cfg.apiKey', 'cfg.webhookSecret', 'cfg.username']) {
    assert.match(payments, new RegExp(`safeEqual\\([^\\n]+${secret.replace('.', '\\.')}`));
  }

  const documents = fs.readFileSync(new URL('./modules/documents/routes.js', import.meta.url), 'utf8');
  assert.match(documents, /createHash\('sha256'\)/);
  assert.match(documents, /content_hash=\?/);
});
