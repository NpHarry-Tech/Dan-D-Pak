// Route ownership: Tables + Orders + KDS tickets.
// Business rules stay in services/orders.js (+ history/printing/settings). This
// module only wires HTTP shape → services, giữ NGUYÊN hành vi như khi còn ở api.js.
import * as Orders from '../../services/orders.js';
import { reverseOrderPayments } from '../../services/payments.js';
import * as Auth from '../../services/auth.js';
import * as History from '../../services/history.js';
import * as Print from '../../services/printing.js';
import * as AppSettings from '../../services/settings.js';
import * as Idem from '../../services/idempotency.js';
import { db, uid, audit, now } from '../../db.js';
import { emit } from '../../realtime.js';

export function registerOrderRoutes(api, { wrap, guard, guardAny, branch, visibleBranch, actor }) {
// --- Tables ---
api.get('/tables', wrap((req) => {
  AppSettings.assertSalesModuleEnabled('fnb', visibleBranch(req));
  return Orders.listTables(visibleBranch(req));
}));
api.get('/tables/:id', guardAny('sell', 'pay', 'kds', 'order.view'), wrap((req) => {
  const branch_id = visibleBranch(req);
  return {
    table: Orders.getTableState(req.params.id),
    order: Orders.getOrder(Orders.getOpenOrderForTable(req.params.id, branch_id)?.id),
  };
}));
// Dọn sạch bàn — lối thoát hiểm khi bàn kẹt trạng thái sai.
//
// Chốt bằng QUYỀN 'void' của chính người đang đăng nhập, KHÔNG hỏi thêm PIN:
// đây là thao tác sửa lỗi thường gặp giữa ca bận, bắt gọi quản lý mỗi lần thì
// thu ngân sẽ tránh dùng và bàn cứ kẹt. Lớp an toàn thật nằm ở chỗ khác: nhấn
// giữ 3 giây + hộp thoại xác nhận phía app, và service TỪ CHỐI mọi bill đã ghi
// nhận tiền (phải đi đường Hoàn tiền để còn chứng từ). Mọi lần dọn đều ghi nhật
// ký kèm người thực hiện và danh sách bill bị huỷ.
// `refund_paid` = bàn kẹt vì bill ĐÃ nhận tiền. Không xoá trắng khoản tiền đó:
// service ghi một khoản thu ÂM đối ứng để còn chứng từ hai chiều, rồi mới huỷ
// bill và trả bàn về trống. Vì đây là thao tác đụng TIỀN nên bắt buộc PIN của
// Quản lý/Admin — quyền 'void' thôi chưa đủ.
api.post('/tables/:id/reset', guard('void'), wrap((req) => {
  const branch_id = branch(req);
  const refundPaid = req.body?.refund_paid === true;
  if (refundPaid) {
    const approvedBy = Auth.verifyManagerOwnerPin(req.body?.security_pin, branch_id);
    if (!approvedBy) {
      throw Object.assign(
        new Error('Cần PIN của Quản lý/Admin để hoàn tiền và dọn bàn.'),
        { status: 403 });
    }
    const reason = String(req.body?.reason || '').trim();
    // Hoàn tiền mà không ghi lý do thì sổ sách sau này không ai giải thích được
    // khoản âm đó là gì.
    if (reason.length < 3) {
      throw Object.assign(new Error('Nhập lý do hoàn tiền và dọn bàn.'), { status: 400 });
    }
  }
  return Orders.resetTable(req.params.id, branch_id, actor(req), req.body?.reason, { refundPaid });
}));
api.post('/tables/:id/move', guard('table.move'), wrap((req) => Orders.moveTable(req.params.id, req.body.to_table_id, branch(req), actor(req))));
api.post('/tables/:id/merge', guard('table.move'), wrap((req) => Orders.mergeTables(req.params.id, req.body.target_table_id, branch(req), actor(req))));
api.post('/settings/tables', guardAny('settings.tables'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi sơ đồ bàn.');
  return Orders.createTable({ ...req.body, branch_id });
}));
api.post('/settings/tables/:id/update', guardAny('settings.tables'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi sơ đồ bàn.');
  return Orders.updateTable(req.params.id, req.body, branch_id);
}));
api.post('/settings/tables/:id/delete', guardAny('settings.tables'), wrap((req) => {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi sơ đồ bàn.');
  return Orders.deleteTable(req.params.id, branch_id);
}));

