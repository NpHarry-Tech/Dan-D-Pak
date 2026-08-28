// GENERATED SPLIT of warehouse_screen.dart — actions + view builders.
// extension cùng library nên truy cập nguyên vẹn field/method private của _State.
part of 'warehouse_screen.dart';

extension _WarehouseScreenMethods on _WarehouseScreenState {
  // Áp mã vừa quét (tablet/điện thoại) vào ô tìm + lọc danh sách ngay.
  void _applyScanned(String code) {
    _searchCtrl.text = code;
    _rebuild(() => _search = code);
  }

  Map<String, dynamic>? get _curWh {
    for (final w in _warehouses) {
      if (_s(w['id']) == _activeWh) return w;
    }
    return null;
  }

  bool get _isRetailWh => _s(_curWh?['type']) == 'retail';

  Future<void> _loadAll() async {
    _rebuild(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = context.read<ApiService>();
      final whs = await api.getWarehouses();
      _warehouses = whs
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      if (!_warehouses.any((w) => _s(w['id']) == _activeWh)) {
        _activeWh = _warehouses.isNotEmpty ? _s(_warehouses.first['id']) : '';
      }
      await _loadWarehouseData();
    } catch (e) {
      if (!mounted) return;
      _rebuild(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _loadWarehouseData() async {
    _rebuild(() => _loading = true);
    try {
      final api = context.read<ApiService>();
      final retail = _isRetailWh;
      final results = await Future.wait([
        retail
            ? api.getWarehouseSkus(_activeWh)
            : api.getInventory(warehouseId: _activeWh),
        api.getLots(warehouseId: _activeWh),
        api.getMovements(warehouseId: _activeWh),
        api.getWarehouseDocuments(warehouseId: _activeWh),
      ]);
      if (!mounted) return;
      List<Map<String, dynamic>> mapList(dynamic v) => (v as List)
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      _rebuild(() {
        _stock = mapList(results[0]);
        _lots = mapList(results[1]);
        _movements = mapList(results[2]);
        _documents = mapList(results[3]);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      _rebuild(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  void _toast(String m, {bool error = false}) =>
      appToast(context, m, isError: error);

  Future<void> _receiveOrIssue(Map<String, dynamic> item, bool receive) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => _MoveDialog(
        api: context.read<ApiService>(),
        item: item,
        warehouseId: _activeWh,
        receive: receive,
      ),
    );
    if (ok == true) {
      _toast(receive ? t('Đã nhập kho') : t('Đã xuất kho'));
      _loadWarehouseData();
    }
  }

  Future<void> _addItem({String itemType = 'ingredient'}) async {
    final ok = await showDialog<bool>(
      context: context,
      // warehouseId: mặt hàng phải nằm ĐÚNG kho đang mở. Thiếu tham số này thì
      // server rơi về kho mặc định — người dùng tạo xong không thấy hàng đâu.
      builder: (_) => _NewItemDialog(
          api: context.read<ApiService>(),
          warehouseId: _activeWh,
          itemType: itemType),
    );
    if (ok == true) {
      _toast(t('Đã tạo mặt hàng'));
      _loadWarehouseData();
    }
  }

  /// NÚT "TẠO MỚI" KIỂU KIOTVIET — bấm ra danh sách loại hàng cần tạo.
  ///
  /// Danh sách CHỈ gồm loại hàng backend thật sự có nghiệp vụ:
  ///   • Kho bán lẻ  -> Hàng hóa (bảng `skus`, có giá bán/VAT/đơn vị quy đổi)
  ///   • Kho bếp     -> Nguyên liệu / Vật dụng (`inventory_items.item_type`)
  ///
  /// KiotViet còn có "Dịch vụ", "Combo - đóng gói", "Hàng sản xuất". Ba loại đó
  /// CỐ Ý KHÔNG đưa vào: bảng `skus` không có cột phân loại, không có định mức
  /// combo, không có lệnh sản xuất. Thêm vào chỉ ra menu bấm được mà lưu xuống
  /// thành hàng hóa thường — sai dữ liệu tồn kho và không ai lần ra vì sao.
  Widget _nutTaoMoi() {
    final loai = _isRetailWh
        ? [('sku', t('Hàng hóa'))]
        : [('ingredient', t('Nguyên liệu')), ('supply', t('Vật dụng'))];

    // Một lựa chọn duy nhất thì bày menu là thừa một cú bấm — bấm là mở luôn.
    if (loai.length == 1) {
      return FilledButton.icon(
        onPressed: _isRetailWh ? _createSku : () => _addItem(),
        icon: Icon(Icons.add, size: 18),
        label: Text(t('Tạo mới')),
        style: FilledButton.styleFrom(minimumSize: Size(0, 40)),
      );
    }

    return PopupMenuButton<String>(
      tooltip: t('Tạo mới'),
      position: PopupMenuPosition.under,
      onSelected: (v) => v == 'sku' ? _createSku() : _addItem(itemType: v),
      itemBuilder: (_) => [
        for (final (key, nhan) in loai)
          PopupMenuItem(value: key, child: Text(nhan)),
      ],
      child: FilledButton.icon(
        // Nút chỉ để hiển thị — PopupMenuButton bọc ngoài đã bắt cú bấm rồi.
        onPressed: null,
        icon: Icon(Icons.add, size: 18),
        label: Row(mainAxisSize: MainAxisSize.min, children: [
          Text(t('Tạo mới')),
          SizedBox(width: 2),
          Icon(Icons.keyboard_arrow_down, size: 18),
        ]),
        style: FilledButton.styleFrom(
          minimumSize: Size(0, 40),
          disabledBackgroundColor: DanColors.brand,
          disabledForegroundColor: Colors.white,
        ),
      ),
    );
  }

  /// Các nhóm tính năng: (nhãn nhóm, [[key, nhãn tab], …]).
  List<(String, List<List<String>>)> get _featureGroups => [
        (
          t('Tồn kho'),
          [
            ['stock', t('Tồn kho')],
            ['lots', t('Lô & HSD')],
            ['hist', t('Lịch sử')],
            ['docs', t('Phiếu kho')],
          ]
        ),
        (
          t('Nghiệp vụ kho'),
          [
            ['stocktake', t('Kiểm kho')],
            ['transfer', t('Chuyển hàng')],
            ['internal', t('Xuất nội bộ')],
          ]
        ),
        (
          t('Mua hàng'),
          [
            ['purchase_in', t('Nhập hàng')],
            ['purchase_return', t('Trả hàng nhập')],
            ['suppliers', t('Nhà cung cấp')],
          ]
        ),
        (
          t('Giá bán'),
          [
            ['pricebook', t('Thiết lập giá')],
          ]
        ),
      ];

  /// Hàng 1 — chọn kho làm việc (áp cho mọi tính năng phía dưới).
  Widget _khoBar() {
    return Container(
      width: double.infinity,
      color: DanColors.surface,
      padding: EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      child: Row(
        children: [
          Icon(Icons.warehouse_outlined, size: 16, color: DanColors.muted),
          SizedBox(width: 6),
          Text('${t('Kho')}:',
              style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w800,
                  color: DanColors.muted)),
          SizedBox(width: 10),
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final w in _warehouses) ...[
                    _WhPill(
                      label: _s(w['name']),
                      icon: '',
                      active: _s(w['id']) == _activeWh,
                      onTap: () {
                        _rebuild(() => _activeWh = _s(w['id']));
                        _loadWarehouseData();
                      },
                    ),
                    SizedBox(width: 8),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Hàng 2 — dải tab tính năng gộp, chia nhóm bằng vạch + nhãn nhóm nhỏ.
  Widget _featureBar() {
    return Container(
      width: double.infinity,
      color: DanColors.surface,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: EdgeInsets.symmetric(horizontal: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            for (var g = 0; g < _featureGroups.length; g++) ...[
              if (g > 0)
                Container(
                  width: 1,
                  height: 34,
                  margin: EdgeInsets.symmetric(horizontal: 8),
                  color: DanColors.border,
                ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                    padding: EdgeInsets.only(left: 12, top: 5),
                    child: Text(_featureGroups[g].$1.toUpperCase(),
                        style: TextStyle(
                            fontSize: 9.5,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .6,
                            color: DanColors.faint)),
                  ),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (final f in _featureGroups[g].$2) _featureTab(f),
                    ],
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _featureTab(List<String> f) {
    final active = _feature == f[0];
    return InkWell(
      onTap: () => _selectFeature(f[0]),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: active ? DanColors.brand : Colors.transparent,
              width: 2.5,
            ),
          ),
        ),
        child: Text(f[1],
            style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w800,
                color: active ? DanColors.brand : DanColors.muted)),
      ),
    );
  }

  void _selectFeature(String key) {
    if (key == 'suppliers') {
      // Nhà cung cấp dùng chung danh bạ Liên hệ — mở thẳng tab NCC.
      Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => ContactsScreen(initialType: 'supplier')));
      return;
    }
    _rebuild(() => _feature = key);
  }

  Widget _featureBody() {
    switch (_feature) {
      case 'pricebook':
        return PriceBookPage();
      case 'stocktake':
        return StocktakePage(
            warehouses: _warehouses, initialWarehouseId: _activeWh);
      case 'transfer':
        return WarehouseDocPage(
            docType: WhDocType.transfer,
            warehouses: _warehouses,
            initialWarehouseId: _activeWh);
      case 'internal':
        return WarehouseDocPage(
            docType: WhDocType.internalUse,
            warehouses: _warehouses,
            initialWarehouseId: _activeWh);
      case 'purchase_in':
        return PurchaseDocListPage(
            mode: PurchaseDocMode.purchaseIn,
            warehouses: _warehouses,
            initialWarehouseId: _activeWh);
      case 'purchase_return':
        return PurchaseDocListPage(
            mode: PurchaseDocMode.purchaseReturn,
            warehouses: _warehouses,
            initialWarehouseId: _activeWh);
      default:
        return _body(); // stock | lots | hist | docs — dữ liệu kho đang chọn
    }
  }

  Widget _body() {
    if (_loading && _stock.isEmpty && _warehouses.isEmpty) {
      return Center(child: CircularProgressIndicator());
    }
    if (_error != null && _warehouses.isEmpty) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được kho ($_error)'),
            error: true, onRetry: _loadAll),
      );
    }
    // Kho đã tải nhưng dữ liệu tồn/lô lỗi: báo rõ thay vì hiển thị bảng rỗng
    // khiến người dùng tưởng kho chưa có hàng.
    if (_error != null) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được dữ liệu kho ($_error)'),
            error: true, onRetry: _loadWarehouseData),
      );
    }
    switch (_feature) {
      case 'lots':
        return _lotsView();
      case 'hist':
        return _historyView();
      case 'docs':
        return _docsView();
      default:
        return _stockView();
    }
  }

  // ── Stock ───────────────────────────────────────────────────────────
  // MỘT bố cục Tồn kho DUY NHẤT cho MỌI kho (bếp/nguyên liệu lẫn retail BCM):
  // dùng lại view kiểu KiotViet (sidebar lọc + bảng + panel chi tiết). Các cột/bộ
  // lọc/nút riêng của retail (giá/VAT/thương hiệu) tự ẩn khi kho không phải retail;
  // kho nguyên liệu giữ Nhập/Xuất nhanh + Thêm mặt hàng trong cùng bố cục đó.
  Widget _stockView() => _retailStockView();

  // ── Bảng Tồn kho dùng chung (kiểu KiotViet) ─────────────────────────
  List<Map<String, dynamic>> _retailFiltered() {
    final q = foldSearch(_search);
    return _stock.where((s) {
      if (q.isNotEmpty) {
        final hay =
            foldSearch('${_s(s['code'])} ${_s(s['name'])} ${_s(s['barcode'])}');
        if (!hay.contains(q)) return false;
      }
      if (_catFilter.isNotEmpty && _s(s['category']) != _catFilter)
        return false;
      if (_brandFilter.isNotEmpty && _s(s['brand']) != _brandFilter)
        return false;
      if (_vatFilter.isNotEmpty && _vatLabel(s['vat']) != _vatFilter)
        return false;
      final stock = _n(s['stock']);
      switch (_stockFilter) {
        case 'instock':
          if (stock <= 0) return false;
          break;
        case 'out':
          if (stock > 0) return false;
          break;
        case 'low':
          if (!_b(s['low'])) return false;
          break;
      }
      return true;
    }).toList();
  }

  /// Count distinct values of [key] across the full stock list (for sidebar badges).
  Map<String, int> _countBy(String Function(Map<String, dynamic>) key) {
    final m = <String, int>{};
    for (final s in _stock) {
      final k = key(s);
      if (k.isEmpty) continue;
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }

  /// Giá trị PHÂN BIỆT của 1 trường (category/brand) trong kho — cho dropdown
  /// chọn nhanh khi tạo/sửa hàng, khỏi gõ tay và tránh sai chính tả nhóm hàng.
  List<String> _distinctValues(String key) =>
      (_stock.map((s) => _s(s[key])).where((v) => v.isNotEmpty).toSet().toList()
        ..sort());

  bool get _anyRetailFilter =>
      _catFilter.isNotEmpty ||
      _brandFilter.isNotEmpty ||
      _vatFilter.isNotEmpty ||
      _stockFilter != 'all';

  Widget _retailStockView() {
    final list = _retailFiltered();
    final lowCount = _stock.where((s) => _b(s['low'])).length;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_showFilters) _retailSidebar(),
        Expanded(
          child: Column(
            children: [
              _retailToolbar(list.length, lowCount),
              Divider(height: 1, color: DanColors.border),
              _retailHeader(),
              Divider(height: 1, color: DanColors.border),
              Expanded(
                child: list.isEmpty
                    ? Center(
                        child: Text(t('Không có sản phẩm khớp bộ lọc'),
                            style: TextStyle(color: DanColors.faint)))
                    : RefreshIndicator(
                        onRefresh: _loadWarehouseData,
                        child: ListView.separated(
                          itemCount: list.length,
                          separatorBuilder: (_, __) =>
                              Divider(height: 1, color: DanColors.border),
                          itemBuilder: (_, i) => _retailRow(list[i]),
                        ),
                      ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _retailToolbar(int shown, int lowCount) {
    return Container(
      color: DanColors.surface,
      padding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          IconButton(
            tooltip: _showFilters ? t('Ẩn bộ lọc') : t('Hiện bộ lọc'),
            onPressed: () => _rebuild(() => _showFilters = !_showFilters),
            icon: Icon(
                _showFilters ? Icons.filter_alt : Icons.filter_alt_outlined,
                color: _anyRetailFilter ? DanColors.brand : DanColors.muted),
          ),
          Expanded(
            child: SizedBox(
              height: 40,
              child: TextField(
                controller: _searchCtrl,
                decoration: InputDecoration(
                  hintText: t('Theo mã, tên hàng'),
                  prefixIcon: Icon(Icons.search, size: 20),
                  suffixIcon: ScanIconButton(
                      title: t('Quét mặt hàng'),
                      size: 20,
                      onCode: _applyScanned),
                  isDense: true,
                  filled: true,
                  fillColor: DanColors.surface2,
                  contentPadding: EdgeInsets.symmetric(vertical: 0),
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(DanRadius.sm),
                      borderSide: BorderSide.none),
                ),
                onChanged: (v) => _rebuild(() => _search = v),
              ),
            ),
          ),
          SizedBox(width: 12),
          Text(t('$shown sản phẩm'),
              style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: DanColors.muted)),
          if (lowCount > 0) ...[
            SizedBox(width: 10),
            Container(
              padding: EdgeInsets.symmetric(horizontal: 9, vertical: 6),
              decoration: BoxDecoration(
                  color: DanColors.late.withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(8)),
              child: Text(t('⚠ $lowCount tồn thấp'),
                  style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                      color: DanColors.late)),
            ),
          ],
          SizedBox(width: 6),
          if (context.watch<AuthProvider>().hasPermission('warehouse.item'))
            _nutTaoMoi(),
          // Chọn cột chỉ có ý nghĩa với retail (giá/VAT/thương hiệu).
          if (_isRetailWh)
            IconButton(
              tooltip: t('Chọn cột hiển thị'),
              onPressed: _showColumnPicker,
              icon: Icon(Icons.settings_outlined, color: DanColors.muted),
            ),
        ],
      ),
    );
  }

  // Column widths shared by header + rows so they stay aligned.
  static double _wImg = 48, _wCode = 106, _wBrand = 128, _wPre = 100;
  static double _wVat = 54,
      _wAfter = 106,
      _wStock = 96,
      _wCreated = 116,
      _wAct = 28;

  Widget _retailHeader() {
    Widget h(String t, {TextAlign align = TextAlign.left}) => Text(t,
        textAlign: align,
        style: TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.w800,
            color: DanColors.muted,
            letterSpacing: .2));
    return Container(
      color: DanColors.surface2,
      padding: EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      child: Row(
        children: [
          SizedBox(width: _wImg),
          SizedBox(width: _wCode, child: h(t('Mã hàng'))),
          SizedBox(width: 10),
          Expanded(child: h(t('Tên hàng'))),
          if (_isRetailWh && _colBrand)
            SizedBox(width: _wBrand, child: h(t('Thương hiệu'))),
          if (_isRetailWh && _colPreTax)
            SizedBox(
                width: _wPre,
                child: h(t('Giá trước thuế'), align: TextAlign.right)),
          if (_isRetailWh && _colVat)
            SizedBox(width: _wVat, child: h('VAT', align: TextAlign.center)),
          if (_isRetailWh && _colAfterTax)
            SizedBox(
                width: _wAfter,
                child: h(t('Giá sau thuế'), align: TextAlign.right)),
          SizedBox(
              width: _wStock, child: h(t('Tồn kho'), align: TextAlign.right)),
          if (_colCreated) SizedBox(width: _wCreated, child: h(t('Ngày tạo'))),
          SizedBox(width: _wAct),
        ],
      ),
    );
  }

  Widget _retailRow(Map<String, dynamic> s) {
    final low = _b(s['low']);
    final stock = _n(s['stock']);
    final baseUrl = context.read<ApiService>().baseUrl;
    final expanded = _expandedSku == _s(s['id']);
    Widget money(num v, {bool bold = false}) => Text(
          v <= 0 ? '—' : Fmt.money(v),
          textAlign: TextAlign.right,
          style: TextStyle(
              fontSize: 12.5,
              fontWeight: bold ? FontWeight.w900 : FontWeight.w600,
              color: v <= 0 ? DanColors.faint : DanColors.text),
        );
    // Bấm dòng để mở/đóng panel chi tiết ngay dưới (kiểu KiotViet) — panel
    // mới chứa nút [In tem mã] [Nhập hàng]; trạng thái đóng KHÔNG có nút.
    final row = InkWell(
      onTap: () => _rebuild(() => _expandedSku = expanded ? '' : _s(s['id'])),
      child: Container(
        color: expanded ? DanColors.brandDim : DanColors.surface,
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: [
            SizedBox(
                width: _wImg,
                child: _SkuThumb(
                    baseUrl: baseUrl,
                    image: _s(s['image']),
                    emoji: _s(s['emoji']))),
            SizedBox(
              width: _wCode,
              child: Text(_s(s['code']).isEmpty ? '—' : _s(s['code']),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontFamily: 'JetBrains Mono',
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: DanColors.brand)),
            ),
            SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_s(s['name']),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          height: 1.2)),
                  if (_s(s['barcode']).isNotEmpty)
                    Text(_s(s['barcode']),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style:
                            TextStyle(fontSize: 10.5, color: DanColors.faint)),
                ],
              ),
            ),
            if (_isRetailWh && _colBrand)
              SizedBox(
                width: _wBrand,
                child: Text(_s(s['brand']).isEmpty ? '—' : _s(s['brand']),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12, color: DanColors.muted)),
              ),
            if (_isRetailWh && _colPreTax)
              SizedBox(width: _wPre, child: money(_n(s['price_pre_tax']))),
            if (_isRetailWh && _colVat)
              SizedBox(
                width: _wVat,
                child: Center(
                  child: Text(_vatLabel(s['vat']),
                      style: TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          color: DanColors.muted)),
                ),
              ),
            if (_isRetailWh && _colAfterTax)
              SizedBox(
                  width: _wAfter, child: money(_n(s['price']), bold: true)),
            SizedBox(
              width: _wStock,
              child: Text(
                '${Fmt.int0(stock)} ${_s(s['unit'])}',
                textAlign: TextAlign.right,
                style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                    color: low
                        ? DanColors.late
                        : stock <= 0
                            ? DanColors.faint
                            : DanColors.text),
              ),
            ),
            if (_colCreated)
              SizedBox(
                width: _wCreated,
                child: Text(_shortDate(_s(s['created_at'])),
                    style: TextStyle(fontSize: 11.5, color: DanColors.muted)),
              ),
            SizedBox(
              width: _wAct,
              child: Icon(
                  expanded
                      ? Icons.keyboard_arrow_up
                      : Icons.keyboard_arrow_down,
                  size: 18,
                  color: DanColors.faint),
            ),
          ],
        ),
      ),
    );
    if (!expanded) return row;
    return Column(children: [row, _skuDetailPanel(s)]);
  }

  /// Panel chi tiết SKU mở rộng dưới dòng (KiotViet "Thông tin"): ảnh + lưới
  /// thông số + 2 nút [In tem mã] (máy in tem) và [Nhập hàng] (tạo phiếu PN).
  Widget _skuDetailPanel(Map<String, dynamic> s) {
    final baseUrl = context.read<ApiService>().baseUrl;
    Widget field(String k, String v) => SizedBox(
          width: 210,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(k, style: TextStyle(fontSize: 11.5, color: DanColors.muted)),
              SizedBox(height: 3),
              Text(v.isEmpty ? '—' : v,
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
              SizedBox(height: 4),
              Divider(height: 1, color: DanColors.border),
            ],
          ),
        );
    return Container(
      width: double.infinity,
      color: DanColors.surface,
      padding: EdgeInsets.fromLTRB(20, 14, 20, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                  width: 96,
                  height: 96,
                  child: _SkuThumb(
                      baseUrl: baseUrl,
                      image: _s(s['image']),
                      emoji: _s(s['emoji']),
                      size: 96)),
              SizedBox(width: 18),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Expanded(
                        child: Text(_s(s['name']),
                            style: TextStyle(
                                fontSize: 15.5, fontWeight: FontWeight.w900)),
                      ),
                      if (context
                              .read<AuthProvider>()
                              .hasPermission('warehouse.item') ||
                          context
                              .read<AuthProvider>()
                              .hasPermission('inventory.adjust'))
                        IconButton.filledTonal(
                          tooltip: t('Chỉnh sửa sản phẩm'),
                          onPressed: () => _editSku(s),
                          icon: Icon(Icons.settings_outlined, size: 19),
                          style: IconButton.styleFrom(
                              backgroundColor: Colors.white,
                              foregroundColor: DanColors.brand),
                        ),
                    ]),
                    SizedBox(height: 3),
                    Text(
                        '${t('Nhóm hàng')}: ${_s(s['group_path']).isEmpty ? (_s(s['category']).isEmpty ? '—' : _s(s['category'])) : _s(s['group_path'])}',
                        style: TextStyle(fontSize: 12, color: DanColors.muted)),
                    SizedBox(height: 12),
                    Wrap(
                      spacing: 26,
                      runSpacing: 12,
                      children: [
                        field(t('Mã hàng'), _s(s['code'])),
                        if (_isRetailWh) field(t('Mã vạch'), _s(s['barcode'])),
                        field(t('Tồn kho'),
                            '${Fmt.int0(_n(s['stock']))} ${_s(s['unit'])}'),
                        field(t('Định mức tồn'), Fmt.int0(_n(s['min_stock']))),
                        if (_isRetailWh)
                          field(t('Giá bán trước thuế'),
                              Fmt.money(_n(s['price_pre_tax']))),
                        if (_isRetailWh)
                          field(t('VAT hàng bán'), _vatLabel(s['vat'])),
                        if (_isRetailWh)
                          field(
                              t('Giá bán sau thuế'), Fmt.money(_n(s['price']))),
                        if (_isRetailWh && _s(s['brand']).isNotEmpty)
                          field(t('Thương hiệu'), _s(s['brand'])),
                        if (_s(s['created_at']).isNotEmpty)
                          field(t('Ngày tạo'), _shortDate(_s(s['created_at']))),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            // Retail SKU: [In tem mã] + [Nhập hàng] (phiếu PN theo item_type 'sku').
            // Kho nguyên liệu: [Xuất]/[Nhập] nhanh qua _receiveOrIssue (đúng item_type
            // inventory) — KHÔNG dùng _purchaseFromSku vì nó hardcode item_type='sku'.
            children: _isRetailWh
                ? [
                    OutlinedButton.icon(
                      onPressed: () => _printSkuLabel(s),
                      icon: Icon(Icons.print_outlined, size: 18),
                      label: Text(t('In tem mã')),
                      style: OutlinedButton.styleFrom(minimumSize: Size(0, 42)),
                    ),
                    SizedBox(width: 10),
                    FilledButton.icon(
                      onPressed: () => _purchaseFromSku(s),
                      icon: Icon(Icons.add_shopping_cart, size: 18),
                      label: Text(t('Nhập hàng')),
                      style: FilledButton.styleFrom(minimumSize: Size(0, 42)),
                    ),
                  ]
                : [
                    OutlinedButton.icon(
                      onPressed: () => _receiveOrIssue(s, false),
                      icon: Icon(Icons.remove, size: 18),
                      label: Text(t('Xuất')),
                      style: OutlinedButton.styleFrom(
                          minimumSize: Size(0, 42),
                          foregroundColor: DanColors.late),
                    ),
                    SizedBox(width: 10),
                    FilledButton.icon(
                      onPressed: () => _receiveOrIssue(s, true),
                      icon: Icon(Icons.add, size: 18),
                      label: Text(t('Nhập')),
                      style: FilledButton.styleFrom(minimumSize: Size(0, 42)),
                    ),
                  ],
          ),
        ],
      ),
    );
  }

  Future<void> _editSku(Map<String, dynamic> sku) async {
    final changed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _SkuEditDialog(
          sku: sku,
          warehouseId: _activeWh,
          isRetail: _isRetailWh,
          categories: _distinctValues('category'),
          brands: _distinctValues('brand')),
    );
    if (changed == true) {
      _rebuild(() => _expandedSku = '');
      await _loadWarehouseData();
    }
  }

  Future<void> _createSku() async {
    final changed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _SkuEditDialog(
          warehouseId: _activeWh,
          isRetail: _isRetailWh,
          categories: _distinctValues('category'),
          brands: _distinctValues('brand')),
    );
    if (changed == true) await _loadWarehouseData();
  }

  /// Nút "In tem mã": hỏi số tem rồi đẩy job ra máy in tem đã cấu hình.
  Future<void> _printSkuLabel(Map<String, dynamic> s) async {
    final ctrl = TextEditingController(text: '1');
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(t('In tem mã'),
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
        content: SizedBox(
          width: 300,
          child: TextField(
            controller: ctrl,
            autofocus: true,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(
                labelText: t('Số tem'), helperText: _s(s['name'])),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(t('Hủy'))),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text(t('In tem'))),
        ],
      ),
    );
    final copies = int.tryParse(ctrl.text.trim()) ?? 1;
    ctrl.dispose();
    if (ok != true) return;
    try {
      await context
          .read<ApiService>()
          .printProductLabel(_s(s['id']), copies: copies < 1 ? 1 : copies);
      _toast(t('Đã gửi $copies tem "${_s(s['name'])}" ra máy in tem'));
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  /// Nút "Nhập hàng" trong panel: mở form phiếu nhập với sẵn dòng SKU này.
  Future<void> _purchaseFromSku(Map<String, dynamic> s) async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => PurchaseDocFormPage(
              mode: PurchaseDocMode.purchaseIn,
              warehouses: _warehouses,
              initialWarehouseId: _activeWh,
              existing: {
                'warehouse_id': _activeWh,
                'lines': [
                  {
                    'item_type': 'sku',
                    'item_id': s['id'],
                    'name': s['name'],
                    'unit': s['unit'],
                    'qty': 1,
                    'unit_cost': _n(s['cost']),
                  },
                ],
              },
            )));
    if (changed == true) _loadWarehouseData();
  }

  static String _shortDate(String iso) {
    return BusinessDateTime.date(iso);
  }

  Widget _retailSidebar() {
    final cats = _countBy((s) => _s(s['category']));
    final brands = _countBy((s) => _s(s['brand']));
    final vats = _countBy((s) => _vatLabel(s['vat']));
    final catKeys = cats.keys.toList()..sort();
    final brandKeys = brands.keys.toList()..sort();
    final vatKeys = vats.keys.toList()
      ..sort((a, b) => (num.tryParse(a.replaceAll('%', '')) ?? -1)
          .compareTo(num.tryParse(b.replaceAll('%', '')) ?? -1));
    return Container(
      width: 244,
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border(right: BorderSide(color: DanColors.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(14, 12, 10, 6),
            child: Row(
              children: [
                Text(t('Bộ lọc'),
                    style:
                        TextStyle(fontSize: 13.5, fontWeight: FontWeight.w900)),
                Spacer(),
                if (_anyRetailFilter)
                  TextButton(
                    onPressed: () => _rebuild(_resetRetailFilters),
                    style: TextButton.styleFrom(
                        padding: EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: Size(0, 30),
                        foregroundColor: DanColors.late),
                    child: Text(t('Xóa lọc'), style: TextStyle(fontSize: 12)),
                  ),
              ],
            ),
          ),
          Divider(height: 1, color: DanColors.border),
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                _filterGroup(
                  t('Tồn kho'),
                  initiallyExpanded: true,
                  child: Column(
                    children: [
                      for (final o in [
                        ['all', t('Tất cả')],
                        ['instock', t('Còn hàng')],
                        ['out', t('Hết hàng')],
                        ['low', t('Dưới định mức')],
                      ])
                        _filterOption(o[1], null, _stockFilter == o[0],
                            () => _rebuild(() => _stockFilter = o[0])),
                    ],
                  ),
                ),
                // Nhóm hàng/Thương hiệu/VAT chỉ áp dụng cho retail SKU — ẩn ở kho nguyên liệu.
                if (_isRetailWh)
                  _filterGroup(
                    t('Nhóm hàng'),
                    initiallyExpanded: true,
                    child: _filterList(catKeys, cats, _catFilter,
                        (v) => _rebuild(() => _catFilter = v)),
                  ),
                if (_isRetailWh)
                  _filterGroup(
                    t('Thương hiệu'),
                    child: _filterList(brandKeys, brands, _brandFilter,
                        (v) => _rebuild(() => _brandFilter = v)),
                  ),
                if (_isRetailWh)
                  _filterGroup(
                    t('VAT hàng bán'),
                    child: _filterList(vatKeys, vats, _vatFilter,
                        (v) => _rebuild(() => _vatFilter = v)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _filterGroup(String title,
      {required Widget child, bool initiallyExpanded = false}) {
    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        initiallyExpanded: initiallyExpanded,
        tilePadding: EdgeInsets.symmetric(horizontal: 14),
        childrenPadding: EdgeInsets.fromLTRB(14, 0, 10, 8),
        title: Text(title,
            style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
                color: DanColors.text)),
        children: [child],
      ),
    );
  }

  /// A bounded, scrollable list of single-select filter options (with counts).
  Widget _filterList(List<String> keys, Map<String, int> counts,
      String selected, void Function(String) onSelect) {
    if (keys.isEmpty) {
      return Padding(
        padding: EdgeInsets.symmetric(vertical: 4),
        child:
            Text('—', style: TextStyle(fontSize: 12, color: DanColors.faint)),
      );
    }
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: 240),
      child: Scrollbar(
        child: ListView(
          shrinkWrap: true,
          padding: EdgeInsets.zero,
          children: [
            _filterOption(
                t('Tất cả'), null, selected.isEmpty, () => onSelect('')),
            for (final k in keys)
              _filterOption(k, counts[k], selected == k, () => onSelect(k)),
          ],
        ),
      ),
    );
  }

  Widget _filterOption(
      String label, int? count, bool selected, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: 5, horizontal: 2),
        child: Row(
          children: [
            Icon(selected ? Icons.radio_button_checked : Icons.radio_button_off,
                size: 15, color: selected ? DanColors.brand : DanColors.faint),
            SizedBox(width: 8),
            Expanded(
              child: Text(label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                      color: selected ? DanColors.text : DanColors.muted)),
            ),
            if (count != null)
              Text('$count',
                  style: TextStyle(fontSize: 11, color: DanColors.faint)),
          ],
        ),
      ),
    );
  }

  Future<void> _showColumnPicker() async {
    await showDialog<void>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (ctx, setLocal) {
          Widget row(String label, bool value, ValueChanged<bool> onChanged) =>
              CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                title: Text(label, style: TextStyle(fontSize: 13.5)),
                value: value,
                onChanged: (v) {
                  onChanged(v ?? value);
                  setLocal(() {});
                  _rebuild(() {});
                },
              );
          return AlertDialog(
            backgroundColor: DanColors.surface,
            title: Text(t('Cột hiển thị'),
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
            content: SizedBox(
              width: 300,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  row(t('Thương hiệu'), _colBrand, (v) => _colBrand = v),
                  row(t('Giá bán trước thuế'), _colPreTax,
                      (v) => _colPreTax = v),
                  row(t('VAT hàng bán (%)'), _colVat, (v) => _colVat = v),
                  row(t('Giá bán sau thuế'), _colAfterTax,
                      (v) => _colAfterTax = v),
                  row(t('Ngày tạo'), _colCreated, (v) => _colCreated = v),
                ],
              ),
            ),
            actions: [
              FilledButton(
                  onPressed: () => Navigator.of(ctx).pop(),
                  child: Text('Xong')),
            ],
          );
        },
      ),
    );
  }

  // ── Lots ────────────────────────────────────────────────────────────
  Widget _lotsView() {
    if (_lots.isEmpty) {
      return Center(
          child: Text(t('Chưa có lô hàng nào'),
              style: TextStyle(color: DanColors.faint)));
    }
    final now = DateTime.now();
    return ListView.separated(
      padding: EdgeInsets.all(16),
      itemCount: _lots.length,
      separatorBuilder: (_, __) => SizedBox(height: 8),
      itemBuilder: (_, i) {
        final l = _lots[i];
        final expiry = DateTime.tryParse(_s(l['expiry_date']));
        final daysLeft = expiry?.difference(now).inDays;
        final near = daysLeft != null && daysLeft <= 7;
        return Container(
          padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: DanColors.surface,
            border: Border.all(
                color: near
                    ? DanColors.doing.withValues(alpha: .6)
                    : DanColors.border),
            borderRadius: BorderRadius.circular(DanRadius.md),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                        _s(l['name']).isEmpty
                            ? _s(l['item_name'])
                            : _s(l['name']),
                        style: TextStyle(
                            fontSize: 14, fontWeight: FontWeight.w800)),
                    Text(
                        'Lô ${_s(l['lot_no']).isEmpty ? '—' : _s(l['lot_no'])}${expiry != null ? ' · HSD ${Fmt.dmyHm(expiry).substring(6)}' : ''}',
                        style:
                            TextStyle(fontSize: 11.5, color: DanColors.faint)),
                  ],
                ),
              ),
              Text('${Fmt.int0(_n(l['qty']))} ${_s(l['unit'])}',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
              if (daysLeft != null) ...[
                SizedBox(width: 10),
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                      color: (near ? DanColors.doing : DanColors.done)
                          .withValues(alpha: .14),
                      borderRadius: BorderRadius.circular(6)),
                  child: Text(
                      daysLeft < 0 ? t('Hết hạn') : t('Còn $daysLeft ngày'),
                      style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: daysLeft < 0
                              ? DanColors.late
                              : near
                                  ? DanColors.doing
                                  : DanColors.done)),
                ),
              ],
            ],
          ),
        );
      },
    );
  }

  // ── History (movements) ─────────────────────────────────────────────
  Widget _historyView() {
    final typeMap = {
      'sale': t('Bán retail'),
      'recipe': t('Trừ recipe'),
      'receipt': t('Nhập kho'),
      'opening': t('Mở tồn'),
      'stocktake': t('Kiểm kho'),
      'return': t('Trả hàng'),
      'issue': t('Xuất kho'),
      'transfer_out': t('Chuyển đi'),
      'transfer_in': t('Chuyển đến'),
      'internal_use': t('Xuất nội bộ'),
      'purchase_return': t('Trả hàng nhập'),
    };
    if (_movements.isEmpty) {
      return Center(
          child: Text(t('Chưa có lịch sử kho'),
              style: TextStyle(color: DanColors.faint)));
    }
    return ListView.separated(
      padding: EdgeInsets.all(16),
      itemCount: _movements.length,
      separatorBuilder: (_, __) => Divider(height: 10, color: DanColors.border),
      itemBuilder: (_, i) {
        final m = _movements[i];
        final qty = _n(m['qty']);
        final inbound = qty >= 0;
        final t = BusinessDateTime.parseApi(m['created_at']);
        return Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                  color: inbound ? DanColors.done : DanColors.late,
                  shape: BoxShape.circle),
            ),
            SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                      _s(m['name']).isEmpty
                          ? _s(m['item_name'])
                          : _s(m['name']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 13.5, fontWeight: FontWeight.w700)),
                  Text(
                      '${typeMap[_s(m['type'])] ?? _s(m['type'])}${t != null ? ' · ${Fmt.dmyHm(t)}' : ''}',
                      style: TextStyle(fontSize: 11, color: DanColors.faint)),
                ],
              ),
            ),
            Text('${inbound ? '+' : ''}${Fmt.int0(qty)} ${_s(m['unit'])}',
                style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w800,
                    color: inbound ? DanColors.done : DanColors.late)),
          ],
        );
      },
    );
  }

  // ── Documents ───────────────────────────────────────────────────────
  Widget _docsView() {
    final docLabel = {
      'receipt': t('Nhập kho'),
      'opening': t('Nhập tồn đầu'),
      'issue': t('Xuất kho'),
      'transfer': t('Chuyển kho'),
      'stocktake': t('Điều chỉnh kiểm kê'),
      'internal_use': t('Xuất dùng nội bộ'),
      'purchase_return': t('Trả hàng nhập'),
    };
    if (_documents.isEmpty) {
      return Center(
          child: Text(t('Chưa có phiếu kho nào'),
              style: TextStyle(color: DanColors.faint)));
    }
    return ListView.separated(
      padding: EdgeInsets.all(16),
      itemCount: _documents.length,
      separatorBuilder: (_, __) => SizedBox(height: 8),
      itemBuilder: (_, i) {
        final d = _documents[i];
        final t = BusinessDateTime.parseApi(d['created_at']);
        return Container(
          padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: DanColors.surface,
            border: Border.all(color: DanColors.border),
            borderRadius: BorderRadius.circular(DanRadius.md),
          ),
          child: Row(
            children: [
              Icon(Icons.receipt_long_outlined, color: DanColors.muted),
              SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                        '#${_s(d['code']).isEmpty ? _s(d['id']) : _s(d['code'])}',
                        style: TextStyle(
                            fontFamily: 'JetBrains Mono',
                            fontWeight: FontWeight.w800,
                            color: DanColors.brand)),
                    Text(
                        '${docLabel[_s(d['type'])] ?? _s(d['type'])}${t != null ? ' · ${Fmt.dmyHm(t)}' : ''}',
                        style:
                            TextStyle(fontSize: 11.5, color: DanColors.faint)),
                  ],
                ),
              ),
              if (_n(d['total']) > 0)
                Text(Fmt.money(_n(d['total'])),
                    style:
                        TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800)),
            ],
          ),
        );
      },
    );
  }
}

