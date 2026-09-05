import assert from 'node:assert/strict';
import test from 'node:test';
import { hasImageSignature, requireImageSignature } from './core/imageValidation.js';

const samples = {
  'image/jpeg': Buffer.from('ffd8ffe000104a464946', 'hex'),
  'image/png': Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
  'image/webp': Buffer.from('524946460400000057454250', 'hex'),
  'image/gif': Buffer.from('4749463839610100', 'hex'),
};

test('accepted upload MIME types require matching binary magic', () => {
  for (const [mime, bytes] of Object.entries(samples)) {
    assert.equal(hasImageSignature(bytes, mime), true, mime);
    assert.doesNotThrow(() => requireImageSignature(bytes, mime));
  }
});

test('HTML disguised as an image and cross-MIME payloads fail closed', () => {
  const html = Buffer.from('<script>alert(1)</script>');
  for (const mime of Object.keys(samples)) {
    assert.throws(() => requireImageSignature(html, mime), (error) =>
      error.status === 400 && error.code === 'IMAGE_SIGNATURE_MISMATCH');
  }
  assert.throws(() => requireImageSignature(samples['image/png'], 'image/jpeg'));
});
