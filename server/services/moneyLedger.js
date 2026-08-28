// ─────────────────────────────────────────────────────────────────────────
// MONEY LEDGER — sổ cái dòng tiền TRUNG TÂM (Cash Automation Phase 1+2).
//
// VÌ SAO: tiền đang nằm rải ở payments / cash_drawer_entries / expenses /
// purchase_payments / bank_transactions. Không có một nơi duy nhất để hỏi
// "hôm nay tiền vào bao nhiêu, ra bao nhiêu, còn bao nhiêu". Bảng
// money_transactions gom MỌI dòng tiền THỰC về một schema chung để tổng hợp,
// dự báo và đối soát.
//
// NGUYÊN TẮC CHỐNG TRÙNG (rất quan trọng để không cộng đôi):
//   • payment_lines  → IN  (mọi khoản khách trả cho đơn: cash/bank/QR/thẻ/online)
//   • cash_drawer_entries kind=expense       → OUT (tiền mặt chi ra khỏi két)
//   • cash_drawer_entries kind=reimbursement → IN  (tiền hoàn vào két)
//   • expenses          WHERE source='direct' → OUT (chi trực tiếp, KHÔNG qua két)
//   • purchase_payments WHERE source='direct' → OUT (trả NCC trực tiếp)
//   Chi phí/trả-NCC source='drawer' KHÔNG lấy ở đây vì đã tạo một drawer entry
//   tương ứng (lấy ở dòng trên) → tránh cộng đôi. Bank_transactions KHÔNG
//   projecting vào ledger (khoản khớp đã thành payment; khoản lệch nằm ở
//   Exception Queue).
//
// Projector idempotent qua UNIQUE(source, source_id): chạy lại an toàn, chỉ
// thêm dòng mới. Có thể chạy on-demand, theo lịch, và backfill dữ liệu cũ.
// ─────────────────────────────────────────────────────────────────────────
import { db, uid, now, audit } from '../db.js';
import { currentDrawer } from './cashDrawer.js';
import { supplierDebtSummary } from './purchase.js';
import { payOrder } from './payments.js';

