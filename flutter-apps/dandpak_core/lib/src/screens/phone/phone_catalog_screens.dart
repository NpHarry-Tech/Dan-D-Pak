import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/retail_models.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../../utils/business_datetime.dart';
import '../management/management_widgets.dart';
import 'phone_doc_form_screens.dart';
import 'phone_kit.dart';
import 'phone_return_screen.dart';
import 'phone_scaffolds.dart';

/// NHÓM HÀNG HÓA + HÓA ĐƠN bản điện thoại.
/// Dữ liệu thật: `/api/skus`, `/api/warehouse/movements`, `/api/orders/history`,
/// `/api/orders/:id/receipt`.

num _n(dynamic v) {
  if (v is num) return v;
  return num.tryParse('${v ?? ''}'.replaceAll(',', '')) ?? 0;
}

String _s(dynamic v) => '${v ?? ''}';

/// DANH SÁCH HÀNG HÓA — tồn, giá, tìm kiếm, lọc còn hàng.
class PhoneProductsScreen extends StatefulWidget {
  const PhoneProductsScreen({super.key});

  @override
  State<PhoneProductsScreen> createState() => _PhoneProductsScreenState();
}

class _PhoneProductsScreenState extends State<PhoneProductsScreen> {
  final _key = GlobalKey<PhoneListScaffoldState<Sku>>();
  bool _inStockOnly = false;
  String _sort = '';
  String _category = '';
  List<String> _categories = const [];

  @override
  Widget build(BuildContext context) {
    return PhoneListScaffold<Sku>(
      key: _key,
      title: 'Hàng hóa',
      actions: [
        if (context.watch<AuthProvider>().hasPermission('warehouse.item'))
          PhoneIconButton(
            icon: Icons.add,
            onTap: () async {
              final saved = await Navigator.of(context).push<bool>(
                  MaterialPageRoute(
                      builder: (_) => const PhoneProductFormScreen()));
              if (saved == true) _key.currentState?.reload();
            },
          ),
      ],
      searchHint: 'Tên, mã hàng hoặc mã vạch',
      emptyTitle: 'Không tìm thấy hàng hóa',
      emptyHint: 'Thử đổi từ khóa hoặc bỏ bộ lọc',
      emptyIcon: Icons.inventory_2_outlined,
      fetch: (q) async {
        final res = await context.read<ApiService>().getSkusPaginated(
              page: 1,
              limit: 80,
              q: q,
              inStockOnly: _inStockOnly,
              sort: _sort,
            );
        final raw = (res['items'] ?? res['skus'] ?? res['data']) as List? ?? [];
        final skus = raw
            .whereType<Map>()
            .map((e) => Sku.fromJson(Map<String, dynamic>.from(e)))
            .toList();
        final categories = skus
            .map((s) => s.category.trim())
            .where((name) => name.isNotEmpty)
            .toSet()
            .toList()
          ..sort();
        if (!listEquals(categories, _categories)) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) setState(() => _categories = categories);
          });
        }
        return _category.isEmpty
            ? skus
            : skus.where((s) => s.category == _category).toList();
      },
      metrics: (list) => [
        (t('Số mặt hàng'), phoneInt(list.length), null),
        (
          t('Giá trị tồn'),
          phoneMoney(list.fold<num>(0, (a, s) => a + s.price * s.stock)),
          null
        ),
      ],
      filters: (ctx) => [
        PhoneChip(
          label: _category.isEmpty ? t('Tất cả loại hàng') : _category,
          active: _category.isNotEmpty,
          caret: true,
          onTap: () async {
            await showPhoneSheet<void>(
              context: ctx,
              title: t('Loại hàng'),
              builder: (c) => PhonePickList(
                options: [t('Tất cả loại hàng'), ..._categories],
                selected: _category.isEmpty ? t('Tất cả loại hàng') : _category,
                onPick: (value) {
                  Navigator.of(c).pop();
                  setState(() =>
                      _category = value == t('Tất cả loại hàng') ? '' : value);
                  _key.currentState?.reload();
                },
              ),
            );
          },
        ),
        PhoneChip(
          label: t('Còn hàng'),
          active: _inStockOnly,
          onTap: () {
            setState(() => _inStockOnly = !_inStockOnly);
            _key.currentState?.reload();
          },
        ),
        PhoneChip(
          label: switch (_sort) {
            'price_asc' => t('Giá thấp → cao'),
            'price_desc' => t('Giá cao → thấp'),
            'name' => t('Tên A–Z'),
            _ => t('Sắp xếp'),
          },
          active: _sort.isNotEmpty,
          caret: true,
          onTap: () async {
            const map = {
              'Mới nhất': '',
              'Giá thấp → cao': 'price_asc',
              'Giá cao → thấp': 'price_desc',
              'Tên A–Z': 'name',
            };
            await showPhoneSheet<void>(
              context: ctx,
              title: t('Sắp xếp'),
              builder: (c) => PhonePickList(
                options: map.keys.map(t).toList(),
                selected: map.entries
                    .firstWhere((e) => e.value == _sort,
                        orElse: () => const MapEntry('Mới nhất', ''))
                    .key,
                onPick: (v) {
                  Navigator.of(c).pop();
                  setState(() => _sort = map[v] ?? '');
                  _key.currentState?.reload();
                },
              ),
            );
          },
        ),
      ],
      rowBuilder: (ctx, s, _) => PhoneListRow(
        title: s.name,
        subtitle:
            '${s.barcode.isNotEmpty ? '${s.barcode} · ' : ''}${t('Tồn')} ${phoneInt(s.stock)} ${s.unit}',
        amount: phoneMoney(s.price),
        amountColor: DanColors.brand,
        badge: s.stock <= 0 ? t('Hết hàng') : null,
        badgeTone: PhoneTone.bad,
        onTap: () => Navigator.of(ctx).push(MaterialPageRoute(
            builder: (_) => PhoneProductDetailScreen(sku: s))),
      ),
    );
  }
}

