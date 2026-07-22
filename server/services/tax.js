// Tax/VAT helpers shared by invoices, payments, printing and customer lookup.
import { db, now } from '../db.js';
import { allocateProportion, grossFromNet, money, multiplyMoney, netFromGross } from '../core/money.js';

export const DEFAULT_TAX_FILING_PROFILE = {
  hasProfile: false,
  taxCode: '',
  businessName: '',
  transitionDate: '',
  locations: [],
  revenueGroup: 1,
  productScope: 'all',
  scopeValue: [],
  confirmNoTax: false,
  taxRates: [
    { category: 'distribution', name: 'Ban buon/Ban le', vat: 1.0, pit: 0.5 },
    { category: 'services', name: 'Dich vu', vat: 5.0, pit: 2.0 },
    { category: 'manufacturing', name: 'San xuat', vat: 3.0, pit: 1.5 },
    { category: 'catering', name: 'An uong/Giai tri', vat: 2.0, pit: 1.0 },
  ],
};

function str(v, max = 300) { return String(v ?? '').trim().slice(0, max); }
function bool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

export function normalizeVatRate(value, fallback = 0) {
  const rate = Number(value);
  return Number.isFinite(rate) ? Math.min(100, Math.max(0, rate)) : fallback;
}

export function salePrice(price, vatRate = 0, includesVat = true) {
  const amount = Math.max(0, money(price));
  const rate = normalizeVatRate(vatRate);
  return includesVat || !rate ? amount : grossFromNet(amount, rate);
}

export function vatFromGross(amount, vatRate = 0) {
  const gross = Math.max(0, money(amount));
  const rate = normalizeVatRate(vatRate);
  return rate ? gross - netFromGross(gross, rate) : 0;
}

export function orderVatTotals(items = [], discount = 0) {
  const active = items.filter(item => item.status !== 'cancelled' && Number(item.qty) > 0 && Number(item.unit_price) > 0);
  const lineGrosses = active.map(item => multiplyMoney(Math.max(0, Number(item.unit_price) || 0), Math.max(0, Number(item.qty) || 0)));
  const subtotal = lineGrosses.reduce((sum, value) => sum + value, 0);
  const total = Math.max(0, subtotal - Math.max(0, money(discount)));
  if (!subtotal || !total) return { subtotal, goods_amount: total, vat_amount: 0, total };
  let allocated = 0;
  let vat_amount = 0;
  active.forEach((item, index) => {
    const lineGross = lineGrosses[index];
    const discountedGross = index === active.length - 1 ? total - allocated : allocateProportion(total, lineGross, subtotal);
    allocated += discountedGross;
    vat_amount += vatFromGross(discountedGross, item.vat_rate);
  });
  return { subtotal, goods_amount: total - vat_amount, vat_amount, total };
}

export function sanitizeTaxFilingProfile(raw = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const locations = Array.isArray(input.locations) ? input.locations.map(loc => ({
    id: str(loc.id || ''),
    name: str(loc.name || ''),
    address: str(loc.address || ''),
    branchId: str(loc.branchId || ''),
    isHeadquarters: bool(loc.isHeadquarters, false),
  })) : [];
  const taxRates = Array.isArray(input.taxRates) ? input.taxRates.map(tr => ({
    category: str(tr.category || ''),
    name: str(tr.name || ''),
    vat: parseFloat(tr.vat) || 0.0,
    pit: parseFloat(tr.pit) || 0.0,
  })) : DEFAULT_TAX_FILING_PROFILE.taxRates;
  return {
    hasProfile: bool(input.hasProfile, false),
    taxCode: str(input.taxCode || ''),
    businessName: str(input.businessName || ''),
    transitionDate: str(input.transitionDate || ''),
    locations,
    revenueGroup: parseInt(input.revenueGroup) || 1,
    productScope: str(input.productScope || 'all'),
    scopeValue: Array.isArray(input.scopeValue) ? input.scopeValue.map(v => str(v)) : [],
    confirmNoTax: bool(input.confirmNoTax, false),
    taxRates,
    updated_at: input.updated_at || now(),
  };
}

export function receiptTaxBlock(printCfg = {}) {
  const cfg = printCfg.einvoice || {};
  const billCfg = printCfg.bill || {};
  return {
    price_includes_vat: cfg.priceIncludesVat !== '0',
    vat_rate: cfg.defaultVatRate || '8',
    standard_vat_rate: cfg.standardVatRate || '10',
    legal_basis: cfg.legalBasis || '',
    unit_policy: cfg.unitPolicy || 'required',
    seller_tax_code: cfg.taxCode || billCfg.taxCode || '',
    seller_company: cfg.company || billCfg.storeName || '',
    seller_address: cfg.address || billCfg.address || '',
    seller_phone: cfg.phone || billCfg.phone || '',
    seller_email: cfg.email || billCfg.email || '',
    invoice_series: cfg.series || '',
  };
}

export function receiptTaxNote(printBillCfg = {}) {
  return printBillCfg.taxIncludedText || 'Don gia da bao gom VAT';
}

export async function lookupTaxCode(taxCode) {
  const tc = String(taxCode || '').replace(/\s+/g, '');
  if (!/^\d{10}(\d{3})?$/.test(tc)) {
    throw new Error('Ma so thue phai gom 10 hoac 13 chu so');
  }
  const local = db.prepare(`SELECT * FROM customers WHERE tax_code=?`).get(tc);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://api.vietqr.io/v2/business/${tc}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(t);
    if (res.ok) {
      const json = await res.json();
      const d = json?.data;
      if (d && (d.name || d.shortName)) {
        return {
          ok: true,
          source: 'vietqr',
          tax_code: tc,
          company: d.name || d.shortName || '',
          name: d.shortName || d.name || '',
          address: d.address || '',
          existed: local ? { id: local.id, name: local.name } : null,
        };
      }
    }
  } catch { /* fall through to local / not-found */ }
  if (local) {
    return {
      ok: true,
      source: 'local',
      tax_code: tc,
      company: local.company || local.name,
      name: local.name,
      address: local.address || '',
      existed: { id: local.id, name: local.name },
    };
  }
  return {
    ok: false,
    tax_code: tc,
    message: 'Khong tra cuu duoc thong tin theo MST nay. Vui long nhap tay.',
  };
}
