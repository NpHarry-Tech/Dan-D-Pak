import 'dart:async';
import 'dart:convert';

import 'package:barcode_widget/barcode_widget.dart';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/file_pick.dart';
import '../../utils/translation.dart';

String _s(dynamic v) => v?.toString() ?? '';

double _d(dynamic v, [double fallback = 0]) {
  if (v is num) return v.toDouble();
  return double.tryParse(_s(v).replaceAll(',', '.')) ?? fallback;
}

bool _b(dynamic v) => v == true || _s(v) == '1' || _s(v) == 'true';

/// KiotViet-style print-template editor: a two-pane layout where the LEFT pane
/// edits the receipt/label content line-by-line (with insertable {token}s and a
/// store-info form) and the RIGHT pane shows a LIVE monospace preview that is
/// faithful to the actual K80 thermal printout (the server renders the same
/// {tokens} → 40-column ASCII, so what you see is what prints).
class PrintTemplateDesigner extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic> initialConfig;
  final ValueChanged<Map<String, dynamic>>? onSaved;

  PrintTemplateDesigner({
    super.key,
    required this.api,
    required this.initialConfig,
    this.onSaved,
  });

  @override
  State<PrintTemplateDesigner> createState() => _PrintTemplateDesignerState();
}

class _PrintTemplateDesignerState extends State<PrintTemplateDesigner> {
  final _saveDebounce = _Debouncer(Duration(milliseconds: 700));

  late Map<String, dynamic> _printConfig;
  late Map<String, dynamic> _bill;
  late Map<String, dynamic> _labels;
  Map<String, dynamic> _template = {};
  String _kind = 'bill';

  // One controller + focus node per content row (needed for cursor-position
  // token insertion and for a live-updating preview).
  final Map<String, TextEditingController> _rowCtrls = {};
  final Map<String, FocusNode> _rowFocus = {};
  String? _activeRowId; // last-focused row → target for "insert token"

  final TextEditingController _nameCtrl = TextEditingController();
  int _formRevision = 0; // bumps to rebuild store-info fields after a reset

  bool _saving = false;
  String _saveState = '';
  // The parent echoes our saved config back via initialConfig; skip re-hydrating
  // on that echo so we don't dispose row controllers while the user is typing.
  bool _ignoreNextConfigUpdate = false;

  @override
  void initState() {
    super.initState();
    _hydrate(widget.initialConfig);
  }

