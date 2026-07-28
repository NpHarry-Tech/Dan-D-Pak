// Cấu hình ÂM BÁO & ĐỊNH TUYẾN THÔNG BÁO — màn "Cài đặt → Cấu hình thông báo".
//
// Không sanitize: nội dung là bảng ánh xạ sự-kiện → âm thanh/thiết bị do màn
// Cài đặt tự dựng, schema thay đổi theo module nên lưu nguyên JSON. Chưa cấu
// hình (hoặc JSON hỏng) → null, client tự dùng âm mặc định.
import { audit } from '../../db.js';
import { emit } from '../../realtime.js';
import { NOTIFICATION_SOUND_KEY, readJsonSetting, writeJsonSetting } from './shared.js';

export function getNotificationSoundConfig(branch_id = 'br1') {
  return readJsonSetting(branch_id, NOTIFICATION_SOUND_KEY, (x) => x, null);
}

export function updateNotificationSoundConfig(body = {}, branch_id = 'br1') {
  writeJsonSetting(branch_id, NOTIFICATION_SOUND_KEY, body);
  audit('settings.update', { keys: [NOTIFICATION_SOUND_KEY] }, branch_id);
  emit('settings:updated', { keys: [NOTIFICATION_SOUND_KEY] }, branch_id);
  return body;
}
