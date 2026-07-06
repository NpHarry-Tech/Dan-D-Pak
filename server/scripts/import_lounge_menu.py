import sys
import os
import json
import sqlite3
import urllib.request
import urllib.parse
import re
import html
import datetime

# Reconfigure stdout for utf-8
sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = 'server/store.db'
UPLOAD_DIR = 'server/uploads/menu'

os.makedirs(UPLOAD_DIR, exist_ok=True)

# Categories definition
CATEGORIES = [
    ("cat_mi_hu_tieu", "Mì & Hủ tiếu", "🍜", 1),
    ("cat_an_sang", "Ăn sáng", "🍳", 2),
    ("cat_com", "Cơm", "🍚", 3),
    ("cat_set_menu", "Set Menu", "🍱", 4),
    ("cat_trang_mieng", "Tráng miệng", "🍰", 5),
    ("cat_nuoc", "Thức uống", "🥤", 6)
]

COLLECTION_MAP = {
    "mi-hu-tieu": "cat_mi_hu_tieu",
    "an-sang": "cat_an_sang",
    "com": "cat_com",
    "set-menu": "cat_set_menu",
    "trang-mieng": "cat_trang_mieng",
    "tra-trai-cay": "cat_nuoc",
    "nuoc-ep": "cat_nuoc",
    "mojito": "cat_nuoc",
    "tra-nong": "cat_nuoc",
    "ca-phe": "cat_nuoc",
    "mon-nuoc-khac": "cat_nuoc"
}

def clean_html(raw_html):
    if not raw_html:
        return ""
    # Simple regex to strip HTML tags
    cleanr = re.compile('<.*?>')
    cleantext = re.sub(cleanr, '', raw_html)
    cleantext = html.unescape(cleantext)
    return " ".join(cleantext.split())

def get_emoji(name, cat_id):
    name_lower = name.lower()
    if 'mì' in name_lower or 'hủ tiếu' in name_lower:
        return '🍜'
    if 'cơm' in name_lower:
        return '🍚'
    if 'bánh mì' in name_lower:
        return '🥖'
    if 'cà phê' in name_lower:
        return '☕'
    if 'trà' in name_lower:
        return '🍵'
    if 'ép' in name_lower or 'sinh tố' in name_lower:
        return '🥤'
    if 'bánh' in name_lower:
        return '🍰'
    if 'kem' in name_lower:
        return '🍨'
    if 'mojito' in name_lower:
        return '🍹'
    if cat_id == 'cat_nuoc':
        return '🥤'
    if cat_id == 'cat_trang_mieng':
        return '🍰'
    return '🍽️'

def get_extension(url):
    parsed = urllib.parse.urlparse(url)
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
        # print(f"Failed to download image {url}: {e}")
        return False

# Connect to database
print("Connecting to SQLite database...")
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Wipe old menu categories, menu items, and recipes
print("Wiping existing menu items, recipes, and categories...")
cursor.execute("DELETE FROM menu_items")
cursor.execute("DELETE FROM recipes")
cursor.execute("DELETE FROM categories")

# Seed categories
print("Inserting new categories...")
for cid, name, icon, sort in CATEGORIES:
    cursor.execute("INSERT INTO categories (id, name, icon, sort) VALUES (?, ?, ?, ?)", (cid, name, icon, sort))

ins_menu = """
INSERT INTO menu_items (
    id, category_id, name, emoji, image, description, price, station, sla_minutes,
    available, hidden, ingredients_json, allergens_json, schedule_json, modifiers_json, sort
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, 1, 0, '[]', '[]', '{"mode":"always"}', '[]', ?)
"""

imported_count = 0
image_downloaded_count = 0

# Crawl each collection
for slug, cat_id in COLLECTION_MAP.items():
    print(f"\nCrawling Haravan collection: {slug}...")
    url = f"https://bcmarketing.vn/collections/{slug}/products.json?limit=250"
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"Error fetching collection {slug}: {e}")
        continue
        
    products = data.get('products', [])
    print(f"Found {len(products)} products in {slug}.")
    
    for idx, p in enumerate(products):
        p_id = f"menu_{p['id']}"
        name = p['title']
        desc = clean_html(p.get('body_html', ''))
        
        # Parse price
        price = 0
        if p.get('variants'):
            try:
                price = int(round(float(p['variants'][0]['price'])))
            except Exception:
                pass
                
        # Resolve station
        station = 'bar' if cat_id == 'cat_nuoc' else 'kitchen'
        
        # Emoji mapping
        emoji = get_emoji(name, cat_id)
        
        # Download image
        image_path = None
        if p.get('images'):
            img_url = p['images'][0]['src']
            ext = get_extension(img_url)
            handle = p['handle']
            dest_filename = f"{handle}{ext}"
            dest_filepath = os.path.join(UPLOAD_DIR, dest_filename)
            
            if download_image(img_url, dest_filepath):
                image_path = f"/uploads/menu/{dest_filename}"
                image_downloaded_count += 1
            else:
                # Try backup download with secure scheme
                if img_url.startswith('//'):
                    img_url = 'https:' + img_url
                    if download_image(img_url, dest_filepath):
                        image_path = f"/uploads/menu/{dest_filename}"
                        image_downloaded_count += 1
                        
        # Insert menu item
        cursor.execute(ins_menu, (
            p_id, cat_id, name, emoji, image_path, desc, price, station, idx + 1
        ))
        imported_count += 1
        
        if imported_count % 10 == 0:
            print(f"   Processed {imported_count} menu items...")

conn.commit()
conn.close()

print(f"\n✅ SUCCESS: Imported {imported_count} menu items and downloaded {image_downloaded_count} images into store.db.")
