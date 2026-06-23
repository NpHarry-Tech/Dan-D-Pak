import { publicEnvSnapshot } from './env.js';

export const PROVIDERS = Object.freeze({
  database: ['sqlite', 'postgres'],
  realtime: ['websocket', 'socketio'],
  storage: ['local', 's3'],
  deploymentTarget: ['local', 'vps'],
});

export function providerSummary() {
  return publicEnvSnapshot().providers;
}

export function assertKnownProviders(env) {
  const issues = [];
  if (!PROVIDERS.database.includes(env.DATABASE_PROVIDER)) issues.push(`Unknown DATABASE_PROVIDER: ${env.DATABASE_PROVIDER}`);
  if (!PROVIDERS.realtime.includes(env.REALTIME_PROVIDER)) issues.push(`Unknown REALTIME_PROVIDER: ${env.REALTIME_PROVIDER}`);
  if (!PROVIDERS.storage.includes(env.STORAGE_PROVIDER)) issues.push(`Unknown STORAGE_PROVIDER: ${env.STORAGE_PROVIDER}`);
  if (!PROVIDERS.deploymentTarget.includes(env.DEPLOYMENT_TARGET)) issues.push(`Unknown DEPLOYMENT_TARGET: ${env.DEPLOYMENT_TARGET}`);
  return issues;
}