/// CHI TIẾT HÀNG HÓA + lối vào Thẻ kho.
class PhoneProductDetailScreen extends StatelessWidget {
  final Sku sku;
  const PhoneProductDetailScreen({super.key, required this.sku});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: sku.name,
              subtitle: sku.barcode,
              onBack: () => Navigator.of(context).maybePop(),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(top: 12, bottom: 20),
                children: [
                  PhoneInfoCard(
                    title: t('GIÁ & THUẾ'),
                    rows: [
                      (t('Giá bán'), phoneMoney(sku.price)),
                      (t('VAT'), '${phoneInt(sku.vatRate)}%'),
                      (t('Đơn vị'), sku.unit),
                    ],
                  ),
                  PhoneInfoCard(
                    title: t('TỒN KHO'),
                    rows: [
                      (t('Tồn khả dụng'), '${phoneInt(sku.stock)} ${sku.unit}'),
                      (t('Giá trị tồn'), phoneMoney(sku.price * sku.stock)),
                      if (sku.category.isNotEmpty)
                        (t('Nhóm hàng'), sku.category),
                    ],
                  ),
                ],
              ),
            ),
            PhoneActionBar(
              child: PhoneSecondaryButton(
                label: t('Xem thẻ kho'),
                icon: Icons.receipt_long_outlined,
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => PhoneStockCardScreen(sku: sku))),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// THẺ KHO — mọi lần nhập/xuất của một mặt hàng.
class PhoneStockCardScreen extends StatelessWidget {
  final Sku sku;
  const PhoneStockCardScreen({super.key, required this.sku});

  @override
  Widget build(BuildContext context) {
    return PhoneListScaffold<Map<String, dynamic>>(
      title: 'Thẻ kho',
      subtitle: sku.name,
      emptyTitle: 'Chưa có giao dịch kho',
      emptyHint: 'Mặt hàng này chưa từng nhập hoặc xuất',
      emptyIcon: Icons.swap_vert,
      // Server lọc sẵn theo mặt hàng (inventory.listMovements đọc item_id +
      // item_type) — không kéo cả kho về rồi lọc tại máy.
      fetch: (_) async {
        final rows = await context
            .read<ApiService>()
            .getMovements(limit: 200, itemId: sku.id, itemType: 'sku');
        return rows
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      },
      // Cột THẬT: stock_movements.* + item_name, unit, warehouse_name, lot_no,
      // expiry_date (xem listMovements).
      rowBuilder: (ctx, m, _) {
        final qty = _n(m['qty']);
        return PhoneListRow(
          title: _s(m['type']).isEmpty ? t('Giao dịch kho') : _s(m['type']),
          subtitle: [
            BusinessDateTime.dateTime(m['created_at'],
                fallback: _s(m['created_at'])),
            _s(m['warehouse_name']),
            if (_s(m['lot_no']).isNotEmpty) '${t('Lô')} ${_s(m['lot_no'])}',
          ].where((e) => e.isNotEmpty).join(' · '),
          amount:
              '${qty > 0 ? '+' : ''}${phoneInt(qty)} ${_s(m['unit'])}'.trim(),
          amountColor: qty > 0 ? const Color(0xFF047857) : DanColors.late,
        );
      },
    );
  }
}

