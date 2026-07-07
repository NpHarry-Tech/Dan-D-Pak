import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../widgets/dan_top_bar.dart';
import '../management/management_widgets.dart';

String _s(dynamic v) => v?.toString() ?? '';
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;
bool _b(dynamic v) => v == true || v == 1 || v == '1';

/// Resolve a stored relative asset path ("/assets/product-images/kv_x.jpg")
/// against the local-engine base URL, mirroring the web app.
String _assetUrl(String baseUrl, String value) {
  final raw = value.trim();
  if (raw.isEmpty || raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  return '$baseUrl${raw.startsWith('/') ? '' : '/'}$raw';
}

/// KiotViet VAT display: null / empty → "KCT" (không chịu thuế), else "8%".
String _vatLabel(dynamic v) {
  if (v == null || _s(v).isEmpty) return 'KCT';
  final n = _n(v);
  return n == 0 ? '0%' : '${n % 1 == 0 ? n.toInt() : n}%';
}

const _tabs = [
  ['stock', 'Kho'],
  ['lots', 'Lô & HSD'],
  ['hist', 'Lịch sử'],
  ['docs', 'Phiếu nhập/xuất'],
];

const _issueReasons = [
  ['manual_issue', 'Xuất dùng nội bộ'],
  ['waste', 'Hao hụt / hủy'],
  ['damaged', 'Hỏng vỡ'],
  ['sample', 'Dùng mẫu'],
];

/// Native port of the web Kho (warehouse.html): warehouse selector + tabs for
/// stock, lots/expiry, movement history and documents, with receive/issue.
class WarehouseScreen extends StatefulWidget {
  const WarehouseScreen({super.key});

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
  String _tab = 'stock';
  bool _loading = true;
  String? _error;
  String _search = '';

  // KiotViet-style retail product-list filters (left sidebar).
  bool _showFilters = true;
  String _catFilter = '';        // Nhóm hàng (leaf category); '' = tất cả
  String _brandFilter = '';      // Thương hiệu
  String _vatFilter = '';        // VAT hàng bán label ("8%", "KCT", …)
  String _stockFilter = 'all';   // all | instock | out | low
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
    _loadAll();
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
        retail ? api.getWarehouseSkus(_activeWh) : api.getInventory(warehouseId: _activeWh),
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

  void _toast(String m, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(m), backgroundColor: error ? DanColors.late : DanColors.text));
  }

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
      _toast(receive ? 'Đã nhập kho' : 'Đã xuất kho');
      _loadWarehouseData();
    }
  }

  Future<void> _addItem() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => _NewItemDialog(api: context.read<ApiService>()),
    );
    if (ok == true) {
      _toast('Đã tạo mặt hàng');
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
        title: 'Kho hàng',
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
          _warehouseBar(),
          _tabBar(),
          const Divider(height: 1, color: DanColors.border),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _warehouseBar() {
    return Container(
      width: double.infinity,
      color: DanColors.surface,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
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
              const SizedBox(width: 8),
            ],
          ],
        ),
      ),
    );
  }

  Widget _tabBar() {
    return Container(
      width: double.infinity,
      color: DanColors.surface,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          for (final t in _tabs)
            InkWell(
              onTap: () => setState(() => _tab = t[0]),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(
                      color: _tab == t[0] ? DanColors.brand : Colors.transparent,
                      width: 2.5,
                    ),
                  ),
                ),
                child: Text(t[1],
                    style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w800,
                        color: _tab == t[0] ? DanColors.brand : DanColors.muted)),
              ),
            ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading && _stock.isEmpty && _warehouses.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _warehouses.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage('Không tải được kho ($_error)',
            error: true, onRetry: _loadAll),
      );
    }
    // Kho đã tải nhưng dữ liệu tồn/lô lỗi: báo rõ thay vì hiển thị bảng rỗng
    // khiến người dùng tưởng kho chưa có hàng.
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage('Không tải được dữ liệu kho ($_error)',
            error: true, onRetry: _loadWarehouseData),
      );
    }
    switch (_tab) {
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
  Widget _stockView() =>
      _isRetailWh ? _retailStockView() : _kitchenStockView();

  // Kitchen warehouse (nguyên liệu / vật dụng bếp): simple card list.
  Widget _kitchenStockView() {
    final q = _search.trim().toLowerCase();
    final list = q.isEmpty
        ? _stock
        : _stock.where((s) => _s(s['name']).toLowerCase().contains(q)).toList();
    final lowCount = _stock.where((s) => _b(s['low'])).length;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  decoration: const InputDecoration(
                      hintText: 'Tìm mặt hàng…',
                      prefixIcon: Icon(Icons.search),
                      isDense: true),
                  onChanged: (v) => setState(() => _search = v),
                ),
              ),
              const SizedBox(width: 12),
              if (lowCount > 0)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                  decoration: BoxDecoration(
                      color: DanColors.late.withValues(alpha: .12),
                      borderRadius: BorderRadius.circular(8)),
                  child: Text('⚠ $lowCount tồn thấp',
                      style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                          color: DanColors.late)),
                ),
              const SizedBox(width: 8),
              if (!_isRetailWh)
                FilledButton.icon(
                  onPressed: _addItem,
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Thêm mặt hàng'),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                ),
            ],
          ),
        ),
        const Divider(height: 1, color: DanColors.border),
        Expanded(
          child: list.isEmpty
              ? const Center(
                  child: Text('Kho trống', style: TextStyle(color: DanColors.faint)))
              : RefreshIndicator(
                  onRefresh: _loadWarehouseData,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) => _stockRow(list[i]),
                  ),
                ),
        ),
      ],
    );
  }

  Widget _stockRow(Map<String, dynamic> s) {
    final low = _b(s['low']);
    final stock = _n(s['stock']);
    final minStock = _n(s['min_stock']);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: low ? DanColors.late.withValues(alpha: .5) : DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_s(s['name']),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 14, fontWeight: FontWeight.w800)),
                Text('Định mức tối thiểu: ${Fmt.int0(minStock)} ${_s(s['unit'])}',
                    style: const TextStyle(fontSize: 11.5, color: DanColors.faint)),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('${Fmt.int0(stock)} ${_s(s['unit'])}',
                  style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                      color: low ? DanColors.late : DanColors.text)),
              if (low)
                const Text('Tồn thấp',
                    style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                        color: DanColors.late)),
            ],
          ),
          const SizedBox(width: 12),
          OutlinedButton(
            onPressed: () => _receiveOrIssue(s, true),
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 38)),
            child: const Text('Nhập'),
          ),
          const SizedBox(width: 6),
          OutlinedButton(
            onPressed: () => _receiveOrIssue(s, false),
            style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 38), foregroundColor: DanColors.late),
            child: const Text('Xuất'),
          ),
        ],
      ),
    );
  }

  // ── Retail: KiotViet-style product list ─────────────────────────────
  List<Map<String, dynamic>> _retailFiltered() {
    final q = _search.trim().toLowerCase();
    return _stock.where((s) {
      if (q.isNotEmpty) {
        final hay =
            '${_s(s['code'])} ${_s(s['name'])} ${_s(s['barcode'])}'.toLowerCase();
        if (!hay.contains(q)) return false;
      }
      if (_catFilter.isNotEmpty && _s(s['category']) != _catFilter) return false;
      if (_brandFilter.isNotEmpty && _s(s['brand']) != _brandFilter) return false;
      if (_vatFilter.isNotEmpty && _vatLabel(s['vat']) != _vatFilter) return false;
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
              const Divider(height: 1, color: DanColors.border),
              _retailHeader(),
              const Divider(height: 1, color: DanColors.border),
              Expanded(
                child: list.isEmpty
                    ? const Center(
                        child: Text('Không có sản phẩm khớp bộ lọc',
                            style: TextStyle(color: DanColors.faint)))
                    : RefreshIndicator(
                        onRefresh: _loadWarehouseData,
                        child: ListView.separated(
                          itemCount: list.length,
                          separatorBuilder: (_, __) =>
                              const Divider(height: 1, color: DanColors.border),
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
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          IconButton(
            tooltip: _showFilters ? 'Ẩn bộ lọc' : 'Hiện bộ lọc',
            onPressed: () => setState(() => _showFilters = !_showFilters),
            icon: Icon(_showFilters ? Icons.filter_alt : Icons.filter_alt_outlined,
                color: _anyRetailFilter ? DanColors.brand : DanColors.muted),
          ),
          Expanded(
            child: SizedBox(
              height: 40,
              child: TextField(
                decoration: InputDecoration(
                  hintText: 'Theo mã, tên hàng',
                  prefixIcon: const Icon(Icons.search, size: 20),
                  isDense: true,
                  filled: true,
                  fillColor: DanColors.surface2,
                  contentPadding: const EdgeInsets.symmetric(vertical: 0),
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(DanRadius.sm),
                      borderSide: BorderSide.none),
                ),
                onChanged: (v) => setState(() => _search = v),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Text('$shown sản phẩm',
              style: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: DanColors.muted)),
          if (lowCount > 0) ...[
            const SizedBox(width: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
              decoration: BoxDecoration(
                  color: DanColors.late.withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(8)),
              child: Text('⚠ $lowCount tồn thấp',
                  style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                      color: DanColors.late)),
            ),
          ],
          const SizedBox(width: 6),
          IconButton(
            tooltip: 'Chọn cột hiển thị',
            onPressed: _showColumnPicker,
            icon: const Icon(Icons.settings_outlined, color: DanColors.muted),
          ),
        ],
      ),
    );
  }

  // Column widths shared by header + rows so they stay aligned.
  static const double _wImg = 48, _wCode = 106, _wBrand = 128, _wPre = 100;
  static const double _wVat = 54, _wAfter = 106, _wStock = 96, _wCreated = 116, _wAct = 92;

  Widget _retailHeader() {
    Widget h(String t, {TextAlign align = TextAlign.left}) => Text(t,
        textAlign: align,
        style: const TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.w800,
            color: DanColors.muted,
            letterSpacing: .2));
    return Container(
      color: DanColors.surface2,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      child: Row(
        children: [
          const SizedBox(width: _wImg),
          SizedBox(width: _wCode, child: h('Mã hàng')),
          const SizedBox(width: 10),
          Expanded(child: h('Tên hàng')),
          if (_colBrand) SizedBox(width: _wBrand, child: h('Thương hiệu')),
          if (_colPreTax)
            SizedBox(width: _wPre, child: h('Giá trước thuế', align: TextAlign.right)),
          if (_colVat) SizedBox(width: _wVat, child: h('VAT', align: TextAlign.center)),
          if (_colAfterTax)
            SizedBox(width: _wAfter, child: h('Giá sau thuế', align: TextAlign.right)),
          SizedBox(width: _wStock, child: h('Tồn kho', align: TextAlign.right)),
          if (_colCreated) SizedBox(width: _wCreated, child: h('Ngày tạo')),
          const SizedBox(width: _wAct),
        ],
      ),
    );
  }

  Widget _retailRow(Map<String, dynamic> s) {
    final low = _b(s['low']);
    final stock = _n(s['stock']);
    final baseUrl = context.read<ApiService>().baseUrl;
    Widget money(num v, {bool bold = false}) => Text(
          v <= 0 ? '—' : Fmt.money(v),
          textAlign: TextAlign.right,
          style: TextStyle(
              fontSize: 12.5,
              fontWeight: bold ? FontWeight.w900 : FontWeight.w600,
              color: v <= 0 ? DanColors.faint : DanColors.text),
        );
    return InkWell(
      onTap: () => _showSkuDetail(s),
      child: Container(
        color: DanColors.surface,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
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
                  style: const TextStyle(
                      fontFamily: 'JetBrains Mono',
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: DanColors.brand)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_s(s['name']),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 13, fontWeight: FontWeight.w700, height: 1.2)),
                  if (_s(s['barcode']).isNotEmpty)
                    Text(_s(s['barcode']),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 10.5, color: DanColors.faint)),
                ],
              ),
            ),
            if (_colBrand)
              SizedBox(
                width: _wBrand,
                child: Text(_s(s['brand']).isEmpty ? '—' : _s(s['brand']),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: DanColors.muted)),
              ),
            if (_colPreTax) SizedBox(width: _wPre, child: money(_n(s['price_pre_tax']))),
            if (_colVat)
              SizedBox(
                width: _wVat,
                child: Center(
                  child: Text(_vatLabel(s['vat']),
                      style: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          color: DanColors.muted)),
                ),
              ),
            if (_colAfterTax)
              SizedBox(width: _wAfter, child: money(_n(s['price']), bold: true)),
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
                    style: const TextStyle(fontSize: 11.5, color: DanColors.muted)),
              ),
            SizedBox(
              width: _wAct,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  _RowIcon(
                      icon: Icons.add,
                      tooltip: 'Nhập kho',
                      color: DanColors.brand,
                      onTap: () => _receiveOrIssue(s, true)),
                  _RowIcon(
                      icon: Icons.remove,
                      tooltip: 'Xuất kho',
                      color: DanColors.late,
                      onTap: () => _receiveOrIssue(s, false)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
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
      decoration: const BoxDecoration(
        color: DanColors.surface,
        border: Border(right: BorderSide(color: DanColors.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 10, 6),
            child: Row(
              children: [
                const Text('Bộ lọc',
                    style: TextStyle(
                        fontSize: 13.5, fontWeight: FontWeight.w900)),
                const Spacer(),
                if (_anyRetailFilter)
                  TextButton(
                    onPressed: () => setState(_resetRetailFilters),
                    style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: const Size(0, 30),
                        foregroundColor: DanColors.late),
                    child: const Text('Xóa lọc', style: TextStyle(fontSize: 12)),
                  ),
              ],
            ),
          ),
          const Divider(height: 1, color: DanColors.border),
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                _filterGroup(
                  'Tồn kho',
                  initiallyExpanded: true,
                  child: Column(
                    children: [
                      for (final o in const [
                        ['all', 'Tất cả'],
                        ['instock', 'Còn hàng'],
                        ['out', 'Hết hàng'],
                        ['low', 'Dưới định mức'],
                      ])
                        _filterOption(o[1], null, _stockFilter == o[0],
                            () => setState(() => _stockFilter = o[0])),
                    ],
                  ),
                ),
                _filterGroup(
                  'Nhóm hàng',
                  initiallyExpanded: true,
                  child: _filterList(catKeys, cats, _catFilter,
                      (v) => setState(() => _catFilter = v)),
                ),
                _filterGroup(
                  'Thương hiệu',
                  child: _filterList(brandKeys, brands, _brandFilter,
                      (v) => setState(() => _brandFilter = v)),
                ),
                _filterGroup(
                  'VAT hàng bán',
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
        tilePadding: const EdgeInsets.symmetric(horizontal: 14),
        childrenPadding: const EdgeInsets.fromLTRB(14, 0, 10, 8),
        title: Text(title,
            style: const TextStyle(
                fontSize: 12.5, fontWeight: FontWeight.w800, color: DanColors.text)),
        children: [child],
      ),
    );
  }

  /// A bounded, scrollable list of single-select filter options (with counts).
  Widget _filterList(List<String> keys, Map<String, int> counts, String selected,
      void Function(String) onSelect) {
    if (keys.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 4),
        child: Text('—', style: TextStyle(fontSize: 12, color: DanColors.faint)),
      );
    }
    return ConstrainedBox(
      constraints: const BoxConstraints(maxHeight: 240),
      child: Scrollbar(
        child: ListView(
          shrinkWrap: true,
          padding: EdgeInsets.zero,
          children: [
            _filterOption('Tất cả', null, selected.isEmpty, () => onSelect('')),
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
        padding: const EdgeInsets.symmetric(vertical: 5, horizontal: 2),
        child: Row(
          children: [
            Icon(selected ? Icons.radio_button_checked : Icons.radio_button_off,
                size: 15, color: selected ? DanColors.brand : DanColors.faint),
            const SizedBox(width: 8),
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
                  style: const TextStyle(fontSize: 11, color: DanColors.faint)),
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
                title: Text(label, style: const TextStyle(fontSize: 13.5)),
                value: value,
                onChanged: (v) {
                  onChanged(v ?? value);
                  setLocal(() {});
                  setState(() {});
                },
              );
          return AlertDialog(
            backgroundColor: DanColors.surface,
            title: const Text('Cột hiển thị',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
            content: SizedBox(
              width: 300,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  row('Thương hiệu', _colBrand, (v) => _colBrand = v),
                  row('Giá bán trước thuế', _colPreTax, (v) => _colPreTax = v),
                  row('VAT hàng bán (%)', _colVat, (v) => _colVat = v),
                  row('Giá bán sau thuế', _colAfterTax, (v) => _colAfterTax = v),
                  row('Ngày tạo', _colCreated, (v) => _colCreated = v),
                ],
              ),
            ),
            actions: [
              FilledButton(
                  onPressed: () => Navigator.of(ctx).pop(),
                  child: const Text('Xong')),
            ],
          );
        },
      ),
    );
  }

  Future<void> _showSkuDetail(Map<String, dynamic> s) async {
    final baseUrl = context.read<ApiService>().baseUrl;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: DanColors.surface,
      showDragHandle: true,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) {
        Widget kv(String k, String v) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 5),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                      width: 140,
                      child: Text(k,
                          style: const TextStyle(
                              fontSize: 12.5, color: DanColors.muted))),
                  Expanded(
                    child: Text(v,
                        style: const TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w600)),
                  ),
                ],
              ),
            );
        return Padding(
          padding: EdgeInsets.fromLTRB(
              20, 4, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                      width: 64,
                      height: 64,
                      child: _SkuThumb(
                          baseUrl: baseUrl,
                          image: _s(s['image']),
                          emoji: _s(s['emoji']),
                          size: 64)),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(_s(s['name']),
                            style: const TextStyle(
                                fontSize: 16, fontWeight: FontWeight.w900)),
                        const SizedBox(height: 2),
                        Text('${_s(s['code'])} · ${_s(s['barcode'])}',
                            style: const TextStyle(
                                fontSize: 12, color: DanColors.faint)),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              kv('Nhóm hàng', _s(s['group_path']).isEmpty ? _s(s['category']) : _s(s['group_path'])),
              if (_s(s['brand']).isNotEmpty) kv('Thương hiệu', _s(s['brand'])),
              kv('Giá bán trước thuế', Fmt.money(_n(s['price_pre_tax']))),
              kv('VAT hàng bán', _vatLabel(s['vat'])),
              kv('Giá bán sau thuế', Fmt.money(_n(s['price']))),
              kv('Tồn kho', '${Fmt.int0(_n(s['stock']))} ${_s(s['unit'])}'),
              kv('Định mức tối thiểu', '${Fmt.int0(_n(s['min_stock']))} ${_s(s['unit'])}'),
              if (_s(s['created_at']).isNotEmpty)
                kv('Ngày tạo', _shortDate(_s(s['created_at']))),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () {
                        Navigator.of(context).pop();
                        _receiveOrIssue(s, true);
                      },
                      icon: const Icon(Icons.add, size: 18),
                      label: const Text('Nhập kho'),
                      style: FilledButton.styleFrom(minimumSize: const Size(0, 46)),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () {
                        Navigator.of(context).pop();
                        _receiveOrIssue(s, false);
                      },
                      icon: const Icon(Icons.remove, size: 18),
                      label: const Text('Xuất kho'),
                      style: OutlinedButton.styleFrom(
                          minimumSize: const Size(0, 46),
                          foregroundColor: DanColors.late),
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  // ── Lots ────────────────────────────────────────────────────────────
  Widget _lotsView() {
    if (_lots.isEmpty) {
      return const Center(
          child: Text('Chưa có lô hàng nào',
              style: TextStyle(color: DanColors.faint)));
    }
    final now = DateTime.now();
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _lots.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, i) {
        final l = _lots[i];
        final expiry = DateTime.tryParse(_s(l['expiry_date']));
        final daysLeft = expiry?.difference(now).inDays;
        final near = daysLeft != null && daysLeft <= 7;
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: DanColors.surface,
            border: Border.all(
                color: near ? DanColors.doing.withValues(alpha: .6) : DanColors.border),
            borderRadius: BorderRadius.circular(DanRadius.md),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_s(l['name']).isEmpty ? _s(l['item_name']) : _s(l['name']),
                        style: const TextStyle(
                            fontSize: 14, fontWeight: FontWeight.w800)),
                    Text(
                        'Lô ${_s(l['lot_no']).isEmpty ? '—' : _s(l['lot_no'])}${expiry != null ? ' · HSD ${Fmt.dmyHm(expiry).substring(6)}' : ''}',
                        style: const TextStyle(
                            fontSize: 11.5, color: DanColors.faint)),
                  ],
                ),
              ),
              Text('${Fmt.int0(_n(l['qty']))} ${_s(l['unit'])}',
                  style: const TextStyle(
                      fontSize: 14, fontWeight: FontWeight.w800)),
              if (daysLeft != null) ...[
                const SizedBox(width: 10),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                      color: (near ? DanColors.doing : DanColors.done)
                          .withValues(alpha: .14),
                      borderRadius: BorderRadius.circular(6)),
                  child: Text(
                      daysLeft < 0 ? 'Hết hạn' : 'Còn $daysLeft ngày',
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
    const typeMap = {
      'sale': 'Bán retail',
      'recipe': 'Trừ recipe',
      'receipt': 'Nhập kho',
      'opening': 'Mở tồn',
      'stocktake': 'Kiểm kho',
      'return': 'Trả hàng',
      'issue': 'Xuất kho',
      'transfer_out': 'Chuyển đi',
      'transfer_in': 'Chuyển đến',
    };
    if (_movements.isEmpty) {
      return const Center(
          child: Text('Chưa có lịch sử kho',
              style: TextStyle(color: DanColors.faint)));
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _movements.length,
      separatorBuilder: (_, __) => const Divider(height: 10, color: DanColors.border),
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
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_s(m['name']).isEmpty ? _s(m['item_name']) : _s(m['name']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 13.5, fontWeight: FontWeight.w700)),
                  Text(
                      '${typeMap[_s(m['type'])] ?? _s(m['type'])}${t != null ? ' · ${Fmt.dmyHm(t)}' : ''}',
                      style: const TextStyle(
                          fontSize: 11, color: DanColors.faint)),
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
    const docLabel = {
      'receipt': 'Nhập kho',
      'opening': 'Nhập tồn đầu',
      'issue': 'Xuất kho',
      'transfer': 'Chuyển kho',
      'stocktake': 'Điều chỉnh kiểm kê',
    };
    if (_documents.isEmpty) {
      return const Center(
          child: Text('Chưa có phiếu kho nào',
              style: TextStyle(color: DanColors.faint)));
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _documents.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, i) {
        final d = _documents[i];
        final t = DateTime.tryParse(_s(d['created_at']));
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: DanColors.surface,
            border: Border.all(color: DanColors.border),
            borderRadius: BorderRadius.circular(DanRadius.md),
          ),
          child: Row(
            children: [
              const Icon(Icons.receipt_long_outlined, color: DanColors.muted),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('#${_s(d['code']).isEmpty ? _s(d['id']) : _s(d['code'])}',
                        style: const TextStyle(
                            fontFamily: 'JetBrains Mono',
                            fontWeight: FontWeight.w800,
                            color: DanColors.brand)),
                    Text(
                        '${docLabel[_s(d['type'])] ?? _s(d['type'])}${t != null ? ' · ${Fmt.dmyHm(t)}' : ''}',
                        style: const TextStyle(
                            fontSize: 11.5, color: DanColors.faint)),
                  ],
                ),
              ),
              if (_n(d['total']) > 0)
                Text(Fmt.money(_n(d['total'])),
                    style: const TextStyle(
                        fontSize: 13.5, fontWeight: FontWeight.w800)),
            ],
          ),
        );
      },
    );
  }
}

