// GENERATED SPLIT of print_template_designer.dart — model/save/editor/preview.
// extension cùng library: truy cập nguyên vẹn field/method private của _State.
part of 'print_template_designer.dart';

extension _PrintDesignerMethods on _PrintTemplateDesignerState {
  // ── Hydration / template model ────────────────────────────────────────────

  void _hydrate(Map<String, dynamic> config) {
    _printConfig = _copyMap(config);
    _bill = _copyMap(_printConfig['bill']);
    _labels = _copyMap(_printConfig['labels']);
    _loadKind(_kind);
  }

  void _loadKind(String kind) {
    _kind = kind;
    _template = _templateFor(kind);
    _nameCtrl.text = asText(_template['name']);
    _syncRowControllers();
  }

  Map<String, dynamic> _templateFor(String kind) {
    final templates = _copyMap(_printConfig['templates']);
    var tpl = _copyMap(templates[kind]);
    if (tpl.isEmpty) tpl = _defaultFor(kind);
    _ensureRows(tpl, kind);
    // Phiếu bếp CŨ (bản clone của tem: chỉ {itemName}+QR, KHÔNG có bảng món) chưa
    // từng in đúng vì server bỏ qua. Nâng thẳng lên mẫu phiếu bếp chuẩn để designer
    // luôn có bảng món — không mất gì vì mẫu cũ vốn không dùng được.
    if (kind == 'kitchen_ticket' &&
        asText(tpl['standard']) != 'dan_kitchen_template') {
      final rows = tpl['rows'];
      final hasItems = rows is List &&
          rows.any((r) => r is Map && asText(r['type']) == 'items');
      if (!hasItems) tpl = _defaultKitchen();
    }
    return tpl;
  }

  /// Guarantee `tpl['rows']` exists: use it if present, else migrate from the
  /// legacy positioned `elements` (sorted y→x, same order the server printed),
  /// else fall back to the standard default rows.
  void _ensureRows(Map<String, dynamic> tpl, String kind) {
    final existing = tpl['rows'];
    if (existing is List && existing.isNotEmpty) {
      tpl['rows'] = existing.whereType<Map>().map(_normalizeRow).toList();
      return;
    }
    final elements = tpl['elements'];
    if (elements is List && elements.isNotEmpty) {
      final sorted = elements
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList()
        ..sort((a, b) {
          final dy = _d(a['y']).compareTo(_d(b['y']));
          return dy != 0 ? dy : _d(a['x']).compareTo(_d(b['x']));
        });
      tpl['rows'] = sorted.map(_normalizeRow).toList();
      return;
    }
    tpl['rows'] = _defaultFor(kind)['rows'];
  }

  Map<String, dynamic> _defaultFor(String kind) => switch (kind) {
        'bill' => _defaultBill(),
        'kitchen_ticket' => _defaultKitchen(),
        _ => _defaultLabel(kind),
      };

  /// Strip positioning, keep only what a flowing row needs.
  Map<String, dynamic> _normalizeRow(Map raw) {
    final e = Map<String, dynamic>.from(raw);
    final type = asText(e['type']).isEmpty ? 'text' : asText(e['type']);
    final id =
        asText(e['id']).isEmpty ? '${type}_${_rowSeq++}' : asText(e['id']);
    switch (type) {
      case 'line':
        return {'id': id, 'type': 'line'};
      case 'qr':
        return {
          'id': id,
          'type': 'qr',
          'qrText': asText(e['qrText']).isEmpty
              ? '{invoiceLookupUrl}'
              : asText(e['qrText']),
          'qrCaption': asText(e['qrCaption']),
          'qrShowCaption': _b(e['qrShowCaption']),
        };
      case 'barcode':
        return {
          'id': id,
          'type': 'barcode',
          'barcodeText': asText(e['barcodeText']).isEmpty
              ? '{billNo}'
              : asText(e['barcodeText']),
        };
      case 'image':
        return {
          'id': id,
          'type': 'image',
          'label': asText(e['label']).isEmpty ? 'Logo' : asText(e['label']),
          'src': asText(e['src']),
        };
      case 'items':
        // Công tắc mặc định BẬT (thiếu khoá => true), khớp kitchenTableLines server.
        return {
          'id': id,
          'type': 'items',
          'showQty': e['showQty'] != false && e['showQty'] != '0',
          'showMods': e['showMods'] != false && e['showMods'] != '0',
          'showNote': e['showNote'] != false && e['showNote'] != '0',
        };
      default:
        return {
          'id': id,
          'type': 'text',
          'text': asText(e['text']),
          'align': asText(e['align']).isEmpty ? 'left' : asText(e['align']),
          'bold': _b(e['bold']),
          'fontSize': _d(e['fontSize'], 3.2),
        };
    }
  }

  Map<String, dynamic> _defaultBill() {
    final width = _d(_bill['widthMm'], 72).clamp(48, 120).toDouble();
    final height = _d(_bill['heightMm'], 320).clamp(120, 520).toDouble();
    return {
      'kind': 'bill',
      'version': 10,
      'standard': 'dan_payment_receipt',
      'name': t('Mẫu hóa đơn chuẩn'),
      'paper': asText(_bill['paper']).isEmpty ? 'K80' : asText(_bill['paper']),
      'widthMm': width,
      'heightMm': height,
      'rows': [
        _tRow(t('{storeName}\n{address}\nĐT: {phone}'),
            align: 'center', bold: true),
        _lineRow(solid: true),
        _tRow('{billTitle}', align: 'center', bold: true),
        _tRow(
            t('Số bill: {billNo}\n{place}\nThu ngân: {cashier}\nNgày: {time}')),
        _lineRow(solid: true),
        _tRow('{items}'),
        _tRow(
            '{subtotalLine}\n{vatLine}\n{grandTotalLine}\n{totalWordsLine}\n{methodLine}'),
        _lineRow(solid: true),
        _tRow('{noteBlock}\n{solidLine}\n{thanksC}'),
      ],
    };
  }

  Map<String, dynamic> _defaultLabel([String kind = 'label']) {
    final width = _d(_labels['widthMm'], 50).clamp(20, 120).toDouble();
    final height = _d(_labels['heightMm'], 30).clamp(10, 100).toDouble();
    // TEM MÃ VẠCH sản phẩm (product_label / tab "Mã vạch"): TÊN sản phẩm ở TRÊN,
    // MÃ VẠCH của sản phẩm ({barcode}, quét được) ở DƯỚI. Trước đây mẫu mặc định
    // dùng nhầm {options}/{note}/{orderNo} + QR mã đơn (của tem ly) nên in ra sai.
    final rows = kind == 'product_label'
        ? [
            _tRow('{itemName}', align: 'center', bold: true),
            _tRow('{price}', align: 'center'),
            _barcodeRow('{barcode}'),
          ]
        : [
            // Tem ly / phiếu: tên món + yêu cầu thêm + ghi chú + mã đơn (QR để tra).
            _tRow('{itemName}', align: 'center', bold: true),
            _tRow('{options}', align: 'center'),
            _tRow('{note}', align: 'center'),
            _tRow('#{orderNo} {copy}'),
            _qrRow('{orderNo}'),
          ];
    return {
      'kind': kind,
      'version': 1,
      'standard': 'dan_label_template',
      'name': t('Mẫu tem chuẩn'),
      'widthMm': width,
      'heightMm': height,
      'rows': rows,
    };
  }

  Map<String, dynamic> _barcodeRow(String data) => {
        'id': 'barcode_${_rowSeq++}',
        'type': 'barcode',
        'barcodeText': data,
      };

  Map<String, dynamic> _tRow(String text,
          {String align = 'left', bool bold = false, double fontSize = 3.2}) =>
      {
        'id': 'text_${_rowSeq++}',
        'type': 'text',
        'text': text,
        'align': align,
        'bold': bold,
        'fontSize': fontSize,
      };

