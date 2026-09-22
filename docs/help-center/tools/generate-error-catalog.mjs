import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '../../..');
const output = path.join(repo, 'docs/help-center/assets/error-catalog.csv');
const records = [];

function walk(dir, predicate) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full, predicate));
    else if (predicate(full)) result.push(full);
  }
  return result;
}

function relative(file) {
  return path.relative(repo, file).replaceAll('\\', '/');
}

function moduleName(file) {
  const rel = relative(file);
  const match = rel.match(/(?:services|modules|screens)\/([^/]+)/);
  if (match) return match[1].replace(/\.(?:js|dart)$/, '');
  return path.basename(file).replace(/\.(?:js|dart)$/, '');
}

function devicesFor(file) {
  const rel = relative(file);
  if (rel.includes('/phone/')) return 'Mobile';
  if (rel.includes('/self_order/') || rel.includes('/ipad') || rel.includes('/byod')) return 'Tablet / BYOD';
  if (rel.startsWith('flutter-apps/')) return 'Desktop / Tablet / Mobile';
  if (rel.includes('/agent')) return 'Desktop / Print Agent';
  return 'Backend / all clients';
}

function add(kind, value, file, line) {
  const clean = String(value).replace(/\s+/g, ' ').trim();
  if (clean.length < 3) return;
  records.push({ kind, value: clean, module: moduleName(file), devices: devicesFor(file), source: `${relative(file)}:${line}` });
}

const serverFiles = [
  ...walk(path.join(repo, 'server/core'), f => f.endsWith('.js')),
  ...walk(path.join(repo, 'server/modules'), f => f.endsWith('.js')),
  ...walk(path.join(repo, 'server/services'), f => f.endsWith('.js')),
];

for (const file of serverFiles) {
  const source = fs.readFileSync(file, 'utf8');
  let match;
  const codePattern = /(?:code\s*[:=]\s*|err\([^,]+,[^,]+,\s*)['"`]([A-Z][A-Z0-9_]{2,})['"`]/g;
  while ((match = codePattern.exec(source))) {
    add('error_code', match[1], file, source.slice(0, match.index).split('\n').length);
  }
  const messagePattern = /(?:new\s+(?:AppError|Error)|Object\.assign\(new\s+Error)\(\s*['"`]([^'"`\n]{3,260})['"`]/g;
  while ((match = messagePattern.exec(source))) {
    add('backend_message', match[1], file, source.slice(0, match.index).split('\n').length);
  }
}

const dartRoot = path.join(repo, 'flutter-apps/dandpak_core/lib/src');
for (const file of walk(dartRoot, f => f.endsWith('.dart') && !f.endsWith('.g.dart'))) {
  const source = fs.readFileSync(file, 'utf8');
  let match;
  const patterns = [
    /throw\s+Exception\(\s*(?:t\()?['"]([^'"\n]{3,260})['"]/g,
    /_error\s*=\s*t\(\s*['"]([^'"\n]{3,260})['"]/g,
    /appToast\([^;\n]*?t\(\s*['"]([^'"\n]{3,260})['"][^;\n]*?isError\s*:\s*true/g,
    /SnackBar\(\s*content\s*:\s*Text\(\s*t\(\s*['"]([^'"\n]{3,260})['"]/g,
  ];
  for (const pattern of patterns) {
    while ((match = pattern.exec(source))) {
      add('client_message', match[1], file, source.slice(0, match.index).split('\n').length);
    }
  }
}

const unique = [...new Map(records.map(row => [`${row.kind}\0${row.value}\0${row.module}\0${row.devices}`, row])).values()]
  .sort((a, b) => a.kind.localeCompare(b.kind) || a.module.localeCompare(b.module) || a.value.localeCompare(b.value, 'vi'));

function csv(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

const generatedAt = new Date().toISOString();
const lines = [
  ['kind', 'code_or_message', 'module', 'device_layer', 'source', 'catalog_generated_at'],
  ...unique.map(row => [row.kind, row.value, row.module, row.devices, row.source, generatedAt]),
].map(row => row.map(csv).join(','));

fs.writeFileSync(output, `\uFEFF${lines.join('\r\n')}\r\n`);
console.log(JSON.stringify({ output: relative(output), rows: unique.length, generatedAt }, null, 2));