class _WhPill extends StatelessWidget {
  final String label;
  final String icon;
  final bool active;
  final VoidCallback onTap;
  const _WhPill(
      {required this.label,
      required this.icon,
      required this.active,
      required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(DanRadius.sm),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(
          color: active ? DanColors.brand : DanColors.surface2,
          borderRadius: BorderRadius.circular(DanRadius.sm),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(icon, style: const TextStyle(fontSize: 15)),
            const SizedBox(width: 7),
            Text(label,
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: active ? Colors.white : DanColors.text)),
          ],
        ),
      ),
    );
  }
}

/// Product thumbnail with emoji fallback (retail KiotViet-style list).
class _SkuThumb extends StatelessWidget {
  final String baseUrl;
  final String image;
  final String emoji;
  final double size;
  const _SkuThumb({
    required this.baseUrl,
    required this.image,
    required this.emoji,
    this.size = 40,
  });

  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
          color: DanColors.surface2,
          borderRadius: BorderRadius.circular(DanRadius.sm)),
      alignment: Alignment.center,
      child: Text(emoji.isEmpty ? '📦' : emoji,
          style: TextStyle(fontSize: size * .5)),
    );
    if (image.trim().isEmpty) return placeholder;
    return ClipRRect(
      borderRadius: BorderRadius.circular(DanRadius.sm),
      child: Image.network(
        _assetUrl(baseUrl, image),
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => placeholder,
        loadingBuilder: (ctx, child, prog) => prog == null ? child : placeholder,
      ),
    );
  }
}