class _SkuEditDialog extends StatefulWidget {
  final Map<String, dynamic>? sku;
  final String warehouseId;
  // isRetail=false → mặt hàng nguyên liệu/vật dụng (kho bếp): sửa/xóa phải gọi
  // endpoint /inventory, KHÔNG phải /skus (nếu không sẽ báo "SKU không tồn tại").
  final bool isRetail;
  // Nhóm hàng + Thương hiệu đã có trong kho → để dropdown chọn nhanh, vẫn gõ mới được.
  final List<String> categories;
  final List<String> brands;
  const _SkuEditDialog({
    this.sku,
    required this.warehouseId,
    this.isRetail = true,
    this.categories = const [],
    this.brands = const [],
  });

  @override
  State<_SkuEditDialog> createState() => _SkuEditDialogState();
}

class _SkuEditDialogState extends State<_SkuEditDialog> {
  late final TextEditingController name, code, barcode, brand, category, unit;
  late final TextEditingController cost, price, vat, minStock, openingStock;

  /// Tồn kho hiện tại của hàng ĐÃ CÓ — sửa ở đây là đặt lại tồn (kiểm kho).
  late final TextEditingController tonKho;
  late final num _tonBanDau;

  /// GIỚI THIỆU SẢN PHẨM — đoạn văn KHÁCH đọc trên màn catalogue ngoài quầy
  /// (thành phần, xuất xứ, cách dùng). Khác ghi chú nội bộ: cái này ra ngoài.
  late final TextEditingController description;