// ── SƠ ĐỒ BÀN (khu vực + vị trí) ─────────────────────────────────────────────
// Đọc sơ đồ đầy đủ (khu vực + bàn kèm vị trí) — cho editor desktop VÀ cho POS /
// self-order render read-only.
api.get('/settings/floor-plan', guardAny('sell', 'pay', 'kds', 'order.view', 'settings.tables'),
  wrap((req) => Orders.getFloorPlan(branch(req))));
api.get('/zones', guardAny('sell', 'pay', 'kds', 'order.view', 'settings.tables'),
  wrap((req) => ({ zones: Orders.listZones(branch(req)) })));

function _requireTablePin(req) {
  const branch_id = branch(req);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  if (!Auth.verifyManagerOwnerPin(pin, branch_id)) {
    throw new Error('Cần nhập PIN của Manager hoặc Admin để xác nhận thay đổi sơ đồ bàn.');
  }
  return branch_id;
}

api.post('/settings/zones', guardAny('settings.tables'), wrap((req) =>
  Orders.createZone({ ...req.body, branch_id: _requireTablePin(req) })));
api.post('/settings/zones/:id/update', guardAny('settings.tables'), wrap((req) =>
  Orders.updateZone(req.params.id, req.body, _requireTablePin(req))));
api.post('/settings/zones/:id/delete', guardAny('settings.tables'), wrap((req) =>
  Orders.deleteZone(req.params.id, _requireTablePin(req))));
// Lưu HÀNG LOẠT vị trí bàn sau kéo-thả (một lần cho cả sơ đồ).
api.post('/settings/tables/positions', guardAny('settings.tables'), wrap((req) => {
  const positions = req.body?.positions;
  const branch_id = _requireTablePin(req);
  return Orders.saveTablePositions(branch_id, positions);
}));

