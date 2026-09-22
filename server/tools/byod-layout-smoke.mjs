import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const edge = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const output = process.env.BYOD_SMOKE_OUTPUT || join(tmpdir(), 'dandpak-byod-layout-smoke');
const browserPort = 9321;
const sitePort = 4181;
const externalUrl = String(process.env.BYOD_URL || '').replace(/\/$/, '');
const baseUrl = externalUrl || `http://127.0.0.1:${sitePort}`;
const profile = join(tmpdir(), `dandpak-byod-edge-${process.pid}`);
const byodRoot = join(process.cwd(), 'server', 'assets', 'byod');
const indexFile = join(byodRoot, 'index.html');
const logoFile = join(process.cwd(), 'flutter-apps', 'dandpak_desktop', 'assets', 'brand', 'DanOnLogo.png');
const iphoneUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 20_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/20.0 Mobile/15E148 Safari/604.1';
const androidUa = 'Mozilla/5.0 (Linux; Android 17; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Mobile Safari/537.36';
const devices = [
  { name: 'iphone-se', width: 375, height: 667, dpr: 2, ua: iphoneUa },
  { name: 'iphone-dynamic-island', width: 393, height: 852, dpr: 3, ua: iphoneUa, safeTop: 18 },
  { name: 'android-phone', width: 360, height: 800, dpr: 3, ua: androidUa },
  { name: 'android-fold', width: 673, height: 841, dpr: 2.5, ua: androidUa },
  { name: 'android-flip-landscape', width: 717, height: 512, dpr: 2, ua: androidUa },
  { name: 'iphone-duo-outer', width: 466, height: 678, dpr: 3, ua: iphoneUa, safeRight: 72, safeTop: 10 },
  { name: 'iphone-duo-inner-portrait', width: 939, height: 1335, dpr: 2, ua: iphoneUa, safeRight: 84, safeTop: 10, duo: true },
  { name: 'iphone-duo-inner-landscape', width: 1335, height: 939, dpr: 2, ua: iphoneUa, safeRight: 96, safeTop: 10, duo: true }
];

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.ttf': 'font/ttf' };
const site = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${sitePort}`);
  let file;
  if (url.pathname === '/BYOD' || url.pathname === '/BYOD/') file = indexFile;
  else if (url.pathname === '/assets/DanOnLogo.png') file = logoFile;
  else if (url.pathname.startsWith('/byod-assets/')) {
    const relative = normalize(url.pathname.slice('/byod-assets/'.length)).replace(/^(\.\.[/\\])+/, '');
    file = join(byodRoot, relative);
  }
  if (!file) { response.writeHead(404).end(); return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(response);
  } catch { response.writeHead(404).end(); }
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}
function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  };
  return {
    ready: new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; }),
    send(method, params = {}) {
      const id = ++sequence;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close: () => socket.close()
  };
}

await mkdir(output, { recursive: true });
if (!externalUrl) await new Promise(resolve => site.listen(sitePort, '127.0.0.1', resolve));
const browser = spawn(edge, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--use-fake-ui-for-media-stream',
  `--remote-debugging-port=${browserPort}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

