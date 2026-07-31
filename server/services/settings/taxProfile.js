// Hồ sơ KHAI THUẾ của cửa hàng — màn "Cài đặt → Thuế".
//
// Schema và hàm chuẩn hoá nằm ở services/tax.js (nơi tính thuế dùng chung);
// file này chỉ lo phần lưu/đọc trong app_settings.
import { TAX_FILING_PROFILE_KEY, readJsonSetting } from './shared.js';
import {
  DEFAULT_TAX_FILING_PROFILE as TAX_DEFAULT_PROFILE,
  sanitizeTaxFilingProfile as sanitizeTaxProfile,
} from '../tax.js';

export function getTaxFilingProfile(branch_id = 'sala') {
  return readJsonSetting(branch_id, TAX_FILING_PROFILE_KEY, sanitizeTaxProfile, TAX_DEFAULT_PROFILE);
}

export function sanitizeTaxFilingProfile(raw = {}) {
  return sanitizeTaxProfile(raw);
}
