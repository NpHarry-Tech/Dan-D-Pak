// Shared shift control (open/close ca) — used by POS & Retail so both share the
// SAME branch shift via /shifts endpoints. Renders a header button + a modal that
// shows the current date, cash denomination count, and the live shift report.
import { api, money, toast, esc } from './client.js';

const FALLBACK = {
  shifts: {
    labels: [{ key: 'morning', label: 'Ca sáng' }, { key: 'evening', label: 'Ca tối' }],
    denominations: [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000],
    requireOpenShift: true,
  },
};

let state = null, cfg = FALLBACK;

export async function refreshShift() {
  state = await api('/shifts/current').catch(() => ({ shift: null, config: FALLBACK, report: null }));
  cfg = state.config || FALLBACK;
  return state;
}
export const currentShift = () => state?.shift || null;

function methodLabel(m) {
  return { cash: 'Tiền mặt', card: 'Máy POS', qr: 'QR', qrcode: 'QR Code', bank_transfer: 'Chuyển khoản', internet_banking: 'Internet Banking', momo: 'MoMo', zalopay: 'ZaloPay', visa: 'Visa', pos_card: 'Máy POS', voucher: 'Voucher' }[m] || m;
}

function drawerEntriesHtml(entries) {
  if (!entries || !entries.length) return '<div style="font-size:12px;color:var(--muted);padding:6px 0">Chưa có giao dịch két trong ca này</div>';
  return entries.map(e => `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:7px 9px;background:var(--surface);border:1px solid var(--border);border-radius:9px;margin-bottom:5px;font-size:12px">
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;color:${e.kind === 'expense' ? 'var(--late)' : 'var(--done)'}">${e.kind === 'expense' ? '📤 Chi' : '📥 Nạp'} ${money(e.amount)}</div>
      <div style="color:var(--muted);margin-top:2px;word-break:break-word">${e.counterparty ? esc(e.counterparty) : ''}${e.reason ? ` · ${esc(e.reason)}` : ''}${e.note ? ` · ${esc(e.note)}` : ''}</div>
      <div style="color:var(--faint);font-size:11px;margin-top:2px">${new Date(e.occurred_at).toLocaleTimeString('vi-VN')} · ${esc(e.actor_name || '')}</div>
    </div>
  </div>`).join('');
}

function reportHtml(r, day = null) {
  if (!r) return '<div style="font-size:12.5px;color:var(--muted);padding:8px 0">Chưa có ca đang mở. Sau khi mở ca, doanh thu thanh toán sẽ được gom vào báo cáo tại đây.</div>';
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
    <div class="brow"><span>Hoàn két</span><span>${money(r.drawer_reimbursements || 0)}</span></div>
    <div class="brow"><span>Chuyển khoản / ví</span><span>${money(r.transfer_sales || 0)}</span></div>
    <div class="brow"><span>Máy POS / thẻ</span><span>${money(r.pos_sales || 0)}</span></div>
    <div class="brow tt"><span>Tiền mặt dự kiến</span><span>${money(r.expected_cash || 0)}</span></div>
    ${lines ? `<hr style="border:none;border-top:1px dashed var(--border);margin:8px 0">${lines}` : ''}
  </div>${dayBox}`;
}

async function openCashExpenseModal(onDone) {
  const ov = document.createElement('div'); ov.className = 'overlay show';
  ov.innerHTML = `<div class="modal" style="max-width:460px">
    <h2>📤 Chi từ két</h2>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
      <div><label>Số tiền <span style="color:var(--late)">*</span></label><input type="number" id="expAmount" placeholder="VD: 50000" min="1" style="width:100%;margin-top:4px;box-sizing:border-box"></div>
      <div><label>Bên nhận tiền / NCC <span style="color:var(--late)">*</span></label><input type="text" id="expCounterparty" placeholder="Tên người/nhà cung cấp nhận tiền" style="width:100%;margin-top:4px;box-sizing:border-box"></div>
      <div><label>Lý do <span style="color:var(--late)">*</span></label><input type="text" id="expReason" placeholder="Lý do chi tiền" style="width:100%;margin-top:4px;box-sizing:border-box"></div>
      <div><label>Hàng hóa / dịch vụ</label><input type="text" id="expProduct" placeholder="(không bắt buộc)" style="width:100%;margin-top:4px;box-sizing:border-box"></div>
      <div><label>Ghi chú</label><textarea id="expNote" placeholder="(không bắt buộc)" style="width:100%;margin-top:4px;min-height:60px;box-sizing:border-box"></textarea></div>
    </div>
    <div class="mfoot"><button class="btn" id="expCancel">Hủy</button><button class="btn danger" id="expSubmit">Xác nhận chi tiền</button></div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#expCancel').onclick = () => ov.remove();
  ov.querySelector('#expSubmit').onclick = async () => {
    const amount = parseInt(ov.querySelector('#expAmount').value) || 0;
    const counterparty = ov.querySelector('#expCounterparty').value.trim();
    const reason = ov.querySelector('#expReason').value.trim();
    const product = ov.querySelector('#expProduct').value.trim();
    const note = ov.querySelector('#expNote').value.trim();
    try {
      await api('/cash-drawer/expense', { method: 'POST', body: { amount, counterparty, reason, product, note } });
      ov.remove(); toast('Đã ghi nhận chi tiền két');
      if (onDone) onDone();
    } catch (e) { toast(e.message, true); }
  };
}