// --- Orders ---
// POST /orders: yêu cầu đăng nhập + quyền 'sell'. Tất cả thiết bị (POS, tablet)
// phải đăng nhập trước khi tạo/thêm món vào đơn hàng.
// CHONG TRUNG DON. Man khach (self-order / catalogue) gui kem Idempotency-Key
// cho MOI lan bam gui; moi lan thu lai cua chinh lan bam do mang y nguyen ma.
// Mang lag lam app het gio cho roi khach bam lai -> server nhan ra ma cu va tra
// ve DUNG don cu, khong tao don thu hai. Xem services/idempotency.js.
api.post('/orders', guard('sell'), wrap((req) => {
  AppSettings.assertSalesModuleEnabled('fnb', visibleBranch(req));
  const branch_id = visibleBranch(req);
  // CHỈNH GIÁ DÒNG (line.price) cần PIN Quản lý/Chủ — ĐỒNG BỘ với Retail checkout.
  // Chỉ chặn khi CÓ dòng bị chỉnh giá; đơn thường (không override) không cần PIN.
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const hasOverride = items.some(it => it && it.price !== undefined && it.price !== null);
  const pin = req.body?.security_pin;
  if (req.body) delete req.body.security_pin;
  if (hasOverride && !Auth.verifyManagerOwnerPin(pin, branch_id)) {
    throw new Error('Cần nhập PIN của Manager hoặc Admin để chỉnh giá dòng.');
  }
  return Idem.withIdempotency('orders.create', Idem.idempotencyKeyOf(req), branch_id,
    () => Orders.createOrUpdateOrder({ ...req.body, branch_id, actor: actor(req) }));
}));
api.get('/orders/pending-confirmation', guard('sell'), wrap((req) => Orders.listPendingConfirmations(branch(req))));
api.get('/orders/history', guard('pay'), wrap((req) => History.listOrderHistory(branch(req), req.query)));
api.get('/orders/:id/receipt', guard('pay'), wrap((req) => History.orderReceipt(req.params.id, branch(req))));
// Nội dung bill render bằng ĐÚNG engine + mẫu in đã cấu hình — app dùng làm
// preview trong Lịch sử để khớp 100% với tờ in.
api.get('/orders/:id/receipt/text', guard('pay'), wrap((req) => {
  const branch_id = branch(req);
  const receipt = History.orderReceipt(req.params.id, branch_id);
  if (req.query.reprint === '1' || req.query.reprint === 'true') receipt.reprint = true;
  if (!receipt.print_config) receipt.print_config = AppSettings.getPrintConfig(branch_id);
  return { text: Print.renderJobText({ type: 'receipt', payload: receipt }) };
}));
api.post('/orders/:id/receipt/print', guard('pay'), wrap((req) => {
  const branch_id = branch(req);
  let preview = false;
  // Đơn còn MỞ → đây là lệnh IN TẠM TÍNH: ghi dấu để sơ đồ bàn hiện trạng thái
  // "Đã in tạm tính" (bàn sắp thanh toán). Đơn đã đóng = in lại từ Lịch sử.
  try {
    const o = db.prepare(`SELECT status, table_id FROM orders WHERE id=?`).get(req.params.id);
    if (o?.status === 'open') {
      preview = true;
      db.prepare(`UPDATE orders SET prebill_printed_at=? WHERE id=?`).run(now(), req.params.id);
      if (o.table_id) emit('table:updated', Orders.getTableState(o.table_id), branch_id);
    }
  } catch { /* đánh dấu lỗi không được chặn lệnh in */ }
  // In lại từ Lịch sử: đánh dấu reprint để tiêu đề bill là "(IN LẠI)".
  return Print.printReceipt({
    ...History.orderReceipt(req.params.id, branch_id),
    preview,
    reprint: !preview,
    ...(preview ? { bill_no: '', number: '' } : {}),
  }, branch_id, { deviceId: String(req.headers['x-device-id'] || '').trim() });
}));
api.get('/orders/:id', guardAny('sell', 'pay', 'kds', 'order.view'), wrap((req) => {
  // BẢO MẬT (chống IDOR): getOrder() không tự lọc chi nhánh — khóa theo quyền chi nhánh
  // của người gọi để user chi nhánh B không đọc được đơn (kèm customer_json: tên/SĐT
  // khách, thanh toán) của chi nhánh A chỉ bằng cách đoán/biết order id.
  const order = Orders.getOrder(req.params.id);
  if (order && !Auth.canAccessBranch(req.user, order.branch_id)) {
    const e = new Error('Đơn hàng không tồn tại'); e.status = 404; throw e;
  }
  return order;
}));
api.post('/orders/:id/confirm', guard('order.confirm'), wrap((req) => Orders.confirmPendingItems(req.params.id, req.body.item_ids, branch(req), actor(req))));
api.post('/orders/:id/reject', guard('order.confirm'), wrap((req) => Orders.rejectPendingItems(req.params.id, req.body.item_ids, req.body.reason, branch(req), actor(req))));
api.post('/orders/:id/split', guard('bill.split'), wrap((req) => Orders.splitOrderItems(req.params.id, req.body.item_ids, branch(req), actor(req))));
api.post('/orders/items/:id/status', guardAny('kds', 'sell'), wrap((req) => {
  // Route được bảo vệ bằng guard kđs|sell. KDS chuyển trạng thái (nhận/làm/xong/giao).
  // HỦY món phải đi qua /orders/items/:id/cancel (có cổng PIN Quản lý) — chặn ở đây để không lách quyền.
  if (String(req.body.status) === 'cancelled') {
    const e = new Error('Hủy món phải dùng chức năng Hủy (cần PIN Quản lý/Admin).');
    e.status = 403; throw e;
  }
  return Orders.setItemStatus(req.params.id, req.body.status, visibleBranch(req), actor(req));
}));
// SỬA GHI CHÚ món đã gửi bếp — dùng cột note sẵn có, không đụng tiền.
api.post('/orders/items/:id/note', guard('sell'), wrap((req) =>
  Orders.updateItemNote(req.params.id, req.body?.note, visibleBranch(req), actor(req))));

