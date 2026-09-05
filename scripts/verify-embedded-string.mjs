import fs from 'node:fs';
import path from 'node:path';

const [root, expected] = process.argv.slice(2);

if (!root || !expected) {
  console.error('Usage: node scripts/verify-embedded-string.mjs <directory> <string>');
  process.exit(2);
}

function findMatches(directory) {
  const matches = [];
  const pending = [directory];
  const needle = Buffer.from(expected);

  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (entry.isFile() && fs.readFileSync(absolute).includes(needle)) {
        matches.push(path.relative(directory, absolute));
      }
    }
  }

  return matches.sort();
}

if (!fs.statSync(root).isDirectory()) {
  console.error(`Not a directory: ${root}`);
  process.exit(2);
}

const matches = findMatches(root);
if (matches.length === 0) {
  console.error(`Expected string was not embedded in bundle: ${expected}`);
  process.exit(1);
}

for (const match of matches) console.log(match);
