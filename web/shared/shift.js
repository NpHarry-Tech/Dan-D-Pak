// Shared shift control (open/close ca) — used by POS & Retail so both share the
// SAME branch shift via /shifts endpoints. Renders a header button + a modal that
// shows the current date, cash denomination count, and the live shift report.
import { api, money, toast, esc } from './client.js';

const FALLBACK = {
  shifts: {
    labels: [{ key: 'morning', label: 'Morning Shift' }, { key: 'evening', label: 'Evening Shift' }],
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
    container.innerHTML = `<button class="btn sm shiftbtn ${sh ? 'open' : 'closed'}" id="shiftBtn" title="Open / close work shift">${sh ? 'Shift: ' + (sh.shift_label || 'open') : 'Shift: not started'}</button>`;
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
      <div style="font-weight:800;font-size:13px;margin-bottom:6px">Current Shift Report</div>
      ${row('Opening Cash', money(r.opening_cash))}
      ${row('Bills', r.bill_count)}
      ${row('Cash Sales', money(r.cash_sales))}
      ${row('Transfer/QR', money(r.transfer_sales))}
      ${row('Card', money(r.pos_sales))}
      ${row('Total Shift Revenue', money(r.total_revenue), true)}
      ${row('Expected Cash in Drawer', money(r.expected_cash))}
    </div>`;
  }

  function openPanel() {
    const sh = state?.shift;
    const labels = (cfg.shifts.labels || FALLBACK.shifts.labels).filter(x => x.enabled !== false);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const ov = document.createElement('div'); ov.className = 'overlay show';
    ov.innerHTML = `<div class="modal" style="max-width:560px">
      <h2>${sh ? 'Shift Open' : 'Start Shift'}</h2>
      <div class="sub">📅 Today: <b style="color:var(--text)">${esc(today)}</b>${sh ? ` · opened at ${new Date(sh.opened_at).toLocaleString('en-US')}${sh.user_name ? ' · ' + esc(sh.user_name) : ''}` : ''}</div>
      <label>Shift type</label>
      <select id="shKey">${labels.map(x => `<option value="${esc(x.key)}" ${x.key === (sh?.shift_key || '') ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
      <label>Cash count ${sh ? 'end of shift' : 'start of shift'}</label>
      ${denoms()}
      <div class="shift-total">Total counted<b id="shTotal">0 ₫</b></div>
      ${reportBlock()}
      <div class="mfoot"><button class="btn" id="shCancel">Close</button>${sh ? '<button class="btn danger" id="shClose">End Shift</button>' : '<button class="btn primary" id="shOpen">Start Shift</button>'}</div>
    </div>`;
    document.body.appendChild(ov);
    const upd = () => ov.querySelector('#shTotal').textContent = money(countCash(ov));
    ov.querySelectorAll('[data-denom]').forEach(i => i.oninput = upd); upd();
    ov.querySelector('#shCancel').onclick = () => ov.remove();
    const openBtn = ov.querySelector('#shOpen');
    if (openBtn) openBtn.onclick = async () => {
      const counts = Object.fromEntries([...ov.querySelectorAll('[data-denom]')].map(i => [i.dataset.denom, parseInt(i.value) || 0]));
      try { await api('/shifts/open', { method: 'POST', body: { shift_key: ov.querySelector('#shKey').value, counts, opening_cash: countCash(ov) } }); ov.remove(); toast('Shift started'); reload(); }
      catch (e) { toast(e.message, true); }
    };
    const closeBtn = ov.querySelector('#shClose');
    if (closeBtn) closeBtn.onclick = async () => {
      if (!confirm('End current shift? The system will finalize the shift report.')) return;
      const counts = Object.fromEntries([...ov.querySelectorAll('[data-denom]')].map(i => [i.dataset.denom, parseInt(i.value) || 0]));
      try { const r = await api('/shifts/close', { method: 'POST', body: { shift_key: ov.querySelector('#shKey').value, counts, closing_cash: countCash(ov) } }); ov.remove(); toast('Shift ended · revenue ' + money(r.report?.total_revenue || 0)); reload(); }
      catch (e) { toast(e.message, true); }
    };
  }

  render();
  return { reload, openPanel, getState: () => state };
}