  // Phần tử BẢNG MÓN của phiếu bếp: server dựng bảng "Tên món | SL" có viền kèm
  // yêu cầu thêm/ghi chú (xem kitchenTableLines ở printing.js). Các công tắc quyết
  // định hiện cột SL, yêu cầu thêm, ghi chú.
  Map<String, dynamic> _itemsRow() => {
        'id': 'items_${_rowSeq++}',
        'type': 'items',
        'showQty': true,
        'showMods': true,
        'showNote': true,
      };

  // MẪU PHIẾU BẾP chuẩn: header khu vực + bàn CHỮ TO ĐẬM, giờ/ngày, nhân viên,
  // số TT, rồi BẢNG MÓN. Khác hẳn mẫu tem (bản clone cũ chỉ có 1 món + QR): phiếu
  // bếp cần bảng nhiều món để bếp làm. Server đọc đúng mẫu này (templates.kitchen_ticket)
  // khi có phần tử 'items', không thì rơi về bản dựng sẵn renderTicket.
  Map<String, dynamic> _defaultKitchen() {
    final width = _d(_labels['widthMm'], 80).clamp(48, 120).toDouble();
    final height = _d(_labels['heightMm'], 200).clamp(80, 520).toDouble();
    return {
      'kind': 'kitchen_ticket',
      'version': 1,
      'standard': 'dan_kitchen_template',
      'name': t('Mẫu phiếu bếp chuẩn'),
      'paper': 'K80',
      'widthMm': width,
      'heightMm': height,
      'rows': [
        _tRow('{zone}', align: 'center', bold: true, fontSize: 7),
        _tRow('- BÀN {table}', align: 'center', bold: true, fontSize: 7),
        _tRow('Giờ: {time}    Ngày: {date}', bold: true),
        _tRow('Nhân viên: {staff}', bold: true),
        _tRow('Số TT: {seq}', bold: true),
        _itemsRow(),
      ],
    };
  }

  Map<String, dynamic> _lineRow({bool solid = false}) => {
        'id': 'line_${_rowSeq++}',
        'type': 'line',
        if (solid) 'lineStyle': 'solid'
      };

  Map<String, dynamic> _qrRow(String data,
          {String caption = '', bool showCaption = false}) =>
      {
        'id': 'qr_${_rowSeq++}',
        'type': 'qr',
        'qrText': data,
        'qrCaption': caption,
        'qrShowCaption': showCaption,
      };

  Map<String, dynamic> _imageRow({String label = 'Logo'}) => {
        'id': 'img_${_rowSeq++}',
        'type': 'image',
        'src': '',
        'label': label,
        'logoScale': 1.0,
      };

  // ── Phiên bản mẫu bill (Gọn / Chuẩn / Chi tiết) ───────────────────────────
  // Bấm 1 nút đổi cả bố cục: Gọn = tối giản tiết kiệm giấy; Chuẩn = mặc định;
  // Chi tiết = đủ logo + thông tin cửa hàng + thuế + QR tra cứu.

  List<Map<String, dynamic>> _compactBillRows() => [
        _tRow('{storeName}', align: 'center', bold: true),
        _lineRow(),
        _tRow(t('{billNo} · {time}')),
        _lineRow(),
        _tRow('{items}'),
        _lineRow(),
        _tRow('{grandTotalLine}', bold: true),
        _tRow('{footer}', align: 'center'),
      ];

  List<Map<String, dynamic>> _detailedBillRows() => [
        _imageRow(),
        _tRow('{storeName}', align: 'center', bold: true),
        _tRow('{storeSubtitle}', align: 'center'),
        _tRow(t('{address}\nĐT: {phone} · MST: {taxCode}'), align: 'center'),
        _lineRow(),
        _tRow('{billTitle}', align: 'center', bold: true),
        _tRow(t(
            'Số bill: {billNo}\n{place}\nThu ngân: {cashier}\nNgày: {time}\nKhách: {customerName}')),
        _lineRow(),
        _tRow('{items}'),
        _lineRow(),
        _tRow('{subtotalLine}\n{vatLine}'),
        _tRow('{grandTotalLine}', bold: true),
        _tRow('{paymentLines}\n{paidLine}\n{changeLine}'),
        _lineRow(),
        _qrRow('{invoiceLookupUrl}',
            caption: t('Quét để tra cứu hóa đơn'), showCaption: true),
        _tRow('{footer}', align: 'center'),
      ];

  void _applyPreset(String preset) {
    final rows = switch (preset) {
      'compact' => _compactBillRows(),
      'detailed' => _detailedBillRows(),
      _ => (_defaultBill()['rows'] as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList(),
    };
    _template['preset'] = preset;
    _setRows(rows);
  }

  // ── Rows accessors ────────────────────────────────────────────────────────

  List<Map<String, dynamic>> get _rows {
    final list = _template['rows'];
    if (list is! List) return [];
    return list
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  void _setRows(List<Map<String, dynamic>> rows, {bool save = true}) {
    _rebuild(() => _template['rows'] = rows);
    if (save) _scheduleSave();
  }

  Map<String, dynamic> get _media => _kind == 'bill' ? _bill : _labels;

  // ── Row controllers ───────────────────────────────────────────────────────

  void _disposeRowControllers() {
    for (final c in _rowCtrls.values) {
      c.dispose();
    }
    for (final f in _rowFocus.values) {
      f.dispose();
    }
    _rowCtrls.clear();
    _rowFocus.clear();
  }

  void _syncRowControllers() {
    _disposeRowControllers();
    for (final row in _rows) {
      if (asText(row['type']) != 'text') continue;
      final id = asText(row['id']);
      final ctrl = TextEditingController(text: asText(row['text']));
      final focus = FocusNode();
      focus.addListener(() {
        if (focus.hasFocus) _activeRowId = id;
      });
      _rowCtrls[id] = ctrl;
      _rowFocus[id] = focus;
    }
    _activeRowId ??= _rowCtrls.keys.isEmpty ? null : _rowCtrls.keys.first;
  }

  // ── Editing actions ───────────────────────────────────────────────────────

  void _switchKind(String kind) {
    if (_kind == kind) return;
    _rebuild(() {
      _kind = kind;
      _activeRowId = null;
      _loadKind(kind);
    });
  }

  void _updateRow(String id, void Function(Map<String, dynamic>) fn) {
    final rows = _rows;
    for (final r in rows) {
      if (asText(r['id']) == id) fn(r);
    }
    _setRows(rows);
  }

  // onReorderItem gives an already-adjusted newIndex (no manual -1 needed).
  void _reorderRows(int oldIndex, int newIndex) {
    final rows = _rows;
    final row = rows.removeAt(oldIndex);
    rows.insert(newIndex, row);
    _setRows(rows);
  }

  void _deleteRow(String id) {
    _rowCtrls.remove(id)?.dispose();
    _rowFocus.remove(id)?.dispose();
    _setRows(_rows.where((r) => asText(r['id']) != id).toList());
  }

  void _addRow(String type) {
    final id = '${type}_${_rowSeq++}';
    final Map<String, dynamic> row = switch (type) {
      'line' => {'id': id, 'type': 'line'},
      'image' => {'id': id, 'type': 'image', 'label': 'Logo', 'src': ''},
      'qr' => {
          'id': id,
          'type': 'qr',
          'qrText': _kind == 'bill' ? '{invoiceLookupUrl}' : '{orderNo}',
          'qrCaption': '',
          'qrShowCaption': false,
        },
      // Bill: bảng món là biến {items} chèn vào dòng chữ (server dựng cột SL/giá/
      // thành tiền, không đánh dấu in đậm nên không vỡ căn cột). Phiếu bếp: phần tử
      // 'items' RIÊNG — server đẩy thẳng bảng đã đánh dấu in đậm, không qua bẻ dòng.
      'items' => _kind == 'bill'
          ? {
              'id': id,
              'type': 'text',
              'text': '{items}',
              'align': 'left',
              'bold': false,
              'fontSize': 3.2,
            }
          : {
              'id': id,
              'type': 'items',
              'showQty': true,
              'showMods': true,
              'showNote': true,
            },
      _ => {
          'id': id,
          'type': 'text',
          'text': t('Nội dung mới'),
          'align': 'left',
          'bold': false,
          'fontSize': 3.2,
        },
    };
    if (asText(row['type']) == 'text') {
      final ctrl = TextEditingController(text: asText(row['text']));
      final focus = FocusNode();
      focus.addListener(() {
        if (focus.hasFocus) _activeRowId = id;
      });
      _rowCtrls[id] = ctrl;
      _rowFocus[id] = focus;
      _activeRowId = id;
    }
    _setRows([..._rows, row]);
  }

  void _insertToken(String token) {
    var id = _activeRowId;
    // No focused text row → add one, or use the first text row.
    if (id == null || !_rowCtrls.containsKey(id)) {
      id = _rowCtrls.keys.isEmpty ? null : _rowCtrls.keys.last;
    }
    if (id == null) {
      _addRow('text');
      id = _activeRowId;
      if (id == null) return;
      _rowCtrls[id]!.text = '';
    }
    final ctrl = _rowCtrls[id]!;
    final text = ctrl.text;
    final sel = ctrl.selection;
    final start = sel.start >= 0 ? sel.start : text.length;
    final end = sel.end >= 0 ? sel.end : text.length;
    final next = text.replaceRange(start, end, token);
    ctrl.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: start + token.length),
    );
    _updateRow(id, (r) => r['text'] = next);
    _rowFocus[id]?.requestFocus();
  }