api.post('/orders/items/:id/cancel', guard('sell'), wrap((req) => {
  const branch_id = visibleBranch(req);
  const itemId = req.params.id;
  const item = db.prepare(`SELECT * FROM order_items WHERE id=?`).get(itemId);
  if (!item) throw new Error('Món không tồn tại');

  // Phân quyền nhiều cấp (Admin/Owner bỏ qua mọi kiểm tra vì canUser=true):
  //  • pending_confirm (khách chưa gửi)         → tự do, chỉ cần quyền 'sell'.
  //  • đã gửi bếp NHƯNG CHƯA chế biến ('new'/'sent'…) → cần quyền 'void'.
  //  • ĐÃ chế biến (preparing/ready/served)      → cần quyền RIÊNG 'void.made'.
  // Nếu người thao tác không đủ quyền → cho phép người CÓ quyền nhập PIN duyệt.
  const made = ['preparing', 'ready', 'served'].includes(item.status);
  if (item.status !== 'pending_confirm') {
    const needPerm = made ? 'void.made' : 'void';
    const actorOk = Auth.canUser(req.user, needPerm);
    if (!actorOk) {
      const pin = req.body.pin;
      const label = made
        ? 'xóa món ĐÃ chế biến (quyền "void.made")'
        : 'hủy món đã gửi (quyền "void")';
      if (!pin) {
        const e = new Error(`Cần quyền hoặc PIN của người có quyền để ${label}.`);
        e.code = 'PERM_REQUIRED';
        throw e;
      }
      const approver = Auth.verifyPinHasPerm(String(pin), needPerm, branch_id);
      if (!approver) {
        throw new Error(`PIN không đúng hoặc người đó không có quyền ${label}.`);
      }
      audit('order.item.cancel.approved', {
        item: itemId, status: item.status, perm: needPerm,
        approved_by: approver.username || approver.name,
      }, branch_id, actor(req));
    }
  }
  const res = Orders.cancelItem(itemId, req.body.reason || 'Nhân viên hủy', branch_id, actor(req));
  emit('kds:refresh', { station: item.station }, branch_id);
  return res;
}));

api.post('/orders/items/:id/kds-dismiss', guard('kds'), wrap((req) => {
  const branch_id = visibleBranch(req);
  const itemId = req.params.id;
  const item = db.prepare(`SELECT * FROM order_items WHERE id=?`).get(itemId);
  if (!item) throw new Error('Món không tồn tại');
  db.prepare(`UPDATE order_items SET kds_dismissed=1 WHERE id=?`).run(itemId);
  emit('kds:refresh', { station: item.station }, branch_id);
  return { ok: true };
}));

// --- KDS ---
api.get('/kds/:station', wrap((req) => {
  AppSettings.assertSalesModuleEnabled('kds', visibleBranch(req));
  return Orders.getStationTickets(req.params.station, visibleBranch(req));
}));

// --- Staff calls (gọi nhân viên từ iPad/khách; POST/GET mở, resolve cần 'sell') ---
api.post('/calls', wrap((req) => Orders.createStaffCall(req.body.table_id, req.body.reason, visibleBranch(req))));
api.get('/calls', wrap((req) => Orders.listStaffCalls(visibleBranch(req))));
api.post('/calls/:table_id/resolve', guard('sell'), wrap((req) => { Orders.resolveStaffCall(req.params.table_id, visibleBranch(req)); return { ok: true }; }));

