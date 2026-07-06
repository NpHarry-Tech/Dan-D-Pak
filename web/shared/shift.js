// Shared shift + cash drawer control used by Retail and other POS surfaces.
// Rendering is kept IDENTICAL to the FnB POS (web/pos.html) so the shift /
// cash-drawer panel looks and behaves the same on both screens. Both surfaces
// hit the same backend (/shifts/*, /cash-drawer/*) → one shift, one drawer.
import { api, money, toast, esc, getUser } from './client.js';

const FALLBACK = {
  shifts: {
    labels: [{ key: 'morning', label: 'Ca sáng' }, { key: 'evening', label: 'Ca tối' }],
    denominations: [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000],
    requireOpenShift: true,
    defaultDrawerCash: 4000000,
  },
};

let state = null;
let cfg = FALLBACK;

function mergeConfig(raw = {}) {
  return {
    ...FALLBACK,
    ...raw,
    shifts: {
      ...FALLBACK.shifts,
      ...(raw?.shifts || {}),
    },
  };
}

export async function refreshShift() {
  state = await api('/shifts/current').catch(() => ({ shift: null, config: FALLBACK, report: null, drawer: null }));
  cfg = mergeConfig(state.config || FALLBACK);
  return state;
}

export const currentShift = () => state?.shift || null;

