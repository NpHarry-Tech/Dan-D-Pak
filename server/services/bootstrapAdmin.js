import { db, now } from '../db.js';

const ADMIN_USER = {
  id: 'u_admin',
  branch_id: 'br1',
  username: 'admin',
  name: 'Admin',
  pin: '1234',
  role: 'owner',
  lang: 'vi',
};

export function bootstrapDefaultAdmin() {
  db.prepare(`INSERT OR IGNORE INTO branches (id,name,address,code,active,sort) VALUES (?,?,?,?,1,?)`)
    .run('br1', 'Dan D Pak Sala', 'Sala, TP.HCM', 'SALA', 1);

  const hasAdmin = db.prepare(`SELECT 1 FROM users WHERE username=?`).get(ADMIN_USER.username);
  const activeOwners = db.prepare(`SELECT COUNT(*) n FROM users WHERE role='owner' AND active=1`).get().n;
  const totalUsers = db.prepare(`SELECT COUNT(*) n FROM users`).get().n;
  const legacyOwner = db.prepare(`SELECT id FROM users WHERE username='owner' AND role='owner'`).get();

  if (hasAdmin) {
    // Only ensure the account stays active with owner role and full branch access.
    // Never overwrite PIN, name, lang, or branch_id — those are user-configurable.
    db.prepare(`
      UPDATE users
      SET role='owner', active=1, branch_access_json='["*"]'
      WHERE username=?
    `).run(ADMIN_USER.username);
    return { created: false, username: ADMIN_USER.username };
  }

  if (legacyOwner) {
    // Rename legacy 'owner' username to 'admin' but keep their PIN and other settings.
    db.prepare(`
      UPDATE users
      SET username=?, role='owner', active=1, branch_access_json='["*"]'
      WHERE id=?
    `).run(ADMIN_USER.username, legacyOwner.id);
    return { created: false, renamed: true, username: ADMIN_USER.username };
  }

  if (totalUsers > 0 && activeOwners > 0) {
    return { created: false, skipped: true };
  }

  db.prepare(`
    INSERT INTO users (id,branch_id,username,name,pin,role,active,lang,branch_access_json)
    VALUES (?,?,?,?,?,?,1,?,?)
  `).run(
    ADMIN_USER.id,
    ADMIN_USER.branch_id,
    ADMIN_USER.username,
    ADMIN_USER.name,
    ADMIN_USER.pin,
    ADMIN_USER.role,
    ADMIN_USER.lang,
    JSON.stringify(['*']),
  );

  db.prepare(`INSERT INTO audit_log (id,branch_id,actor,action,detail,created_at) VALUES (?,?,?,?,?,?)`)
    .run('a_bootstrap_admin', ADMIN_USER.branch_id, 'system', 'auth.bootstrap.admin', JSON.stringify({ username: ADMIN_USER.username }), now());

  return { created: true, username: ADMIN_USER.username };
}
