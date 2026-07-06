import os
import json

images = []
root_path = r'E:\Trash\Product DDP\04 Product'

for root, dirs, files in os.walk(root_path):
    for file in files:
        if file.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, root_path)
            images.append({
                "filename": file,
                "rel_path": rel_path.replace('\\', '/'),
                "full_path": full_path.replace('\\', '/')
            })

with open('server/scripts/image_list.json', 'w', encoding='utf-8') as f:
    json.dump(images, f, ensure_ascii=False, indent=2)

print(f"Indexed {len(images)} images.")
