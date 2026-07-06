import sys
import os
import pandas as pd
import json
import sqlite3
import urllib.request
import urllib.parse
import shutil
import re
import unicodedata
import uuid
import datetime

# Reconfigure stdout for utf-8
sys.stdout.reconfigure(encoding='utf-8')

EXCEL_PATH = r'E:\Trash\DanhSachSanPham_KV05072026-040421-815.xlsx'
if not os.path.exists(EXCEL_PATH):
    EXCEL_PATH = 'server/scripts/DanhSachSanPham_KV05072026-040421-815.xlsx'
IMAGE_LIST_PATH = 'server/scripts/image_list.json'
CRAWLED_LIST_PATH = 'server/scripts/danon_crawled_images.json'
DB_PATH = 'server/store.db'
DEST_IMAGE_DIR = 'web/assets/product-images'

os.makedirs(DEST_IMAGE_DIR, exist_ok=True)

# Connect to DB
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Read files
df = pd.read_excel(EXCEL_PATH)
print(f"Loaded Excel with {len(df)} rows.")

try:
    with open(IMAGE_LIST_PATH, 'r', encoding='utf-8') as f:
        image_pool = json.load(f)
except Exception as e:
    print(f"Failed to load image pool: {e}")
    image_pool = []

try:
    with open(CRAWLED_LIST_PATH, 'r', encoding='utf-8') as f:
        crawled_pool = json.load(f)
except Exception as e:
    print(f"Failed to load crawled pool: {e}")
    crawled_pool = []

# Normalization and NLP helpers
def normalize_text(text):
    if not text or not isinstance(text, str):
        return ""
    text = text.lower()
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('utf-8')
    text = re.sub(r'[\-\/,\(\)\._]', ' ', text)
    return " ".join(text.split())

def extract_weight(text):
    if not text or not isinstance(text, str):
        return []
    matches = re.findall(r'(\d+(?:\.\d+)?)\s*(g|gr|grs|kg|kgr)\b', text, re.IGNORECASE)
    weights = []
    for val, unit in matches:
        try:
            val = float(val)
            if unit.lower().startswith('k'):
                val *= 1000
            weights.append(int(val))
        except ValueError:
            pass
    return weights

FLAVORS = {
    'honey': ['honey', 'mat ong'],
    'coconut': ['coconut', 'dua'],
    'salted': ['salted', 'muoi', 'co muoi'],
    'wasabi': ['wasabi', 'mu tac'],
    'spicy': ['spicy', 'cay', 'sriracha'],
    'caramel': ['caramel'],
    'nori': ['nori', 'rong bien'],
    'sesame': ['sesame', 'me'],
    'chili': ['chili', 'ot'],
    'cinnamon': ['cinnamon', 'que'],
    'raw': ['raw', 'song'],
    'unsalted': ['unsalted', 'khong muoi'],
    'butter': ['butter', 'bo'],
    'cheese': ['cheese', 'pho mai'],
    'chocolate': ['chocolate', 'socola', 'cocoa'],
    'sour_cream': ['sour cream'],
    'garlic': ['garlic', 'toi']
}

GROUP_TO_FOLDERS = {
    'almonds': ['Almonds'],
    'cashews': ['Cashews'],
    'peanuts': ['Peanuts'],
    'pistachios': ['Pistachios'],
    'macadamia': ['Macadamia'],
    'dried_fruit': ['Dried fruit'],
    'granola_oats': ['Granola & Oats'],
    'popcorn': ['Popcorn'],
    'peas_vegetable': ['Peas & vegetable'],
    'butter': ['Butter'],
    'mixed_nuts': ['Mixed nuts', 'NUT & SEEDS', 'CRACKER & BRITTLES']
}

