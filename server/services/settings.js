// ────────────────────────────────────────────────────────────────────────────
//  Module CÀI ĐẶT — cửa vào duy nhất.
//
//  File này chỉ tái xuất; toàn bộ code nằm trong ./settings/, mỗi nhóm cấu
//  hình một file. Nhờ vậy mọi `import { … } from './settings.js'` sẵn có vẫn
//  chạy nguyên như cũ.
//
//  Cần sửa gì thì mở đúng file:
//    settings/shared.js          — khoá app_settings, ép kiểu, đọc/ghi JSON
//    settings/core.js            — getSettings / updateSettings, PIN iPad
//    settings/integrations.js    — Liên kết đối tác (MISA, payOS, Haravan…)
//    settings/print.js           — Bill, tem nhãn, máy in, mẫu in
//    settings/operations.js      — Thanh toán, máy POS thẻ, ca làm việc
//    settings/retail.js          — Kho & bảng giá cho bán retail
//    settings/loyalty.js         — Tích điểm, hạng thành viên
//    settings/customerDisplay.js — Màn hình phụ hướng về khách
//    settings/notifications.js   — Âm báo & định tuyến thông báo
//    settings/taxProfile.js      — Hồ sơ khai thuế
//    settings/firebase.js        — Khoá service-account FCM (mã hoá)
// ────────────────────────────────────────────────────────────────────────────

export { getSettings, updateSettings, verifyIpadStaffPin } from './settings/core.js';

export {
  getIntegrations,
  getPublicIntegrations,
  getIntegrationChannel,
  updateIntegrations,
  isMaskedIntegrationSecret,
  mergeIntegrationChannelSecrets,
} from './settings/integrations.js';

export { getPrintConfig, autoSaveTemplate } from './settings/print.js';

export {
  getOperationsConfig,
  canonicalMethodKey,
  CARD_TERMINAL_MODELS,
  CARD_TERMINAL_PROVIDERS,
} from './settings/operations.js';

export { getRetailConfig, sanitizeRetailConfig } from './settings/retail.js';

export { getLoyaltyConfig } from './settings/loyalty.js';

export { getCustomerDisplayConfig } from './settings/customerDisplay.js';

export {
  getNotificationSoundConfig,
  updateNotificationSoundConfig,
} from './settings/notifications.js';

export { getTaxFilingProfile, sanitizeTaxFilingProfile } from './settings/taxProfile.js';

export {
  getFirebaseServiceAccount,
  firebaseConfigured,
  setFirebaseServiceAccount,
} from './settings/firebase.js';