let ready = false;
function ensure() {
  if (ready) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS money_transactions (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      direction TEXT NOT NULL,               -- 'in' | 'out'
      amount INTEGER NOT NULL,               -- luôn dương
      payment_method TEXT,                   -- cash|bank|qr|card|pos|online|...
      account TEXT,                          -- nhóm tài khoản: cash|bank|card|online
      source TEXT NOT NULL,                  -- payment|drawer|expense|purchase
      source_id TEXT NOT NULL,
      category TEXT,                         -- phân loại (rule engine)
      cost_center TEXT,                      -- pos|online|<kênh>
      counterparty TEXT,
      reconciliation_status TEXT DEFAULT 'matched',
      accounting_status TEXT DEFAULT 'pending',
      note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(source, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_money_tx_branch_ts ON money_transactions(branch_id, ts);
    CREATE INDEX IF NOT EXISTS idx_money_tx_dir ON money_transactions(direction);

    CREATE TABLE IF NOT EXISTS money_rules (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL DEFAULT '',    -- '' = áp mọi chi nhánh
      match_field TEXT NOT NULL DEFAULT 'text', -- text (gộp counterparty+note)
      pattern TEXT NOT NULL,                 -- chuỗi con, so khớp không phân biệt hoa/thường
      direction TEXT DEFAULT '',             -- '' | 'in' | 'out'
      category TEXT,
      cost_center TEXT,
      priority INTEGER NOT NULL DEFAULT 100,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);
  seedDefaultRules();
  ready = true;
}

// Rule mặc định phổ biến VN (chỉ seed một lần khi bảng rỗng).
function seedDefaultRules() {
  const has = db.prepare(`SELECT 1 FROM money_rules LIMIT 1`).get();
  if (has) return;
  const rows = [
    { pattern: 'ahamove', direction: 'out', category: 'Vận chuyển', cost_center: '' },
    { pattern: 'giao hang tiet kiem', direction: 'out', category: 'Vận chuyển', cost_center: '' },
    { pattern: 'ghtk', direction: 'out', category: 'Vận chuyển', cost_center: '' },
    { pattern: 'grab', direction: 'out', category: 'Vận chuyển', cost_center: '' },
    { pattern: 'spx', direction: 'out', category: 'Vận chuyển', cost_center: '' },
    { pattern: 'tien dien', direction: 'out', category: 'Điện nước', cost_center: '' },
    { pattern: 'evn', direction: 'out', category: 'Điện nước', cost_center: '' },
    { pattern: 'tien nuoc', direction: 'out', category: 'Điện nước', cost_center: '' },
    { pattern: 'thue mat bang', direction: 'out', category: 'Thuê mặt bằng', cost_center: '' },
    { pattern: 'luong', direction: 'out', category: 'Lương', cost_center: '' },
    { pattern: 'marketing', direction: 'out', category: 'Marketing', cost_center: '' },
    { pattern: 'facebook', direction: 'out', category: 'Marketing', cost_center: '' },
    { pattern: 'google ads', direction: 'out', category: 'Marketing', cost_center: '' },
  ];
  const ins = db.prepare(`INSERT INTO money_rules (id,branch_id,match_field,pattern,direction,category,cost_center,priority,enabled,created_at)
    VALUES (?,?,'text',?,?,?,?,?,1,?)`);
  rows.forEach((r, i) => ins.run(uid('mrule_'), '', r.pattern, r.direction, r.category, r.cost_center, 100 + i, now()));
}

const money = (n) => Math.round(Number(n) || 0);
const fold = (s) => String(s ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

// Rule engine: trả {category, cost_center} đầu tiên khớp (ưu tiên priority nhỏ).
function classify(branch_id, { direction, text }) {
  ensure();
  const hay = fold(text);
  if (!hay) return {};
  const rules = db.prepare(`SELECT * FROM money_rules WHERE enabled=1 AND (branch_id=? OR branch_id='')
    ORDER BY priority ASC, created_at ASC`).all(branch_id);
  for (const r of rules) {
    if (r.direction && r.direction !== direction) continue;
    if (hay.includes(fold(r.pattern))) {
      return { category: r.category || null, cost_center: r.cost_center || null };
    }
  }
  return {};
}

function upsertTx(tx) {
  const cls = classify(tx.branch_id, { direction: tx.direction, text: `${tx.counterparty || ''} ${tx.note || ''}` });
  db.prepare(`INSERT INTO money_transactions
      (id,ts,branch_id,direction,amount,payment_method,account,source,source_id,category,cost_center,counterparty,reconciliation_status,accounting_status,note,created_at)
    VALUES (@id,@ts,@branch_id,@direction,@amount,@payment_method,@account,@source,@source_id,@category,@cost_center,@counterparty,@reconciliation_status,@accounting_status,@note,@created_at)
    ON CONFLICT(source, source_id) DO UPDATE SET
      ts=excluded.ts, amount=excluded.amount, payment_method=excluded.payment_method,
      account=excluded.account, cost_center=COALESCE(excluded.cost_center, money_transactions.cost_center),
      category=COALESCE(excluded.category, money_transactions.category),
      counterparty=excluded.counterparty, note=excluded.note`)
    .run({
      id: uid('mtx_'),
      ts: tx.ts || now(),
      branch_id: tx.branch_id || 'sala',
      direction: tx.direction,
      amount: money(tx.amount),
      payment_method: tx.payment_method || null,
      account: tx.account || null,
      source: tx.source,
      source_id: String(tx.source_id),
      category: cls.category ?? tx.category ?? null,
      cost_center: cls.cost_center ?? tx.cost_center ?? null,
      counterparty: tx.counterparty || null,
      reconciliation_status: tx.reconciliation_status || 'matched',
      accounting_status: 'pending',
      note: tx.note || null,
      created_at: now(),
    });
}

function methodAccount(method) {
  const m = fold(method);
  if (['cash', 'tienmat'].includes(m)) return 'cash';
  if (['card', 'pos', 'the'].includes(m)) return 'card';
  if (['online'].includes(m)) return 'online';
  if (['bank', 'qr', 'qrcode', 'transfer', 'chuyenkhoan', 'sepay', 'casso', 'payos'].includes(m)) return 'bank';
  return m || 'other';
}

// ── Projector: gom mọi dòng tiền THỰC vào ledger (idempotent) ────────────────
export function projectMoneyLedger(branch_id = 'sala', { since = '' } = {}) {
  ensure();
  const sinceTs = since ? new Date(since).toISOString() : '1970-01-01T00:00:00.000Z';
  let count = 0;

  // 1) IN — payment_lines (mọi khoản khách trả). cost_center suy từ đơn.
  const pays = db.prepare(`
    SELECT pl.id line_id, pl.method, pl.amount, pl.reference, p.created_at,
           o.branch_id, o.online_channel, o.channel, o.customer_json
    FROM payment_lines pl
    JOIN payments p ON p.id=pl.payment_id
    JOIN orders o ON o.id=p.order_id
    WHERE o.branch_id=? AND p.created_at>=? AND pl.amount>0`).all(branch_id, sinceTs);
  for (const r of pays) {
    const cc = r.online_channel ? String(r.online_channel) : (r.channel === 'online' ? 'online' : 'pos');
    let cust = '';
    try { cust = (JSON.parse(r.customer_json || '{}').name) || ''; } catch { /* ignore */ }
    upsertTx({
      ts: r.created_at, branch_id: r.branch_id, direction: 'in', amount: r.amount,
      payment_method: r.method, account: methodAccount(r.method),
      source: 'payment', source_id: r.line_id, cost_center: cc, counterparty: cust,
      note: r.reference || null,
    });
    count++;
  }

  // 2) OUT/IN — cash_drawer_entries (chi/hoàn tiền mặt qua két).
  const drawer = db.prepare(`SELECT id,kind,amount,occurred_at,counterparty,reason
    FROM cash_drawer_entries WHERE branch_id=? AND occurred_at>=?`).all(branch_id, sinceTs);
  for (const e of drawer) {
    upsertTx({
      ts: e.occurred_at, branch_id, direction: e.kind === 'reimbursement' ? 'in' : 'out',
      amount: e.amount, payment_method: 'cash', account: 'cash',
      source: 'drawer', source_id: e.id, counterparty: e.counterparty,
      note: e.reason || null,
    });
    count++;
  }

  // 3) OUT — expenses source='direct' (drawer đã lấy ở bước 2).
  const exps = db.prepare(`SELECT id,method,amount,expense_date,category_name,payee_name,note
    FROM expenses WHERE branch_id=? AND source='direct' AND expense_date>=?`).all(branch_id, sinceTs);
  for (const e of exps) {
    upsertTx({
      ts: e.expense_date, branch_id, direction: 'out', amount: e.amount,
      payment_method: e.method || 'transfer', account: methodAccount(e.method || 'bank'),
      source: 'expense', source_id: e.id, category: e.category_name || null,
      counterparty: e.payee_name || null, note: e.note || null,
    });
    count++;
  }

  // 4) OUT — purchase_payments source='direct' (trả NCC trực tiếp).
  const pur = db.prepare(`SELECT pp.id,pp.amount,pp.method,pp.note,pp.created_at,po.supplier_name,po.code
    FROM purchase_payments pp LEFT JOIN purchase_orders po ON po.id=pp.po_id
    WHERE pp.branch_id=? AND pp.source='direct' AND pp.created_at>=?`).all(branch_id, sinceTs);
  for (const p of pur) {
    upsertTx({
      ts: p.created_at, branch_id, direction: 'out', amount: p.amount,
      payment_method: p.method || 'transfer', account: methodAccount(p.method || 'bank'),
      source: 'purchase', source_id: p.id, category: 'Nhập hàng',
      counterparty: p.supplier_name || null, note: `Trả NCC ${p.code || ''}`.trim(),
    });
    count++;
  }

  return { projected: count };
}

// Khoảng ngày HÔM NAY theo giờ VN (+7) → ISO UTC để lọc ledger.
function vnDayRange() {
  const vn = new Date(Date.now() + 7 * 3600 * 1000);
  const startUtcMs = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - 7 * 3600 * 1000;
  return { from: new Date(startUtcMs).toISOString(), to: new Date(startUtcMs + 86400000).toISOString() };
}

// Chiếu ledger tăng dần trước khi tổng hợp (overlap 2 ngày cho chắc, idempotent).
function refreshLedger(branch_id) {
  const last = db.prepare(`SELECT MAX(ts) m FROM money_transactions WHERE branch_id=?`).get(branch_id)?.m;
  const since = last ? new Date(new Date(last).getTime() - 2 * 86400000).toISOString() : '';
  return projectMoneyLedger(branch_id, { since });
}

// ── DASHBOARD dòng tiền realtime ─────────────────────────────────────────────
export function cashFlowSummary(branch_id = 'sala', query = {}) {
  ensure();
  refreshLedger(branch_id);
  const today = vnDayRange();
  const from = query.from ? new Date(query.from).toISOString() : today.from;
  const to = query.to ? new Date(query.to).toISOString() : today.to;

  const agg = (dir) => Number(db.prepare(
    `SELECT COALESCE(SUM(amount),0) s FROM money_transactions
     WHERE branch_id=? AND direction=? AND ts>=? AND ts<?`).get(branch_id, dir, from, to).s || 0);
  const inflow = agg('in');
  const outflow = agg('out');

  const byAccount = db.prepare(
    `SELECT account, direction, COALESCE(SUM(amount),0) total, COUNT(*) n
     FROM money_transactions WHERE branch_id=? AND ts>=? AND ts<?
     GROUP BY account, direction ORDER BY total DESC`).all(branch_id, from, to);
  const byCostCenter = db.prepare(
    `SELECT COALESCE(NULLIF(cost_center,''),'khác') cost_center, direction, COALESCE(SUM(amount),0) total
     FROM money_transactions WHERE branch_id=? AND ts>=? AND ts<?
     GROUP BY cost_center, direction ORDER BY total DESC`).all(branch_id, from, to);
  const byCategory = db.prepare(
    `SELECT COALESCE(NULLIF(category,''),'Chưa phân loại') category, COALESCE(SUM(amount),0) total
     FROM money_transactions WHERE branch_id=? AND direction='out' AND ts>=? AND ts<?
     GROUP BY category ORDER BY total DESC LIMIT 12`).all(branch_id, from, to);

  let cashOnHand = 0;
  try { cashOnHand = Number(currentDrawer(branch_id)?.summary?.expected_cash || 0); } catch { /* no shift */ }
  let ap = { suppliers: [], total_due: 0 };
  try { ap = supplierDebtSummary(branch_id); } catch { /* ignore */ }

  // Số dư bank theo ledger (net in−out account=bank) — CHƯA có số dư đầu kỳ thật
  // nên chỉ là biến động tích luỹ; đánh dấu để không hiểu nhầm là số dư tuyệt đối.
  const bankNet = Number(db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) s
     FROM money_transactions WHERE branch_id=? AND account='bank'`).get(branch_id).s || 0);

  const exceptions = Number(db.prepare(
    `SELECT COUNT(*) n FROM bank_transactions WHERE COALESCE(branch_id,'sala')=?
     AND status IN ('unmatched','underpaid','error','already_paid')`).get(branch_id).n || 0);

  return {
    range: { from, to },
    cash_on_hand: cashOnHand,
    bank_net_movement: bankNet,
    bank_balance_needs_opening: true,
    inflow_period: inflow,
    outflow_period: outflow,
    net_period: inflow - outflow,
    accounts_payable: ap.total_due,
    ap_suppliers: ap.suppliers.slice(0, 8),
    exceptions_pending: exceptions,
    by_account: byAccount.map(r => ({ account: r.account || 'khác', direction: r.direction, total: Number(r.total), count: r.n })),
    by_cost_center: byCostCenter.map(r => ({ cost_center: r.cost_center, direction: r.direction, total: Number(r.total) })),
    by_category_out: byCategory.map(r => ({ category: r.category, total: Number(r.total) })),
  };
}

// Danh sách giao dịch ledger (soi chi tiết / audit).
export function listMoneyTransactions(branch_id = 'sala', query = {}) {
  ensure();
  const limit = Math.max(1, Math.min(500, Number(query.limit) || 100));
  const offset = Math.max(0, Number(query.offset) || 0);
  const where = ['branch_id=?'];
  const params = [branch_id];
  if (query.direction === 'in' || query.direction === 'out') { where.push('direction=?'); params.push(query.direction); }
  if (query.from) { where.push('ts>=?'); params.push(new Date(query.from).toISOString()); }
  if (query.to) { where.push('ts<?'); params.push(new Date(query.to).toISOString()); }
  if (query.account) { where.push('account=?'); params.push(String(query.account)); }
  const w = where.join(' AND ');
  const rows = db.prepare(`SELECT * FROM money_transactions WHERE ${w} ORDER BY ts DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = Number(db.prepare(`SELECT COUNT(*) n FROM money_transactions WHERE ${w}`).get(...params).n || 0);
  return { rows, total, limit, offset };
}

// ── EXCEPTION QUEUE — giao dịch bank lệch, chỉ xử lý bất thường ───────────────
export function exceptionQueue(branch_id = 'sala') {
  ensure();
  const rows = db.prepare(
    `SELECT id,provider,external_id,amount,content,account_number,reference,order_id,status,created_at
     FROM bank_transactions WHERE COALESCE(branch_id,'sala')=?
       AND status IN ('unmatched','underpaid','error','already_paid')
     ORDER BY created_at DESC LIMIT 200`).all(branch_id);
  return {
    rows: rows.map(r => ({ ...r, amount: Number(r.amount || 0) })),
    total: rows.length,
    legend: {
      unmatched: 'Không tìm thấy bill khớp',
      underpaid: 'Khách trả thiếu so với bill',
      already_paid: 'Bill đã đóng trước đó — tiền có thể thừa',
      error: 'Lỗi khi áp tiền — cần kiểm tra',
    },
  };
}

// Xử lý một ngoại lệ: 'ignore' (bỏ qua) hoặc 'match' (áp vào một bill cụ thể).
export function resolveBankException(tx_id, action, input = {}, branch_id = 'sala', actor = 'system') {
  ensure();
  const tx = db.prepare(`SELECT * FROM bank_transactions WHERE id=?`).get(String(tx_id));
  if (!tx) throw new Error('Không tìm thấy giao dịch bank.');
  if (action === 'ignore') {
    db.prepare(`UPDATE bank_transactions SET status='ignored' WHERE id=?`).run(tx.id);
    audit('money.exception.ignore', { tx_id: tx.id, amount: tx.amount }, branch_id, actor);
    return { ok: true, status: 'ignored' };
  }
  if (action === 'match') {
    const orderId = String(input.order_id || '').trim();
    if (!orderId) throw new Error('Cần chọn bill để khớp.');
    const receipt = payOrder(orderId, [{
      method: 'bank', amount: Number(tx.amount || 0),
      reference: `manual:${tx.provider}:${tx.external_id || ''}`.slice(0, 120),
    }], { cashier: `Đối soát tay (${actor})`.slice(0, 120), external_settlement: true }, branch_id);
    db.prepare(`UPDATE bank_transactions SET status=?, order_id=? WHERE id=?`)
      .run(receipt.fully_settled === false ? 'underpaid' : 'paid', orderId, tx.id);
    audit('money.exception.match', { tx_id: tx.id, order_id: orderId, amount: tx.amount }, branch_id, actor);
    return { ok: true, status: 'matched', order_id: orderId };
  }
  throw new Error('Thao tác không hợp lệ.');
}

// ── RULE ENGINE ──────────────────────────────────────────────────────────────
export function listMoneyRules(branch_id = 'sala') {
  ensure();
  return db.prepare(`SELECT * FROM money_rules WHERE branch_id=? OR branch_id='' ORDER BY priority ASC, created_at ASC`).all(branch_id);
}
export function upsertMoneyRule(body = {}, branch_id = 'sala', actor = 'system') {
  ensure();
  const id = String(body.id || '').trim() || uid('mrule_');
  const pattern = String(body.pattern || '').trim();
  if (!pattern) throw new Error('Cần nhập từ khoá (pattern) cho rule.');
  const dir = ['in', 'out'].includes(body.direction) ? body.direction : '';
  const exists = db.prepare(`SELECT id FROM money_rules WHERE id=?`).get(id);
  if (exists) {
    db.prepare(`UPDATE money_rules SET pattern=?,direction=?,category=?,cost_center=?,priority=?,enabled=? WHERE id=?`)
      .run(pattern, dir, String(body.category || '') || null, String(body.cost_center || '') || null,
        Number(body.priority) || 100, body.enabled === false ? 0 : 1, id);
  } else {
    db.prepare(`INSERT INTO money_rules (id,branch_id,match_field,pattern,direction,category,cost_center,priority,enabled,created_at)
      VALUES (?,?,'text',?,?,?,?,?,?,?)`).run(id, String(body.scope_all ? '' : branch_id), pattern, dir,
        String(body.category || '') || null, String(body.cost_center || '') || null, Number(body.priority) || 100,
        body.enabled === false ? 0 : 1, now());
  }
  audit('money.rule.save', { id, pattern }, branch_id, actor);
  return db.prepare(`SELECT * FROM money_rules WHERE id=?`).get(id);
}
export function deleteMoneyRule(id, branch_id = 'sala', actor = 'system') {
  ensure();
  db.prepare(`DELETE FROM money_rules WHERE id=?`).run(String(id));
  audit('money.rule.delete', { id }, branch_id, actor);
  return { ok: true };
}

// Phân loại lại toàn bộ ledger theo rule hiện tại (sau khi sửa rule).
export function reclassifyLedger(branch_id = 'sala') {
  ensure();
  const rows = db.prepare(`SELECT id,direction,counterparty,note FROM money_transactions WHERE branch_id=?`).all(branch_id);
  const upd = db.prepare(`UPDATE money_transactions SET category=?, cost_center=COALESCE(?, cost_center) WHERE id=?`);
  let changed = 0;
  for (const r of rows) {
    const cls = classify(branch_id, { direction: r.direction, text: `${r.counterparty || ''} ${r.note || ''}` });
    if (cls.category || cls.cost_center) { upd.run(cls.category || null, cls.cost_center || null, r.id); changed++; }
  }
  return { reclassified: changed };
}

// ── PHASE 3: DỰ BÁO DÒNG TIỀN (7/30/90 ngày) + nghĩa vụ định kỳ ──────────────
// Nghĩa vụ định kỳ (lương/thuê/điện…) khai theo ngày trong tháng để dự báo
// biết trước dòng tiền ra sắp tới. Bảng tạo trong ensure() bên dưới.
function ensureObligations() {
  ensure();
  db.exec(`CREATE TABLE IF NOT EXISTS recurring_obligations (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    name TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    category TEXT,
    day_of_month INTEGER NOT NULL DEFAULT 1,   -- 1..31
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`);
}

export function listObligations(branch_id = 'sala') {
  ensureObligations();
  return db.prepare(`SELECT * FROM recurring_obligations WHERE branch_id=? ORDER BY day_of_month ASC, created_at ASC`).all(branch_id);
}
export function upsertObligation(body = {}, branch_id = 'sala', actor = 'system') {
  ensureObligations();
  const id = String(body.id || '').trim() || uid('oblig_');
  const name = String(body.name || '').trim();
  if (!name) throw new Error('Cần nhập tên nghĩa vụ (lương, thuê mặt bằng…).');
  const amount = Math.max(0, Math.round(Number(body.amount) || 0));
  const dom = Math.max(1, Math.min(31, Math.round(Number(body.day_of_month) || 1)));
  const exists = db.prepare(`SELECT id FROM recurring_obligations WHERE id=?`).get(id);
  if (exists) {
    db.prepare(`UPDATE recurring_obligations SET name=?,amount=?,category=?,day_of_month=?,enabled=? WHERE id=?`)
      .run(name, amount, String(body.category || '') || null, dom, body.enabled === false ? 0 : 1, id);
  } else {
    db.prepare(`INSERT INTO recurring_obligations (id,branch_id,name,amount,category,day_of_month,enabled,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, branch_id, name, amount, String(body.category || '') || null, dom, body.enabled === false ? 0 : 1, now());
  }
  audit('money.obligation.save', { id, name, amount }, branch_id, actor);
  return db.prepare(`SELECT * FROM recurring_obligations WHERE id=?`).get(id);
}
export function deleteObligation(id, branch_id = 'sala', actor = 'system') {
  ensureObligations();
  db.prepare(`DELETE FROM recurring_obligations WHERE id=? AND branch_id=?`).run(String(id), branch_id);
  audit('money.obligation.delete', { id }, branch_id, actor);
  return { ok: true };
}

// Số lần ngày-trong-tháng rơi vào N ngày tới (giờ VN +7).
function monthlyHitsInDays(dayOfMonth, h) {
  let count = 0;
  const base = Date.now() + 7 * 3600 * 1000;
  for (let i = 1; i <= h; i++) {
    const d = new Date(base + i * 86400000);
    if (d.getUTCDate() === dayOfMonth) count++;
  }
  return count;
}

export function cashFlowForecast(branch_id = 'sala', { horizons = [7, 30, 90] } = {}) {
  ensureObligations();
  refreshLedger(branch_id);

  let cashOnHand = 0;
  try { cashOnHand = Number(currentDrawer(branch_id)?.summary?.expected_cash || 0); } catch { /* no shift */ }

  // Trung bình/ngày từ ledger 30 ngày gần nhất.
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const agg = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END),0) inflow,
      COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) outflow
    FROM money_transactions WHERE branch_id=? AND ts>=?`).get(branch_id, since);
  const avgIn = Number(agg.inflow) / 30;
  const avgOut = Number(agg.outflow) / 30;

  let ap = 0;
  try { ap = supplierDebtSummary(branch_id).total_due; } catch { /* ignore */ }

  const obligations = listObligations(branch_id).filter(o => o.enabled);

  const forecast = horizons.map(h => {
    const projInflow = Math.round(avgIn * h);
    const projOutAvg = Math.round(avgOut * h);
    const recurringDue = obligations.reduce((s, o) => s + monthlyHitsInDays(o.day_of_month, h) * Number(o.amount || 0), 0);
    // AP chưa có ngày đến hạn → tính bảo toàn (coi như phải trả trong kỳ).
    const totalOut = projOutAvg + recurringDue + ap;
    const projected = cashOnHand + projInflow - totalOut;
    return {
      horizon_days: h,
      opening_cash: cashOnHand,
      expected_inflow: projInflow,
      expected_outflow: totalOut,
      recurring_due: recurringDue,
      accounts_payable: ap,
      projected_cash: projected,
      shortfall: projected < 0 ? -projected : 0,
    };
  });

  return {
    cash_on_hand: cashOnHand,
    avg_daily_inflow: Math.round(avgIn),
    avg_daily_outflow: Math.round(avgOut),
    accounts_payable: ap,
    obligations,
    forecast,
  };
}