def get_group(norm_name):
    words = set(norm_name.split())
    if any(w in words for w in ['hanh', 'nhan', 'almond', 'almonds']):
        return 'almonds'
    if any(w in words for w in ['dieu', 'cashew', 'cashews']):
        return 'cashews'
    if any(w in words for w in ['dau', 'phong', 'peanut', 'peanuts']):
        return 'peanuts'
    if any(w in words for w in ['de', 'cuoi', 'pistachio', 'pistachios']):
        return 'pistachios'
    if any(w in words for w in ['mac', 'ca', 'macadamia', 'macadamias']):
        return 'macadamia'
    if any(w in words for w in ['trai', 'cay', 'say', 'dried', 'fruit', 'nho', 'raisin', 'raisins', 'mo', 'apricot', 'apricots', 'nam', 'viet', 'quat', 'cranberry', 'cranberries', 'man', 'plum', 'plums', 'prune', 'prunes', 'cha', 'la', 'date', 'dates', 'tao', 'apple', 'sung', 'fig', 'figs']):
        return 'dried_fruit'
    if any(w in words for w in ['granola', 'oats', 'yen', 'mach', 'oatmeal']):
        return 'granola_oats'
    if any(w in words for w in ['popcorn', 'bap', 'corn']):
        return 'popcorn'
    if any(w in words for w in ['pea', 'peas', 'dau', 'ha', 'lan', 'rau', 'cu', 'vegetable', 'vegetables', 'crisp', 'crisps']):
        return 'peas_vegetable'
    if any(w in words for w in ['butter', 'bo']):
        return 'butter'
    if any(w in words for w in ['mix', 'mixed', 'daily', 'thap', 'cam', 'snack', 'snax']):
        return 'mixed_nuts'
    return None

# Precompute representations
for img in image_pool:
    name_no_ext = os.path.splitext(img['filename'])[0]
    img['norm'] = normalize_text(name_no_ext)
    img['words'] = set(img['norm'].split())
    img['weights'] = extract_weight(name_no_ext)
    img['flavors'] = {f for f, syns in FLAVORS.items() if any(s in img['norm'] for s in syns)}

for c in crawled_pool:
    c['norm'] = normalize_text(c['title'])
    c['words'] = set(c['norm'].split())
    c['weights'] = extract_weight(c['title'])
    c['flavors'] = {f for f, syns in FLAVORS.items() if any(s in c['norm'] for s in syns)}

def find_local_match(product_name):
    norm_product = normalize_text(product_name)
    product_words = set(norm_product.split())
    product_weights = extract_weight(product_name)
    product_group = get_group(norm_product)
    
    product_flvs = {f for f, syns in FLAVORS.items() if any(s in norm_product for s in syns)}
    
    candidates = []
    if product_group:
        allowed_folders = GROUP_TO_FOLDERS.get(product_group, [])
        for img in image_pool:
            if any(img['rel_path'].lower().startswith(folder.lower() + '/') for folder in allowed_folders):
                candidates.append(img)
    
    if not candidates:
        candidates = image_pool
        
    best_match = None
    best_score = -9999
    
    for img in candidates:
        overlap = product_words.intersection(img['words'])
        overlap_score = len(overlap)
        
        extra_flvs = img['flavors'] - product_flvs
        flavor_penalty = 5 * len(extra_flvs)
        
        matching_flvs = product_flvs.intersection(img['flavors'])
        flavor_reward = 3 * len(matching_flvs)
        
        weight_match = True
        if product_weights and img['weights']:
            if not any(w in product_weights for w in img['weights']):
                weight_match = False
                
        score = overlap_score + flavor_reward - flavor_penalty
        if weight_match:
            score += 10
            
        if score > best_score:
            best_score = score
            best_match = img
            
    if best_match and best_score >= 2:
        return best_match
    return None

def find_crawled_match(product_name):
    norm_product = normalize_text(product_name)
    product_words = set(norm_product.split())
    product_weights = extract_weight(product_name)
    product_flvs = {f for f, syns in FLAVORS.items() if any(s in norm_product for s in syns)}
    
    best_match = None
    best_score = -9999
    
    for c in crawled_pool:
        overlap = product_words.intersection(c['words'])
        overlap_score = len(overlap)
        
        extra_flvs = c['flavors'] - product_flvs
        flavor_penalty = 5 * len(extra_flvs)
        
        matching_flvs = product_flvs.intersection(c['flavors'])
        flavor_reward = 3 * len(matching_flvs)
        
        weight_match = True
        if product_weights and c['weights']:
            if not any(w in product_weights for w in c['weights']):
                weight_match = False
                
        score = overlap_score + flavor_reward - flavor_penalty
        if weight_match:
            score += 10
            
        if score > best_score:
            best_score = score
            best_match = c
            
    if best_match and best_score >= 3:
        return best_match
    return None

def get_extension(url_or_path):
    parsed = urllib.parse.urlparse(url_or_path)
    path = parsed.path
    ext = os.path.splitext(path)[1].lower()
    if ext in ['.png', '.jpg', '.jpeg', '.webp', '.gif']:
        return ext
    return '.png'

def download_image(url, dest_path):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            with open(dest_path, 'wb') as f:
                f.write(response.read())
        return True
    except Exception as e:
        return False

