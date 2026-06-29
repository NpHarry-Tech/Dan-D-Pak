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

function compactPrintConfig(cfg = {}, kind = '') {
  if (!cfg || typeof cfg !== 'object') return null;
  const out = {};
  if (kind === 'receipt' || kind === 'bill') out.bill = { ...(cfg.bill || {}) };
  if (kind === 'label' || kind === 'cup_label' || kind === 'product_label') out.labels = { ...(cfg.labels || {}) };
  if (kind === 'kitchen_ticket') out.kitchen = { ...(cfg.kitchen || {}) };
  return Object.keys(out).length ? out : null;
}

function compactPayload(payload = {}, type = '') {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  if (out.print_config) {
    out.print_config = compactPrintConfig(
      out.print_config,
      type === 'receipt' ? 'receipt' : type === 'cup_label' || type === 'product_label' ? 'label' : type
    );
    if (!out.print_config) delete out.print_config;
  }
  return out;
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
  if (p.connection === 'agent') return `agent:${p.systemName || p.name || ''}`;
  if (p.connection === 'system') return p.systemName || p.name || '';
  return 'manual';
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

function center(text, width = 40) {
  const s = ascii(text).slice(0, width);
  const pad = Math.max(0, Math.floor((width - s.length) / 2));
  return ' '.repeat(pad) + s;
}

function line(ch = '-', width = 40) {
  return ch.repeat(width);
}

function wrap(text, width = 40) {
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

// Tem bếp dạng bill (khổ K80, 42 ký tự). Bố cục: Khu vực / Bàn / Giờ + Ngày /
// Nhân viên / Số thứ tự (= 3 số cuối Số Bill) / Tên món. Khi tách từng món thì
// payload chứa 1 món (p.name); chế độ gộp cũ vẫn render được qua p.items[].
function renderTicket(p = {}) {
  const W = 40;
  const rows = [
    '',
    center((p.zone || p.station || 'KHU VUC').toUpperCase()),
    center(p.table ? `BAN ${p.table}` : '-'),
    line(),
    center(`Gio: ${p.time || ''}    Ngay: ${p.date || ''}`.trim()),
    center(`Nhan vien: ${p.staff || '-'}`),
    center(`So thu tu: ${p.seq || ''}`),
  ];
  if (p.copy) rows.push(center(`(${p.copy})`));
  rows.push(line(), 'Ten mon');
  if (Array.isArray(p.items) && p.items.length) {
    for (const i of p.items) {
      rows.push(...wrap(`${i.qty || 1}x ${(i.name || '').toUpperCase()}`, W));
      const mods = itemMods(i);
      if (mods.length) rows.push(...wrap(`+ ${mods.join(', ')}`, W).map(x => '  ' + x));
      if (i.note) rows.push(...wrap(`Ghi chu: ${i.note}`, W).map(x => '  ' + x));
      rows.push(line('.', W));
    }
  } else {
    rows.push(...wrap((p.name || '').toUpperCase(), W));
    const mods = itemMods(p);
    if (mods.length) rows.push(...wrap(`+ ${mods.join(', ')}`, W).map(x => '  ' + x));
    if (p.note) rows.push(...wrap(`Ghi chu: ${p.note}`, W).map(x => '  ' + x));
  }
  return rows.join('\n');
}

function renderRunner(p = {}) {
  return [
    center('CHAY MON - BAN'),
    center(p.table || '-', 20),
    line(),
    ...wrap(p.name || '', 40),
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
    ...wrap(p.itemName || p.name || '', 40),
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
  // Two rows per item: full name on top, then
  // the figures below aligned under the SL / Đ.Giá / T.Tiền columns.
  const nameLines = wrap(i.name || '', DAN_W);
  const figures = ' '.repeat(DAN_NAME)
    + ' ' + String(qty).padStart(DAN_QTY)
    + ' ' + danMoney(price).padStart(DAN_PRICE)
    + ' ' + danMoney(price * qty).padStart(DAN_AMT);
  return [...nameLines, figures].join('\n');
}

function renderReceipt(p = {}) {
  const cfg = p.print_config?.bill || {};
  const rows = [];
  
  if (cfg.storeName || p.branch || 'DAN D PAK') {
    const wrapped = wrap(cfg.storeName || p.branch || 'DAN D PAK', 40);
    for (const lineText of wrapped) {
      rows.push(center(lineText, 40));
    }
  }
  
  if (cfg.address) {
    const wrapped = wrap(cfg.address, 40);
    for (const lineText of wrapped) {
      rows.push(center(lineText, 40));
    }
  }
  
  rows.push(line());
  if (p.preview) {
    rows.push(center('HOA DON TAM TINH', 40));
  } else {
    rows.push(center(`HOA DON #${p.number || ''}`, 40));
  }
  if (p.table_code) {
    rows.push(center(`Ban ${p.table_code}`, 40));
  }
  rows.push(line());
  
  for (const i of p.items || []) {
    const qty = Number(i.qty) || 1;
    const price = Number(i.unit_price) || 0;
    rows.push(...wrap(`${qty}x ${i.name || ''}`, 30));
    rows.push(`${money(price)} x ${qty}`.padEnd(22) + money(price * qty).padStart(18));
  }
  
  rows.push(line());
  rows.push('TONG'.padEnd(22) + money(p.total || 0).padStart(18));
  if (Array.isArray(p.lines) && p.lines.length) {
    for (const l of p.lines) {
      rows.push(`${methodLabel(l.method)}`.padEnd(22) + money(l.amount).padStart(18));
    }
  }
  rows.push(line());
  
  const footerText = cfg.footer || 'Cam on quy khach';
  const wrappedFooter = wrap(footerText, 40);
  for (const lineText of wrappedFooter) {
    rows.push(center(lineText, 40));
  }
  
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

// Real reachability probe: opens a TCP socket to the printer (RAW/JetDirect
// port 9100 by default) and reports whether it actually answers. Cached briefly
// so the live status panel polling every few seconds doesn't hammer the network.
const lanProbeCache = new Map(); // "ip:port" -> { at, reachable }
const LAN_PROBE_TTL = 8000;

function probeLan(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (reachable) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      resolve(reachable);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const socket = net.createConnection({ host, port: Number(port) || 9100 });
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
  });
}

async function probeLanCached(host, port, force = false) {
  const key = `${host}:${Number(port) || 9100}`;
  const cached = lanProbeCache.get(key);
  if (!force && cached && Date.now() - cached.at < LAN_PROBE_TTL) return cached.reachable;
  const reachable = await probeLan(host, port);
  lanProbeCache.set(key, { at: Date.now(), reachable });
  return reachable;
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

function psLiteral(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

async function writeSystemPrinter(name, text) {
  const dir = mkdtempSync(join(tmpdir(), 'dandpak-print-'));
  const file = join(dir, 'job.txt');
  writeFileSync(file, ascii(text) + '\n', 'utf8');
  try {
    if (process.platform === 'win32') {
      const command = `Get-Content -Raw -LiteralPath ${psLiteral(file)} | Out-Printer -Name ${psLiteral(name)}`;
      await execFileAsync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64'),
      ], { timeout: 12000, windowsHide: true });
    } else {
      await execFileAsync('lp', ['-d', name, file], { timeout: 12000 });
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// ---- Hardware Agent (C++) transport: USB / locally-attached printers ----
// LAN printers stay on the direct TCP path above; this talks to the local
// dandpak-hw-agent.exe over loopback HTTP so USB printers get real ESC/POS bytes.
const AGENT_URL = (process.env.HW_AGENT_URL || 'http://127.0.0.1:39041').replace(/\/+$/, '');
const AGENT_TOKEN = process.env.HW_AGENT_TOKEN || '';
const agentProbe = { at: 0, ok: false };

async function probeAgentCached(force = false) {
  if (!force && Date.now() - agentProbe.at < LAN_PROBE_TTL) return agentProbe.ok;
  try {
    const res = await fetch(`${AGENT_URL}/health`, { cache: 'no-store', signal: AbortSignal.timeout(1200) });
    agentProbe.ok = res.ok;
  } catch {
    agentProbe.ok = false;
  }
  agentProbe.at = Date.now();
  return agentProbe.ok;
}

async function writeAgent(printer, buffer, route = 'print') {
  const name = printer.systemName || printer.name || '';
  if (!name) throw new Error('Tuyến Agent cần tên máy in Windows (systemName)');
  const body = route === 'drawer' ? { printer: name } : { printer: name, dataBase64: buffer.toString('base64') };
  let res;
  try {
    res = await fetch(`${AGENT_URL}/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HW-Token': AGENT_TOKEN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    throw new Error(`Không kết nối được Hardware Agent (${AGENT_URL}). Agent đã chạy chưa? ${e.message}`);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Hardware Agent báo lỗi: HTTP ${res.status} ${t.slice(0, 160)}`);
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
  return { ...j, payload: compactPayload(payload, j.type), meta };
}

function fullJob(j) {
  if (!j) return null;
  const payload = j.payload || parsePayload(j.payload_json);
  return { ...j, payload, meta: jobMeta({ ...j, payload }) };
}

export function getJob(id) {
  return fullJob(db.prepare(`SELECT * FROM print_jobs WHERE id=?`).get(id));
}

export function getJobForBranch(id, branch_id = 'br1') {
  const job = publicJob(db.prepare(`SELECT * FROM print_jobs WHERE id=?`).get(id));
  if (!job) return null;
  if (job.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  return job;
}

export function getJobForBranchFull(id, branch_id = 'br1') {
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
  `).run(id, branch_id, printer, type, title || '', JSON.stringify(compactPayload(payload || {}, type)), now(), reprint_of);
  const job = getJobForBranch(id, branch_id);
  emit('print:new', job, branch_id);
  emit('print:queued', { job, branch_id }, branch_id);
  const p = printerById(printer, branch_id);
  if (p?.active !== false && p?.auto && ['lan', 'agent', 'system'].includes(p.connection)) {
    setTimeout(() => dispatchJob(id, branch_id).catch(() => {}), 25);
  }
  return job;
}

export function listJobs(branch_id = 'br1', query = {}) {
  const limit = Math.max(1, Math.min(300, parseInt(query.limit || query) || 120));
  return db.prepare(`SELECT * FROM print_jobs WHERE branch_id=? ORDER BY created_at DESC LIMIT ?`).all(branch_id, limit).map(publicJob);
}

export async function listPrinters(branch_id = 'br1', { force = false } = {}) {
  const configured = printerRows(branch_id);
  const system = await listSystemPrinters({ force }).catch(() => []);
  const systemMap = new Map(system.map(p => [String(p.name || '').toLowerCase(), p]));
  return Promise.all(configured.map(async p => {
    const connection = ['lan', 'agent', 'system', 'manual'].includes(p.connection) ? p.connection : 'manual';
    const match = systemMap.get(String(p.systemName || p.name || '').toLowerCase());
    const target = printerTarget(p);

    // status: machine-readable (kept backward compatible with Printer Monitor).
    // state: pill colour for the live panel. statusText: human label, real-data.
    let status = 'ready', state = 'ok', statusText = '';
    let online = false;

    if (p.active === false) {
      status = 'disabled'; state = 'warn'; statusText = 'Tạm tắt'; online = false;
    } else if (connection === 'lan') {
      if (!p.ip) {
        status = 'not_configured'; state = 'bad'; statusText = 'Chưa nhập IP máy in LAN'; online = false;
      } else {
        const reachable = await probeLanCached(p.ip, p.port, force);
        online = reachable;
        status = reachable ? 'ready' : 'offline';
        state = reachable ? 'ok' : 'bad';
        statusText = reachable
          ? `Đã kết nối · ${p.ip}:${p.port || 9100}`
          : `Không phản hồi · ${p.ip}:${p.port || 9100}`;
      }
    } else if (connection === 'agent') {
      const name = p.systemName || p.name || '';
      if (!name) {
        status = 'not_configured'; state = 'bad'; statusText = 'Chưa chọn máy in USB cho tuyến Agent'; online = false;
      } else {
        const up = await probeAgentCached(force);
        online = up;
        status = up ? 'ready' : 'offline';
        state = up ? 'ok' : 'bad';
        statusText = up ? `Hardware Agent · ${name}` : 'Hardware Agent chưa chạy (mở dandpak-hw-agent.exe)';
      }
    } else if (connection === 'system') {
      const name = p.systemName || p.name || '';
      if (!name) {
        status = 'not_configured'; state = 'bad'; statusText = 'Chưa chọn máy in trên máy chủ'; online = false;
      } else if (!match) {
        status = 'offline'; state = 'bad'; statusText = `Không thấy "${name}" trên máy chủ`; online = false;
      } else if (match.online === false) {
        status = 'offline'; state = 'bad'; statusText = `Máy in tắt / ngoại tuyến · ${name}`; online = false;
      } else {
        status = 'ready'; state = 'ok'; statusText = `Đã kết nối · ${name}`; online = true;
      }
    } else {
      status = 'ready'; state = 'ok'; statusText = 'Chờ thao tác in thủ công'; online = true;
    }

    return { ...p, connection, target, online, status, state, statusText, system: match || null };
  }));
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
  const connection = ['lan', 'agent', 'system', 'manual'].includes(printer.connection) ? printer.connection : 'manual';
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
    } else if (connection === 'agent') {
      await writeAgent(printer, escposBuffer(text, { drawer: printer.openDrawerOnPrint && job.type === 'receipt' }));
    } else if (connection === 'system') {
      const name = printer.systemName || printer.name;
      if (!name) throw new Error('Thiếu tên máy in hệ điều hành');
      await writeSystemPrinter(name, text);
    } else {
      throw new Error('Tuyến này đang để chế độ in thủ công, cần xác nhận từ màn hình vận hành');
    }
    job = patchJob(id, { status: 'printed', printed_at: now(), printed_by: 'server', error: null });
    emit('print:done', getJobForBranch(id, branch_id), branch_id);
    audit('print.printed', { job: id, printer: job.printer, type: job.type, transport: connection, target }, branch_id);
    return job;
  } catch (e) {
    job = patchJob(id, { status: 'failed', error: e.message || String(e) });
    emit('print:failed', getJobForBranch(id, branch_id), branch_id);
    audit('print.failed', { job: id, printer: job.printer, type: job.type, error: job.error }, branch_id);
    throw e;
  }
}

export function markPrinted(id, branch_id = 'br1', actor = 'manual') {
  const existing = getJob(id);
  if (!existing) throw new Error('Print job không tồn tại');
  if (existing.branch_id !== branch_id) throw new Error('Print job không thuộc chi nhánh hiện tại');
  const job = patchJob(id, { status: 'printed', printed_at: now(), printed_by: actor, error: null });
  emit('print:done', getJobForBranch(id, branch_id), branch_id);
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
  if (p.connection === 'agent') {
    await writeAgent(p, null, 'drawer');
  } else if (p.connection === 'lan') {
    if (!p.ip) throw new Error('Thiếu IP máy in bill nối két tiền');
    await writeLan(p.ip, p.port || 9100, Buffer.concat([ESC_INIT, ESC_DRAWER]), 4500);
  } else {
    throw new Error('Mở két tự động cần máy in bill kết nối LAN/IP ESC/POS hoặc tuyến Agent (USB)');
  }
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
export function printKitchenTickets(order, items, branch_id = 'br1', staff = '') {
  const kitchenItems = items.filter(it => it && it.station !== 'retail');
  if (!kitchenItems.length) return;

  const k = getPrintConfig(branch_id).kitchen || {};
  const split = k.splitPerItem !== '0' && k.splitPerItem !== false;
  const perUnit = k.perUnit !== '0' && k.perUnit !== false;
  const showStaff = k.showStaff !== '0' && k.showStaff !== false;

  const now = new Date();
  const base = {
    zone: order.zone || '',
    table: order.table_code || (order.online_channel ? 'ONLINE' : '—'),
    staff: showStaff ? (staff || '') : '',
    // Số thứ tự = 3 số cuối của Số Bill (Dan{ddMMyy}{seq}). VD Dan2106260001 -> 001.
    seq: String(order.bill_no || order.online_ref || order.id || '').slice(-3),
    time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    date: now.toLocaleDateString('vi-VN'),
  };

  // Chế độ gộp cũ: 1 phiếu / trạm in.
  if (!split) {
    const byPrinter = {};
    for (const it of kitchenItems) {
      const p = STATION_PRINTER[it.station] || 'kitchen';
      (byPrinter[p] ||= []).push(it);
    }
    for (const [printer, list] of Object.entries(byPrinter)) {
      createJob({
        printer, type: 'kitchen_ticket',
        title: `Bàn ${base.table} · #${base.seq}`,
        payload: {
          ...base, station: printer.toUpperCase(),
          items: list.map(i => ({ qty: i.qty, name: i.name, note: i.note, mods: itemMods(i) })),
        }, branch_id,
      });
    }
    return;
  }

  // Tách từng món: mỗi món (mỗi phần nếu perUnit) ra 1 tem riêng.
  for (const it of kitchenItems) {
    const printer = STATION_PRINTER[it.station] || 'kitchen';
    const copies = perUnit ? Math.min(Math.max(1, parseInt(it.qty) || 1), 30) : 1;
    for (let i = 0; i < copies; i++) {
      createJob({
        printer, type: 'kitchen_ticket',
        title: `Bàn ${base.table} · ${it.name}`,
        payload: {
          ...base, station: printer.toUpperCase(),
          name: it.name, qty: it.qty, mods: itemMods(it), note: it.note || '',
          copy: copies > 1 ? `${i + 1}/${copies}` : '',
        }, branch_id,
      });
    }
  }
}

export function printReceipt(receipt, branch_id = 'br1') {
  const cfg = receipt.print_config || getPrintConfig(branch_id);
  const copies = Math.max(1, Math.min(9, parseInt(receipt.print_copies || cfg?.bill?.copies || 1) || 1));
  for (let i = 0; i < copies; i++) {
    createJob({
      printer: 'bill',
      type: 'receipt',
      title: `Receipt #${receipt.number}${copies > 1 ? ` (${i + 1}/${copies})` : ''}`,
      payload: { ...receipt, print_config: cfg, copy_index: i + 1, copy_total: copies },
      branch_id,
    });
  }
}

function shouldPrintCupLabels(order, cfg) {
  if (!cfg?.labels || cfg.labels.autoPrint === '0' || cfg.labels.autoPrint === false) return false;
  if (['takeaway', 'delivery'].includes(order?.channel) || !!order?.online_channel) return true;
  return order?.channel === 'dine_in' && cfg.labels.autoPrintDineIn !== '0' && cfg.labels.autoPrintDineIn !== false;
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
