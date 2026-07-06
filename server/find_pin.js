import fs from 'node:fs';
const content = fs.readFileSync('c:/Users/PC/Desktop/Dan D Pak/server/api.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.toLowerCase().includes('pin')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
