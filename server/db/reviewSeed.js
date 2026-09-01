// Shopee Review/Staging — seed + migration RIÊNG, chỉ chạy APP_ENV=review.
//
// Tenant review là TENANT ĐỘC LẬP (§1/§16/§42). Canonical branch id = 'review'
// (KHÔNG còn 'sala' legacy — §2). Fresh review sinh đúng 'review' ngay từ đầu;
// review DB legacy (id='sala' name 'Shopee Review Store') được MIGRATE an toàn.
import { db } from './connection.js';
import { env } from '../config/env.js';
import { hashPin, verifyPin } from '../services/pin.js';
import { branchFullAccessPerms } from '../services/auth.js';

export const SHOPEE_REVIEWER_ROLE = 'shopee_reviewer';

// Canonical review identity (§2). KHÔNG dùng 'sala' cho tenant review nữa.
const REVIEW_BRANCH_ID = 'review';
const REVIEW_BRANCH_NAME = 'Shopee Review Store';
const REVIEW_BRANCH_CODE = 'REVIEW';
const LEGACY_BRANCH_ID = 'sala';

const REVIEWER_USER = {
  id: 'u_shopee_reviewer',
  username: 'shopee-reviewer',
  name: 'Shopee Reviewer',
  role: SHOPEE_REVIEWER_ROLE,
  branch_id: REVIEW_BRANCH_ID,
};
// Account nội bộ (KHÔNG cấp cho Shopee). Chỉ PERSIST nếu đã tồn tại — KHÔNG bao
// giờ tự tạo với credential giả/đoán được (§6).
const REVIEW_ADMIN_USERNAME = 'admin';
// Các account luôn được giữ active trong review (không vô hiệu hoá).
const KEEP_ACTIVE = new Set([REVIEWER_USER.username, REVIEW_ADMIN_USERNAME]);

function reviewerPin() {
  const pin = String(process.env.SHOPEE_REVIEWER_PIN || '').trim();
  if (!/^\d{4,12}$/.test(pin)) {
    throw new Error('Review requires SHOPEE_REVIEWER_PIN gồm 4–12 chữ số, đặt trong .env và không commit.');
  }
  return pin;
}

function quoteIdent(name) { return `"${String(name).replaceAll('"', '""')}"`; }

