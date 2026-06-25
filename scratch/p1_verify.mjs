// End-to-end P1 verification against a REAL server (temp DB, alt port).
// Covers: concurrency double-pay guard, Socket.IO auth, 15MB payload (no 413).
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const PORT = 3988;
const BASE = `http://localhost:${PORT}`;
const DB = 'scratch/p1_verify.db';
for (const f of [DB, DB + '-wal', DB + '-shm']) { try { rmSync(f, { force: true }); } catch {} }

const pass = [], fail = [];
const check = (name, cond, extra = '') => { (cond ? pass : fail).push(name + (extra ? ` (${extra})` : '')); };

// Seed the temp DB with the demo catalog (auto-seed only runs on a truly empty DB).
spawnSync(process.execPath, ['server/seed.js'], { env: { ...process.env, SQLITE_PATH: DB, NODE_ENV: 'development' }, stdio: 'ignore' });

const srv = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, SQLITE_PATH: DB, PORT: String(PORT), DISABLE_DEMO_SEED: 'false', NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvErr = '';
srv.stderr.on('data', d => { srvErr += d.toString(); });

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

function jpost(path, body, token) {
  return fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  });
}

// Minimal Socket.IO (Engine.IO v4) polling handshake to exercise io.use() auth.
async function sioConnect(query) {
  const qs = new URLSearchParams({ EIO: '4', transport: 'polling', ...query }).toString();
  const open = await fetch(`${BASE}/socket.io/?${qs}`);
  const openText = await open.text();
  const sid = JSON.parse(openText.replace(/^[0-9]/, '')).sid;
  await fetch(`${BASE}/socket.io/?${qs}&sid=${sid}`, { method: 'POST', body: '40' });
  let raw = '';
  for (let i = 0; i < 5; i++) {
    const poll = await fetch(`${BASE}/socket.io/?${qs}&sid=${sid}`);
    raw += await poll.text();
    if (/4[04]/.test(raw)) break;
    await new Promise(r => setTimeout(r, 150));
  }
  return { accepted: /(^|\x1e)40/.test(raw), rejected: raw.includes('44'), raw };
}

try {
  const up = await waitHealth();
  check('server boots & /health ok', up, up ? '' : srvErr.split('\n').slice(0, 6).join(' | '));
  if (!up) throw new Error('server did not start');

  // --- login ---
  const lr = await jpost('/api/login', { username: 'admin', pin: '1234' });
  const lj = await lr.json();
  const token = lj.token;
  check('login admin/1234 -> token', !!token);

  // --- open shift (needed before sales) ---
  await jpost('/api/shifts/open', { opening_cash: 0, cash_manual: true, counts: {} }, token);

  // --- create an order with one menu item (open route) ---
  const menuRes = await fetch(`${BASE}/api/menu`);
  const menuTxt = await menuRes.text();
  let menu; try { menu = JSON.parse(menuTxt); } catch { menu = null; }
  console.log('[debug] menu status', menuRes.status, 'enc', menuRes.headers.get('content-encoding'), 'len', menuTxt.length, 'keys', menu ? Object.keys(menu) : 'PARSE_FAIL', 'items', menu?.items?.length);
  const item = (Array.isArray(menu) ? menu : menu?.items || []).find(m => (m.price || 0) > 0);
  const co = await jpost('/api/orders', { items: [{ menu_item_id: item.id, qty: 1 }], table_id: null, source: 'staff_pos' }, token);
  const order = await co.json();
  check('order created via REST', !!order.id, order.id ? '' : JSON.stringify(order).slice(0, 120));

  // --- CONCURRENCY: fire 6 simultaneous pays for the SAME order ---
  const lines = [{ method: 'cash', amount: order.total }];
  const results = await Promise.all(Array.from({ length: 6 }, () => jpost(`/api/orders/${order.id}/pay`, { lines }, token).then(r => r.status)));
  const okCount = results.filter(s => s === 200).length;
  check('exactly ONE concurrent pay succeeds', okCount === 1, 'ok=' + okCount + ' statuses=' + results.join(','));

  // verify only one payment row + paid once
  const drawer = await (await fetch(`${BASE}/api/orders/${order.id}`, { headers: { Authorization: 'Bearer ' + token } })).json();
  check('order ends in paid state', drawer.status === 'paid', drawer.status);

  // --- SOCKET AUTH ---
  const sNoTok = await sioConnect({ branch: 'br1', device: 'pos' });
  check('socket: staff device WITHOUT token rejected', sNoTok.rejected && !sNoTok.accepted, sNoTok.raw.slice(0, 80));
  const sTok = await sioConnect({ branch: 'br1', device: 'pos', token });
  check('socket: staff device WITH valid token accepted', sTok.accepted && !sTok.rejected, sTok.raw.slice(0, 80));
  const sIpad = await sioConnect({ branch: 'br1', device: 'ipad' });
  check('socket: ipad (public) accepted without token', sIpad.accepted && !sIpad.rejected, sIpad.raw.slice(0, 80));
  const sBadTok = await sioConnect({ branch: 'br1', device: 'pos', token: 'tk_deadbeef' });
  check('socket: invalid token rejected', sBadTok.rejected && !sBadTok.accepted, sBadTok.raw.slice(0, 80));

  // --- PAYLOAD 15MB (no 413) ---
  const big = 'A'.repeat(15 * 1024 * 1024);
  const upRes = await jpost('/api/documents/upload', { original_name: 'big.txt', mime_type: 'text/plain', data: big }, token);
  check('15MB payload not rejected with 413', upRes.status !== 413, 'status=' + upRes.status);

  // --- SECURITY HEADERS ---
  const hres = await fetch(`${BASE}/health`);
  check('security header X-Content-Type-Options=nosniff', hres.headers.get('x-content-type-options') === 'nosniff');
  check('security header X-Frame-Options present', !!hres.headers.get('x-frame-options'), hres.headers.get('x-frame-options') || '');

  // --- /database/status HONESTY + real backup ---
  const st = await (await fetch(`${BASE}/api/database/status`, { headers: { Authorization: 'Bearer ' + token } })).json();
  check('status: no fake "encrypted:true" vpsBuffer claim', !(st.vpsBuffer && st.vpsBuffer.encrypted === true));
  check('status: cloudSync reports offsiteReplication=false (honest)', st.cloudSync?.offsiteReplication === false);
  check('status: reports real local backups (count>=1)', (st.backups?.count || 0) >= 1, 'count=' + (st.backups?.count || 0));

} catch (e) {
  check('test harness ran without throwing', false, e.message);
} finally {
  console.log('\nPASS (' + pass.length + '):\n  ' + pass.join('\n  '));
  console.log('\nFAIL (' + fail.length + '):\n  ' + (fail.join('\n  ') || '(none)'));
  srv.kill('SIGKILL');
  setTimeout(() => {
    for (const f of [DB, DB + '-wal', DB + '-shm']) { try { rmSync(f, { force: true }); } catch {} }
    process.exit(fail.length ? 1 : 0);
  }, 500);
}
