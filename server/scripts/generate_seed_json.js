import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportConfig } from '../services/configBackup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const destPath = join(__dirname, '../config-seed.json');

console.log('Exporting database configuration...');
const snapshot = exportConfig();

writeFileSync(destPath, JSON.stringify(snapshot), 'utf8');
console.log(`Successfully wrote database config seed to ${destPath}`);
