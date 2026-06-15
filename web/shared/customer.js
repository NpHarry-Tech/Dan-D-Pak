// shared/customer.js — Module khách hàng dùng chung
// Sử dụng: import { perkTag, perkAmount, loadCustomers, openCustomerPicker } from '/shared/customer.js';
import { api, money, esc, toast } from '/shared/client.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Trả về chuỗi hiển thị ưu đãi khách hàng (vd: " · -40%") */
export function perkTag(c) {
  if (!c || !c.perk_type || c.perk_type === 'none') return '';
  if (c.perk_type === 'free') return ' · FREE';
  if (c.perk_type === 'pct')  return ` · -${c.perk_value}%`;
  if (c.perk_type === 'amount') return ` · -${money(c.perk_value)}`;
  return '';
}

/** Tính số tiền giảm dựa trên perk của khách */
export function perkAmount(c, base) {
  if (!c) return 0;
  if (c.perk_type === 'free')   return base;
  if (c.perk_type === 'pct')    return Math.min(base, Math.floor(base * (c.perk_value || 0) / 100));
  if (c.perk_type === 'amount') return Math.min(base, c.perk_value || 0);
  return 0;
}

/** Tải danh sách khách hàng từ API */
export async function loadCustomers() {
  try { return await api('/customers'); } catch { return []; }
}

// ─── Customer Picker Modal ──────────────────────────────────────────────────

/**
 * Mở modal chọn / tạo khách hàng.
 *
 * @param {object|null} current  - Khách đang chọn (hoặc null = khách lẻ)
 * @param {Function}    onPicked - Callback(customer|null) khi xác nhận
 * @param {object}      opts
 *   @param {string}    [opts.title]   - Tiêu đề modal
 *   @param {string}    [opts.subtitle] - Mô tả phụ
 */
