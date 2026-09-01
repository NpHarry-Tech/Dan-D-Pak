import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveDeviceRegistry } from './deviceRegistry.js';

test('merges app socket and print agent with the same stable device id', () => {
  const devices = buildLiveDeviceRegistry([
    { id: 'socket-1', device_id: 'pos-01', device: 'pos', user_name: 'Cashier' },
  ], [
    { device_id: 'pos-01', device_name: 'Quay 1', agent_version: '2.0',
      capabilities: ['print'], printers: [{ name: 'POS-80' }], last_seen_at: '2026-08-09T00:00:00Z' },
  ]);

  assert.equal(devices.length, 1);
  assert.equal(devices[0].device_id, 'pos-01');
  assert.equal(devices[0].device_name, 'Quay 1');
  assert.equal(devices[0].connections.length, 1);
  assert.deepEqual(devices[0].printers, [{ name: 'POS-80' }]);
});

test('keeps unidentified live sockets separate and ignores unidentified agents', () => {
  const devices = buildLiveDeviceRegistry([
    { id: 'a', device: 'ipad' },
    { id: 'b', device: 'ipad' },
  ], [{ device_id: '', device_name: 'invalid' }]);

  assert.equal(devices.length, 2);
  assert.ok(devices.every((device) => device.device_id === ''));
  assert.ok(devices.every((device) => device.connections.length === 1));
});
