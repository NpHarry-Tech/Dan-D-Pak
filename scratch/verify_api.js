import { getIntegrations } from '../server/services/settings.js';

try {
  const cfg = getIntegrations('br1');
  console.log("Current integrations settings:");
  console.log(JSON.stringify(cfg, null, 2));

  // Assertions
  const channels = cfg.channels;
  let allClean = true;
  for (const [name, channel] of Object.entries(channels)) {
    if (channel.enabled !== false) {
      console.error(`FAIL: channel ${name} is enabled!`);
      allClean = false;
    }
    if (channel.environment !== 'production') {
      console.error(`FAIL: channel ${name} has environment ${channel.environment} (expected 'production')!`);
      allClean = false;
    }
  }

  if (allClean) {
    console.log("SUCCESS: All channel connections are disabled and environment is forced to production!");
  } else {
    process.exit(1);
  }
} catch (e) {
  console.error("Verification failed:", e);
  process.exit(1);
}
