// shared/customer.js — Shared customer module
// Usage: import { perkTag, perkAmount, loadCustomers, openCustomerPicker } from '/shared/customer.js';
import { api, money, esc, toast } from '/shared/client.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Returns customer perk display string (e.g. " · -40%") */
export function perkTag(c) {
  if (!c?.perk_type || c.perk_type === 'none') return '';
  if (c.perk_type === 'pct') return ` · -${c.perk_value}%`;
  if (c.perk_type === 'amount') return ` · -${money(c.perk_value)}`;
  if (c.perk_type === 'free') return ' · FREE';
  return '';
}

/** Calculate discount amount based on customer perk */
export function perkAmount(c, subtotal) {
  if (!c?.perk_type || c.perk_type === 'none') return 0;
  if (c.perk_type === 'pct') return Math.round((subtotal || 0) * (c.perk_value || 0) / 100);
  if (c.perk_type === 'amount') return Number(c.perk_value) || 0;
  if (c.perk_type === 'free') return subtotal || 0;
  return 0;
}

/** Load customer list from API */
export async function loadCustomers() {
  return api('/customers').catch(() => []);
}

/**
 * Open modal to select / create customer.
 *
 * @param {object|null} current  - Currently selected customer (or null = walk-in)
 * @param {Function}    onPicked - Callback(customer|null) on confirm
 * @param {object}      [opts]
 *   @param {string}    [opts.title]   - Modal title
 *   @param {string}    [opts.subtitle] - Subtitle
 */