def copy_image(src, dest):
    try:
        shutil.copy2(src, dest)
        return True
    except Exception as e:
        return False

def resolve_and_save_image(sku_id, name, kiotviet_url):
    # 1. Try KiotViet URL
    if isinstance(kiotviet_url, str) and kiotviet_url.strip():
        url = kiotviet_url.split(',')[0].strip()
        if url.startswith('http'):
            ext = get_extension(url)
            dest = os.path.join(DEST_IMAGE_DIR, f"{sku_id}{ext}")
            if download_image(url, dest):
                return f"/assets/product-images/{sku_id}{ext}", url
                
    # 2. Try Local Match
    local_match = find_local_match(name)
    if local_match:
        ext = get_extension(local_match['full_path'])
        dest = os.path.join(DEST_IMAGE_DIR, f"{sku_id}{ext}")
        if copy_image(local_match['full_path'], dest):
            return f"/assets/product-images/{sku_id}{ext}", None
            
    # 3. Try Crawled Match
    crawled_match = find_crawled_match(name)
    if crawled_match:
        ext = get_extension(crawled_match['img_url'])
        dest = os.path.join(DEST_IMAGE_DIR, f"{sku_id}{ext}")
        if download_image(crawled_match['img_url'], dest):
            return f"/assets/product-images/{sku_id}{ext}", crawled_match['img_url']
            
    return None, None

used_ids = set()
def get_sku_id(code):
    base = 'kv_' + re.sub(r'[^a-zA-Z0-9]', '', str(code)).lower()
    if not base or base == 'kv_':
        base = 'kv_' + uuid.uuid4().hex[:8]
    val = base
    n = 2
    while val in used_ids:
        val = f"{base}_{n}"
        n += 1
    used_ids.add(val)
    return val

def get_category(group):
    if not group or pd.isna(group):
        return 'BCM'
    parts = [p.strip() for p in str(group).split('>>') if p.strip()]
    if not parts:
        return 'BCM'
    return parts[-1]

def is_lot_tracked(val):
    if not val or pd.isna(val):
        return 0
    s = str(val).strip().lower()
    return 1 if s in ['1', 'true', 'co', 'có', 'x', 'y', 'yes'] else 0

def format_date(d):
    if not d or pd.isna(d):
        return None
    try:
        if isinstance(d, datetime.datetime) or isinstance(d, pd.Timestamp):
            return d.strftime('%Y-%m-%d')
        # Try formatting raw string
        s = str(d).strip().split()[0]
        # Check YYYY-MM-DD
        if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
            return s
        return s
    except Exception:
        return None

# Perform Import
print("\nCleaning existing database BCM retail entries...")
cursor.execute("DELETE FROM skus WHERE warehouse_id = 'wh_retail'")
cursor.execute("DELETE FROM stock_lots WHERE warehouse_id = 'wh_retail'")

sku_insert = """
INSERT INTO skus (
    id, branch_id, barcode, name, emoji, image, price, cost, stock, min_stock, unit, 
    warehouse_id, category, supplier, source_url, track_lot, expiry_required, active,
    code, price_pre_tax, vat, brand, group_path, weight, sellable, created_at, units_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')
"""

lot_insert = """
INSERT INTO stock_lots (
    id, branch_id, warehouse_id, item_type, item_id, lot_no, mfg_date, expiry_date,
    received_at, qty_on_hand, unit_cost, supplier, status, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
"""

imported_count = 0
lots_count = 0
now_iso = datetime.datetime.utcnow().isoformat() + 'Z'

