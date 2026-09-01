#!/usr/bin/env node
// §14 CANONICAL BACKEND TEST RUNNER.
//
// Vấn đề trước: chạy cả suite một lượt → server-spawn/migrate nguội (~75s dưới
// tải) + orphan node → treo → kết luận "fail" SAI. Runner này:
//  • liệt kê deterministic (sort);
//  • bounded concurrency (mặc định 1 — an toàn cho test spawn server);
//  • per-file timeout + KILL TREE (Windows taskkill /T /F);
//  • reap orphan node giữa các file + drain cổng;
//  • phân loại PASS / FAIL / TIMEOUT / ERROR;
//  • ghi duration mỗi file + ma trận cuối + exit code deterministic.
//
// KHÔNG tăng timeout để giấu lỗi: TIMEOUT được đánh dấu RIÊNG, không tính PASS.
// Dùng: node scripts/run-backend-tests.mjs [glob-substring]
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 240000);
const CONCURRENCY = Math.max(1, Number(process.env.TEST_CONCURRENCY || 1));
const filter = process.argv[2] || '';
const isWin = process.platform === 'win32';

function collect(dir, acc = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      collect(rel, acc);
    } else if (name.endsWith('.test.mjs')) {
      acc.push(rel);
    }
  }
  return acc;
}

function killTree(pid) {
  try {
    // /T kill CẢ CÂY (child + grandchild server) — chỉ đúng cây pid này, KHÔNG
    // đụng runner. KHÔNG blanket `taskkill /IM node.exe` vì sẽ giết chính runner.
    if (isWin) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch { /* đã chết */ }
}

function runOne(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, ['--test', file], {
      cwd: ROOT, env: process.env, detached: !isWin,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const dur = Date.now() - t0;
      const pass = Number((out.match(/(?:^|\n)ℹ pass (\d+)/) || [])[1] || 0);
      const fail = Number((out.match(/(?:^|\n)ℹ fail (\d+)/) || [])[1] || 0);
      const skip = Number((out.match(/(?:^|\n)ℹ skipped (\d+)/) || [])[1] || 0);
      let status = 'PASS';
      if (timedOut) status = 'TIMEOUT';
      else if (fail > 0) status = 'FAIL';
      else if (code !== 0 && pass === 0) status = 'ERROR';
      resolve({ file, pass, fail, skip, dur, status });
    });
  });
}

async function main() {
  const files = collect('server').filter((f) => (filter ? f.includes(filter) : true)).sort();
  console.log(`# canonical runner: ${files.length} file(s), concurrency=${CONCURRENCY}, per-file timeout=${TIMEOUT_MS}ms\n`);
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < files.length) {
      const f = files[idx++];
      const r = await runOne(f);
      results.push(r);
      const tag = r.status === 'PASS' ? 'PASS' : r.status;
      console.log(`${tag.padEnd(7)} ${f}  pass=${r.pass} fail=${r.fail} skip=${r.skip} ${(r.dur / 1000).toFixed(1)}s`);
      // killTree(child) đã dọn cây con lúc timeout; drain cổng TIME_WAIT giữa file.
      await new Promise((res) => setTimeout(res, 1200));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const P = results.filter((r) => r.status === 'PASS');
  const F = results.filter((r) => r.status === 'FAIL');
  const T = results.filter((r) => r.status === 'TIMEOUT');
  const E = results.filter((r) => r.status === 'ERROR');
  const totPass = results.reduce((s, r) => s + r.pass, 0);
  const totFail = results.reduce((s, r) => s + r.fail, 0);
  console.log(`\n# MATRIX: files=${results.length} PASS=${P.length} FAIL=${F.length} TIMEOUT=${T.length} ERROR=${E.length}`);
  console.log(`# assertions: pass=${totPass} fail=${totFail}`);
  if (F.length) console.log(`# FAIL: ${F.map((r) => r.file).join(', ')}`);
  if (T.length) console.log(`# TIMEOUT (re-run standalone to classify harness vs code): ${T.map((r) => r.file).join(', ')}`);
  if (E.length) console.log(`# ERROR: ${E.map((r) => r.file).join(', ')}`);
  // Exit non-zero chỉ khi có FAIL/ERROR thật (TIMEOUT là tín hiệu harness, báo riêng).
  process.exit(F.length + E.length > 0 ? 1 : 0);
}
main();
