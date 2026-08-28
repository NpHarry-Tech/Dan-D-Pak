import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInfo } from './buildInfo.js';

test('public build fingerprint exposes only validated immutable metadata', () => {
  const previous = {
    commit: process.env.BUILD_GIT_COMMIT,
    source: process.env.BUILD_SOURCE_SHA256,
    time: process.env.BUILD_TIME_UTC,
  };
  try {
    process.env.BUILD_GIT_COMMIT = 'a'.repeat(40);
    process.env.BUILD_SOURCE_SHA256 = 'b'.repeat(64);
    process.env.BUILD_TIME_UTC = '2026-08-09T06:30:00.000Z';
    assert.deepEqual(buildInfo(5), {
      version: '0.1.0',
      gitCommit: 'a'.repeat(40),
      sourceTreeSha256: 'b'.repeat(64),
      buildTimeUtc: '2026-08-09T06:30:00.000Z',
      schemaVersion: 5,
    });

    process.env.BUILD_GIT_COMMIT = 'secret-looking arbitrary value';
    process.env.BUILD_SOURCE_SHA256 = 'not-a-hash';
    process.env.BUILD_TIME_UTC = 'not-a-time';
    const rejected = buildInfo('invalid');
    assert.equal(rejected.gitCommit, 'unknown');
    assert.equal(rejected.sourceTreeSha256, 'unknown');
    assert.equal(rejected.buildTimeUtc, 'unknown');
    assert.equal(rejected.schemaVersion, null);
  } finally {
    if (previous.commit === undefined) delete process.env.BUILD_GIT_COMMIT;
    else process.env.BUILD_GIT_COMMIT = previous.commit;
    if (previous.source === undefined) delete process.env.BUILD_SOURCE_SHA256;
    else process.env.BUILD_SOURCE_SHA256 = previous.source;
    if (previous.time === undefined) delete process.env.BUILD_TIME_UTC;
    else process.env.BUILD_TIME_UTC = previous.time;
  }
});
