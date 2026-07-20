import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../widgets/dan_top_bar.dart';
import '../../widgets/scan_button.dart';
import '../contacts/contacts_screen.dart';
import '../management/management_widgets.dart';
import '../purchase/purchase_doc_form_page.dart';
import '../purchase/purchase_doc_list_page.dart';
import '../../services/black_box.dart';
import '../../utils/translation.dart';
import 'price_book_page.dart';
import 'stocktake_page.dart';
import 'warehouse_doc_pages.dart';

part 'warehouse_filters.dart';
part 'warehouse_stock_table.dart';
part 'stock_move_dialog.dart';

/// Kho hàng — điều hướng 2 tầng, chọn từ trên xuống:
///   Tầng 1: CHỌN KHO (pill) — áp cho mọi tính năng bên dưới.
///   Tầng 2: CHỌN TÍNH NĂNG — một dải tab gộp chia 4 nhóm:
///     Tồn kho (Tồn kho · Lô & HSD · Lịch sử · Phiếu kho) |
///     Nghiệp vụ kho (Kiểm kho · Chuyển hàng · Xuất nội bộ) |
///     Mua hàng (Nhập hàng · Trả hàng nhập · Nhà cung cấp) | Giá bán.
class WarehouseScreen extends StatefulWidget {
  WarehouseScreen({super.key});

  @override
  State<WarehouseScreen> createState() => _WarehouseScreenState();
}

class _WarehouseScreenState extends State<WarehouseScreen> {
  List<Map<String, dynamic>> _warehouses = [];
  List<Map<String, dynamic>> _stock = [];
  List<Map<String, dynamic>> _lots = [];
  List<Map<String, dynamic>> _movements = [];
  List<Map<String, dynamic>> _documents = [];
  String _activeWh = '';
  // Tính năng đang mở (1 dải tab gộp, chọn kho ở hàng trên):
  // stock | lots | hist | docs | stocktake | transfer | internal |
  // purchase_in | purchase_return | pricebook
  String _feature = 'stock';
  // SKU đang mở rộng panel chi tiết trong bảng Tồn kho retail ('' = đóng hết).
  String _expandedSku = '';
  bool _loading = true;
  String? _error;
  String _search = '';
  final _searchCtrl = TextEditingController();

  // KiotViet-style retail product-list filters (left sidebar).
  bool _showFilters = true;
  String _catFilter = ''; // Nhóm hàng (leaf category); '' = tất cả
  String _brandFilter = ''; // Thương hiệu
  String _vatFilter = ''; // VAT hàng bán label ("8%", "KCT", …)
  String _stockFilter = 'all'; // all | instock | out | low
  // Column picker (gear): the three price/vat columns show by default.
  bool _colPreTax = true;
  bool _colVat = true;
  bool _colAfterTax = true;
  bool _colBrand = false;
  bool _colCreated = false;

  void _resetRetailFilters() {
    _catFilter = '';
    _brandFilter = '';
    _vatFilter = '';
    _stockFilter = 'all';
  }

