// GENERATED SPLIT of settings_more_panels.dart — panel Cấu hình kho (part of, cùng library).
part of 'settings_more_panels.dart';

class WarehouseSettingsPanel extends StatefulWidget {
  final ApiService api;
  WarehouseSettingsPanel({super.key, required this.api});

  @override
  State<WarehouseSettingsPanel> createState() => _WarehouseSettingsPanelState();
}

class _WarehouseSettingsPanelState extends State<WarehouseSettingsPanel> {
  List<Map<String, dynamic>> _warehouses = [];
  // Bảng giá (KiotViet): quản lý ở đây, dùng trong Kho → Thiết lập giá.
  List<Map<String, dynamic>> _priceBooks = [];
  // Cấu hình bán retail: kho + bảng giá cho Retail POS và Retail-trong-F&B;
  // sync=true → 2 bên dùng chung cấu hình (tick "đồng bộ cả 2").
  Map<String, dynamic> _retailCfg = {
    'sync': true,
    'standalone': {'warehouse_id': '', 'price_book_id': 'default'},
    'fnb': {'warehouse_id': '', 'price_book_id': 'default'},
  };
  bool _savingRetailCfg = false;
  bool _loading = true;
  String? _error;

  // Selected warehouse ID. If null, we are in "Create new warehouse" mode.
  String? _selectedId;

  // Form controllers and state
  final _nameCtrl = TextEditingController();
  final _codeCtrl = TextEditingController();
  final _sortCtrl = TextEditingController();
  String _type = 'retail';
  bool _active = true;
  Set<String> _selectedChannels = {'retail'};

