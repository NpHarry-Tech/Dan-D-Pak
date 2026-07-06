import fs from 'node:fs';
const content = fs.readFileSync('c:/Users/PC/Desktop/Dan D Pak/web/retail.html', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('~/') || line.includes('Math.floor') || line.includes('discount') || line.includes('Promo') || line.includes('RetailTotals')) {
    if (line.length < 150) {
      console.log(`${idx + 1}: ${line.trim()}`);
    }
  }
});
