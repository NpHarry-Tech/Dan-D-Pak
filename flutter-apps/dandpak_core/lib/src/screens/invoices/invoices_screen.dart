import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:printing/printing.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../services/manual_document_print_service.dart';
import '../../ui/debouncer.dart';
import '../../ui/app_theme.dart';
import '../../ui/open_url.dart';
import '../../ui/format.dart';
import '../../ui/promotion_presentation.dart';
import '../../widgets/dan_top_bar.dart';
import '../management/management_widgets.dart';
import '../../utils/translation.dart';
import '../../utils/business_datetime.dart';

String _s(dynamic v) => v?.toString() ?? '';
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;

List<List<String>> get _statusFilters => [
      ['', t('Tất cả')],
      ['not_issued', t('Chưa phát hành')],
      ['processing', t('Đang xử lý')],
      ['issued', t('Đã phát hành')],
      ['failed', t('Phát hành lỗi')],
    ];

/// Native port of the web Hóa đơn (invoices.html): e-invoice list with status
/// filter, search, summary and cancel.
class InvoicesScreen extends StatefulWidget {
  InvoicesScreen({super.key});

  @override
  State<InvoicesScreen> createState() => _InvoicesScreenState();
}

class _InvoicesScreenState extends State<InvoicesScreen> {
  static const _manualPrinter = WindowsDocumentPrintService();
  List<Map<String, dynamic>> _invoices = [];
  String _status = '';
  String _search = '';
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = true;
  int _page = 1;
  bool _hasLoadedOnce = false;
  String? _error;
  String? _expandedOrderId;

  /// PHÁT SINH HÓA ĐƠN Ở MÁY KHÁC PHẢI HIỆN RA NGAY.
  ///
  /// Trước đây màn này không nghe realtime gì cả: thu ngân thanh toán ở máy
  /// quầy, quản lý đang mở màn Hóa đơn ở máy khác vẫn thấy danh sách cũ cho tới
  /// khi bấm tải lại hoặc chuyển tab. Danh sách hóa đơn mà lạc hậu thì người
  /// xem không biết mình đang nhìn số liệu của lúc nào.
  final SocketService _socket = SocketService();
  final Debouncer _reload = Debouncer(delay: const Duration(milliseconds: 400));

  void _onSocketEvent(String event, dynamic _) {
    if (!mounted) return;
    // Mọi thứ làm DANH SÁCH HÓA ĐƠN đổi: thu tiền xong, đơn đổi trạng thái,
    // hoàn/huỷ, hoặc socket vừa nối lại sau khi rớt.
    const quanTam = {
      'payment:done',
      'order:updated',
      'invoice:updated',
      'retail:sale',
      kSyncReconnected,
    };
    if (!quanTam.contains(event)) return;
    _reload(() {
      if (mounted) _load();
    });
  }

  @override
  void initState() {
    super.initState();
    _load();
    // CHỈ NGHE, KHÔNG TỰ MỞ KẾT NỐI.
    //
    // Vỏ app đã giữ sẵn một socket cho cả phiên; màn danh sách mà tự gọi
    // connect() thì vừa thừa vừa để lại hẹn giờ treo (widget test bắt được
    // ngay), và vòng đời kết nối bị chia cho nhiều màn cùng quản.
    _socket.addListener(_onSocketEvent);
  }

  @override
  void dispose() {
    _socket.removeListener(_onSocketEvent);
    _reload.dispose();
    super.dispose();
  }

  Future<void> _load({bool append = false}) async {
    setState(() {
      if (append) {
        _loadingMore = true;
      } else {
        _loading = true;
        _page = 1;
      }
    });
    try {
      final response = await context.read<ApiService>().getInvoicePage(
            page: append ? _page + 1 : 1,
            limit: 100,
            q: _search,
            status: _status,
          );
      final rows = response['items'] is List
          ? List<dynamic>.from(response['items'] as List)
          : <dynamic>[];
      if (!mounted) return;
      setState(() {
        final mapped = rows
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        if (append) {
          _invoices.addAll(mapped);
          _page += 1;
        } else {
          _invoices = mapped;
          _page = 1;
        }
        _hasMore = _page < (_n(response['pages']).toInt().clamp(1, 1 << 30));
        _loading = false;
        _loadingMore = false;
        _hasLoadedOnce = true;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
        _loadingMore = false;
        _hasLoadedOnce = true;
      });
    }
  }

