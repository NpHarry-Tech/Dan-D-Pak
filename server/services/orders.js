// Order lifecycle: create/append items, route to KDS stations, and drive
// kitchen ticket status transitions.
import { db, uid, now, audit, buildAuditEntry, insertAuditRow, auditPostCommit } from '../db.js';
import { parseJson } from '../core/util.js';
import { emit } from '../realtime.js';
import { printKitchenTickets, printKitchenUpdate, printRunnerSlip, printCupLabels } from './printing.js';
import { getMenuItemForOrder } from './catalog.js';
import { getOperationsConfig } from './settings.js';
import { applyChannelPrice } from './inventory.js';
import { getActiveShift } from './shifts.js';
import { archiveOrder } from './archive.js';
import { orderVatTotals, salePrice } from './tax.js';
import { sendPushForCategory } from './push.js';
import { businessDayBoundsUtc, businessParts } from '../core/businessClock.js';
import { logSystem } from './systemLogs.js';

// Số Bill nội bộ: Dan{ddMMyy}{seq} — seq là số thứ tự đơn trong NGÀY (reset mỗi
// ngày vận hành: ca sáng → ca tối đều trong 1 ngày dương lịch). VD Dan210626001.
function todayDdMMyy() {
  const d = businessParts();
  const pad = (x) => String(x).padStart(2, '0');
  return pad(d.day) + pad(d.month) + String(d.year).slice(-2);
}
function billNoForSeq(seq) {
  return `Dan${todayDdMMyy()}${String(seq).padStart(3, '0')}`;
}
// seq kế tiếp = MAX(seq đã có TRONG NGÀY) + 1. Tách đúng phần seq SAU tiền tố ngày
// (Dan{ddMMyy}) — KHÔNG dùng \d+$ vì sẽ nuốt luôn 6 chữ số ngày. Dùng MAX (không COUNT)
// để chịu được khoảng trống do xóa, và để retry-chống-trùng tăng dần khi đụng UNIQUE.
function nextPaySeq(branch_id = 'sala') {
  const ddMMyy = todayDdMMyy();
  const { start, end } = businessDayBoundsUtc();
  const rows = db.prepare(`SELECT bill_no FROM orders WHERE branch_id=? AND bill_no LIKE ? AND created_at>=? AND created_at<?`)
    .all(branch_id, `Dan${ddMMyy}%`, start.toISOString(), end.toISOString());
  const re = new RegExp(`^Dan${ddMMyy}(\\d+)$`);
  let max = 0;
  for (const r of rows) {
    const m = re.exec(r.bill_no || '');
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return max + 1;
}
// Tạo 1 order mở với bill_no duy nhất. Chịu được race/đa-server: nếu chỉ mục UNIQUE
// (branch_id,bill_no) bị đụng (server khác vừa chèn cùng seq), tăng seq và thử lại.
// ĐƠN MỞ RA CHƯA CÓ SỐ HOÁ ĐƠN.
//
// Chỉ cấp `pay_ref` — mã để khách chuyển khoản và để webhook khớp tiền về.
// `bill_no` để TRỐNG, chỉ điền khi thanh toán xong (xem capSoBillKhiThanhToan).
// Nhờ vậy đơn huỷ chưa trả tiền không tiêu số hoá đơn nào.
// seq cho PAY_REF = MAX seq trong PAY_REF hôm nay + 1. PHẢI đếm theo pay_ref (mã
// cấp lúc MỞ đơn), KHÔNG theo bill_no (chỉ cấp lúc THANH TOÁN): nhiều đơn treo
// (mở, chưa trả) sẽ giữ pay_ref nhưng chưa có bill_no, nên đếm bill_no cho ra seq
// thấp → trùng pay_ref của đơn treo → UNIQUE constraint failed (sự cố 07/08/2026).
function nextPayRefSeq(branch_id = 'sala') {
  const ddMMyy = todayDdMMyy();
  const { start, end } = businessDayBoundsUtc();
  const rows = db.prepare(`SELECT pay_ref FROM orders WHERE branch_id=? AND pay_ref LIKE ? AND created_at>=? AND created_at<?`)
    .all(branch_id, `Dan${ddMMyy}%`, start.toISOString(), end.toISOString());
  const re = new RegExp(`^Dan${ddMMyy}(\\d+)$`);
  let max = 0;
  for (const r of rows) {
    const m = re.exec(r.pay_ref || '');
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return max + 1;
}

function insertOpenOrder({ branch_id = 'sala', table_id = null, channel = 'dine_in' }) {
  const id = uid('o_');
  let seq = nextPayRefSeq(branch_id);
  const ins = db.prepare(`INSERT INTO orders (id,branch_id,table_id,channel,status,pay_ref,created_at) VALUES (?,?,?,?,'open',?,?)`);
  for (let attempt = 0; ; attempt++) {
    try {
      ins.run(id, branch_id, table_id, channel, billNoForSeq(seq), now());
      break;
    } catch (e) {
      if (attempt < 500 && /unique|constraint/i.test(String(e?.message))) { seq++; continue; }
      throw e;
    }
  }
  return db.prepare(`SELECT * FROM orders WHERE id=?`).get(id);
}

/**
 * CẤP SỐ HOÁ ĐƠN — chỉ gọi khi đơn ĐÃ THANH TOÁN XONG.
 *
 * Số hoá đơn là con số đi vào sổ sách, nên chỉ được tiêu khi thật sự phát sinh
 * doanh thu. Cấp từ lúc mở đơn (cách cũ) thì mọi đơn huỷ đều chiếm một số và
 * dãy số thủng lỗ chỗ — cơ quan thuế hỏi thì không giải thích được.
 *
 * Gọi lại nhiều lần trên cùng một đơn là vô hại: đã có số thì giữ nguyên.
 */
export function capSoBillKhiThanhToan(order_id, branch_id = 'sala') {
  const o = db.prepare(`SELECT id, branch_id, bill_no FROM orders WHERE id=?`).get(order_id);
  if (!o) return null;
  if (o.bill_no) return o.bill_no; // đã có số rồi (VD thanh toán nhiều lần)

  const br = o.branch_id || branch_id;
  let seq = nextPaySeq(br);
  const upd = db.prepare(`UPDATE orders SET bill_no=? WHERE id=? AND (bill_no IS NULL OR bill_no='')`);
  for (let lan = 0; ; lan++) {
    const so = billNoForSeq(seq);
    try {
      upd.run(so, order_id);
      const lai = db.prepare(`SELECT bill_no FROM orders WHERE id=?`).get(order_id);
      return lai?.bill_no || so;
    } catch (e) {
      // Máy khác vừa chiếm đúng số này (chỉ mục UNIQUE) → lấy số kế tiếp.
      if (lan < 10 && /unique|constraint/i.test(String(e?.message))) { seq++; continue; }
      throw e;
    }
  }
}

export function getOpenOrderForTable(table_id, branch_id = 'sala') {
  if (!table_id) return undefined;
  return db.prepare(`SELECT * FROM orders WHERE table_id=? AND branch_id=? AND status IN ('open','partially_paid') ORDER BY created_at DESC LIMIT 1`)
    .get(table_id, branch_id);
}

export function recomputeTotals(order_id) {
  const items = db.prepare(`SELECT qty,unit_price,vat_rate,status,promo_json FROM order_items WHERE order_id=?`).all(order_id)
    .map(item => ({ ...item, promo: parseJson(item.promo_json, null) }));
  const order = db.prepare(`SELECT discount FROM orders WHERE id=?`).get(order_id);
  const discount = order?.discount || 0;
  const totals = orderVatTotals(items, discount);
  db.prepare(`UPDATE orders SET subtotal=?, goods_amount=?, vat_amount=?, total=? WHERE id=?`)
    .run(totals.subtotal, totals.goods_amount, totals.vat_amount, totals.total, order_id);
  return { ...totals, discount };
}

function setTableByOpenOrders(table_id, branch_id = 'sala') {
  if (!table_id) return;
  const open = getOpenOrderForTable(table_id, branch_id);
  db.prepare(`UPDATE tables SET status=? WHERE id=?`).run(open ? 'busy' : 'free', table_id);
  emit('table:updated', getTableState(table_id), branch_id);
}

function requireOpenShiftForSales(branch_id = 'sala') {
  const ops = getOperationsConfig(branch_id);
  if (ops.shifts?.requireOpenShift !== false && !getActiveShift(branch_id)) {
    throw new Error('Cần mở ca làm việc trước khi bán hàng.');
  }
}

// BẢO MẬT: giá tuỳ chọn/topping PHẢI lấy từ thực đơn trên server.
//
// Trước đây server cộng thẳng `m.price` do client gửi và chỉ chặn số âm
// (Math.max(0, …)). Chặn số âm ngăn được việc kéo đơn giá xuống 0, nhưng KHÔNG
// ngăn được chiều ngược lại: một request tự chế (hoặc app đã bị hook) khai báo
// topping có tính phí với price=0 vẫn được server chấp nhận → khách trả giá món
// gốc mà vẫn có topping. Đây là lỗ tiền thật, khai thác được chỉ bằng token hợp
// lệ + HTTP, không cần can thiệp bộ nhớ.
//
// Giờ giá client gửi CHỈ dùng để đối chiếu, không dùng để tính tiền: mỗi mod
// phải khớp một mục trong menu_items.modifiers_json (theo group + name) và lấy
// `sale_price` mà server tự tính. Mod không có trong thực đơn bị từ chối thẳng.
function resolveOrderMods(rawMods, mi) {
  const mods = Array.isArray(rawMods) ? rawMods : [];
  if (!mods.length) return [];
  const catalogue = Array.isArray(mi.modifiers) ? mi.modifiers : [];
  const label = (g, n) => `${g ? `${g} / ` : ''}${n || '(trống)'}`;
  return mods.map(m => {
    const group = String(m?.group ?? '').trim();
    const name = String(m?.name ?? '').trim();
    const def = catalogue.find(d =>
      String(d?.name ?? '').trim() === name &&
      String(d?.group ?? '').trim() === group);
    if (!def) {
      throw new Error(`Tuỳ chọn không có trong thực đơn của "${mi.name}": ${label(group, name)}`);
    }
    return {
      group: String(def.group ?? ''),
      name: String(def.name ?? ''),
      // sale_price do catalog.js tính từ mod.price + VAT của món — nguồn giá duy nhất.
      price: Math.max(0, Math.round(Number(def.sale_price) || 0)),
    };
  });
}

// items: [{menu_item_id, qty, note, mods:[{group,name}]}] or [{sku_id, qty}]
// Lưu ý: `price` trong mods (nếu client gửi) bị BỎ QUA — xem resolveOrderMods.
export function createOrUpdateOrder(options) {
  // order_id: nối món vào ĐÚNG đơn đang mở này (dùng khi GỘP giỏ Retail vào bill F&B,
  // kể cả bill mang về không có bàn). Không truyền thì giữ nguyên hành vi cũ: tìm đơn
  // mở theo bàn, không có thì tạo đơn mới.
  const { branch_id = 'sala', table_id, order_id = null, channel = 'dine_in', source = 'staff_pos', require_confirm = false, items, actor = 'system', skipTransaction = false, linked_pos_device, linked_printer_id } = options;
  if (!items?.length) throw new Error('Order trống');
  requireOpenShiftForSales(branch_id);

  let inTx = false;
  const localAudits = [];
  const localEvents = [];
  const localCallbacks = [];
  const ownsPostCommit = !skipTransaction && !options.stageAudit && !options.stageEvent && !options.deferSideEffect;
  const recordAudit = options.stageAudit || (ownsPostCommit
    ? (action, detail, eventActor) => {
      const entry = buildAuditEntry(action, detail, branch_id, eventActor);
      if (!entry) return;
      insertAuditRow(entry);
      localAudits.push(entry);
    }
    : (action, detail, eventActor) => audit(action, detail, branch_id, eventActor));
  const publishEvent = options.stageEvent || (ownsPostCommit
    ? (event, payload) => localEvents.push({
      event,
      payload: { ...payload, event_id: uid('evt_'), event_version: 1 },
    })
    : emit);
  const deferSideEffect = options.deferSideEffect || (ownsPostCommit
    ? callback => localCallbacks.push(callback)
    : callback => callback());
  if (!skipTransaction) {
    db.prepare('BEGIN IMMEDIATE').run();
    inTx = true;
  }

  try {
    const needsStaffConfirm = source === 'customer_ipad' || require_confirm === true || (source === 'staff_pos' && !!table_id);

    // BẢO MẬT — thiết bị tự gọi món nằm trong tay KHÁCH, phải coi mọi trường
    // trong body là do khách kiểm soát (app có thể bị hook, hoặc gọi thẳng API
    // bằng token rút từ máy). Ba thứ dưới đây là thao tác của NHÂN VIÊN, không
    // được phép đi vào từ nguồn customer_ipad:
    //   - order_id : gộp món vào một bill đang mở BẤT KỲ → khách tự đẩy món của
    //                mình sang bill bàn khác trả hộ.
    //   - sku_id   : thêm hàng retail tuỳ ý vào bill (khách chỉ được gọi món
    //                trong thực đơn, qua menu_item_id).
    //   - linked_* : trỏ bill sang máy POS/máy in khác.
    if (source === 'customer_ipad') {
      if (order_id) throw new Error('Thiết bị tự gọi món không được gộp vào bill có sẵn.');
      if (items.some(line => line?.sku_id)) {
        throw new Error('Thiết bị tự gọi món chỉ được gọi món trong thực đơn.');
      }
      if (linked_pos_device || linked_printer_id) {
        throw new Error('Thiết bị tự gọi món không được chỉ định máy POS/máy in.');
      }
    }

    let order = null;
    if (order_id) {
      order = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=? AND status IN ('open','partially_paid')`)
        .get(order_id, branch_id);
      if (!order) throw new Error('Bill cần gộp không tồn tại hoặc đã đóng.');
    } else if (table_id) {
      order = getOpenOrderForTable(table_id, branch_id);
    }
    const isNew = !order;
    if (isNew) {
      order = insertOpenOrder({ branch_id, table_id: table_id || null, channel });
    }

    if (linked_pos_device || linked_printer_id) {
      db.prepare(`UPDATE orders SET linked_pos_device = ?, linked_printer_id = ? WHERE id = ?`)
        .run(linked_pos_device || null, linked_printer_id || null, order.id);
      order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(order.id);
    }

    // iPad self-order gửi kèm khách (đã check-in bằng SĐT): gắn vào đơn ngay từ
    // lúc tạo để lúc thanh toán — kể cả tự khớp qua webhook QR — vẫn tích điểm
    // đúng người. Chỉ ghi khi đơn CHƯA có khách (không đè lựa chọn của thu ngân).
    const cust = options.customer;
    if (cust && (cust.id || cust.phone)) {
      const snap = JSON.stringify({
        id: String(cust.id || ''),
        name: String(cust.name || '').slice(0, 200),
        phone: String(cust.phone || '').slice(0, 40),
      });
      db.prepare(`UPDATE orders SET customer_json=COALESCE(NULLIF(customer_json,''),?) WHERE id=?`)
        .run(snap, order.id);
    }

    const insItem = db.prepare(`INSERT INTO order_items
      (id,order_id,menu_item_id,sku_id,item_code,item_barcode,unit_snapshot,name,emoji,qty,unit_price,vat_rate,station,sla_minutes,note,mods_json,status,lot_id,promo_json,orig_price,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

    const created = [];
    for (const line of items) {
      const qty = Math.max(1, parseInt(line.qty) || 1);
      const id = uid('oi_');
      if (line.sku_id) {
        const sku = db.prepare(`SELECT * FROM skus WHERE id=? AND branch_id=? AND active=1`).get(line.sku_id, branch_id);
        if (!sku) throw new Error('SKU không tồn tại: ' + line.sku_id);
        // Production invariant: không bán âm kho ở bất kỳ kênh nào. Tầng kho
        // vẫn kiểm tra lại trong transaction payment để chống concurrent sale.
        if (sku.stock < qty) throw new Error(`Hết hàng: ${sku.name} (còn ${sku.stock})`);
        const lotId = line.lot_id || null;
        validateSkuLot(sku, qty, lotId, branch_id);
        // Giá theo bảng giá kênh: đơn retail thuần dùng cấu hình 'retail',
        // retail thêm trong đơn F&B (order bàn) dùng cấu hình 'fnb_retail'.
        const priced = applyChannelPrice(
          sku, branch_id, order.channel === 'retail' ? 'retail' : 'fnb_retail');
        const serverPrice = Number(priced.price) || 0;
        // CHỈNH GIÁ DÒNG: dùng line.price nếu client gửi (route đã xác thực PIN
        // Quản lý). orig_price = giá niêm yết để bill in "gốc → sau đổi". Cho phép
        // 0đ (hàng tặng/khuyến mãi 100%) — bỏ chặn "chưa có giá" khi có chỉnh giá.
        const hasOverride = line.price !== undefined && line.price !== null;
        const unitPrice = hasOverride ? Math.max(0, Math.round(Number(line.price))) : serverPrice;
        const origPrice = (line.orig_price !== undefined && line.orig_price !== null)
          ? Math.round(Number(line.orig_price)) : serverPrice;
        if (!hasOverride && serverPrice <= 0) throw new Error(`SKU chưa có giá bán: ${sku.name}`);
        const lineNote = String(line.note || '').trim().slice(0, 200) || null;
        insItem.run(id, order.id, null, sku.id, sku.code || null, sku.barcode || null, sku.unit || 'cái', sku.name, sku.emoji, qty, unitPrice, Number(sku.vat) || 0, 'retail', 0, lineNote, '[]',
          needsStaffConfirm ? 'pending_confirm' : 'served', lotId, line.promo ? JSON.stringify(line.promo) : null, origPrice, now());
      } else {
        const mi = getMenuItemForOrder(line.menu_item_id, branch_id);
        const mods = resolveOrderMods(line.mods, mi);
        const modSum = mods.reduce((s, m) => s + m.price, 0);
        const listedPrice = salePrice(mi.price, mi.vat_rate, mi.price_includes_vat) + modSum;
        // CHỈNH GIÁ DÒNG cho món F&B — ĐỒNG BỘ với nhánh SKU/Retail ở trên. Dùng
        // line.price nếu client gửi (route đã xác thực PIN Quản lý). orig_price =
        // giá niêm yết (đã gồm modifier) để bill in "gốc → sau đổi". KHÔNG gửi
        // override thì y hệt hành vi cũ (unit = orig = giá niêm yết).
        const hasOverride = line.price !== undefined && line.price !== null;
        const unitPrice = hasOverride ? Math.max(0, Math.round(Number(line.price))) : listedPrice;
        const origPrice = (line.orig_price !== undefined && line.orig_price !== null)
          ? Math.round(Number(line.orig_price)) : listedPrice;
        const lineNote = String(line.note || '').trim().slice(0, 200) || null;
        insItem.run(id, order.id, mi.id, null, mi.code || null, mi.barcode || null, mi.unit || 'phần', mi.name, mi.emoji, qty, unitPrice, Number(mi.vat_rate) || 0, mi.station, mi.sla_minutes,
          lineNote, JSON.stringify(mods), needsStaffConfirm ? 'pending_confirm' : 'new', null, null, origPrice, now());
      }
      created.push(db.prepare(`SELECT * FROM order_items WHERE id=?`).get(id));
    }

    recomputeTotals(order.id);
    if (table_id) {
      db.prepare(`UPDATE tables SET status='busy' WHERE id=?`).run(table_id);
      publishEvent('table:updated', getTableState(table_id), branch_id);
    }
    recordAudit(needsStaffConfirm ? 'order.pending' : 'order.send', { order: order.id, items: created.length, source }, actor);

    const full = getOrder(order.id);
    deferSideEffect(() => archiveOrder(full));
    const printable = created.filter(i => i.status === 'new' && i.station !== 'retail');
    if (printable.length) deferSideEffect(() => printKitchenTickets(full, printable, branch_id, actor));
    deferSideEffect(() => printCupLabels(full, created, branch_id));
    publishEvent('order:new', { order: full, newItems: created, isNew, pendingConfirm: needsStaffConfirm }, branch_id);
    if (needsStaffConfirm) {
      publishEvent('order:pending', { order: full, newItems: created }, branch_id);
      // A2: PUSH FCM để nhân viên nhận thông báo cả khi ĐÃ TẮT app/khoá máy
      // (socket/AppNotifier chỉ chạy khi app đang mở). Lọc THEO ĐỊNH TUYẾN trong
      // Cài đặt (category 'fnb_order'). Best-effort, không chặn.
      deferSideEffect(() => sendPushForCategory(branch_id, 'fnb_order', {
        title: 'Khách tự gọi món',
        body: `Bàn ${full.table_code || '—'} có món chờ xác nhận`,
        data: { type: 'order_pending', order_id: full.id },
      }).catch(() => {}));
    }
    if (printable.length) publishEvent('kds:refresh', { station: 'all' }, branch_id);
    publishEvent('stats:dirty', {}, branch_id);

    if (inTx) {
      db.prepare('COMMIT').run();
      inTx = false;
      for (const entry of localAudits) auditPostCommit(entry);
      for (const item of localEvents) emit(item.event, item.payload, branch_id);
      for (const callback of localCallbacks) {
        try { callback(); }
        catch (error) {
          logSystem({
            level: 'error', source: 'orders', eventType: 'post_commit_callback_failed',
            title: 'Order committed but a post-commit task failed',
            message: error?.message || String(error), action: 'order_post_commit',
          });
        }
      }
    }
    return full;
  } catch (err) {
    if (inTx) {
      db.prepare('ROLLBACK').run();
    }
    throw err;
  }
}

export function getOrder(order_id) {
  if (!order_id) return null;
  const order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(order_id);
  if (!order) return null;
  const rawItems = db.prepare(`SELECT * FROM order_items WHERE order_id=? ORDER BY created_at`).all(order_id);
  // PERF: gom ảnh theo LÔ thay vì N+1 (trước đây mỗi dòng món chạy 1 query menu_items
  // hoặc skus — đơn 30 món = 30 query phụ, getOrder được gọi ở mọi lần đọc/realtime).
  const miIds = [...new Set(rawItems.filter(i => i.menu_item_id).map(i => i.menu_item_id))];
  const skuIds = [...new Set(rawItems.filter(i => !i.menu_item_id && i.sku_id).map(i => i.sku_id))];
  const miImg = new Map(), miUnit = new Map();
  if (miIds.length) {
    for (const r of db.prepare(`SELECT id,image FROM menu_items WHERE branch_id=? AND id IN (${miIds.map(() => '?').join(',')})`).all(order.branch_id, ...miIds)) {
      miImg.set(r.id, r.image || null); miUnit.set(r.id, 'phần');
    }
  }
  const skuImg = new Map(), skuUnit = new Map();
  if (skuIds.length) {
    for (const r of db.prepare(`SELECT id,image,unit FROM skus WHERE id IN (${skuIds.map(() => '?').join(',')})`).all(...skuIds)) {
      skuImg.set(r.id, r.image || null); skuUnit.set(r.id, r.unit || 'cái');
    }
  }
  order.items = rawItems.map(it => ({
    ...it,
    image: it.menu_item_id ? (miImg.get(it.menu_item_id) || null) : (it.sku_id ? (skuImg.get(it.sku_id) || null) : null),
    unit: it.unit_snapshot || (it.menu_item_id ? (miUnit.get(it.menu_item_id) || 'phần') : (it.sku_id ? (skuUnit.get(it.sku_id) || 'cái') : '')),
    mods: parseJson(it.mods_json, []),
    promo: parseJson(it.promo_json, null),
  }));
  if (order.table_id) {
    const t = db.prepare(`SELECT code,zone FROM tables WHERE id=?`).get(order.table_id);
    order.table_code = t?.code;
    order.zone = t?.zone;
  }
  return order;
}

export function listPendingConfirmations(branch_id = 'sala') {
  const rows = db.prepare(`
    SELECT oi.*, o.created_at AS order_created, o.table_id, o.channel, t.code AS table_code, t.zone AS zone
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id
    LEFT JOIN tables t ON t.id=o.table_id
    WHERE o.branch_id=? AND o.status IN ('open','partially_paid') AND oi.status='pending_confirm'
    ORDER BY oi.created_at`).all(branch_id)
    .map(r => ({ ...r, mods: parseJson(r.mods_json, []), promo: parseJson(r.promo_json, null) }));
  const groups = new Map();
  for (const it of rows) {
    if (!groups.has(it.order_id)) {
      groups.set(it.order_id, {
        order_id: it.order_id,
        table_id: it.table_id,
        table_code: it.table_code || '—',
        zone: it.zone || '',
        channel: it.channel,
        order_created: it.order_created,
        created_at: it.created_at,
        items: [],
      });
    }
    const g = groups.get(it.order_id);
    g.items.push(it);
    if (new Date(it.created_at) < new Date(g.created_at)) g.created_at = it.created_at;
  }
  return [...groups.values()].map(g => ({
    ...g,
    item_count: g.items.reduce((s, i) => s + (Number(i.qty) || 0), 0),
    line_count: g.items.length,
    total: g.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unit_price) || 0), 0),
  }));
}

export function confirmPendingItems(order_id, item_ids = [], branch_id = 'sala', actor = 'system') {
  const order = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=? AND status IN ('open','partially_paid')`).get(order_id, branch_id);
  if (!order) throw new Error('Bill không tồn tại hoặc đã đóng');
  const ids = new Set(Array.isArray(item_ids) && item_ids.length ? item_ids : []);
  const pending = db.prepare(`SELECT * FROM order_items WHERE order_id=? AND status='pending_confirm' ORDER BY created_at`).all(order_id)
    .filter(i => !ids.size || ids.has(i.id));
  if (!pending.length) throw new Error('Không có món chờ xác nhận');
  const upd = db.prepare(`UPDATE order_items SET status=? WHERE id=?`);
  for (const it of pending) upd.run(it.station === 'retail' ? 'served' : 'new', it.id);
  audit('order.confirm', { order: order_id, items: pending.length }, branch_id, actor);
  const full = getOrder(order_id);
  archiveOrder(full);
  const confirmed = db.prepare(`SELECT * FROM order_items WHERE id IN (${pending.map(() => '?').join(',')}) ORDER BY created_at`).all(...pending.map(i => i.id));
  const kitchenItems = confirmed.filter(i => i.status === 'new' && i.station !== 'retail');
  if (kitchenItems.length) printKitchenTickets(full, kitchenItems, branch_id, actor);
  printCupLabels(full, confirmed, branch_id);
  emit('order:updated', full, branch_id);
  emit('order:pending', { order: full, confirmed: pending.map(i => i.id) }, branch_id);
  if (kitchenItems.length) {
    emit('order:new', { order: full, newItems: kitchenItems, isNew: false, confirmed: true }, branch_id);
    emit('kds:refresh', { station: 'all' }, branch_id);
  }
  emit('stats:dirty', {}, branch_id);
  return full;
}

// SỬA GHI CHÚ MÓN ĐÃ GỬI (persisted). Ghi chú không ảnh hưởng tiền nên không cần
// PIN; chỉ đổi cột note rồi phát realtime để KDS/bill thấy ngay. (Chỉnh GIÁ món đã
// gửi thì phức tạp hơn — hủy rồi thêm lại; ở đây chỉ cho sửa ghi chú.)
export function updateItemNote(item_id, note, branch_id = 'sala', actor = 'system') {
  const item = db.prepare(
    `SELECT oi.* FROM order_items oi JOIN orders o ON o.id=oi.order_id
     WHERE oi.id=? AND o.branch_id=?`).get(item_id, branch_id);
  if (!item) throw new Error('Món không tồn tại');
  const clean = String(note || '').trim().slice(0, 200) || null;
  db.prepare(`UPDATE order_items SET note=? WHERE id=?`).run(clean, item_id);
  audit('order.item_note', { order: item.order_id, item: item_id }, branch_id, actor);
  const full = getOrder(item.order_id);
  archiveOrder(full);
  emit('order:updated', full, branch_id);
  return full;
}

export function rejectPendingItems(order_id, item_ids = [], reason = '', branch_id = 'sala', actor = 'system') {
  const order = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=? AND status IN ('open','partially_paid')`).get(order_id, branch_id);
  if (!order) throw new Error('Bill không tồn tại hoặc đã đóng');
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new Error('Cần nhập lý do từ chối');
  const ids = new Set(Array.isArray(item_ids) && item_ids.length ? item_ids : []);
  const pending = db.prepare(`SELECT * FROM order_items WHERE order_id=? AND status='pending_confirm' ORDER BY created_at`).all(order_id)
    .filter(i => !ids.size || ids.has(i.id));
  if (!pending.length) throw new Error('Không có món chờ xác nhận');
  const upd = db.prepare(`UPDATE order_items SET status='cancelled', reject_reason=? WHERE id=?`);
  for (const it of pending) upd.run(cleanReason, it.id);
  recomputeTotals(order_id);
  const activeLeft = db.prepare(`SELECT COUNT(*) n FROM order_items WHERE order_id=? AND status!='cancelled'`).get(order_id).n;
  if (!activeLeft) {
    db.prepare(`UPDATE orders SET status='void', subtotal=0, goods_amount=0, vat_amount=0, total=0 WHERE id=?`).run(order_id);
    if (order.table_id) setTableByOpenOrders(order.table_id, branch_id);
  }
  const full = getOrder(order_id);
  archiveOrder(full);
  audit('order.reject', { order: order_id, items: pending.length, reason: cleanReason }, branch_id, actor);
  emit('order:updated', full, branch_id);
  emit('order:pending', { order: full, rejected: pending.map(i => i.id), reason: cleanReason }, branch_id);
  emit('stats:dirty', {}, branch_id);
  return full;
}