// --- Void / Refund bill (thao tác vòng đời đơn; BẮT BUỘC PIN Manager/Admin) ---
// ── Void Bill (Hủy toàn bộ đơn hàng chưa thanh toán) ────────────────────────
// Luật:
//  • Yêu cầu quyền 'void' (cashier không có void mặc định, chỉ manager/owner).
//  • BẮT BUỘC PIN của Manager hoặc Admin — không thể bypass bằng quyền đơn thuần.
//  • Chỉ áp dụng cho bill chưa thanh toán (status='open'). Bill đã paid → dùng refund.
//  • Ghi audit đầy đủ: ai void, bill nào, lý do gì, ai phê duyệt bằng PIN.
api.post('/orders/:id/void', guard('void'), wrap((req) => {
  const branch_id = branch(req);
  const { pin, reason } = req.body || {};

  // Bắt buộc PIN manager/admin dù actor có quyền 'void'
  if (!pin) {
    const e = new Error('Cần nhập PIN của Quản lý hoặc Admin để hủy bill.');
    e.code = 'PERM_REQUIRED';
    throw e;
  }
  const approvedBy = Auth.verifyManagerOwnerPin(pin, branch_id);
  if (!approvedBy) {
    throw new Error('PIN không đúng hoặc người đó không có quyền Quản lý/Admin.');
  }

  const order = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
  if (!order) throw new Error('Bill không tồn tại.');
  if (order.status === 'paid') throw new Error('Không thể void bill đã thanh toán. Hãy dùng chức năng Hoàn tiền.');
  if (order.status === 'void') throw new Error('Bill đã được void trước đó.');

  const cleanReason = String(reason || '').trim() || 'Quản lý hủy bill';

  // Cancel toàn bộ món chưa bị hủy
  db.prepare(`UPDATE order_items SET status='cancelled', reject_reason=? WHERE order_id=? AND status!='cancelled'`)
    .run(cleanReason, req.params.id);
  db.prepare(`UPDATE orders SET status='void', subtotal=0, total=0 WHERE id=?`).run(req.params.id);

  // Trả bàn về trống nếu có
  if (order.table_id) {
    db.prepare(`UPDATE tables SET status='free' WHERE id=?`).run(order.table_id);
    Orders.resolveStaffCall(order.table_id, branch_id);
    emit('table:updated', Orders.getTableState(order.table_id), branch_id);
  }

  audit('order.void', {
    order: req.params.id, bill_no: order.bill_no,
    reason: cleanReason, approved_by: approvedBy.username,
  }, branch_id, actor(req));
  emit('order:updated', Orders.getOrder(req.params.id), branch_id);
  emit('stats:dirty', {}, branch_id);
  return { ok: true, order_id: req.params.id, bill_no: order.bill_no, approved_by: approvedBy.name };
}));

// ── Refund FnB (Hoàn tiền đơn FnB đã thanh toán) ────────────────────────────
// Luật:
//  • Yêu cầu quyền 'refund'.
//  • BẮT BUỘC PIN Manager/Admin + lý do hoàn tiền.
//  • Chỉ áp dụng cho bill đã paid (status='paid').
//  • Ghi audit chi tiết và phát sự kiện realtime.
api.post('/orders/:id/refund', guard('refund'), wrap((req) => {
  const branch_id = branch(req);
  const { pin, reason } = req.body || {};

  // guard('refund') đã xác nhận chính người đăng nhập có quyền. Bill thuộc ca đã
  // khóa thì client gửi thêm PIN quản lý; ca đang mở không bắt người có quyền
  // phải mượn PIN của người khác.
  const approvedBy = pin ? Auth.verifyManagerOwnerPin(pin, branch_id) : req.user;
  if (!approvedBy) throw new Error('PIN không đúng hoặc người đó không có quyền Quản lý/Admin.');

  const order = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=?`).get(req.params.id, branch_id);
  if (!order) throw new Error('Bill không tồn tại.');
  if (order.status !== 'paid') throw new Error('Chỉ có thể hoàn tiền cho bill đã thanh toán.');

  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new Error('Cần nhập lý do hoàn tiền.');

  const refundId = uid('ref_');
  db.prepare('BEGIN IMMEDIATE').run();
  try {
    reverseOrderPayments(req.params.id, cleanReason, actor(req));
    try {
      db.prepare(`INSERT INTO refunds (id,order_id,branch_id,reason,approved_by,amount,created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(refundId, req.params.id, branch_id, cleanReason, approvedBy.username, order.total, now());
    } catch (error) {
      // Older databases may not have the optional refunds table. Only ignore
      // that schema case; audit_log below remains the authoritative evidence.
      if (!String(error?.message || '').includes('no such table')) throw error;
    }
    audit('order.refund', {
      refund_id: refundId, order: req.params.id, bill_no: order.bill_no,
      amount: order.total, reason: cleanReason, approved_by: approvedBy.username,
      deleted_from_history: true,
    }, branch_id, actor(req));
    db.prepare(`UPDATE orders SET status='void' WHERE id=?`).run(req.params.id);
    db.prepare('COMMIT').run();
  } catch (error) {
    try { db.prepare('ROLLBACK').run(); } catch { /* already closed */ }
    throw error;
  }
  emit('order:updated', Orders.getOrder(req.params.id), branch_id);
  emit('stats:dirty', {}, branch_id);
  return { ok: true, refund_id: refundId, order_id: req.params.id, bill_no: order.bill_no, amount: order.total, approved_by: approvedBy.name };
}));
}