  /// HSD của LÔ TỒN ĐẦU KỲ. Server từ chối tạo hàng khi vừa bật "Bắt buộc hạn
  /// sử dụng" vừa khai tồn đầu kỳ mà không có ngày — thiếu ô này thì người dùng
  /// gặp lỗi "Tồn đầu kỳ của hàng bắt buộc HSD phải có hạn sử dụng" mà không có
  /// chỗ nào để nhập ngày.
  DateTime? expiryDate;
  final units = <_SkuUnitCtrls>[];
  bool includesVat = true;
  bool trackLot = false;
  bool expiryRequired = false;
  bool busy = false;
  String image = '';

  @override
  void initState() {
    super.initState();
    final s = widget.sku ?? const <String, dynamic>{};
    TextEditingController c(dynamic v) =>
        TextEditingController(text: v?.toString() ?? '');
    name = c(s['name']);
    code = c(s['code']);
    barcode = c(s['barcode']);
    brand = c(s['brand']);
    category = c(s['category']);
    unit = c(s['unit'] ?? 'cái');
    cost = c(s['cost']);
    price = c(s['price']);
    vat = c(s['vat']);
    minStock = c(s['min_stock']);
    openingStock = c('');
    _tonBanDau = _n(s['stock']);
    tonKho = c(widget.sku == null ? '' : _tonBanDau.toString());
    description = c(s['description']);
    includesVat = s['price_includes_vat'] != 0;
    trackLot = s['track_lot'] == 1 || s['track_lot'] == true;
    expiryRequired = s['expiry_required'] == 1 || s['expiry_required'] == true;
    image = s['image']?.toString() ?? '';
    final raw = s['units'];
    if (raw is List) {
      units.addAll(raw.whereType<Map>().map(_SkuUnitCtrls.new));
    }
    // Ô "Hạn sử dụng lô tồn đầu kỳ" chỉ hiện khi có tồn đầu kỳ > 0, nên phải
    // dựng lại form ngay lúc con số đó vượt qua 0 (và khi bị xoá về rỗng).
    openingStock.addListener(() {
      final co = _num(openingStock) > 0;
      if (co != _coTonDauKy && mounted) setState(() => _coTonDauKy = co);
    });
  }

