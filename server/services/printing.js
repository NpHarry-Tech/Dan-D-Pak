// Print service: queues jobs, sends real ESC/POS LAN or OS-printer jobs,
// records errors, and keeps a full print history for monitor/reprint.
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { promisify } from 'node:util';
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { getPrintConfig } from './settings.js';
import { listSystemPrinters } from './system.js';

const execFileAsync = promisify(execFile);
const STATION_PRINTER = { kitchen: 'kitchen', salad: 'kitchen', bar: 'bar', beverage: 'bar' };
const ESC_INIT = Buffer.from([0x1b, 0x40]);
const ESC_CUT = Buffer.from([0x1d, 0x56, 0x42, 0x00]);
const ESC_DRAWER = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

const TYPE_LABEL = {
  kitchen_ticket: 'Lên món / Phiếu bếp',
  receipt: 'Hóa đơn / Tạm tính',
  cup_label: 'Tem ly',
  product_label: 'Tem sản phẩm',
  runner: 'Phiếu chạy món',
  test: 'In thử',
  cash_drawer: 'Mở két tiền',
  inventory_document: 'Phiếu kho',
  purchase: 'Phiếu mua hàng',
  refund: 'Hoàn / trả hàng',
};

function parsePayload(raw) {
  try { return JSON.parse(raw || '{}') || {}; } catch { return {}; }
}

function printerRows(branch_id = 'br1') {
  const cfg = getPrintConfig(branch_id);
  return Array.isArray(cfg.printers) ? cfg.printers : [];
}

function printerById(printer, branch_id = 'br1') {
  return printerRows(branch_id).find(p => p.id === printer) || null;
}

function printerTarget(p = {}) {
  if (p.connection === 'lan') return `${p.ip || ''}:${p.port || 9100}`;
  if (p.connection === 'system') return p.systemName || p.name || '';
  return 'browser';
}

function money(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;
}

function ascii(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

function center(text, width = 42) {
  const s = ascii(text).slice(0, width);
  const pad = Math.max(0, Math.floor((width - s.length) / 2));
  return ' '.repeat(pad) + s;
}

function line(ch = '-', width = 42) {
  return ch.repeat(width);
}

function wrap(text, width = 42) {
  const words = ascii(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const rows = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= width) cur += ' ' + w;
    else { rows.push(cur); cur = w; }
  }
  if (cur) rows.push(cur);
  return rows.length ? rows : [''];
}

function itemMods(i = {}) {
  if (Array.isArray(i.mods)) return i.mods;
  try { return JSON.parse(i.mods_json || '[]').map(m => m.name || m); } catch { return []; }
}

function renderTicket(p = {}) {
  const rows = [
    center(`=== ${p.station || 'KITCHEN'} ===`),
    line(),
    `Ban: ${p.table || '-'}                              #${p.order_no || ''}`.slice(0, 42),
    `Gio: ${p.time || new Date().toLocaleTimeString('vi-VN')}`,
    line(),
  ];
  for (const i of p.items || []) {
    rows.push(...wrap(`${i.qty || 1}x ${i.name || ''}`, 42));
    const mods = itemMods(i);
    if (mods.length) rows.push(...wrap(`+ ${mods.join(', ')}`, 42).map(x => '  ' + x));
    if (i.note) rows.push(...wrap(`NOTE: ${i.note}`, 42).map(x => '  ' + x));
    rows.push(line('.', 42));
  }
  return rows.join('\n');
}

function renderRunner(p = {}) {
  return [
    center('CHAY MON - BAN'),
    center(p.table || '-', 20),
    line(),
    ...wrap(p.name || '', 42),
    p.seq ? center(`phan ${p.seq}`) : '',
    ...(Array.isArray(p.mods) && p.mods.length ? wrap(`+ ${p.mods.join(', ')}`) : []),
    ...(p.note ? wrap(`NOTE: ${p.note}`) : []),
    line(),
    `#${p.order_no || ''} ${p.station || ''} ${p.time || ''}`.trim(),
  ].filter(Boolean).join('\n');
}

function renderLabel(p = {}) {
  return [
    center('TEM'),
    line(),
    ...wrap(p.itemName || p.name || '', 42),
    p.options ? `+ ${ascii(p.options)}` : '',
    p.note ? `NOTE: ${ascii(p.note)}` : '',
    line(),
    `${p.order_no || ''} ${p.table || ''} ${p.time || ''}`.trim(),
  ].filter(Boolean).join('\n');
}

function methodLabel(m) {
  return { cash: 'Tien mat', card: 'May POS', qrcode: 'QR', qr: 'QR', voucher: 'Voucher', internet_banking: 'Internet Banking', momo: 'MoMo', zalopay: 'ZaloPay', visa: 'Visa' }[m] || m || '-';
}

