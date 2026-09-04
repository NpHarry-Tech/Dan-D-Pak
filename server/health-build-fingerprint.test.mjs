import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function waitForHealth(url, child) {
  // A cold Windows CI runner may spend >8s loading native SQLite while other
  // Flutter/server suites are compiling. Readiness is the invariant; a tiny
  // machine being busy is not a product failure.
  for (let attempt = 0; attempt < 900; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`isolated server exited ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('isolated health endpoint did not become ready');
}

test('health reports the running image fingerprint and actual DB schema', { timeout: 150_000 }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'ddp-health-fingerprint-'));
  const port = 32_000 + Math.floor(Math.random() * 1_000);
  const commit = 'a'.repeat(40);
  const source = 'b'.repeat(64);
  const builtAt = '2026-08-09T06:30:00.000Z';
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      SQLITE_PATH: join(temp, 'store.db'),
      STORAGE_PATH: join(temp, 'storage'),
      // Fingerprint chỉ cần server BOOT + /health báo schema/build; KHÔNG cần
      // demo seed (empty-DB seed mất ~60-75s trên máy nguội → readiness timeout
      // giả). migrate() vẫn chạy nên schema_version vẫn đúng.
      DISABLE_DEMO_SEED: '1',
      BUILD_GIT_COMMIT: commit,
      BUILD_SOURCE_SHA256: source,
      BUILD_TIME_UTC: builtAt,
    },
  });
  try {
    const health = await waitForHealth(`http://127.0.0.1:${port}/health`, child);
    assert.equal(health.ok, true);
    assert.deepEqual(health.build, {
      version: '0.1.0',
      gitCommit: commit,
      sourceTreeSha256: source,
      buildTimeUtc: builtAt,
      schemaVersion: 8,
    });
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
    rmSync(temp, { recursive: true, force: true });
  }
});
