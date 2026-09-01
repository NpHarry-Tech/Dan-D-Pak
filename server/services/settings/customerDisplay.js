// Cấu hình MÀN HÌNH PHỤ (màn hướng về khách) — màn "Cài đặt → Màn hình phụ".
//
// Ảnh mới lưu thành file và settings chỉ giữ URL. Data URL vẫn được đọc tạm thời
// để các cấu hình production cũ không mất ảnh trước migration có backup.
import { CUSTOMER_DISPLAY_KEY, bool, readJsonSetting } from './shared.js';
import { db, now } from '../../db.js';
import { storagePath } from '../../config/env.js';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_CUSTOMER_DISPLAY = {
  enabled: false,
  secondsPerImage: 20,
  images: [],
};
const CUSTOMER_DISPLAY_MAX_IMAGES = 12;

export function sanitizeCustomerDisplay(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const images = Array.isArray(src.images)
    ? src.images
        .map(x => String(x || ''))
        .filter(x => x.startsWith('data:image/') || x.startsWith('http')
          || x.startsWith('/uploads/customer-display/'))
        .slice(0, CUSTOMER_DISPLAY_MAX_IMAGES)
    : [];
  return {
    enabled: bool(src.enabled, false),
    secondsPerImage: Math.max(5, Math.min(120,
      parseInt(src.secondsPerImage) || DEFAULT_CUSTOMER_DISPLAY.secondsPerImage)),
    images,
  };
}

export function getCustomerDisplayConfig(branch_id = 'sala') {
  return readJsonSetting(branch_id, CUSTOMER_DISPLAY_KEY, sanitizeCustomerDisplay, DEFAULT_CUSTOMER_DISPLAY);
}

const LEGACY_IMAGE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i;
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

/**
 * Chuyển ảnh data-URI cũ thành file content-addressed. Không xoá ảnh/row cũ;
 * chỉ cập nhật setting sau khi toàn bộ file đã ghi thành công. Dùng được trên
 * bản sao production trước deploy và chạy lại an toàn (idempotent).
 */
export function materializeLegacyCustomerDisplayAssets({ dryRun = true } = {}) {
  const rows = db.prepare(`SELECT branch_id,value FROM app_settings WHERE key=?`).all(CUSTOMER_DISPLAY_KEY);
  const outputDir = storagePath('uploads', 'customer-display');
  const result = { rowsScanned: rows.length, rowsChanged: 0, assets: 0, bytesRemovedFromDb: 0, dryRun };
  for (const row of rows) {
    let config;
    try { config = JSON.parse(row.value); } catch { continue; }
    if (!Array.isArray(config?.images)) continue;
    const nextImages = [];
    const pendingFiles = [];
    let changed = false;
    for (const rawValue of config.images) {
      const value = String(rawValue || '');
      const match = value.match(LEGACY_IMAGE);
      if (!match) { nextImages.push(value); continue; }
      const mime = match[1].toLowerCase();
      const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) {
        nextImages.push(value);
        continue;
      }
      const name = `display_${createHash('sha256').update(bytes).digest('hex')}${EXT[mime]}`;
      nextImages.push(`/uploads/customer-display/${name}`);
      pendingFiles.push({ name, bytes });
      result.assets++;
      result.bytesRemovedFromDb += value.length - nextImages.at(-1).length;
      changed = true;
    }
    if (!changed) continue;
    result.rowsChanged++;
    if (dryRun) continue;
    mkdirSync(outputDir, { recursive: true });
    const created = [];
    try {
      for (const file of pendingFiles) {
        const target = join(outputDir, file.name);
        if (existsSync(target)) continue;
        const temp = `${target}.tmp-${process.pid}`;
        writeFileSync(temp, file.bytes, { flag: 'wx' });
        renameSync(temp, target);
        created.push(target);
      }
      config.images = nextImages;
      db.prepare(`UPDATE app_settings SET value=?,updated_at=? WHERE branch_id=? AND key=?`)
        .run(JSON.stringify(config), now(), row.branch_id, CUSTOMER_DISPLAY_KEY);
    } catch (error) {
      for (const file of created) { try { unlinkSync(file); } catch {} }
      throw error;
    }
  }
  return result;
}