// ---- Dan "HÓA ĐƠN THANH TOÁN" thermal receipt (42-col, ESC/POS ASCII) ----
const DAN_W = 42, DAN_NAME = 17, DAN_QTY = 2, DAN_PRICE = 9, DAN_AMT = 10;
function danMoney(n) { return (Math.round(Number(n) || 0)).toLocaleString('en-US').replace(/,/g, ' '); }
function danMethod(m) {
  return { cash: 'TIEN MAT', card: 'THE', visa: 'THE', qrcode: 'TRANSFER', qr: 'TRANSFER', bank_transfer: 'TRANSFER', internet_banking: 'TRANSFER', momo: 'MOMO', zalopay: 'ZALOPAY', voucher: 'VOUCHER' }[m] || (m ? String(m).toUpperCase() : 'TIEN MAT');
}
function rightPad(s, w = DAN_W) { s = ascii(s); return s.length >= w ? s : ' '.repeat(w - s.length) + s; }
function labelValue(label, value, w = DAN_W) {
  label = ascii(label); value = ascii(value);
  const gap = Math.max(1, w - label.length - value.length);
  return label + ' '.repeat(gap) + value;
}
function danDateTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}.${p(d.getMinutes())}`;
}
function danItemRow(i = {}) {
  const qty = Number(i.qty) || 1;
  const price = Number(i.unit_price ?? i.price) || 0;
  const nameLines = wrap(i.name || '', DAN_NAME);
  const head = nameLines[0].padEnd(DAN_NAME)
    + ' ' + String(qty).padStart(DAN_QTY)
    + ' ' + danMoney(price).padStart(DAN_PRICE)
    + ' ' + danMoney(price * qty).padStart(DAN_AMT);
  return [head, ...nameLines.slice(1)].join('\n');
}

function renderReceipt(p = {}) {
  const cfg = p.print_config?.bill || {};
  const storeName = cfg.storeName || p.branch || 'Dan';
  const place = p.table_code ? `Ban ${p.table_code}` : 'Mang ve';
  const lines = Array.isArray(p.lines) ? p.lines : [];
  const paid = Number(p.paid ?? p.total) || 0;
  const change = Number(p.change ?? Math.max(0, paid - (Number(p.total) || 0))) || 0;
  const rows = [
    center(storeName, DAN_W),
    cfg.storeSubtitle ? center(cfg.storeSubtitle, DAN_W) : '',
    '',
    ...(cfg.address ? wrap(cfg.address, DAN_W) : []),
    cfg.phone ? `Tel: ${ascii(cfg.phone)}` : '',
    line('-', DAN_W),
    center('HOA DON THANH TOAN', DAN_W),
    '',
    `So Hoa Don: ${ascii(p.number || '')}  ${place}`,
    `Thu ngan: ${ascii(p.cashier || '')}`,
    `Ngay/Gio vao: ${danDateTime(p.created_at || p.paid_at)}`,
    `Ngay/Gio ra: ${danDateTime(p.paid_at || p.created_at)}`,
    line('-', DAN_W),
    'Ten mon'.padEnd(DAN_NAME) + ' ' + 'SL'.padStart(DAN_QTY) + ' ' + 'D.Gia'.padStart(DAN_PRICE) + ' ' + 'T.Tien'.padStart(DAN_AMT),
  ];
  for (const i of p.items || []) rows.push(danItemRow(i));
  rows.push(line('-', DAN_W));
  rows.push(labelValue('TONG TIEN:', danMoney(p.total || 0), DAN_W));
  for (const l of lines) rows.push(rightPad(`${danMethod(l.method)}(VND) - ${danMoney(l.amount)}`, DAN_W));
  rows.push(labelValue('Tien khach dua:', danMoney(paid), DAN_W));
  rows.push(labelValue('Tien tra khach:', danMoney(change), DAN_W));
  rows.push('');
  if (cfg.taxIncludedText) rows.push(center(cfg.taxIncludedText, DAN_W));
  rows.push(center(`${cfg.storeSubtitle || ''} ${storeName}`.trim(), DAN_W));
  rows.push(center(cfg.footer || 'Xin cam on va hen gap lai', DAN_W));
  // No QR note here: this ESC/POS path prints plain text only and never emits a
  // scannable QR, so we must not tell the customer to scan one. The QR note is
  // shown by the web/preview renderers where a QR block is actually drawn.
  return rows.join('\n');
}

function renderGeneric(job) {
  const p = job.payload || {};
  return [
    center(TYPE_LABEL[job.type] || job.type || 'JOB IN'),
    line(),
    job.title || '',
    p.table ? `Ban: ${p.table}` : '',
    p.ref ? `Ma: ${p.ref}` : '',
    p.note ? `Ghi chu: ${p.note}` : '',
    line(),
    JSON.stringify(p, null, 2).slice(0, 1200),
  ].filter(Boolean).join('\n');
}

export function renderJobText(job) {
  const p = job.payload || {};
  if (job.type === 'kitchen_ticket') return renderTicket(p);
  if (job.type === 'runner') return renderRunner(p);
  if (job.type === 'receipt') return renderReceipt(p);
  if (job.type === 'cup_label' || job.type === 'product_label') return renderLabel(p);
  if (job.type === 'test') return renderGeneric(job);
  return renderGeneric(job);
}

function escposBuffer(text, { cut = true, drawer = false } = {}) {
  return Buffer.concat([
    ESC_INIT,
    Buffer.from(ascii(text) + '\n\n', 'utf8'),
    drawer ? ESC_DRAWER : Buffer.alloc(0),
    cut ? ESC_CUT : Buffer.alloc(0),
  ]);
}

function writeLan(host, port, buffer, timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) || 9100 });
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(() => finish(new Error(`Không kết nối được máy in LAN ${host}:${port}`)), timeoutMs);
    socket.on('connect', () => socket.write(buffer, (err) => err ? finish(err) : socket.end()));
    socket.on('close', () => finish());
    socket.on('error', finish);
  });
}

async function writeSystemPrinter(name, text) {
  const dir = mkdtempSync(join(tmpdir(), 'dandpak-print-'));
  const file = join(dir, 'job.txt');
  writeFileSync(file, ascii(text) + '\n', 'utf8');
  try {
    if (process.platform === 'win32') {
      await execFileAsync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `Get-Content -Raw -LiteralPath ${JSON.stringify(file)} | Out-Printer -Name ${JSON.stringify(name)}`,
      ], { timeout: 12000, windowsHide: true });
    } else {
      await execFileAsync('lp', ['-d', name, file], { timeout: 12000 });
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

function patchJob(id, fields = {}) {
  const keys = Object.keys(fields);
  if (!keys.length) return getJob(id);
  const sets = keys.map(k => `${k}=?`).join(',');
  db.prepare(`UPDATE print_jobs SET ${sets} WHERE id=?`).run(...keys.map(k => fields[k]), id);
  return getJob(id);
}

function publicJob(j) {
  if (!j) return null;
  const payload = j.payload || parsePayload(j.payload_json);
  const meta = jobMeta({ ...j, payload });
  return { ...j, payload, meta };
}

export function getJob(id) {
  return publicJob(db.prepare(`SELECT * FROM print_jobs WHERE id=?`).get(id));
}

export function getJobForBranch(id, branch_id = 'br1') {
  const job = getJob(id);
  if (!job) return null;
  if (job.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  return job;
}

export function createJob({ printer, type, title, payload, branch_id = 'br1', reprint_of = null }) {
  const id = uid('pj_');
  db.prepare(`
    INSERT INTO print_jobs (id,branch_id,printer,type,title,payload_json,status,created_at,reprint_of,attempts)
    VALUES (?,?,?,?,?,?,'queued',?,?,0)
  `).run(id, branch_id, printer, type, title || '', JSON.stringify(payload || {}), now(), reprint_of);
  const job = getJob(id);
  emit('print:new', job, branch_id);
  const p = printerById(printer, branch_id);
  if (p?.active !== false && p?.auto && p?.connection && p.connection !== 'browser') {
    setTimeout(() => dispatchJob(id, branch_id).catch(() => {}), 25);
  }
  return job;
}

export function listJobs(branch_id = 'br1', query = {}) {
  const limit = Math.max(1, Math.min(300, parseInt(query.limit || query) || 120));
  return db.prepare(`SELECT * FROM print_jobs WHERE branch_id=? ORDER BY created_at DESC LIMIT ?`).all(branch_id, limit).map(publicJob);
}

export async function listPrinters(branch_id = 'br1') {
  const configured = printerRows(branch_id);
  const system = await listSystemPrinters().catch(() => []);
  const systemMap = new Map(system.map(p => [String(p.name || '').toLowerCase(), p]));
  return configured.map(p => {
    const match = systemMap.get(String(p.systemName || p.name || '').toLowerCase());
    const target = printerTarget(p);
    const hasTarget = p.connection === 'lan' ? !!p.ip : (p.connection === 'system' ? !!(p.systemName || p.name) : true);
    return {
      ...p,
      target,
      online: p.active !== false && hasTarget && (p.connection !== 'system' || !match || match.online !== false),
      system: match || null,
      status: p.active === false ? 'disabled' : (!hasTarget ? 'not_configured' : (match?.online === false ? 'offline' : 'ready')),
    };
  });
}

export function jobMeta(job) {
  const p = job.payload || {};
  const items = Array.isArray(p.items) ? p.items : [];
  const first = items[0] || {};
  const table = p.table || p.table_code || p.tableCode || '';
  const ref = p.order_no || p.number || p.order_id || p.ref || '';
  return {
    action: TYPE_LABEL[job.type] || job.type || 'Job in',
    table,
    ref,
    station: p.station || job.printer || '',
    item_count: items.length || (p.itemName || p.name ? 1 : 0),
    item_preview: items.length ? `${first.qty || 1}x ${first.name || ''}` : (p.itemName || p.name || job.title || ''),
    amount: p.total || p.amount || null,
  };
}

export async function dispatchJob(id, branch_id = 'br1', { force = false } = {}) {
  let job = getJob(id);
  if (!job) throw new Error('Print job không tồn tại');
  if (job.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  if (!force && job.status === 'printed') return job;
  const printer = printerById(job.printer, branch_id);
  if (!printer) throw new Error(`Chưa cấu hình tuyến máy in ${job.printer}`);
  if (printer.active === false) throw new Error(`Tuyến máy in ${printer.label || printer.id} đang tắt`);
  const connection = printer.connection || 'browser';
  const target = printerTarget(printer);
  const text = renderJobText(job);
  patchJob(id, {
    status: 'printing',
    attempts: Number(job.attempts || 0) + 1,
    last_attempt_at: now(),
    error: null,
    transport: connection,
    target,
  });
  try {
    if (connection === 'lan') {
      if (!printer.ip) throw new Error('Thiếu IP máy in LAN');
      await writeLan(printer.ip, printer.port || 9100, escposBuffer(text, { drawer: printer.openDrawerOnPrint && job.type === 'receipt' }));
    } else if (connection === 'system') {
      const name = printer.systemName || printer.name;
      if (!name) throw new Error('Thiếu tên máy in hệ điều hành');
      await writeSystemPrinter(name, text);
    } else {
      throw new Error('Tuyến này đang để chế độ Trình duyệt, cần mở chi tiết để in bằng hộp thoại hệ thống');
    }
    job = patchJob(id, { status: 'printed', printed_at: now(), printed_by: 'server', error: null });
    emit('print:done', job, branch_id);
    audit('print.printed', { job: id, printer: job.printer, type: job.type, transport: connection, target }, branch_id);
    return job;
  } catch (e) {
    job = patchJob(id, { status: 'failed', error: e.message || String(e) });
    emit('print:failed', job, branch_id);
    audit('print.failed', { job: id, printer: job.printer, type: job.type, error: job.error }, branch_id);
    throw e;
  }
}

export function markPrinted(id, branch_id = 'br1', actor = 'manual') {
  const existing = getJob(id);
  if (!existing) throw new Error('Print job không tồn tại');
  if (existing.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  const job = patchJob(id, { status: 'printed', printed_at: now(), printed_by: actor, error: null });
  emit('print:done', job, branch_id);
  audit('print.mark_printed', { job: id, printer: job?.printer, type: job?.type }, branch_id, actor);
  return job;
}

export function reprint(id, branch_id = 'br1') {
  const j = getJob(id);
  if (!j) throw new Error('Print job không tồn tại');
  if (j.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  audit('print.reprint', { job: id }, branch_id);
  return createJob({ printer: j.printer, type: j.type, title: '(IN LẠI) ' + (j.title || ''), payload: j.payload, branch_id, reprint_of: id });
}

export async function testPrinter(printerId, branch_id = 'br1') {
  const p = printerById(printerId, branch_id);
  if (!p) throw new Error('Máy in chưa được cấu hình');
  const job = createJob({
    printer: printerId,
    type: 'test',
    title: `In thử ${p.label || p.id}`,
    payload: {
      ref: uid('test_'),
      note: `Test ${p.label || p.id} ${new Date().toLocaleString('vi-VN')}`,
      printer: p,
    },
    branch_id,
  });
  return dispatchJob(job.id, branch_id, { force: true });
}

export async function openCashDrawer(branch_id = 'br1', printerId = '') {
  const rows = printerRows(branch_id);
  const p = rows.find(x => x.id === printerId) || rows.find(x => x.cashDrawer) || rows.find(x => x.id === 'bill');
  if (!p) throw new Error('Chưa cấu hình máy in/két tiền');
  if (p.connection !== 'lan') throw new Error('Mở két tự động cần máy in bill kết nối LAN/IP ESC/POS');
  if (!p.ip) throw new Error('Thiếu IP máy in bill nối két tiền');
  await writeLan(p.ip, p.port || 9100, Buffer.concat([ESC_INIT, ESC_DRAWER]), 4500);
  const job = createJob({
    printer: p.id,
    type: 'cash_drawer',
    title: 'Mở két tiền',
    payload: { ref: uid('drawer_'), note: 'Mở két thủ công từ Printer Monitor' },
    branch_id,
  });
  markPrinted(job.id, branch_id, 'server');
  audit('cash_drawer.open_printer', { printer: p.id, target: printerTarget(p) }, branch_id);
  return { ok: true, printer: p.id, target: printerTarget(p), job: getJob(job.id) };
}

// ---- Hooks used by order/payment flows ----
export function printKitchenTickets(order, items, branch_id = 'br1') {
  const byPrinter = {};
  for (const it of items) {
    if (it.station === 'retail') continue;
    const p = STATION_PRINTER[it.station] || 'kitchen';
    (byPrinter[p] ||= []).push(it);
  }
  for (const [printer, list] of Object.entries(byPrinter)) {
    createJob({
      printer, type: 'kitchen_ticket',
      title: `Bàn ${order.table_code || order.online_ref || '—'} · #${order.id.slice(-5).toUpperCase()}`,
      payload: {
        station: printer.toUpperCase(), order_no: order.id.slice(-5).toUpperCase(),
        table: order.table_code || (order.online_channel ? 'ONLINE' : '—'),
        time: new Date().toLocaleTimeString('vi-VN'),
        items: list.map(i => ({ qty: i.qty, name: i.name, note: i.note, mods: itemMods(i) })),
      }, branch_id,
    });
  }
}

