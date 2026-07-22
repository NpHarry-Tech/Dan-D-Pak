// GENERATED SPLIT of menu_tab.dart — dialog thêm/sửa món + dịch + preview (part of, cùng library).
part of 'menu_tab.dart';

class _ItemFormDialog extends StatefulWidget {
  final ApiService api;
  final AdminMenuItem? item;
  final List<AdminCategory> categories;
  final List<AdminMenuItem> items;
  final List<IngredientRef> ingredients;
  final String serverUrl;

  _ItemFormDialog({
    required this.api,
    required this.item,
    required this.categories,
    required this.items,
    required this.ingredients,
    required this.serverUrl,
  });

  @override
  State<_ItemFormDialog> createState() => _ItemFormDialogState();
}

class _ItemFormDialogState extends State<_ItemFormDialog> {
  late final TextEditingController _name;
  late final TextEditingController _price;
  late final TextEditingController _vatRate;
  late final TextEditingController _emoji;
  late final TextEditingController _sla;
  late final TextEditingController _image;
  late final TextEditingController _description;
  late final TextEditingController _ingredients;
  late final TextEditingController _allergens;

  late String _categoryId;
  late String _station;
  late bool _hidden;
  late bool _priceIncludesVat;
  late String _schedMode;
  late final TextEditingController _start;
  late final TextEditingController _end;
  late final TextEditingController _date;
  late Set<String> _days;
  late List<_RecipeRow> _recipe;
  late List<_AddonRow> _addons;
  late Map<String, Map<String, String>> _translations;

  bool _saving = false;
  bool _uploadingImage = false;

  bool get _isEdit => widget.item != null;

  @override
  void initState() {
    super.initState();
    final i = widget.item;
    _name = TextEditingController(text: i?.name ?? '');
    _price = TextEditingController(
        text: i != null ? i.price.round().toString() : '');
    _vatRate = TextEditingController(text: (i?.vatRate ?? 8).toString());
    _emoji = TextEditingController(text: i?.emoji ?? '');
    _sla = TextEditingController(text: (i?.slaMinutes ?? 10).toString());
    _image = TextEditingController(text: i?.image ?? '');
    _description = TextEditingController(text: i?.description ?? '');
    _ingredients =
        TextEditingController(text: (i?.ingredients ?? []).join(', '));
    _allergens = TextEditingController(text: (i?.allergens ?? []).join(', '));
    _categoryId = i?.categoryId.isNotEmpty == true
        ? i!.categoryId
        : (widget.categories.isNotEmpty ? widget.categories.first.id : '');
    _station = _stationLabels.containsKey(i?.station) ? i!.station : 'kitchen';
    _hidden = i?.hidden ?? false;
    _priceIncludesVat = i?.priceIncludesVat ?? true;
    final s = i?.schedule ?? MenuSchedule();
    _schedMode = {'always', 'daily', 'weekly', 'date'}.contains(s.mode)
        ? s.mode
        : 'always';
    _start = TextEditingController(text: s.start);
    _end = TextEditingController(text: s.end);
    _date = TextEditingController(text: s.date);
    _days = s.days.toSet();
    _recipe = (i?.recipe ?? [])
        .map((r) => _RecipeRow(r.inventoryItemId, r.qty.toString()))
        .toList();
    _addons = (i?.addons ?? [])
        .map((a) => _AddonRow(
              kind: a.kind == 'combo' ? 'combo' : 'extra',
              type: a.type == 'free' ? 'free' : 'paid',
              price: a.price.round().toString(),
              refItemId: a.refItemId,
              name: a.name,
              available: a.available,
            ))
        .toList();
    _translations = _copyTranslations(i?.translations);
    // Live-update the iPad preview as these fields change.
    for (final c in [_name, _price, _emoji, _image, _description]) {
      c.addListener(_onPreviewChange);
    }
  }

  void _onPreviewChange() {
    if (mounted) setState(() {});
  }

  String get _categoryName {
    for (final c in widget.categories) {
      if (c.id == _categoryId) return c.name;
    }
    return '';
  }

