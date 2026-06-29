import { env, publicEnvSnapshot } from './env.js';
import { assertKnownProviders } from './providers.js';
import { runtimePaths } from './paths.js';

export function runtimeSnapshot() {
  return {
    ...publicEnvSnapshot(),
    activeAppDataDirConfigured: !!runtimePaths.appDataDir,
    providerIssues: assertKnownProviders(env),
    startedAt: globalThis.__DANDPAK_STARTED_AT || null,
  };
}
