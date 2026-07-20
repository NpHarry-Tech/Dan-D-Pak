import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../ui/app_theme.dart';
import '../ui/format.dart';
import '../widgets/address_fields.dart';
import '../widgets/manager_pin_dialog.dart';
import '../widgets/tax_lookup.dart';
import 'management/management_widgets.dart';
import '../utils/translation.dart';

part 'order_history_receipt_pane.dart';
part 'order_history_receipt_widgets.dart';

String _s(dynamic v) => v?.toString() ?? '';
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;

List<MapEntry<String, String>> get _channels => [
      MapEntry('', t('Tất cả kênh')),
      MapEntry('dine_in', t('Tại bàn')),
      MapEntry('retail', t('Bán lẻ')),
      MapEntry('online', 'Online'),
      MapEntry('takeaway', t('Mang đi')),
    ];

Map<String, String> get _methodLabels => {
      'cash': t('Tiền mặt'),
      'bank': t('Chuyển khoản'),
      'card': t('Thẻ'),
      'bank_transfer': t('Chuyển khoản'),
      'internet_banking': 'Internet Banking',
      'qrcode': 'QR',
      'qr': 'QR',
      'momo': 'MoMo',
      'zalopay': 'ZaloPay',
      'visa': 'Visa',
      'voucher': 'Voucher',
    };

class OrderHistoryDialog extends StatefulWidget {
  final ApiService api;

  /// Retail mode: show t("Đổi trả / Hoàn hàng") on paid retail bills
  /// (mirrors the web shared orderHistory `allowRefund` option).
  final bool allowRefund;

  /// Called after a mutation (refund / VAT invoice) so the opening screen can
  /// refresh its own data (stock, shift, vouchers...).
  final VoidCallback? onAfterChange;

  OrderHistoryDialog({
    super.key,
    required this.api,
    this.allowRefund = false,
    this.onAfterChange,
  });

  @override
  State<OrderHistoryDialog> createState() => _OrderHistoryDialogState();
}

class _OrderHistoryDialogState extends State<OrderHistoryDialog> {
  final _search = TextEditingController();
  final List<Map<String, dynamic>> _orders = [];

  Timer? _debounce;
  Map<String, dynamic>? _selected;
  Map<String, dynamic>? _receipt;
  bool _loadingList = true;
  bool _loadingReceipt = false;
  bool _printing = false;
  String _channel = '';
  String? _listError;
  String? _receiptError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({bool keepSelection = true}) async {
    setState(() {
      _loadingList = true;
      _listError = null;
    });
    try {
      final rows = await widget.api.getOrderHistory(
        limit: 80,
        q: _search.text,
        channel: _channel,
      );
      final mapped = rows
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      if (!mounted) return;

      final selectedId = keepSelection ? _s(_selected?['id']) : '';
      final selected = selectedId.isEmpty
          ? (mapped.isEmpty ? null : mapped.first)
          : mapped.cast<Map<String, dynamic>?>().firstWhere(
                (row) => _s(row?['id']) == selectedId,
                orElse: () => mapped.isEmpty ? null : mapped.first,
              );

      setState(() {
        _orders
          ..clear()
          ..addAll(mapped);
        _selected = selected;
        _loadingList = false;
        _listError = null;
      });

      if (selected != null) {
        await _loadReceipt(_s(selected['id']));
      } else if (mounted) {
        setState(() {
          _receipt = null;
          _receiptError = null;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _listError = e.toString().replaceFirst('Exception: ', '');
        _loadingList = false;
      });
    }
  }

  // Nội dung bill theo ĐÚNG mẫu in đã cấu hình (server render cùng engine
  // với máy in) — preview trong pane phải khớp 100% tờ in.
  String _receiptPrintText = '';

  Future<void> _loadReceipt(String id) async {
    if (id.isEmpty) return;
    setState(() {
      _loadingReceipt = true;
      _receiptError = null;
    });
    try {
      final results = await Future.wait<dynamic>([
        widget.api.getOrderReceipt(id),
        widget.api.getOrderReceiptText(id, reprint: true).catchError((_) => ''),
      ]);
      if (!mounted) return;
      setState(() {
        _receipt = results[0] as Map<String, dynamic>;
        _receiptPrintText = results[1] as String;
        _loadingReceipt = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _receipt = null;
        _receiptPrintText = '';
        _receiptError = e.toString().replaceFirst('Exception: ', '');
        _loadingReceipt = false;
      });
    }
  }

  void _select(Map<String, dynamic> order) {
    setState(() => _selected = order);
    _loadReceipt(_s(order['id']));
  }

  void _onSearchChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(Duration(milliseconds: 280), () {
      if (mounted) _load(keepSelection: false);
    });
  }

