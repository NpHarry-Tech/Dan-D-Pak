import os, glob, re

# Regex for Vietnamese characters
vi_chars = re.compile(r'[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝLÝỴĐ]')

# Import to add at the top of modified files
IMPORT_LINE = "import '../utils/translation.dart';\n"
# In case it's in subfolders, let's find the correct relative import. 
# But wait, we can also use absolute package import:
PACKAGE_IMPORT_LINE = "import 'package:dandpak_pos/utils/translation.dart';\n"

def get_import_line(fpath, root_lib):
    # Compute relative path from fpath to root_lib/utils/translation.dart
    rel = os.path.relpath(root_lib, os.path.dirname(fpath))
    rel = rel.replace('\\', '/')
    if rel == '.':
        return "import 'utils/translation.dart';\n"
    else:
        return f"import '{rel}/utils/translation.dart';\n"

def wrap_file(fpath, root_lib):
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()
        
    orig_content = content
    
    # 1. Regex to match single-quoted strings: '...' 
    # and double-quoted strings: "..."
    # We must be careful not to match strings that are imports, or already wrapped, or contain no Vietnamese.
    
    # Let's find all occurrences of string literals
    # We match:
    # Group 1: t('...') or similar (already wrapped - we match to skip)
    # Group 2: normal string literal
    
    # Specifically, match strings that are single/double quoted
    pattern = re.compile(r"(\bt\s*\(\s*(?:'[^']*'|\"[^\"]*\")\s*\))|('[^']*'|\"[^\"]*\")")
    
    modified = False
    
    def replacer(match):
        nonlocal modified
        wrapped = match.group(1)
        raw_str = match.group(2)
        
        if wrapped:
            # Already wrapped, keep as is
            return wrapped
            
        # Check if the raw string contains Vietnamese
        # Strip the quotes to check
        val = raw_str[1:-1]
        if vi_chars.search(val):
            # Check if this string is part of an import or directive
            # We can check by context, but typically import lines don't contain Vietnamese characters.
            modified = True
            # Wrap with t(...)
            return f"t({raw_str})"
            
        return raw_str

    # Process line by line or on the whole content?
    # Let's split into lines to handle const-removal on a per-line basis
    lines = content.split('\n')
    new_lines = []
    
    for line in lines:
        if 'import ' in line or 'export ' in line or 'part ' in line:
            new_lines.append(line)
            continue
            
        if vi_chars.search(line):
            # Check if there is a 'const ' in the line
            has_const = 'const ' in line
            
            # Wrap the Vietnamese strings in this line
            new_line = pattern.sub(replacer, line)
            
            if new_line != line:
                modified = True
                if has_const:
                    # Strip 'const ' from the line to prevent compiler errors
                    # E.g. "const Text(" -> "Text(" or "const Row(" -> "Row(" or "const [" -> "["
                    # Let's be aggressive: replace 'const ' with '' when a string is wrapped.
                    # Wait, we only strip 'const ' if it's not inside a comment or inside a string.
                    # We can use regex to strip const.
                    new_line = new_line.replace('const ', '')
            
            new_lines.append(new_line)
        else:
            new_lines.append(line)
            
    content = '\n'.join(new_lines)
    
    if modified:
        # Check if import is already present
        if 'translation.dart' not in content:
            # Add import line at the top, after existing imports
            # Find the last import line or just insert at top
            import_to_add = get_import_line(fpath, root_lib)
            content = import_to_add + content
            
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Wrapped strings in: {os.path.basename(fpath)}")
        return True
    return False

def main():
    dir_path = os.path.dirname(__file__)
    root_lib = os.path.abspath(os.path.join(dir_path, '..', 'lib'))
    
    dart_files = glob.glob(os.path.join(root_lib, '**', '*.dart'), recursive=True)
    
    count = 0
    for fpath in dart_files:
        # Skip translation and fix scripts themselves
        if 'translation.dart' in fpath or 'translation_map.dart' in fpath or 'fix_overtranslation.py' in fpath:
            continue
        if wrap_file(fpath, root_lib):
            count += 1
            
    print(f"Completed! Modified {count} files.")

if __name__ == '__main__':
    main()
