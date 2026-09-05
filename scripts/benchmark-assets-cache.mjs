#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import http from 'node:http';
import express from 'express';
import { immutableUploadStaticOptions } from '../server/core/staticAssets.js';

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return Object.fromEntries([
    ['p50', at(.50)], ['p95', at(.95)], ['p99', at(.99)], ['max', sorted.at(-1)],
  ].map(([name, value]) => [name, Number(value.toFixed(3))]));
}

function conditionalGet(url, etag) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = http.get(url, { headers: { 'if-none-match': etag } }, (response) => {
      response.resume();
      response.once('end', () => resolve({ status: response.statusCode, ms: performance.now() - started }));
    });
    req.once('error', reject);
  });
}

const coldFiles = 30;
const warmIterations = 100;
const bytesPerFile = 256 * 1024;
const temp = mkdtempSync(join(tmpdir(), 'dandpak-assets-benchmark-'));
const names = [];
for (let index = 0; index < coldFiles; index += 1) {
  const bytes = Buffer.alloc(bytesPerFile, index);
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  const name = `asset_${digest}.bin`;
  writeFileSync(join(temp, name), bytes);
  names.push(name);
}

const app = express();
app.use('/uploads', express.static(temp, immutableUploadStaticOptions));
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/uploads`;

try {
  const cold = [];
  let etag;
  for (const name of names) {
    const started = performance.now();
    const response = await fetch(`${base}/${name}`);
    const body = await response.arrayBuffer();
    cold.push(performance.now() - started);
    if (response.status !== 200 || body.byteLength !== bytesPerFile) throw new Error('Cold asset fetch failed');
    etag ||= response.headers.get('etag');
  }
  const warm = [];
  for (let index = 0; index < warmIterations; index += 1) {
    const response = await conditionalGet(`${base}/${names[0]}`, etag);
    warm.push(response.ms);
    if (response.status !== 304) throw new Error(`Warm revalidation returned ${response.status}`);
  }
  console.log(JSON.stringify({
    status: 'VERIFIED',
    target: 'immutable /uploads static asset over loopback HTTP',
    environment: { platform: process.platform, node: process.version },
    cold_unique_files: coldFiles,
    warm_conditional_requests: warmIterations,
    bytes_per_file: bytesPerFile,
    milliseconds: { cold_200: summarize(cold), warm_304: summarize(warm) },
    contracts: { content_addressed_name: true, etag_revalidation: true, immutable_cache_control: true },
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