/// DANH SÁCH HÓA ĐƠN — tra cứu, tổng tiền, trạng thái.
class PhoneInvoicesScreen extends StatelessWidget {
  const PhoneInvoicesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return PhoneListScaffold<Map<String, dynamic>>(
      title: 'Hóa đơn',
      searchHint: 'Số hóa đơn, khách hàng',
      emptyTitle: 'Chưa có hóa đơn',
      emptyHint: 'Hóa đơn đã thanh toán sẽ hiện ở đây',
      emptyIcon: Icons.receipt_long_outlined,
      fetch: (q) async {
        final response = await context
            .read<ApiService>()
            .getInvoicePage(page: 1, limit: 100, q: q);
        final rows = response['items'] is List
            ? List<dynamic>.from(response['items'] as List)
            : <dynamic>[];
        return rows
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      },
      fetchMore: (q, page) async {
        final response = await context
            .read<ApiService>()
            .getInvoicePage(page: page, limit: 100, q: q);
        final rows = response['items'] is List
            ? List<dynamic>.from(response['items'] as List)
            : <dynamic>[];
        return rows
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      },
      pageSize: 100,
      metrics: (list) => [
        (t('Số hóa đơn'), phoneInt(list.length), null),
        (
          t('Tổng tiền'),
          phoneMoney(list.fold<num>(0, (a, m) => a + _n(m['total']))),
          null
        ),
      ],
      // Cột THẬT của listOrderHistory: id, bill_no, number, channel, status
      // ('paid'|'void'), total, subtotal, discount, created_at, paid_at,
      // table_code, invoice_no, methods[], item_count, locked.
      // KHÔNG có customer_name — đừng dựng cột khách hàng ở đây.
      rowBuilder: (ctx, m, _) {
        final status = _s(m['einvoice_status']).isNotEmpty
            ? _s(m['einvoice_status'])
            : _s(m['status']);
        final when = _s(m['paid_at']).isNotEmpty
            ? _s(m['paid_at'])
            : _s(m['created_at']);
        return PhoneListRow(
          title: _s(m['bill_code']).isNotEmpty
              ? _s(m['bill_code'])
              : (_s(m['number']).isNotEmpty
                  ? _s(m['number'])
                  : _s(m['bill_no'])),
          subtitle: [
            BusinessDateTime.dateTime(when, fallback: when),
            _s(m['invoice_no']).isEmpty
                ? t('Chưa có số HĐĐT')
                : 'HĐ ${_s(m['invoice_no'])}',
          ].where((e) => e.isNotEmpty).join(' · '),
          amount: phoneMoney(_n(m['total'])),
          badge: status.isEmpty ? null : _statusLabel(status),
          badgeTone: switch (status) {
            'ISSUED' => PhoneTone.ok,
            'FAILED' => PhoneTone.bad,
            _ => PhoneTone.warn,
          },
          onTap: () => Navigator.of(ctx).push(MaterialPageRoute(
              builder: (_) => PhoneInvoiceDetailScreen(order: m))),
        );
      },
    );
  }

  static String _statusLabel(String s) => switch (s) {
        'ISSUED' => t('Đã phát hành'),
        'PROCESSING' => t('Đang xử lý'),
        'NOT_ISSUED' => t('Chưa phát hành'),
        'FAILED' => t('Phát hành lỗi'),
        'paid' => t('Đã thanh toán'),
        'open' => t('Đang mở'),
        'partially_paid' => t('Trả một phần'),
        'void' => t('Đã hủy'),
        'cancelled' => t('Đã hủy'),
        _ => s,
      };
}

/// Nhãn phương thức thanh toán — khớp payment_lines.method trên server.
String _methodLabel(String m) => switch (m) {
      'cash' => t('Tiền mặt'),
      'card' || 'visa' => t('Thẻ'),
      'qrcode' ||
      'qr' ||
      'bank_transfer' ||
      'internet_banking' =>
        t('Chuyển khoản'),
      'momo' => 'MoMo',
      'zalopay' => 'ZaloPay',
      'voucher' => 'Voucher',
      _ => m.isEmpty ? t('Khác') : m,
    };

/// CHI TIẾT HÓA ĐƠN — xem nội dung bill và IN LẠI.
class PhoneInvoiceDetailScreen extends StatefulWidget {
  final Map<String, dynamic> order;
  const PhoneInvoiceDetailScreen({super.key, required this.order});

  @override
  State<PhoneInvoiceDetailScreen> createState() =>
      _PhoneInvoiceDetailScreenState();
}

