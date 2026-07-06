import { api, esc, toast } from '/shared/client.js';

const FIELD_LIMITS = {
  tax_code: 16,
  company: 180,
  name: 140,
  address: 260,
  email: 120,
  phone: 40,
  note: 280,
};

const clean = (value, max = 200) => String(value || '').trim().slice(0, max);
const taxDigits = (value) => clean(value, FIELD_LIMITS.tax_code).replace(/\D/g, '');

export function createCompanyInvoiceDraft(seed = {}) {
  return {
    enabled: !!seed.enabled,
    tax_code: seed.tax_code || '',
    company: seed.company || '',
    name: seed.name || '',
    address: seed.address || '',
    email: seed.email || '',
    phone: seed.phone || '',
    note: seed.note || '',
  };
}

export function companyInvoiceHtml(draft, { id = 'companyInvoice' } = {}) {
  const d = createCompanyInvoiceDraft(draft);
  const checked = d.enabled ? 'checked' : '';
  const body = d.enabled ? `
    <div class="invoice-mst-row">
      <input type="text" inputmode="numeric" autocomplete="off" id="${id}TaxCode" value="${esc(d.tax_code)}" placeholder="MST công ty">
      <button class="btn sm" id="${id}Lookup" type="button">Lấy thông tin</button>
    </div>
    <div class="invoice-grid">
      <label>Tên khách hàng trên hóa đơn<input type="text" id="${id}Name" value="${esc(d.name)}" placeholder="Để trống sẽ dùng tên trên MST"></label>
      <label>Tên công ty theo MST<input type="text" id="${id}Company" value="${esc(d.company)}" placeholder="Tự điền sau khi lấy thông tin"></label>
      <label class="full">Địa chỉ<input type="text" id="${id}Address" value="${esc(d.address)}" placeholder="Địa chỉ đăng ký thuế"></label>
      <label>Email nhận hóa đơn<input type="email" id="${id}Email" value="${esc(d.email)}" placeholder="email@congty.com"></label>
      <label>Số điện thoại<input type="tel" id="${id}Phone" value="${esc(d.phone)}" placeholder="SĐT nhận hóa đơn"></label>
      <label class="full">Ghi chú<textarea id="${id}Note" rows="2" maxlength="${FIELD_LIMITS.note}" placeholder="Ghi chú cho kế toán / xuất hóa đơn">${esc(d.note)}</textarea></label>
    </div>` : '';
  return `<div class="invoice-box">
    <label class="invoice-toggle">
      <input type="checkbox" id="${id}Enabled" ${checked}>
      <span><b>Xuất hóa đơn công ty</b><small>Không lưu vào danh bạ khách hàng</small></span>
    </label>
    ${body}
  </div>`;
}

export function bindCompanyInvoiceBox(root, draft, { id = 'companyInvoice', onRedraw = () => {} } = {}) {
  const enabled = root.querySelector(`#${id}Enabled`);
  if (!enabled) return;
  enabled.onchange = () => {
    draft.enabled = enabled.checked;
    onRedraw();
  };
  if (!draft.enabled) return;

  const bind = (suffix, key, limit) => {
    const el = root.querySelector(`#${id}${suffix}`);
    if (!el) return;
    el.oninput = () => { draft[key] = clean(el.value, limit); };
  };
  bind('TaxCode', 'tax_code', FIELD_LIMITS.tax_code);
  bind('Name', 'name', FIELD_LIMITS.name);
  bind('Company', 'company', FIELD_LIMITS.company);
  bind('Address', 'address', FIELD_LIMITS.address);
  bind('Email', 'email', FIELD_LIMITS.email);
  bind('Phone', 'phone', FIELD_LIMITS.phone);
  bind('Note', 'note', FIELD_LIMITS.note);

  const lookup = root.querySelector(`#${id}Lookup`);
  if (lookup) {
    lookup.onclick = async () => {
      const mst = taxDigits(root.querySelector(`#${id}TaxCode`)?.value || draft.tax_code);
      if (!/^\d{10}(\d{3})?$/.test(mst)) return toast('MST phải gồm 10 hoặc 13 chữ số', true);
      lookup.disabled = true;
      try {
        const r = await api('/customers/lookup/tax/' + encodeURIComponent(mst));
        draft.tax_code = mst;
        if (r.company) draft.company = clean(r.company, FIELD_LIMITS.company);
        if (r.name && !draft.name) draft.name = clean(r.name, FIELD_LIMITS.name);
        if (r.address) draft.address = clean(r.address, FIELD_LIMITS.address);
        toast(r.ok ? 'Đã lấy thông tin MST' : (r.message || 'Không tìm thấy MST, có thể nhập tay'));
        onRedraw();
      } catch (e) {
        toast(e.message || 'Không tra cứu được MST', true);
      } finally {
        lookup.disabled = false;
      }
    };
  }
}

export function companyInvoicePayload(draft) {
  if (!draft?.enabled) return null;
  const tax_code = taxDigits(draft.tax_code);
  const company = clean(draft.company, FIELD_LIMITS.company);
  const name = clean(draft.name, FIELD_LIMITS.name) || company;
  const email = clean(draft.email, FIELD_LIMITS.email);
  const phone = clean(draft.phone, FIELD_LIMITS.phone);
  if (!/^\d{10}(\d{3})?$/.test(tax_code)) throw new Error('Nhập MST công ty 10 hoặc 13 chữ số');
  if (!name) throw new Error('Nhập tên khách hàng hoặc lấy thông tin từ MST');
  if (!email) throw new Error('Nhập email nhận hóa đơn');
  if (!phone) throw new Error('Nhập số điện thoại nhận hóa đơn');
  return {
    invoice_type: 'company',
    invoice_request: true,
    tax_code,
    company,
    name,
    address: clean(draft.address, FIELD_LIMITS.address),
    email,
    phone,
    note: clean(draft.note, FIELD_LIMITS.note),
  };
}

export function invoiceReceiptCustomerName(customer, fallback = 'Bán cho người tiêu dùng') {
  const c = customer || {};
  if (c.invoice_request) {
    return c.invoice_customer_name || c.invoice_name || c.name || c.company || fallback;
  }
  return c.name || c.company || fallback;
}

export function invoiceReceiptTaxCode(customer, fallback = '') {
  const c = customer || {};
  return c.tax_code || fallback;
}
