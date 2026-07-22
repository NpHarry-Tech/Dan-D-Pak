import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'kv_shared.dart';

/// Thiết lập giá (KiotViet PriceBook): bảng giá chung — mọi SKU kèm giá vốn,
/// giá nhập cuối, VAT và giá bán; lọc theo nhóm hàng / tồn kho / điều kiện giá;
/// sửa giá bán từng dòng ngay trên bảng.
class PriceBookPage extends StatefulWidget {
  const PriceBookPage({super.key});

  @override
  State<PriceBookPage> createState() => _PriceBookPageState();
}

class _PriceBookPageState extends State<PriceBookPage> {
  List<Map<String, dynamic>> _rows = [];
  // Bảng giá: 'default' = Bảng giá chung (skus.price); bảng khác tạo trong
  // Cài đặt → Kho & kênh bán, giá riêng lưu ở price_book_items.
  List<Map<String, dynamic>> _books = [];
  String _bookId = 'default';
  bool _loading = true;
  String? _error;
  bool _showFilters = true;
  String _search = '';

  String _catFilter = '';
  String _stockFilter = 'all'; // all|below|above|instock|out
  String _priceCond = ''; // ''|lt|lte|eq|gt
  String _priceBase = ''; // ''|cost|last_in_cost

  @override
  void initState() {
    super.initState();
    _load();
  }