// MIGRATION review-only: branch id 'sala' (name "Shopee Review Store") -> 'review'.
// Idempotent, fail-closed (§3/§4). Bảo toàn referential integrity: dời mọi cột
// branch_id sang 'review' TRƯỚC, rồi mới xoá branch legacy. KHÔNG bao giờ chạy nếu
// không phải env.isReview.
export function reviewMigrateSalaToReview() {
  if (!env.isReview) {
    throw new Error('reviewMigrateSalaToReview chỉ chạy khi APP_ENV=review.');
  }
  const legacy = db.prepare(`SELECT id,name,address,active,sort FROM branches WHERE id=?`).get(LEGACY_BRANCH_ID);
  if (!legacy) return { migrated: false, reason: 'no-legacy-sala' };
  // FAIL-CLOSED §3: chỉ migrate khi branch 'sala' ĐÚNG là branch review. Nếu là
  // thứ khác (mơ hồ) -> dừng, không đoán.
  if (legacy.name !== REVIEW_BRANCH_NAME) {
    throw new Error(`Review migration ambiguous: branch 'sala' name='${legacy.name}' != '${REVIEW_BRANCH_NAME}'. Dừng an toàn.`);
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    // 1) Bảo đảm branch đích 'review' tồn tại (copy thuộc tính legacy).
    db.prepare(`INSERT OR IGNORE INTO branches (id,name,address,code,active,sort) VALUES (?,?,?,?,?,?)`)
      .run(REVIEW_BRANCH_ID, REVIEW_BRANCH_NAME, legacy.address || 'Shopee Review',
        REVIEW_BRANCH_CODE, legacy.active ?? 1, legacy.sort ?? 1);

    // 2) Dời MỌI cột branch_id 'sala'->'review' (khám phá động, trừ bảng branches).
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='branches'
    `).all();
    let repointed = 0;
    for (const { name } of tables) {
      const cols = db.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all();
      if (!cols.some(c => c.name === 'branch_id')) continue;
      repointed += db.prepare(`UPDATE ${quoteIdent(name)} SET branch_id=? WHERE branch_id=?`)
        .run(REVIEW_BRANCH_ID, LEGACY_BRANCH_ID).changes;
    }

    // 3) users.branch_access_json: ["sala"] -> ["review"].
    for (const u of db.prepare(`SELECT id,branch_access_json FROM users WHERE branch_access_json LIKE '%sala%'`).all()) {
      let access;
      try { access = JSON.parse(u.branch_access_json || '[]'); } catch { continue; }
      if (!Array.isArray(access)) continue;
      const migrated = [...new Set(access.map(id => id === LEGACY_BRANCH_ID ? REVIEW_BRANCH_ID : id))];
      db.prepare(`UPDATE users SET branch_access_json=? WHERE id=?`).run(JSON.stringify(migrated), u.id);
    }

    // 4) Xoá branch legacy 'sala' (không còn record nào tham chiếu).
    db.prepare(`DELETE FROM branches WHERE id=?`).run(LEGACY_BRANCH_ID);

    db.exec('COMMIT');
    return { migrated: true, repointed };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function seedShopeeReview() {
  if (!env.isReview) throw new Error('seedShopeeReview chỉ được chạy khi APP_ENV=review.');
  if (env.ALLOW_PRODUCTION_DATA) {
    throw new Error('Review seed bị chặn: ALLOW_PRODUCTION_DATA=true không hợp lệ cho tenant review.');
  }
  // Migrate legacy 'sala'->'review' TRƯỚC khi seed (idempotent, no-op nếu đã review).
  const migration = reviewMigrateSalaToReview();
  const pin = reviewerPin();

  db.exec('BEGIN');
  try {
    // 1) Branch review canonical (tự dựng — review KHÔNG chạy bootstrapBranchDefaults).
    db.prepare(`INSERT OR IGNORE INTO branches (id,name,address,code,active,sort) VALUES (?,?,?,?,1,1)`)
      .run(REVIEW_BRANCH_ID, REVIEW_BRANCH_NAME, 'Shopee Review', REVIEW_BRANCH_CODE);
    db.prepare(`UPDATE branches SET name=?, code=?, active=1 WHERE id=? AND (name<>? OR code<>?)`)
      .run(REVIEW_BRANCH_NAME, REVIEW_BRANCH_CODE, REVIEW_BRANCH_ID, REVIEW_BRANCH_NAME, REVIEW_BRANCH_CODE);

    // 2) Vai trò reviewer = BRANCH FULL ACCESS canonical (EXACT-set, không stale).
    db.prepare(`DELETE FROM role_perms WHERE role=?`).run(SHOPEE_REVIEWER_ROLE);
    const insPerm = db.prepare(`INSERT OR IGNORE INTO role_perms (role, perm) VALUES (?, ?)`);
    const perms = branchFullAccessPerms();
    for (const p of perms) insPerm.run(SHOPEE_REVIEWER_ROLE, p);

    // 3) Chỉ reviewer + admin (nếu có) được active (§6/§39 — internet-facing).
    db.prepare(`UPDATE users SET active=0 WHERE username NOT IN (?,?)`)
      .run(REVIEWER_USER.username, REVIEW_ADMIN_USERNAME);

    // 4) Tài khoản reviewer — branch access CHỈ 'review' (KHÔNG '*' = KHÔNG tenant admin).
    const access = JSON.stringify([REVIEW_BRANCH_ID]);
    const exists = db.prepare(`SELECT id,pin FROM users WHERE username=?`).get(REVIEWER_USER.username);
    let userCreated = false, pinRotated = false;
    if (!exists) {
      db.prepare(`INSERT INTO users (id,branch_id,username,name,pin,role,active,branch_access_json)
        VALUES (?,?,?,?,?,?,1,?)`)
        .run(REVIEWER_USER.id, REVIEW_BRANCH_ID, REVIEWER_USER.username, REVIEWER_USER.name,
          hashPin(pin), REVIEWER_USER.role, access);
      userCreated = true;
    } else {
      pinRotated = !verifyPin(pin, exists.pin);
      db.prepare(`UPDATE users SET branch_id=?,name=?,pin=?,role=?,active=1,branch_access_json=? WHERE username=?`)
        .run(REVIEW_BRANCH_ID, REVIEWER_USER.name, pinRotated ? hashPin(pin) : exists.pin,
          SHOPEE_REVIEWER_ROLE, access, REVIEWER_USER.username);
    }

    // 5) admin PERSISTENCE (§6): CHỈ khi đã tồn tại — không tự tạo credential.
    //    Giữ owner + active + ['*']. KHÔNG đụng PIN (do chủ đặt).
    const admin = db.prepare(`SELECT id FROM users WHERE username=?`).get(REVIEW_ADMIN_USERNAME);
    if (admin) {
      db.prepare(`UPDATE users SET role='owner', active=1, branch_access_json='["*"]' WHERE username=?`)
        .run(REVIEW_ADMIN_USERNAME);
    }

    db.exec('COMMIT');
    return {
      role: SHOPEE_REVIEWER_ROLE, perms: perms.length, username: REVIEWER_USER.username,
      branch_id: REVIEW_BRANCH_ID, userCreated, pinRotated,
      reviewAdminPresent: !!admin, migration,
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