export async function mountShift(container, { onChange } = {}) {
  if (typeof container === 'string') container = document.querySelector(container);
  if (!container) return { reload() {}, openPanel() {}, getState: () => state };
  await refreshShift();

  function render() {
    const sh = state?.shift;
    const drawer = state?.drawer?.summary || state?.report?.drawer;
    const cashText = sh && drawer ? ` · Két ${money(drawer.expected_cash || 0)}` : '';
    container.innerHTML = `<button class="btn sm shiftbtn ${sh ? 'open' : 'closed'}" id="shiftBtn" title="Mở / kết ca làm việc">${sh ? 'Ca: ' + esc(sh.shift_label || 'đang mở') + cashText : 'Ca: chưa mở'}</button>`;
    container.querySelector('#shiftBtn').onclick = openPanel;
  }

  async function reload() {
    await refreshShift();
    render();
    onChange && onChange(state);
  }

  // ---- helpers (mirror of pos.html) ----
  const denoms = (counts = {}) => `<div class="denom-grid" style="grid-template-columns:repeat(3,136px);max-height:none;overflow:visible;gap:8px;justify-content:start">${(cfg.shifts.denominations || FALLBACK.shifts.denominations)
    .map(d => `<label class="denom-row" style="display:grid;grid-template-columns:1fr;gap:6px;width:136px;min-height:84px;box-sizing:border-box;padding:8px 10px"><b style="font-family:var(--mono);font-size:12px;color:var(--muted)">${money(d)}</b><input type="number" min="0" step="1" value="${counts[d] || 0}" data-denom="${d}" style="width:100%;height:36px;box-sizing:border-box;text-align:right;padding:6px 10px;font-family:var(--mono);font-weight:800;font-size:15px"></label>`)
    .join('')}</div>`;
  const countCash = ov => [...ov.querySelectorAll('[data-denom]')].reduce((s, i) => s + (parseInt(i.dataset.denom) || 0) * (parseInt(i.value) || 0), 0);
  const countTouched = ov => [...ov.querySelectorAll('[data-denom]')].some(i => i.dataset.touched === '1');
  const dateTimeLocal = (iso = null) => {
    const d = iso ? new Date(iso) : new Date();
    if (Number.isNaN(d.getTime())) return dateTimeLocal();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };
  const fileToDataUrl = file => new Promise((resolve, reject) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const methodLabel = (m) => {
    const c = (cfg?.payment?.methods || []).find(x => x.key === m);
    return c?.label || { cash: 'Tiền mặt', card: 'Máy POS', qr: 'QR', qrcode: 'QR Code', voucher: 'Voucher', bank_transfer: 'Chuyển khoản', internet_banking: 'Internet Banking', momo: 'MoMo Pay', zalopay: 'ZaloPay', visa: 'Visa', pos_card: 'Máy POS' }[m] || m;
  };

  function reportHtml(r, day = null) {
    if (!r) return '<div class="empty">Chưa có dữ liệu ca.</div>';
    const lines = Object.entries(r.method_totals || {}).map(([k, v]) => `<div class="brow"><span>${esc(methodLabel(k))}</span><span>${money(v)}</span></div>`).join('');
    const dayBox = day ? `<div class="shift-report" style="margin-top:12px">
      <div class="brow tt"><span>Tổng ngày vận hành</span><span>${money(day.total_revenue || 0)}</span></div>
      <div class="brow"><span>Số bill trong ngày</span><span>${day.bill_count || 0}</span></div>
      <div class="brow"><span>Tiền mặt trong ngày</span><span>${money(day.cash_sales || 0)}</span></div>
      <div class="brow"><span>Chuyển khoản / ví trong ngày</span><span>${money(day.transfer_sales || 0)}</span></div>
      <div class="brow"><span>Máy POS / thẻ trong ngày</span><span>${money(day.pos_sales || 0)}</span></div>
    </div>` : '';
    return `<div class="shift-report">
      <div class="brow"><span>Số bill</span><span>${r.bill_count || 0}</span></div>
      <div class="brow"><span>Tiền mặt bán hàng</span><span>${money(r.cash_sales || 0)}</span></div>
      <div class="brow"><span>Chi từ két</span><span>${money(r.drawer_expenses || 0)}</span></div>
      <div class="brow"><span>Hoàn chi</span><span>${money(r.drawer_reimbursements || 0)}</span></div>
      <div class="brow"><span>Chuyển khoản / ví</span><span>${money(r.transfer_sales || 0)}</span></div>
      <div class="brow"><span>Máy POS / thẻ</span><span>${money(r.pos_sales || 0)}</span></div>
      <div class="brow tt"><span>Tiền mặt dự kiến</span><span>${money(r.expected_cash || 0)}</span></div>
      ${lines ? `<hr style="border:none;border-top:1px dashed var(--border);margin:8px 0">${lines}` : ''}
    </div>${dayBox}`;
  }

  function drawerEntriesHtml(entries) {
    if (!entries || !entries.length) return '<div style="font-size:12px;color:var(--muted);padding:6px 0">Chưa có giao dịch két trong ca này</div>';
    return entries.map(e => `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:7px 9px;background:var(--surface);border:1px solid var(--border);border-radius:9px;margin-bottom:5px;font-size:12px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;color:${e.kind === 'expense' ? 'var(--late)' : 'var(--done)'}">${e.kind === 'expense' ? '📤 Chi' : '📥 Hoàn chi'} ${money(e.amount)}</div>
        <div style="color:var(--muted);margin-top:2px;word-break:break-word">${e.counterparty ? esc(e.counterparty) : ''}${e.reason ? ` · ${esc(e.reason)}` : ''}${e.linked_expense_title ? ` · Hoàn cho: ${esc(e.linked_expense_title)}` : ''}${e.note ? ` · ${esc(e.note)}` : ''}</div>
        <div style="color:var(--faint);font-size:11px;margin-top:2px">${new Date(e.occurred_at).toLocaleTimeString('vi-VN')} · ${esc(e.actor_name || '')}</div>
      </div>
    </div>`).join('');
  }

  async function openCashExpenseModal(onDone) {
    const ov = document.createElement('div'); ov.className = 'overlay show';
    ov.innerHTML = `<div class="modal" style="max-width:460px">
      <h2>📤 Chi từ két</h2>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
        <div><label>Số tiền <span style="color:var(--late)">*</span></label><input type="number" id="expAmount" placeholder="VD: 50000" min="1" style="width:100%;margin-top:4px;box-sizing:border-box"></div>
        <div><label>Ngày giờ chi</label><input type="datetime-local" id="expAt" value="${dateTimeLocal()}" style="width:100%;margin-top:4px;box-sizing:border-box"></div>
        <div><label>Bên nhận tiền / NCC <span style="color:var(--late)">*</span></label><input type="text" id="expCounterparty" placeholder="Tên người/nhà cung cấp nhận tiền" style="width:100%;margin-top:4px;box-sizing:border-box"></div>
        <div><label>Lý do <span style="color:var(--late)">*</span></label><input type="text" id="expReason" placeholder="Lý do chi tiền" style="width:100%;margin-top:4px;box-sizing:border-box"></div>
        <div><label>Hàng hóa / dịch vụ</label><input type="text" id="expProduct" placeholder="(không bắt buộc)" style="width:100%;margin-top:4px;box-sizing:border-box"></div>
        <div><label>Ảnh hóa đơn</label><input type="file" id="expImage" accept="image/*" capture="environment" style="width:100%;margin-top:4px;box-sizing:border-box"></div>
        <div><label>Ghi chú</label><textarea id="expNote" placeholder="(không bắt buộc)" style="width:100%;margin-top:4px;min-height:60px;box-sizing:border-box"></textarea></div>
      </div>
      <div class="mfoot"><button class="btn" id="expCancel">Hủy</button><button class="btn danger" id="expSubmit">Xác nhận chi tiền</button></div>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#expCancel').onclick = () => ov.remove();
    ov.querySelector('#expSubmit').onclick = async () => {
      const amount = parseInt(ov.querySelector('#expAmount').value) || 0;
      const occurred_at = ov.querySelector('#expAt').value;
      const counterparty = ov.querySelector('#expCounterparty').value.trim();
      const reason = ov.querySelector('#expReason').value.trim();
      const product = ov.querySelector('#expProduct').value.trim();
      const note = ov.querySelector('#expNote').value.trim();
      const invoice_image = await fileToDataUrl(ov.querySelector('#expImage')?.files?.[0]);
      try {
        await api('/cash-drawer/expense', { method: 'POST', body: { amount, occurred_at, counterparty, reason, product, note, invoice_image } });
        ov.remove(); toast('Đã ghi nhận chi tiền két');
        if (onDone) onDone();
      } catch (e) { toast(e.message, true); }
    };
  }

  async function openCashReimbursementModal(onDone) {
    const drawer = await api('/cash-drawer/current').catch(() => ({}));
    const reimbursable = drawer?.reimbursable_expenses || [];
    const drawerBefore = Number(drawer?.summary?.expected_cash || 0) || 0;
    const denomList = cfg.shifts.denominations || FALLBACK.shifts.denominations;
    const expenseRows = reimbursable.length ? reimbursable.map(e => `<label style="display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:9px 10px;margin:0;text-transform:none;letter-spacing:0;color:var(--text);font-size:12px">
      <input type="checkbox" data-reimb-expense value="${esc(e.id)}" data-outstanding="${Number(e.outstanding_amount) || 0}">
      <span style="min-width:0"><b>${esc(e.title || e.reason || e.product || e.id)}</b><small style="display:block;color:var(--muted);margin-top:2px">${new Date(e.occurred_at).toLocaleString('vi-VN')}${e.shift_label ? ` · ${esc(e.shift_label)}` : ''}</small></span>
      <b style="font-family:var(--mono);color:var(--late);white-space:nowrap">${money(e.outstanding_amount || 0)}</b>
    </label>`).join('') : '<div class="empty" style="padding:10px">Không có khoản chi nào đang chờ hoàn</div>';
    const denomRows = denomList.map(d => `<label style="display:grid;grid-template-columns:1fr;gap:6px;width:136px;min-height:84px;box-sizing:border-box;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:8px 10px;margin:0;text-transform:none;letter-spacing:0">
      <b style="font-family:var(--mono);font-size:12px;color:var(--muted)">${money(d)}</b>
      <input data-reimb-denom="${d}" type="number" min="0" step="1" value="0" style="width:100%;height:36px;box-sizing:border-box;text-align:right;padding:6px 10px;font-family:var(--mono);font-weight:800;font-size:15px">
    </label>`).join('');
    const ov = document.createElement('div'); ov.className = 'overlay show';
    ov.innerHTML = `<div class="modal" style="max-width:900px;width:calc(100vw - 36px);max-height:calc(100vh - 36px);overflow:hidden;padding:16px">
      <h2 style="margin-bottom:6px">📥 Hoàn chi</h2>
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:8px 0">
        <div style="border:1px solid var(--border);border-radius:12px;background:var(--surface2);padding:10px 12px"><div style="font-size:10px;color:var(--muted);font-weight:800;text-transform:uppercase">Két trước hoàn chi</div><b id="reimbBeforeTotal" style="display:block;font-size:21px;font-family:var(--mono);color:var(--text);margin-top:3px">${money(drawerBefore)}</b></div>
        <div style="border:1px solid var(--border);border-radius:12px;background:var(--surface2);padding:10px 12px"><div style="font-size:10px;color:var(--muted);font-weight:800;text-transform:uppercase">Số phải hoàn theo khoản đã chọn</div><b id="reimbDueTotal" style="display:block;font-size:21px;font-family:var(--mono);color:var(--late);margin-top:3px">0đ</b></div>
        <div style="border:1px solid var(--border);border-radius:12px;background:var(--surface2);padding:10px 12px"><div style="font-size:10px;color:var(--muted);font-weight:800;text-transform:uppercase">Tiền thực nhận đã kiểm đếm</div><b id="reimbActualTotal" style="display:block;font-size:21px;font-family:var(--mono);color:var(--brand);margin-top:3px">0đ</b></div>
        <div style="border:1px solid var(--border);border-radius:12px;background:var(--surface2);padding:10px 12px"><div style="font-size:10px;color:var(--muted);font-weight:800;text-transform:uppercase">Két sau hoàn chi</div><b id="reimbAfterTotal" style="display:block;font-size:21px;font-family:var(--mono);color:var(--done);margin-top:3px">${money(drawerBefore)}</b></div>
      </div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) max-content;gap:14px;align-items:start">
        <div>
          <label style="margin:0 0 6px">Chọn các khoản chi được hoàn</label>
          <div id="reimbExpenseBox" style="display:flex;flex-direction:column;gap:7px;border:1px solid var(--border);border-radius:12px;background:var(--surface2);padding:8px;max-height:238px;overflow:auto">${expenseRows}</div>
        </div>
        <div>
          <label style="margin:0 0 6px">Kiểm đếm tiền thực nhận</label>
          <div style="display:grid;grid-template-columns:repeat(3,136px);gap:8px;justify-content:start">${denomRows}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
        <div><label style="margin:0 0 5px">Ngày giờ hoàn</label><input type="datetime-local" id="reimbAt" value="${dateTimeLocal()}" style="width:100%;box-sizing:border-box;padding:9px 12px"></div>
        <div><label style="margin:0 0 5px">Người hoàn tiền</label><input type="text" id="reimbCounterparty" placeholder="Kế toán / người giao tiền" style="width:100%;box-sizing:border-box;padding:9px 12px"></div>
      </div>
      <label style="margin:8px 0 5px">Ghi chú</label><textarea id="reimbNote" rows="2" placeholder="(không bắt buộc)" style="width:100%;min-height:44px;box-sizing:border-box;resize:none"></textarea>
      <div class="mfoot" style="margin-top:8px"><button class="btn" id="reimbCancel">Hủy</button><button class="btn primary" id="reimbSubmit">Xác nhận hoàn chi</button></div>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#reimbCancel').onclick = () => ov.remove();
    const selectedExpenseIds = () => [...ov.querySelectorAll('[data-reimb-expense]:checked')].map(x => x.value);
    const dueTotal = () => [...ov.querySelectorAll('[data-reimb-expense]:checked')].reduce((s, x) => s + (Number(x.dataset.outstanding) || 0), 0);
    const actualTotal = () => [...ov.querySelectorAll('[data-reimb-denom]')].reduce((s, x) => s + (Number(x.dataset.reimbDenom) || 0) * (parseInt(x.value) || 0), 0);
    const updateTotals = () => {
      const actual = actualTotal();
      ov.querySelector('#reimbDueTotal').textContent = money(dueTotal());
      ov.querySelector('#reimbActualTotal').textContent = money(actual);
      ov.querySelector('#reimbAfterTotal').textContent = money(drawerBefore + actual);
    };
    ov.querySelectorAll('[data-reimb-expense]').forEach(x => x.onchange = updateTotals);
    ov.querySelectorAll('[data-reimb-denom]').forEach(x => { x.oninput = updateTotals; x.onchange = updateTotals; });
    updateTotals();
    ov.querySelector('#reimbSubmit').onclick = async () => {
      const amount = actualTotal();
      const occurred_at = ov.querySelector('#reimbAt').value;
      const counterparty = ov.querySelector('#reimbCounterparty').value.trim();
      const note = ov.querySelector('#reimbNote').value.trim();
      const reimburses_entry_ids = selectedExpenseIds();
      if (amount <= 0) return toast('Vui lòng kiểm đếm số tiền thực nhận', true);
      if (reimburses_entry_ids.length && amount > dueTotal()) return toast('Tiền thực nhận lớn hơn số phải hoàn của các khoản đã chọn', true);
      try {
        await api('/cash-drawer/reimbursement', { method: 'POST', body: { amount, occurred_at, counterparty, note, reimburses_entry_ids } });
        ov.remove(); toast('Đã ghi nhận hoàn chi');
        if (onDone) onDone();
      } catch (e) { toast(e.message, true); }
    };
  }

  async function openPanel({ afterOpen } = {}) {
    await refreshShift();
    const sh = state?.shift;
    const labels = (cfg.shifts.labels || FALLBACK.shifts.labels).filter(x => x.enabled !== false);
    const user = getUser();
    const suggestion = Number(state?.opening_suggestion ?? cfg?.shifts?.defaultDrawerCash ?? 0) || 0;
    let drawerData = null;
    if (sh) { try { drawerData = await api('/cash-drawer/current'); } catch (e) {} }
    const ov = document.createElement('div'); ov.className = 'overlay show';
    const title = sh ? 'Ca đang mở' : 'Mở ca làm việc';
    ov.innerHTML = `<div class="modal" style="max-width:1040px;width:calc(100vw - 36px);max-height:calc(100vh - 36px);overflow:hidden;padding:16px;display:flex;flex-direction:column">
      <h2 style="margin-bottom:6px;flex-shrink:0">🧾 ${title}</h2>
      <div class="sub" style="margin-bottom:10px;flex-shrink:0">${sh ? `Nhân viên ${esc(sh.user_name || '')} mở ${esc(sh.shift_label || 'ca')} lúc ${new Date(sh.opened_at).toLocaleString('vi-VN')}` : `Đăng nhập: ${esc(user?.name || user?.username || 'Nhân viên')}. Không nhập kiểm đếm thì hệ thống dùng ${money(suggestion)} từ ca trước/tiền két gốc.`}</div>
      <div class="shift-box" style="grid-template-columns:max-content minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:14px;margin-top:8px;overflow:hidden;min-height:0;flex:1">
        <div class="shift-card" style="padding:12px;align-self:start">
          <h3 style="margin-bottom:8px">${sh ? 'Kiểm đếm khi kết ca' : 'Kiểm đếm đầu ca'}</h3>
          <div style="display:grid;grid-template-columns:160px 1fr;gap:10px;align-items:end;margin-bottom:8px">
            <div><label style="margin:0 0 5px">Ca làm việc</label>
            <select id="shKey" style="padding:9px 44px 9px 12px;min-width:0;appearance:none;-webkit-appearance:none;background-color:var(--bg);background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 22px) 52%,calc(100% - 16px) 52%;background-size:6px 6px,6px 6px;background-repeat:no-repeat">${labels.map(x => `<option value="${esc(x.key)}" ${x.key === (sh?.shift_key || '') ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
            <div class="brow tt" style="padding:0 2px 4px"><span>Tổng kiểm đếm</span><span id="shTotal">0đ</span></div>
          </div>
          <label style="margin:6px 0 7px">Mệnh giá tiền mặt</label>
          ${denoms()}
          ${sh ? `<div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <button class="btn" id="cashExpenseBtn" style="border-color:rgba(255,107,107,.45);color:var(--late)">📤 Chi từ két</button>
            <button class="btn" id="cashReimbBtn" style="border-color:rgba(63,224,143,.45);color:var(--done)">📥 Hoàn chi</button>
          </div>` : ''}
        </div>
        <div class="shift-card" style="padding:12px;min-height:0;overflow:auto">
          <h3 style="margin-bottom:8px">Báo cáo ca</h3>
          ${sh ? reportHtml(state.report, state.day_report) : '<div class="empty">Chưa có ca đang mở. Sau khi mở ca, doanh thu thanh toán sẽ được gom vào báo cáo tại đây.</div>'}
          ${sh ? `<div style="margin-top:8px"><div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px">Giao dịch két ca này</div><div id="drawerEntries">${drawerEntriesHtml(drawerData?.entries)}</div></div>` : ''}
        </div>
      </div>
      <div class="mfoot" style="margin-top:10px;flex-shrink:0"><button class="btn" id="shCancel">Đóng</button>${sh ? '<button class="btn danger" id="shClose">Kết ca</button>' : '<button class="btn primary" id="shOpen">Mở ca</button>'}</div>
    </div>`;
    document.body.appendChild(ov);
    const refreshDrawerEntries = async () => {
      try { const data = await api('/cash-drawer/current'); const el = ov.querySelector('#drawerEntries'); if (el) el.innerHTML = drawerEntriesHtml(data?.entries); await reload(); } catch (e) {}
    };
    const updateTotal = () => { const el = ov.querySelector('#shTotal'); if (el) el.textContent = !sh && !countTouched(ov) ? `Tự dùng ${money(suggestion)}` : money(countCash(ov)); };
    ov.querySelectorAll('[data-denom]').forEach(i => i.oninput = () => { i.dataset.touched = '1'; updateTotal(); });
    updateTotal();
    ov.querySelector('#shCancel').onclick = () => ov.remove();
    const expBtn = ov.querySelector('#cashExpenseBtn');
    if (expBtn) expBtn.onclick = () => openCashExpenseModal(refreshDrawerEntries);
    const reimbBtn = ov.querySelector('#cashReimbBtn');
    if (reimbBtn) reimbBtn.onclick = () => openCashReimbursementModal(refreshDrawerEntries);
    const openBtn = ov.querySelector('#shOpen');
    if (openBtn) openBtn.onclick = async () => {
      const counts = Object.fromEntries([...ov.querySelectorAll('[data-denom]')].map(i => [i.dataset.denom, parseInt(i.value) || 0]));
      try {
        await api('/shifts/open', { method: 'POST', body: { shift_key: ov.querySelector('#shKey').value, counts, opening_cash: countCash(ov), cash_manual: countTouched(ov) } });
        ov.remove(); toast('Đã mở ca'); reload(); if (afterOpen) afterOpen();
      } catch (e) { toast(e.message, true); }
    };
    const closeBtn = ov.querySelector('#shClose');
    if (closeBtn) closeBtn.onclick = async () => {
      if (!confirm('Kết ca hiện tại? Hệ thống sẽ chốt báo cáo ca.')) return;
      const counts = Object.fromEntries([...ov.querySelectorAll('[data-denom]')].map(i => [i.dataset.denom, parseInt(i.value) || 0]));
      try {
        const r = await api('/shifts/close', { method: 'POST', body: { shift_key: ov.querySelector('#shKey').value, counts, closing_cash: countCash(ov) } });
        ov.remove(); toast('Đã kết ca · doanh thu ' + money(r.report?.total_revenue || 0)); reload();
      } catch (e) { toast(e.message, true); }
    };
  }

  render();
  return { reload, openPanel, getState: () => state };
}
