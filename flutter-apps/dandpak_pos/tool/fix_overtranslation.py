# fix_overtranslation.py  v3 — final pass
import os, glob

root = os.path.join(os.path.dirname(__file__), '..', 'lib')
dart_files = glob.glob(os.path.join(root, '**', '*.dart'), recursive=True)

fixes = [
    # Input* mangled
    ('PrintputDecoration', 'InputDecoration'),
    ('PrintputDecorator', 'InputDecorator'),
    ('PrintputType', 'InputType'),
    ('PrintputFormatter', 'InputFormatter'),
    ('PrintputBorder', 'InputBorder'),
    ('OutlinePrintputBorder', 'OutlineInputBorder'),
    ('UnderlinePrintputBorder', 'UnderlineInputBorder'),
    ('TextPrintputType', 'TextInputType'),
    ('TextPrintputAction', 'TextInputAction'),
    ('textPrintputAction', 'textInputAction'),   # param name (camelCase)
    ('TextPrintputFormatter', 'TextInputFormatter'),
    ('TextPrintputConfiguration', 'TextInputConfiguration'),
    ('FilterPrintgText', 'FilteringText'),
    ('LengthLimitPrinting', 'LengthLimiting'),
    ('FilterPrinting', 'Filtering'),
    # Ink* mangled
    ('PrintkWell', 'InkWell'),
    ('PrintkResponse', 'InkResponse'),
    ('PrintkDecoration', 'InkDecoration'),
    ('PrintkSplash', 'InkSplash'),
    ('PrintkRipple', 'InkRipple'),
    # Insets* mangled
    ('EdgePrintsets', 'EdgeInsets'),
    ('SliverPrintsets', 'SliverInsets'),
    ('WindowPrintsets', 'WindowInsets'),
    ('MediaQueryPrintsets', 'MediaQueryInsets'),
    ('Printsets', 'Insets'),
    # Indicator* mangled
    ('CircularProgressPrintdicator', 'CircularProgressIndicator'),
    ('LinearProgressPrintdicator', 'LinearProgressIndicator'),
    ('ProgressPrintdicator', 'ProgressIndicator'),
    ('Printdicator', 'Indicator'),
    # Initialized* mangled (ensureInitialized -> ensurePrintitialized)
    ('ensurePrintitialized', 'ensureInitialized'),
    ('Printitialized', 'Initialized'),
    ('Printitialize', 'Initialize'),
    ('Printit', 'Init'),       # careful — only applied after longer matches
    # Intrinsic* mangled
    ('PrinttrinsicHeight', 'IntrinsicHeight'),
    ('PrinttrinsicWidth', 'IntrinsicWidth'),
    ('Printtrinsic', 'Intrinsic'),
    # Interpolation* mangled
    ('Printterpolation', 'Interpolation'),
    # Interactive* mangled
    ('PrintteractiveViewer', 'InteractiveViewer'),
    ('Printeractive', 'Interactive'),
    # Interface* mangled
    ('Printerface', 'Interface'),
    # Interval* mangled
    ('Printerval', 'Interval'),
    # Inherited* mangled
    ('PrintheritedWidget', 'InheritedWidget'),
    ('PrintheritedModel', 'InheritedModel'),
    ('PrintheritedNotifier', 'InheritedNotifier'),
    ('PrintheritedTheme', 'InheritedTheme'),
    ('Printheri', 'Inheri'),
    # Internal* mangled
    ('Printernal', 'Internal'),
    # Interop* mangled
    ('Printerop', 'Interop'),
    # Inside* mangled (TableBorder param)
    ('horizontalPrintside', 'horizontalInside'),
    ('verticalPrintside', 'verticalInside'),
    # Int* (dart:ffi types) mangled
    ('Printt32', 'Int32'),
    ('Printt64', 'Int64'),
    ('Printt8', 'Int8'),
    ('Printt16', 'Int16'),
    ('PrinttPtr', 'IntPtr'),
    ('toPrintt()', 'toInt()'),
    ('toPrintt(', 'toInt('),
    # withIndent mangled
    ('withPrintdent', 'withIndent'),
    ('Printdent', 'Indent'),
    # runInShell param mangled
    ('runPrintShell', 'runInShell'),
    # Misc
    ('PrintputConnection', 'InputConnection'),
    ('PrintputMethod', 'InputMethod'),
    ('Printeger', 'Integer'),
    # General overtranslations (In -> Print)
    ('Printformation', 'Information'),
    ('Printfo', 'Info'),
    ('Printstall', 'Install'),
    ('Printstaller', 'Installer'),
    ('Printventory', 'Inventory'),
    ('Printvoices', 'Invoices'),
    ('Printvoice', 'Invoice'),
    ('EPrintvoice', 'EInvoice'),
    ('mePrintvoice', 'meInvoice'),
    ('Printvariant', 'Invariant'),
    ('Printno', 'Inno'),
]

updated = 0
for fpath in dart_files:
    with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    original = content
    for wrong, correct in fixes:
        content = content.replace(wrong, correct)
    if content != original:
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(content)
        updated += 1
        print(f'Fixed: {os.path.basename(fpath)}')

print(f'\nDone. {updated} files fixed.')
