import re, os

def escape_line(line):
    # We want to find the key and value in the line:
    # E.g.   'key': 'value',
    # We can match everything inside the quotes.
    # To handle single or double quotes, let's use a regex that matches:
    # ^(\s*)(['"])(.*?)\2(\s*:\s*)(['"])(.*?)\5(\s*,\s*)$
    match = re.match(r'^(\s*)([\'\"])(.*?)\2(\s*:\s*)([\'\"])(.*?)\5(\s*,\s*)$', line)
    if match:
        indent, q1, key, colon, q2, val, comma = match.groups()
        
        # Escape dollar signs in key and value if they are not already escaped
        # We replace any '$' not preceded by '\' with '\$'
        def esc_dollar(s):
            # Using regex to find $ not preceded by \
            return re.sub(r'(?<!\\)\$', r'\$', s)
            
        key_esc = esc_dollar(key)
        val_esc = esc_dollar(val)
        
        # Also let's fix any broken syntax in specific lines if we know them
        # For line 25:
        # '${_methodLabel(_lines[i].method)}${_lines[i].reference.isEmpty ? ': '__VAR0_${_lines[i].reference.isEmpty ? ',
        # This was split/broken. Let's make sure it's valid:
        if '__VAR0_' in val_esc and not val_esc.endswith("'") and not val_esc.endswith('"'):
            # Just clean it up
            pass
            
        return f"{indent}{q1}{key_esc}{q2}{colon}{q2}{val_esc}{q2}{comma}"
    return line

def main():
    dir_path = os.path.dirname(__file__)
    map_file = os.path.join(dir_path, '..', 'lib', 'utils', 'translation_map.dart')
    
    with open(map_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
    new_lines = []
    for i, line in enumerate(lines):
        # The first few lines and the last line do not contain map entries
        if i < 2 or line.strip() == '};':
            new_lines.append(line)
        else:
            # Let's clean up line 25 specifically if it's broken
            if '${_methodLabel' in line and '__VAR0_' in line:
                # Let's replace line 25 with a clean, hardcoded valid line
                # It is: '${_methodLabel(_lines[i].method)}${_lines[i].reference.isEmpty ? \'\': \' · \'}'
                # Let's write it cleanly:
                line = "  '${_methodLabel(_lines[i].method)}${_lines[i].reference.isEmpty ? \'\': \' · \'}' : '${_methodLabel(_lines[i].method)}${_lines[i].reference.isEmpty ? \'\': \' · \'}',\n"
            new_lines.append(escape_line(line))
            
    with open(map_file, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print("Successfully escaped dollar signs in translation_map.dart!")

if __name__ == '__main__':
    main()
