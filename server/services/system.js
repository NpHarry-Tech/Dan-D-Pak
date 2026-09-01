import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import dns from 'dns/promises';
import { env } from '../config/env.js';

const execFileAsync = promisify(execFile);
let printerCache = { at: 0, data: [] };
let internetCache = { at: 0, data: null };

function cacheValid(cache, ttlMs) {
  return cache.at && Date.now() - cache.at < ttlMs;
}

function parseJsonArray(text) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const parsed = JSON.parse(clean);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function normalizePrinter(p = {}) {
  const name = String(p.Name || p.name || '').trim();
  if (!name) return null;
  const offline = p.WorkOffline === true || p.WorkOffline === 'true';
  return {
    name,
    systemName: name,
    isDefault: p.Default === true || p.Default === 'true',
    status: offline ? 'offline' : 'online',
    online: !offline,
    driver: String(p.DriverName || p.driver || '').trim(),
    port: String(p.PortName || p.port || '').trim(),
    share: String(p.ShareName || p.share || '').trim(),
    rawStatus: p.PrinterStatus ?? p.Status ?? '',
    // KHỔ GIẤY THEO TỪNG MÁY IN, không theo chi nhánh.
    //
    // Máy POS cầm tay (Sunmi V2) có đầu in 58mm gắn liền, trong khi máy để bàn
    // cùng chi nhánh dùng K80. Bề ngang trước đây chỉ đọc từ cấu hình chi nhánh
    // nên máy cầm tay sẽ dựng 48 ký tự rồi tràn khỏi mép giấy 58mm. Máy nào tự
    // khai bề ngang của nó thì phiếu dựng theo đúng con số đó.
    // Máy in Windows không gửi trường này -> null -> vẫn theo cấu hình chi nhánh.
    widthMm: Number(p.widthMm || p.WidthMm) || null,
  };
}

async function listWindowsPrinters() {
  const ps = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    "$p=Get-CimInstance Win32_Printer | Select-Object Name,Default,WorkOffline,PrinterStatus,PortName,DriverName,ShareName; $p | ConvertTo-Json -Compress -Depth 3",
  ];
  try {
    const { stdout } = await execFileAsync('powershell.exe', ps, { timeout: 4500, windowsHide: true });
    return parseJsonArray(stdout).map(normalizePrinter).filter(Boolean);
  } catch {
    const fallback = [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      "$p=Get-Printer | Select-Object Name,Default,WorkOffline,PrinterStatus,PortName,DriverName,ShareName; $p | ConvertTo-Json -Compress -Depth 3",
    ];
    const { stdout } = await execFileAsync('powershell.exe', fallback, { timeout: 4500, windowsHide: true });
    return parseJsonArray(stdout).map(normalizePrinter).filter(Boolean);
  }
}

async function listLpstatPrinters() {
  const { stdout } = await execFileAsync('lpstat', ['-p', '-d'], { timeout: 2500 });
  const defaultMatch = stdout.match(/system default destination:\s*(.+)/i);
  const defaultName = defaultMatch?.[1]?.trim() || '';
  return stdout.split(/\r?\n/)
    .map(line => line.match(/^printer\s+(\S+)\s+(.*)$/i))
    .filter(Boolean)
    .map(([, name, rest]) => ({
      name,
      systemName: name,
      isDefault: name === defaultName,
      status: /disabled|offline/i.test(rest) ? 'offline' : 'online',
      online: !/disabled|offline/i.test(rest),
      driver: '',
      port: '',
      share: '',
      rawStatus: rest.trim(),
    }));
}

// Danh sách máy in OS do Hardware Agent tại cửa hàng báo lên.
// Server trên VPS không có máy in thật → khi chạy chế độ agent, màn Cài đặt lấy
// danh sách ở đây thay vì tự dò trên VPS.
//
// LƯU THEO TỪNG MÁY, không phải theo chi nhánh. Bản cũ dùng
// `Map(branch -> data)` nên MỌI máy chạy agent đều ghi đè lên nhau mỗi 20 giây:
// máy quầy báo "POS-80C", 20 giây sau máy văn phòng báo 3 máy in ảo của
// Microsoft là danh sách kia biến mất. Triệu chứng thật: ô "Máy in hệ điều hành"
// chỉ còn OneNote/XPS/Print to PDF, không thấy máy in nhiệt cắm USB — không phải
// vì Windows không thấy nó, mà vì máy khác vừa ghi đè.
const agentPrinters = new Map(); // branch -> Map(deviceId -> { at, deviceName, data })
// Agent báo cáo mỗi 20s (AGENT_PRINTERS_MS) → 60s cho phép trượt 2 nhịp trước khi
// coi là máy đã tắt. Trước đây 90s: máy POS tắt app rồi mà màn Máy in vẫn báo còn
// kết nối tới một phút rưỡi. Không hạ thấp hơn nữa để mạng chậm không nháy offline oan.
const AGENT_PRINTERS_TTL = 60_000;