  bool _coTonDauKy = false;

  /// Ai được đặt lại tồn: người sửa hàng hoá hoặc người điều chỉnh tồn kho —
  /// khớp đúng guardAny('warehouse.item','inventory.adjust') của route
  /// /api/skus/:id/adjust, để nút không hiện ra rồi bấm vào bị server từ chối.
  bool get _duocSuaTon {
    final auth = context.read<AuthProvider>();
    return auth.hasPermission('warehouse.item') ||
        auth.hasPermission('inventory.adjust');
  }

  @override
  void dispose() {
    for (final c in [
      name,
      code,
      barcode,
      brand,
      category,
      unit,
      cost,
      price,
      vat,
      minStock,
      openingStock,
      tonKho,
      description
    ]) {
      c.dispose();
    }
    for (final u in units) {
      u.dispose();
    }
    super.dispose();
  }

  num _num(TextEditingController c) =>
      num.tryParse(c.text.trim().replaceAll(',', '.')) ?? 0;

  Future<void> _pickImage() async {
    final path =
        await pickImagePathCross(title: 'Chọn ảnh sản phẩm', context: context);
    if (path == null) return;
    final file = File(path);
    final bytes = await file.readAsBytes();
    if (!mounted || bytes.isEmpty) return;
    setState(() => busy = true);
    try {
      final ext = path.toLowerCase();
      final mime = ext.endsWith('.png')
          ? 'image/png'
          : ext.endsWith('.webp')
              ? 'image/webp'
              : ext.endsWith('.gif')
                  ? 'image/gif'
                  : 'image/jpeg';
      final out = await context.read<ApiService>().uploadSkuImage(
          originalName: file.uri.pathSegments.last,
          mimeType: mime,
          data: base64Encode(bytes));
      if (mounted) setState(() => image = out['url']?.toString() ?? image);
    } catch (e) {
      if (mounted)
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _save() async {
    if (name.text.trim().isEmpty || unit.text.trim().isEmpty) {
      appToast(context, t('Tên sản phẩm và đơn vị gốc là bắt buộc'),
          isError: true);
      return;
    }
    final seen = <String>{unit.text.trim().toLowerCase()};
    for (final u in units) {
      final key = u.name.text.trim().toLowerCase();
      if (key.isEmpty || _num(u.factor) <= 0 || !seen.add(key)) {
        appToast(context,
            t('Tên đơn vị phải khác nhau và hệ số quy đổi phải lớn hơn 0'),
            isError: true);
        return;
      }
    }
    // Bắt lỗi NGAY TRÊN FORM thay vì để server ném ra sau khi bấm Lưu — người
    // dùng thấy ô nào thiếu, không phải đoán từ câu báo lỗi.
    if (widget.sku == null &&
        expiryRequired &&
        _num(openingStock) > 0 &&
        expiryDate == null) {
      appToast(context,
          t('Hàng bắt buộc hạn sử dụng: phải chọn HSD cho lô tồn đầu kỳ'),
          isError: true);
      return;
    }
    setState(() => busy = true);
    try {
      final body = {
        'name': name.text.trim(),
        'code': code.text.trim(),
        'barcode': barcode.text.trim(),
        'brand': brand.text.trim(),
        'category': category.text.trim(),
        'unit': unit.text.trim(),
        'cost': _num(cost),
        'price': _num(price),
        'price_includes_vat': includesVat,
        'vat': vat.text.trim().isEmpty ? null : _num(vat),
        'min_stock': _num(minStock),
        'track_lot': trackLot,
        'expiry_required': expiryRequired,
        'warehouse_id': widget.warehouseId,
        'description': description.text.trim(),
        'image': image,
        'units': [
          for (final u in units)
            {
              'name': u.name.text.trim(),
              'factor': _num(u.factor),
              'barcode': u.barcode.text.trim(),
              'cost': _num(u.cost),
              'price': _num(u.price),
              'price_includes_vat': u.includesVat,
              'vat': u.vat.text.trim().isEmpty ? null : _num(u.vat),
            }
        ],
      };
      if (widget.sku == null) {
        body['opening_stock'] = _num(openingStock);
        // Server dựng lô 'OPENING' cho tồn đầu kỳ; hàng bắt buộc HSD thì lô đó
        // phải có ngày hết hạn, nếu không server từ chối tạo.
        if (expiryDate != null) {
          body['expiry_date'] = expiryDate!.toIso8601String().split('T').first;
        }
        await context.read<ApiService>().createSku(body);
      } else {
        final id = widget.sku!['id'].toString();
        if (widget.isRetail) {
          await context.read<ApiService>().updateSku(id, body);
        } else {
          // Nguyên liệu/vật dụng → endpoint /inventory.
          await context.read<ApiService>().updateInventoryItem(id, body);
        }
        // Tồn đi đường RIÊNG: update chỉ sửa hồ sơ mặt hàng, đổi tồn phải
        // sinh bút toán kiểm kho để còn truy được ai chỉnh và lệch bao nhiêu.
        if (!trackLot && _duocSuaTon && tonKho.text.trim().isNotEmpty) {
          final moi = _num(tonKho);
          if ((moi - _tonBanDau).abs() > 0.000001) {
            if (!mounted) return;
            if (widget.isRetail) {
              await context.read<ApiService>().adjustSkuStock(id, moi);
            } else {
              await context.read<ApiService>().adjustInventoryStock(id, moi);
            }
          }
        }
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => busy = false);
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    }
  }

  Future<void> _delete() async {
    final auth = context.read<AuthProvider>();
    if (!auth.hasPermission('warehouse.delete') &&
        !auth.hasPermission('inventory.adjust')) {
      appToast(context, t('Bạn không có quyền xóa sản phẩm'), isError: true);
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t('Xóa sản phẩm?')),
        content: Text(t(
            'Sản phẩm sẽ được ẩn khỏi danh sách bán và kho; lịch sử tồn vẫn được giữ lại.')),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: Text(t('Hủy'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: DanColors.late),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(t('Xóa')),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => busy = true);
    try {
      final id = widget.sku!['id'].toString();
      if (widget.isRetail) {
        await context.read<ApiService>().deleteSku(id);
      } else {
        await context.read<ApiService>().deleteInventoryItem(id);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => busy = false);
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    }
  }

  Widget _field(String label, TextEditingController c,
      {double width = 205, bool number = false}) {
    return SizedBox(
      width: width,
      child: TextField(
        controller: c,
        keyboardType: number ? TextInputType.number : TextInputType.text,
        decoration: InputDecoration(labelText: t(label), isDense: true),
      ),
    );
  }

  /// Ô CHỌN-HOẶC-TẠO-MỚI: gõ tay để tạo giá trị mới, hoặc bấm mũi tên chọn giá
  /// trị đã có trong kho (nhóm hàng / thương hiệu). Tránh gõ sai chính tả nhóm.
  Widget _pickField(String label, TextEditingController c, List<String> options,
      {double width = 205}) {
    return SizedBox(
      width: width,
      child: TextField(
        controller: c,
        decoration: InputDecoration(
          labelText: t(label),
          isDense: true,
          suffixIcon: options.isEmpty
              ? null
              : PopupMenuButton<String>(
                  icon: const Icon(Icons.arrow_drop_down),
                  tooltip: t('Chọn có sẵn / tạo mới'),
                  itemBuilder: (_) => [
                    for (final o in options)
                      PopupMenuItem<String>(value: o, child: Text(o)),
                  ],
                  onSelected: (v) => setState(() => c.text = v),
                ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final vatRate = _num(vat);
    final salePrice = _num(price);
    final preTax = includesVat && vatRate > 0
        ? salePrice / (1 + vatRate / 100)
        : salePrice;
    return AlertDialog(
      title: Row(children: [
        Expanded(
            child: Text(
                t(widget.sku == null ? 'Tạo hàng hóa' : 'Cập nhật sản phẩm'))),
        IconButton(
            onPressed: busy ? null : _pickImage,
            tooltip: t('Chỉnh sửa hình ảnh'),
            icon: Icon(Icons.add_photo_alternate_outlined)),
      ]),
      content: SizedBox(
        width: 920,
        height: 650,
        child: ListView(children: [
          Wrap(spacing: 12, runSpacing: 12, children: [
            _field('Tên sản phẩm', name, width: 422),
            _field('Mã sản phẩm', code),
            _field('Mã vạch', barcode),
            _pickField('Thương hiệu', brand, widget.brands),
            _pickField('Nhóm hàng', category, widget.categories),
            _field('Đơn vị gốc', unit),
            _field('Giá nhập', cost, number: true),
            _field(includesVat ? 'Giá bán sau VAT' : 'Giá bán trước VAT', price,
                number: true),
            _field('VAT (%)', vat, number: true),
            _field('Định mức tồn thấp nhất', minStock, number: true),
            if (widget.sku == null)
              _field('Tồn đầu kỳ', openingStock, number: true),
            // SỬA TỒN NGAY TẠI ĐÂY cho hàng đã có.
            //
            // Trước đây form chỉ cho nhập "Tồn đầu kỳ" lúc TẠO hàng; mở lại một
            // mặt hàng cũ thì không còn ô nào chỉnh tồn, phải đi đường kiểm kho.
            // Người có quyền sửa hàng hoá thì cũng phải sửa được con số tồn.
            //
            // Hàng quản lý theo LÔ không sửa thẳng ở đây: tồn của nó là tổng các
            // lô, đặt đại một con số thì không biết trừ vào lô nào — phải đi qua
            // phiếu kiểm kho để chỉ rõ từng lô.
            if (widget.sku != null && !trackLot && _duocSuaTon)
              _field('Tồn kho', tonKho, number: true),
          ]),
          // Đoạn giới thiệu này hiện ở cột phải màn catalogue khách — chỗ khách
          // đọc trước khi bấm "Thêm vào giỏ". Để trống thì cột đó chỉ có tên,
          // giá và tình trạng hàng.
          //
          // Tách hẳn thành một khối có tiêu đề riêng: nó là ô chữ nhiều dòng
          // duy nhất trong form, dán sát ngay dưới lưới ô một dòng ở trên thì
          // trông như bị nhét thừa vào. Khoảng thở + nhãn nhóm cho biết đây là
          // phần nội dung cho khách đọc, không phải một thông số kho nữa.
          SizedBox(height: 22),
          Text(t('Nội dung cho khách'),
              style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w900,
                  color: DanColors.muted,
                  letterSpacing: .3)),
          SizedBox(height: 10),
          TextField(
            controller: description,
            maxLines: 5,
            minLines: 3,
            decoration: InputDecoration(
              labelText: t('Giới thiệu sản phẩm'),
              helperText: t(
                  'Hiện cho KHÁCH đọc trên màn catalogue: thành phần, xuất xứ, cách dùng.'),
              alignLabelWithHint: true,
              contentPadding:
                  EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            ),
          ),
          SizedBox(height: 22),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: trackLot,
            onChanged: (v) => setState(() {
              trackLot = v;
              if (!v) expiryRequired = false;
            }),
            title: Text(t('Quản lý theo lô')),
          ),
          if (trackLot)
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: expiryRequired,
              onChanged: (v) => setState(() => expiryRequired = v),
              title: Text(t('Bắt buộc hạn sử dụng')),
            ),
          // Chỉ hỏi HSD khi thật sự cần: hàng mới + bắt buộc HSD + có tồn đầu
          // kỳ. Hỏi lúc nào cũng hỏi thì form dài ra mà đa số không dùng tới.
          if (widget.sku == null && expiryRequired && _num(openingStock) > 0)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(t('Hạn sử dụng lô tồn đầu kỳ')),
              subtitle: Text(expiryDate == null
                  ? t('Chưa chọn — bắt buộc với hàng quản lý hạn sử dụng')
                  : '${expiryDate!.day.toString().padLeft(2, '0')}/'
                      '${expiryDate!.month.toString().padLeft(2, '0')}/'
                      '${expiryDate!.year}'),
              trailing: Icon(Icons.event_outlined),
              onTap: busy
                  ? null
                  : () async {
                      final now = DateTime.now();
                      final picked = await showDatePicker(
                        context: context,
                        initialDate:
                            expiryDate ?? now.add(const Duration(days: 180)),
                        firstDate: now,
                        lastDate: DateTime(now.year + 10),
                      );
                      if (picked != null) setState(() => expiryDate = picked);
                    },
            ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: includesVat,
            onChanged: (v) => setState(() => includesVat = v),
            title: Text(t('Giá bán đã gồm VAT')),
            subtitle: Text(
                '${t('Đơn giá trước VAT')}: ${Fmt.money(preTax)} · ${t('Đơn giá sau VAT')}: ${Fmt.money(includesVat ? salePrice : salePrice * (1 + vatRate / 100))}'),
          ),
          Divider(),
          Row(children: [
            Expanded(
                child: Text(t('Biến thể / đơn vị quy đổi'),
                    style: TextStyle(fontWeight: FontWeight.w900))),
            TextButton.icon(
              onPressed: () => setState(() => units.add(_SkuUnitCtrls({}))),
              icon: Icon(Icons.add),
              label: Text(t('Thêm đơn vị')),
            ),
          ]),
          Text(
              t('Hệ số là số đơn vị gốc trong 1 đơn vị này, ví dụ 1 lốc = 6 chai; 1 thùng = 24 chai.'),
              style: TextStyle(fontSize: 12, color: DanColors.muted)),
          SizedBox(height: 8),
          for (var i = 0; i < units.length; i++)
            Card(
              child: Padding(
                padding: EdgeInsets.all(10),
                child: Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    _field('Tên đơn vị', units[i].name, width: 145),
                    _field('Số đơn vị gốc', units[i].factor,
                        width: 130, number: true),
                    _field('Mã vạch', units[i].barcode, width: 150),
                    _field('Giá nhập', units[i].cost, width: 125, number: true),
                    _field('Giá bán', units[i].price, width: 125, number: true),
                    _field('VAT (%)', units[i].vat, width: 100, number: true),
                    SizedBox(
                      width: 125,
                      child: CheckboxListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        value: units[i].includesVat,
                        title: Text(t('Giá gồm VAT'),
                            style: TextStyle(fontSize: 11.5)),
                        onChanged: (v) =>
                            setState(() => units[i].includesVat = v ?? true),
                      ),
                    ),
                    IconButton(
                      tooltip: t('Xóa đơn vị'),
                      onPressed: () =>
                          setState(() => units.removeAt(i).dispose()),
                      icon: Icon(Icons.delete_outline, color: DanColors.late),
                    ),
                  ],
                ),
              ),
            ),
        ]),
      ),
      actions: [
        if (widget.sku != null &&
            context.read<AuthProvider>().hasPermission('warehouse.delete'))
          TextButton(
            onPressed: busy ? null : _delete,
            style: TextButton.styleFrom(foregroundColor: DanColors.late),
            child: Text(t('Xóa sản phẩm')),
          ),
        TextButton(
            onPressed: busy ? null : () => Navigator.pop(context),
            child: Text(t('Hủy'))),
        FilledButton(
            onPressed: busy ? null : _save,
            child: Text(
                t(widget.sku == null ? 'Lưu hàng hóa' : 'Cập nhật sản phẩm'))),
      ],
    );
  }
}

class _SkuUnitCtrls {
  final name = TextEditingController();
  final factor = TextEditingController();
  final barcode = TextEditingController();
  final cost = TextEditingController();
  final price = TextEditingController();
  final vat = TextEditingController();
  bool includesVat = true;

  _SkuUnitCtrls(Map raw) {
    name.text = raw['name']?.toString() ?? '';
    factor.text = raw['factor']?.toString() ?? '';
    barcode.text = raw['barcode']?.toString() ?? '';
    cost.text = raw['cost']?.toString() ?? '';
    price.text = raw['price']?.toString() ?? '';
    vat.text = raw['vat']?.toString() ?? '';
    includesVat =
        raw['price_includes_vat'] != false && raw['price_includes_vat'] != 0;
  }

  void dispose() {
    name.dispose();
    factor.dispose();
    barcode.dispose();
    cost.dispose();
    price.dispose();
    vat.dispose();
  }
}