  void _restoreDefault() {
    _rebuild(() {
      _template = _defaultFor(_kind);
      _nameCtrl.text = asText(_template['name']);
      _formRevision++;
      _syncRowControllers();
    });
    _scheduleSave();
  }

  void _applyPaper(String preset) {
    final sizes = {
      'K80': [80.0, 320.0],
      'K57': [57.0, 320.0],
      'A5': [148.0, 210.0],
    };
    final s = sizes[preset];
    if (s == null) return;
    _rebuild(() {
      _template['paper'] = preset;
      _template['widthMm'] = s[0];
      _template['heightMm'] = s[1];
      _media['paper'] = preset;
      _media['widthMm'] = s[0];
      _media['heightMm'] = s[1];
    });
    _scheduleSave();
  }

  void _setTemplateValue(String key, dynamic value) {
    _rebuild(() {
      _template[key] = value;
      if (key == 'widthMm' || key == 'heightMm') _media[key] = value;
    });
    _scheduleSave();
  }

  void _setMediaValue(String key, dynamic value) {
    _rebuild(() {
      _media[key] = value;
      _template[key] = value;
    });
    _scheduleSave();
  }

  void _setBillField(String key, String value) {
    _rebuild(() => _bill[key] = value);
    _scheduleSave();
  }

  Future<void> _pickBackground() async {
    final dataUrl = await pickReceiptAsDataUrl();
    if (dataUrl == null || !dataUrl.startsWith('data:image/')) return;
    _setMediaValue('backgroundSrc', dataUrl);
  }

