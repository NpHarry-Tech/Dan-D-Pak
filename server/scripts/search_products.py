import sys
import pandas as pd

sys.stdout.reconfigure(encoding='utf-8')

df = pd.read_excel(r'E:\Trash\DanhSachSanPham_KV05072026-040421-815.xlsx')
matches = df[df['Tên hàng'].str.contains('cinnamon|cocon|hickory|honey', case=False, na=False)]
print("Found matches:", len(matches))
print(matches[['Mã hàng', 'Tên hàng', 'Hình ảnh (url1,url2...)']].head(10).to_string())