  static List<(String, String)> _allChannels = [
    ('ipad', 'iPad self-order'),
    ('pos', t('POS nhà hàng')),
    ('retail', 'Retail POS'),
    ('online', t('Kênh online chung')),
    ('grabmerchant', 'GrabFood / GrabMerchant'),
    ('shopeefood', 'ShopeeFood'),
    ('befood', 'beFood'),
    ('grabmart', 'GrabMart'),
    ('website', 'Website order'),
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _codeCtrl.dispose();
    _sortCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final rows = await widget.api.getWarehouses();
      List<Map<String, dynamic>> books = [];
      try {
        books = (await widget.api.getPriceBooks())
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      } catch (_) {
        // Server cũ chưa có API bảng giá — vẫn hiện phần Kho bình thường.
      }
      try {
        final st = await widget.api.getAppSettings();
        if (st['retail_config'] is Map) {
          _retailCfg = _normalizeRetailCfg(
              Map<String, dynamic>.from(st['retail_config']));
        }
      } catch (_) {
        // Server cũ chưa có retail_config — dùng mặc định.
      }
      if (!mounted) return;
      setState(() {
        _priceBooks = books;
        _warehouses = rows
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _loading = false;
        _error = null;

        // If we had a selected ID, check if it still exists, otherwise clear selection
        if (_selectedId != null &&
            !_warehouses.any((w) => _s(w['id']) == _selectedId)) {
          _selectedId = null;
        }

        // Set form baseline from selected warehouse or default to new
        if (_selectedId != null) {
          final wh = _warehouses.firstWhere((w) => _s(w['id']) == _selectedId);
          _selectWarehouse(wh);
        } else {
          _selectWarehouse(null);
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  void _selectWarehouse(Map<String, dynamic>? wh) {
    setState(() {
      if (wh == null) {
        _selectedId = null;
        _nameCtrl.text = '';
        _codeCtrl.text = '';
        _sortCtrl.text = '';
        _type = 'retail';
        _active = true;
        _selectedChannels = {'retail'};
      } else {
        _selectedId = _s(wh['id']);
        _nameCtrl.text = _s(wh['name']);
        _codeCtrl.text = _s(wh['code']);
        _sortCtrl.text = wh['sort'] != null ? _s(wh['sort']) : '';
        _type = _s(wh['type']) == 'kitchen' ? 'kitchen' : 'retail';
        _active = _b(wh['active']);

        final channelsList = wh['sales_channels'] as List?;
        _selectedChannels = channelsList != null
            ? channelsList.map((e) => _s(e)).toSet()
            : <String>{};
      }
    });
  }

  void _onTypeChanged(String? newType) {
    if (newType == null) return;
    setState(() {
      _type = newType;
      // Auto-toggle default channels only when in creation mode
      if (_selectedId == null) {
        if (newType == 'kitchen') {
          _selectedChannels = {'ipad', 'pos'};
        } else {
          _selectedChannels = {'retail'};
        }
      }
    });
  }

  void _toast(String m, {bool error = false}) =>
      appToast(context, m, isError: error);

  Future<void> _save() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) {
      _toast(t('Nhập tên kho'), error: true);
      return;
    }

    final code = _codeCtrl.text.trim();
    final sortText = _sortCtrl.text.trim();
    int? sort;
    if (sortText.isNotEmpty) {
      sort = int.tryParse(sortText) ?? 0;
    }

    final reason = _selectedId == null
        ? t('Tạo kho "$name".')
        : t('Cập nhật kho "$name".');

    final pin = await settingsPin(context, reason);
    if (pin == null) {
      _toast(t('Đã hủy lưu cấu hình kho'), error: true);
      return;
    }

    try {
      final body = <String, dynamic>{
        'name': name,
        'code': code,
        'type': _type,
        'active': _active,
        'sales_channels': _selectedChannels.toList(),
        'security_pin': pin,
      };
      if (sort != null) {
        body['sort'] = sort;
      }

      if (_selectedId == null) {
        await widget.api.createWarehouse(body);
      } else {
        await widget.api.updateWarehouse(_selectedId!, body);
      }

      _toast(t('Đã lưu cấu hình kho'));

      // Reset selected ID and reload
      _selectedId = null;
      await _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  Widget _buildChannelBadges(Map<String, dynamic> w) {
    final channelsList = w['sales_channels'] as List?;
    if (channelsList == null || channelsList.isEmpty) {
      return Text(
        t('Chưa nối kênh bán hàng'),
        style: TextStyle(fontSize: 11, color: DanColors.faint),
      );
    }

    return Wrap(
      spacing: 4,
      runSpacing: 4,
      children: channelsList.map((c) {
        final key = _s(c);
        final found = _allChannels.firstWhere((ch) => ch.$1 == key,
            orElse: () => ('', key));
        return Container(
          padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: DanColors.doing.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(4),
          ),
          child: Text(
            found.$2,
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.bold,
              color: Color(
                  0xFFB45309), // Dark amber text for readability on light background
            ),
          ),
        );
      }).toList(),
    );
  }

  // ── Bảng giá: danh sách + tạo/sửa/tắt/xóa ────────────────────────────────
  Widget _priceBooksSection() {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 12, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.sell_outlined, size: 16, color: DanColors.muted),
              SizedBox(width: 6),
              Text(t('Bảng giá'),
                  style:
                      TextStyle(fontSize: 13.5, fontWeight: FontWeight.w900)),
              Spacer(),
              TextButton.icon(
                onPressed: () => _editPriceBook(),
                icon: Icon(Icons.add, size: 16),
                label: Text(t('Tạo bảng giá')),
                style: TextButton.styleFrom(
                    padding: EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: Size(0, 32)),
              ),
            ],
          ),
          Text(t('Chọn bảng giá khi bán / xem trong Kho → Thiết lập giá'),
              style: TextStyle(fontSize: 10.5, color: DanColors.faint)),
          SizedBox(height: 8),
          ConstrainedBox(
            constraints: BoxConstraints(maxHeight: 190),
            child: ListView(
              shrinkWrap: true,
              padding: EdgeInsets.zero,
              children: [
                for (final b in _priceBooks)
                  Padding(
                    padding: EdgeInsets.only(bottom: 6),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            _s(b['name']) +
                                (_n(b['item_count']) > 0
                                    ? ' · ${_n(b['item_count']).toInt()} giá riêng'
                                    : ''),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w700,
                                color: _s(b['status']) == 'inactive'
                                    ? DanColors.faint
                                    : DanColors.text),
                          ),
                        ),
                        if (_b(b['builtin']))
                          Container(
                            padding: EdgeInsets.symmetric(
                                horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                                color: DanColors.brandDim,
                                borderRadius: BorderRadius.circular(99)),
                            child: Text(t('Mặc định'),
                                style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w800,
                                    color: DanColors.brand)),
                          )
                        else ...[
                          IconButton(
                            tooltip: t('Đổi tên'),
                            visualDensity: VisualDensity.compact,
                            onPressed: () => _editPriceBook(existing: b),
                            icon: Icon(Icons.edit_outlined,
                                size: 16, color: DanColors.muted),
                          ),
                          SizedBox(
                            height: 24,
                            child: Switch(
                              value: _s(b['status']) != 'inactive',
                              activeThumbColor: DanColors.brand,
                              onChanged: (v) => _savePriceBook({
                                'id': b['id'],
                                'name': b['name'],
                                'status': v ? 'active' : 'inactive',
                              }),
                            ),
                          ),
                          IconButton(
                            tooltip: t('Xóa bảng giá'),
                            visualDensity: VisualDensity.compact,
                            onPressed: () => _deletePriceBook(b),
                            icon: Icon(Icons.delete_outline,
                                size: 16, color: DanColors.late),
                          ),
                        ],
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Cấu hình bán retail: kho + bảng giá cho Retail POS / Retail-F&B ──────
  Map<String, dynamic> _normalizeRetailCfg(Map<String, dynamic> raw) {
    Map<String, dynamic> sec(dynamic v) => {
          'warehouse_id': _s(v is Map ? v['warehouse_id'] : ''),
          'price_book_id': _s(v is Map ? v['price_book_id'] : '').isEmpty
              ? 'default'
              : _s(v is Map ? v['price_book_id'] : 'default'),
        };
    return {
      'sync': raw['sync'] != false,
      'standalone': sec(raw['standalone']),
      'fnb': sec(raw['fnb']),
    };
  }

