// Print Service: queues print jobs (kitchen tickets, receipts, labels) and
// streams them to the Printer Monitor (/printers). Printers carry no logic —
// they just receive jobs, exactly per spec section 25.
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { getPrintConfig } from './settings.js';

const STATION_PRINTER = { kitchen: 'kitchen', salad: 'kitchen', bar: 'bar', beverage: 'bar' };

export function createJob({ printer, type, title, payload, branch_id = 'br1' }) {
  const id = uid('pj_');
  db.prepare(`INSERT INTO print_jobs (id,branch_id,printer,type,title,payload_json,status,created_at) VALUES (?,?,?,?,?,?,'queued',?)`)
    .run(id, branch_id, printer, type, title || '', JSON.stringify(payload || {}), now());
  const job = getJob(id);
  emit('print:new', job, branch_id);
  return job;
}

export function getJob(id) {
  const j = db.prepare(`SELECT * FROM print_jobs WHERE id=?`).get(id);
  if (j) j.payload = JSON.parse(j.payload_json || '{}');
  return j;
}

export function listJobs(branch_id = 'br1', limit = 50) {
  return db.prepare(`SELECT * FROM print_jobs WHERE branch_id=? ORDER BY created_at DESC LIMIT ?`).all(branch_id, limit)
    .map(j => ({ ...j, payload: JSON.parse(j.payload_json || '{}') }));
}

export function markPrinted(id, branch_id = 'br1') {
  db.prepare(`UPDATE print_jobs SET status='printed', printed_at=? WHERE id=?`).run(now(), id);
  emit('print:done', { id }, branch_id);
  return getJob(id);
}

export function reprint(id, branch_id = 'br1') {
  const j = getJob(id);
  if (!j) throw new Error('Print job không tồn tại');
  audit('print.reprint', { job: id }, branch_id);
  return createJob({ printer: j.printer, type: j.type, title: '(IN LẠI) ' + j.title, payload: j.payload, branch_id });
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
        items: list.map(i => ({ qty: i.qty, name: i.name, note: i.note, mods: JSON.parse(i.mods_json || '[]').map(m => m.name) })),
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

function parseMods(item) {
  if (Array.isArray(item?.mods)) return item.mods;
  try { return JSON.parse(item?.mods_json || '[]'); }
  catch { return []; }
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
    const mods = parseMods(item).map(m => m.name || m).filter(Boolean);
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

// Food-runner / expediter slip: one small slip PER dish when it is ready, with a
// big table number so the runner can clip it onto the plate. Not a cup/label sticker.
export function printRunnerSlip(item, order, branch_id = 'br1') {
  if (!item || item.station === 'retail') return; // retail isn't plated/run to tables
  const table = order?.table_code || (order?.online_channel ? 'ONLINE' : '—');
  const copies = Math.min(Math.max(1, parseInt(item.qty) || 1), 30); // one slip per plate
  const mods = JSON.parse(item.mods_json || '[]').map(m => m.name);
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
