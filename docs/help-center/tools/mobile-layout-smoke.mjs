import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const edge = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const baseUrl = process.env.HELP_URL || 'http://127.0.0.1:4173';
const output = process.env.HELP_SMOKE_OUTPUT || join(tmpdir(), 'dandpak-help-mobile-smoke');
const port = 9317;
const profile = join(tmpdir(), `dandpak-help-edge-${process.pid}`);
const devices = [
  { name: 'iphone-se', width: 375, height: 667, dpr: 2 },
  { name: 'iphone-dynamic-island', width: 393, height: 852, dpr: 3 },
  { name: 'android-phone', width: 360, height: 800, dpr: 3 },
  { name: 'android-fold', width: 673, height: 841, dpr: 2.5 },
  { name: 'android-flip-landscape', width: 717, height: 512, dpr: 2 },
  { name: 'iphone-duo-outer', width: 466, height: 678, dpr: 3, safeRight: 72, safeTop: 10 },
  { name: 'iphone-duo-inner-portrait', width: 939, height: 1335, dpr: 2, safeRight: 84, safeTop: 10 },
  { name: 'iphone-duo-inner-landscape', width: 1335, height: 939, dpr: 2, safeRight: 96, safeTop: 10 }
];

await mkdir(output, { recursive: true });
const browser = spawn(edge, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}
async function waitForBrowser() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { return await json(`http://127.0.0.1:${port}/json/version`); } catch { await sleep(100); }
  }
  throw new Error('Edge DevTools endpoint did not start.');
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

const failures = [];
try {
  await waitForBrowser();
  const page = await json(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(`${baseUrl}/vi/`)}`, { method: 'PUT' });
  const cdp = connect(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  for (const device of devices) {
    const metrics = {
      width: device.width, height: device.height, deviceScaleFactor: device.dpr,
      mobile: true, screenWidth: device.width, screenHeight: device.height
    };
    if (device.displayFeature) metrics.displayFeature = device.displayFeature;
    await cdp.send('Emulation.setDeviceMetricsOverride', metrics);
    await cdp.send('Page.navigate', { url: `${baseUrl}/vi/` });
    await sleep(450);
    if (device.safeRight || device.safeTop) {
      await cdp.send('Runtime.evaluate', { expression: `document.documentElement.style.setProperty('--safe-right','${device.safeRight || 0}px');document.documentElement.style.setProperty('--safe-top','${device.safeTop || 0}px')` });
      await sleep(50);
    }
    const evaluation = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const q = s => document.querySelector(s);
        const rect = s => q(s)?.getBoundingClientRect();
        return {
          innerWidth, innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          menuDisplay: getComputedStyle(q('[data-sidebar-open]')).display,
          searchHeight: rect('[data-search-open]')?.height || 0,
          languageHeight: rect('[data-language]')?.height || 0,
          topActionRight: rect('.top-actions')?.right || 0,
          topbarRight: rect('.topbar')?.right || 0,
          sidebarRight: rect('.sidebar')?.right || 0,
          mainLeft: rect('.main')?.left || 0,
          mainRight: rect('.main')?.right || 0,
          cardRight: rect('.category-card')?.right || 0
        };
      })()`
    });
    const result = evaluation.result.value;
    let interaction = { sidebarOpens: true, sidebarCloses: true, searchFits: true };
    if (device.width <= 900) {
      await cdp.send('Runtime.evaluate', { expression: `document.querySelector('[data-sidebar-open]').click()` });
      await sleep(500);
      interaction.sidebarOpens = (await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `document.body.classList.contains('nav-open') && document.querySelector('[data-sidebar]').getBoundingClientRect().left >= -1` })).result.value;
      await cdp.send('Runtime.evaluate', { expression: `document.querySelector('.sidebar-scrim').click()` });
      interaction.sidebarCloses = (await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `!document.body.classList.contains('nav-open')` })).result.value;
      await sleep(250);
    }
    await cdp.send('Runtime.evaluate', { expression: `document.querySelector('[data-search-open]').click()` });
    interaction.searchFits = (await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => { const r=document.querySelector('.search-dialog').getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; })()`
    })).result.value;
    await cdp.send('Runtime.evaluate', { expression: `document.querySelector('[data-search-close]').click()` });
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(join(output, `${device.name}.png`), Buffer.from(screenshot.data, 'base64'));
    const mobilePane = device.width <= 900;
    const checks = {
      noHorizontalOverflow: result.scrollWidth <= result.innerWidth + 1,
      menuAvailable: !mobilePane || result.menuDisplay !== 'none',
      touchSearch: !mobilePane || result.searchHeight >= 44,
      touchLanguage: !mobilePane || result.languageHeight >= 44,
      contentInsideViewport: result.cardRight <= result.innerWidth + 1 && result.mainRight <= result.innerWidth + 1,
      dualPaneAvoidsHinge: !device.displayFeature || (result.sidebarRight <= device.displayFeature.offset + 1 && result.mainLeft >= device.displayFeature.offset + device.displayFeature.maskLength - 1),
      asymmetricSafeArea: !device.safeRight || (result.topActionRight <= result.innerWidth - device.safeRight + 1 && result.cardRight <= result.innerWidth - device.safeRight + 1),
      sidebarOpens: interaction.sidebarOpens,
      sidebarCloses: interaction.sidebarCloses,
      searchFits: interaction.searchFits
    };
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
    if (failed.length) failures.push({ device: device.name, failed, result });
    console.log(JSON.stringify({ device: device.name, checks, result }));
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 3, mobile: true, screenWidth: 360, screenHeight: 800 });
  await cdp.send('Page.navigate', { url: `${baseUrl}/vi/xu-ly-loi/desktop-tablet-byod/` });
  await sleep(450);
  const article = (await cdp.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => { const table=document.querySelector('.help-table-wrap'); return { noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1, tableContained: !!table && table.getBoundingClientRect().right <= innerWidth + 1, headingVisible: document.querySelector('.article-head h1')?.getBoundingClientRect().width > 0 }; })()`
  })).result.value;
  if (!article.noHorizontalOverflow || !article.tableContained || !article.headingVisible) failures.push({ device: 'android-phone-article', failed: Object.entries(article).filter(([, ok]) => !ok).map(([name]) => name), result: article });
  console.log(JSON.stringify({ device: 'android-phone-article', checks: article }));
  cdp.close();
} finally {
  browser.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

if (failures.length) {
  console.error(JSON.stringify({ failures }, null, 2));
  process.exitCode = 1;
}