  Future<void> _saveRetailCfg() async {
    if (_savingRetailCfg) return;
    setState(() => _savingRetailCfg = true);
    try {
      await widget.api.saveAppSettings({'retail_config': _retailCfg});
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late));
    } finally {
      if (mounted) setState(() => _savingRetailCfg = false);
    }
  }

  Widget _retailConfigSection() {
    final sync = _retailCfg['sync'] != false;
    final retailWhs =
        _warehouses.where((w) => _s(w['type']) != 'kitchen').toList();
    final activeBooks = _priceBooks
        .where((b) =>
            _s(b['status']) != 'inactive' || _b(b['builtin']))
        .toList();

    Widget sectionRow(String label, String key, {required bool enabled}) {
      final sec = Map<String, dynamic>.from(_retailCfg[key] as Map? ?? {});
      final whValue = retailWhs.any((w) => _s(w['id']) == _s(sec['warehouse_id']))
          ? _s(sec['warehouse_id'])
          : '';
      final bookValue =
          activeBooks.any((b) => _s(b['id']) == _s(sec['price_book_id']))
              ? _s(sec['price_book_id'])
              : 'default';
      void update(String field, String value) {
        sec[field] = value;
        setState(() {
          _retailCfg[key] = sec;
          if (_retailCfg['sync'] != false && key == 'standalone') {
            _retailCfg['fnb'] = Map<String, dynamic>.from(sec);
          }
        });
        _saveRetailCfg();
      }

      return Padding(
        padding: EdgeInsets.only(bottom: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label,
                style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w800,
                    color: enabled ? DanColors.muted : DanColors.faint)),
            SizedBox(height: 5),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: whValue,
                    isExpanded: true,
                    decoration: InputDecoration(
                        labelText: t('Kho'),
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(
                            horizontal: 8, vertical: 6)),
                    items: [
                      DropdownMenuItem(
                          value: '', child: Text(t('Theo kênh bán'))),
                      for (final w in retailWhs)
                        DropdownMenuItem(
                            value: _s(w['id']),
                            child: Text(_s(w['name']),
                                overflow: TextOverflow.ellipsis)),
                    ],
                    onChanged: enabled
                        ? (v) => update('warehouse_id', v ?? '')
                        : null,
                  ),
                ),
                SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: bookValue,
                    isExpanded: true,
                    decoration: InputDecoration(
                        labelText: t('Bảng giá'),
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(
                            horizontal: 8, vertical: 6)),
                    items: [
                      for (final b in activeBooks)
                        DropdownMenuItem(
                            value: _s(b['id']),
                            child: Text(_s(b['name']),
                                overflow: TextOverflow.ellipsis)),
                    ],
                    onChanged: enabled
                        ? (v) => update('price_book_id', v ?? 'default')
                        : null,
                  ),
                ),
              ],
            ),
          ],
        ),
      );
    }

    return Padding(
      padding: EdgeInsets.fromLTRB(16, 12, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.shopping_cart_outlined,
                  size: 16, color: DanColors.muted),
              SizedBox(width: 6),
              Text(t('Cấu hình bán retail'),
                  style:
                      TextStyle(fontSize: 13.5, fontWeight: FontWeight.w900)),
              if (_savingRetailCfg) ...[
                SizedBox(width: 8),
                SizedBox(
                    width: 12,
                    height: 12,
                    child: CircularProgressIndicator(strokeWidth: 2)),
              ],
            ],
          ),
          SizedBox(height: 4),
          // Tick đồng bộ: Retail POS và Retail-trong-F&B dùng chung cấu hình.
          InkWell(
            onTap: () {
              setState(() {
                final next = !(_retailCfg['sync'] != false);
                _retailCfg['sync'] = next;
                if (next) {
                  _retailCfg['fnb'] = Map<String, dynamic>.from(
                      _retailCfg['standalone'] as Map);
                }
              });
              _saveRetailCfg();
            },
            child: Row(
              children: [
                Icon(sync ? Icons.check_box : Icons.check_box_outline_blank,
                    size: 17,
                    color: sync ? DanColors.brand : DanColors.faint),
                SizedBox(width: 6),
                Expanded(
                  child: Text(
                      t('Đồng bộ cả 2 (F&B dùng y cấu hình Retail POS)'),
                      style: TextStyle(
                          fontSize: 12, fontWeight: FontWeight.w700)),
                ),
              ],
            ),
          ),
          SizedBox(height: 10),
          sectionRow(t('RETAIL POS (bán lẻ)'), 'standalone', enabled: true),
          sectionRow(t('RETAIL TRONG F&B (thêm retail ở POS nhà hàng)'), 'fnb',
              enabled: !sync),
        ],
      ),
    );
  }

  Future<void> _editPriceBook({Map<String, dynamic>? existing}) async {
    final ctrl = TextEditingController(text: _s(existing?['name']));
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(existing == null ? t('Tạo bảng giá') : t('Đổi tên bảng giá'),
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
        content: SizedBox(
          width: 340,
          child: TextField(
            controller: ctrl,
            autofocus: true,
            decoration: InputDecoration(
                labelText: t('Tên bảng giá'),
                hintText: t('VD: Giá sỉ, Giá GrabMart…')),
            onSubmitted: (_) => Navigator.of(ctx).pop(true),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(t('Hủy'))),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text(t('Lưu'))),
        ],
      ),
    );
    final name = ctrl.text.trim();
    ctrl.dispose();
    if (ok != true || name.isEmpty) return;
    await _savePriceBook({
      if (existing != null) 'id': existing['id'],
      'name': name,
      if (existing != null) 'status': existing['status'],
    });
  }

  Future<void> _savePriceBook(Map<String, dynamic> body) async {
    try {
      await widget.api.savePriceBook(body);
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late));
    }
  }

  Future<void> _deletePriceBook(Map<String, dynamic> b) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(t('Xóa bảng giá'),
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
        content: Text(t(
            'Xóa "${_s(b['name'])}"? Mọi giá riêng trong bảng này sẽ mất, sản phẩm quay về giá chung.')),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(t('Hủy'))),
          FilledButton(
              style: FilledButton.styleFrom(backgroundColor: DanColors.late),
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text(t('Xóa'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.api.deletePriceBook(_s(b['id']));
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: t('Kho & kênh bán'),
      onRefresh: _load,
      child: settingsState(
        loading: _loading && _warehouses.isEmpty,
        error: _warehouses.isEmpty ? _error : null,
        onRetry: _load,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Left Side: List of warehouses
            Container(
              width: 380,
              decoration: BoxDecoration(
                border: Border(
                  right: BorderSide(color: DanColors.border),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: ListView.separated(
                padding: EdgeInsets.all(16),
                itemCount: _warehouses.length,
                separatorBuilder: (_, __) => SizedBox(height: 8),
                itemBuilder: (_, i) {
                  final w = _warehouses[i];
                  final isSelected = _s(w['id']) == _selectedId;
                  final kitchen = _s(w['type']) == 'kitchen';
                  final active = _b(w['active']);

                  return InkWell(
                    onTap: () => _selectWarehouse(w),
                    borderRadius: BorderRadius.circular(DanRadius.md),
                    child: Container(
                      padding:
                          EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      decoration: BoxDecoration(
                        color:
                            isSelected ? DanColors.brandDim : DanColors.surface,
                        border: Border.all(
                          color:
                              isSelected ? DanColors.brand : DanColors.border,
                          width: isSelected ? 1.5 : 1,
                        ),
                        borderRadius: BorderRadius.circular(DanRadius.md),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Padding(
                            padding: EdgeInsets.only(top: 2),
                            child: Icon(
                              kitchen
                                  ? Icons.soup_kitchen_outlined
                                  : Icons.storefront_outlined,
                              size: 22,
                              color: isSelected
                                  ? DanColors.brand
                                  : DanColors.muted,
                            ),
                          ),
                          SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _s(w['name']),
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: isSelected
                                        ? FontWeight.w900
                                        : FontWeight.w800,
                                    color: DanColors.text,
                                  ),
                                ),
                                SizedBox(height: 3),
                                Text(
                                  '${kitchen ? t('Kho bếp') : t('Kho retail')} · ${_s(w['code']).isNotEmpty ? _s(w['code']) : _s(w['id'])}',
                                  style: TextStyle(
                                      fontSize: 11.5, color: DanColors.faint),
                                ),
                                SizedBox(height: 6),
                                _buildChannelBadges(w),
                              ],
                            ),
                          ),
                          SizedBox(width: 8),
                          Container(
                            padding: EdgeInsets.symmetric(
                                horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: (active ? DanColors.done : DanColors.faint)
                                  .withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(99),
                            ),
                            child: Text(
                              active ? t('Bật') : t('Tắt'),
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                                color: active
                                    ? Color(0xFF047857)
                                    : DanColors.muted,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
                  ),
                  Divider(height: 1, color: DanColors.border),
                  // Nửa dưới cuộn được: Bảng giá + Cấu hình bán retail —
                  // màn thấp (tablet) không bị tràn layout.
                  Flexible(
                    child: SingleChildScrollView(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _priceBooksSection(),
                          Divider(height: 1, color: DanColors.border),
                          _retailConfigSection(),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Right Side: Configuration/Creation Form
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Form Header
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Text(
                          _selectedId == null
                              ? t('Tạo kho mới')
                              : t('Cấu hình kho'),
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: DanColors.text,
                          ),
                        ),
                        if (_selectedId != null) ...[
                          SizedBox(width: 8),
                          Text(
                            '(ID: $_selectedId)',
                            style: TextStyle(
                              fontSize: 12,
                              fontStyle: FontStyle.italic,
                              color: DanColors.faint,
                            ),
                          ),
                        ],
                      ],
                    ),
                    SizedBox(height: 16),

                    // Card Form Container
                    Container(
                      padding: EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: DanColors.surface,
                        border: Border.all(color: DanColors.border),
                        borderRadius: BorderRadius.circular(DanRadius.lg),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Two-column layout for basic fields using Row/Expanded
                          Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _nameCtrl,
                                  decoration: InputDecoration(
                                    labelText: t('Tên kho'),
                                    hintText: 'VD: Kho Dan D Pak Sala',
                                  ),
                                ),
                              ),
                              SizedBox(width: 14),
                              Expanded(
                                child: TextField(
                                  controller: _codeCtrl,
                                  decoration: InputDecoration(
                                    labelText: t('Mã kho'),
                                    hintText: t('Tự sinh nếu để trống'),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          SizedBox(height: 14),

                          Row(
                            children: [
                              Expanded(
                                child: DropdownButtonFormField<String>(
                                  initialValue: _type,
                                  decoration:
                                      InputDecoration(labelText: t('Loại kho')),
                                  items: [
                                    DropdownMenuItem(
                                      value: 'retail',
                                      child: Text('Kho retail / showroom'),
                                    ),
                                    DropdownMenuItem(
                                      value: 'kitchen',
                                      child: Text(t('Kho bếp / vật dụng')),
                                    ),
                                  ],
                                  onChanged: _onTypeChanged,
                                ),
                              ),
                              SizedBox(width: 14),
                              Expanded(
                                child: TextField(
                                  controller: _sortCtrl,
                                  keyboardType: TextInputType.number,
                                  decoration: InputDecoration(
                                    labelText: t('Sắp xếp'),
                                    hintText: '0',
                                  ),
                                ),
                              ),
                              SizedBox(width: 14),
                              Expanded(
                                child: DropdownButtonFormField<bool>(
                                  initialValue: _active,
                                  decoration: InputDecoration(
                                      labelText: t('Trạng thái')),
                                  items: [
                                    DropdownMenuItem(
                                      value: true,
                                      child: Text(t('Đang bật')),
                                    ),
                                    DropdownMenuItem(
                                      value: false,
                                      child: Text(t('Tắt kho')),
                                    ),
                                  ],
                                  onChanged: (val) {
                                    if (val != null) {
                                      setState(() => _active = val);
                                    }
                                  },
                                ),
                              ),
                            ],
                          ),
                          SizedBox(height: 20),

                          // Sales channels connection section
                          Text(
                            t('Kênh bán hàng đang nối với kho này'),
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: DanColors.text,
                            ),
                          ),
                          SizedBox(height: 10),

                          // Grid of Sales channels (wrap with spacing)
                          Wrap(
                            spacing: 12,
                            runSpacing: 10,
                            children: _allChannels.map((c) {
                              final key = c.$1;
                              final label = c.$2;
                              final isChecked = _selectedChannels.contains(key);

                              return InkWell(
                                onTap: () {
                                  setState(() {
                                    if (isChecked) {
                                      _selectedChannels.remove(key);
                                    } else {
                                      _selectedChannels.add(key);
                                    }
                                  });
                                },
                                borderRadius:
                                    BorderRadius.circular(DanRadius.sm),
                                child: Container(
                                  width: 220,
                                  padding: EdgeInsets.symmetric(
                                      horizontal: 10, vertical: 8),
                                  decoration: BoxDecoration(
                                    color: isChecked
                                        ? DanColors.brandDim
                                        : Colors.transparent,
                                    border: Border.all(
                                      color: isChecked
                                          ? DanColors.brand
                                          : DanColors.border,
                                    ),
                                    borderRadius:
                                        BorderRadius.circular(DanRadius.sm),
                                  ),
                                  child: Row(
                                    children: [
                                      SizedBox(
                                        height: 24,
                                        width: 24,
                                        child: Checkbox(
                                          value: isChecked,
                                          activeColor: DanColors.brand,
                                          onChanged: (val) {
                                            setState(() {
                                              if (val == true) {
                                                _selectedChannels.add(key);
                                              } else {
                                                _selectedChannels.remove(key);
                                              }
                                            });
                                          },
                                        ),
                                      ),
                                      SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          label,
                                          style: TextStyle(
                                            fontSize: 12.5,
                                            fontWeight: isChecked
                                                ? FontWeight.w700
                                                : FontWeight.normal,
                                            color: DanColors.text,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              );
                            }).toList(),
                          ),
                          SizedBox(height: 8),
                          Text(
                            t('Ví dụ: kho bếp nối iPad/POS nhà hàng; kho bán lẻ nối Retail POS, GrabMart hoặc Website.'),
                            style: TextStyle(
                              fontSize: 11.5,
                              fontStyle: FontStyle.italic,
                              color: DanColors.faint,
                            ),
                          ),
                          SizedBox(height: 24),

                          // Form Action Buttons — Wrap để không tràn ngang khi
                          // panel hẹp (tablet): 3 nút có nhãn dài dễ vượt bề
                          // rộng, tự xuống dòng thay vì overflow đỏ.
                          Wrap(
                            spacing: 10,
                            runSpacing: 10,
                            children: [
                              OutlinedButton.icon(
                                onPressed: () => _selectWarehouse(null),
                                icon: Icon(Icons.add, size: 16),
                                label: Text(t('Tạo kho mới')),
                              ),
                              FilledButton.icon(
                                onPressed: _save,
                                icon: Icon(Icons.save, size: 16),
                                label: Text(_selectedId == null
                                    ? t('Tạo kho')
                                    : t('Lưu cấu hình kho')),
                              ),
                              OutlinedButton.icon(
                                onPressed: () {
                                  Navigator.of(context).push(
                                    MaterialPageRoute(
                                        builder: (_) => WarehouseScreen()),
                                  );
                                },
                                icon: Icon(Icons.warehouse_outlined, size: 16),
                                label: Text(t('Mở màn Kho')),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Print (Bill & Tem nhãn) ─────────────────────────────────────────────────

