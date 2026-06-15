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

  function reportBlock() {
    const r = state?.report; if (!r) return '';
    const row = (l, v, hi) => `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12.5px"><span style="color:var(--muted)">${l}</span><b ${hi ? 'style="color:var(--brand)"' : ''}>${v}</b></div>`;
    return `<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:10px">
      <div style="font-weight:800;font-size:13px;margin-bottom:6px">Báo cáo ca hiện tại</div>
      ${row('Tiền đầu ca', money(r.opening_cash))}
      ${row('Số bill', r.bill_count)}
      ${row('Tiền mặt thu', money(r.cash_sales))}
      ${row('Chuyển khoản/QR', money(r.transfer_sales))}
      ${row('Quẹt thẻ', money(r.pos_sales))}
      ${row('Tổng doanh thu ca', money(r.total_revenue), true)}
      ${row('Tiền mặt dự kiến trong két', money(r.expected_cash))}
    </div>`;
  }

  function openPanel() {
    const sh = state?.shift;
    const labels = (cfg.shifts.labels || FALLBACK.shifts.labels).filter(x => x.enabled !== false);
    const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const ov = document.createElement('div'); ov.className = 'overlay show';
    ov.innerHTML = `<div class="modal" style="max-width:560px">
      <h2>${sh ? 'Ca đang mở' : 'Mở ca làm việc'}</h2>
      <div class="sub">📅 Hôm nay: <b style="color:var(--text)">${esc(today)}</b>${sh ? ` · mở lúc ${new Date(sh.opened_at).toLocaleString('vi-VN')}${sh.user_name ? ' · ' + esc(sh.user_name) : ''}` : ''}</div>
      <label>Loại ca</label>
      <select id="shKey">${labels.map(x => `<option value="${esc(x.key)}" ${x.key === (sh?.shift_key || '') ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
      <label>Kiểm đếm tiền mặt ${sh ? 'cuối ca' : 'đầu ca'}</label>
      ${denoms()}
      <div class="shift-total">Tổng kiểm đếm<b id="shTotal">0đ</b></div>
      ${reportBlock()}
      <div class="mfoot"><button class="btn" id="shCancel">Đóng</button>${sh ? '<button class="btn danger" id="shClose">Kết ca</button>' : '<button class="btn primary" id="shOpen">Mở ca</button>'}</div>
    </div>`;
    document.body.appendChild(ov);
    const upd = () => ov.querySelector('#shTotal').textContent = money(countCash(ov));
    ov.querySelectorAll('[data-denom]').forEach(i => i.oninput = upd); upd();
    ov.querySelector('#shCancel').onclick = () => ov.remove();
    const openBtn = ov.querySelector('#shOpen');
    if (openBtn) openBtn.onclick = async () => {
      const counts = Object.fromEntries([...ov.querySelectorAll('[data-denom]')].map(i => [i.dataset.denom, parseInt(i.value) || 0]));
      try { await api('/shifts/open', { method: 'POST', body: { shift_key: ov.querySelector('#shKey').value, counts, opening_cash: countCash(ov) } }); ov.remove(); toast('Đã mở ca'); reload(); }
      catch (e) { toast(e.message, true); }
    };
    const closeBtn = ov.querySelector('#shClose');
    if (closeBtn) closeBtn.onclick = async () => {
      if (!confirm('Kết ca hiện tại? Hệ thống sẽ chốt báo cáo ca.')) return;
      const counts = Object.fromEntries([...ov.querySelectorAll('[data-denom]')].map(i => [i.dataset.denom, parseInt(i.value) || 0]));
      try { const r = await api('/shifts/close', { method: 'POST', body: { shift_key: ov.querySelector('#shKey').value, counts, closing_cash: countCash(ov) } }); ov.remove(); toast('Đã kết ca · doanh thu ' + money(r.report?.total_revenue || 0)); reload(); }
      catch (e) { toast(e.message, true); }
    };
  }

  render();
  return { reload, openPanel, getState: () => state };
}
