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

// Danh sách máy in OS do Hardware Agent tại cửa hàng báo lên (theo chi nhánh).
// Server trên VPS không có máy in thật → khi chạy chế độ agent, màn Cài đặt lấy
// danh sách ở đây thay vì tự dò trên VPS.
const agentPrinters = new Map(); // branch -> { at, data }
const AGENT_PRINTERS_TTL = 90_000;

export function setAgentPrinters(branch = 'br1', list = []) {
  const data = Array.isArray(list) ? list.map(normalizePrinter).filter(Boolean) : [];
  agentPrinters.set(branch, { at: Date.now(), data });
  return data;
}

export function getAgentPrinters(branch = 'br1') {
  const e = agentPrinters.get(branch);
  return e && Date.now() - e.at < AGENT_PRINTERS_TTL ? e.data : [];
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