/// Compact tinted icon button used in retail row actions.
class _RowIcon extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final Color color;
  final VoidCallback onTap;
  const _RowIcon({
    required this.icon,
    required this.tooltip,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(6),
        child: Container(
          width: 30,
          height: 30,
          margin: const EdgeInsets.only(left: 4),
          decoration: BoxDecoration(
            color: color.withValues(alpha: .10),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Icon(icon, size: 17, color: color),
        ),
      ),
    );
  }
}

/// Receive / issue dialog.
class _MoveDialog extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic> item;
  final String warehouseId;
  final bool receive;

  const _MoveDialog({
    required this.api,
    required this.item,
    required this.warehouseId,
    required this.receive,
  });

  @override
  State<_MoveDialog> createState() => _MoveDialogState();
}

class _MoveDialogState extends State<_MoveDialog> {
  final _qty = TextEditingController();
  final _lot = TextEditingController();
  final _expiry = TextEditingController();
  final _cost = TextEditingController(text: '0');
  final _supplier = TextEditingController();
  String _reason = 'manual_issue';
  bool _saving = false;

  @override
  void dispose() {
    _qty.dispose();
    _lot.dispose();
    _expiry.dispose();
    _cost.dispose();
    _supplier.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final qty = double.tryParse(_qty.text.trim()) ?? 0;
    if (qty <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Số lượng không hợp lệ'),
          backgroundColor: DanColors.late));
      return;
    }
    final body = <String, dynamic>{
      'warehouse_id': widget.warehouseId,
      'stock_type': _s(widget.item['stock_type']).isEmpty
          ? _s(widget.item['item_type'])
          : _s(widget.item['stock_type']),
      'item_id': _s(widget.item['id']),
      'qty': qty,
    };
    if (widget.receive) {
      body['lot_no'] = _lot.text.trim();
      body['expiry_date'] = _expiry.text.trim().isEmpty ? null : _expiry.text.trim();
      body['unit_cost'] = double.tryParse(_cost.text.trim()) ?? 0;
      body['supplier'] = _supplier.text.trim();
    } else {
      body['reason'] = _reason;
    }
    setState(() => _saving = true);
    try {
      if (widget.receive) {
        await widget.api.receiveStock(body);
      } else {
        await widget.api.issueStock(body);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: DanColors.late));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final unit = _s(widget.item['unit']);
    return AlertDialog(
      backgroundColor: DanColors.surface,
      title: Text(
          '${widget.receive ? 'Phiếu nhập' : 'Phiếu xuất'} · ${_s(widget.item['name'])}',
          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
      content: SizedBox(
        width: 380,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _qty,
              autofocus: true,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                  labelText: 'Số lượng ($unit)', isDense: true),
            ),
            const SizedBox(height: 12),
            if (widget.receive) ...[
              TextField(
                  controller: _lot,
                  decoration: const InputDecoration(
                      labelText: 'Số lô (tuỳ chọn)', isDense: true)),
              const SizedBox(height: 12),
              TextField(
                  controller: _expiry,
                  decoration: const InputDecoration(
                      labelText: 'Hạn dùng (YYYY-MM-DD)', isDense: true)),
              const SizedBox(height: 12),
              TextField(
                  controller: _cost,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                      labelText: 'Giá vốn / đơn vị', isDense: true)),
              const SizedBox(height: 12),
              TextField(
                  controller: _supplier,
                  decoration: const InputDecoration(
                      labelText: 'Nhà cung cấp', isDense: true)),
            ] else
              DropdownButtonFormField<String>(
                initialValue: _reason,
                decoration: const InputDecoration(labelText: 'Lý do xuất'),
                items: [
                  for (final r in _issueReasons)
                    DropdownMenuItem(value: r[0], child: Text(r[1])),
                ],
                onChanged: (v) => setState(() => _reason = v ?? _reason),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(), child: const Text('Hủy')),
        FilledButton(
          onPressed: _saving ? null : _save,
          style: FilledButton.styleFrom(
              backgroundColor: widget.receive ? DanColors.brand : DanColors.late),
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : Text(widget.receive ? 'Nhập kho' : 'Xuất kho'),
        ),
      ],
    );
  }
}