  Future<void> _printReceipt() async {
    final id = _s(_receipt?['order_id'] ?? _selected?['id']);
    if (id.isEmpty) return;
    setState(() => _printing = true);
    try {
      final jobs = await widget.api.printOrderReceipt(id);
      if (!mounted) return;
      _toast(
        jobs.isEmpty
            ? t('Đã gửi lệnh in lại hóa đơn')
            : t('Đã gửi ${jobs.length} lệnh in lại hóa đơn'),
      );
    } catch (e) {
      if (!mounted) return;
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _printing = false);
    }
  }

  Future<void> _copyReceipt() async {
    final receipt = _receipt;
    if (receipt == null) return;
    await Clipboard.setData(ClipboardData(text: _receiptText(receipt)));
    if (mounted) _toast(t('Đã copy nội dung hóa đơn'));
  }

  void _toast(String message, {bool error = false}) =>
      appToast(context, message, isError: error);

  /// Bill đã KẾT CA → cần PIN Quản lý/Admin trước khi thay đổi (giống web
  /// `withManagerPin`); ca còn mở thì trả về chuỗi rỗng (không cần PIN).
  /// Trả về null nếu người dùng huỷ.
  Future<String?> _pinIfLocked(Map<String, dynamic> receipt) async {
    if (receipt['locked'] != true) return '';
    return requestManagerPin(
      context,
      t('Bill đã KẾT CA — cần PIN Quản lý/Admin để xác nhận thay đổi.'),
    );
  }

  /// Đổi trả / hoàn hàng cho bill retail đã thanh toán (web parity).
  Future<void> _refund(String reason) async {
    final receipt = _receipt;
    if (receipt == null) return;
    final orderId = _s(receipt['order_id'] ?? _selected?['id']);
    if (orderId.isEmpty) return;
    final pin = await _pinIfLocked(receipt);
    if (pin == null) return;
    try {
      final res = await widget.api.retailRefund(orderId, {
        'reason': reason,
        if (pin.isNotEmpty) 'security_pin': pin,
      });
      if (!mounted) return;
      _toast('Đã hoàn ${Fmt.money(_n(res['refunded'] ?? receipt['total']))}');
      widget.onAfterChange?.call();
      await _load();
      await _loadReceipt(orderId);
    } catch (e) {
      if (mounted) {
        _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
      }
    }
  }

  /// Xuất hóa đơn VAT cho bill đã thanh toán ngay từ Lịch sử (web parity).
  Future<void> _issueInvoice(Map<String, String> customer) async {
    final receipt = _receipt;
    if (receipt == null) return;
    final orderId = _s(receipt['order_id'] ?? _selected?['id']);
    if (orderId.isEmpty) return;
    final pin = await _pinIfLocked(receipt);
    if (pin == null) return;
    try {
      final res = await widget.api.issueInvoice({
        'order_id': orderId,
        'customer': customer,
        if (pin.isNotEmpty) 'security_pin': pin,
      });
      if (!mounted) return;
      final invoiceNo = _s(res['invoice_no']);
      _toast('Đã xuất hóa đơn VAT${invoiceNo.isEmpty ? '' : ' $invoiceNo'}');
      widget.onAfterChange?.call();
      await _load();
      await _loadReceipt(orderId);
    } catch (e) {
      if (mounted) {
        _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: DanColors.surface,
      insetPadding: EdgeInsets.all(18),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 1160, maxHeight: 760),
        child: Column(
          children: [
            _header(),
            Divider(height: 1, color: DanColors.border),
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final compact = constraints.maxWidth < 860;
                  if (compact) {
                    return Column(
                      children: [
                        SizedBox(height: 300, child: _leftPane()),
                        Divider(height: 1, color: DanColors.border),
                        Expanded(child: _rightPane()),
                      ],
                    );
                  }
                  return Row(
                    children: [
                      SizedBox(width: 390, child: _leftPane()),
                      VerticalDivider(width: 1, color: DanColors.border),
                      Expanded(child: _rightPane()),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _header() {
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 14, 10, 12),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: DanColors.brandDim,
              borderRadius: BorderRadius.circular(DanRadius.sm),
            ),
            child: Icon(
              Icons.receipt_long_outlined,
              color: DanColors.brand,
              size: 20,
            ),
          ),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  t('Lịch sử bán hàng'),
                  style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
                ),
                SizedBox(height: 2),
                Text(
                  t('Xem lại đơn đã thanh toán, hóa đơn đã hủy, trạng thái ca và in lại receipt.'),
                  style: TextStyle(color: DanColors.muted, fontSize: 12.5),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: t('Đóng'),
            onPressed: () => Navigator.of(context).pop(),
            icon: Icon(Icons.close),
          ),
        ],
      ),
    );
  }

  Widget _leftPane() {
    return Column(
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(14, 14, 14, 10),
          child: Column(
            children: [
              TextField(
                controller: _search,
                onChanged: _onSearchChanged,
                onSubmitted: (_) => _load(keepSelection: false),
                decoration: InputDecoration(
                  hintText: t('Tìm mã đơn / bàn / mã HĐ...'),
                  prefixIcon: Icon(Icons.search),
                ),
              ),
              SizedBox(height: 9),
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _channel,
                      items: [
                        for (final channel in _channels)
                          DropdownMenuItem(
                            value: channel.key,
                            child: Text(channel.value),
                          ),
                      ],
                      onChanged: (value) {
                        setState(() => _channel = value ?? '');
                        _load(keepSelection: false);
                      },
                    ),
                  ),
                  SizedBox(width: 8),
                  Tooltip(
                    message: t('Tải lại'),
                    child: OutlinedButton(
                      onPressed: _loadingList ? null : () => _load(),
                      child: Icon(Icons.refresh),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        Divider(height: 1, color: DanColors.border),
        Expanded(
          child: _loadingList
              ? Center(child: CircularProgressIndicator())
              : _listError != null
                  ? Padding(
                      padding: EdgeInsets.all(18),
                      child: InlineMessage(
                        t('Không tải được lịch sử ($_listError)'),
                        error: true,
                        onRetry: () => _load(keepSelection: false),
                      ),
                    )
                  : _orders.isEmpty
                      ? Center(
                          child: Text(
                            t('Không có đơn nào'),
                            style: TextStyle(color: DanColors.faint),
                          ),
                        )
                      : ListView.separated(
                          padding: EdgeInsets.all(12),
                          itemCount: _orders.length,
                          separatorBuilder: (_, __) => SizedBox(height: 8),
                          itemBuilder: (context, index) {
                            final order = _orders[index];
                            return _HistoryRow(
                              order: order,
                              selected: _s(order['id']) == _s(_selected?['id']),
                              onTap: () => _select(order),
                            );
                          },
                        ),
        ),
      ],
    );
  }

  Widget _rightPane() {
    if (_selected == null && !_loadingList) {
      return Center(
        child: Text(
          t('Chọn một đơn để xem chi tiết'),
          style: TextStyle(color: DanColors.faint),
        ),
      );
    }
    if (_loadingReceipt) {
      return Center(child: CircularProgressIndicator());
    }
    if (_receiptError != null) {
      return Padding(
        padding: EdgeInsets.all(24),
        child: InlineMessage(
          t('Không tải được chi tiết hóa đơn ($_receiptError)'),
          error: true,
          onRetry: () => _loadReceipt(_s(_selected?['id'])),
        ),
      );
    }
    final receipt = _receipt;
    if (receipt == null) {
      return Center(
        child: Text(
          t('Chưa có dữ liệu hóa đơn'),
          style: TextStyle(color: DanColors.faint),
        ),
      );
    }
    // Web-parity action gating: refund only for paid retail bills (and only
    // when the opener enables it); VAT invoice for paid bills without one,
    // if the user has the 'invoice' permission (server re-checks anyway).
    final status = _s(receipt['status']);
    final channel = _s(receipt['channel']);
    final canRefund =
        widget.allowRefund && status == 'paid' && channel == 'retail';
    final canIssue = status == 'paid' &&
        receipt['invoice'] is! Map &&
        context.read<AuthProvider>().hasPermission('invoice');
    return _ReceiptPane(
      receipt: receipt,
      printText: _receiptPrintText,
      printing: _printing,
      onPrint: _printReceipt,
      onCopy: _copyReceipt,
      onRefund: canRefund ? _refund : null,
      onIssueInvoice: canIssue ? _issueInvoice : null,
    );
  }
}

