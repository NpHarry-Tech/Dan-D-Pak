import os
import urllib.request
import urllib.parse
import json
import re
import time

def translate_single(text):
    if not text.strip():
        return text
    try:
        url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=vi&tl=en&dt=t&q=" + urllib.parse.quote(text)
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=8) as response:
            res = json.loads(response.read().decode('utf-8'))
            translated = "".join([part[0] for part in res[0] if part[0]])
            return translated
    except Exception as e:
        print(f"Error translating single item '{text}': {e}")
        return None

def translate_batch(texts):
    # Join with newlines
    combined = "\n".join(texts)
    try:
        url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=vi&tl=en&dt=t&q=" + urllib.parse.quote(combined)
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=12) as response:
            res = json.loads(response.read().decode('utf-8'))
            translated = "".join([part[0] for part in res[0] if part[0]])
            translated_lines = translated.split("\n")
            if len(translated_lines) == len(texts):
                return translated_lines
            else:
                print(f"Warning: Batch translation size mismatch. Expected {len(texts)}, got {len(translated_lines)}. Falling back to individual translation.")
                return None
    except Exception as e:
        print(f"Batch translation failed: {e}. Falling back to individual translation.")
        return None

# Regex to find variable interpolations
# Matches ${...} and $varName
var_pattern = re.compile(r'(\$\{.*?\}|\$[a-zA-Z_][a-zA-Z0-9_]*)')

def protect_vars(text):
    vars_list = []
    def repl(match):
        vars_list.append(match.group(1))
        return f"__VAR{len(vars_list)-1}__"
    
    # Replace \n with __NL__ to protect newlines
    protected = text.replace('\n', '__NL__')
    # Replace variables
    protected = var_pattern.sub(repl, protected)
    return protected, vars_list

def restore_vars(translated, vars_list):
    # Google Translate might alter case/spacing around placeholders, e.g. "__ VAR 0 __" or "__var0__"
    # Let's normalize spacers and restore them
    for i, var in enumerate(vars_list):
        # Match case-insensitive "__varX__", optionally with spaces
        pattern = re.compile(r'__\s*[vV][aA][rR]\s*' + str(i) + r'\s*__')
        translated = pattern.sub(var, translated)
    
    # Restore newlines
    # Handle possible spaces in placeholder like "__ NL __" or "__nl__"
    nl_pattern = re.compile(r'__\s*[nN][lL]\s*__')
    translated = nl_pattern.sub('\n', translated)
    return translated

def main():
    dir_path = os.path.dirname(__file__)
    strings_file = os.path.join(dir_path, 'vietnamese_strings.txt')
    
    if not os.path.exists(strings_file):
        print(f"Error: {strings_file} not found.")
        return
        
    with open(strings_file, 'r', encoding='utf-8') as f:
        original_strings = [line.rstrip('\r\n') for line in f.readlines()]
    
    # Filter out empty strings
    original_strings = [s for s in original_strings if s]
    print(f"Loaded {len(original_strings)} strings to translate.")
    
    translated_map = {}
    batch_size = 40
    total = len(original_strings)
    
    # Protect all strings
    protected_data = [protect_vars(s) for s in original_strings]
    
    i = 0
    while i < total:
        end = min(i + batch_size, total)
        batch_slice = protected_data[i:end]
        batch_original = original_strings[i:end]
        
        batch_texts = [p[0] for p in batch_slice]
        
        print(f"Translating items {i+1} to {end} of {total}...")
        batch_results = translate_batch(batch_texts)
        
        if batch_results is not None:
            for idx, res_text in enumerate(batch_results):
                orig = batch_original[idx]
                vars_list = batch_slice[idx][1]
                restored = restore_vars(res_text, vars_list)
                translated_map[orig] = restored
            i += batch_size
        else:
            # Mismatch/failure fallback: translate each one by one
            for idx in range(len(batch_slice)):
                orig = batch_original[idx]
                protected_text, vars_list = batch_slice[idx]
                res_text = translate_single(protected_text)
                if res_text is None:
                    res_text = protected_text # fallback to protected/original if translation fails completely
                restored = restore_vars(res_text, vars_list)
                translated_map[orig] = restored
            i += len(batch_slice)
        
        # Sleep briefly to be nice to Google API
        time.sleep(0.5)

    # Write Dart translation map file
    map_file = os.path.join(dir_path, '..', 'lib', 'utils', 'translation_map.dart')
    print(f"Writing translation map to {map_file}...")
    with open(map_file, 'w', encoding='utf-8') as f_out:
        f_out.write("/// Generated translation map from Vietnamese to English.\n")
        f_out.write("const Map<String, String> viToEnMap = {\n")
        for k, v in translated_map.items():
            # Escape single quotes and backslashes for Dart string literals
            k_esc = k.replace('\\', '\\\\').replace("'", "\\'")
            v_esc = v.replace('\\', '\\\\').replace("'", "\\'")
            f_out.write(f"  '{k_esc}': '{v_esc}',\n")
        f_out.write("};\n")
        
    print("Done generating translation map!")

if __name__ == '__main__':
    main()