class _PhoneInvoiceDetailScreenState extends State<PhoneInvoiceDetailScreen> {
  bool _printing = false;

  /// Cho phép Trả hàng: bill còn hiệu lực (không hủy) và là hóa đơn bán lẻ.
  /// Màn Hóa đơn phone chỉ liệt kê hóa đơn bán lẻ (getInvoicePage) nên khi
  /// history không kèm `channel` vẫn coi là retail. Quyền refund + duyệt Quản
  /// lý được enforce ở màn Trả hàng, không gate cứng tại đây.
  bool get _canReturn {
    final st = _s(widget.order['status']);
    if (st == 'void' || st == 'cancelled') return false;
    final ch = _s(widget.order['channel']);
    return ch.isEmpty || ch == 'retail';
  }

  /// Dòng lịch sử KHÔNG kèm mặt hàng (listOrderHistory chỉ trả phần đầu đơn).
  /// Phải gọi `/api/orders/:id/receipt` mới có items + lines thanh toán.
  Map<String, dynamic>? _full;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final id = _s(widget.order['order_id'] ?? widget.order['id']);
    if (id.isEmpty) {
      setState(() => _loading = false);
      return;
    }
    try {
      final detail = await context.read<ApiService>().getInvoiceDetail(id);
      final r = Map<String, dynamic>.from((detail['bill'] as Map?) ?? const {});
      final totals = (detail['totals'] as Map?) ?? const {};
      final buyer = (detail['buyer_snapshot'] as Map?) ?? const {};
      r.addAll({
        'id': id,
        'number': r['bill_code'],
        'subtotal': totals['gross'],
        'discount': totals['discount'],
        'surcharge': totals['surcharge'],
        'vat_amount': totals['vat'],
        'total': totals['total'],
        'customer_name': buyer['name'],
        'tax_code': buyer['tax_code'],
        // item_snapshot: name/sku_id/item_barcode/qty/unit_price/vat_rate/
        // vat_amount/line_total/returned_qty (đã enrich ở ledgerDetail).
        'items': detail['item_snapshot'],
        'lines': detail['payment_history'],
        'returns': detail['returns'],
      });
      if (!mounted) return;
      setState(() {
        _full = r;
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

  Future<void> _reprint() async {
    setState(() => _printing = true);
    try {
      final id = _s(widget.order['order_id'] ?? widget.order['id']);
      final billNo = _s(widget.order['bill_code'] ?? widget.order['bill_no']);
      // PHẢI tạo lệnh in MỚI. forcePrintReceiptJob() thấy lệnh cũ đã 'printed'
      // là trả về null ngay — nút này khi đó báo "Đã gửi lệnh in lại" mà máy in
      // không hề nhúc nhích.
      final err = await context
          .read<ApiService>()
          .reprintReceiptForOrder(orderId: id, billNo: billNo);
      if (!mounted) return;
      setState(() => _printing = false);
      appToast(
          context,
          err == null || err.isEmpty
              ? t('Đã gửi lệnh in lại')
              : t('Chưa in được: $err'),
          isError: err != null && err.isNotEmpty);
    } catch (e) {
      if (!mounted) return;
      setState(() => _printing = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Ưu tiên bản đầy đủ; chưa tải xong thì dùng tạm dòng lịch sử để tiêu đề
    // và tổng tiền hiện ngay, không phải chờ mạng.
    final o = _full ?? widget.order;
    final items = (o['items'] as List?) ?? const [];
    final payLines = (o['lines'] as List?) ?? const [];
    final when =
        _s(o['paid_at']).isNotEmpty ? _s(o['paid_at']) : _s(o['created_at']);
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: _s(o['number']).isNotEmpty
                  ? _s(o['number'])
                  : _s(o['bill_no']),
              subtitle: BusinessDateTime.dateTime(when, fallback: when),
              onBack: () => Navigator.of(context).maybePop(),
            ),
            Expanded(
              child: _loading && _full == null
                  ? const Center(child: CircularProgressIndicator())
                  : ListView(
                      padding: const EdgeInsets.only(top: 12, bottom: 20),
                      children: [
                        if (_error != null)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                            child: InlineMessage(
                                '${t('Không tải được chi tiết')}: $_error',
                                error: true,
                                onRetry: _load),
                          ),
                        PhoneInfoCard(
                          title: t('TỔNG KẾT'),
                          rows: [
                            if (_s(o['customer_name']).isNotEmpty)
                              (t('Khách hàng'), _s(o['customer_name'])),
                            if (_s(o['tax_code']).isNotEmpty)
                              ('MST', _s(o['tax_code'])),
                            (t('Tạm tính'), phoneMoney(_n(o['subtotal']))),
                            if (_n(o['discount']) > 0)
                              (
                                t('Giảm giá'),
                                '-${phoneMoney(_n(o['discount']))}'
                              ),
                            if (_n(o['surcharge']) > 0)
                              (t('Phụ thu'), phoneMoney(_n(o['surcharge']))),
                            if (_n(o['vat_amount']) > 0)
                              (
                                t('Trong đó VAT'),
                                phoneMoney(_n(o['vat_amount']))
                              ),
                            (t('TỔNG CỘNG'), phoneMoney(_n(o['total']))),
                            if (_s(o['cashier']).isNotEmpty)
                              (t('Thu ngân'), _s(o['cashier'])),
                            if (_s(o['einvoice_status']).isNotEmpty)
                              (
                                t('Trạng thái HĐĐT'),
                                PhoneInvoicesScreen._statusLabel(
                                    _s(o['einvoice_status']))
                              ),
                          ],
                        ),
                        if (payLines.isNotEmpty)
                          PhoneInfoCard(
                            title: t('THANH TOÁN'),
                            rows: [
                              for (final l in payLines.whereType<Map>())
                                (
                                  _methodLabel(_s(l['method'])),
                                  phoneMoney(_n(l['amount']))
                                ),
                            ],
                          ),
                        if (items.isNotEmpty) ...[
                          PhoneSectionTitle(t('Mặt hàng')),
                          // item_snapshot: name/sku_id/item_barcode/qty/
                          // unit_price/vat_rate/line_total/returned_qty.
                          for (final raw in items.whereType<Map>())
                            Builder(builder: (_) {
                              final code = _s(raw['item_barcode']).isNotEmpty
                                  ? _s(raw['item_barcode'])
                                  : _s(raw['sku_id']);
                              final vr = _n(raw['vat_rate']);
                              final ret = _n(raw['returned_qty']);
                              final sub = [
                                if (code.isNotEmpty) code,
                                '${phoneInt(_n(raw['qty']))} × ${phoneMoney(_n(raw['unit_price']))}',
                                if (vr > 0) 'VAT ${phoneInt(vr)}%',
                              ].join(' · ');
                              return PhoneListRow(
                                title: _s(raw['name']),
                                subtitle: sub,
                                amount: phoneMoney(_n(raw['line_total'])),
                                badge: ret > 0
                                    ? '${t('Đã trả')} ${phoneInt(ret)}'
                                    : null,
                                badgeTone: PhoneTone.warn,
                              );
                            }),
                        ],
                        // TRẢ HÀNG liên quan (order_returns) — đọc thẳng từ
                        // ledgerDetail, cùng nguồn với desktop.
                        if (((o['returns'] as List?) ?? const [])
                            .isNotEmpty) ...[
                          PhoneSectionTitle(t('Trả hàng')),
                          for (final r
                              in (o['returns'] as List).whereType<Map>())
                            PhoneListRow(
                              title:
                                  '${t('Phiếu trả')} · ${((r['items'] as List?) ?? const []).length} ${t('món')}',
                              subtitle: [
                                BusinessDateTime.dateTime(r['created_at'],
                                    fallback: _s(r['created_at'])),
                                _methodLabel(_s(r['refund_method'])),
                              ].where((e) => e.isNotEmpty).join(' · '),
                              amount: '-${phoneMoney(_n(r['refund_total']))}',
                            ),
                        ],
                      ],
                    ),
            ),
            PhoneActionBar(
              child: Row(
                children: [
                  // Trả hàng: chỉ cho bill bán lẻ còn hiệu lực (không hủy).
                  // Quyền refund do server + duyệt Quản lý enforce ở màn trả.
                  if (_canReturn) ...[
                    Expanded(
                      child: PhoneSecondaryButton(
                        label: t('Trả hàng'),
                        icon: Icons.assignment_return_outlined,
                        onPressed: () async {
                          final done = await Navigator.of(context).push<bool>(
                              MaterialPageRoute(
                                  builder: (_) => PhoneReturnScreen(order: o)));
                          // Trả xong → tải lại chi tiết để cập nhật "đã trả".
                          if (done == true && mounted) _load();
                        },
                      ),
                    ),
                    const SizedBox(width: 10),
                  ],
                  Expanded(
                    child: PhoneCta(
                      label: t('In lại hóa đơn'),
                      busy: _printing,
                      onPressed: _printing ? null : _reprint,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