async function openCashReimbursementModal(onDone) {
  const ov = document.createElement('div'); ov.className = 'overlay show';
  ov.innerHTML = `<div class="modal" style="max-width:460px">
    <h2>📥 Nạp tiền két</h2>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
      <div><label>Số tiền <span style="color:var(--late)">*</span></label><input type="number" id="reimbAmount" placeholder="VD: 100000" min="1" style="width:100%;margin-top:4px;box-sizing:border-box"></div>
      <div><label>Người nộp / hoàn tiền</label><input type="text" id="reimbCounterparty" placeholder="(mặc định là tên nhân viên đang đăng nhập)" style="width:100%;margin-top:4px;box-sizing:border-box"></div>
      <div><label>Ghi chú</label><textarea id="reimbNote" placeholder="(không bắt buộc)" style="width:100%;margin-top:4px;min-height:60px;box-sizing:border-box"></textarea></div>
    </div>
    <div class="mfoot"><button class="btn" id="reimbCancel">Hủy</button><button class="btn primary" id="reimbSubmit">Xác nhận nạp tiền</button></div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#reimbCancel').onclick = () => ov.remove();
  ov.querySelector('#reimbSubmit').onclick = async () => {
    const amount = parseInt(ov.querySelector('#reimbAmount').value) || 0;
    const counterparty = ov.querySelector('#reimbCounterparty').value.trim();
    const note = ov.querySelector('#reimbNote').value.trim();
    try {
      await api('/cash-drawer/reimbursement', { method: 'POST', body: { amount, counterparty, note } });
      ov.remove(); toast('Đã ghi nhận nạp tiền két');
      if (onDone) onDone();
    } catch (e) { toast(e.message, true); }
  };
}

// Mount into a container element. Returns { reload, openPanel }.
export async function mountShift(container, { onChange } = {}) {
  if (typeof container === 'string') container = document.querySelector(container);
  if (!container) return { reload() {}, openPanel() {} };
  await refreshShift();

  function render() {
    const sh = state?.shift;
    container.innerHTML = `<button class="btn sm shiftbtn ${sh ? 'open' : 'closed'}" id="shiftBtn" title="Mở / kết ca làm việc">${sh ? 'Ca: ' + (sh.shift_label || 'đang mở') : 'Ca: chưa mở'}</button>`;
    container.querySelector('#shiftBtn').onclick = openPanel;
  }
  async function reload() { await refreshShift(); render(); onChange && onChange(state); }

  const denoms = () => {
    const ds = cfg?.shifts?.denominations || FALLBACK.shifts.denominations;
    return `<div class="denom-grid">${ds.map(d => `<label class="denom-row"><b>${money(d)}</b><input type="number" min="0" step="1" value="0" data-denom="${d}"></label>`).join('')}</div>`;
  };
  const countCash = (ov) => [...ov.querySelectorAll('[data-denom]')].reduce((s, i) => s + (parseInt(i.dataset.denom) || 0) * (parseInt(i.value) || 0), 0);
  const cashCountTouched = (ov) => [...ov.querySelectorAll('[data-denom]')].some(i => i.dataset.touched === '1');

  function openPanel() {
    const sh = state?.shift;
    const labels = (cfg.shifts.labels || FALLBACK.shifts.labels).filter(x => x.enabled !== false);
    const suggestion = Number(cfg.shifts?.defaultDrawerCash ?? 0) || 0;
    const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const ov = document.createElement('div'); ov.className = 'overlay show';
    ov.innerHTML = `<div class="modal" style="max-width:860px">
      <h2>🧾 ${sh ? 'Ca đang mở' : 'Mở ca làm việc'}</h2>
      <div class="sub">📅 ${sh
        ? `Nhân viên ${esc(sh.user_name || '')} mở ${esc(sh.shift_label || 'ca')} lúc ${new Date(sh.opened_at).toLocaleString('vi-VN')}`
        : `Hôm nay: <b style="color:var(--text)">${esc(today)}</b>${suggestion ? `. Không nhập kiểm đếm thì hệ thống dùng ${money(suggestion)} từ ca trước.` : '.'}`
      }</div>
      <div class="shift-box">
        <div class="shift-card">
          <h3>${sh ? 'Kiểm đếm khi kết ca' : 'Kiểm đếm đầu ca'}</h3>
          <label>Ca làm việc</label>
          <select id="shKey">${labels.map(x => `<option value="${esc(x.key)}" ${x.key === (sh?.shift_key || '') ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
          <label style="margin-top:8px">Mệnh giá tiền mặt</label>
          ${denoms()}
          <div class="brow tt" style="margin-top:10px"><span>Tổng kiểm đếm</span><span id="shTotal">0đ</span></div>
          ${sh ? `<div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <button class="btn" id="cashExpenseBtn" style="border-color:rgba(255,107,107,.45);color:var(--late)">📤 Chi từ két</button>
            <button class="btn" id="cashReimbBtn" style="border-color:rgba(63,224,143,.45);color:var(--done)">📥 Nạp tiền két</button>
          </div>` : ''}
        </div>
        <div class="shift-card">
          <h3>Báo cáo ca</h3>
          ${reportHtml(state?.report, state?.day_report)}
          ${sh ? `<div style="margin-top:10px"><div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Giao dịch két ca này</div><div id="drawerEntries" style="max-height:180px;overflow:auto">Đang tải...</div></div>` : ''}
        </div>
      </div>
      <div class="mfoot"><button class="btn" id="shCancel">Đóng</button>${sh ? '<button class="btn danger" id="shClose">Kết ca</button>' : '<button class="btn primary" id="shOpen">Mở ca</button>'}</div>
    </div>`;
    document.body.appendChild(ov);

    const refreshDrawerEntries = async () => {
      try {
        const data = await api('/cash-drawer/current');
        const el = ov.querySelector('#drawerEntries');
        if (el) el.innerHTML = drawerEntriesHtml(data?.entries);
        await refreshShift();
      } catch (e) {}
    };
    if (sh) refreshDrawerEntries();

    const updateTotal = () => {
      const el = ov.querySelector('#shTotal');
      if (el) el.textContent = !sh && !cashCountTouched(ov) ? (suggestion ? `Tự dùng ${money(suggestion)}` : '0đ') : money(countCash(ov));
    };
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
        await api('/shifts/open', { method: 'POST', body: { shift_key: ov.querySelector('#shKey').value, counts, opening_cash: countCash(ov), cash_manual: cashCountTouched(ov) } });
        ov.remove(); toast('Đã mở ca'); reload();
      } catch (e) { toast(e.message, true); }
    };

    const closeBtn = ov.querySelector('#shClose');
    if (closeBtn) closeBtn.onclick = async () => {
      if (!confirm('Kết ca hiện tại? Hệ thống sẽ chốt báo cáo ca.')) return;
      const counts = Object.fromEntries([...ov.querySelectorAll('[data-denom]')].map(i => [i.dataset.denom, parseInt(i.value) || 0]));
      try {
        const r = await api('/shifts/close', { method: 'POST', body: { shift_key: ov.querySelector('#shKey').value, counts, closing_cash: countCash(ov) } });
        ov.remove(); toast(`Đã kết ca. Ca này ${money(r.report?.total_revenue || 0)} · Ngày vận hành ${money(r.day_report?.total_revenue || 0)}`); reload();
      } catch (e) { toast(e.message, true); }
    };
  }

  render();
  return { reload, openPanel, getState: () => state };
}
