import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-einv-compact-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.NODE_ENV = 'test';

// The service imports the DB layer, so point it at a disposable DB even though
// this test exercises only the pure compactor.
const { compactInvoiceSnapshot } = await import('./services/einvoice.js');

test('e-invoice snapshot never persists base64 product images', () => {
  const huge = `data:image/png;base64,${'A'.repeat(2_000_000)}`;
  const input = {
    items: [
      { sku_id: 'sku_1', name: 'Pistachio', image: huge, image_url: huge, price: 200000 },
      { sku_id: 'sku_2', nested: { thumbnail: huge }, source_url: 'https://cdn.example/item.png' },
    ],
  };
  const out = compactInvoiceSnapshot(input);
  const encoded = JSON.stringify(out);
  assert.ok(encoded.length < 500);
  assert.equal(out.items[0].image, undefined);
  assert.equal(out.items[0].image_url, undefined);
  assert.equal(out.items[1].nested.thumbnail, undefined);
  assert.equal(out.items[1].source_url, 'https://cdn.example/item.png');
  assert.equal(out.items[0].price, 200000);
});
