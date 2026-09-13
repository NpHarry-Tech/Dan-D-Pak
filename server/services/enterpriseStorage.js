// Enterprise Storage Service
// Bootstrap thư mục lưu trữ theo scope: system | branch | user

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { storagePath } from '../config/env.js';

const STORAGE_ROOT = storagePath('enterprise-storage');

export function ensureStorageDirectories() {
  const dirs = [
    join(STORAGE_ROOT, 'system'),
    join(STORAGE_ROOT, 'branches'),
    join(STORAGE_ROOT, 'users'),
  ];
  for (const d of dirs) mkdirSync(d, { recursive: true });
}
