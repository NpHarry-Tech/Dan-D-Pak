import { readFileSync, writeFileSync } from 'node:fs';
import { decryptBytes } from '../core/crypto.js';

const [input, output, context = 'server-file'] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node server/scripts/decrypt-file.js <input> <output> [context]');
  process.exit(2);
}

writeFileSync(output, decryptBytes(readFileSync(input), context), { mode: 0o600 });