print("Processing rows from Excel...")
for idx, row in df.iterrows():
    name = row['Tên hàng']
    if not name or pd.isna(name):
        continue
        
    code = str(row['Mã hàng']).strip()
    sku_id = get_sku_id(code)
    
    barcode = str(row['Mã vạch']).strip() if 'Mã vạch' in row and not pd.isna(row['Mã vạch']) else code
    brand = str(row['Thương hiệu']).strip() if 'Thương hiệu' in row and not pd.isna(row['Thương hiệu']) else 'Dan D Pak'
    
    price_after = int(round(float(row['Giá bán sau thuế']))) if not pd.isna(row['Giá bán sau thuế']) else 0
    price_pre = int(round(float(row['Giá bán trước thuế']))) if 'Giá bán trước thuế' in row and not pd.isna(row['Giá bán trước thuế']) else price_after
    
    # Calculate VAT percent
    vat_val = None
    if 'VAT hàng bán (%)' in row and not pd.isna(row['VAT hàng bán (%)']):
        try:
            vat_val = float(str(row['VAT hàng bán (%)']).replace('%', '').strip())
        except Exception:
            pass
            
    min_stock = float(row['Tồn nhỏ nhất']) if 'Tồn nhỏ nhất' in row and not pd.isna(row['Tồn nhỏ nhất']) else 10.0
    unit = str(row['ĐVT']).strip() if 'ĐVT' in row and not pd.isna(row['ĐVT']) else 'cái'
    group = row['Nhóm hàng(3 Cấp)']
    category = get_category(group)
    
    weight = float(row['Trọng lượng']) if 'Trọng lượng' in row and not pd.isna(row['Trọng lượng']) else 0.0
    active = 0 if 'Đang kinh doanh' in row and str(row['Đang kinh doanh']).strip() == '0' else 1
    sellable = 0 if 'Được bán trực tiếp' in row and str(row['Được bán trực tiếp']).strip() == '0' else 1
    description = str(row['Mô tả']).strip() if 'Mô tả' in row and not pd.isna(row['Mô tả']) else ""
    
    track_lot = is_lot_tracked(row.get('Quản lý lô-hạn sử dụng', 0))
    kiotviet_img = row.get('Hình ảnh (url1,url2...)', None)
    
    # Resolve Image
    resolved_image, remote_url = resolve_and_save_image(sku_id, name, kiotviet_img)
    
    # Process Lots if tracked
    final_stock = 0.0
    lots_to_insert = []
    
    if track_lot:
        # Group and sum by lot_no
        grouped_lots = {}
        for col_idx in range(1, 41):
            lot_col = f"Lô {col_idx}"
            exp_col = f"Hạn sử dụng {col_idx}"
            qty_col = f"Tồn {col_idx}"
            
            if lot_col in row and not pd.isna(row[lot_col]):
                lot_no = str(row[lot_col]).strip()
                if not lot_no:
                    continue
                qty = float(row[qty_col]) if qty_col in row and not pd.isna(row[qty_col]) else 0.0
                exp_date = format_date(row.get(exp_col, None))
                
                # Deduplicate
                if lot_no in grouped_lots:
                    grouped_lots[lot_no]['qty'] += qty
                    if exp_date and not grouped_lots[lot_no]['expiry_date']:
                        grouped_lots[lot_no]['expiry_date'] = exp_date
                else:
                    grouped_lots[lot_no] = {
                        "expiry_date": exp_date,
                        "qty": qty
                    }
        
        for lot_no, info in grouped_lots.items():
            lots_to_insert.append({
                "lot_no": lot_no,
                "expiry_date": info["expiry_date"],
                "qty": info["qty"]
            })
            final_stock += info["qty"]
                
        # Self-healing fallback: if no lots were declared but KiotViet says we have stock
        excel_stock = float(row['Tồn kho']) if 'Tồn kho' in row and not pd.isna(row['Tồn kho']) else 0.0
        if not lots_to_insert and excel_stock > 0:
            # Generate a default opening lot
            future_date = (datetime.datetime.now() + datetime.timedelta(days=365)).strftime('%Y-%m-%d')
            lots_to_insert.append({
                "lot_no": "LOT-OPENING",
                "expiry_date": future_date,
                "qty": excel_stock
            })
            final_stock = excel_stock
    else:
        # Not lot tracked, use direct Tồn kho
        final_stock = float(row['Tồn kho']) if 'Tồn kho' in row and not pd.isna(row['Tồn kho']) else 0.0
        
    # Insert SKU
    cursor.execute(sku_insert, (
        sku_id, 'br1', barcode, name, '🛍️', resolved_image, price_after, 0, final_stock, min_stock, unit,
        'wh_retail', category, brand, remote_url if remote_url else 'https://www.danonfoods.com', track_lot, track_lot, active,
        code, price_pre, vat_val, brand, group if not pd.isna(group) else None, weight, sellable, now_iso
    ))
    
    # Insert Lots
    for lot in lots_to_insert:
        lot_id = f"lot_{sku_id}_{lot['lot_no']}"
        cursor.execute(lot_insert, (
            lot_id, 'br1', 'wh_retail', 'sku', sku_id, lot['lot_no'], None, lot['expiry_date'],
            now_iso, lot['qty'], 0, brand, now_iso
        ))
        lots_count += 1
        
    imported_count += 1
    if imported_count % 100 == 0:
        print(f"   Processed {imported_count} products...")

conn.commit()
conn.close()

print(f"\n✅ SUCCESS: Imported {imported_count} products and {lots_count} active lot records into store.db.")
