import os, glob, re

root = os.path.join(os.path.dirname(__file__), '..', 'lib')
dart_files = glob.glob(os.path.join(root, '**', '*.dart'), recursive=True)

# Regex to match Vietnamese characters
vi_chars = re.compile(r'[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝYLÝỴĐ]')

# Simple string literal scanner (matches single-quoted or double-quoted strings)
string_literal_re = re.compile(r"'(.*?)'|\"(.*?)\"")

unique_strings = set()
file_counts = {}

for fpath in dart_files:
    if 'fix_overtranslation.py' in fpath:
        continue
    with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    # Strip comments to avoid finding strings in comments
    # Single-line comments
    content_no_comments = re.sub(r'//.*', '', content)
    # Multi-line comments
    content_no_comments = re.sub(r'/\*.*?\*/', '', content_no_comments, flags=re.DOTALL)
    
    matches = string_literal_re.findall(content_no_comments)
    for m in matches:
        # m is a tuple of (single_quoted_content, double_quoted_content)
        str_val = m[0] if m[0] else m[1]
        if str_val and vi_chars.search(str_val):
            unique_strings.add(str_val)
            file_counts[str_val] = file_counts.get(str_val, 0) + 1

print(f"Total unique Vietnamese strings found: {len(unique_strings)}")
# Write sorted strings to a file in UTF-8
out_path = os.path.join(os.path.dirname(__file__), 'vietnamese_strings.txt')
with open(out_path, 'w', encoding='utf-8') as f_out:
    for s in sorted(list(unique_strings)):
        f_out.write(f"{s}\n")
print(f"Results written to {out_path}")