export function printReceipt(receipt, branch_id = 'br1') {
  createJob({
    printer: 'bill',
    type: 'receipt',
    title: `Receipt #${receipt.number}`,
    payload: { ...receipt, print_config: receipt.print_config || getPrintConfig(branch_id) },
    branch_id,
  });
}

function shouldPrintCupLabels(order, cfg) {
  if (!cfg?.labels || cfg.labels.autoPrint === '0' || cfg.labels.autoPrint === false) return false;
  return ['takeaway', 'delivery'].includes(order?.channel) || !!order?.online_channel;
}

export function printCupLabels(order, items = [], branch_id = 'br1') {
  const cfg = getPrintConfig(branch_id);
  if (!shouldPrintCupLabels(order, cfg)) return;
  const printable = items.filter(i => i && i.station !== 'retail' && i.status !== 'cancelled');
  for (const item of printable) {
    const copies = Math.min(Math.max(1, parseInt(item.qty) || 1), 30);
    const mods = itemMods(item).map(m => m.name || m).filter(Boolean);
    for (let i = 0; i < copies; i++) {
      createJob({
        printer: 'label',
        type: 'cup_label',
        title: `Tem ly · ${item.name}`,
        payload: {
          order_no: (order?.online_ref || order?.id || item.order_id || '').slice(-10).toUpperCase(),
          table: order?.table_code || (order?.online_channel ? 'ONLINE' : 'Mang đi'),
          channel: order?.online_channel || order?.channel || 'takeaway',
          customer: order?.customer?.name || '',
          phone: order?.customer?.phone || '',
          time: new Date().toLocaleTimeString('vi-VN'),
          itemName: item.name,
          options: mods.join(' · '),
          note: item.note || '',
          qty: item.qty,
          copy: copies > 1 ? `${i + 1}/${copies}` : '',
          print_config: cfg,
        },
        branch_id,
      });
    }
  }
}

export function printRunnerSlip(item, order, branch_id = 'br1') {
  if (!item || item.station === 'retail') return;
  const table = order?.table_code || (order?.online_channel ? 'ONLINE' : '—');
  const copies = Math.min(Math.max(1, parseInt(item.qty) || 1), 30);
  const mods = itemMods(item).map(m => m.name || m);
  for (let i = 0; i < copies; i++) {
    createJob({
      printer: 'runner', type: 'runner',
      title: `Chạy món · Bàn ${table}`,
      payload: {
        table,
        order_no: (order?.id || item.order_id || '').slice(-5).toUpperCase(),
        station: (item.station || 'kitchen').toUpperCase(),
        time: new Date().toLocaleTimeString('vi-VN'),
        seq: copies > 1 ? `${i + 1}/${copies}` : '',
        name: item.name,
        mods, note: item.note || '',
      }, branch_id,
    });
  }
}
