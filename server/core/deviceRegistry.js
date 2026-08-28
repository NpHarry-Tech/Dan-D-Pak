function text(value) {
  return String(value ?? '').trim();
}

/** Merge live app sockets and print-agent heartbeats by stable device id. */
export function buildLiveDeviceRegistry(connections = [], agents = []) {
  const byId = new Map();

  for (const connection of connections) {
    const deviceId = text(connection?.device_id);
    const key = deviceId ? `device:${deviceId}` : `socket:${text(connection?.id)}`;
    const current = byId.get(key) || {
      device_id: deviceId,
      device_name: deviceId || text(connection?.device) || 'unknown',
      kind: text(connection?.device) || 'unknown',
      online: true,
      connections: [],
      printers: [],
    };
    current.connections.push(connection);
    byId.set(key, current);
  }

  for (const agent of agents) {
    const deviceId = text(agent?.device_id);
    if (!deviceId) continue;
    const key = `device:${deviceId}`;
    const current = byId.get(key) || {
      device_id: deviceId,
      device_name: text(agent?.device_name) || deviceId,
      kind: 'print-agent',
      online: true,
      connections: [],
      printers: [],
    };
    current.device_name = text(agent?.device_name) || current.device_name;
    current.agent_version = text(agent?.agent_version);
    current.capabilities = Array.isArray(agent?.capabilities) ? agent.capabilities : [];
    current.last_seen_at = agent?.last_seen_at || null;
    current.printers = Array.isArray(agent?.printers) ? agent.printers : [];
    byId.set(key, current);
  }

  return [...byId.values()].sort((a, b) =>
    String(a.device_name).localeCompare(String(b.device_name)));
}