  List<Map<String, dynamic>> get _filtered {
    final q = foldSearch(_search);
    return _invoices.where((i) {
      if (_status.isNotEmpty && _s(i['status']) != _status) return false;
      if (q.isEmpty) return true;
      final c = i['customer'] is Map ? (i['customer'] as Map) : {};
      return [
        i['invoice_no'],
        i['bill_code'],
        i['order_id'],
        i['lookup_code'],
        c['name'],
        c['company'],
        c['tax_code'],
        c['phone'],
      ].any((v) => searchMatches(v, q));
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentUser;
    final branch = auth.selectedBranch;

    final issued = _invoices.where((i) => _s(i['status']) == 'issued').toList();
    final failed = _invoices.where((i) => _s(i['status']) == 'failed').toList();
    final processing =
        _invoices.where((i) => _s(i['status']) == 'processing').length;
    final notIssued =
        _invoices.where((i) => _s(i['status']) == 'not_issued').length;
    final totalAmount = _invoices.fold<num>(0, (s, i) => s + _n(i['total']));

    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: DanModuleTopBar(
        brandName: branch.name.isNotEmpty ? branch.name : branch.id,
        title: t('Hóa đơn'),
        subtitle: '',
        titleIcon: Icons.description_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
      ),
      body: Column(
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: LayoutBuilder(builder: (_, box) {
              final width = (box.maxWidth - 48) / 5;
              return Wrap(spacing: 12, runSpacing: 10, children: [
                SizedBox(
                    width: width,
                    child: KpiCard(
                        label: t('Tổng bill'),
                        value: Fmt.int0(_invoices.length))),
                SizedBox(
                    width: width,
                    child: KpiCard(
                        label: t('Chưa phát hành'),
                        value: Fmt.int0(notIssued))),
                SizedBox(
                    width: width,
                    child: KpiCard(
                        label: t('Đang xử lý'), value: Fmt.int0(processing))),
                SizedBox(
                    width: width,
                    child: KpiCard(
                        label: t('Đã phát hành'),
                        value: Fmt.int0(issued.length),
                        valueColor: DanColors.done)),
                SizedBox(
                    width: width,
                    child: KpiCard(
                        label: t('Phát hành lỗi'),
                        value: Fmt.int0(failed.length),
                        valueColor:
                            failed.isEmpty ? DanColors.muted : DanColors.late)),
                SizedBox(
                    width: width,
                    child: KpiCard(
                        label: t('Cần xử lý'), value: Fmt.int0(failed.length))),
                SizedBox(
                    width: width,
                    child: KpiCard(
                        label: t('Tổng tiền hóa đơn'),
                        value: Fmt.money(totalAmount))),
              ]);
            }),
          ),
          Padding(
            padding: EdgeInsets.all(14),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: [
                for (final f in _statusFilters) ...[
                  ChoiceChip(
                    label: Text(f[1]),
                    selected: _status == f[0],
                    onSelected: (_) {
                      setState(() => _status = f[0]);
                      _load();
                    },
                  ),
                  SizedBox(width: 8),
                ],
                SizedBox(width: 4),
                SizedBox(
                  width: 300,
                  child: TextField(
                    decoration: InputDecoration(
                        hintText: t('Tìm số HĐ, khách, MST…'),
                        prefixIcon: Icon(Icons.search),
                        isDense: true),
                    onChanged: (v) {
                      setState(() => _search = v);
                      _reload(() {
                        if (mounted) _load();
                      });
                    },
                  ),
                ),
              ]),
            ),
          ),
          Divider(height: 1, color: DanColors.border),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading && !_hasLoadedOnce) {
      return Center(child: CircularProgressIndicator());
    }
    if (_error != null && !_hasLoadedOnce) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được hóa đơn ($_error)'),
            error: true, onRetry: _load),
      );
    }
    final list = _filtered;
    if (list.isEmpty) {
      return Center(
          child: Text(t('Chưa có hóa đơn nào'),
              style: TextStyle(color: DanColors.faint)));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: EdgeInsets.all(16),
        itemCount: list.length + (_hasMore ? 1 : 0),
        separatorBuilder: (_, __) => SizedBox(height: 8),
        itemBuilder: (_, i) {
          if (i == list.length) {
            return Center(
              child: OutlinedButton.icon(
                onPressed: _loadingMore ? null : () => _load(append: true),
                icon: _loadingMore
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.expand_more),
                label: Text(t('Xem thêm lịch sử')),
              ),
            );
          }
          return _row(list[i]);
        },
      ),
    );
  }

  Widget _row(Map<String, dynamic> inv) {
    final status = _s(inv['status']);
    final failed = status == 'failed';
    final issued = status == 'issued';
    final c = inv['customer'] is Map ? (inv['customer'] as Map) : {};
    final created = BusinessDateTime.dateTime(_s(inv['created_at']));
    final orderId = _s(inv['order_id']);
    final billCode =
        _s(inv['bill_code']).isNotEmpty ? _s(inv['bill_code']) : orderId;
    final expanded = _expandedOrderId == orderId;
    return Column(children: [
      InkWell(
          onTap: () =>
              setState(() => _expandedOrderId = expanded ? null : orderId),
          child: Container(
            padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: DanColors.surface,
              border: Border.all(color: DanColors.border),
              borderRadius: BorderRadius.circular(DanRadius.md),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            'Bill $billCode',
                            style: TextStyle(
                                fontFamily: 'JetBrains Mono',
                                fontWeight: FontWeight.w900,
                                color: DanColors.brand),
                          ),
                          SizedBox(width: 10),
                          Text(
                              _s(inv['invoice_no']).isEmpty
                                  ? t('(chưa cấp số)')
                                  : '#${_s(inv['invoice_no'])}',
                              style: TextStyle(
                                  fontFamily: 'JetBrains Mono',
                                  fontWeight: FontWeight.w800,
                                  color: DanColors.brand)),
                          SizedBox(width: 8),
                          Container(
                            padding: EdgeInsets.symmetric(
                                horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                                color: (failed
                                        ? DanColors.late
                                        : (issued
                                            ? DanColors.done
                                            : const Color(0xFFF59E0B)))
                                    .withValues(alpha: .13),
                                borderRadius: BorderRadius.circular(5)),
                            child: Text(
                                switch (status) {
                                  'issued' => t('Đã phát hành'),
                                  'processing' => t('Đang xử lý'),
                                  'failed' => t('Phát hành lỗi'),
                                  _ => t('Chưa phát hành'),
                                },
                                style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w800,
                                    color: failed
                                        ? DanColors.late
                                        : (issued
                                            ? const Color(0xFF047857)
                                            : const Color(0xFFB45309)))),
                          ),
                          if (_s(inv['return_status']).toLowerCase() !=
                                  'none' &&
                              _s(inv['return_status']).isNotEmpty) ...[
                            const SizedBox(width: 8),
                            _returnBadge(_s(inv['return_status'])),
                          ],
                        ],
                      ),
                      SizedBox(height: 3),
                      Text(
                        [
                          if (_s(c['name']).isNotEmpty) _s(c['name']),
                          if (_s(c['tax_code']).isNotEmpty)
                            'MST ${_s(c['tax_code'])}',
                          if (created.isNotEmpty) created,
                        ].join('  ·  '),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 12, color: DanColors.faint),
                      ),
                    ],
                  ),
                ),
                Text(Fmt.money(_n(inv['total'])),
                    style:
                        TextStyle(fontSize: 14.5, fontWeight: FontWeight.w900)),
                const SizedBox(width: 8),
                Icon(expanded ? Icons.expand_less : Icons.expand_more,
                    color: DanColors.faint),
              ],
            ),
          )),
      if (expanded) _detail(orderId),
    ]);
  }

  Widget _detail(String orderId) => FutureBuilder<Map<String, dynamic>>(
        future: context.read<ApiService>().getInvoiceDetail(orderId),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const Padding(
                padding: EdgeInsets.all(18),
                child: LinearProgressIndicator(minHeight: 2));
          }
          final data = snapshot.data!;
          final bill = (data['bill'] as Map?) ?? const {};
          final buyer = (data['buyer_snapshot'] as Map?) ?? const {};
          final items = (data['item_snapshot'] as List?) ?? const [];
          final totals = (data['totals'] as Map?) ?? const {};
          final payments = (data['payment_history'] as List?) ?? const [];
          final returns = (data['returns'] as List?) ?? const [];
          final timeline = (data['timeline'] as List?) ?? const [];
          final returnStatus = _s(bill['return_status']).toLowerCase();
          return Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            color: DanColors.surface,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header cho kế toán
                Wrap(spacing: 24, runSpacing: 6, children: [
                  _kv(t('Số bill'), _s(bill['bill_code'] ?? bill['bill_no'])),
                  _kv(
                      t('Ngày giờ'),
                      BusinessDateTime.dateTimeSeconds(
                          bill['created_at'] ?? bill['paid_at'],
                          fallback: _s(bill['created_at'] ?? bill['paid_at']))),
                  _kv(t('Chi nhánh'), _s(bill['branch_id'])),
                  _kv(t('Thu ngân'), _s(bill['cashier'])),
                  _kv(
                      t('Khách hàng'),
                      _s(buyer['name']).isEmpty
                          ? t('Người tiêu dùng')
                          : _s(buyer['name'])),
                  if (_s(buyer['tax_code']).isNotEmpty)
                    _kv('MST', _s(buyer['tax_code'])),
                  _kv(t('Trạng thái HĐĐT'),
                      _einvoiceLabel(_s(bill['einvoice_status']))),
                  if (returnStatus != 'none' && returnStatus.isNotEmpty)
                    _returnBadge(returnStatus),
                ]),
                const Divider(height: 20),
                // Bảng item: tên/SKU/SL/đơn giá/VAT/thành tiền/đã trả
                _itemsTable(items),
                const SizedBox(height: 10),
                // Tổng
                _totalsBlock(totals),
                const SizedBox(height: 10),
                // Thanh toán
                _paymentBlocks(payments),
                // Trả hàng liên quan
                if (returns.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  _returnsBlock(returns),
                ],
                const SizedBox(height: 12),
                // Actions
                Wrap(spacing: 8, runSpacing: 8, children: [
                  OutlinedButton.icon(
                    onPressed: () => _openBillViewer(orderId, data),
                    icon: const Icon(Icons.receipt_long, size: 16),
                    label: Text(t('Xem bill')),
                  ),
                  if (_s(bill['einvoice_status']).toUpperCase() == 'ISSUED' &&
                      (_s(bill['pdf_url']).isNotEmpty ||
                          _s(bill['lookup_url']).isNotEmpty))
                    OutlinedButton.icon(
                      onPressed: () => _openVatViewer(bill),
                      icon: const Icon(Icons.picture_as_pdf, size: 16),
                      label: Text(t('Xem hóa đơn (VAT)')),
                    ),
                ]),
                const SizedBox(height: 6),
                // Nhật ký kỹ thuật — collapse mặc định
                Theme(
                  data: Theme.of(context)
                      .copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    childrenPadding: const EdgeInsets.only(bottom: 8),
                    title: Text(t('Nhật ký kỹ thuật'),
                        style: const TextStyle(
                            fontSize: 12.5, color: DanColors.muted)),
                    children: timeline
                        .whereType<Map>()
                        .map((e) => Align(
                            alignment: Alignment.centerLeft,
                            child: Text(
                                '${BusinessDateTime.dateTimeSeconds(e['created_at'], fallback: _s(e['created_at']))} · ${_s(e['action'])} ${_s(e['new_status'])}',
                                style: const TextStyle(
                                    fontSize: 11, color: DanColors.faint))))
                        .toList(),
                  ),
                ),
              ],
            ),
          );
        },
      );

  Widget _kv(String k, String v) => SizedBox(
        width: 220,
        child: RichText(
            text: TextSpan(
                style: const TextStyle(fontSize: 12.5, color: DanColors.text),
                children: [
              TextSpan(
                  text: '$k: ', style: const TextStyle(color: DanColors.muted)),
              TextSpan(
                  text: v, style: const TextStyle(fontWeight: FontWeight.w700)),
            ])),
      );

  Widget _itemsTable(List items) {
    Widget cell(String s,
            {int flex = 1, TextAlign a = TextAlign.left, bool b = false}) =>
        Expanded(
            flex: flex,
            child: Text(s,
                textAlign: a,
                style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: b ? FontWeight.w800 : FontWeight.w500,
                    color: b ? DanColors.text : DanColors.muted)));
    return Column(children: [
      Row(children: [
        cell(t('Mặt hàng'), flex: 4, b: true),
        cell('SL', a: TextAlign.right, b: true),
        cell(t('Đơn giá'), flex: 2, a: TextAlign.right, b: true),
        cell('VAT', flex: 2, a: TextAlign.right, b: true),
        cell(t('Thành tiền'), flex: 2, a: TextAlign.right, b: true),
        cell(t('Đã trả'), a: TextAlign.right, b: true),
      ]),
      const Divider(height: 8),
      for (final it in items.whereType<Map>())
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
                flex: 4,
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_s(it['name']),
                          style: const TextStyle(
                              fontSize: 12, fontWeight: FontWeight.w600)),
                      if (_s(it['sku_id'] ??
                              it['item_barcode'] ??
                              it['item_code'])
                          .isNotEmpty)
                        Text(
                            _s(it['item_barcode'] ??
                                it['item_code'] ??
                                it['sku_id']),
                            style: const TextStyle(
                                fontSize: 10.5, color: DanColors.faint)),
                      for (final promo in promotionPresentation(it['promo'],
                          fallbackDiscount: _n(it['discount'])))
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(promo,
                              style: const TextStyle(
                                  fontSize: 10.5, color: DanColors.done)),
                        ),
                    ])),
            cell('${_n(it['qty']).toInt()}', a: TextAlign.right),
            cell(Fmt.money(_n(it['unit_price'])), flex: 2, a: TextAlign.right),
            cell(
                '${_n(it['vat_rate']).toInt()}% · ${Fmt.money(_n(it['vat_amount']))}',
                flex: 2,
                a: TextAlign.right),
            cell(Fmt.money(_n(it['line_total'])), flex: 2, a: TextAlign.right),
            cell(
                _n(it['returned_qty']) > 0
                    ? '${_n(it['returned_qty']).toInt()}'
                    : '—',
                a: TextAlign.right),
          ]),
        ),
    ]);
  }

  Widget _totalsBlock(Map totals) {
    Widget row(String k, num v, {bool big = false, Color? c}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 1),
        child: Row(mainAxisAlignment: MainAxisAlignment.end, children: [
          Text('$k: ',
              style: TextStyle(
                  fontSize: big ? 14 : 12,
                  color: DanColors.muted,
                  fontWeight: big ? FontWeight.w900 : FontWeight.w600)),
          Text(Fmt.money(v),
              style: TextStyle(
                  fontSize: big ? 15 : 12.5,
                  fontWeight: FontWeight.w900,
                  color: c ?? DanColors.text)),
        ]));
    return Column(children: [
      row(t('Tạm tính'), _n(totals['gross'])),
      if (_n(totals['discount']) > 0)
        row(t('Giảm giá'), -_n(totals['discount']), c: DanColors.done),
      if (_n(totals['surcharge']) > 0)
        row(t('Phụ thu'), _n(totals['surcharge'])),
      if (_n(totals['vat']) > 0) row(t('VAT'), _n(totals['vat'])),
      row(t('TỔNG CỘNG'), _n(totals['total']), big: true),
    ]);
  }

  Widget _returnsBlock(List returns) =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(t('Hoàn hàng'),
            style:
                const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
        const SizedBox(height: 4),
        for (final r in returns.whereType<Map>())
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                  BusinessDateTime.dateTime(r['created_at'],
                      fallback: _s(r['created_at'])),
                  style:
                      const TextStyle(fontSize: 11.5, color: DanColors.muted)),
              Text(
                  '${t('Số tiền hoàn')}: ${Fmt.money(_n(r['refund_total']).abs())}',
                  style: const TextStyle(
                      fontSize: 11.5, fontWeight: FontWeight.w700)),
              if (_s(r['id']).isNotEmpty)
                Text('${t('Mã phiếu trả')}: ${_s(r['id'])}',
                    style: const TextStyle(
                        fontSize: 11.5, color: DanColors.muted)),
              Text('${t('Trạng thái')}: ${t('Đã hoàn tất')}',
                  style:
                      const TextStyle(fontSize: 11.5, color: DanColors.done)),
            ]),
          ),
      ]);

  Widget _paymentBlocks(List payments) {
    final paid = <String>[];
    final refunded = <String>[];
    for (final p in payments.whereType<Map>()) {
      final amount = _n(p['amount']);
      final line =
          '${_methodName(_s(p['method']))}: ${Fmt.money(amount.abs())}';
      (amount < 0 ? refunded : paid).add(line);
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (paid.isNotEmpty) _labeledList(t('Thanh toán'), paid),
      if (refunded.isNotEmpty) ...[
        const SizedBox(height: 8),
        _labeledList(t('Hoàn tiền'), refunded),
      ],
    ]);
  }

  Widget _returnBadge(String status) {
    final full = status.toLowerCase() == 'full';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: DanColors.late.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(t(full ? 'Đã trả hết' : 'Đã trả một phần'),
          style: const TextStyle(
              color: DanColors.late,
              fontSize: 10.5,
              fontWeight: FontWeight.w800)),
    );
  }

  Widget _labeledList(String title, List<String> lines) =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title,
            style:
                const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
        const SizedBox(height: 4),
        for (final l in lines)
          Text(l,
              style: const TextStyle(fontSize: 11.5, color: DanColors.muted)),
      ]);

  String _einvoiceLabel(String s) => switch (s) {
        'ISSUED' || 'issued' => t('Đã phát hành'),
        'PROCESSING' || 'processing' => t('Đang xử lý'),
        'FAILED' || 'failed' => t('Lỗi'),
        'NOT_ISSUED' || 'not_issued' || '' => t('Chưa phát hành'),
        _ => s,
      };

  Future<void> _openBillViewer(
      String orderId, Map<String, dynamic> detail) async {
    final api = context.read<ApiService>();
    String receiptText = '';
    try {
      receiptText = await api.getOrderReceiptText(orderId, reprint: true);
    } catch (_) {}
    if (!mounted) return;
    final bill = (detail['bill'] as Map?) ?? const {};
    final title = 'Bill ${_s(bill['bill_code'] ?? orderId)}';
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => Dialog(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720, maxHeight: 780),
          child: Column(children: [
            _viewerHeader(
              dialogContext,
              title,
              onPrint: () async {
                if (receiptText.trim().isEmpty) {
                  appToast(context, t('Không tải được nội dung bill'),
                      isError: true);
                  return;
                }
                final result = await _manualPrinter.showReceipt(
                    text: receiptText, title: title);
                if (result != ManualPrintResult.opened && mounted) {
                  appToast(context,
                      t('Không thể mở bản xem trước in hiện đại của Windows.'),
                      isError: true);
                }
              },
              printLabel: t('In lại bill'),
            ),
            if (_s(bill['return_status']).toLowerCase() != 'none')
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: _returnBadge(_s(bill['return_status'])),
              ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: SelectableText(
                  receiptText.isEmpty
                      ? t('Không tải được nội dung bill')
                      : stripReceiptControlTokens(receiptText),
                  style: const TextStyle(
                      fontFamily: 'JetBrains Mono', height: 1.35),
                ),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  Future<void> _openVatViewer(Map bill) async {
    final pdfUrl = _s(bill['pdf_url']);
    final lookupUrl = _s(bill['lookup_url']);
    final title = _s(bill['invoice_no']).isEmpty
        ? t('Hóa đơn VAT')
        : '${t('Hóa đơn VAT')} ${_s(bill['invoice_no'])}';
    Uint8List? pdfBytes;

    Future<Uint8List?> loadPdf() async {
      if (pdfBytes != null) return pdfBytes;
      if (pdfUrl.isEmpty) return null;
      final response = await http.get(Uri.parse(pdfUrl));
      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          !isPrintablePdf(response.bodyBytes)) {
        throw Exception(t('Tài liệu hóa đơn không phải PDF hợp lệ'));
      }
      return pdfBytes = response.bodyBytes;
    }

    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => Dialog(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760, maxHeight: 700),
          child: Column(children: [
            _viewerHeader(
              dialogContext,
              title,
              onPrint: pdfUrl.isEmpty
                  ? null
                  : () async {
                      try {
                        final bytes = await loadPdf();
                        if (bytes != null && mounted) {
                          appToast(context,
                              t('Bridge in hóa đơn VAT đang chuẩn bị tài liệu Windows.'),
                              isError: true);
                        }
                      } catch (e) {
                        if (mounted) appToast(context, '$e', isError: true);
                      }
                    },
              printLabel: t('In hóa đơn'),
              extra: [
                if (lookupUrl.isNotEmpty)
                  OutlinedButton.icon(
                    onPressed: () => openExternalUrl(lookupUrl),
                    icon: const Icon(Icons.open_in_new, size: 17),
                    label: Text(t('Mở trên trình duyệt')),
                  ),
                if (lookupUrl.isNotEmpty)
                  IconButton(
                    tooltip: t('Copy link'),
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: lookupUrl));
                      if (mounted) appToast(context, t('Đã copy link hóa đơn'));
                    },
                    icon: const Icon(Icons.copy_outlined, size: 18),
                  ),
              ],
            ),
            Expanded(
              child: pdfUrl.isNotEmpty
                  ? PdfPreview(
                      build: (_) async {
                        final bytes = await loadPdf();
                        if (bytes == null) {
                          throw Exception(t('Không tải được tài liệu hóa đơn'));
                        }
                        return bytes;
                      },
                      allowPrinting: false,
                      allowSharing: false,
                      canChangeOrientation: false,
                      canChangePageFormat: false,
                      pdfFileName: '$title.pdf',
                    )
                  : Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child:
                            Column(mainAxisSize: MainAxisSize.min, children: [
                          const Icon(Icons.picture_as_pdf_outlined,
                              size: 64, color: DanColors.brand),
                          const SizedBox(height: 14),
                          Text(title,
                              style: const TextStyle(
                                  fontSize: 18, fontWeight: FontWeight.w800)),
                          const SizedBox(height: 8),
                          Text(
                              pdfUrl.isNotEmpty
                                  ? t('Tài liệu PDF chính thức đã sẵn sàng để xem hoặc in.')
                                  : t('Chưa có tài liệu PDF. Có thể mở đường dẫn tra cứu của nhà cung cấp.'),
                              textAlign: TextAlign.center),
                          if (lookupUrl.isNotEmpty) ...[
                            const SizedBox(height: 12),
                            SelectableText(lookupUrl,
                                textAlign: TextAlign.center,
                                style: const TextStyle(color: DanColors.brand)),
                          ],
                        ]),
                      ),
                    ),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _viewerHeader(BuildContext dialogContext, String title,
          {required Future<void> Function()? onPrint,
          required String printLabel,
          List<Widget> extra = const []}) =>
      Container(
        padding: const EdgeInsets.all(14),
        decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: DanColors.border))),
        child: Row(children: [
          Expanded(
              child: Text(title,
                  style: const TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w900))),
          ...extra,
          if (extra.isNotEmpty) const SizedBox(width: 8),
          FilledButton.icon(
            onPressed: onPrint,
            icon: const Icon(Icons.print_outlined, size: 18),
            label: Text(printLabel),
          ),
          const SizedBox(width: 8),
          IconButton(
              onPressed: () => Navigator.pop(dialogContext),
              icon: const Icon(Icons.close)),
        ]),
      );

  String _methodName(String method) => switch (method) {
        'cash' => t('Tiền mặt'),
        'card' || 'visa' => t('Thẻ'),
        'qr' || 'qrcode' || 'bank_transfer' => t('Chuyển khoản'),
        _ => method,
      };
}