  @override
  void dispose() {
    for (final c in [
      _name,
      _price,
      _vatRate,
      _emoji,
      _sla,
      _image,
      _description,
      _ingredients,
      _allergens,
      _start,
      _end,
      _date,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  List<String> _parseList(String s) =>
      s.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toList();

  Map<String, Map<String, String>> _copyTranslations(
      Map<String, Map<String, String>>? src) {
    return {
      for (final lang in kSelfOrderLangs)
        lang.code: {
          'name': src?[lang.code]?['name'] ?? '',
          'description': src?[lang.code]?['description'] ?? '',
        }
    };
  }

  Map<String, dynamic> _translationPayload() => {
        for (final e in _translations.entries)
          e.key: {
            'name': e.value['name'] ?? '',
            'description': e.value['description'] ?? '',
          }
      };

  Future<void> _openTranslations() async {
    final updated = await showDialog<Map<String, Map<String, String>>>(
      context: context,
      builder: (_) => _MenuTranslationDialog(
        api: widget.api,
        name: _name.text.trim(),
        description: _description.text.trim(),
        translations: _copyTranslations(_translations),
      ),
    );
    if (updated != null && mounted) {
      setState(() => _translations = updated);
    }
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty || _categoryId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(t('Cần nhập tên món và chọn nhóm')),
        backgroundColor: DanColors.late,
      ));
      return;
    }
    final pin = await requestManagerPin(
        context,
        _isEdit
            ? t('Cập nhật món "${_name.text.trim()}".')
            : t('Tạo món mới "${_name.text.trim()}".'));
    if (pin == null) return;

    final body = <String, dynamic>{
      'name': _name.text.trim(),
      'price': int.tryParse(_price.text.trim()) ?? 0,
      'vat_rate': num.tryParse(_vatRate.text.trim()) ?? 0,
      'price_includes_vat': _priceIncludesVat,
      'emoji': _emoji.text.trim(),
      'sla_minutes': int.tryParse(_sla.text.trim()) ?? 10,
      'image': _image.text.trim(),
      'description': _description.text.trim(),
      'translations': _translationPayload(),
      'category_id': _categoryId,
      'station': _station,
      'ingredients': _parseList(_ingredients.text),
      'allergens': _parseList(_allergens.text),
      'hidden': _hidden,
      'schedule': {
        'mode': _schedMode,
        'start': _start.text.trim(),
        'end': _end.text.trim(),
        'days': _days.toList(),
        'date': _date.text.trim(),
      },
      'recipe': [
        for (final r in _recipe)
          if (r.ingredientId.isNotEmpty)
            {
              'inventory_item_id': r.ingredientId,
              'qty': double.tryParse(r.qty) ?? 0
            },
      ],
      'addons': [
        for (final a in _addons)
          if ((a.kind == 'combo' && a.refItemId.isNotEmpty) ||
              (a.kind != 'combo' && a.name.trim().isNotEmpty))
            {
              'kind': a.kind == 'combo' ? 'combo' : 'extra',
              'type': a.type == 'free' ? 'free' : 'paid',
              'price':
                  a.type == 'free' ? 0 : (int.tryParse(a.price.trim()) ?? 0),
              'ref_item_id': a.kind == 'combo' ? a.refItemId : null,
              'name': a.name.trim(),
              'available': a.available,
            },
      ],
      'security_pin': pin,
    };

    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await widget.api.updateMenuItem(widget.item!.id, body);
      } else {
        await widget.api.createMenuItem(body);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late,
        ));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Left: The edit form container styled as a side sheet drawer
        SizedBox(
          width: dialogWidth(context, 580),
          child: Scaffold(
            backgroundColor: DanColors.surface,
            body: SafeArea(
              child: Column(
                children: [
                  Padding(
                    padding: EdgeInsets.fromLTRB(20, 16, 12, 10),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                              _isEdit ? t('Sửa món') : t('Thêm món mới'),
                              style: TextStyle(
                                  fontSize: 19, fontWeight: FontWeight.w900)),
                        ),
                        IconButton(
                            onPressed: () => Navigator.of(context).pop(),
                            icon: Icon(Icons.close)),
                      ],
                    ),
                  ),
                  Divider(height: 1, color: DanColors.border),
                  Expanded(
                    child: ListView(
                      padding: EdgeInsets.all(20),
                      children: [
                        _field(t('Tên món'), _name, hint: t('VD: Bún bò Huế')),
                        Row(
                          children: [
                            Expanded(
                                child: _field(t('Giá'), _price, number: true)),
                            SizedBox(width: 12),
                            Expanded(child: _field('Emoji', _emoji)),
                            SizedBox(width: 12),
                            Expanded(
                                child:
                                    _field(t('SLA phút'), _sla, number: true)),
                          ],
                        ),
                        Row(
                          children: [
                            Expanded(
                                child:
                                    _field('VAT (%)', _vatRate, number: true)),
                            SizedBox(width: 12),
                            Expanded(
                              child: SwitchListTile(
                                contentPadding: EdgeInsets.zero,
                                title: Text(t('Đơn giá đã gồm VAT')),
                                value: _priceIncludesVat,
                                onChanged: (value) =>
                                    setState(() => _priceIncludesVat = value),
                              ),
                            ),
                          ],
                        ),
                        Row(
                          children: [
                            Expanded(child: _categoryDropdown()),
                            SizedBox(width: 12),
                            Expanded(child: _stationDropdown()),
                          ],
                        ),
                        _imageEditor(),
                        _field(t('Mô tả món'), _description, lines: 2),
                        _translationButton(),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                                child: _field(
                                    t('Nguyên liệu (hiển thị)'), _ingredients,
                                    lines: 2, hint: t('thịt bò, hành...'))),
                            SizedBox(width: 12),
                            Expanded(
                                child: _field(
                                    t('Allergen / dị ứng'), _allergens,
                                    lines: 2, hint: t('sữa, trứng...'))),
                          ],
                        ),
                        SizedBox(height: 6),
                        _recipeEditor(),
                        SizedBox(height: 14),
                        _addonsEditor(),
                        SizedBox(height: 14),
                        _scheduleEditor(),
                        SizedBox(height: 10),
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          value: _hidden,
                          activeThumbColor: DanColors.brand,
                          title: Text(t('Ẩn khỏi iPad / POS'),
                              style: TextStyle(
                                  fontSize: 13.5, fontWeight: FontWeight.w700)),
                          onChanged: (v) => setState(() => _hidden = v),
                        ),
                      ],
                    ),
                  ),
                  Divider(height: 1, color: DanColors.border),
                  Padding(
                    padding: EdgeInsets.all(14),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        TextButton(
                            onPressed: () => Navigator.of(context).pop(),
                            child: Text(t('Hủy'))),
                        SizedBox(width: 8),
                        FilledButton(
                          onPressed: _saving ? null : _save,
                          child: _saving
                              ? SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white))
                              : Text(
                                  _isEdit ? t('Lưu thay đổi') : t('Tạo món')),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        // Right: The empty space and floating preview card in the remaining space
        Expanded(
          child: GestureDetector(
            behavior: HitTestBehavior.translucent,
            onTap: () => Navigator.of(context).maybePop(),
            child: Center(
              child: GestureDetector(
                onTap:
                    () {}, // Prevent pop when tapping the preview card itself
                child: _MenuItemPreview(state: this),
              ),
            ),
          ),
        ),
      ],
    );
  }

  // ── Live preview accessors (read by _MenuItemPreview) ─────────────────
  String get pvName => _name.text.trim();
  String get pvEmoji => _emoji.text.trim();
  String get pvImage => _image.text.trim();
  String get pvDescription => _description.text.trim();
  num get pvPrice {
    final price = num.tryParse(_price.text.trim()) ?? 0;
    final vat = num.tryParse(_vatRate.text.trim()) ?? 0;
    return _priceIncludesVat ? price : (price * (1 + vat / 100)).round();
  }

  bool get pvHidden => _hidden;
  String get pvStationLabel => _stationLabels[_station] ?? _station;
  String get pvCategory => _categoryName;
  String get pvServerUrl => widget.serverUrl;
  List<String> get pvIngredients => _parseList(_ingredients.text);
  List<String> get pvAllergens => _parseList(_allergens.text);

  Widget _translationButton() {
    return Align(
      alignment: Alignment.centerLeft,
      child: OutlinedButton.icon(
        onPressed: _openTranslations,
        icon: Icon(Icons.translate, size: 18),
        label: Text(t('Bản dịch')),
      ),
    );
  }

  Widget _field(String label, TextEditingController c,
      {bool number = false, int lines = 1, String? hint}) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 7),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          SizedBox(height: 5),
          TextField(
            controller: c,
            maxLines: lines,
            keyboardType: number ? TextInputType.number : null,
            decoration: InputDecoration(hintText: hint, isDense: true),
          ),
        ],
      ),
    );
  }

  Widget _categoryDropdown() {
    final hasCat = widget.categories.any((c) => c.id == _categoryId);
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 7),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t('Nhóm'),
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          SizedBox(height: 5),
          DropdownButtonFormField<String>(
            initialValue: hasCat ? _categoryId : null,
            isExpanded: true,
            decoration: InputDecoration(isDense: true),
            items: [
              for (final c in widget.categories)
                DropdownMenuItem(
                    value: c.id,
                    child: Text('${c.icon} ${c.name}'.trim(),
                        overflow: TextOverflow.ellipsis)),
            ],
            onChanged: (v) => setState(() => _categoryId = v ?? _categoryId),
          ),
        ],
      ),
    );
  }

  Widget _stationDropdown() {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 7),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Station',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          SizedBox(height: 5),
          DropdownButtonFormField<String>(
            initialValue: _station,
            isExpanded: true,
            decoration: InputDecoration(isDense: true),
            items: [
              for (final e in _stationLabels.entries)
                DropdownMenuItem(value: e.key, child: Text(e.value)),
            ],
            onChanged: (v) => setState(() => _station = v ?? _station),
          ),
        ],
      ),
    );
  }

  Widget _imageEditor() {
    final src = _image.text.trim();
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 7),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t('Ảnh món'),
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          SizedBox(height: 6),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Container(
                  width: 86,
                  height: 86,
                  color: DanColors.surface2,
                  alignment: Alignment.center,
                  child: src.isEmpty
                      ? Text(pvEmoji, style: TextStyle(fontSize: 30))
                      : Image.network(
                          _absoluteImageUrl(src),
                          width: 86,
                          height: 86,
                          fit: BoxFit.cover,
                          cacheWidth: 172,
                          filterQuality: FilterQuality.low,
                          gaplessPlayback: true,
                          errorBuilder: (_, __, ___) =>
                              Text(pvEmoji, style: TextStyle(fontSize: 30)),
                        ),
                ),
              ),
              SizedBox(width: 12),
              Expanded(
                child: Column(
                  children: [
                    TextField(
                      controller: _image,
                      decoration: InputDecoration(
                        isDense: true,
                        hintText: t('/uploads/menu/... hoặc https://...'),
                      ),
                    ),
                    SizedBox(height: 8),
                    Row(
                      children: [
                        OutlinedButton.icon(
                          onPressed: _uploadingImage ? null : _pickMenuImage,
                          icon: _uploadingImage
                              ? SizedBox(
                                  width: 16,
                                  height: 16,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2))
                              : Icon(Icons.image_outlined, size: 16),
                          label: Text(
                              _uploadingImage ? t('Đang tải') : t('Chọn ảnh')),
                        ),
                        SizedBox(width: 8),
                        TextButton(
                          onPressed: _uploadingImage
                              ? null
                              : () => setState(_image.clear),
                          child: Text(t('Bỏ ảnh')),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _absoluteImageUrl(String src) {
    if (src.startsWith('http') || src.startsWith('data:')) return src;
    return '${widget.serverUrl}${src.startsWith('/') ? '' : '/'}$src';
  }

  Future<void> _pickMenuImage() async {
    final path = await _pickImagePath();
    if (path == null || path.isEmpty) return;

    final file = File(path);
    final length = await file.length();
    if (length > 20 * 1024 * 1024) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(t('Ảnh tối đa 20MB')),
        backgroundColor: DanColors.late,
      ));
      return;
    }

    setState(() => _uploadingImage = true);
    try {
      final bytes = await file.readAsBytes();
      final name = path.split(RegExp(r'[\\/]')).last;
      final res = await widget.api.uploadMenuImage(
        originalName: name,
        mimeType: _mimeForFileName(name),
        data: base64Encode(bytes),
      );
      if (!mounted) return;
      setState(() {
        _image.text = (res['url'] ?? '').toString();
        _uploadingImage = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploadingImage = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
        backgroundColor: DanColors.late,
      ));
    }
  }

  Future<String?> _pickImagePath() async {
    // Tablet/điện thoại: chọn ảnh món từ thư viện ảnh (image_picker trả về
    // đường dẫn đọc được ngay bằng File(path)).
    if (Platform.isAndroid || Platform.isIOS) {
      final x = await ImagePicker()
          .pickImage(source: ImageSource.gallery, imageQuality: 90);
      return x?.path;
    }
    final script = r'''
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = t('Chọn ảnh món')
$dialog.Filter = t('Ảnh (*.jpg;*.jpeg;*.png;*.webp;*.gif)|*.jpg;*.jpeg;*.png;*.webp;*.gif')
$dialog.Multiselect = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.FileName
}
''';
    final result = await Process.run(
      'powershell.exe',
      ['-NoProfile', '-STA', '-Command', script],
    );
    if (result.exitCode != 0) return null;
    return result.stdout.toString().trim();
  }

  Widget _addonsEditor() {
    final otherItems =
        widget.items.where((m) => m.id != widget.item?.id).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(t('Món ăn kèm & Extra'),
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
        SizedBox(height: 6),
        if (_addons.isEmpty)
          Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Text(t('Chưa có món kèm / extra.'),
                style: TextStyle(color: DanColors.faint, fontSize: 12)),
          ),
        for (var i = 0; i < _addons.length; i++)
          Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                SizedBox(
                  width: 116,
                  child: DropdownButtonFormField<String>(
                    initialValue: _addons[i].kind,
                    isExpanded: true,
                    decoration: InputDecoration(isDense: true),
                    items: [
                      DropdownMenuItem(
                          value: 'combo', child: Text(t('Ăn kèm'))),
                      DropdownMenuItem(value: 'extra', child: Text('Extra')),
                    ],
                    onChanged: (v) => setState(() {
                      _addons[i].kind = v ?? 'extra';
                      if (_addons[i].kind == 'combo' &&
                          _addons[i].refItemId.isEmpty &&
                          otherItems.isNotEmpty) {
                        _addons[i].refItemId = otherItems.first.id;
                        _addons[i].name = otherItems.first.name;
                      }
                    }),
                  ),
                ),
                SizedBox(width: 8),
                Expanded(
                  child: _addons[i].kind == 'combo'
                      ? DropdownButtonFormField<String>(
                          initialValue: otherItems
                                  .any((m) => m.id == _addons[i].refItemId)
                              ? _addons[i].refItemId
                              : null,
                          isExpanded: true,
                          decoration: InputDecoration(
                              isDense: true, hintText: t('Chọn món')),
                          items: [
                            for (final item in otherItems)
                              DropdownMenuItem(
                                value: item.id,
                                child: Text(item.name,
                                    overflow: TextOverflow.ellipsis),
                              ),
                          ],
                          onChanged: (v) => setState(() {
                            _addons[i].refItemId = v ?? '';
                            for (final item in otherItems) {
                              if (item.id == v) {
                                _addons[i].name = item.name;
                                break;
                              }
                            }
                          }),
                        )
                      : TextField(
                          controller:
                              TextEditingController(text: _addons[i].name)
                                ..selection = TextSelection.collapsed(
                                    offset: _addons[i].name.length),
                          decoration: InputDecoration(
                              isDense: true,
                              hintText: t('Tên extra / topping')),
                          onChanged: (v) => _addons[i].name = v,
                        ),
                ),
                SizedBox(width: 8),
                SizedBox(
                  width: 112,
                  child: DropdownButtonFormField<String>(
                    initialValue: _addons[i].type,
                    isExpanded: true,
                    decoration: InputDecoration(isDense: true),
                    items: [
                      DropdownMenuItem(
                          value: 'paid', child: Text(t('Mua thêm'))),
                      DropdownMenuItem(
                          value: 'free', child: Text(t('Tặng kèm'))),
                    ],
                    onChanged: (v) => setState(() {
                      _addons[i].type = v ?? 'paid';
                      if (_addons[i].type == 'free') _addons[i].price = '0';
                    }),
                  ),
                ),
                SizedBox(width: 8),
                SizedBox(
                  width: 82,
                  child: TextField(
                    enabled: _addons[i].type != 'free',
                    controller: TextEditingController(text: _addons[i].price)
                      ..selection = TextSelection.collapsed(
                          offset: _addons[i].price.length),
                    keyboardType: TextInputType.number,
                    decoration:
                        InputDecoration(isDense: true, hintText: t('Giá')),
                    onChanged: (v) => _addons[i].price = v,
                  ),
                ),
                IconButton(
                  onPressed: () => setState(() => _addons.removeAt(i)),
                  icon: Icon(Icons.remove_circle_outline,
                      color: DanColors.late, size: 20),
                ),
              ],
            ),
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: () => setState(() {
              if (otherItems.isNotEmpty) {
                _addons.add(_AddonRow(
                  kind: 'combo',
                  type: 'paid',
                  price: '0',
                  refItemId: otherItems.first.id,
                  name: otherItems.first.name,
                ));
              } else {
                _addons.add(_AddonRow(kind: 'extra', type: 'paid', price: '0'));
              }
            }),
            icon: Icon(Icons.add, size: 16),
            label: Text(t('Thêm món kèm / extra')),
          ),
        ),
      ],
    );
  }

  Widget _recipeEditor() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(t('Công thức trừ kho'),
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
        SizedBox(height: 6),
        for (var i = 0; i < _recipe.length; i++)
          Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Expanded(
                  flex: 3,
                  child: DropdownButtonFormField<String>(
                    initialValue: _recipe[i].ingredientId.isEmpty
                        ? null
                        : _recipe[i].ingredientId,
                    isExpanded: true,
                    decoration: InputDecoration(
                        isDense: true, hintText: t('Nguyên liệu')),
                    items: [
                      for (final ing in widget.ingredients)
                        DropdownMenuItem(
                            value: ing.id,
                            child: Text('${ing.name} (${ing.unit})',
                                overflow: TextOverflow.ellipsis)),
                    ],
                    onChanged: (v) =>
                        setState(() => _recipe[i].ingredientId = v ?? ''),
                  ),
                ),
                SizedBox(width: 8),
                Expanded(
                  flex: 1,
                  child: TextField(
                    controller: TextEditingController(text: _recipe[i].qty)
                      ..selection = TextSelection.collapsed(
                          offset: _recipe[i].qty.length),
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(isDense: true, hintText: 'SL'),
                    onChanged: (v) => _recipe[i].qty = v,
                  ),
                ),
                IconButton(
                  onPressed: () => setState(() => _recipe.removeAt(i)),
                  icon: Icon(Icons.remove_circle_outline,
                      color: DanColors.late, size: 20),
                ),
              ],
            ),
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: () => setState(() => _recipe.add(_RecipeRow('', '1'))),
            icon: Icon(Icons.add, size: 16),
            label: Text(t('Thêm nguyên liệu')),
          ),
        ),
      ],
    );
  }

  Widget _scheduleEditor() {
    final dayLabels = [
      ['0', 'CN'],
      ['1', 'T2'],
      ['2', 'T3'],
      ['3', 'T4'],
      ['4', 'T5'],
      ['5', 'T6'],
      ['6', 'T7'],
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(t('Lịch bán'),
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
        SizedBox(height: 6),
        DropdownButtonFormField<String>(
          initialValue: _schedMode,
          isExpanded: true,
          decoration: InputDecoration(isDense: true),
          items: [
            DropdownMenuItem(value: 'always', child: Text(t('Bán cả ngày'))),
            DropdownMenuItem(
                value: 'daily', child: Text(t('Theo giờ mỗi ngày'))),
            DropdownMenuItem(
                value: 'weekly', child: Text(t('Theo ngày trong tuần'))),
            DropdownMenuItem(value: 'date', child: Text(t('Chỉ một ngày'))),
          ],
          onChanged: (v) => setState(() => _schedMode = v ?? 'always'),
        ),
        if (_schedMode == 'daily' || _schedMode == 'weekly') ...[
          SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: _field(t('Từ giờ'), _start, hint: '08:00')),
              SizedBox(width: 12),
              Expanded(child: _field(t('Đến giờ'), _end, hint: '21:00')),
            ],
          ),
        ],
        if (_schedMode == 'weekly') ...[
          SizedBox(height: 6),
          Wrap(
            spacing: 6,
            children: [
              for (final d in dayLabels)
                FilterChip(
                  label: Text(d[1]),
                  selected: _days.contains(d[0]),
                  onSelected: (sel) => setState(() {
                    if (sel) {
                      _days.add(d[0]);
                    } else {
                      _days.remove(d[0]);
                    }
                  }),
                ),
            ],
          ),
        ],
        if (_schedMode == 'date') ...[
          SizedBox(height: 8),
          _field(t('Ngày bán (YYYY-MM-DD)'), _date, hint: '2026-06-30'),
        ],
      ],
    );
  }
}

