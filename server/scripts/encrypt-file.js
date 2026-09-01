import { readFileSync, writeFileSync } from 'node:fs';
import { encryptBytes } from '../core/crypto.js';

const [input, output, context = 'server-file'] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node server/scripts/encrypt-file.js <input> <output> [context]');
  process.exit(2);
}

writeFileSync(output, encryptBytes(readFileSync(input), context), { mode: 0o600 });
