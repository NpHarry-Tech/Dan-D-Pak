// Payment Core: multi-method payment lines, close bill, trigger inventory deduction.
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { getOrder, getTableState, resolveStaffCall } from './orders.js';
import { deductForOrder } from './inventory.js';
import { printReceipt } from './printing.js';
import { getOperationsConfig, getPrintConfig } from './settings.js';
import { getActiveShift } from './shifts.js';
import { archiveOrder, archivePayment } from './archive.js';

const METHODS = ['cash', 'card', 'qr', 'voucher', 'bank_transfer', 'internet_banking', 'qrcode', 'momo', 'zalopay', 'visa', 'pos_card', 'online'];
const CUSTOMER_QR_METHODS = ['qr', 'qrcode', 'internet_banking', 'momo', 'zalopay'];

function cleanText(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function normalizeInvoiceCustomer(input) {
  if (!input || typeof input !== 'object' || !input.invoice_request) return null;
  const tax_code = cleanText(input.tax_code, 16).replace(/\D/g, '');
  const company = cleanText(input.company, 180);
  const name = cleanText(input.name, 140) || company;
  const email = cleanText(input.email, 120);
  const phone = cleanText(input.phone, 40);
  if (!/^\d{10}(\d{3})?$/.test(tax_code)) throw new Error('MST công ty phải gồm 10 hoặc 13 chữ số');
  if (!name) throw new Error('Thiếu tên khách hàng xuất hóa đơn');
  if (!email) throw new Error('Thiếu email nhận hóa đơn');
  if (!phone) throw new Error('Thiếu số điện thoại nhận hóa đơn');
  return {
    invoice_request: true,
    invoice_type: 'company',
    invoice_customer_name: name,
    invoice_company: company,
    tax_code,
    company,
    name,
    address: cleanText(input.address, 260),
    email,
    phone,
    note: cleanText(input.note, 280),
    requested_at: now(),
  };
}

function mergeInvoiceCustomer(customer, invoiceCustomer) {
  const base = customer && typeof customer === 'object' ? customer : {};
  if (!invoiceCustomer) return Object.keys(base).length ? base : null;
  return {
    ...base,
    name: invoiceCustomer.name || invoiceCustomer.company || base.name || '',
    phone: invoiceCustomer.phone || base.phone || '',
    email: invoiceCustomer.email || base.email || '',
    tax_code: invoiceCustomer.tax_code,
    company: invoiceCustomer.company || invoiceCustomer.name || base.company || '',
    address: invoiceCustomer.address || base.address || '',
    invoice_request: true,
    invoice_type: 'company',
    invoice_customer_name: invoiceCustomer.invoice_customer_name,
    invoice_company: invoiceCustomer.invoice_company,
    invoice_note: invoiceCustomer.note || '',
    invoice_requested_at: invoiceCustomer.requested_at,
  };
}

// lines: [{method, amount, reference}]
export function payOrder(order_id, lines, { discount, cashier, customer, invoice_customer } = {}, branch_id = 'br1') {
  const order = getOrder(order_id);
  if (!order) throw new Error('Order không tồn tại');
  if (order.status !== 'open') throw new Error('Order đã đóng');

  if (typeof discount === 'number') {
    db.prepare(`UPDATE orders SET discount=?, total=MAX(0,subtotal-?) WHERE id=?`).run(discount, discount, order_id);
  }
  const invoiceCustomer = normalizeInvoiceCustomer(invoice_customer);
  const customerSnapshot = mergeInvoiceCustomer(customer, invoiceCustomer);
  if (customerSnapshot) {
    if (invoiceCustomer) {
      db.prepare(`UPDATE orders SET customer_json=?, invoice_choice='requested' WHERE id=?`).run(JSON.stringify(customerSnapshot), order_id);
      audit('invoice.company_requested', { order: order_id, tax_code: invoiceCustomer.tax_code, email: invoiceCustomer.email, phone: invoiceCustomer.phone }, branch_id, cashier || 'system');
    } else {
      db.prepare(`UPDATE orders SET customer_json=? WHERE id=?`).run(JSON.stringify(customerSnapshot), order_id);
    }
  }
  const fresh = getOrder(order_id);
  const pending = fresh.items.filter(i => i.status === 'pending_confirm');
  if (pending.length) throw new Error(`Còn ${pending.length} dòng món đang chờ nhân viên xác nhận`);

  const ops = getOperationsConfig(branch_id);
  const shift = getActiveShift(branch_id);
  if (ops.shifts.requireOpenShift !== false && !shift) throw new Error('Can mo ca lam viec truoc khi thanh toan.');

  const paid = lines.reduce((s, l) => s + (parseInt(l.amount) || 0), 0);
  if (paid < fresh.total) throw new Error(`Chưa đủ tiền: cần ${fresh.total}, nhận ${paid}`);
  for (const l of lines) if (!METHODS.includes(l.method)) throw new Error('Phương thức không hợp lệ: ' + l.method);

  const pid = uid('pay_');
  db.prepare(`INSERT INTO payments (id,order_id,shift_id,total,created_at) VALUES (?,?,?,?,?)`).run(pid, order_id, shift?.id || null, fresh.total, now());
  const insLine = db.prepare(`INSERT INTO payment_lines (id,payment_id,method,amount,reference) VALUES (?,?,?,?,?)`);
  for (const l of lines) insLine.run(uid('pl_'), pid, l.method, parseInt(l.amount) || 0, l.reference || null);

  db.prepare(`UPDATE orders SET status='paid', paid_at=? WHERE id=?`).run(now(), order_id);
  // Mark all remaining active items served on close
  db.prepare(`UPDATE order_items SET status='served', served_at=? WHERE order_id=? AND status NOT IN ('served','cancelled')`)
    .run(now(), order_id);

  deductForOrder(fresh, branch_id);

  if (order.table_id) {
    const stillOpen = db.prepare(`SELECT 1 FROM orders WHERE table_id=? AND branch_id=? AND status='open' LIMIT 1`)
      .get(order.table_id, branch_id);
    db.prepare(`UPDATE tables SET status=? WHERE id=?`).run(stillOpen ? 'busy' : 'free', order.table_id);
    resolveStaffCall(order.table_id, branch_id);
    emit('table:updated', getTableState(order.table_id), branch_id);
  }
  audit('payment.done', { order: order_id, total: fresh.total, lines: lines.length, shift_id: shift?.id || null }, branch_id);
  const receipt = buildReceipt(order_id, pid, lines, paid, { cashier });
  receipt.print_config = getPrintConfig(branch_id);
  receipt.branch_id = branch_id;
  archiveOrder(getOrder(order_id));
  archivePayment(receipt);
  printReceipt(receipt, branch_id);
  emit('payment:done', { order_id, receipt }, branch_id);
  emit('stats:dirty', {}, branch_id);
  return receipt;
}

export function requestPayment(table_id, branch_id = 'br1') {
  db.prepare(`UPDATE tables SET status='paying' WHERE id=? AND status='busy'`).run(table_id);
  emit('table:updated', getTableState(table_id), branch_id);
}

export function customerQrPay(order_id, { method = 'qrcode', reference = '' } = {}, branch_id = 'br1') {
  const chosen = CUSTOMER_QR_METHODS.includes(method) ? method : 'qrcode';
  const order = getOrder(order_id);
  if (!order) throw new Error('Order khong ton tai');
  if (order.status !== 'open') throw new Error('Order da dong');
  const pending = order.items.filter(i => i.status === 'pending_confirm');
  if (pending.length) throw new Error(`Con ${pending.length} dong mon dang cho nhan vien xac nhan`);
  const ops = getOperationsConfig(branch_id);
  const cfg = (ops.payment?.methods || []).find(m => m.key === chosen);
  if (cfg && cfg.enabled === false) throw new Error('Phuong thuc thanh toan nay dang tat trong Cai dat');
  const ref = String(reference || `${(ops.payment?.transferPrefix || 'DANBILL').replace(/\s+/g, '').toUpperCase()}-${order.bill_no || order_id.slice(-6).toUpperCase()}`).slice(0, 120);
  return payOrder(order_id, [{ method: chosen, amount: order.total, reference: ref }], { cashier: 'Khach tu thanh toan QR' }, branch_id);
}

function buildReceipt(order_id, payment_id, lines, paid, { cashier = '' } = {}) {
  const order = getOrder(order_id);
  const branch = db.prepare(`SELECT name FROM branches WHERE id=?`).get(order.branch_id);
  const printCfg = getPrintConfig(order.branch_id);
  const cfg = printCfg.einvoice || {};
  const billCfg = printCfg.bill || {};
  const change = Math.max(0, paid - order.total);
  return {
    payment_id, order_id, branch: branch?.name, table_code: order.table_code,
    items: order.items.filter(i => i.status !== 'cancelled'),
    subtotal: order.subtotal, discount: order.discount, total: order.total,
    tax: {
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
      invoice_series: cfg.series || 'C26TMB',
    },
    voucher_id: order.voucher_id, voucher_code: order.voucher_code,
    customer: (() => { try { return order.customer_json ? JSON.parse(order.customer_json) : null; } catch { return null; } })(),
    invoice_choice: order.invoice_choice || '',
    invoice_id: order.invoice_id || null,
    lines, paid, change, paid_at: order.paid_at, number: order.bill_no || order_id.slice(-6).toUpperCase(),
    bill_no: order.bill_no || order_id.slice(-6).toUpperCase(),
    cashier,
  };
}