/// Manual translations for the customer self-order menu.
class _MenuTranslationDialog extends StatefulWidget {
  final ApiService api;
  final String name;
  final String description;
  final Map<String, Map<String, String>> translations;

  _MenuTranslationDialog({
    required this.api,
    required this.name,
    required this.description,
    required this.translations,
  });

  @override
  State<_MenuTranslationDialog> createState() => _MenuTranslationDialogState();
}

class _MenuTranslationDialogState extends State<_MenuTranslationDialog> {
  final _names = <String, TextEditingController>{};
  final _descriptions = <String, TextEditingController>{};
  bool _translating = false;

  @override
  void initState() {
    super.initState();
    for (final lang in kSelfOrderLangs) {
      final current = widget.translations[lang.code] ?? {};
      _names[lang.code] = TextEditingController(text: current['name'] ?? '');
      _descriptions[lang.code] =
          TextEditingController(text: current['description'] ?? '');
    }
    if ((_names['vi']?.text ?? '').isEmpty) _names['vi']?.text = widget.name;
    if ((_descriptions['vi']?.text ?? '').isEmpty) {
      _descriptions['vi']?.text = widget.description;
    }
  }

  @override
  void dispose() {
    for (final c in [..._names.values, ..._descriptions.values]) {
      c.dispose();
    }
    super.dispose();
  }

