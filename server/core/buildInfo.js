import { readFileSync } from 'node:fs';

const packageVersion = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(pkg.version))
      ? String(pkg.version)
      : 'unknown';
  } catch {
    return 'unknown';
  }
})();

function safeValue(value, pattern) {
  const text = String(value || '').trim();
  return pattern.test(text) ? text : 'unknown';
}

// Public diagnostics only. Strict allow-lists prevent an accidentally reused
// environment variable from leaking arbitrary configuration through /health.
export function buildInfo(schemaVersion) {
  const schema = Number(schemaVersion);
  return {
    version: packageVersion,
    gitCommit: safeValue(process.env.BUILD_GIT_COMMIT, /^(?:[0-9a-f]{40}|unknown)$/),
    sourceTreeSha256: safeValue(process.env.BUILD_SOURCE_SHA256, /^(?:[0-9a-f]{64}|unknown)$/),
    buildTimeUtc: safeValue(
      process.env.BUILD_TIME_UTC,
      /^(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z|unknown)$/,
    ),
    schemaVersion: Number.isInteger(schema) && schema >= 0 ? schema : null,
  };
}
