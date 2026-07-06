import pandas as pd
import json
import re
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')

# Load images list
with open('server/scripts/image_list.json', 'r', encoding='utf-8') as f:
    images = json.load(f)

# Read Excel
df = pd.read_excel(r'E:\Trash\DanhSachSanPham_KV05072026-040421-815.xlsx')

def normalize_text(text):
    if not text or not isinstance(text, str):
        return ""
    text = text.lower()
    # Replace common delimiters with spaces
    text = re.sub(r'[\-\/,\(\)]', ' ', text)
    # Remove extra spaces
    return " ".join(text.split())

# Pre-normalize image names
image_pool = []
for img in images:
    name_no_ext = os.path.splitext(img['filename'])[0]
    norm = normalize_text(name_no_ext)
    image_pool.append({
        "norm": norm,
        "filename": img['filename'],
        "rel_path": img['rel_path'],
        "words": set(norm.split())
    })

matched_count = 0
unmatched_but_no_url = 0
matched_pairs = []

for idx, row in df.iterrows():
    name = row['Tên hàng']
    sku = row['Mã hàng']
    kiotviet_img = row['Hình ảnh (url1,url2...)']
    
    norm_name = normalize_text(name)
    name_words = set(norm_name.split())
    
    # Try matching
    best_match = None
    best_score = 0
    
    for img in image_pool:
        # Score is number of matching words
        matching_words = name_words.intersection(img['words'])
        if len(matching_words) > 0:
            # We want the image words to be a subset of name words, or vice versa
            # Let's calculate a matching score
            # Specially check if size/weight (e.g. 113g, 250g, 454g) matches!
            size_match = True
            # Find weight pattern like "100g", "250g", etc.
            img_weights = [w for w in img['words'] if w.endswith('g')]
            name_weights = [w for w in name_words if w.endswith('g')]
            
            if img_weights and name_weights:
                if not any(w in name_words for w in img_weights):
                    size_match = False
            
            if size_match:
                score = len(matching_words)
                if score > best_score:
                    best_score = score
                    best_match = img
                    
    # Only accept if the score is reasonably high (e.g. contains at least 2 matching words)
    if best_match and best_score >= 2:
        matched_count += 1
        matched_pairs.append({
            "sku": sku,
            "name": name,
            "image": best_match['rel_path']
        })
    else:
        if pd.isna(kiotviet_img):
            unmatched_but_no_url += 1

print(f"Total products: {len(df)}")
print(f"Matched with local images: {matched_count}")
print(f"Products with KiotViet image URLs: {df['Hình ảnh (url1,url2...)'].notna().sum()}")
print(f"Products with NEITHER: {unmatched_but_no_url}")

print("\nSample matches:")
for item in matched_pairs[:15]:
    print(f"SKU: {item['sku']} | Name: {item['name']} -> Image: {item['image']}")