/** DỌN SẠCH MỘT BÀN — lối thoát hiểm khi bàn kẹt ở trạng thái sai.
 *
 *  Dùng khi bill của bàn rơi vào trạng thái không thao tác tiếp được (báo "Bill
 *  không tồn tại hoặc đã đóng", món treo mãi ở "Chờ xác nhận"…). Thu ngân nhấn
 *  giữ vào bàn để gọi, thay vì phải chờ kỹ thuật vào sửa tay trong DB.
 *
 *  AN TOÀN: TỪ CHỐI nếu bill đã ghi nhận tiền. Xoá trắng một bill đã thu tiền là
 *  làm mất dấu khoản tiền đó — trường hợp ấy phải đi đường hoàn tiền (refund) để
 *  còn chứng từ, không phải xoá âm thầm.
 *
 *  Xoá ở đây = huỷ toàn bộ món + đưa bill về 'void' + trả bàn về trống. KHÔNG
 *  xoá dòng khỏi DB: bill vẫn nằm trong lịch sử và nhật ký để đối soát về sau. */
export function resetTable(table_id, branch_id = 'sala', actor = 'system', reason = '', {
  refundPaid = false,
} = {}) {
  const table = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(table_id, branch_id);
  if (!table) throw new Error('Bàn không tồn tại');

  const orders = db.prepare(
    `SELECT * FROM orders WHERE table_id=? AND branch_id=? AND status IN ('open','partially_paid')`,
  ).all(table_id, branch_id);

  // Tiền đã ghi nhận trên từng bill của bàn.
  const daThu = new Map();
  for (const o of orders) {
    daThu.set(o.id, db.prepare(`SELECT COALESCE(SUM(total),0) n FROM payments WHERE order_id=?`).get(o.id)?.n || 0);
  }

  if (!refundPaid) {
    for (const o of orders) {
      const paid = daThu.get(o.id) || 0;
      if (paid > 0) {
        throw Object.assign(
          new Error(`Bill ${o.bill_no || o.id} đã ghi nhận ${Math.round(paid).toLocaleString('vi-VN')}đ. `
            + 'Dùng chức năng Hoàn tiền / Đổi trả để còn chứng từ, không xoá trắng bàn.'),
          { status: 409, code: 'PAID_NEEDS_REFUND', order_id: o.id, paid });
      }
    }
  }

  db.prepare('BEGIN IMMEDIATE').run();
  try {
    let items = 0;
    let refunded = 0;
    for (const o of orders) {
      // HOÀN TIỀN CÓ CHỨNG TỪ: ghi một khoản thu ÂM đối ứng đúng số đã nhận,
      // thay vì xoá dấu vết khoản tiền đó.
      //
      // Bàn từng kẹt cứng ở đây: bill nhận 30.000đ rồi mất hết món (khách bỏ
      // về, món bị huỷ, đồng bộ lỗi…). Không thanh toán tiếp được vì không còn
      // gì để bán, không hoàn trả được vì đường hoàn trả đòi đơn đã 'paid', mà
      // dọn bàn thì bị chặn vì đã có tiền. Bàn nằm chết, kể cả admin.
      //
      // Khoản âm này khiến doanh thu của bill về 0 nhưng CẢ HAI dòng tiền đều
      // còn trong sổ để đối soát — đúng tinh thần "để còn chứng từ".
      const paid = daThu.get(o.id) || 0;
      if (paid > 0) {
        const pid = uid('pay_');
        db.prepare(`INSERT INTO payments (id,order_id,shift_id,cashier,total,created_at) VALUES (?,?,?,?,?,?)`)
          .run(pid, o.id, getActiveShift(branch_id)?.id || null, actor, -paid, now());
        db.prepare(`INSERT INTO payment_lines (id,payment_id,method,amount,tendered_amount,reference) VALUES (?,?,?,?,?,?)`)
          .run(uid('pl_'), pid, 'cash', -paid, -paid,
            `refund:reset_table:${String(reason || '').slice(0, 80)}`);
        refunded += paid;
      }
      items += db.prepare(`UPDATE order_items SET status='cancelled' WHERE order_id=? AND status!='cancelled'`)
        .run(o.id).changes || 0;
      db.prepare(`UPDATE orders SET status='void', subtotal=0, goods_amount=0, vat_amount=0, total=0, discount=0 WHERE id=?`)
        .run(o.id);
    }
    db.prepare(`UPDATE tables SET status='free' WHERE id=?`).run(table_id);
    // Chuông gọi nhân viên còn treo ở bàn này cũng đóng luôn, nếu không bàn vừa
    // dọn xong đã lại nhấp nháy đòi phục vụ.
    db.prepare(`UPDATE staff_calls SET status='done' WHERE table_id=? AND status='open'`).run(table_id);
    db.prepare('COMMIT').run();

    for (const o of orders) archiveOrder(getOrder(o.id));
    audit('table.reset', {
      table: table_id, table_code: table.code || '',
      orders: orders.map(o => o.bill_no || o.id), items, reason: String(reason || '').slice(0, 300),
    }, branch_id, actor);
    emit('table:updated', getTableState(table_id), branch_id);
    for (const o of orders) emit('order:updated', getOrder(o.id), branch_id);
    emit('stats:dirty', {}, branch_id);
    return { ok: true, table_id, orders_voided: orders.length, items_cancelled: items };
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
}

export function moveTable(from_table_id, to_table_id, branch_id = 'sala', actor = 'system') {
  if (from_table_id === to_table_id) throw new Error('Bàn chuyển phải khác bàn hiện tại');
  const order = getOpenOrderForTable(from_table_id, branch_id);
  if (!order) throw new Error('Bàn hiện tại chưa có bill để chuyển');
  const targetOrder = getOpenOrderForTable(to_table_id, branch_id);
  if (targetOrder) throw new Error('Bàn đích đang có bill. Hãy dùng Gộp bàn.');
  const source = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(from_table_id, branch_id);
  const target = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(to_table_id, branch_id);
  if (!source) throw new Error('Bàn nguồn không tồn tại');
  if (!target) throw new Error('Bàn đích không tồn tại');
  
  const items = db.prepare(`SELECT * FROM order_items WHERE order_id=? AND status!='cancelled'`).all(order.id);
  const upd = db.prepare(`UPDATE order_items SET table_path=? WHERE id=?`);
  for (const item of items) {
    const currentPath = item.table_path || source.code;
    const newPath = currentPath + ' => ' + target.code;
    upd.run(newPath, item.id);
  }

  db.prepare(`UPDATE orders SET table_id=? WHERE id=?`).run(to_table_id, order.id);
  setTableByOpenOrders(from_table_id, branch_id);
  setTableByOpenOrders(to_table_id, branch_id);
  audit('table.move', { order: order.id, from: from_table_id, to: to_table_id, from_code: source.code, to_code: target.code }, branch_id, actor);
  printKitchenUpdate(order, items, branch_id, actor, 'move_table', {
    // Mẫu phiếu đã có tiền tố "BÀN ", vì vậy giá trị này tạo đúng:
    // "BÀN A08 => BÀN B03" (không bị thiếu chữ BÀN ở bàn đích).
    tableDisplay: `${source.code} => BÀN ${target.code}`,
  });
  emit('order:updated', getOrder(order.id), branch_id);
  emit('kds:refresh', {}, branch_id);
  archiveOrder(getOrder(order.id));
  return getOrder(order.id);
}

export function mergeTables(source_table_id, target_table_id, branch_id = 'sala', actor = 'system') {
  if (source_table_id === target_table_id) throw new Error('Không thể gộp cùng một bàn');
  const source = getOpenOrderForTable(source_table_id, branch_id);
  if (!source) throw new Error('Bàn nguồn chưa có bill');
  let target = getOpenOrderForTable(target_table_id, branch_id);
  const sourceTable = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(source_table_id, branch_id);
  const targetTable = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(target_table_id, branch_id);
  if (!sourceTable) throw new Error('Bàn nguồn không tồn tại');
  if (!targetTable) throw new Error('Bàn đích không tồn tại');
  if (!target) return moveTable(source_table_id, target_table_id, branch_id, actor);
  
  const items = db.prepare(`SELECT * FROM order_items WHERE order_id=? AND status!='cancelled'`).all(source.id);
  const upd = db.prepare(`UPDATE order_items SET order_id=?, table_path=? WHERE id=?`);
  for (const item of items) {
    const currentPath = item.table_path || sourceTable.code;
    const newPath = currentPath + ' => ' + targetTable.code;
    upd.run(target.id, newPath, item.id);
  }

  db.prepare(`UPDATE orders SET status='void', subtotal=0,goods_amount=0,vat_amount=0,total=0 WHERE id=?`).run(source.id);
  recomputeTotals(target.id);
  setTableByOpenOrders(source_table_id, branch_id);
  setTableByOpenOrders(target_table_id, branch_id);
  audit('table.merge', {
    source_order: source.id,
    target_order: target.id,
    from: source_table_id,
    to: target_table_id,
    from_code: sourceTable.code,
    to_code: targetTable.code,
  }, branch_id, actor);
  emit('order:updated', getOrder(target.id), branch_id);
  emit('kds:refresh', {}, branch_id);
  archiveOrder(getOrder(target.id));
  archiveOrder(getOrder(source.id));
  return getOrder(target.id);
}

export function splitOrderItems(order_id, item_ids = [], branch_id = 'sala', actor = 'system') {
  const order = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=? AND status IN ('open','partially_paid')`).get(order_id, branch_id);
  if (!order) throw new Error('Bill không tồn tại hoặc đã đóng');
  const ids = [...new Set(Array.isArray(item_ids) ? item_ids : [])];
  if (!ids.length) throw new Error('Chọn ít nhất một dòng để tách bill');
  const active = db.prepare(`SELECT id FROM order_items WHERE order_id=? AND status!='cancelled'`).all(order_id).map(r => r.id);
  const selected = ids.filter(id => active.includes(id));
  if (!selected.length) throw new Error('Không tìm thấy dòng hợp lệ để tách');
  if (selected.length >= active.length) throw new Error('Không cần tách nếu chọn toàn bộ bill');
  const newId = insertOpenOrder({ branch_id, table_id: order.table_id || null, channel: order.channel || 'dine_in' }).id;
  const upd = db.prepare(`UPDATE order_items SET order_id=? WHERE id=? AND order_id=?`);
  for (const id of selected) upd.run(newId, id, order_id);
  recomputeTotals(order_id);
  recomputeTotals(newId);
  if (order.table_id) setTableByOpenOrders(order.table_id, branch_id);
  const table = order.table_id ? db.prepare(`SELECT code FROM tables WHERE id=?`).get(order.table_id) : null;
  audit('bill.split', { source_order: order_id, split_order: newId, table: order.table_id, table_code: table?.code, items: selected.length }, branch_id, actor);
  emit('order:updated', getOrder(order_id), branch_id);
  emit('order:updated', getOrder(newId), branch_id);
  const sourceOrder = getOrder(order_id);
  const splitOrder = getOrder(newId);
  archiveOrder(sourceOrder);
  archiveOrder(splitOrder);
  return { source: sourceOrder, split: splitOrder };
}

function validateSkuLot(sku, qty, lot_id, branch_id) {
  if (!lot_id) return;
  const lot = db.prepare(`SELECT * FROM stock_lots WHERE id=? AND branch_id=? AND item_type='sku' AND item_id=?`)
    .get(lot_id, branch_id, sku.id);
  if (!lot) throw new Error('Lot không tồn tại cho ' + sku.name);
  if (lot.qty_on_hand + 0.000001 < qty) {
    throw new Error(`Lot ${lot.lot_no} của ${sku.name} không đủ tồn (còn ${lot.qty_on_hand})`);
  }
}


// Tổng hợp món cho sơ đồ bàn: items_count = tổng dòng còn hiệu lực; done = ĐÃ LÊN theo
// KDS (ready/served). Dùng CHUNG chuỗi này cho cả đường 1-bàn lẫn nạp-theo-lô.
const TABLE_ITEM_AGG = `COUNT(*) n, COALESCE(SUM(CASE WHEN status IN ('ready','served') THEN 1 ELSE 0 END), 0) done`;

// Ghép trạng thái 1 bàn từ dữ liệu đã nạp sẵn (bàn + đơn mở + gọi NV + tổng hợp món).
// KHÔNG chạy query — MỘT nguồn shape duy nhất cho getTableState (1 bàn) và listTables (lô),
// để hai đường không lệch nhau. Sơ đồ bàn POS: "Chưa có món / Chưa đủ / Đã đủ / Đã in tạm tính".
function buildTableState(t, order, call, agg) {
  let customer = null;
  if (order?.customer_json) {
    try { customer = JSON.parse(order.customer_json); } catch { /* JSON hỏng → bỏ */ }
  }
  return {
    ...t,
    amount: order?.total || 0,
    order_id: order?.id || null,
    items_count: agg?.n || 0,
    items_done: agg?.done || 0,
    prebill_printed: order?.prebill_printed_at ? 1 : 0,
    customer_name: customer?.name || '',
    customer_phone: customer?.phone || '',
    call: call?.reason || null,
    status: call ? 'calling' : t.status,
  };
}

export function getTableState(table_id) {
  if (!table_id) return null;
  const t = db.prepare(`SELECT * FROM tables WHERE id=?`).get(table_id);
  if (!t) return null;
  const order = getOpenOrderForTable(table_id, t.branch_id);
  const call = db.prepare(`SELECT * FROM staff_calls WHERE table_id=? AND status='open' ORDER BY created_at DESC LIMIT 1`).get(table_id);
  const agg = order
    ? db.prepare(`SELECT ${TABLE_ITEM_AGG} FROM order_items WHERE order_id=? AND status!='cancelled'`).get(order.id)
    : null;
  return buildTableState(t, order, call, agg);
}

// PERF: trước đây gọi getTableState cho TỪNG bàn → ~4 query/bàn (50 bàn ≈ 200 query mỗi lần
// refresh sơ đồ). Giờ nạp theo LÔ: 1 query bàn + 1 đơn mở + 1 gọi NV + 1 tổng hợp món, rồi
// ghép trong JS bằng cùng buildTableState → kết quả y hệt bản 1-bàn, số truy vấn cố định.
export function listTables(branch_id = 'sala') {
  const tables = db.prepare(`SELECT * FROM tables WHERE branch_id=? ORDER BY code`).all(branch_id);
  if (!tables.length) return [];

  const orderByTable = new Map();
  for (const o of db.prepare(`SELECT * FROM orders WHERE branch_id=? AND status IN ('open','partially_paid') ORDER BY created_at DESC`).all(branch_id)) {
    if (o.table_id && !orderByTable.has(o.table_id)) orderByTable.set(o.table_id, o); // DESC → giữ đơn mở MỚI NHẤT mỗi bàn (khớp getOpenOrderForTable)
  }
  const callByTable = new Map();
  for (const c of db.prepare(`SELECT * FROM staff_calls WHERE branch_id=? AND status='open' ORDER BY created_at DESC`).all(branch_id)) {
    if (c.table_id && !callByTable.has(c.table_id)) callByTable.set(c.table_id, c);
  }
  const openIds = [...orderByTable.values()].map(o => o.id);
  const aggByOrder = new Map();
  if (openIds.length) {
    for (const r of db.prepare(`SELECT order_id, ${TABLE_ITEM_AGG} FROM order_items WHERE order_id IN (${openIds.map(() => '?').join(',')}) AND status!='cancelled' GROUP BY order_id`).all(...openIds)) {
      aggByOrder.set(r.order_id, r);
    }
  }
  return tables.map(t => {
    const order = orderByTable.get(t.id) || null;
    const call = callByTable.get(t.id) || null;
    const agg = order ? (aggByOrder.get(order.id) || null) : null;
    return buildTableState(t, order, call, agg);
  });
}

export function getStationTickets(station, branch_id = 'sala') {
  const where = station === 'all' ? "AND oi.station!='retail'" : 'AND oi.station=?';
  const params = station === 'all' ? [branch_id] : [branch_id, station];
  const rows = db.prepare(`
    SELECT oi.*, o.created_at AS order_created, t.code AS table_code
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id
    LEFT JOIN tables t ON t.id=o.table_id
    WHERE o.branch_id=? AND (oi.status IN ('new','accepted','preparing','ready') OR (oi.status='cancelled' AND oi.kds_dismissed=0)) ${where}
    ORDER BY oi.created_at`).all(...params);
  return rows.map(r => ({ ...r, mods: JSON.parse(r.mods_json || '[]') }));
}

export function setItemStatus(item_id, status, branch_id = 'sala', actor = 'system') {
  const valid = ['new', 'accepted', 'preparing', 'ready', 'served', 'cancelled'];
  if (!valid.includes(status)) throw new Error('Trạng thái không hợp lệ');
  const item = db.prepare(`SELECT * FROM order_items WHERE id=?`).get(item_id);
  if (!item) throw new Error('Item không tồn tại');
  const ts = now();
  const set = { accepted: 'accepted_at', ready: 'ready_at', served: 'served_at' }[status];
  if (set) db.prepare(`UPDATE order_items SET status=?, ${set}=? WHERE id=?`).run(status, ts, item_id);
  else db.prepare(`UPDATE order_items SET status=? WHERE id=?`).run(status, item_id);

  audit('item.status', { item: item_id, status }, branch_id, actor);
  const order = getOrder(item.order_id);
  archiveOrder(order);
  // When a dish becomes ready, auto-print a per-dish runner slip (with table no.).
  if (status === 'ready') printRunnerSlip(item, order, branch_id);
  emit('order:item', { order_id: item.order_id, item_id, status, order }, branch_id);
  emit('kds:refresh', { station: item.station }, branch_id);
  // Tiến độ món đổi → sơ đồ bàn POS cập nhật trạng thái "x/y món" ngay.
  if (order?.table_id) emit('table:updated', getTableState(order.table_id), branch_id);
  return db.prepare(`SELECT * FROM order_items WHERE id=?`).get(item_id);
}

export function cancelItem(item_id, reason, branch_id = 'sala', actor = 'system') {
  const cancelledItem = db.prepare(`SELECT * FROM order_items WHERE id=?`).get(item_id);
  if (!cancelledItem) throw new Error('Item không tồn tại');
  const beforeCancel = getOrder(cancelledItem.order_id);
  setItemStatus(item_id, 'cancelled', branch_id, actor);
  const item = db.prepare(`SELECT order_id FROM order_items WHERE id=?`).get(item_id);
  recomputeTotals(item.order_id);
  // SNAPSHOT tại thời điểm huỷ — để nhật ký đọc được bằng tiếng Việt ngay cả khi
  // sau này món bị đổi tên/xoá. Dữ liệu đã có sẵn (cancelledItem/beforeCancel),
  // chỉ cần ghi vào detail. Giữ nguyên `item`+`reason` cũ (tương thích ngược).
  audit('item.cancel', {
    item: item_id,
    reason,
    item_name: cancelledItem.name || null,
    sku: cancelledItem.sku_id || cancelledItem.item_code || null,
    qty: cancelledItem.qty ?? null,
    unit_price: cancelledItem.unit_price ?? null,
    station: cancelledItem.station || null,
    order_id: cancelledItem.order_id,
    table_id: beforeCancel?.table_id || null,
    bill_no: beforeCancel?.bill_no || null,
  }, branch_id, actor);
  if (cancelledItem.station !== 'retail') {
    printKitchenUpdate(beforeCancel, [{ ...cancelledItem, cancelled: true }], branch_id, actor,
      'cancel_item');
  }

  // Hủy DÒNG ACTIVE CUỐI CÙNG của đơn → đóng đơn rỗng và GIẢI PHÓNG BÀN (giống
  // rejectPendingItems ở trên). Thiếu bước này thì đơn vẫn 'open' và tables.status
  // vẫn 'busy' → bàn kẹt "Đang phục vụ" dù giỏ đã trống (đúng lỗi "xóa hết món
  // mà bàn vẫn bị giữ"). setTableByOpenOrders tự emit table:updated về 'free'.
  const ord = db.prepare(`SELECT id, table_id, status FROM orders WHERE id=?`).get(item.order_id);
  if (ord && ord.status === 'open') {
    const activeLeft = db.prepare(`SELECT COUNT(*) n FROM order_items WHERE order_id=? AND status!='cancelled'`).get(item.order_id).n;
    if (!activeLeft) {
      db.prepare(`UPDATE orders SET status='void', subtotal=0, goods_amount=0, vat_amount=0, total=0 WHERE id=?`).run(item.order_id);
      if (ord.table_id) setTableByOpenOrders(ord.table_id, branch_id);
    }
  }

  const order = getOrder(item.order_id);
  archiveOrder(order);
  emit('order:updated', order, branch_id);
  return order;
}

export function createStaffCall(table_id, reason, branch_id = 'sala') {
  const id = uid('sc_');
  db.prepare(`INSERT INTO staff_calls (id,branch_id,table_id,reason,status,created_at) VALUES (?,?,?,?,'open',?)`)
    .run(id, branch_id, table_id, reason, now());
  audit('staff.call', { table: table_id, reason }, branch_id);
  emit('staff:call', { id, table_id, reason }, branch_id);
  // A2: PUSH FCM khách gọi nhân viên — nhận cả khi tắt app. Lọc theo định tuyến
  // (category 'fnb_order' như banner in-app). Best-effort.
  sendPushForCategory(branch_id, 'fnb_order', {
    title: 'Khách gọi nhân viên',
    body: String(reason || '').trim() || 'Có khách cần hỗ trợ',
    data: { type: 'staff_call', table_id: String(table_id || '') },
  }).catch(() => {});
  emit('table:updated', getTableState(table_id), branch_id);
  return { id };
}

export function resolveStaffCall(table_id, branch_id = 'sala', publishEvent = emit) {
  db.prepare(`UPDATE staff_calls SET status='done' WHERE table_id=? AND status='open'`).run(table_id);
  publishEvent('table:updated', getTableState(table_id), branch_id);
}

export function listStaffCalls(branch_id = 'sala') {
  return db.prepare(`SELECT sc.*, t.code AS table_code FROM staff_calls sc
    JOIN tables t ON t.id=sc.table_id WHERE sc.branch_id=? AND sc.status='open' ORDER BY sc.created_at`).all(branch_id);
}

export function createTable({ branch_id = 'sala', zone, zone_id = null, code, seats = 4,
    pos_x = -1, pos_y = -1, grid_w = 1, grid_h = 1 }) {
  const cleanCode = String(code || '').trim();
  if (!cleanCode) throw new Error('Thiếu số bàn');
  // Khu vực nhận theo zone_id (mô hình mới) hoặc tên zone (tương thích cũ). Tên
  // hiển thị `zone` LẤY TỪ bảng zones để đồng bộ khi đổi tên khu vực.
  const z = resolveZone(branch_id, { zone_id, zone });
  const cleanZone = z ? z.name : String(zone || '').trim();

  const existing = db.prepare(`SELECT 1 FROM tables WHERE branch_id=? AND code=?`).get(branch_id, cleanCode);
  if (existing) throw new Error(`Số bàn "${cleanCode}" đã tồn tại`);

  const id = uid('t_');
  db.prepare(`INSERT INTO tables (id, branch_id, zone, zone_id, code, seats, status, pos_x, pos_y, grid_w, grid_h)
      VALUES (?, ?, ?, ?, ?, ?, 'free', ?, ?, ?, ?)`)
    .run(id, branch_id, cleanZone, z ? z.id : null, cleanCode, parseInt(seats) || 4,
      _num(pos_x, -1), _num(pos_y, -1), Math.max(1, _int(grid_w, 1)), Math.max(1, _int(grid_h, 1)));

  audit('table.create', { id, zone: cleanZone, code: cleanCode, seats }, branch_id);
  const state = getTableState(id);
  emit('table:updated', state, branch_id);
  emit('stats:dirty', {}, branch_id);
  return state;
}

function _int(v, d = 0) { const n = parseInt(v); return Number.isFinite(n) ? n : d; }
// Vị trí bàn trên sơ đồ là SỐ THỰC (đặt tự do, không snap ô) — đơn vị = ô lưới,
// vd pos_x=3.5 nằm giữa cột 3 và 4. Lưu float để kéo lệch tuỳ ý.
function _num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

// Khu vực theo zone_id (ưu tiên) hoặc theo TÊN (tạo mới nếu chưa có, cho tương
// thích luồng cũ "nhập tên khu vực"). Trả { id, name } hoặc null.
function resolveZone(branch_id, { zone_id = null, zone = null } = {}) {
  if (zone_id) {
    const z = db.prepare(`SELECT id,name FROM zones WHERE id=? AND branch_id=?`).get(zone_id, branch_id);
    if (z) return z;
  }
  const name = String(zone || '').trim();
  if (!name) return null;
  const found = db.prepare(`SELECT id,name FROM zones WHERE branch_id=? AND name=?`).get(branch_id, name);
  if (found) return found;
  return createZone({ branch_id, name });
}

export function updateTable(id, { zone, zone_id, code, seats, pos_x, pos_y, grid_w, grid_h } = {}, branch_id = 'sala') {
  const table = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!table) throw new Error('Bàn không tồn tại');

  const z = (zone_id !== undefined || zone !== undefined)
    ? resolveZone(branch_id, { zone_id, zone }) : null;
  const cleanZone = z ? z.name : table.zone;
  const zoneId = z ? z.id : table.zone_id;
  const cleanCode = code !== undefined ? String(code).trim() : table.code;
  const numSeats = seats !== undefined ? parseInt(seats) || 4 : table.seats;

  if (!cleanCode) throw new Error('Thiếu số bàn');

  if (cleanCode !== table.code) {
    const existing = db.prepare(`SELECT 1 FROM tables WHERE branch_id=? AND code=? AND id!=?`).get(branch_id, cleanCode, id);
    if (existing) throw new Error(`Số bàn "${cleanCode}" đã tồn tại`);
  }

  db.prepare(`UPDATE tables SET zone=?, zone_id=?, code=?, seats=?, pos_x=?, pos_y=?, grid_w=?, grid_h=? WHERE id=?`)
    .run(cleanZone, zoneId, cleanCode, numSeats,
      pos_x !== undefined ? _num(pos_x, -1) : table.pos_x,
      pos_y !== undefined ? _num(pos_y, -1) : table.pos_y,
      grid_w !== undefined ? Math.max(1, _int(grid_w, 1)) : table.grid_w,
      grid_h !== undefined ? Math.max(1, _int(grid_h, 1)) : table.grid_h, id);

  audit('table.update', { id, zone: cleanZone, code: cleanCode, seats: numSeats }, branch_id);
  const state = getTableState(id);
  emit('table:updated', state, branch_id);
  emit('stats:dirty', {}, branch_id);
  return state;
}

// ── KHU VỰC (zones) — thực thể riêng: tạo xong dù KHÔNG có bàn vẫn hiện ─────────
export function listZones(branch_id = 'sala') {
  return db.prepare(`SELECT id,name,sort FROM zones WHERE branch_id=? ORDER BY sort,name`).all(branch_id);
}

export function createZone({ branch_id = 'sala', name }) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Thiếu tên khu vực');
  const dup = db.prepare(`SELECT id,name FROM zones WHERE branch_id=? AND name=?`).get(branch_id, clean);
  if (dup) return dup;
  const maxSort = db.prepare(`SELECT COALESCE(MAX(sort),-1) m FROM zones WHERE branch_id=?`).get(branch_id).m;
  const id = uid('zone_');
  db.prepare(`INSERT INTO zones (id,branch_id,name,sort) VALUES (?,?,?,?)`).run(id, branch_id, clean, maxSort + 1);
  audit('zone.create', { id, name: clean }, branch_id);
  emit('table:updated', { zones_changed: true }, branch_id);
  return { id, name: clean };
}

export function updateZone(id, { name, sort } = {}, branch_id = 'sala') {
  const z = db.prepare(`SELECT * FROM zones WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!z) throw new Error('Khu vực không tồn tại');
  const clean = name !== undefined ? String(name).trim() : z.name;
  if (!clean) throw new Error('Thiếu tên khu vực');
  const newSort = sort !== undefined ? _int(sort, z.sort) : z.sort;
  db.prepare(`UPDATE zones SET name=?, sort=? WHERE id=?`).run(clean, newSort, id);
  // Đồng bộ tên khu vực hiển thị trên các bàn thuộc khu vực này.
  if (clean !== z.name) db.prepare(`UPDATE tables SET zone=? WHERE branch_id=? AND zone_id=?`).run(clean, branch_id, id);
  audit('zone.update', { id, name: clean }, branch_id);
  emit('table:updated', { zones_changed: true }, branch_id);
  return { id, name: clean, sort: newSort };
}

