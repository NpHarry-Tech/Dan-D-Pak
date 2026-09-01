// Cấu hình ÂM BÁO & ĐỊNH TUYẾN THÔNG BÁO — màn "Cài đặt → Cấu hình thông báo".
//
// Không sanitize: nội dung là bảng ánh xạ sự-kiện → âm thanh/thiết bị do màn
// Cài đặt tự dựng, schema thay đổi theo module nên lưu nguyên JSON. Chưa cấu
// hình (hoặc JSON hỏng) → null, client tự dùng âm mặc định.
import { audit } from '../../db.js';
import { emit } from '../../realtime.js';
import { NOTIFICATION_SOUND_KEY, readJsonSetting, writeJsonSetting } from './shared.js';

export const NOTIFICATION_ROUTING_KEY = 'notification_routing_config';

export function getNotificationSoundConfig(branch_id = 'sala') {
  return readJsonSetting(branch_id, NOTIFICATION_SOUND_KEY, (x) => x, null);
}

/// ĐỊNH TUYẾN THÔNG BÁO — ai nhận nhóm thông báo nào ({ roles, overrides }).
///
/// TỪNG KHÔNG ĐƯỢC LƯU: màn Cài đặt gửi `notification_routing_config` lên
/// `/api/settings/app`, nhưng `updateSettings` chỉ ghi các khoá nằm trong danh
/// sách của nó và khoá này KHÔNG có trong đó — request trả về 200, người dùng
/// thấy "Đã lưu cấu hình thông báo", mở lại thì mọi thứ về mặc định. Đọc cũng
/// hỏng theo: giá trị thô trong app_settings là chuỗi JSON nên client kiểm
/// `is Map` luôn trượt. Giờ có getter parse hẳn hoi và updateSettings ghi khoá
/// này như các cấu hình khác.
export function getNotificationRoutingConfig(branch_id = 'sala') {
  return readJsonSetting(branch_id, NOTIFICATION_ROUTING_KEY, (x) => x, null);
}

export function updateNotificationSoundConfig(body = {}, branch_id = 'sala') {
  writeJsonSetting(branch_id, NOTIFICATION_SOUND_KEY, body);
  audit('settings.update', { keys: [NOTIFICATION_SOUND_KEY] }, branch_id);
  emit('settings:updated', { keys: [NOTIFICATION_SOUND_KEY] }, branch_id);
  return body;
}