function deviceBucket(branch) {
  if (!agentPrinters.has(branch)) agentPrinters.set(branch, new Map());
  return agentPrinters.get(branch);
}

export function setAgentPrinters(branch = 'sala', list = [], {
  deviceId = '', deviceName = '', agentVersion = '', capabilities = [],
} = {}) {
  const data = Array.isArray(list) ? list.map(normalizePrinter).filter(Boolean) : [];
  // Agent bản cũ chưa gửi định danh → gom vào một khoá chung, vẫn chạy như trước.
  const key = String(deviceId || '').trim().slice(0, 120) || 'agent-khong-dinh-danh';
  deviceBucket(branch).set(key, {
    at: Date.now(),
    deviceId: key,
    deviceName: String(deviceName || '').trim().slice(0, 120),
    agentVersion: String(agentVersion || '').trim().slice(0, 40),
    capabilities: Array.isArray(capabilities)
      ? capabilities.map(String).map(x => x.trim()).filter(Boolean).slice(0, 20)
      : [],
    data,
  });
  return data;
}

/** Các máy còn "sống" (có báo cáo trong TTL), kèm máy in của từng máy. */
export function getAgentDevices(branch = 'sala') {
  const now = Date.now();
  const out = [];
  for (const e of deviceBucket(branch).values()) {
    if (now - e.at >= AGENT_PRINTERS_TTL) continue;
    out.push({
      device_id: e.deviceId,
      device_name: e.deviceName || e.deviceId,
      agent_version: e.agentVersion || '',
      capabilities: e.capabilities || [],
      last_seen_at: new Date(e.at).toISOString(),
      printers: e.data,
    });
  }
  return out.sort((a, b) => a.device_name.localeCompare(b.device_name));
}

/** Gộp máy in của mọi máy đang sống, mỗi máy in kèm thông tin MÁY NÀO đang cắm.
 *  Trùng tên giữa hai máy thì giữ cả hai — chúng là hai thiết bị khác nhau. */
export function getAgentPrinters(branch = 'sala') {
  const out = [];
  const seen = new Set();
  for (const d of getAgentDevices(branch)) {
    for (const p of d.printers) {
      const key = `${d.device_id}::${p.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...p, device_id: d.device_id, device_name: d.device_name });
    }
  }
  return out;
}

export async function listSystemPrinters({ force = false, branch = '' } = {}) {
  // Chế độ agent: ưu tiên danh sách máy in do agent cửa hàng gửi lên.
  if (env.PRINT_DISPATCH === 'agent') {
    return branch ? getAgentPrinters(branch) : [];
  }
  if (!force && cacheValid(printerCache, 10000)) return printerCache.data;
  let data = [];
  try {
    data = os.platform() === 'win32' ? await listWindowsPrinters() : await listLpstatPrinters();
  } catch {
    data = [];
  }
  printerCache = { at: Date.now(), data };
  return data;
}

async function dnsFallback(started) {
  await dns.lookup('cloudflare.com');
  return {
    ok: true,
    target: 'cloudflare.com',
    mode: 'dns',
    latency_ms: Date.now() - started,
    checked_at: new Date().toISOString(),
  };
}

export async function checkInternet({ force = false } = {}) {
  if (!force && cacheValid(internetCache, 5000)) return internetCache.data;
  const started = Date.now();
  let data;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1800);
    const res = await fetch('https://www.gstatic.com/generate_204', {
      method: 'GET',
      signal: ctrl.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    data = {
      ok: res.status === 204 || (res.status >= 200 && res.status < 400),
      target: 'gstatic generate_204',
      mode: 'https',
      status: res.status,
      latency_ms: Date.now() - started,
      checked_at: new Date().toISOString(),
    };
  } catch (e) {
    try {
      data = await dnsFallback(started);
    } catch {
      data = {
        ok: false,
        target: 'gstatic generate_204',
        mode: 'https',
        latency_ms: Date.now() - started,
        checked_at: new Date().toISOString(),
        error: e.message,
      };
    }
  }
  internetCache = { at: Date.now(), data };
  return data;
}
