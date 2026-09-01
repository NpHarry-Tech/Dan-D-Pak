// ============================================================
// VIETFOODS — import giá từ file CSV đã điền tay vào bảng giá P4
//   File: D:\DTrash\vietfoods_CAN_DIEN_GIA.csv
//   Cột:  category,code,name,gia_ban_da_gom_VAT8   (giá = đã gồm VAT 8%)
//   node server/scripts/vf-import-prices.mjs           → xem trước
//   node server/scripts/vf-import-prices.mjs --commit  → ghi
// ============================================================
import { readFileSync } from 'node:fs';
const BASE='https://api.dandpakpos.io.vn/api';
const TOKEN='tk_729e57390b0d19fa60a2c2b942ea4fc79cc725ea9b8b4dfd';
const BRANCH='br_vietfoods', WH='br_vietfoods_wh_vf', PB_P4='pb_8cf237a1c53d69c55a';
const CSV='D:/DTrash/vietfoods_CAN_DIEN_GIA.csv';
const COMMIT=process.argv.includes('--commit');
const H={Authorization:`Bearer ${TOKEN}`,'x-branch-id':BRANCH,'Content-Type':'application/json'};
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();

// tiny CSV parser (handles quotes)
function parseCsv(text){
  const rows=[];let row=[],cur='',q=false;
  text=text.replace(/^﻿/,'');
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=c;}
    else{if(c==='"')q=true;else if(c===','){row.push(cur);cur='';}else if(c==='\n'){row.push(cur);rows.push(row);row=[];cur='';}else if(c!=='\r')cur+=c;}}
  if(cur||row.length){row.push(cur);rows.push(row);}
  return rows;
}
async function api(p,m='GET',b=null){const r=await fetch(`${BASE}${p}`,{method:m,headers:H,...(b?{body:JSON.stringify(b)}:{})});const t=await r.text();if(!r.ok)throw new Error(`${m} ${p} ${r.status}: ${t.slice(0,120)}`);return t?JSON.parse(t):{};}

async function main(){
  const rows=parseCsv(readFileSync(CSV,'utf8'));
  const header=rows.shift();
  const priceIdx=header.findIndex(h=>/gia/i.test(h));
  const skus=(await api(`/skus?branch_id=${BRANCH}&limit=2000`)).filter(s=>s.active);
  const byCode=new Map(skus.filter(s=>s.code).map(s=>[String(s.code).toLowerCase(),s]));
  const byName=new Map(skus.map(s=>[norm(s.name),s]));
  const todo=[],miss=[];
  for(const r of rows){
    const [ , code,name,rawPrice]=r;
    const price=Math.round(parseFloat(String(rawPrice||'').replace(/[^\d.]/g,''))||0);
    if(!price)continue;
    const ex=(code&&byCode.get(String(code).toLowerCase()))||byName.get(norm(name));
    if(!ex){miss.push(`${code} ${name}`);continue;}
    todo.push({ex,price,name});
  }
  console.log(`\nGiá sẽ set: ${todo.length} | Không tìm thấy SKU: ${miss.length}`);
  todo.forEach(t=>console.log(`  ${t.ex.code}  ${t.name}  → ${t.price.toLocaleString()}đ (P4, gồm VAT 8%)`));
  if(miss.length){console.log('\n⚠️ Không map được:');miss.forEach(m=>console.log('   '+m));}
  if(!COMMIT){console.log('\nDRY-RUN. Thêm --commit để ghi.\n');return;}
  let ok=0,fail=0;
  for(const {ex,price} of todo){
    try{
      // đảm bảo VAT 8% + giá gồm VAT, rồi set giá P4
      await api(`/skus/${ex.id}/update`,'POST',{vat:8,price_includes_vat:1});
      await api('/warehouse/price-book/entry','POST',{book_id:PB_P4,sku_id:ex.id,price});
      ok++;
    }catch(e){console.error(`❌ ${ex.code}: ${e.message}`);fail++;}
  }
  console.log(`\n🎉 DONE. set=${ok} failed=${fail}`);
}
main().catch(e=>{console.error('FATAL:',e);process.exit(1);});