export function deleteZone(id, branch_id = 'sala') {
  const z = db.prepare(`SELECT * FROM zones WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!z) throw new Error('Khu vực không tồn tại');
  // Bàn thuộc khu vực bị xoá → trả về "chưa xếp" (bỏ khu vực + vị trí), KHÔNG xoá bàn.
  db.prepare(`UPDATE tables SET zone_id=NULL, zone='', pos_x=-1, pos_y=-1 WHERE branch_id=? AND zone_id=?`).run(branch_id, id);
  db.prepare(`DELETE FROM zones WHERE id=?`).run(id);
  audit('zone.delete', { id, name: z.name }, branch_id);
  emit('table:updated', { zones_changed: true }, branch_id);
  return { id, success: true };
}

// Lưu HÀNG LOẠT vị trí bàn sau khi kéo-thả trên sơ đồ (một transaction).
export function saveTablePositions(branch_id = 'sala', positions = []) {
  if (!Array.isArray(positions)) throw new Error('positions phải là mảng');
  const upd = db.prepare(`UPDATE tables SET pos_x=?, pos_y=?, grid_w=?, grid_h=?, zone_id=?, zone=COALESCE((SELECT name FROM zones WHERE id=?),zone) WHERE id=? AND branch_id=?`);
  db.prepare('BEGIN IMMEDIATE').run();
  try {
    for (const r of positions) {
      const zid = r.zone_id || null;
      upd.run(_num(r.pos_x, -1), _num(r.pos_y, -1),
        Math.max(1, _int(r.grid_w, 1)), Math.max(1, _int(r.grid_h, 1)),
        zid, zid, String(r.id || ''), branch_id);
    }
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
  emit('table:updated', { layout_changed: true }, branch_id);
  return { ok: true, count: positions.length };
}

// SƠ ĐỒ BÀN đầy đủ: danh sách khu vực + bàn (kèm vị trí + trạng thái) cho editor
// và cho POS/self-order render.
export function getFloorPlan(branch_id = 'sala') {
  const zones = listZones(branch_id);
  const tables = listTables(branch_id).map(t => {
    const row = db.prepare(`SELECT pos_x,pos_y,grid_w,grid_h,zone_id FROM tables WHERE id=?`).get(t.id) || {};
    return { ...t, pos_x: row.pos_x ?? -1, pos_y: row.pos_y ?? -1,
      grid_w: row.grid_w ?? 1, grid_h: row.grid_h ?? 1, zone_id: row.zone_id || null };
  });
  return { zones, tables };
}

export function deleteTable(id, branch_id = 'sala') {
  const table = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!table) throw new Error('Bàn không tồn tại');

  if (table.status !== 'free') {
    throw new Error('Bàn đang có khách, không thể xóa!');
  }

  const openOrder = getOpenOrderForTable(id, table.branch_id);
  if (openOrder) {
    throw new Error('Bàn đang có khách, không thể xóa!');
  }

  db.prepare(`DELETE FROM tables WHERE id=?`).run(id);

  audit('table.delete', { id, zone: table.zone, code: table.code }, branch_id);
  emit('table:updated', { id, deleted: true }, branch_id);
  emit('stats:dirty', {}, branch_id);
  return { id, success: true };
}
