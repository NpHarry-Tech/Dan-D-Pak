// GENERATED SPLIT of pos_screen.dart — dialog xác nhận món chờ + chọn món.
// Cùng library (part of) nên mọi class/helper private dùng chung nguyên vẹn.
part of 'pos_screen.dart';

class _PendingConfirmDialog extends StatefulWidget {
  final ApiService api;
  _PendingConfirmDialog({required this.api});

  @override
  State<_PendingConfirmDialog> createState() => _PendingConfirmDialogState();
}

class _PendingConfirmDialogState extends State<_PendingConfirmDialog> {
  List<dynamic> _orders = [];
  bool _loading = true;
  String? _error;
  String? _selectedOrderId;
  final Set<String> _selectedItemIds = {};
  final TextEditingController _reasonController = TextEditingController();
  bool _processing = false;
  final _money = NumberFormat.decimalPattern('vi_VN');

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await widget.api.getPendingConfirmations();
      if (!mounted) return;
      setState(() {
        _orders = rows;
        _loading = false;
        if (_orders.isNotEmpty) {
          _selectOrder(_orders.first['order_id']);
        } else {
          _selectedOrderId = null;
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

  void _selectOrder(String orderId) {
    _selectedOrderId = orderId;
    _selectedItemIds.clear();
    _reasonController.clear();
    final active =
        _orders.firstWhere((g) => g['order_id'] == orderId, orElse: () => null);
    if (active != null && active['items'] is List) {
      for (final item in active['items']) {
        _selectedItemIds.add(item['id'].toString());
      }
    }
  }

  String _lineMeta(dynamic item) {
    final List<dynamic> modsList = item['mods'] ?? [];
    final mods = modsList.map((m) {
      final group = m['group'] != null ? '${m['group']}: ' : '';
      final price = (m['price'] != null && m['price'] > 0)
          ? ' (+${_money.format(m['price'])}đ)'
          : '';
      return '$group${m['name']}$price';
    }).join(', ');

    final List<String> bits = [];
    if (mods.isNotEmpty) bits.add('Topping: $mods');
    if (item['note'] != null && item['note'].toString().isNotEmpty) {
      bits.add('Ghi chú: ${item['note']}');
    }
    final stationName = {
          'kitchen': t('Bếp'),
          'bar': 'Bar',
          'salad': t('Salad/Lạnh'),
          'beverage': t('Quầy nước'),
          'retail': 'Retail',
        }[item['station']] ??
        item['station'] ??
        t('Không rõ');
    bits.add(t('Chuyển tới: $stationName'));
    return bits.join(' · ');
  }

  Future<void> _handleConfirm(String orderId) async {
    final itemIds = _selectedItemIds.toList();
    if (itemIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(t('Vui lòng chọn ít nhất một món để xác nhận.')),
        backgroundColor: DanColors.late,
      ));
      return;
    }
    setState(() => _processing = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      await widget.api.confirmPendingOrder(orderId, itemIds);
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(t('Đã xác nhận món ăn và gửi xuống bếp/bar.')),
        backgroundColor: DanColors.done,
      ));
      await _load();
      if (_orders.isEmpty) {
        navigator.pop(true);
      }
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
        backgroundColor: DanColors.late,
      ));
    } finally {
      if (mounted) setState(() => _processing = false);
    }
  }

  Future<void> _handleReject(String orderId) async {
    final itemIds = _selectedItemIds.toList();
    if (itemIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(t('Vui lòng chọn ít nhất một món để từ chối.')),
        backgroundColor: DanColors.late,
      ));
      return;
    }
    final reason = _reasonController.text.trim();
    if (reason.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(t('Vui lòng nhập lý do từ chối để đối soát.')),
        backgroundColor: DanColors.late,
      ));
      return;
    }
    setState(() => _processing = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      await widget.api.rejectPendingOrder(orderId, itemIds, reason);
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(t('Đã từ chối các món ăn đã chọn.')),
        backgroundColor: DanColors.done,
      ));
      await _load();
      if (_orders.isEmpty) {
        navigator.pop(true);
      }
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
        backgroundColor: DanColors.late,
      ));
    } finally {
      if (mounted) setState(() => _processing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget content;
    if (_loading) {
      content = SizedBox(
        height: 300,
        child: Center(child: CircularProgressIndicator()),
      );
    } else if (_error != null) {
      content = SizedBox(
        height: 300,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('${t('Lỗi')}: $_error',
                  style: TextStyle(color: DanColors.late)),
              SizedBox(height: 12),
              FilledButton(onPressed: _load, child: Text(t('Thử lại'))),
            ],
          ),
        ),
      );
    } else if (_orders.isEmpty) {
      content = SizedBox(
        height: 300,
        child: Center(
          child: Text(
            t('Không có món nào chờ xác nhận.'),
            style: TextStyle(
                color: DanColors.faint,
                fontSize: 16,
                fontWeight: FontWeight.bold),
          ),
        ),
      );
    } else {
      final active = _orders.firstWhere(
          (g) => g['order_id'] == _selectedOrderId,
          orElse: () => _orders.first);
      final List<dynamic> items = active['items'] ?? [];
      final activeTableCode =
          active['table_code'] != null && active['table_code'] != '—'
              ? 'Bàn ${active['table_code']}'
              : t('Đơn khách');

      content = SizedBox(
        height: 440,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Left list of tables
            Container(
              width: 260,
              decoration: BoxDecoration(
                border: Border(right: BorderSide(color: DanColors.border)),
              ),
              child: ListView.separated(
                padding: EdgeInsets.only(right: 8),
                itemCount: _orders.length,
                separatorBuilder: (_, __) => SizedBox(height: 8),
                itemBuilder: (context, idx) {
                  final g = _orders[idx];
                  final orderId = g['order_id'].toString();
                  final isSelected = orderId == _selectedOrderId;
                  final tableCode =
                      g['table_code'] != null && g['table_code'] != '—'
                          ? 'Bàn ${g['table_code']}'
                          : t('Đơn khách');

                  return InkWell(
                    onTap: () => setState(() => _selectOrder(orderId)),
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      padding:
                          EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: isSelected
                            ? DanColors.brand.withValues(alpha: .08)
                            : DanColors.surface2,
                        border: Border.all(
                            color: isSelected
                                ? DanColors.brand
                                : DanColors.border),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(tableCode,
                                  style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 13.5)),
                              Spacer(),
                              Text('${_money.format(g['total'])}đ',
                                  style: TextStyle(
                                      fontWeight: FontWeight.w800,
                                      color: DanColors.brand,
                                      fontSize: 12.5)),
                            ],
                          ),
                          SizedBox(height: 4),
                          Text(
                              '${g['line_count']} dòng · ${g['item_count']} món cần duyệt',
                              style: TextStyle(
                                  color: DanColors.muted, fontSize: 11)),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            // Right detail pane
            Expanded(
              child: Padding(
                padding: EdgeInsets.only(left: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Text(activeTableCode,
                            style: TextStyle(
                                fontWeight: FontWeight.bold, fontSize: 16)),
                        Spacer(),
                        Text('${_money.format(active['total'])}đ',
                            style: TextStyle(
                                fontWeight: FontWeight.bold,
                                color: DanColors.brand,
                                fontSize: 16)),
                      ],
                    ),
                    SizedBox(height: 2),
                    Text(
                        '${active['line_count']} dòng · ${active['item_count']} món · Kiểm tra trước khi duyệt',
                        style: TextStyle(color: DanColors.muted, fontSize: 12)),
                    SizedBox(height: 12),
                    Expanded(
                      child: Container(
                        decoration: BoxDecoration(
                          color: DanColors.surface2,
                          border: Border.all(color: DanColors.border),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: ListView.separated(
                          padding: EdgeInsets.all(8),
                          itemCount: items.length,
                          separatorBuilder: (_, __) =>
                              Divider(height: 1, color: DanColors.border),
                          itemBuilder: (context, idx) {
                            final item = items[idx];
                            final itemId = item['id'].toString();
                            final checked = _selectedItemIds.contains(itemId);
                            return CheckboxListTile(
                              value: checked,
                              onChanged: (val) {
                                setState(() {
                                  if (val == true) {
                                    _selectedItemIds.add(itemId);
                                  } else {
                                    _selectedItemIds.remove(itemId);
                                  }
                                });
                              },
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              controlAffinity: ListTileControlAffinity.leading,
                              title: Row(
                                children: [
                                  Text('${item['qty']}× ',
                                      style: TextStyle(
                                          fontWeight: FontWeight.w800,
                                          color: DanColors.brand)),
                                  Expanded(
                                      child: Text(item['name'],
                                          style: TextStyle(
                                              fontWeight: FontWeight.bold))),
                                  Text(
                                      '${_money.format(item['qty'] * item['unit_price'])}đ',
                                      style: TextStyle(
                                          fontSize: 12,
                                          color: DanColors.muted)),
                                ],
                              ),
                              subtitle: Padding(
                                padding: EdgeInsets.only(top: 2),
                                child: Text(_lineMeta(item),
                                    style: TextStyle(
                                        color: DanColors.muted, fontSize: 11)),
                              ),
                            );
                          },
                        ),
                      ),
                    ),
                    SizedBox(height: 12),
                    TextField(
                      controller: _reasonController,
                      decoration: InputDecoration(
                        isDense: true,
                        labelText: t('Lý do từ chối'),
                        hintText:
                            t('Nhập lý do nếu từ chối (ví dụ: hết món...)'),
                      ),
                    ),
                    SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        OutlinedButton(
                          onPressed: _processing
                              ? null
                              : () => _handleReject(active['order_id']),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: DanColors.late,
                            side: BorderSide(color: DanColors.late),
                          ),
                          child: _processing
                              ? SizedBox(
                                  width: 16,
                                  height: 16,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2))
                              : Text(t('Từ chối (Reject)')),
                        ),
                        SizedBox(width: 12),
                        FilledButton(
                          onPressed: _processing
                              ? null
                              : () => _handleConfirm(active['order_id']),
                          style: FilledButton.styleFrom(
                              backgroundColor: DanColors.done),
                          child: _processing
                              ? SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white))
                              : Text(t('Xác nhận (Accept)')),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      );
    }

    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        width: dialogWidth(context, 850),
        padding: EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: DanColors.bg,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(Icons.notifications_active_outlined,
                    size: 22, color: DanColors.late),
                SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        t('Món khách vừa gọi'),
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                      SizedBox(height: 2),
                      Text(
                        t('Nhân viên cần đọc lại với khách, kiểm tra topping/ghi chú trước khi duyệt chuyển xuống bếp.'),
                        style:
                            TextStyle(color: DanColors.muted, fontSize: 12.5),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            SizedBox(height: 16),
            content,
            SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  child: Text(t('Đóng')),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _MenuPickerDialog extends StatefulWidget {
  final String title;
  final PosProvider pos;
  final ApiService api;
  final Future<bool> Function(MenuItem) onAdd;
  final bool isRetail;

  _MenuPickerDialog({
    required this.title,
    required this.pos,
    required this.api,
    required this.onAdd,
    this.isRetail = false,
  });

  @override
  State<_MenuPickerDialog> createState() => _MenuPickerDialogState();
}

class _MenuPickerDialogState extends State<_MenuPickerDialog> {
  final _searchCtrl = TextEditingController();
  final _searchFocus = FocusNode();
  final _scrollCtrl = ScrollController();
  final _debouncer = Debouncer(delay: Duration(milliseconds: 300));

  String _search = '';
  String? _selectedCategoryId;
  List<MenuItem> _loadedItems = [];
  int _currentPage = 1;
  bool _hasMore = true;
  bool _loadingPage = false;

  @override
  void initState() {
    super.initState();
    _scrollCtrl.addListener(_onScroll);
    _loadNextPage(isRefresh: true);
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    _searchFocus.dispose();
    _scrollCtrl.removeListener(_onScroll);
    _scrollCtrl.dispose();
    _debouncer.dispose();
    super.dispose();
  }

  /// Máy quét USB gõ mã + Enter (hoặc camera trên tablet): khớp barcode →
  /// THÊM MÓN NGAY không cần bấm tay, giữ focus để quét liên tục.
  Future<void> _tryBarcodeAdd(String code) async {
    final c = code.trim();
    if (c.isEmpty || !widget.isRetail) return;
    try {
      final sku = await widget.api.getSkuByBarcode(c, channel: 'fnb_retail');
      if (sku != null && (sku['id']?.toString() ?? '').isNotEmpty) {
        final item = MenuItem(
          id: sku['id'].toString(),
          code: sku['barcode']?.toString() ?? '',
          name: sku['name']?.toString() ?? '',
          price: (sku['price'] as num?)?.toDouble() ?? 0.0,
          categoryId: sku['category']?.toString() ?? '',
          imageUrl: sku['image']?.toString() ?? '',
          modifiers: [],
          isRetail: true,
        );
        final ok = await widget.onAdd(item);
        if (!mounted) return;
        if (ok) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text('+1 ${item.name}'),
              duration: Duration(milliseconds: 900),
              backgroundColor: DanColors.text));
        }
        _searchCtrl.clear();
        _search = '';
        _loadNextPage(isRefresh: true);
        _searchFocus.requestFocus(); // quét mã tiếp không cần chạm màn hình
        return;
      }
    } catch (_) {
      // Không khớp barcode → giữ chuỗi làm từ khóa tìm như cũ.
    }
    if (mounted) _searchFocus.requestFocus();
  }

  void _onScroll() {
    if (_scrollCtrl.position.pixels >=
        _scrollCtrl.position.maxScrollExtent - 200) {
      _loadNextPage();
    }
  }

  Future<void> _loadNextPage({bool isRefresh = false}) async {
    if (_loadingPage) return;
    if (!isRefresh && !_hasMore) return;

    setState(() {
      _loadingPage = true;
      if (isRefresh) {
        _currentPage = 1;
        _loadedItems = [];
        _hasMore = true;
      }
    });

    try {
      int total;

      List<MenuItem> items;
      if (widget.isRetail) {
        // Kênh 'fnb_retail': server áp KHO + BẢNG GIÁ cấu hình riêng cho
        // "retail trong F&B" (Cài đặt → Kho & kênh bán → Cấu hình bán retail).
        final result = await widget.api.getSkusPaginated(
          page: _currentPage,
          limit: 40,
          q: _search,
          channel: 'fnb_retail',
        );
        final itemsData = result['items'] as List? ?? [];
        total = result['total'] as int? ?? 0;
        items = itemsData.map((e) {
          final m = Map<String, dynamic>.from(e);
          return MenuItem(
            id: m['id']?.toString() ?? '',
            code: m['barcode']?.toString() ?? '',
            name: m['name']?.toString() ?? '',
            price: (m['price'] as num?)?.toDouble() ?? 0.0,
            categoryId: m['category']?.toString() ?? '',
            imageUrl: m['image']?.toString() ?? '',
            modifiers: [],
            isRetail: true,
          );
        }).toList();
      } else {
        final result = await widget.api.getMenuPaginated(
          page: _currentPage,
          limit: 40,
          q: _search,
          categoryId: _selectedCategoryId ?? '',
        );
        final itemsData = result['items'] as List? ?? [];
        total = result['total'] as int? ?? 0;
        items = itemsData
            .map((e) => MenuItem.fromJson(Map<String, dynamic>.from(e)))
            .toList();
        if (_currentPage == 1 &&
            items.isEmpty &&
            _search.trim().isNotEmpty &&
            (_selectedCategoryId == null || _selectedCategoryId!.isNotEmpty)) {
          final full = await widget.api.getMenuFull();
          final folded = foldSearch(_search);
          final rows = (full['items'] as List? ?? [])
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .where((m) =>
                  (_selectedCategoryId == null ||
                      m['category_id']?.toString() == _selectedCategoryId) &&
                  _menuRowMatches(m, folded))
              .toList();
          total = rows.length;
          items = rows.take(40).map(MenuItem.fromJson).toList();
        }
      }

      if (!mounted) return;
      setState(() {
        _loadedItems.addAll(items);
        _hasMore = _loadedItems.length < total;
        if (items.isNotEmpty) {
          _currentPage++;
        }
        _loadingPage = false;
      });
    } catch (e) {
      if (!widget.isRetail && _search.trim().isNotEmpty) {
        try {
          final full = await widget.api.getMenuFull();
          final folded = foldSearch(_search);
          final rows = (full['items'] as List? ?? [])
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .where((m) =>
                  (_selectedCategoryId == null ||
                      m['category_id']?.toString() == _selectedCategoryId) &&
                  _menuRowMatches(m, folded))
              .toList();
          if (!mounted) return;
          setState(() {
            _loadedItems = rows.take(40).map(MenuItem.fromJson).toList();
            _hasMore = false;
            _loadingPage = false;
          });
          return;
        } catch (_) {}
      }
      debugPrint("Error loading paginated menu: $e");
      if (mounted) {
        setState(() {
          _loadingPage = false;
        });
      }
    }
  }

  bool _menuRowMatches(Map<String, dynamic> row, String foldedQuery) {
    final values = <Object?>[
      row['name'],
      row['code'],
      row['sku'],
      row['description'],
    ];
    final translations = row['translations'];
    if (translations is Map) {
      for (final v in translations.values) {
        if (v is Map) values.addAll([v['name'], v['description']]);
      }
    }
    return values.any((v) => searchMatches(v, foldedQuery));
  }

  String _vnd(num value) {
    final money = NumberFormat.decimalPattern('vi_VN');
    return t('${money.format(value)}đ');
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: DanColors.surface,
      insetPadding: EdgeInsets.all(24),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: DanColors.border),
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 980, maxHeight: 720),
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(18, 16, 14, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      widget.title,
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: Icon(Icons.close),
                    color: DanColors.muted,
                    tooltip: t('Đóng'),
                  ),
                ],
              ),
            ),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 18),
              child: TextField(
                controller: _searchCtrl,
                focusNode: _searchFocus,
                autofocus: true,
                decoration: InputDecoration(
                  hintText: widget.isRetail
                      ? t('Quét mã vạch hoặc tìm tên hàng…')
                      : t('Tìm món, mã món...'),
                  prefixIcon: Icon(Icons.search),
                  // Retail: quét camera (tablet) / icon gợi ý máy quét (desktop).
                  suffixIcon: widget.isRetail
                      ? ScanIconButton(
                          title: t('Quét hàng retail'),
                          size: 20,
                          onCode: _tryBarcodeAdd)
                      : null,
                ),
                onChanged: (value) {
                  _search = value;
                  _debouncer(() {
                    _loadNextPage(isRefresh: true);
                  });
                },
                // Máy quét USB kết thúc bằng Enter → thêm món ngay.
                onSubmitted: _tryBarcodeAdd,
              ),
            ),
            if (!widget.isRetail)
              SizedBox(
                height: 58,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: EdgeInsets.fromLTRB(18, 12, 18, 8),
                  children: [
                    _PickerChip(
                      label: t('Tất cả'),
                      selected: _selectedCategoryId == null,
                      onTap: () {
                        setState(() {
                          _selectedCategoryId = null;
                        });
                        _loadNextPage(isRefresh: true);
                      },
                    ),
                    ...widget.pos.categories.map(
                      (category) => _PickerChip(
                        label: category.name,
                        selected: _selectedCategoryId == category.id,
                        onTap: () {
                          setState(() {
                            _selectedCategoryId = category.id;
                          });
                          _loadNextPage(isRefresh: true);
                        },
                      ),
                    ),
                  ],
                ),
              ),
            Expanded(
              child: _loadedItems.isEmpty && !_loadingPage
                  ? Center(
                      child: Text(
                        t('Không tìm thấy món'),
                        style: TextStyle(color: DanColors.faint),
                      ),
                    )
                  : GridView.builder(
                      controller: _scrollCtrl,
                      padding: EdgeInsets.fromLTRB(18, 8, 18, 18),
                      gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
                        maxCrossAxisExtent: 220,
                        mainAxisExtent: 128,
                        crossAxisSpacing: 10,
                        mainAxisSpacing: 10,
                      ),
                      itemCount: _loadedItems.length + (_loadingPage ? 1 : 0),
                      itemBuilder: (context, index) {
                        if (index >= _loadedItems.length) {
                          return Center(
                            child: CircularProgressIndicator(),
                          );
                        }
                        final item = _loadedItems[index];
                        return _MenuPickCard(
                          item: item,
                          price: _vnd(item.price),
                          onTap: () async {
                            final added = await widget.onAdd(item);
                            if (added && context.mounted) {
                              Navigator.of(context).pop();
                            }
                          },
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
