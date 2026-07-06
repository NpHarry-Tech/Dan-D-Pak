import { env, publicEnvSnapshot } from './env.js';
import { assertKnownProviders } from './providers.js';

export function runtimeSnapshot() {
  return {
    ...publicEnvSnapshot(),
    providerIssues: assertKnownProviders(env),
    startedAt: globalThis.__DANDPAK_STARTED_AT || null,
  };
}
