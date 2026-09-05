import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { immutableUploadStaticOptions, bundledAssetStaticOptions } from './core/staticAssets.js';

test('unique uploads cache immutably and revalidate by ETag', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dandpak-assets-'));
  fs.writeFileSync(path.join(temp, 'asset_hash_abc.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  const app = express();
  app.use('/uploads', express.static(temp, immutableUploadStaticOptions));
  app.use('/assets', express.static(temp, bundledAssetStaticOptions));
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const upload = await fetch(`http://127.0.0.1:${port}/uploads/asset_hash_abc.png`);
    assert.equal(upload.status, 200);
    assert.match(upload.headers.get('cache-control'), /public, max-age=31536000, immutable/);
    assert.equal(upload.headers.get('x-content-type-options'), 'nosniff');
    const etag = upload.headers.get('etag');
    assert.ok(etag);
    const unchangedStatus = await new Promise((resolve, reject) => {
      const req = http.get({
        host: '127.0.0.1', port, path: '/uploads/asset_hash_abc.png',
        headers: { 'if-none-match': etag },
      }, (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode));
      });
      req.once('error', reject);
    });
    assert.equal(unchangedStatus, 304);

    const bundled = await fetch(`http://127.0.0.1:${port}/assets/asset_hash_abc.png`);
    assert.equal(bundled.headers.get('cache-control'), 'public, max-age=3600, must-revalidate');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