  @override
  void didUpdateWidget(covariant PrintTemplateDesigner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialConfig != widget.initialConfig) {
      if (_ignoreNextConfigUpdate) {
        // Our own save echo — keep the reference in sync but don't rebuild.
        _ignoreNextConfigUpdate = false;
        _printConfig = _copyMap(widget.initialConfig);
        return;
      }
      _hydrate(widget.initialConfig); // genuine external reload (e.g. Refresh)
    }
  }

  @override
  void dispose() {
    _saveDebounce.dispose();
    _disposeRowControllers();
    _nameCtrl.dispose();
    super.dispose();
  }

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
    _nameCtrl.text = _s(_template['name']);
    _syncRowControllers();
  }

  Map<String, dynamic> _templateFor(String kind) {
    final templates = _copyMap(_printConfig['templates']);
    var tpl = _copyMap(templates[kind]);
    if (tpl.isEmpty) tpl = kind == 'bill' ? _defaultBill() : _defaultLabel();
    _ensureRows(tpl, kind);
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
    tpl['rows'] = (kind == 'bill' ? _defaultBill() : _defaultLabel())['rows'];
  }

  /// Strip positioning, keep only what a flowing row needs.
  Map<String, dynamic> _normalizeRow(Map raw) {
    final e = Map<String, dynamic>.from(raw);
    final type = _s(e['type']).isEmpty ? 'text' : _s(e['type']);
    final id = _s(e['id']).isEmpty ? '${type}_${_rowSeq++}' : _s(e['id']);
    switch (type) {
      case 'line':
        return {'id': id, 'type': 'line'};
      case 'qr':
        return {
          'id': id,
          'type': 'qr',
          'qrText':
              _s(e['qrText']).isEmpty ? '{invoiceLookupUrl}' : _s(e['qrText']),
          'qrCaption': _s(e['qrCaption']),
          'qrShowCaption': _b(e['qrShowCaption']),
        };
      case 'barcode':
        return {
          'id': id,
          'type': 'barcode',
          'barcodeText':
              _s(e['barcodeText']).isEmpty ? '{billNo}' : _s(e['barcodeText']),
        };
      case 'image':
        return {
          'id': id,
          'type': 'image',
          'label': _s(e['label']).isEmpty ? 'Logo' : _s(e['label']),
          'src': _s(e['src']),
        };
      default:
        return {
          'id': id,
          'type': 'text',
          'text': _s(e['text']),
          'align': _s(e['align']).isEmpty ? 'left' : _s(e['align']),
          'bold': _b(e['bold']),
          'fontSize': _d(e['fontSize'], 3.2),
        };
    }
  }

  int _rowSeq = 0;

  Map<String, dynamic> _defaultBill() {
    final width = _d(_bill['widthMm'], 72).clamp(48, 120).toDouble();
    final height = _d(_bill['heightMm'], 320).clamp(120, 520).toDouble();
    return {
      'kind': 'bill',
      'version': 6,
      'standard': 'dan_payment_receipt',
      'name': t('Mẫu hóa đơn chuẩn'),
      'paper': _s(_bill['paper']).isEmpty ? 'K80' : _s(_bill['paper']),
      'widthMm': width,
      'heightMm': height,
      'rows': [
        _tRow(t('{storeName}\n{address}\nĐT: {phone}'),
            align: 'center', bold: true),
        _lineRow(),
        _tRow(t('HÓA ĐƠN THANH TOÁN'), align: 'center', bold: true),
        _tRow(
            t('Số bill: {billNo}\n{place}\nThu ngân: {cashier}\nNgày: {time}')),
        _lineRow(),
        _tRow('{items}'),
        _lineRow(),
        _tRow(
            '{subtotalLine}\n{vatLine}\n{orderPromoLine}\n{grandTotalLine}\n{paymentLines}\n{paidLine}\n{changeLine}'),
        _tRow('{footer}', align: 'center'),
        _qrRow('{invoiceLookupUrl}'),
      ],
    };
  }

  Map<String, dynamic> _defaultLabel() {
    final width = _d(_labels['widthMm'], 50).clamp(20, 120).toDouble();
    final height = _d(_labels['heightMm'], 30).clamp(10, 100).toDouble();
    return {
      'kind': 'label',
      'version': 1,
      'standard': 'dan_label_template',
      'name': t('Mẫu tem chuẩn'),
      'widthMm': width,
      'heightMm': height,
      'rows': [
        _tRow('{itemName}', align: 'center', bold: true),
        _tRow('{options}', align: 'center'),
        _tRow('{note}', align: 'center'),
        _tRow('#{orderNo} {copy}'),
        _qrRow('{orderNo}'),
      ],
    };
  }

  Map<String, dynamic> _tRow(String text,
          {String align = 'left', bool bold = false}) =>
      {
        'id': 'text_${_rowSeq++}',
        'type': 'text',
        'text': text,
        'align': align,
        'bold': bold,
        'fontSize': 3.2,
      };

  Map<String, dynamic> _lineRow() =>
      {'id': 'line_${_rowSeq++}', 'type': 'line'};

  Map<String, dynamic> _qrRow(String data) => {
        'id': 'qr_${_rowSeq++}',
        'type': 'qr',
        'qrText': data,
        'qrCaption': '',
        'qrShowCaption': false,
      };

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
    setState(() => _template['rows'] = rows);
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
      if (_s(row['type']) != 'text') continue;
      final id = _s(row['id']);
      final ctrl = TextEditingController(text: _s(row['text']));
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
    setState(() {
      _kind = kind;
      _activeRowId = null;
      _loadKind(kind);
    });
  }

  void _updateRow(String id, void Function(Map<String, dynamic>) fn) {
    final rows = _rows;
    for (final r in rows) {
      if (_s(r['id']) == id) fn(r);
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
    _setRows(_rows.where((r) => _s(r['id']) != id).toList());
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
      'items' => {
          'id': id,
          'type': 'text',
          'text': '{items}',
          'align': 'left',
          'bold': false,
          'fontSize': 3.2,
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
    if (_s(row['type']) == 'text') {
      final ctrl = TextEditingController(text: _s(row['text']));
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
    setState(() {
      _template = _kind == 'bill' ? _defaultBill() : _defaultLabel();
      _nameCtrl.text = _s(_template['name']);
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
    setState(() {
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
    setState(() {
      _template[key] = value;
      if (key == 'widthMm' || key == 'heightMm') _media[key] = value;
    });
    _scheduleSave();
  }

  void _setMediaValue(String key, dynamic value) {
    setState(() {
      _media[key] = value;
      _template[key] = value;
    });
    _scheduleSave();
  }

  void _setBillField(String key, String value) {
    setState(() => _bill[key] = value);
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
    setState(() => _saveState = t('Đang chờ lưu'));
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
    setState(() {
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
      setState(() {
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
      setState(() {
        _saving = false;
        _saveState = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.lg),
        boxShadow: [
          BoxShadow(
              color: Color(0x0A102840), blurRadius: 2, offset: Offset(0, 1)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _topBar(),
          SizedBox(height: 10),
          Divider(height: 1, color: DanColors.border),
          SizedBox(height: 12),
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) {
                if (constraints.maxWidth < 900) {
                  return Column(
                    children: [
                      Expanded(flex: 3, child: _previewPane()),
                      SizedBox(height: 12),
                      Expanded(flex: 4, child: _editorPane()),
                    ],
                  );
                }
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(flex: 5, child: _editorPane()),
                    SizedBox(width: 12),
                    SizedBox(width: 360, child: _previewPane()),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
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
              _modeButton('label', t('Tem nhãn'), Icons.label_outline),
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
        _s(_template['paper']).isEmpty ? '—' : _s(_template['paper']);
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
      if (_kind == 'label') ...[
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
          initialValue: _s(_bill[key]),
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
    ];
  }

  List<Widget> _rowsEditor() {
    final rows = _rows;
    return [
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
              _rowTile(rows[i], i, key: ValueKey(_s(rows[i]['id']))),
          ],
        ),
      SizedBox(height: 8),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          _addBtn(Icons.text_fields, t('Dòng chữ'), () => _addRow('text')),
          _addBtn(Icons.horizontal_rule, t('Đường kẻ'), () => _addRow('line')),
          _addBtn(
              Icons.table_rows_outlined, t('Bảng món'), () => _addRow('items')),
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

  Widget _rowTile(Map<String, dynamic> row, int index, {required Key key}) {
    final id = _s(row['id']);
    final type = _s(row['type']);
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
              initialValue: _s(isQr ? row['qrText'] : row['barcodeText']),
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
      final src = _s(row['src']);
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
            SizedBox(height: 4),
            Text(
              hasImage
                  ? t('Máy in nhiệt in logo dạng chữ [${_s(row['label']).isEmpty ? 'Logo' : _s(row['label'])}]; ảnh dùng để xem/tham chiếu.')
                  : 'Chưa có ảnh — sẽ in dòng chữ [${_s(row['label']).isEmpty ? 'Logo' : _s(row['label'])}].',
              style: TextStyle(
                  fontSize: 10.5, color: DanColors.faint, height: 1.3),
            ),
          ],
        ),
      );
    }
    // text row
    final align = _s(row['align']).isEmpty ? 'left' : _s(row['align']);
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
              ['{orderPromoLine}', t('KM toàn bill')],
              ['{grandTotalLine}', t('Tổng cộng')],
              ['{totalLine}', t('Tổng')],
              ['{paymentLines}', t('Thanh toán')],
              ['{paidLine}', t('Đã trả')],
              ['{changeLine}', t('Tiền thối')],
            ],
            t('Khác'): [
              ['{footer}', t('Lời cảm ơn')],
              ['{invoiceLookupUrl}', t('Link tra cứu')],
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
                  child: Text(t('Xem trước (minh họa)'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          color: DanColors.muted)),
                ),
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
    final vars = _kind == 'bill' ? _billSample : _labelSample;
    final widgets = <Widget>[];
    for (final row in _rows) {
      final type = _s(row['type']);
      if (type == 'line') {
        widgets.add(Padding(
          padding: EdgeInsets.symmetric(vertical: 5),
          child: _DashedLine(),
        ));
        continue;
      }
      if (type == 'image') {
        final src = _s(row['src']);
        widgets.add(Padding(
          padding: EdgeInsets.symmetric(vertical: 6),
          child: Center(
            child: src.startsWith('data:image/')
                ? Image.memory(_dataUrlBytes(src),
                    height: 56, fit: BoxFit.contain)
                : _pvLogoPlaceholder(_s(row['label'])),
          ),
        ));
        continue;
      }
      if (type == 'qr') {
        final data = _replaceVars(
            _s(row['qrText']).isEmpty ? '{billNo}' : _s(row['qrText']), vars);
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
                if (_b(row['qrShowCaption']) && _s(row['qrCaption']).isNotEmpty)
                  Padding(
                    padding: EdgeInsets.only(top: 4),
                    child: _pvText(_replaceVars(_s(row['qrCaption']), vars),
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
            _s(row['barcodeText']).isEmpty
                ? '{billNo}'
                : _s(row['barcodeText']),
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
      final text = _replaceVars(_s(row['text']), vars);
      final align = _s(row['align']).isEmpty ? 'left' : _s(row['align']);
      final bold = _b(row['bold']);
      for (final paragraph in text.split('\n')) {
        if (paragraph.trim().isEmpty) continue;
        widgets.add(_pvText(paragraph, align, bold));
      }
    }
    if (widgets.isEmpty)
      widgets.add(_pvText(t('(mẫu trống)'), 'center', false));
    return widgets;
  }

  Widget _pvText(String s, String align, bool bold) {
    final ta = switch (align) {
      'center' => TextAlign.center,
      'right' => TextAlign.right,
      _ => TextAlign.left,
    };
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 1.5),
      child: Text(
        s,
        textAlign: ta,
        style: TextStyle(
          fontFamily: 'Be Vietnam Pro',
          fontSize: 12.5,
          height: 1.36,
          color: Colors.black87,
          fontWeight: bold ? FontWeight.w800 : FontWeight.w500,
        ),
      ),
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

  Map<String, String> get _billSample => {
        'storeName': _s(_bill['storeName']).isEmpty
            ? 'Dan D Pak'
            : _s(_bill['storeName']),
        'storeNameC': _s(_bill['storeName']).isEmpty
            ? 'Dan D Pak'
            : _s(_bill['storeName']),
        'storeSubtitle': _s(_bill['storeSubtitle']),
        'storeSubtitleC': _s(_bill['storeSubtitle']),
        'address': _s(_bill['address']).isEmpty
            ? t('Đường D9, KĐT Sala, TP.HCM')
            : _s(_bill['address']),
        'addressBlock': _s(_bill['address']).isEmpty
            ? t('Đường D9, KĐT Sala, TP.HCM')
            : _s(_bill['address']),
        'phone':
            _s(_bill['phone']).isEmpty ? '0938 525 659' : _s(_bill['phone']),
        'email': _s(_bill['email']),
        'taxCode': _s(_bill['taxCode']),
        'billNo': 'Dan0107260001',
        'number': 'Dan0107260001',
        'place': t('Bàn A01'),
        'cashier': t('Thu ngân'),
        'date': '01/07/2026',
        'timeOnly': '19:28',
        'time': '01/07/2026 19:28',
        'items': t('2x Trà đào 60.000đ\n1x Bánh cookie 30.000đ'),
        'total': t('90.000đ'),
        'grandTotal': t('90.000đ'),
        'totalLine': t('TỔNG: 90.000đ'),
        'paymentLines': t('Tiền mặt: 100.000đ'),
        'paidLine': t('Đã trả: 100.000đ'),
        'changeLine': t('Tiền thối: 10.000đ'),
        'method': t('Tiền mặt'),
        'footer': _s(_bill['footer']).isEmpty
            ? t('Xin cảm ơn và hẹn gặp lại')
            : _s(_bill['footer']),
        'footerC': _s(_bill['footer']),
        'invoiceLookupUrl': 'https://tracuu.dandpak.vn/Dan0107260001',
        'customerName': t('Khách lẻ'),
      };

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
                '{items} {subtotalLine} {vatLine} {orderPromoLine} {grandTotalLine} {totalLine} {paymentLines} {paidLine} {changeLine} {grandTotal}',
            t('Khác'): '{footer} {invoiceLookupUrl}',
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

/// A thin dashed divider used in the receipt preview (like a real bill).
class _DashedLine extends StatelessWidget {
  _DashedLine();
  @override
  Widget build(BuildContext context) => SizedBox(
        height: 1,
        width: double.infinity,
        child: CustomPaint(painter: _DashedPainter()),
      );
}

class _DashedPainter extends CustomPainter {
  _DashedPainter();
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Color(0x66102840)
      ..strokeWidth = 1;
    final dash = 4.0, gap = 3.0;
    double x = 0;
    while (x < size.width) {
      canvas.drawLine(Offset(x, 0), Offset(x + dash, 0), paint);
      x += dash + gap;
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _Debouncer {
  final Duration delay;
  Timer? _timer;
  _Debouncer(this.delay);

  void run(VoidCallback action) {
    _timer?.cancel();
    _timer = Timer(delay, action);
  }

  void cancel() => _timer?.cancel();
  void dispose() => _timer?.cancel();
}

Map<String, dynamic> _copyMap(dynamic value) {
  if (value is Map) {
    return jsonDecode(jsonEncode(value)) as Map<String, dynamic>;
  }
  return <String, dynamic>{};
}

// Decode a `data:image/...;base64,xxxx` URL to bytes (return type inferred as
// Uint8List from base64Decode, so no extra import is needed).
_dataUrlBytes(String dataUrl) {
  final comma = dataUrl.indexOf(',');
  return base64Decode(comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl);
}
