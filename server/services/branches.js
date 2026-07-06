import { db, audit, bootstrapWarehouseDefaults, bootstrapTableDefaults } from '../db.js';

const normalizeCode = (v) => String(v || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 24);

const branchIdFromCode = (code) => 'br_' + String(code || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 28);

function mapBranch(row) {
  return row ? { ...row, active: row.active !== 0 } : null;
}

function addressFields(body = {}, cur = {}) {
  return {
    address: body.address !== undefined ? (body.address || null) : cur.address,
    address_detail: body.address_detail !== undefined ? (body.address_detail || null) : cur.address_detail,
    address_ward: body.address_ward !== undefined ? (body.address_ward || null) : cur.address_ward,
    address_province: body.address_province !== undefined ? (body.address_province || null) : cur.address_province,
    ward_code: body.ward_code !== undefined ? (body.ward_code || null) : cur.ward_code,
    province_code: body.province_code !== undefined ? (body.province_code || null) : cur.province_code,
  };
}

export function listBranches({ all = false } = {}) {
  const rows = db.prepare(`SELECT * FROM branches ORDER BY sort,name`).all().map(mapBranch);
  return all ? rows : rows.filter(b => b.active);
}

export function getBranch(id) {
  return mapBranch(db.prepare(`SELECT * FROM branches WHERE id=?`).get(id));
}

export function createBranch(body = {}, actor = 'system') {
  const name = String(body.name || '').trim();
  if (!name) throw new Error('Thiếu tên chi nhánh');
  const code = normalizeCode(body.code || name);
  if (!code) throw new Error('Thiếu mã chi nhánh');
  const id = body.id || branchIdFromCode(code);
  if (db.prepare(`SELECT 1 FROM branches WHERE id=? OR UPPER(code)=UPPER(?)`).get(id, code)) {
    throw new Error('Mã chi nhánh đã tồn tại');
  }
  const sort = Number.isFinite(Number(body.sort))
    ? Number(body.sort)
    : (db.prepare(`SELECT COALESCE(MAX(sort),0)+1 n FROM branches`).get().n || 1);
  const addr = addressFields(body);
  db.prepare(`INSERT INTO branches (id,name,address,address_detail,address_ward,address_province,ward_code,province_code,code,phone,active,sort,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, name, addr.address, addr.address_detail, addr.address_ward, addr.address_province, addr.ward_code, addr.province_code, code, body.phone || null, body.active === false ? 0 : 1, sort, body.note || null);
  bootstrapWarehouseDefaults(id);
  bootstrapTableDefaults(id);
  audit('branch.create', { id, name, code }, id, actor);
  return getBranch(id);
}

export function updateBranch(id, body = {}, actor = 'system') {
  const cur = getBranch(id);
  if (!cur) throw new Error('Chi nhánh không tồn tại');
  const name = body.name !== undefined ? String(body.name || '').trim() || cur.name : cur.name;
  const code = body.code !== undefined ? normalizeCode(body.code || cur.code || name) : (cur.code || normalizeCode(name));
  const dup = db.prepare(`SELECT id FROM branches WHERE UPPER(code)=UPPER(?) AND id!=?`).get(code, id);
  if (dup) throw new Error('Mã chi nhánh đã tồn tại');
  const addr = addressFields(body, cur);
  db.prepare(`UPDATE branches SET name=?, address=?, address_detail=?, address_ward=?, address_province=?, ward_code=?, province_code=?, code=?, phone=?, active=?, sort=?, note=? WHERE id=?`)
    .run(
      name,
      addr.address,
      addr.address_detail,
      addr.address_ward,
      addr.address_province,
      addr.ward_code,
      addr.province_code,
      code,
      body.phone !== undefined ? (body.phone || null) : cur.phone,
      body.active !== undefined ? (body.active ? 1 : 0) : (cur.active ? 1 : 0),
      body.sort !== undefined ? (parseInt(body.sort) || 0) : (cur.sort || 0),
      body.note !== undefined ? (body.note || null) : cur.note,
      id,
    );
  if (body.active !== false) {
    bootstrapWarehouseDefaults(id);
    bootstrapTableDefaults(id);
  }
  audit('branch.update', { id, name, code, active: body.active !== false }, id, actor);
  return getBranch(id);
}
