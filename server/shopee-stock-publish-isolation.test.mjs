// F-INV-01 ISOLATION GUARD.
//
// F-INV-01: inventory.listSkus() can fail OPEN (show all warehouses) for a valid
// channel that is not yet mapped to any active warehouse. That fail-open path is
// acceptable for the POS catalogue display endpoint, but it must NEVER become the
// source of stock quantities published outbound to Shopee — a fail-open stock feed
// would push wrong quantities to a live marketplace.
//
// Continuation-07 call-graph proof (2026-09-02): F-INV-01 is currently UNREACHABLE
// from Shopee — the connector has no update_stock path and no coupling to inventory
// listSkus/currentStock; listSkus has a single caller (POS /skus display route).
//
// This test locks that invariant: if a future change wires the Shopee connector to
// the fail-open catalogue path (listSkus/channelWarehouseFilter/currentStock) or adds
// an outbound stock-publish without an explicit fail-closed review, it fails here.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const connectorSrc = readFileSync(join(here, 'services', 'shopeeConnector.js'), 'utf8');

test('Shopee connector does not consume the F-INV-01 fail-open catalogue path', () => {
  for (const forbidden of ['listSkus', 'channelWarehouseFilter', 'currentStock']) {
    assert.ok(
      !connectorSrc.includes(forbidden),
      `shopeeConnector.js must not reference ${forbidden} (F-INV-01 fail-open path). ` +
      `If publishing stock to Shopee, derive quantities from a fail-closed source and update this guard deliberately.`,
    );
  }
});

test('Shopee connector has no outbound stock/price publish wired to the fail-open path', () => {
  // update_stock/update_price are documented-but-unimplemented. If added, they MUST NOT
  // import inventory catalogue helpers; this asserts the connector does not import inventory.js.
  assert.ok(
    !/from\s+['"][^'"]*\/inventory\.js['"]/.test(connectorSrc),
    'shopeeConnector.js must not import inventory.js (keeps F-INV-01 fail-open path out of any future stock publish).',
  );
});
