import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const compose = fs.readFileSync('deploy/store-edge/docker-compose.yml', 'utf8');
const example = fs.readFileSync('deploy/store-edge/.env.example', 'utf8');

test('Store Edge deployment is durable and never seeds demo data', () => {
  assert.match(compose, /DEPLOYMENT_TARGET:\s*store-edge/);
  assert.match(compose, /DISABLE_DEMO_SEED:\s*"true"/);
  for (const volume of [
    'edge_sqlite', 'edge_storage', 'edge_permanent', 'edge_uploads',
    'edge_product_images', 'edge_backups',
  ]) assert.match(compose, new RegExp(`${volume}:`));
  assert.match(compose, /restart:\s*unless-stopped/);
  assert.match(compose, /healthcheck:/);
});

test('Store Edge example is sender-only and requires explicit identities', () => {
  assert.match(example, /^EDGE_HUB_ID=.+$/m);
  assert.match(example, /^EDGE_SYNC_UPSTREAM_URL=https:\/\//m);
  assert.match(example, /^EDGE_SYNC_SHARED_SECRET=THAY_/m);
  assert.match(example, /^DATA_ENCRYPTION_KEY=THAY_/m);
  assert.match(example, /^EDGE_SYNC_ALLOWED_HUBS_JSON=$/m);
  assert.match(example, /^DISABLE_DEMO_SEED=true$/m);
});