/// New inventory item (kitchen warehouse).
class _NewItemDialog extends StatefulWidget {
  final ApiService api;
  const _NewItemDialog({required this.api});

  @override
  State<_NewItemDialog> createState() => _NewItemDialogState();
}

class _NewItemDialogState extends State<_NewItemDialog> {
  final _name = TextEditingController();
  final _unit = TextEditingController(text: 'cái');
  final _cost = TextEditingController(text: '0');
  String _itemType = 'ingredient';
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _unit.dispose();
    _cost.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Nhập tên mặt hàng'), backgroundColor: DanColors.late));
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.api.createInventoryItem({
        'name': _name.text.trim(),
        'unit': _unit.text.trim(),
        'cost': double.tryParse(_cost.text.trim()) ?? 0,
        'item_type': _itemType,
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: DanColors.late));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: DanColors.surface,
      title: const Text('Thêm mặt hàng kho',
          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
                controller: _name,
                decoration: const InputDecoration(labelText: 'Tên mặt hàng')),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                      controller: _unit,
                      decoration: const InputDecoration(labelText: 'Đơn vị')),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                      controller: _cost,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Giá vốn')),
                ),
              ],
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _itemType,
              decoration: const InputDecoration(labelText: 'Loại'),
              items: const [
                DropdownMenuItem(value: 'ingredient', child: Text('Nguyên liệu FnB')),
                DropdownMenuItem(value: 'supply', child: Text('Vật dụng bếp')),
              ],
              onChanged: (v) => setState(() => _itemType = v ?? _itemType),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(), child: const Text('Hủy')),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Tạo'),
        ),
      ],
    );
  }
}
