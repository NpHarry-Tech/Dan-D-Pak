import os, re

def escape_dart_string(s):
    # Escape backslash, single quote, and dollar sign
    return s.replace('\\', '\\\\').replace("'", "\\'").replace('$', '\\$')

def parse_map_line(line):
    # Strip whitespace
    line = line.strip()
    if not line or line.startswith('//') or line.startswith('const') or line == '};':
        return None
        
    # We want to extract key and value from line:
    # E.g. 'key': 'value',
    # or r'key': r'value',
    # or "key": "value",
    # Let's find key string first.
    # It starts with either ' or " (optionally preceded by r)
    m = re.match(r'^(r?)([\'\"])(.*?)\2\s*:\s*(r?)([\'\"])(.*?)\5\s*,?$', line)
    if m:
        r1, q1, key, r2, q2, val = m.groups()
        # If it was a raw string or escaped, let's normalize it to get the raw content
        # If it was not raw, backslashes might have escaped single quotes
        # But wait, since we ran fix_translation_map.py, we have escaped version.
        # Let's just unescape first to get the pure key and value content:
        
        # Unescape key
        if r1 == '':
            key = key.replace('\\\\', '\\').replace("\\'", "'").replace('\\$', '$')
        else:
            # Raw string, no backslash escapes
            pass
            
        # Unescape val
        if r2 == '':
            val = val.replace('\\\\', '\\').replace("\\'", "'").replace('\\$', '$')
        else:
            # Raw string, no backslash escapes
            pass
            
        # Strip any double backslashes that resulted from previous incorrect escaping
        return key, val
    return None

def main():
    dir_path = os.path.dirname(__file__)
    map_file = os.path.join(dir_path, '..', 'lib', 'utils', 'translation_map.dart')
    
    with open(map_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
    entries = []
    for line in lines:
        parsed = parse_map_line(line)
        if parsed:
            entries.append(parsed)
            
    # Write the clean map file
    with open(map_file, 'w', encoding='utf-8') as f_out:
        f_out.write("/// Generated translation map from Vietnamese to English.\n")
        f_out.write("const Map<String, String> viToEnMap = {\n")
        for k, v in entries:
            k_esc = escape_dart_string(k)
            v_esc = escape_dart_string(v)
            f_out.write(f"  '{k_esc}': '{v_esc}',\n")
        f_out.write("};\n")
        
    print(f"Successfully sanitized {len(entries)} entries in translation_map.dart!")

if __name__ == '__main__':
    main()