  Future<void> _pickRowImage(String id) async {
    final dataUrl = await pickReceiptAsDataUrl();
    if (dataUrl == null || !dataUrl.startsWith('data:image/')) return;
    _updateRow(id, (r) => r['src'] = dataUrl);
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  void _scheduleSave() {
    _template['name'] = _nameCtrl.text.trim();
    final kind = _kind;
    final template = _copyMap(_template);
    final bill = _copyMap(_bill);
    final labels = _copyMap(_labels);
    _saveDebounce.run(() => _saveNow(
          kind: kind,
          template: template,
          bill: bill,
          labels: labels,
        ));
    _rebuild(() => _saveState = t('Đang chờ lưu'));
  }

  Future<void> _saveNow({
    String? kind,
    Map<String, dynamic>? template,
    Map<String, dynamic>? bill,
    Map<String, dynamic>? labels,
  }) async {
    _saveDebounce.cancel();
    final saveKind = kind ?? _kind;
    final saveTemplate = template ?? _copyMap(_template);
    saveTemplate['name'] = _nameCtrl.text.trim();
    _rebuild(() {
      _saving = true;
      _saveState = t('Đang lưu');
    });
    try {
      final body = {
        'kind': saveKind,
        'template': saveTemplate,
        if (saveKind == 'bill')
          'bill': bill ?? _bill
        else
          'labels': labels ?? _labels,
      };
      final res = await widget.api.autoSavePrintTemplate(body);
      if (!mounted) return;
      final next = _copyMap(res['print_config']);
      _rebuild(() {
        if (next.isNotEmpty) _printConfig = next;
        _saving = false;
        _saveState = t('Đã lưu');
      });
      if (next.isNotEmpty) {
        _ignoreNextConfigUpdate = true;
        widget.onSaved?.call(next);
      }
    } catch (e) {
      if (!mounted) return;
      _rebuild(() {
        _saving = false;
        _saveState = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Widget _topBar() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        // Left cluster wraps to a second line on narrow windows (Expanded →
        // Wrap is valid; Expanded must never live directly inside a Wrap).
        Expanded(
          child: Wrap(
            spacing: 10,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              SizedBox(
                width: 240,
                child: TextField(
                  controller: _nameCtrl,
                  decoration: InputDecoration(
                    labelText: t('Tên mẫu in'),
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                  onChanged: (_) => _scheduleSave(),
                ),
              ),
              _modeButton('bill', 'Bill', Icons.receipt_long_outlined),
              _modeButton('kitchen_ticket', t('Phiếu bếp'),
                  Icons.soup_kitchen_outlined),
              _modeButton('cup_label', t('Tem nhãn'), Icons.label_outline),
              _modeButton('product_label', t('Mã vạch'), Icons.qr_code_2),
              _paperDropdown(),
              IconButton(
                onPressed: _showTokenList,
                icon: Icon(Icons.info_outline, color: DanColors.muted),
                tooltip: t('Danh sách dữ liệu (token)'),
              ),
            ],
          ),
        ),
        SizedBox(width: 10),
        ConstrainedBox(
          constraints: BoxConstraints(maxWidth: 160),
          child: Text(_saveState,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: DanColors.faint, fontSize: 12)),
        ),
        SizedBox(width: 8),
        FilledButton.icon(
          onPressed: _saving ? null : () => _saveNow(),
          icon: _saving
              ? SizedBox(
                  width: 15,
                  height: 15,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : Icon(Icons.save_outlined),
          label: Text(t('Lưu')),
        ),
      ],
    );
  }

  Widget _modeButton(String kind, String label, IconData icon) {
    final active = _kind == kind;
    return active
        ? FilledButton.icon(
            onPressed: () => _switchKind(kind),
            icon: Icon(icon, size: 18),
            label: Text(label))
        : OutlinedButton.icon(
            onPressed: () => _switchKind(kind),
            icon: Icon(icon, size: 18),
            label: Text(label));
  }

  Widget _paperDropdown() {
    final current =
        asText(_template['paper']).isEmpty ? '—' : asText(_template['paper']);
    final presets = ['K80', 'K57', 'A5'];
    return SizedBox(
      width: 150,
      child: DropdownButtonFormField<String>(
        key: ValueKey('paper_${_kind}_${current}_$_formRevision'),
        initialValue: presets.contains(current) ? current : null,
        isExpanded: true,
        decoration: InputDecoration(
          labelText: t('Khổ giấy gợi ý'),
          isDense: true,
          border: OutlineInputBorder(),
        ),
        items: [
          DropdownMenuItem(value: 'K80', child: Text('K80 (80mm)')),
          DropdownMenuItem(value: 'K57', child: Text('K57 (57mm)')),
          DropdownMenuItem(value: 'A5', child: Text('A5')),
        ],
        onChanged: (v) => v == null ? null : _applyPaper(v),
      ),
    );
  }

  // ── Left: editor pane ─────────────────────────────────────────────────────

  Widget _editorPane() {
    return Container(
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _section(t('KHỔ IN'), _paperControls()),
            if (_kind == 'bill')
              _section(t('THÔNG TIN CỬA HÀNG'), _storeInfo()),
            // "TINH CHỈNH CỘT TIỀN" tạm ẩn: server (printing.js) hiện chia cột
            // đều tự động, KHÔNG đọc itemQtyWidth/itemPriceWidth/itemAmountWidth,
            // nên các ô này không đổi được bill in ra → ẩn cho đỡ hiểu lầm. Bật
            // lại khi nối các khóa đó vào danhSachHang().
            _section(t('NỘI DUNG MẪU'), _rowsEditor()),
            _section(t('CHÈN DỮ LIỆU'), _tokenPalette()),
          ],
        ),
      ),
    );
  }

  Widget _section(String title, List<Widget> children) {
    return Padding(
      padding: EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title,
              style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .4,
                  color: DanColors.muted)),
          SizedBox(height: 9),
          ...children,
        ],
      ),
    );
  }

  List<Widget> _paperControls() {
    return [
      Row(children: [
        Expanded(
            child: _numberField(t('Rộng mm'), _d(_template['widthMm']),
                (v) => _setTemplateValue('widthMm', v))),
        SizedBox(width: 8),
        Expanded(
            child: _numberField('Cao mm', _d(_template['heightMm']),
                (v) => _setTemplateValue('heightMm', v))),
      ]),
      SizedBox(height: 8),
      Row(children: [
        Expanded(
            child: _numberField('Scale %', _d(_media['printScale'], 100),
                (v) => _setMediaValue('printScale', v))),
        SizedBox(width: 8),
        Expanded(
            child: _numberField(t('Số bản'), _d(_media['copies'], 1),
                (v) => _setMediaValue('copies', v.round().toString()))),
      ]),
      if (_kind != 'bill') ...[
        SizedBox(height: 8),
        Row(children: [
          Expanded(
              child: _numberField(t('Lề trái'), _d(_media['rollMarginLeftMm']),
                  (v) => _setMediaValue('rollMarginLeftMm', v))),
          SizedBox(width: 8),
          Expanded(
              child: _numberField(t('Lề phải'), _d(_media['rollMarginRightMm']),
                  (v) => _setMediaValue('rollMarginRightMm', v))),
        ]),
        SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _pickBackground,
          icon: Icon(Icons.wallpaper_outlined, size: 18),
          label: Text(t('Chọn nền tem')),
        ),
      ],
    ];
  }

  List<Widget> _storeInfo() {
    Widget field(String label, String key, {int maxLines = 1}) {
      return Padding(
        padding: EdgeInsets.only(bottom: 8),
        child: TextFormField(
          key: ValueKey('store_${key}_$_formRevision'),
          initialValue: asText(_bill[key]),
          maxLines: maxLines,
          decoration: InputDecoration(
              labelText: label, isDense: true, border: OutlineInputBorder()),
          onChanged: (v) => _setBillField(key, v),
        ),
      );
    }

    return [
      field(t('Tên cửa hàng'), 'storeName'),
      field(t('Dòng mô tả'), 'storeSubtitle'),
      field(t('Địa chỉ'), 'address', maxLines: 2),
      Row(children: [
        Expanded(child: field('MST', 'taxCode')),
        SizedBox(width: 8),
        Expanded(child: field(t('SĐT'), 'phone')),
      ]),
      field('Email', 'email'),
      field(t('Lời cảm ơn (footer)'), 'footer', maxLines: 2),
      SizedBox(height: 4),
      _densityPicker(),
      _fontScalePicker(),
    ];
  }

  List<Widget> _rowsEditor() {
    final rows = _rows;
    return [
      if (_kind == 'bill') ...[_presetBar(), SizedBox(height: 12)],
      if (rows.isEmpty)
        Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Text(t('Chưa có dòng nào — bấm “+ Dòng chữ” bên dưới.'),
              style: TextStyle(color: DanColors.faint, fontSize: 12.5)),
        )
      else
        ReorderableListView(
          shrinkWrap: true,
          physics: NeverScrollableScrollPhysics(),
          buildDefaultDragHandles: false,
          onReorderItem: _reorderRows,
          children: [
            for (int i = 0; i < rows.length; i++)
              _rowTile(rows[i], i, key: ValueKey(asText(rows[i]['id']))),
          ],
        ),
      SizedBox(height: 8),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          _addBtn(Icons.text_fields, t('Dòng chữ'), () => _addRow('text')),
          _addBtn(Icons.horizontal_rule, t('Đường kẻ'), () => _addRow('line')),
          if (_kind == 'bill' || _kind == 'kitchen_ticket')
            _addBtn(Icons.table_rows_outlined, t('Bảng món'),
                () => _addRow('items')),
          _addBtn(Icons.image_outlined, t('Logo/Ảnh'), () => _addRow('image')),
          _addBtn(Icons.qr_code_2, t('Mã QR'), () => _addRow('qr')),
          OutlinedButton.icon(
            onPressed: _restoreDefault,
            icon: Icon(Icons.restart_alt, size: 18),
            label: Text(t('Khôi phục mẫu chuẩn')),
            style: OutlinedButton.styleFrom(foregroundColor: DanColors.muted),
          ),
        ],
      ),
    ];
  }

  Widget _addBtn(IconData icon, String label, VoidCallback onTap) {
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(icon, size: 18),
      label: Text(label),
    );
  }

  /// Chọn nhanh PHIÊN BẢN bố cục bill. Đổi cả bộ dòng chỉ với 1 chạm.
  Widget _presetBar() {
    final cur = asText(_template['preset']);
    Widget card(String preset, IconData icon, String title, String desc) {
      final active = cur == preset;
      return Expanded(
        child: InkWell(
          onTap: () => _applyPreset(preset),
          borderRadius: BorderRadius.circular(DanRadius.sm),
          child: Container(
            padding: EdgeInsets.symmetric(horizontal: 10, vertical: 10),
            decoration: BoxDecoration(
              color: active ? DanColors.brandDim : DanColors.surface,
              borderRadius: BorderRadius.circular(DanRadius.sm),
              border: Border.all(
                  color: active ? DanColors.brand : DanColors.border,
                  width: active ? 2 : 1),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Icon(icon,
                      size: 16,
                      color: active ? DanColors.brand : DanColors.muted),
                  SizedBox(width: 6),
                  Text(title,
                      style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w800,
                          color: active ? DanColors.brand : DanColors.text)),
                ]),
                SizedBox(height: 3),
                Text(desc,
                    style: TextStyle(
                        fontSize: 10.5, color: DanColors.faint, height: 1.3)),
              ],
            ),
          ),
        ),
      );
    }

    // IntrinsicHeight: cho Row một chiều cao hữu hạn (= card cao nhất) để
    // crossAxisAlignment.stretch KHÔNG ép con cao vô hạn khi nằm trong
    // SingleChildScrollView (nếu không sẽ crash "BoxConstraints forces infinite height").
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          card('compact', Icons.short_text, t('Gọn'),
              t('Tối giản, tiết kiệm giấy')),
          SizedBox(width: 8),
          card('standard', Icons.receipt_long_outlined, t('Chuẩn'),
              t('Đủ dùng hằng ngày')),
          SizedBox(width: 8),
          card('detailed', Icons.article_outlined, t('Chi tiết'),
              t('Logo + thuế + QR tra cứu')),
        ],
      ),
    );
  }

  Widget _rowTile(Map<String, dynamic> row, int index, {required Key key}) {
    final id = asText(row['id']);
    final type = asText(row['type']);
    return Container(
      key: key,
      margin: EdgeInsets.only(bottom: 8),
      padding: EdgeInsets.fromLTRB(6, 8, 8, 8),
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(DanRadius.sm),
        border: Border.all(color: DanColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ReorderableDragStartListener(
            index: index,
            child: Padding(
              padding: EdgeInsets.only(top: 8, right: 4),
              child:
                  Icon(Icons.drag_indicator, size: 18, color: DanColors.faint),
            ),
          ),
          Expanded(child: _rowBody(row, id, type)),
          IconButton(
            onPressed: () => _deleteRow(id),
            icon: Icon(Icons.close, size: 18),
            tooltip: t('Xóa dòng'),
            color: DanColors.late,
            visualDensity: VisualDensity.compact,
          ),
        ],
      ),
    );
  }

  Widget _rowBody(Map<String, dynamic> row, String id, String type) {
    if (type == 'line') {
      return Padding(
        padding: EdgeInsets.symmetric(vertical: 10),
        child: Row(children: [
          Icon(Icons.horizontal_rule, size: 16, color: DanColors.muted),
          SizedBox(width: 6),
          Text(t('Đường kẻ ngang'),
              style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
        ]),
      );
    }
    if (type == 'qr' || type == 'barcode') {
      final isQr = type == 'qr';
      return Padding(
        padding: EdgeInsets.symmetric(vertical: 2),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(isQr ? Icons.qr_code_2 : Icons.view_week_outlined,
                  size: 16, color: DanColors.muted),
              SizedBox(width: 6),
              Text(isQr ? t('Mã QR') : 'Barcode',
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: DanColors.muted)),
            ]),
            SizedBox(height: 6),
            TextFormField(
              key: ValueKey('${type}_${id}_$_formRevision'),
              initialValue: asText(isQr ? row['qrText'] : row['barcodeText']),
              decoration:
                  InputDecoration(labelText: t('Dữ liệu'), isDense: true),
              onChanged: (v) =>
                  _updateRow(id, (r) => r[isQr ? 'qrText' : 'barcodeText'] = v),
            ),
          ],
        ),
      );
    }
    if (type == 'image') {
      final src = asText(row['src']);
      final hasImage = src.startsWith('data:image/');
      return Padding(
        padding: EdgeInsets.symmetric(vertical: 2),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(Icons.image_outlined, size: 16, color: DanColors.muted),
              SizedBox(width: 6),
              Text(t('Logo / Ảnh'),
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: DanColors.muted)),
            ]),
            SizedBox(height: 8),
            Row(children: [
              if (hasImage)
                Padding(
                  padding: EdgeInsets.only(right: 12),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: Container(
                      color: Colors.white,
                      padding: EdgeInsets.all(2),
                      child: Image.memory(_dataUrlBytes(src),
                          width: 48, height: 48, fit: BoxFit.contain),
                    ),
                  ),
                ),
              OutlinedButton.icon(
                onPressed: () => _pickRowImage(id),
                icon: Icon(Icons.image_search_outlined, size: 18),
                label: Text(hasImage ? t('Đổi ảnh') : t('Chọn ảnh logo')),
              ),
              if (hasImage) ...[
                SizedBox(width: 6),
                TextButton(
                  onPressed: () => _updateRow(id, (r) => r['src'] = ''),
                  child: Text(t('Bỏ ảnh')),
                ),
              ],
            ]),
            if (hasImage) _logoSizeRow(id, _d(row['logoScale'], 1.0)),
            SizedBox(height: 4),
            Text(
              hasImage
                  ? t('Máy in nhiệt in logo dạng chữ [${asText(row['label']).isEmpty ? 'Logo' : asText(row['label'])}]; ảnh dùng để xem/tham chiếu.')
                  : 'Chưa có ảnh — sẽ in dòng chữ [${asText(row['label']).isEmpty ? 'Logo' : asText(row['label'])}].',
              style: TextStyle(
                  fontSize: 10.5, color: DanColors.faint, height: 1.3),
            ),
          ],
        ),
      );
    }
    if (type == 'items') {
      bool on(String k) => row[k] != false && row[k] != '0';
      Widget sw(String k, String label) => Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Switch(
                value: on(k),
                onChanged: (v) => _updateRow(id, (r) => r[k] = v),
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              Text(label, style: TextStyle(fontSize: 12.5)),
            ],
          );
      return Padding(
        padding: EdgeInsets.symmetric(vertical: 2),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(Icons.table_rows_outlined, size: 16, color: DanColors.muted),
              SizedBox(width: 6),
              Text(t('Bảng món'),
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: DanColors.muted)),
            ]),
            SizedBox(height: 2),
            Wrap(spacing: 10, runSpacing: 0, children: [
              sw('showQty', t('Cột SL')),
              sw('showMods', t('Yêu cầu thêm')),
              sw('showNote', t('Ghi chú')),
            ]),
            Text(
              t('Bảng "Tên món | SL" có viền, tự liệt kê mọi món của phiếu.'),
              style: TextStyle(
                  fontSize: 10.5, color: DanColors.faint, height: 1.3),
            ),
          ],
        ),
      );
    }
    // text row
    final align = asText(row['align']).isEmpty ? 'left' : asText(row['align']);
    final bold = _b(row['bold']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _rowCtrls[id],
          focusNode: _rowFocus[id],
          minLines: 1,
          maxLines: 5,
          decoration: InputDecoration(
            isDense: true,
            border: InputBorder.none,
            hintText: t('Nhập chữ hoặc chèn {dữ liệu}…'),
          ),
          style: TextStyle(fontSize: 13.5),
          onChanged: (v) => _updateRow(id, (r) => r['text'] = v),
          onTap: () => _activeRowId = id,
        ),
        Row(children: [
          _alignBtn(Icons.format_align_left, align == 'left',
              () => _updateRow(id, (r) => r['align'] = 'left')),
          _alignBtn(Icons.format_align_center, align == 'center',
              () => _updateRow(id, (r) => r['align'] = 'center')),
          _alignBtn(Icons.format_align_right, align == 'right',
              () => _updateRow(id, (r) => r['align'] = 'right')),
          SizedBox(width: 6),
          _alignBtn(Icons.format_bold, bold,
              () => _updateRow(id, (r) => r['bold'] = !bold)),
          if (_kind != 'bill') ...[
            SizedBox(width: 8),
            _alignBtn(
                Icons.text_decrease,
                false,
                () => _updateRow(
                    id,
                    (r) => r['fontSize'] =
                        (_d(r['fontSize'], 3.2) - .5).clamp(2, 8))),
            Text('${_d(row['fontSize'], 3.2).toStringAsFixed(1)}',
                style: TextStyle(fontSize: 11, color: DanColors.muted)),
            _alignBtn(
                Icons.text_increase,
                false,
                () => _updateRow(
                    id,
                    (r) => r['fontSize'] =
                        (_d(r['fontSize'], 3.2) + .5).clamp(2, 8))),
          ],
        ]),
      ],
    );
  }

  Widget _alignBtn(IconData icon, bool active, VoidCallback onTap) {
    return IconButton(
      onPressed: onTap,
      icon: Icon(icon, size: 17),
      visualDensity: VisualDensity.compact,
      padding: EdgeInsets.zero,
      constraints: BoxConstraints(minWidth: 30, minHeight: 30),
      color: active ? DanColors.brand : DanColors.faint,
      tooltip: '',
    );
  }

  List<Widget> _tokenPalette() {
    final groups = _kind == 'bill'
        ? {
            t('Cửa hàng'): [
              ['{storeName}', t('Tên CH')],
              ['{storeSubtitle}', t('Mô tả')],
              ['{address}', t('Địa chỉ')],
              ['{phone}', t('ĐT')],
              ['{email}', 'Email'],
              ['{taxCode}', 'MST'],
            ],
            t('Đơn hàng'): [
              ['{billNo}', t('Số bill')],
              ['{place}', t('Bàn/Nơi')],
              ['{cashier}', t('Thu ngân')],
              ['{time}', t('Ngày giờ')],
              ['{timeOnly}', t('Giờ')],
              ['{customerName}', t('Khách')],
            ],
            t('Món & tiền'): [
              ['{items}', t('Bảng món')],
              ['{subtotalLine}', t('Thành tiền')],
              ['{vatLine}', 'VAT'],
              ['{grandTotalLine}', t('Tổng cộng')],
              ['{totalWordsLine}', t('Tổng tiền bằng chữ')],
              ['{methodLine}', t('Hình thức thanh toán')],
            ],
            t('Khác'): [
              ['{noteBlock}', t('Ghi chú đơn hàng')],
              ['{solidLine}', t('Đường kẻ liền')],
              ['{thanksC}', t('Lời cảm ơn chuẩn')],
              ['{footer}', t('Lời cảm ơn')],
              ['{invoiceLookupUrl}', t('Link tra cứu')],
            ],
          }
        : _kind == 'kitchen_ticket'
            ? {
                t('Phiếu bếp'): [
                  ['{zone}', t('Khu vực')],
                  ['{table}', t('Bàn')],
                  ['{station}', t('Trạm')],
                  ['{seq}', t('Số TT')],
                  ['{staff}', t('Nhân viên')],
                  ['{time}', t('Giờ')],
                  ['{date}', t('Ngày')],
                  ['{orderNo}', t('Mã đơn')],
                ],
              }
            : {
                t('Tem nhãn'): [
                  ['{itemName}', t('Tên món')],
                  ['{options}', t('Tùy chọn')],
                  ['{note}', t('Ghi chú')],
                  ['{orderNo}', t('Mã đơn')],
                  ['{copy}', t('Bản')],
                  ['{time}', t('Giờ')],
                  ['{table}', t('Bàn')],
                ],
              };
    return [
      for (final entry in groups.entries)
        Padding(
          padding: EdgeInsets.only(bottom: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(entry.key,
                  style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                      color: DanColors.faint)),
              SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final tk in entry.value)
                    Tooltip(
                      message: tk[0],
                      child: OutlinedButton(
                        onPressed: () => _insertToken(tk[0]),
                        style: OutlinedButton.styleFrom(
                          padding:
                              EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          minimumSize: Size(0, 34),
                          visualDensity: VisualDensity.compact,
                        ),
                        child: Text(tk[1], style: TextStyle(fontSize: 12.5)),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
    ];
  }

  // ── Right: live preview pane ──────────────────────────────────────────────

  Widget _previewPane() {
    final widthMm = _d(_template['widthMm'], 80);
    // Receipt-strip width, roughly proportional to the paper (K57→~205,
    // K80→~288, A5→capped) so the mockup feels like the real bill.
    final contentW = (widthMm * 3.6).clamp(200.0, 440.0).toDouble();
    return Container(
      decoration: BoxDecoration(
        color: Color(0xFFEEF3F8),
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        children: [
          Container(
            width: double.infinity,
            padding: EdgeInsets.fromLTRB(12, 10, 12, 8),
            child: Row(
              children: [
                Icon(Icons.receipt_long, size: 15, color: DanColors.muted),
                SizedBox(width: 6),
                Flexible(
                  child: Text(t('Xem trước trực tiếp'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          color: DanColors.muted)),
                ),
                SizedBox(width: 8),
                if (_kind == 'bill') _widthToggle(),
              ],
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(12, 0, 12, 16),
              child: Center(
                child: Container(
                  width: contentW + 34,
                  padding: EdgeInsets.symmetric(horizontal: 17, vertical: 18),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: Color(0x33102840)),
                    boxShadow: [
                      BoxShadow(
                          color: Color(0x22102840),
                          blurRadius: 16,
                          offset: Offset(0, 6)),
                    ],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: _previewWidgets(),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Visual receipt mockup: real logo image, real QR/barcode, item lines and
  /// Vietnamese diacritics preserved (unlike the raw thermal ASCII printout).
  List<Widget> _previewWidgets() {
    final vars = _kind == 'bill'
        ? _billSample
        : _kind == 'kitchen_ticket'
            ? _kitchenSample
            : _labelSample;
    final widgets = <Widget>[];
    for (final row in _rows) {
      final type = asText(row['type']);
      if (type == 'items') {
        for (final ln in _kitchenItemsSample(row).split('\n')) {
          widgets.add(_pvText(ln, 'left', false, monospace: true));
        }
        continue;
      }
      if (type == 'line') {
        widgets.add(Padding(
          padding: EdgeInsets.symmetric(vertical: 5),
          child: _DashedLine(),
        ));
        continue;
      }
      if (type == 'image') {
        final src = asText(row['src']);
        final scale = _d(row['logoScale'], 1.0).clamp(0.5, 2.0);
        widgets.add(Padding(
          padding: EdgeInsets.symmetric(vertical: 6),
          child: Center(
            child: src.startsWith('data:image/')
                ? Image.memory(_dataUrlBytes(src),
                    height: (56 * scale).toDouble(), fit: BoxFit.contain)
                : _pvLogoPlaceholder(asText(row['label'])),
          ),
        ));
        continue;
      }
      if (type == 'qr') {
        final data = _replaceVars(
            asText(row['qrText']).isEmpty ? '{billNo}' : asText(row['qrText']),
            vars);
        widgets.add(Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                QrImageView(
                  data: data.isEmpty ? ' ' : data,
                  version: QrVersions.auto,
                  size: 98,
                  padding: EdgeInsets.zero,
                  backgroundColor: Colors.white,
                ),
                if (_b(row['qrShowCaption']) &&
                    asText(row['qrCaption']).isNotEmpty)
                  Padding(
                    padding: EdgeInsets.only(top: 4),
                    child: _pvText(_replaceVars(asText(row['qrCaption']), vars),
                        'center', false),
                  ),
              ],
            ),
          ),
        ));
        continue;
      }
      if (type == 'barcode') {
        final data = _replaceVars(
            asText(row['barcodeText']).isEmpty
                ? '{billNo}'
                : asText(row['barcodeText']),
            vars);
        widgets.add(Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: SizedBox(
            height: 46,
            child: BarcodeWidget(
              barcode: Barcode.code128(),
              data: data.isEmpty ? 'DAN-D-PAK' : data,
              drawText: false,
              color: Colors.black87,
              errorBuilder: (context, error) => SizedBox.shrink(),
            ),
          ),
        ));
        continue;
      }
      // text row — keep diacritics, apply per-row align + bold
      final text = _replaceVars(asText(row['text']), vars);
      final align =
          asText(row['align']).isEmpty ? 'left' : asText(row['align']);
      final bold = _b(row['bold']);
      final moneyColumns = asText(row['text']).contains('{items}') ||
          asText(row['text']).contains('{subtotalLine}') ||
          asText(row['text']).contains('{vatLine}') ||
          asText(row['text']).contains('{grandTotalLine}') ||
          asText(row['text']).contains('{totalWordsLine}') ||
          asText(row['text']).contains('{methodLine}') ||
          asText(row['text']).contains('{totalLine}');
      for (final paragraph in text.split('\n')) {
        if (paragraph.trim().isEmpty) continue;
        widgets.add(_pvText(paragraph, align, bold, monospace: moneyColumns));
      }
    }
    if (widgets.isEmpty)
      widgets.add(_pvText(t('(mẫu trống)'), 'center', false));
    return widgets;
  }

  Widget _pvText(String s, String align, bool bold, {bool monospace = false}) {
    final ta = switch (align) {
      'center' => TextAlign.center,
      'right' => TextAlign.right,
      _ => TextAlign.left,
    };
    final text = Text(
      s,
      maxLines: monospace ? 1 : null,
      softWrap: !monospace,
      overflow: monospace ? TextOverflow.visible : TextOverflow.clip,
      textAlign: ta,
      style: TextStyle(
        fontFamily: monospace ? 'JetBrains Mono' : 'Be Vietnam Pro',
        fontSize: 12.5,
        height: 1.36,
        color: _inkColor(bold),
        fontWeight: bold ? FontWeight.w800 : FontWeight.w500,
      ),
    );
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 1.5),
      child: monospace
          ? FittedBox(
              fit: BoxFit.scaleDown,
              alignment: align == 'right'
                  ? Alignment.centerRight
                  : align == 'center'
                      ? Alignment.center
                      : Alignment.centerLeft,
              child: text,
            )
          : text,
    );
  }

  Widget _pvLogoPlaceholder(String label) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 18, vertical: 12),
      decoration: BoxDecoration(
        border: Border.all(color: Color(0x55102840)),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label.isEmpty ? 'Logo' : label,
        style: TextStyle(
            fontSize: 12, color: DanColors.muted, fontWeight: FontWeight.w700),
      ),
    );
  }

  String _replaceVars(String text, Map<String, String> vars) {
    return text.replaceAllMapped(
      RegExp(r'\{([a-zA-Z0-9_]+)\}'),
      (m) => vars[m.group(1)] ?? '',
    );
  }

  int get _sampleWidth => _d(_template['widthMm'], 80) < 70 ? 32 : 40;

  String _sampleMoneyLine(String label, String amount) {
    final room = (_sampleWidth - amount.length).clamp(0, _sampleWidth);
    final clipped =
        label.substring(0, label.length < room ? label.length : room);
    return '${clipped.padRight(room)}$amount';
  }

  int _visibleLength(String value) => value.replaceAll('\u0336', '').length;

  String _fitPreview(String value, int width, {bool right = false}) {
    final spaces = ' ' * (width - _visibleLength(value)).clamp(0, width);
    return right ? '$spaces$value' : '$value$spaces';
  }

  String _sampleNumericRow(String price, Object qty, String amount) {
    final priceWidth = (_sampleWidth * .42).floor();
    final qtyWidth = (_sampleWidth * .18).floor().clamp(3, _sampleWidth);
    final amountWidth = _sampleWidth - priceWidth - qtyWidth;
    return _fitPreview(price, priceWidth) +
        _fitPreview(qty.toString(), qtyWidth, right: true) +
        _fitPreview(amount, amountWidth, right: true);
  }

  String _samplePromoNumericRow(
      String before, String after, Object qty, String amount) {
    final beforeWidth = (_sampleWidth * .24).floor();
    final afterWidth = (_sampleWidth * .22).floor();
    final qtyWidth = (_sampleWidth * .14).floor().clamp(3, _sampleWidth);
    final amountWidth = _sampleWidth - beforeWidth - afterWidth - qtyWidth;
    return _fitPreview(before, beforeWidth) +
        _fitPreview(after, afterWidth) +
        _fitPreview(qty.toString(), qtyWidth, right: true) +
        _fitPreview(amount, amountWidth, right: true);
  }

  String get _sampleItems {
    final divider = '-' * _sampleWidth;
    return [
      _sampleNumericRow(t('Đơn giá'), t('SL'), t('T.Tiền')),
      divider,
      t('Trà đào (ly)'),
      _sampleNumericRow('30,000', 2, '60,000'),
      '',
      t('Bánh cookie'),
      t('CTKM: Giảm giá sản phẩm'),
      _samplePromoNumericRow('2̶3̶,̶3̶3̶3̶', '20,000', 1, '20,000'),
      divider,
    ].join('\n');
  }

  Map<String, String> get _billSample => {
        'storeName': asText(_bill['storeName']).isEmpty
            ? 'Dan D Pak'
            : asText(_bill['storeName']),
        'storeNameC': asText(_bill['storeName']).isEmpty
            ? 'Dan D Pak'
            : asText(_bill['storeName']),
        'storeSubtitle': asText(_bill['storeSubtitle']),
        'storeSubtitleC': asText(_bill['storeSubtitle']),
        'address': asText(_bill['address']).isEmpty
            ? t('Đường D9, KĐT Sala, TP.HCM')
            : asText(_bill['address']),
        'addressBlock': asText(_bill['address']).isEmpty
            ? t('Đường D9, KĐT Sala, TP.HCM')
            : asText(_bill['address']),
        'phone': asText(_bill['phone']).isEmpty
            ? '0938 525 659'
            : asText(_bill['phone']),
        'email': asText(_bill['email']),
        'taxCode': asText(_bill['taxCode']),
        'billNo': 'Dan0107260001',
        'number': 'Dan0107260001',
        'place': t('Bàn A01'),
        'cashier': t('Thu ngân'),
        'date': '01/07/2026',
        'timeOnly': '19:28',
        'time': '01/07/2026 19:28',
        'items': _sampleItems,
        'subtotalLine': _sampleMoneyLine(t('Tổng tiền hàng:'), '83,333'),
        'vatLine': _sampleMoneyLine(t('VAT (8%):'), '6,667'),
        'grandTotalLine': _sampleMoneyLine(t('Tổng thanh toán:'), '90,000'),
        'totalWordsLine': t('Bằng chữ: Chín mươi nghìn đồng'),
        'methodLine':
            _sampleMoneyLine(t('Hình thức thanh toán:'), t('Tiền mặt')),
        'total': t('90,000'),
        'grandTotal': t('90,000'),
        'totalLine': _sampleMoneyLine(t('Tổng thanh toán:'), '90,000'),
        'paymentLines': t('Tiền mặt: 100.000đ'),
        'paidLine': t('Đã trả: 100.000đ'),
        'changeLine': t('Tiền thối: 10.000đ'),
        'noteBlock': '${t('Ghi chú')}: ABC123456XYZ\n\n\n',
        'solidLine': List.filled(_sampleWidth, '_').join(),
        'thanksC': t('Dan-D Pak Xin Cảm Ơn!'),
        'method': t('Tiền mặt'),
        'footer': asText(_bill['footer']).isEmpty
            ? t('Xin cảm ơn và hẹn gặp lại')
            : asText(_bill['footer']),
        'footerC': asText(_bill['footer']),
        'invoiceLookupUrl': 'https://tracuu.dandpak.vn/Dan0107260001',
        'customerName': t('Khách lẻ'),
      };

  Map<String, String> get _kitchenSample => {
        'zone': t('TẦNG TRỆT'),
        'table': 'A04',
        'station': t('BẾP'),
        'time': '10:15',
        'date': '12/8/2026',
        'staff': t('Nguyễn Phúc Huy'),
        'seq': '69c',
        'orderNo': 'Dan1208260069',
        'copy': '1/1',
      };

  // Bản xem trước BẢNG MÓN — dựng đúng như kitchenTableLines ở server để "setting"
  // khớp "bản in". Danh sách món là mẫu cố định cho dễ hình dung.
  String _kitchenItemsSample(Map row) {
    final showQty = row['showQty'] != false && row['showQty'] != '0';
    final showMods = row['showMods'] != false && row['showMods'] != '0';
    final showNote = row['showNote'] != false && row['showNote'] != '0';
    final width = _sampleWidth;
    const slW = 3;
    final nameW = (showQty ? width - slW - 3 : width - 2).clamp(8, 60);
    String bar() =>
        showQty ? '+${'-' * nameW}+${'-' * slW}+' : '+${'-' * nameW}+';
    String cell(String name, String sl) {
      final nm =
          name.length > nameW ? name.substring(0, nameW) : name.padRight(nameW);
      if (!showQty) return '|$nm|';
      final s = sl.length > slW ? sl.substring(0, slW) : sl.padLeft(slW);
      return '|$nm|$s|';
    }

    final sample = [
      {
        'name': t('Trà đào cam sả'),
        'qty': '2',
        'mods': t('Ít đá, 50% đường'),
        'note': t('không ống hút'),
      },
      {'name': t('Mì Bò Kho Việt Nam'), 'qty': '1', 'mods': '', 'note': ''},
    ];
    final lines = <String>[bar(), cell('Tên món', showQty ? 'SL' : ''), bar()];
    for (final it in sample) {
      lines.add(cell(' ${it['name']}', showQty ? (it['qty'] ?? '') : ''));
      if (showMods && (it['mods'] ?? '').isNotEmpty)
        lines.add(cell('   + ${it['mods']}', ''));
      if (showNote && (it['note'] ?? '').isNotEmpty)
        lines.add(cell('   Ghi chú: ${it['note']}', ''));
      lines.add(bar());
    }
    return lines.join('\n');
  }

  Map<String, String> get _labelSample => {
        'orderNo': 'A01-023',
        'billNo': 'A01-023',
        'table': 'A01',
        'channel': t('Mang đi'),
        'customer': t('Khách lẻ'),
        'phone': '0938 525 659',
        'time': '19:28',
        'itemName': t('Trà đào cam sả'),
        'name': t('Trà đào cam sả'),
        'options': t('Ít đá · 50% đường'),
        'note': t('Không ống hút'),
        'qty': '1',
        'copy': '1/2',
      };

  // ── Token list dialog ─────────────────────────────────────────────────────

  void _showTokenList() {
    final groups = _kind == 'bill'
        ? {
            t('Cửa hàng'):
                '{storeName} {storeSubtitle} {address} {phone} {email} {taxCode}',
            t('Đơn hàng'):
                '{billNo} {place} {cashier} {time} {timeOnly} {customerName}',
            t('Món & tiền'):
                '{items} {subtotalLine} {vatLine} {grandTotalLine} {totalWordsLine} {methodLine} {grandTotal}',
            t('Khác'):
                '{noteBlock} {solidLine} {thanksC} {footer} {invoiceLookupUrl}',
          }
        : {
            t('Tem nhãn'):
                '{itemName} {options} {note} {orderNo} {copy} {time} {table} {qty}',
          };
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t('Danh sách dữ liệu (token)')),
        content: SizedBox(
          width: dialogWidth(context, 420),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                    t('Gõ token vào nội dung; khi in sẽ thay bằng dữ liệu thật. VD {items} = danh sách món.'),
                    style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
                SizedBox(height: 12),
                for (final e in groups.entries) ...[
                  Text(e.key, style: TextStyle(fontWeight: FontWeight.w800)),
                  SizedBox(height: 4),
                  Text(e.value,
                      style: TextStyle(
                          fontFamily: 'JetBrains Mono',
                          fontSize: 12.5,
                          height: 1.5)),
                  SizedBox(height: 12),
                ],
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(), child: Text(t('Đóng'))),
        ],
      ),
    );
  }

  // ── Khổ giấy nhanh + màu nhấn ─────────────────────────────────────────────

  /// Nút gạt 58mm/80mm nổi bật ngay trên preview — đổi tức thì để xem bill dạng
  /// hẹp (58mm · 32 ký tự) hay rộng (80mm · 40 ký tự). Tái dùng _applyPaper.
  Widget _widthToggle() {
    final is58 = _d(_template['widthMm'], 80) <= 58;
    return Container(
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: DanColors.border),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        _segCell('58mm', is58, () => _applyPaper('K57')),
        _segCell('80mm', !is58, () => _applyPaper('K80')),
      ]),
    );
  }

  Widget _segCell(String label, bool active, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 11, vertical: 5),
        decoration: BoxDecoration(
          color: active ? DanColors.brand : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(label,
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w800,
                color: active ? Colors.white : DanColors.muted)),
      ),
    );
  }

  // Độ đậm bản in (sắc tố đen) — máy in nhiệt điều chỉnh được độ đậm/nhạt của
  // mực. Mỗi mức = một sắc độ đen; dòng ĐẬM luôn đậm hơn nền một bậc.
  static const _densities = <List<Object>>[
    ['light', 'Nhạt', 0xFF6B7280],
    ['medium', 'Vừa', 0xFF3A4250],
    ['dark', 'Đậm', 0xFF1A1F27],
    ['max', 'Rất đậm', 0xFF000000],
  ];

  String get _densityKey {
    final k = asText(_bill['printDensity']);
    return _densities.any((d) => d[0] == k) ? k : 'dark';
  }

  /// Sắc độ mực cho preview theo độ đậm đã chọn; chữ đậm xuống thêm 1 bậc.
  Color _inkColor(bool bold) {
    final idx = _densities.indexWhere((d) => d[0] == _densityKey);
    final use = bold ? (idx + 1).clamp(0, _densities.length - 1) : idx;
    return Color(_densities[use.clamp(0, _densities.length - 1)][2] as int);
  }

  Widget _densityPicker() {
    return Padding(
      padding: EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t('Độ đậm bản in (sắc tố đen)'),
              style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
          SizedBox(height: 2),
          Text(t('Chỉnh độ đậm/nhạt mực khi in. Bản in càng đậm càng rõ nhưng tốn giấy nhiệt & mòn đầu in hơn.'),
              style: TextStyle(
                  fontSize: 10.5, color: DanColors.faint, height: 1.3)),
          SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final d in _densities)
                InkWell(
                  onTap: () => _setBillField('printDensity', d[0] as String),
                  borderRadius: BorderRadius.circular(8),
                  child: Container(
                    padding: EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                    decoration: BoxDecoration(
                      color: DanColors.surface,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                          color: _densityKey == d[0]
                              ? DanColors.brand
                              : DanColors.border,
                          width: _densityKey == d[0] ? 2 : 1),
                    ),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Container(
                        width: 16,
                        height: 16,
                        decoration: BoxDecoration(
                          color: Color(d[2] as int),
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                      SizedBox(width: 6),
                      Text(t(d[1] as String),
                          style: TextStyle(
                              fontSize: 12,
                              fontWeight: _densityKey == d[0]
                                  ? FontWeight.w800
                                  : FontWeight.w600,
                              color: _densityKey == d[0]
                                  ? DanColors.brand
                                  : DanColors.muted)),
                    ]),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  // CỠ CHỮ TOÀN PHIẾU. Máy in nhiệt chỉ phóng to theo bội số nguyên, và phóng
  // BỀ NGANG thì số cột giảm một nửa (K80 từ 48 xuống 24 ký tự) — bố cục cột
  // tiền vỡ hết. Nên các mức dưới đây chỉ nhân BỀ CAO: chữ cao lên rõ rệt mà
  // vẫn đúng 48 (hoặc 32) ký tự mỗi dòng. Mức "2x cả hai chiều" có cảnh báo vì
  // nó thật sự làm mất một nửa số cột.
  static const _fontScales = <List<Object>>[
    [0, 'Chuẩn'],
    [1, 'To (2x cao)'],
    [2, 'Rất to (3x cao)'],
    [3, 'Cực to (2x cả hai chiều)'],
  ];

  int get _fontScaleKey {
    final raw = _bill['fontScale'];
    final v = raw is int ? raw : int.tryParse(asText(raw));
    // Mặc định "Chuẩn" — khớp với fontScaleFor() ở server. Mức "To" từng là mặc
    // định nhưng in ra giấy thật thì chữ quá khổ, cửa hàng yêu cầu hạ về.
    return v == null ? 0 : v.clamp(0, 3);
  }

  Widget _fontScalePicker() {
    return Padding(
      padding: EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t('Cỡ chữ bản in'),
              style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
          SizedBox(height: 2),
          Text(t('Chữ to hơn dễ đọc và tốn thêm giấy. Ba mức đầu giữ nguyên số cột nên bố cục bill không đổi; mức cuối làm số cột giảm một nửa.'),
              style: TextStyle(
                  fontSize: 10.5, color: DanColors.faint, height: 1.3)),
          SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final f in _fontScales)
                _segCell(t(f[1] as String), _fontScaleKey == f[0],
                    () => _setBillField('fontScale', '${f[0]}')),
            ],
          ),
        ],
      ),
    );
  }

  /// Chọn cỡ logo cho dòng ảnh (Nhỏ/Vừa/Lớn → hệ số 0.7/1.0/1.4). Preview áp
  /// tức thì; máy in dùng hệ số này cho bitmap logo thật.
  Widget _logoSizeRow(String id, double scale) {
    Widget cell(String label, double s) {
      final active = (scale - s).abs() < 0.05;
      return _segCell(
          label, active, () => _updateRow(id, (r) => r['logoScale'] = s));
    }

    return Padding(
      padding: EdgeInsets.only(top: 8),
      child: Row(children: [
        Text(t('Cỡ logo:'),
            style: TextStyle(fontSize: 12, color: DanColors.muted)),
        SizedBox(width: 8),
        Container(
          decoration: BoxDecoration(
            color: DanColors.surface2,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: DanColors.border),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            cell(t('Nhỏ'), 0.7),
            cell(t('Vừa'), 1.0),
            cell(t('Lớn'), 1.4),
          ]),
        ),
      ]),
    );
  }

  // ── Shared small field ────────────────────────────────────────────────────

  Widget _numberField(
      String label, double value, ValueChanged<double> onSubmit) {
    final text = value == value.roundToDouble()
        ? '${value.round()}'
        : value.toStringAsFixed(1);
    return TextFormField(
      key: ValueKey('$label${text}_${_kind}_$_formRevision'),
      initialValue: text,
      keyboardType: TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(
          labelText: label, isDense: true, border: OutlineInputBorder()),
      onFieldSubmitted: (v) =>
          onSubmit(double.tryParse(v.replaceAll(',', '.')) ?? value),
    );
  }
}