  Map<String, Map<String, String>> _value() => {
        for (final lang in kSelfOrderLangs)
          lang.code: {
            'name': _names[lang.code]?.text.trim() ?? '',
            'description': _descriptions[lang.code]?.text.trim() ?? '',
          }
      };

  Future<void> _autoTranslate() async {
    setState(() => _translating = true);
    try {
      final data = await widget.api.translateMenuItem({
        'name': widget.name,
        'description': widget.description,
        'translations': _value(),
      });
      for (final lang in kSelfOrderLangs) {
        final row = data[lang.code];
        if (row is Map) {
          _names[lang.code]?.text = (row['name'] ?? '').toString();
          _descriptions[lang.code]?.text =
              (row['description'] ?? '').toString();
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late,
        ));
      }
    } finally {
      if (mounted) setState(() => _translating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(t('Bản dịch món')),
      content: SizedBox(
        width: dialogWidth(context, 640),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final lang in kSelfOrderLangs) ...[
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text('${lang.flag} ${lang.nativeName}',
                      style:
                          TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
                ),
                SizedBox(height: 6),
                TextField(
                  controller: _names[lang.code],
                  decoration: InputDecoration(
                    labelText: t('Tên món'),
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                ),
                SizedBox(height: 8),
                TextField(
                  controller: _descriptions[lang.code],
                  minLines: 1,
                  maxLines: 3,
                  decoration: InputDecoration(
                    labelText: t('Mô tả'),
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                ),
                SizedBox(height: 14),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _translating ? null : () => Navigator.of(context).pop(),
          child: Text(t('Hủy')),
        ),
        OutlinedButton.icon(
          onPressed: _translating ? null : _autoTranslate,
          icon: _translating
              ? SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : Icon(Icons.auto_fix_high, size: 18),
          label: Text(t('Tự dịch ô trống')),
        ),
        FilledButton(
          onPressed:
              _translating ? null : () => Navigator.of(context).pop(_value()),
          child: Text(t('Lưu bản dịch')),
        ),
      ],
    );
  }
}

/// Live preview of the item as it appears on the iPad self-order screen —
/// updates as the form on the right is edited.
class _MenuItemPreview extends StatelessWidget {
  final _ItemFormDialogState state;
  _MenuItemPreview({required this.state});