  @override
  void initState() {
    super.initState();
    BlackBox.screen = 'warehouse';
    _loadAll();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  // Áp mã vừa quét (tablet/điện thoại) vào ô tìm + lọc danh sách ngay.
  void _applyScanned(String code) {
    _searchCtrl.text = code;
    setState(() => _search = code);
  }

  Map<String, dynamic>? get _curWh {
    for (final w in _warehouses) {
      if (_s(w['id']) == _activeWh) return w;
    }
    return null;
  }

  bool get _isRetailWh => _s(_curWh?['type']) == 'retail';

  Future<void> _loadAll() async {
    setState(() {
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
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _loadWarehouseData() async {
    setState(() => _loading = true);
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
      setState(() {
        _stock = mapList(results[0]);
        _lots = mapList(results[1]);
        _movements = mapList(results[2]);
        _documents = mapList(results[3]);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
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

  Future<void> _addItem() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => _NewItemDialog(api: context.read<ApiService>()),
    );
    if (ok == true) {
      _toast(t('Đã tạo mặt hàng'));
      _loadWarehouseData();
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentUser;
    final branch = auth.selectedBranch;

    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: DanModuleTopBar(
        brandName: branch.name.isNotEmpty ? branch.name : branch.id,
        title: t('Kho hàng'),
        subtitle: '',
        titleIcon: Icons.warehouse_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
      ),
      body: Column(
        children: [
          _khoBar(),
          Divider(height: 1, color: DanColors.border),
          _featureBar(),
          Divider(height: 1, color: DanColors.border),
          Expanded(child: _featureBody()),
        ],
      ),
    );
  }

  // ── Điều hướng 2 tầng: (1) chọn KHO → (2) chọn TÍNH NĂNG ────────────────
  // Gộp menu Hàng hóa/Mua hàng cũ + 4 tab Kho/Lô/Lịch sử/Phiếu vào MỘT dải
  // tab nhóm (giống thanh module KiotViet nhưng phẳng, không dropdown).

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
                        setState(() => _activeWh = _s(w['id']));
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
    setState(() => _feature = key);
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
            onPressed: () => setState(() => _showFilters = !_showFilters),
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
                onChanged: (v) => setState(() => _search = v),
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
          // Kho nguyên liệu/vật dụng: thêm mặt hàng thủ công (retail SKU đến từ import).
          if (!_isRetailWh)
            FilledButton.icon(
              onPressed: _addItem,
              icon: Icon(Icons.add, size: 18),
              label: Text(t('Thêm mặt hàng')),
              style: FilledButton.styleFrom(minimumSize: Size(0, 40)),
            ),
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
      onTap: () =>
          setState(() => _expandedSku = expanded ? '' : _s(s['id'])),
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
                    Text(_s(s['name']),
                        style: TextStyle(
                            fontSize: 15.5, fontWeight: FontWeight.w900)),
                    SizedBox(height: 3),
                    Text(
                        '${t('Nhóm hàng')}: ${_s(s['group_path']).isEmpty ? (_s(s['category']).isEmpty ? '—' : _s(s['category'])) : _s(s['group_path'])}',
                        style:
                            TextStyle(fontSize: 12, color: DanColors.muted)),
                    SizedBox(height: 12),
                    Wrap(
                      spacing: 26,
                      runSpacing: 12,
                      children: [
                        field(t('Mã hàng'), _s(s['code'])),
                        if (_isRetailWh) field(t('Mã vạch'), _s(s['barcode'])),
                        field(t('Tồn kho'),
                            '${Fmt.int0(_n(s['stock']))} ${_s(s['unit'])}'),
                        field(t('Định mức tồn'),
                            Fmt.int0(_n(s['min_stock']))),
                        if (_isRetailWh)
                          field(t('Giá bán trước thuế'),
                              Fmt.money(_n(s['price_pre_tax']))),
                        if (_isRetailWh)
                          field(t('VAT hàng bán'), _vatLabel(s['vat'])),
                        if (_isRetailWh)
                          field(t('Giá bán sau thuế'),
                              Fmt.money(_n(s['price']))),
                        if (_isRetailWh && _s(s['brand']).isNotEmpty)
                          field(t('Thương hiệu'), _s(s['brand'])),
                        if (_s(s['created_at']).isNotEmpty)
                          field(t('Ngày tạo'),
                              _shortDate(_s(s['created_at']))),
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
                      style:
                          OutlinedButton.styleFrom(minimumSize: Size(0, 42)),
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
    final t = DateTime.tryParse(iso);
    if (t == null) return iso.isEmpty ? '—' : iso;
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(t.day)}/${two(t.month)}/${t.year}';
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
                    onPressed: () => setState(_resetRetailFilters),
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
                            () => setState(() => _stockFilter = o[0])),
                    ],
                  ),
                ),
                // Nhóm hàng/Thương hiệu/VAT chỉ áp dụng cho retail SKU — ẩn ở kho nguyên liệu.
                if (_isRetailWh)
                  _filterGroup(
                    t('Nhóm hàng'),
                    initiallyExpanded: true,
                    child: _filterList(catKeys, cats, _catFilter,
                        (v) => setState(() => _catFilter = v)),
                  ),
                if (_isRetailWh)
                  _filterGroup(
                    t('Thương hiệu'),
                    child: _filterList(brandKeys, brands, _brandFilter,
                        (v) => setState(() => _brandFilter = v)),
                  ),
                if (_isRetailWh)
                  _filterGroup(
                    t('VAT hàng bán'),
                    child: _filterList(vatKeys, vats, _vatFilter,
                        (v) => setState(() => _vatFilter = v)),
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
                  setState(() {});
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
        final t = DateTime.tryParse(_s(m['created_at']));
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
        final t = DateTime.tryParse(_s(d['created_at']));
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