export function openCustomerPicker(current, onPicked, opts = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay show';
  document.body.appendChild(ov);

  let customers = [];
  let editing = null, search = '', sel = current || null;

  const close = () => ov.remove();
  function done(c) { close(); onPicked && onPicked(c || null); }

  function form(c) {
    return `<div class="panel" style="margin:14px 0 0"><h3>${c.id ? 'Sửa khách hàng' : 'Khách hàng mới'}</h3>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px">
        <div><label>Tên khách / công ty *</label><input id="cName" value="${esc(c.name||'')}"></div>
        <div><label>Số điện thoại</label><input id="cPhone" value="${esc(c.phone||'')}"></div>
        <div style="grid-column:1/-1"><label>Mã số thuế (xuất hóa đơn)</label>
          <div style="display:flex;gap:8px"><input id="cTax" value="${esc(c.tax_code||'')}" placeholder="10 hoặc 13 chữ số" style="flex:1"><button class="btn" id="cLookup" type="button">🔎 Truy xuất MST</button></div>
          <div class="mini" id="cLookupHint" style="margin-top:4px"></div></div>
        <div style="grid-column:1/-1"><label>Tên công ty (trên hóa đơn)</label><input id="cCompany" value="${esc(c.company||'')}"></div>
        <div style="grid-column:1/-1"><label>Địa chỉ</label><input id="cAddress" value="${esc(c.address||'')}"></div>
        <div><label>Email</label><input id="cEmail" value="${esc(c.email||'')}"></div>
        <div><label>Ưu đãi mặc định</label><select id="cPerkType">
          <option value="none" ${(!c.perk_type||c.perk_type==='none')?'selected':''}>Không</option>
          <option value="pct"  ${c.perk_type==='pct'?'selected':''}>Giảm theo %</option>
          <option value="amount" ${c.perk_type==='amount'?'selected':''}>Giảm số tiền</option>
          <option value="free" ${c.perk_type==='free'?'selected':''}>Miễn phí (free 100%)</option>
        </select></div>
        <div><label>Giá trị ưu đãi</label><input type="number" id="cPerkValue" value="${c.perk_value||0}" min="0"></div>
        <div style="grid-column:1/-1"><label>Ghi chú</label><input id="cNote" value="${esc(c.note||'')}"></div>
      </div>
      <div class="mfoot"><button class="btn" id="cBack">${editing ? 'Hủy sửa' : 'Đóng'}</button><button class="btn primary" id="cSave">💾 Lưu khách hàng</button></div>
    </div>`;
  }

  async function draw() {
    const term = search.trim().toLowerCase();
    const list = customers.filter(c =>
      !term || [c.name, c.phone, c.tax_code, c.company].some(v => String(v || '').toLowerCase().includes(term))
    );
    ov.innerHTML = `<div class="modal" style="max-width:720px">
      <h2>${esc(opts.title || '👤 Khách hàng')}</h2>
      <div class="sub">${esc(opts.subtitle || 'Chọn khách đã lưu hoặc tạo mới. Khách có ưu đãi sẽ tự áp giảm giá vào đơn.')}</div>
      <div style="display:flex;gap:8px;align-items:center;margin:6px 0 4px">
        <input id="cSearch" value="${esc(search)}" placeholder="Tìm theo tên / SĐT / MST" style="flex:1">
        <button class="btn" id="cWalkin">Khách lẻ (bỏ chọn)</button>
        <button class="btn primary" id="cNew">＋ Khách mới</button>
      </div>
      <div class="custlist">${list.length ? list.map(c => `
        <div class="custrow ${sel?.id === c.id ? 'on' : ''}" data-pick="${c.id}">
          <div><b>${esc(c.name)}</b>${perkTag(c) ? `<span class="ptag">${esc(perkTag(c).replace(/^ · /,''))}</span>` : ''}
            <div class="mini">${[c.phone, c.tax_code && ('MST ' + c.tax_code), c.company].filter(Boolean).map(esc).join(' · ') || '—'}</div>
          </div>
          <button class="btn sm" data-edit="${c.id}">Sửa</button>
        </div>`).join('') : '<div class="empty" style="padding:16px">Chưa có khách hàng. Bấm "＋ Khách mới".</div>'}
      </div>
      ${editing ? form(editing) : '<div class="mfoot"><button class="btn" id="cClose">Đóng</button></div>'}
    </div>`;

    const s = ov.querySelector('#cSearch');
    s.oninput = () => {
      search = s.value;
      const p = s.selectionStart;
      draw();
      const ns = ov.querySelector('#cSearch');
      ns.focus(); ns.setSelectionRange(p, p);
    };
    ov.querySelector('#cWalkin').onclick = () => done(null);
    ov.querySelector('#cNew').onclick    = () => { editing = { perk_type: 'none', perk_value: 0 }; draw(); };
    ov.querySelector('#cClose')?.addEventListener('click', close);
    ov.querySelectorAll('[data-pick]').forEach(r => r.onclick = e => {
      if (e.target.closest('[data-edit]')) return;
      sel = customers.find(c => c.id === r.dataset.pick) || null;
      done(sel);
    });
    ov.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
      editing = customers.find(c => c.id === b.dataset.edit) || {};
      draw();
    });
    if (editing) bindForm();
  }

  function bindForm() {
    ov.querySelector('#cBack').onclick = () => { editing = null; draw(); };
    ov.querySelector('#cLookup').onclick = async () => {
      const mst = ov.querySelector('#cTax').value.trim();
      const hint = ov.querySelector('#cLookupHint');
      if (!mst) return toast('Nhập MST trước', true);
      hint.textContent = 'Đang tra cứu...';
      try {
        const r = await api('/customers/lookup/tax/' + encodeURIComponent(mst));
        if (r.ok) {
          if (r.company) ov.querySelector('#cCompany').value = r.company;
          if (r.address) ov.querySelector('#cAddress').value = r.address;
          if (r.name && !ov.querySelector('#cName').value) ov.querySelector('#cName').value = r.name;
          hint.textContent = `✓ ${r.source === 'vietqr' ? 'Tra cứu từ cơ quan thuế' : 'Lấy từ khách đã lưu'}: ${r.company || r.name}`;
          hint.style.color = 'var(--done)';
        } else {
          hint.textContent = r.message || 'Không tìm thấy';
          hint.style.color = 'var(--late)';
        }
      } catch (e) { hint.textContent = e.message; hint.style.color = 'var(--late)'; }
    };
    ov.querySelector('#cSave').onclick = async () => {
      const body = {
        id:       editing.id || undefined,
        name:     ov.querySelector('#cName').value.trim(),
        phone:    ov.querySelector('#cPhone').value.trim(),
        email:    ov.querySelector('#cEmail').value.trim(),
        tax_code: ov.querySelector('#cTax').value.trim(),
        company:  ov.querySelector('#cCompany').value.trim(),
        address:  ov.querySelector('#cAddress').value.trim(),
        perk_type:  ov.querySelector('#cPerkType').value,
        perk_value: parseInt(ov.querySelector('#cPerkValue').value) || 0,
        note:     ov.querySelector('#cNote').value.trim(),
      };
      if (!body.name) return toast('Nhập tên khách hàng', true);
      try {
        const saved = await api('/customers', { method: 'POST', body });
        // refresh local list
        customers = await loadCustomers();
        sel = saved;
        editing = null;
        done(saved);
      } catch (e) { toast(e.message, true); }
    };
  }

  // Load then show
  loadCustomers().then(rows => { customers = rows; draw(); });
}
