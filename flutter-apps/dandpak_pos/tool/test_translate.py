import urllib.request
import urllib.parse
import json

def translate_vi_to_en(text):
    try:
        url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=vi&tl=en&dt=t&q=" + urllib.parse.quote(text)
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            res = json.loads(response.read().decode('utf-8'))
            # The API returns a nested list: [[["translated_text", "original_text", ...]]]
            translated = "".join([part[0] for part in res[0]])
            return translated
    except Exception as e:
        print(f"Error translating '{text}': {e}")
        return None

# Test
print(translate_vi_to_en("Cài đặt"))
print(translate_vi_to_en("Quản lý kho"))
print(translate_vi_to_en("Bàn, order, discount, thanh toán, receipt và realtime với bếp."))
