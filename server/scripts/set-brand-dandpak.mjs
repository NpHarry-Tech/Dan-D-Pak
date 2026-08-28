// set-brand-dandpak.mjs

const BASE   = 'https://api.dandpakpos.io.vn/api';
const TOKEN  = 'tk_729e57390b0d19fa60a2c2b942ea4fc79cc725ea9b8b4dfd';
const BRANCH = 'br_vietfoods';

const H = {
  'Authorization': `Bearer ${TOKEN}`,
  'x-branch-id': BRANCH,
  'Content-Type': 'application/json',
};

async function main() {
  const r = await fetch(`${BASE}/skus?branch_id=br_vietfoods&limit=1000`, { headers: H });
  const skus = await r.json();

  console.log(`Setting brand 'Dan D Pak' for ${skus.length} SKUs...`);
  let count = 0;
  for (const sku of skus) {
    if (sku.brand !== 'Dan D Pak') {
      await fetch(`${BASE}/skus/${sku.id}/update`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ brand: 'Dan D Pak' })
      });
      count++;
    }
  }
  console.log(`Updated brand to 'Dan D Pak' for ${count} SKUs!`);
}

main().catch(console.error);
