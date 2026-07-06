import pandas as pd
import json

df = pd.read_excel(r'E:\Trash\DanhSachSanPham_KV05072026-040421-815.xlsx')
cols = df.columns.tolist()
# Convert head to json using pandas which handles NaT/NaN automatically
head_json = df.head(10).to_json(orient='records', force_ascii=False)
data = {
    "columns": cols,
    "head": json.loads(head_json)
}
with open('server/scripts/scratch_excel.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print("Saved to server/scripts/scratch_excel.json successfully")