  ImageProvider? _img() {
    final raw = state.pvImage;
    if (raw.isEmpty) return null;
    final url = raw.startsWith('http')
        ? raw
        : '${state.pvServerUrl}${raw.startsWith('/') ? '' : '/'}$raw';
    // Bound the decode size so a full-res upload can't chew RAM in the live
    // preview while typing.
    return ResizeImage(NetworkImage(url), width: 480);
  }

  @override
  Widget build(BuildContext context) {
    final img = _img();
    final name = state.pvName.isEmpty ? t('Tên món') : state.pvName;
    final price = state.pvPrice;
    final desc = state.pvDescription;

    return Center(
      child: SingleChildScrollView(
        padding: EdgeInsets.symmetric(vertical: 24, horizontal: 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Text(
              t('XEM TRƯỚC TRÊN THIẾT BỊ KHÁCH HÀNG'),
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .8,
                  color: Colors.white70),
            ),
            SizedBox(height: 20),
            Opacity(
              opacity: state.pvHidden ? .45 : 1,
              child: Container(
                width: 220,
                decoration: BoxDecoration(
                  color: DanColors.surface,
                  border: Border.all(color: DanColors.border),
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [
                    BoxShadow(
                        color: Color(0x1F000000),
                        blurRadius: 12,
                        offset: Offset(0, 4)),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    AspectRatio(
                      aspectRatio: 1.2,
                      child: ClipRRect(
                        borderRadius:
                            BorderRadius.vertical(top: Radius.circular(15)),
                        child: img != null
                            ? Image(
                                image: img,
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) =>
                                    _emojiBox(state.pvEmoji, 48))
                            : _emojiBox(state.pvEmoji, 48),
                      ),
                    ),
                    Padding(
                      padding: EdgeInsets.fromLTRB(14, 12, 14, 14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(name,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w800,
                                  height: 1.2)),
                          SizedBox(height: 6),
                          Text(Fmt.money(price),
                              style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w900,
                                  color: DanColors.brand)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            SizedBox(height: 24),
            Container(
              width: dialogWidth(context, 460),
              decoration: BoxDecoration(
                color: DanColors.surface,
                border: Border.all(color: DanColors.border),
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                      color: Color(0x24000000),
                      blurRadius: 20,
                      offset: Offset(0, 8)),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AspectRatio(
                    aspectRatio: 16 / 9,
                    child: ClipRRect(
                      borderRadius:
                          BorderRadius.vertical(top: Radius.circular(15)),
                      child: img != null
                          ? Image(
                              image: img,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) =>
                                  _emojiBox(state.pvEmoji, 64))
                          : _emojiBox(state.pvEmoji, 64),
                    ),
                  ),
                  Padding(
                    padding: EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name,
                            style: TextStyle(
                                fontSize: 18, fontWeight: FontWeight.w900)),
                        SizedBox(height: 4),
                        if (state.pvCategory.isNotEmpty ||
                            state.pvStationLabel.isNotEmpty)
                          Text(
                              [state.pvCategory, state.pvStationLabel]
                                  .where((e) => e.isNotEmpty)
                                  .join(' · '),
                              style: TextStyle(
                                  fontSize: 13, color: DanColors.faint)),
                        if (desc.isNotEmpty) ...[
                          SizedBox(height: 10),
                          Text(desc,
                              style: TextStyle(
                                  fontSize: 13.5,
                                  color: DanColors.muted,
                                  height: 1.4)),
                        ],
                        if (state.pvIngredients.isNotEmpty) ...[
                          SizedBox(height: 12),
                          _chips(t('Nguyên liệu'), state.pvIngredients,
                              DanColors.surface2, DanColors.muted),
                        ],
                        if (state.pvAllergens.isNotEmpty) ...[
                          SizedBox(height: 10),
                          _chips(t('Dị ứng'), state.pvAllergens,
                              Color(0x1AFF6B6B), DanColors.late),
                        ],
                        SizedBox(height: 16),
                        Row(
                          children: [
                            Text(Fmt.money(price),
                                style: TextStyle(
                                    fontSize: 22,
                                    fontWeight: FontWeight.w900,
                                    color: DanColors.brand)),
                            Spacer(),
                            Container(
                              padding: EdgeInsets.symmetric(
                                  horizontal: 18, vertical: 10),
                              decoration: BoxDecoration(
                                color: DanColors.brand,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(t('Thêm'),
                                  style: TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w800,
                                      fontSize: 13.5)),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            if (state.pvHidden) ...[
              SizedBox(height: 16),
              Container(
                width: dialogWidth(context, 460),
                padding: EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Color(0x2BFF6B6B),
                  borderRadius: BorderRadius.circular(8),
                  border:
                      Border.all(color: DanColors.late.withValues(alpha: 0.3)),
                ),
                child: Text(
                  t('Món đang ẩn — không hiện trên thiết bị khách hàng'),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: Colors.white),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _emojiBox(String emoji, double size) => Container(
        color: DanColors.surface2,
        alignment: Alignment.center,
        child: Text(emoji, style: TextStyle(fontSize: size)),
      );

  Widget _chips(String label, List<String> items, Color bg, Color fg) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                color: DanColors.faint)),
        SizedBox(height: 5),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final t in items)
              Container(
                padding: EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                    color: bg, borderRadius: BorderRadius.circular(6)),
                child: Text(t,
                    style: TextStyle(
                        fontSize: 11, fontWeight: FontWeight.w600, color: fg)),
              ),
          ],
        ),
      ],
    );
  }
}