export async function openCustomerPicker(current, onPicked, opts = {}) {
  const customers = await loadCustomers();
  let search = '', editing = null, selectedCustomer = current;

  function form(c) {
    return `<div class="panel" style="margin:14px 0 0"><h3>${c.id ? 'Edit customer' : 'New customer'}</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
        <div><label>Customer / company name *</label><input id="cName" value="${esc(c.name||'')}"></div>
        <div><label>Phone number</label><input id="cPhone" value="${esc(c.phone||'')}"></div>
        <div style="grid-column:1/-1"><label>Tax code (for invoices)</label>
          <div style="display:flex;gap:8px"><input id="cTax" value="${esc(c.tax_code||'')}" placeholder="10 or 13 digits" style="flex:1"><button class="btn" id="cLookup" type="button">🔎 Lookup Tax Code</button></div>
          <small id="cTaxHint" style="color:var(--muted)"></small></div>
        <div style="grid-column:1/-1"><label>Company name (on invoice)</label><input id="cCompany" value="${esc(c.company||'')}"></div>
        <div style="grid-column:1/-1"><label>Address</label><input id="cAddress" value="${esc(c.address||'')}"></div>
        <div style="grid-column:1/-1" id="cPerkRow">
        <div><label>Default perk</label><select id="cPerkType">
          <option value="none" ${(!c.perk_type||c.perk_type==='none')?'selected':''}>None</option>
          <option value="pct"  ${c.perk_type==='pct'?'selected':''}>% Discount</option>
          <option value="amount" ${c.perk_type==='amount'?'selected':''}>Fixed discount</option>
          <option value="free" ${c.perk_type==='free'?'selected':''}>Free (100%)</option>
        </select></div>
        <div><label>Perk value</label><input type="number" id="cPerkValue" value="${c.perk_value||0}" min="0"></div>
        </div>
        <div style="grid-column:1/-1"><label>Notes</label><input id="cNote" value="${esc(c.note||'')}"></div>
      </div>
      <div class="mfoot"><button class="btn" id="cBack">${editing ? 'Cancel edit' : 'Close'}</button><button class="btn primary" id="cSave">💾 Save customer</button></div>
    </div>`;
  }

  function render() {
    const list = customers.filter(c =>
      !search || c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search) || c.tax_code?.includes(search)
    );
    ov.querySelector('#cSearch').value = search;
    ov.querySelector('#cList').innerHTML = list.length
      ? list.map(c => `<div class="listrow ${selectedCustomer?.id===c.id?'sel':''}" data-id="${c.id}">
          <div><b>${esc(c.name)}</b><small>${esc(c.phone||'')}${c.perk_type&&c.perk_type!=='none'?' · Perk'+perkTag(c):''}</small></div>
          <button class="btn sm" data-edit="${c.id}">Edit</button>
        </div>`).join('') : '<div class="empty" style="padding:16px">No customers yet. Click "＋ New customer".</div>';
    ov.querySelector('#cForm').innerHTML = editing ? form(editing) : '<div class="mfoot"><button class="btn" id="cClose">Close</button></div>';
    bindForm();
  }

  const ov = document.createElement('div');
  ov.className = 'modal-backdrop';
  ov.innerHTML = `<div class="modal" style="max-width:560px">
    <h2>${esc(opts.title || '👤 Customers')}</h2>
    <div class="sub">${esc(opts.subtitle || 'Select a saved customer or create new. Customers with perks get automatic discounts.')}</div>
    <div style="display:flex;gap:8px;margin:12px 0">
      <input id="cSearch" value="${esc(search)}" placeholder="Search by name / phone / tax code" style="flex:1">
      <button class="btn" id="cWalkin">Walk-in (deselect)</button>
      <button class="btn primary" id="cNew">＋ New customer</button>
    </div>
    <div id="cList"></div>
    <div id="cForm"></div>
  </div>`;
  document.body.appendChild(ov);

  function bindForm() {
    ov.querySelector('#cSearch')?.addEventListener('input', e => { search = e.target.value; render(); });
    ov.querySelector('#cWalkin')?.addEventListener('click', () => { selectedCustomer = null; onPicked(null); ov.remove(); });
    ov.querySelector('#cNew')?.addEventListener('click', () => { editing = {}; render(); });
    ov.querySelector('#cClose')?.addEventListener('click', () => ov.remove());
    ov.querySelector('#cBack')?.addEventListener('click', () => { editing = null; render(); });

    ov.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit]')) return;
      const c = customers.find(x => String(x.id) === el.dataset.id);
      if (c) { selectedCustomer = c; onPicked(c); ov.remove(); }
    }));
    ov.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('click', () => {
      editing = { ...customers.find(x => String(x.id) === el.dataset.edit) };
      render();
    }));

    const lookup = ov.querySelector('#cLookup');
    const hint = ov.querySelector('#cTaxHint');
    if (lookup) lookup.onclick = async () => {
      const mst = ov.querySelector('#cTax')?.value?.trim();
      if (!mst) return toast('Please enter a tax code first', true);
      hint.textContent = 'Looking up...';
      try {
        const r = await api('/customers/lookup-tax?mst=' + encodeURIComponent(mst));
        if (r.company || r.name) {
          if (editing) { editing.company = r.company || r.name; editing.name = editing.name || r.name; }
          hint.textContent = `✓ ${r.source === 'vietqr' ? 'Looked up from tax authority' : 'Retrieved from saved customer'}: ${r.company || r.name}`;
          render();
        } else {
          hint.textContent = r.message || 'Not found';
        }
      } catch(e) { hint.textContent = e.message || 'Lookup failed'; }
    };

    const saveBtn = ov.querySelector('#cSave');
    if (saveBtn) saveBtn.onclick = async () => {
      if (!editing) return;
      const body = {
        name: ov.querySelector('#cName')?.value?.trim(),
        phone: ov.querySelector('#cPhone')?.value?.trim(),
        tax_code: ov.querySelector('#cTax')?.value?.trim(),
        company: ov.querySelector('#cCompany')?.value?.trim(),
        address: ov.querySelector('#cAddress')?.value?.trim(),
        perk_type: ov.querySelector('#cPerkType')?.value,
        perk_value: Number(ov.querySelector('#cPerkValue')?.value) || 0,
        note: ov.querySelector('#cNote')?.value?.trim(),
      };
      if (!body.name) return toast('Please enter customer name', true);
      try {
        const saved = editing.id
          ? await api('/customers/' + editing.id, { method: 'PUT', body })
          : await api('/customers', { method: 'POST', body });
        const idx = customers.findIndex(c => c.id === saved.id);
        if (idx >= 0) customers[idx] = saved; else customers.unshift(saved);
        editing = null;
        selectedCustomer = saved;
        onPicked(saved);
        ov.remove();
      } catch(e) { toast(e.message, true); }
    };
  }

  render();
}
