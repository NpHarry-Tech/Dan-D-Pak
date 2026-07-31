// Máy in do Hardware Agent báo lên phải nhớ THEO TỪNG MÁY.
//
// Sự cố thật: server lưu Map(branch -> data) nên mỗi máy chạy agent ghi đè lên
// nhau sau mỗi 20 giây. Máy quầy báo "POS-80C", 20 giây sau máy văn phòng báo 3
// máy in ảo của Microsoft là danh sách kia biến mất — thu ngân mở ô "Máy in hệ
// điều hành" chỉ thấy OneNote/XPS/Print to PDF, tưởng Windows không nhận máy in
// nhiệt cắm USB.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'dandpak-agentprn-'));
process.env.SQLITE_PATH = join(temp, 'store.db');
process.env.STORAGE_PATH = join(temp, 'storage');
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { migrate } = await import('./db.js');
const System = await import('./services/system.js');

migrate();

const mayQuay = [{ Name: 'POS-80C', DriverName: 'POS-80C', PortName: 'USB001' }];
const mayVanPhong = [
  { Name: 'Microsoft Print to PDF', PortName: 'PORTPROMPT:' },
  { Name: 'Send To OneNote 16', PortName: 'nul:' },
];

test('hai máy báo cáo thì KHÔNG máy nào xoá máy in của máy kia', () => {
  System.setAgentPrinters('sala', mayQuay, { deviceId: 'dev_quay', deviceName: 'POS-QUAY' });
  System.setAgentPrinters('sala', mayVanPhong, { deviceId: 'dev_vp', deviceName: 'MAY-VAN-PHONG' });

  const ten = System.getAgentPrinters('sala').map(p => p.name);
  assert.ok(ten.includes('POS-80C'), 'máy in nhiệt ở quầy phải còn trong danh sách');
  assert.ok(ten.includes('Microsoft Print to PDF'));
  assert.equal(ten.length, 3);
});

test('mỗi máy in nói rõ đang cắm ở MÁY NÀO', () => {
  const pos80 = System.getAgentPrinters('sala').find(p => p.name === 'POS-80C');
  assert.equal(pos80.device_id, 'dev_quay');
  assert.equal(pos80.device_name, 'POS-QUAY');
});

test('danh sách nhóm theo máy để màn Kết nối hiển thị', () => {
  const devices = System.getAgentDevices('sala');
  assert.equal(devices.length, 2);
  const quay = devices.find(d => d.device_id === 'dev_quay');
  assert.equal(quay.device_name, 'POS-QUAY');
  assert.equal(quay.printers.length, 1);
  assert.ok(quay.last_seen_at, 'phải có mốc thời gian để biết máy còn sống');
});

test('báo cáo mới của CÙNG một máy thì thay danh sách của chính nó', () => {
  System.setAgentPrinters('sala', [{ Name: 'POS-80C' }, { Name: 'May in tem' }],
    { deviceId: 'dev_quay', deviceName: 'POS-QUAY' });

  const quay = System.getAgentDevices('sala').find(d => d.device_id === 'dev_quay');
  assert.equal(quay.printers.length, 2, 'máy quầy giờ có 2 máy in');
  // Máy kia không bị ảnh hưởng.
  assert.equal(
    System.getAgentDevices('sala').find(d => d.device_id === 'dev_vp').printers.length, 2);
});

test('agent bản cũ chưa gửi định danh vẫn chạy được', () => {
  System.setAgentPrinters('br2', [{ Name: 'May in cu' }]);
  const ten = System.getAgentPrinters('br2').map(p => p.name);
  assert.deepEqual(ten, ['May in cu']);
});