class _HistoryRow extends StatelessWidget {
  final Map<String, dynamic> order;
  final bool selected;
  final VoidCallback onTap;

  _HistoryRow({
    required this.order,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final date = _date(order['paid_at'] ?? order['created_at']);
    final methods = _paymentMethods(order['methods']);
    final voided = _s(order['status']) == 'void';
    final locked = order['locked'] == true;
    final invoiceNo = _s(order['invoice_no']);
    return InkWell(
      borderRadius: BorderRadius.circular(DanRadius.sm),
      onTap: onTap,
      child: Container(
        padding: EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected ? DanColors.brandDim : DanColors.surface,
          borderRadius: BorderRadius.circular(DanRadius.sm),
          border: Border.all(
            color: selected ? DanColors.brand : DanColors.border,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '#${_s(order['number']).isEmpty ? _s(order['id']) : _s(order['number'])}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: DanColors.brand,
                      fontFamily: 'JetBrains Mono',
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                Text(
                  Fmt.money(_n(order['total'])),
                  style: TextStyle(fontWeight: FontWeight.w900),
                ),
              ],
            ),
            SizedBox(height: 5),
            Row(
              children: [
                Expanded(
                  child: Text(
                    _s(order['channel_label']),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: DanColors.muted, fontSize: 12),
                  ),
                ),
                Text(
                  date,
                  style: TextStyle(color: DanColors.faint, fontSize: 11),
                ),
              ],
            ),
            SizedBox(height: 6),
            Text(
              '${_n(order['item_count']).round()} món · ${methods.isEmpty ? ')-' : methods}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: DanColors.muted, fontSize: 11.5),
            ),
            if (voided || locked || invoiceNo.isNotEmpty) ...[
              SizedBox(height: 7),
              Wrap(
                spacing: 6,
                runSpacing: 5,
                children: [
                  if (locked) _Badge(t('Đã kết ca'), DanColors.text),
                  if (voided) _Badge(t('Đã hủy'), DanColors.late),
                  if (invoiceNo.isNotEmpty)
                    _Badge(t('HĐ $invoiceNo'), DanColors.brand),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