  String get _bookName {
    for (final b in _books) {
      if (kvs(b['id']) == _bookId) return kvs(b['name']);
    }
    return t('Bảng giá chung');
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = context.read<ApiService>();
      final results = await Future.wait([
        api.getPriceBook(bookId: _bookId),
        api.getPriceBooks(),
      ]);
      if (!mounted) return;
      setState(() {
        _rows = kvMapList(results[0]);
        _books = kvMapList(results[1]);
        if (!_books.any((b) => kvs(b['id']) == _bookId)) _bookId = 'default';
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  List<Map<String, dynamic>> get _filtered {
    final q = _search.trim().toLowerCase();
    return _rows.where((s) {
      if (q.isNotEmpty) {
        final hay = '${kvs(s['code'])} ${kvs(s['name'])} ${kvs(s['barcode'])}'
            .toLowerCase();
        if (!hay.contains(q)) return false;
      }
      if (_catFilter.isNotEmpty && kvs(s['category']) != _catFilter) {
        return false;
      }
      final stock = kvn(s['stock']);
      final minStock = kvn(s['min_stock']);
      switch (_stockFilter) {
        case 'below':
          if (stock > minStock) return false;
          break;
        case 'above':
          if (stock <= minStock) return false;
          break;
        case 'instock':
          if (stock <= 0) return false;
          break;
        case 'out':
          if (stock > 0) return false;
          break;
      }
      if (_priceCond.isNotEmpty && _priceBase.isNotEmpty) {
        final price = kvn(s['price']);
        final base = kvn(s[_priceBase]);
        switch (_priceCond) {
          case 'lt':
            if (!(price < base)) return false;
            break;
          case 'lte':
            if (!(price <= base)) return false;
            break;
          case 'eq':
            if (price != base) return false;
            break;
          case 'gt':
            if (!(price > base)) return false;
            break;
        }
      }
      return true;
    }).toList();
  }

  Map<String, int> get _catCounts {
    final m = <String, int>{};
    for (final s in _rows) {
      final k = kvs(s['category']);
      if (k.isEmpty) continue;
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }

  bool get _anyFilter =>
      _catFilter.isNotEmpty ||
      _stockFilter != 'all' ||
      _priceCond.isNotEmpty ||
      _priceBase.isNotEmpty;

  Future<void> _editPrice(Map<String, dynamic> s) async {
    final isBook = _bookId != 'default';
    final initial = isBook
        ? (s['book_price'] == null ? '' : kvNumText(kvn(s['book_price'])))
        : kvNumText(kvn(s['price']));
    final ctrl = TextEditingController(text: initial);
    final vatCtrl = TextEditingController(
        text: s['vat'] == null ? '0' : kvNumText(kvn(s['vat'])));
    var priceIncludesVat = s['price_includes_vat'] != 0;
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: DanColors.surface,
          title: Text(kvs(s['name']),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
          content: SizedBox(
            width: 340,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(t('Giá vốn'),
                        style:
                            TextStyle(fontSize: 12.5, color: DanColors.muted)),
                    Text(Fmt.money(kvn(s['cost'])),
                        style: TextStyle(fontWeight: FontWeight.w700)),
                  ],
                ),
                SizedBox(height: 4),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(t('Giá nhập cuối'),
                        style:
                            TextStyle(fontSize: 12.5, color: DanColors.muted)),
                    Text(
                        kvn(s['last_in_cost']) > 0
                            ? Fmt.money(kvn(s['last_in_cost']))
                            : '—',
                        style: TextStyle(fontWeight: FontWeight.w700)),
                  ],
                ),
                if (isBook) ...[
                  SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(t('Giá chung'),
                          style: TextStyle(
                              fontSize: 12.5, color: DanColors.muted)),
                      Text(Fmt.money(kvn(s['sale_price'] ?? s['price'])),
                          style: TextStyle(fontWeight: FontWeight.w700)),
                    ],
                  ),
                ],
                SizedBox(height: 14),
                TextField(
                  controller: ctrl,
                  autofocus: true,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                      labelText: isBook
                          ? '${t('Giá trong')} "$_bookName" (${priceIncludesVat ? t('đã gồm VAT') : t('chưa gồm VAT')})'
                          : t('Đơn giá cấu hình'),
                      helperText:
                          isBook ? t('Để trống = dùng giá chung') : null,
                      isDense: true),
                  onSubmitted: (_) => Navigator.of(ctx).pop(true),
                ),
                if (!isBook) ...[
                  SizedBox(height: 10),
                  TextField(
                    controller: vatCtrl,
                    keyboardType: TextInputType.number,
                    decoration:
                        InputDecoration(labelText: 'VAT (%)', isDense: true),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t('Đơn giá đã gồm VAT')),
                    value: priceIncludesVat,
                    onChanged: (value) =>
                        setDialogState(() => priceIncludesVat = value),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                child: Text(t('Hủy'))),
            FilledButton(
                onPressed: () => Navigator.of(ctx).pop(true),
                child: Text(t('Lưu giá'))),
          ],
        ),
      ),
    );
    final raw = ctrl.text.trim();
    final price = kvParseNum(raw);
    final vat = kvParseNum(vatCtrl.text.trim()) ?? 0;
    ctrl.dispose();
    vatCtrl.dispose();
    if (saved != true) return;

    try {
      if (isBook) {
        // Bảng giá riêng: ô trống = xóa giá riêng → SKU quay về giá chung.
        if (raw.isNotEmpty && (price == null || price < 0)) return;
        await context.read<ApiService>().setPriceBookEntry(
            bookId: _bookId,
            skuId: kvs(s['id']),
            price: raw.isEmpty ? null : price);
        if (!mounted) return;
        setState(() => s['book_price'] = raw.isEmpty ? null : price);
      } else {
        if (price == null || price < 0) return;
        await context.read<ApiService>().updateSku(kvs(s['id']), {
          'price': price,
          'vat': vat,
          'price_includes_vat': priceIncludesVat,
        });
        if (!mounted) return;
        setState(() {
          s['price'] = price;
          s['vat'] = vat;
          s['price_includes_vat'] = priceIncludesVat ? 1 : 0;
          s['price_pre_tax'] = priceIncludesVat && vat > 0
              ? (price / (1 + vat / 100)).round()
              : price;
          s['sale_price'] =
              priceIncludesVat ? price : (price * (1 + vat / 100)).round();
        });
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Đã cập nhật giá')),
          backgroundColor: DanColors.text));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late));
    }
  }

  String _vatLabel(dynamic vat) {
    if (vat == null) return 'KCT';
    final v = kvn(vat);
    return v == v.round() ? '${v.round()}%' : '$v%';
  }

  num _salePrice(Map<String, dynamic> sku, dynamic configuredPrice) {
    final price = kvn(configuredPrice);
    final vat = kvn(sku['vat']);
    return sku['price_includes_vat'] != 0
        ? price
        : (price * (1 + vat / 100)).round();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _rows.isEmpty) {
      return Center(child: CircularProgressIndicator());
    }
    if (_error != null && _rows.isEmpty) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được bảng giá ($_error)'),
            error: true, onRetry: _load),
      );
    }
    final list = _filtered;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_showFilters) _sidebar(),
        Expanded(
          child: Column(
            children: [
              KvToolbar(
                hint: t('Theo mã, tên hàng'),
                onSearch: (v) => setState(() => _search = v),
                showFilterToggle: true,
                filtersShown: _showFilters,
                onToggleFilters: () =>
                    setState(() => _showFilters = !_showFilters),
                actions: [
                  Text(t('${list.length} hàng hóa'),
                      style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                          color: DanColors.muted)),
                  IconButton(
                    tooltip: t('Tải lại'),
                    onPressed: _load,
                    icon: Icon(Icons.refresh, color: DanColors.muted),
                  ),
                ],
              ),
              Divider(height: 1, color: DanColors.border),
              KvTableHeader(cells: [
                kvHeaderCell(t('Mã hàng'), width: 110),
                SizedBox(width: 10),
                kvHeaderCell(t('Tên hàng'), flex: 1),
                kvHeaderCell(t('Tồn kho'), width: 76, align: TextAlign.right),
                kvHeaderCell(t('Giá vốn'), width: 96, align: TextAlign.right),
                kvHeaderCell(t('Giá nhập cuối'),
                    width: 104, align: TextAlign.right),
                kvHeaderCell('VAT', width: 56, align: TextAlign.center),
                kvHeaderCell(t('Giá bán'), width: 104, align: TextAlign.right),
                SizedBox(width: 44),
              ]),
              Divider(height: 1, color: DanColors.border),
              Expanded(
                child: list.isEmpty
                    ? KvEmptyState(
                        message: t('Không tìm thấy kết quả'),
                        hint: t('Thử đổi từ khóa hoặc bỏ bớt bộ lọc'))
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.separated(
                          itemCount: list.length,
                          separatorBuilder: (_, __) =>
                              Divider(height: 1, color: DanColors.border),
                          itemBuilder: (_, i) => _row(list[i]),
                        ),
                      ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _row(Map<String, dynamic> s) {
    Widget money(num v, {bool bold = false}) => Text(
          v <= 0 ? '—' : Fmt.money(v),
          textAlign: TextAlign.right,
          style: TextStyle(
              fontSize: 12.5,
              fontWeight: bold ? FontWeight.w900 : FontWeight.w600,
              color: v <= 0 ? DanColors.faint : DanColors.text),
        );
    final stock = kvn(s['stock']);
    return InkWell(
      onTap: () => _editPrice(s),
      child: Container(
        color: DanColors.surface,
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        child: Row(
          children: [
            SizedBox(
              width: 110,
              child: Text(kvs(s['code']).isEmpty ? '—' : kvs(s['code']),
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
              child: Text(kvs(s['name']),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w700, height: 1.2)),
            ),
            SizedBox(
              width: 76,
              child: Text('${Fmt.int0(stock)}',
                  textAlign: TextAlign.right,
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: stock <= 0 ? DanColors.faint : DanColors.text)),
            ),
            SizedBox(width: 96, child: money(kvn(s['cost']))),
            SizedBox(width: 104, child: money(kvn(s['last_in_cost']))),
            SizedBox(
              width: 56,
              child: Center(
                child: Text(_vatLabel(s['vat']),
                    style: TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                        color: DanColors.muted)),
              ),
            ),
            // Bảng giá riêng: có giá riêng → in đậm màu brand; chưa đặt →
            // hiện giá chung mờ (nghĩa là đang thừa hưởng Bảng giá chung).
            SizedBox(
              width: 104,
              child: _bookId == 'default'
                  ? money(kvn(s['sale_price'] ?? s['price']), bold: true)
                  : (s['book_price'] != null
                      ? Text(Fmt.money(_salePrice(s, s['book_price'])),
                          textAlign: TextAlign.right,
                          style: TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w900,
                              color: DanColors.brand))
                      : Text(Fmt.money(kvn(s['price'])),
                          textAlign: TextAlign.right,
                          style: TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                              color: DanColors.faint))),
            ),
            SizedBox(
              width: 44,
              child: IconButton(
                tooltip: t('Sửa giá'),
                onPressed: () => _editPrice(s),
                icon:
                    Icon(Icons.edit_outlined, size: 17, color: DanColors.muted),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _sidebar() {
    final cats = _catCounts;
    final catKeys = cats.keys.toList()..sort();
    return KvSidebar(
      showClear: _anyFilter,
      onClear: () => setState(() {
        _catFilter = '';
        _stockFilter = 'all';
        _priceCond = '';
        _priceBase = '';
      }),
      children: [
        KvFilterGroup(
          title: t('Bảng giá'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final b in _books)
                if (kvs(b['status']) != 'inactive' || kvs(b['id']) == _bookId)
                  KvRadioOption(
                    label: kvs(b['name']),
                    count: kvn(b['item_count']) > 0
                        ? kvn(b['item_count']).toInt()
                        : null,
                    selected: _bookId == kvs(b['id']),
                    onTap: () {
                      if (_bookId == kvs(b['id'])) return;
                      setState(() => _bookId = kvs(b['id']));
                      _load();
                    },
                  ),
              Padding(
                padding: EdgeInsets.fromLTRB(2, 6, 2, 2),
                child: Text(t('Tạo/sửa bảng giá: Cài đặt → Kho & kênh bán'),
                    style: TextStyle(fontSize: 10.5, color: DanColors.faint)),
              ),
            ],
          ),
        ),
        KvFilterGroup(
          title: t('Nhóm hàng'),
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: 240),
            child: Scrollbar(
              child: ListView(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                children: [
                  KvRadioOption(
                      label: t('Tất cả'),
                      selected: _catFilter.isEmpty,
                      onTap: () => setState(() => _catFilter = '')),
                  for (final k in catKeys)
                    KvRadioOption(
                        label: k,
                        count: cats[k],
                        selected: _catFilter == k,
                        onTap: () => setState(() => _catFilter = k)),
                ],
              ),
            ),
          ),
        ),
        KvFilterGroup(
          title: t('Tồn kho'),
          child: Column(
            children: [
              for (final o in [
                ['all', t('Tất cả')],
                ['below', t('Dưới định mức tồn')],
                ['above', t('Vượt định mức tồn')],
                ['instock', t('Còn hàng trong kho')],
                ['out', t('Hết hàng trong kho')],
              ])
                KvRadioOption(
                    label: o[1],
                    selected: _stockFilter == o[0],
                    onTap: () => setState(() => _stockFilter = o[0])),
            ],
          ),
        ),
        KvFilterGroup(
          title: t('Giá bán'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              DropdownButtonFormField<String>(
                initialValue: _priceCond.isEmpty ? null : _priceCond,
                isDense: true,
                decoration: InputDecoration(
                    hintText: t('Chọn điều kiện'),
                    isDense: true,
                    contentPadding:
                        EdgeInsets.symmetric(horizontal: 10, vertical: 8)),
                items: [
                  DropdownMenuItem(value: 'lt', child: Text(t('Nhỏ hơn'))),
                  DropdownMenuItem(
                      value: 'lte', child: Text(t('Nhỏ hơn hoặc bằng'))),
                  DropdownMenuItem(value: 'eq', child: Text(t('Bằng'))),
                  DropdownMenuItem(value: 'gt', child: Text(t('Lớn hơn'))),
                ],
                onChanged: (v) => setState(() => _priceCond = v ?? ''),
              ),
              SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: _priceBase.isEmpty ? null : _priceBase,
                isDense: true,
                decoration: InputDecoration(
                    hintText: t('Chọn giá so sánh'),
                    isDense: true,
                    contentPadding:
                        EdgeInsets.symmetric(horizontal: 10, vertical: 8)),
                items: [
                  DropdownMenuItem(value: 'cost', child: Text(t('Giá vốn'))),
                  DropdownMenuItem(
                      value: 'last_in_cost', child: Text(t('Giá nhập cuối'))),
                ],
                onChanged: (v) => setState(() => _priceBase = v ?? ''),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