const failures = [];
try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { await json(`http://127.0.0.1:${browserPort}/json/version`); break; } catch { await sleep(100); }
  }
  const page = await json(`http://127.0.0.1:${browserPort}/json/new?${encodeURIComponent(`${baseUrl}/BYOD`)}`, { method: 'PUT' });
  const cdp = connect(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  for (const device of devices) {
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: device.ua, platform: device.ua === iphoneUa ? 'iPhone' : 'Linux armv8l' });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: device.width, height: device.height, deviceScaleFactor: device.dpr,
      mobile: true, screenWidth: device.width, screenHeight: device.height
    });
    await cdp.send('Page.navigate', { url: `${baseUrl}/BYOD` });
    await sleep(500);
    await cdp.send('Runtime.evaluate', { expression: `document.documentElement.style.setProperty('--safe-r','${device.safeRight || 0}px');document.documentElement.style.setProperty('--safe-t','${device.safeTop || 0}px')` });
    await sleep(350);
    const scanner = (await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const rect = s => { const r=document.querySelector(s)?.getBoundingClientRect(); return r && {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
        return { scrollWidth:document.documentElement.scrollWidth, innerWidth, gate:rect('#gate-screen'), scan:rect('.scan-square'), close:rect('.scan-close-btn'), duo:document.body.classList.contains('iphone-duo-inner') };
      })()`
    })).result.value;

    await cdp.send('Runtime.evaluate', { expression: `(() => {
      document.querySelector('#gate-root').innerHTML='';
      const app=document.querySelector('#app'); app.classList.remove('hidden');
      document.querySelector('#app-header').classList.remove('hidden');
      document.querySelector('#header-info').innerHTML='<span class="crumb"><b>Bàn A01</b></span><span class="status-pill serving">Đang phục vụ</span>';
      document.querySelector('#screens').innerHTML='<section class="screen"><div class="menu-banner"></div><div class="menu-heading"><span class="title">Thực đơn</span></div><div class="menu-grid"><button class="dish-card"><span class="dish-photo"></span><span class="dish-body"><span class="dish-name">Món thứ nhất</span></span></button><button class="dish-card"><span class="dish-photo"></span><span class="dish-body"><span class="dish-name">Món thứ hai</span></span></button></div><div class="floating-bottom"><button class="pill-btn back" aria-label="Back"></button><button class="pill-btn search-bubble">Tìm món</button></div></section>';
      const staff=document.querySelector('#btn-staff-call'); staff.classList.remove('hidden'); staff.style.setProperty('--staff-bottom','108px');
      document.querySelector('#sheet-root').innerHTML='<div id="sheet-overlay"></div><section class="sheet"><div class="sheet-grip"></div><div class="sheet-title">Tùy chọn món</div><div class="sheet-actions"><button class="btn btn-secondary">Đóng</button><button class="btn btn-primary">Xác nhận</button></div></section>';
    })()` });
    await sleep(350);
    const layout = (await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const copy=r=>r && ({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height});
        const all=s=>[...document.querySelectorAll(s)].map(e=>copy(e.getBoundingClientRect())); const one=s=>copy(document.querySelector(s)?.getBoundingClientRect());
        return { scrollWidth:document.documentElement.scrollWidth, cards:all('.dish-card'), cart:one('#btn-cart'), lang:one('#btn-lang'), staff:one('#btn-staff-call'), footer:one('.floating-bottom'), sheet:one('.sheet') };
      })()`
    })).result.value;
    const safeEdge = device.width - (device.safeRight || 0) + 1;
    const center = device.width / 2;
    const checks = {
      noHorizontalOverflow: scanner.scrollWidth <= device.width + 1 && layout.scrollWidth <= device.width + 1,
      scannerVisible: scanner.scan && scanner.scan.width > 0 && scanner.scan.left >= -1 && scanner.scan.right <= safeEdge,
      touchTargets: layout.cart?.height >= 44 && layout.lang?.height >= 44 && layout.staff?.height >= 44,
      rightSafeArea: layout.cart?.right <= safeEdge && layout.staff?.right <= safeEdge && layout.sheet?.right <= safeEdge,
      duoDetected: !device.duo || scanner.duo,
      duoFoldClear: !device.duo || (layout.cards[0]?.right <= center - 20 && layout.cards[1]?.left >= center + 20),
      duoActionsInRightPane: !device.duo || (layout.footer?.left >= center + 20 && layout.sheet?.left >= center + 20)
    };
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
    if (failed.length) failures.push({ device: device.name, failed, scanner, layout });
    console.log(JSON.stringify({ device: device.name, checks }));
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(join(output, `${device.name}.png`), Buffer.from(shot.data, 'base64'));
  }
  cdp.close();
} finally {
  browser.kill();
  if (!externalUrl) site.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

if (failures.length) {
  console.error(JSON.stringify({ failures }, null, 2));
  process.exitCode = 1;
}
