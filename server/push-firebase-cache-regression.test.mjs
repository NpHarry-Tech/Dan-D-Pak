import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('server/services/push.js', 'utf8');

test('Firebase initialization failure is scoped to one credential fingerprint', () => {
  assert.doesNotMatch(source, /let\s+_initFailed\s*=/);
  assert.match(source, /credentialFingerprint\(serviceAccount\)/);
  assert.match(source, /_failedCredentials\.has\(fingerprint\)/);
  assert.match(source, /_failedCredentials\.add\(fingerprint\)/);
});

test('Firebase apps are isolated and reused by credential identity', () => {
  assert.match(source, /_appsByCredential\.get\(fingerprint\)/);
  assert.match(source, /initializeApp\([\s\S]*?,\s*appName\)/);
  assert.match(source, /_appsByCredential\.set\(fingerprint, app\)/);
  assert.doesNotMatch(source, /admin\.default\.app\(\)/);
});
