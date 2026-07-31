import { bool, plainObject, readJsonSetting } from './shared.js';

export const SALES_MODULES_KEY = 'sales_modules';
export const DEFAULT_SALES_MODULES = Object.freeze({
  fnb: true,
  retail: true,
  kds: true,
});

export function sanitizeSalesModules(value = {}) {
  const input = plainObject(value);
  const fnb = bool(input.fnb, true);
  return {
    fnb,
    retail: bool(input.retail, true),
    kds: fnb && bool(input.kds, true),
  };
}

export function getSalesModules(branch_id = 'sala') {
  return readJsonSetting(
    branch_id,
    SALES_MODULES_KEY,
    sanitizeSalesModules,
    DEFAULT_SALES_MODULES,
  );
}

export function isSalesModuleEnabled(key, branch_id = 'sala') {
  return getSalesModules(branch_id)[key] !== false;
}

export function assertSalesModuleEnabled(key, branch_id = 'sala') {
  if (isSalesModuleEnabled(key, branch_id)) return;
  const label = { fnb: 'F&B', retail: 'Retail', kds: 'Màn hình bếp KDS' }[key] || key;
  const error = new Error(`Module ${label} đang tắt tại chi nhánh này.`);
  error.status = 403;
  error.code = 'MODULE_DISABLED';
  throw error;
}
