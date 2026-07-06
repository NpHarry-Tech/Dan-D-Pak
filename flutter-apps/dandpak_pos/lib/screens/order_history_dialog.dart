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

String _s(dynamic v) => v?.toString() ?? '';
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;

const _channels = [
  MapEntry('', 'Tất cả kênh'),
  MapEntry('dine_in', 'Tại bàn'),
  MapEntry('retail', 'Bán lẻ'),
  MapEntry('online', 'Online'),
  MapEntry('takeaway', 'Mang đi'),
];

const _methodLabels = {
  'cash': 'Tiền mặt',
  'bank': 'Chuyển khoản',
  'card': 'Thẻ',
  'bank_transfer': 'Chuyển khoản',
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

  /// Retail mode: show "Đổi trả / Hoàn hàng" on paid retail bills
  /// (mirrors the web shared orderHistory `allowRefund` option).
  final bool allowRefund;

  /// Called after a mutation (refund / VAT invoice) so the opening screen can
  /// refresh its own data (stock, shift, vouchers...).
  final VoidCallback? onAfterChange;

  const OrderHistoryDialog({
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
    _debounce = Timer(const Duration(milliseconds: 280), () {
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
            ? 'Đã gửi lệnh in lại hóa đơn'
            : 'Đã gửi ${jobs.length} lệnh in lại hóa đơn',
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
    if (mounted) _toast('Đã copy nội dung hóa đơn');
  }

  void _toast(String message, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? DanColors.late : DanColors.text,
      ),
    );
  }

  /// Bill đã KẾT CA → cần PIN Quản lý/Admin trước khi thay đổi (giống web
  /// `withManagerPin`); ca còn mở thì trả về chuỗi rỗng (không cần PIN).
  /// Trả về null nếu người dùng huỷ.
  Future<String?> _pinIfLocked(Map<String, dynamic> receipt) async {
    if (receipt['locked'] != true) return '';
    return requestManagerPin(
      context,
      'Bill đã KẾT CA — cần PIN Quản lý/Admin để xác nhận thay đổi.',
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
      insetPadding: const EdgeInsets.all(18),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1160, maxHeight: 760),
        child: Column(
          children: [
            _header(),
            const Divider(height: 1, color: DanColors.border),
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final compact = constraints.maxWidth < 860;
                  if (compact) {
                    return Column(
                      children: [
                        SizedBox(height: 300, child: _leftPane()),
                        const Divider(height: 1, color: DanColors.border),
                        Expanded(child: _rightPane()),
                      ],
                    );
                  }
                  return Row(
                    children: [
                      SizedBox(width: 390, child: _leftPane()),
                      const VerticalDivider(width: 1, color: DanColors.border),
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
      padding: const EdgeInsets.fromLTRB(18, 14, 10, 12),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: DanColors.brandDim,
              borderRadius: BorderRadius.circular(DanRadius.sm),
            ),
            child: const Icon(
              Icons.receipt_long_outlined,
              color: DanColors.brand,
              size: 20,
            ),
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Lịch sử bán hàng',
                  style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
                ),
                SizedBox(height: 2),
                Text(
                  'Xem lại đơn đã thanh toán, hóa đơn đã hủy, trạng thái ca và in lại receipt.',
                  style: TextStyle(color: DanColors.muted, fontSize: 12.5),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Đóng',
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.close),
          ),
        ],
      ),
    );
  }

  Widget _leftPane() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
          child: Column(
            children: [
              TextField(
                controller: _search,
                onChanged: _onSearchChanged,
                onSubmitted: (_) => _load(keepSelection: false),
                decoration: const InputDecoration(
                  hintText: 'Tìm mã đơn / bàn / mã HĐ...',
                  prefixIcon: Icon(Icons.search),
                ),
              ),
              const SizedBox(height: 9),
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
                  const SizedBox(width: 8),
                  Tooltip(
                    message: 'Tải lại',
                    child: OutlinedButton(
                      onPressed: _loadingList ? null : () => _load(),
                      child: const Icon(Icons.refresh),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const Divider(height: 1, color: DanColors.border),
        Expanded(
          child: _loadingList
              ? const Center(child: CircularProgressIndicator())
              : _listError != null
                  ? Padding(
                      padding: const EdgeInsets.all(18),
                      child: InlineMessage(
                        'Không tải được lịch sử ($_listError)',
                        error: true,
                        onRetry: () => _load(keepSelection: false),
                      ),
                    )
                  : _orders.isEmpty
                      ? const Center(
                          child: Text(
                            'Không có đơn nào',
                            style: TextStyle(color: DanColors.faint),
                          ),
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.all(12),
                          itemCount: _orders.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 8),
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
      return const Center(
        child: Text(
          'Chọn một đơn để xem chi tiết',
          style: TextStyle(color: DanColors.faint),
        ),
      );
    }
    if (_loadingReceipt) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_receiptError != null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: InlineMessage(
          'Không tải được chi tiết hóa đơn ($_receiptError)',
          error: true,
          onRetry: () => _loadReceipt(_s(_selected?['id'])),
        ),
      );
    }
    final receipt = _receipt;
    if (receipt == null) {
      return const Center(
        child: Text(
          'Chưa có dữ liệu hóa đơn',
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

  const _HistoryRow({
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
        padding: const EdgeInsets.all(12),
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
                    style: const TextStyle(
                      color: DanColors.brand,
                      fontFamily: 'JetBrains Mono',
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                Text(
                  Fmt.money(_n(order['total'])),
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ],
            ),
            const SizedBox(height: 5),
            Row(
              children: [
                Expanded(
                  child: Text(
                    _s(order['channel_label']),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style:
                        const TextStyle(color: DanColors.muted, fontSize: 12),
                  ),
                ),
                Text(
                  date,
                  style: const TextStyle(color: DanColors.faint, fontSize: 11),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              '${_n(order['item_count']).round()} món · ${methods.isEmpty ? '-' : methods}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: DanColors.muted, fontSize: 11.5),
            ),
            if (voided || locked || invoiceNo.isNotEmpty) ...[
              const SizedBox(height: 7),
              Wrap(
                spacing: 6,
                runSpacing: 5,
                children: [
                  if (locked) const _Badge('Đã kết ca', DanColors.text),
                  if (voided) const _Badge('Đã hủy', DanColors.late),
                  if (invoiceNo.isNotEmpty)
                    _Badge('HĐ $invoiceNo', DanColors.brand),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ReceiptPane extends StatefulWidget {
  final Map<String, dynamic> receipt;

  /// Bill render sẵn theo mẫu in đã cấu hình (rỗng = fallback layout cũ).
  final String printText;
  final bool printing;
  final VoidCallback onPrint;
  final VoidCallback onCopy;
  final ValueChanged<String>? onRefund;
  final ValueChanged<Map<String, String>>? onIssueInvoice;

  const _ReceiptPane({
    required this.receipt,
    this.printText = '',
    required this.printing,
    required this.onPrint,
    required this.onCopy,
    this.onRefund,
    this.onIssueInvoice,
  });

  @override
  State<_ReceiptPane> createState() => _ReceiptPaneState();
}

class _ReceiptPaneState extends State<_ReceiptPane> {
  String? _activeForm; // 'refund', 'invoice', or null

  late final TextEditingController _refundReasonCtrl;
  late final TextEditingController _invoiceNameCtrl;
  late final TextEditingController _invoiceTaxCtrl;
  late final TextEditingController _invoiceAddrCtrl;
  late final TextEditingController _invoiceAddrDetailCtrl;
  late final TextEditingController _invoiceAddrWardCtrl;
  late final TextEditingController _invoiceAddrProvinceCtrl;
  late final TextEditingController _invoiceWardCodeCtrl;
  late final TextEditingController _invoiceProvinceCodeCtrl;
  late final TextEditingController _invoiceEmailCtrl;

  late final TaxLookupController _taxLookup;

  @override
  void initState() {
    super.initState();
    _refundReasonCtrl = TextEditingController(text: 'Khách trả hàng');
    _invoiceNameCtrl = TextEditingController();
    _invoiceTaxCtrl = TextEditingController();
    _invoiceAddrCtrl = TextEditingController();
    _invoiceAddrDetailCtrl = TextEditingController();
    _invoiceAddrWardCtrl = TextEditingController();
    _invoiceAddrProvinceCtrl = TextEditingController();
    _invoiceWardCodeCtrl = TextEditingController();
    _invoiceProvinceCodeCtrl = TextEditingController();
    _invoiceEmailCtrl = TextEditingController();
    // Truy xuất Cục Thuế theo MST: tên công ty + địa chỉ truy xuất được sẽ
    // khóa; xóa MST để nhập/kiểm tra lại.
    _taxLookup = TaxLookupController(
      api: context.read<ApiService>(),
      mst: _invoiceTaxCtrl,
      company: _invoiceNameCtrl,
      address: _invoiceAddrCtrl,
    );
    _initControllers();
  }

  @override
  void didUpdateWidget(_ReceiptPane oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.receipt['order_id'] != oldWidget.receipt['order_id'] ||
        widget.receipt['id'] != oldWidget.receipt['id']) {
      _activeForm = null;
      _initControllers();
    }
  }

  void _initControllers() {
    final c = widget.receipt['customer'] is Map
        ? Map<String, dynamic>.from(widget.receipt['customer'] as Map)
        : <String, dynamic>{};
    // Đổi bill → bỏ khóa Cục Thuế trước khi seed lại form.
    _taxLookup.resetLock();
    _invoiceTaxCtrl.text = _s(c['tax_code']);
    _invoiceNameCtrl.text = _s(c['name']);
    _invoiceAddrCtrl.text = _s(c['address']);
    _invoiceAddrDetailCtrl.text = _s(c['address_detail']);
    _invoiceAddrWardCtrl.text = _s(c['address_ward']);
    _invoiceAddrProvinceCtrl.text = _s(c['address_province']);
    _invoiceWardCodeCtrl.text = _s(c['ward_code']);
    _invoiceProvinceCodeCtrl.text = _s(c['province_code']);
    _invoiceEmailCtrl.text = _s(c['email']);
    _refundReasonCtrl.text = 'Khách trả hàng';
  }

  @override
  void dispose() {
    _taxLookup.dispose();
    _refundReasonCtrl.dispose();
    _invoiceNameCtrl.dispose();
    _invoiceTaxCtrl.dispose();
    _invoiceAddrCtrl.dispose();
    _invoiceAddrDetailCtrl.dispose();
    _invoiceAddrWardCtrl.dispose();
    _invoiceAddrProvinceCtrl.dispose();
    _invoiceWardCodeCtrl.dispose();
    _invoiceProvinceCodeCtrl.dispose();
    _invoiceEmailCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final locked = widget.receipt['locked'] == true;
    final invoice = _map(widget.receipt['invoice']);
    final hasInvoice =
        invoice.isNotEmpty && _s(invoice['lookup_url']).isNotEmpty;

    return Column(
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
          decoration: const BoxDecoration(
            color: DanColors.surface,
            border: Border(bottom: BorderSide(color: DanColors.border)),
          ),
          child: Row(
            children: [
              Expanded(
                child: Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      '#${_s(widget.receipt['bill_no'] ?? widget.receipt['number'])}',
                      style: const TextStyle(
                        fontFamily: 'JetBrains Mono',
                        fontSize: 16,
                        color: DanColors.brand,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    _Badge(_statusLabel(_s(widget.receipt['status'])),
                        _statusColor(widget.receipt)),
                    if (locked) const _Badge('Đã kết ca', DanColors.text),
                    if (widget.receipt['invoice'] is Map)
                      const _Badge('Đã xuất HĐĐT', DanColors.brand),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              OutlinedButton.icon(
                onPressed: widget.onCopy,
                icon: const Icon(Icons.copy_all_outlined),
                label: const Text('Copy'),
              ),
              const SizedBox(width: 8),
              FilledButton.icon(
                onPressed: widget.printing ? null : widget.onPrint,
                icon: widget.printing
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.print_outlined),
                label: const Text('In lại'),
              ),
            ],
          ),
        ),
        if (locked)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
            color: DanColors.text.withValues(alpha: .06),
            child: const Text(
              'Bill đã kết ca. Các thao tác thay đổi sau bán cần PIN Quản lý/Admin.',
              style: TextStyle(
                color: DanColors.text,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        // Web-parity action bar (dưới banner kết ca, trên receipt):
        // Xuất hóa đơn VAT · Đổi trả / Hoàn hàng · Tra cứu HĐĐT.
        if (widget.onRefund != null ||
            widget.onIssueInvoice != null ||
            hasInvoice)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
            decoration: const BoxDecoration(
              color: DanColors.surface,
              border: Border(bottom: BorderSide(color: DanColors.border)),
            ),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (hasInvoice)
                  OutlinedButton.icon(
                    onPressed: () => _launchUrl(_s(invoice['lookup_url'])),
                    icon: const Icon(Icons.search_outlined, size: 17),
                    label: const Text('Tra cứu HĐĐT'),
                  ),
                if (widget.onIssueInvoice != null)
                  OutlinedButton.icon(
                    onPressed: () {
                      setState(() {
                        _activeForm =
                            _activeForm == 'invoice' ? null : 'invoice';
                      });
                    },
                    icon: const Icon(Icons.receipt_outlined, size: 17),
                    label: const Text('Xuất hóa đơn VAT'),
                  ),
                if (widget.onRefund != null)
                  OutlinedButton.icon(
                    onPressed: () {
                      setState(() {
                        _activeForm = _activeForm == 'refund' ? null : 'refund';
                      });
                    },
                    style: OutlinedButton.styleFrom(
                      foregroundColor: DanColors.late,
                      side: const BorderSide(color: DanColors.late),
                    ),
                    icon: const Icon(Icons.undo, size: 17),
                    label: const Text('Đổi trả / Hoàn hàng'),
                  ),
              ],
            ),
          ),
        Expanded(
          child: Container(
            color: DanColors.bg,
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(18),
              child: Center(
                child: Container(
                  constraints: const BoxConstraints(maxWidth: 620),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Preview = ĐÚNG nội dung tờ in theo mẫu đã cấu hình
                      // trong Cài đặt (server render cùng engine với máy in);
                      // chỉ khi không lấy được mới fallback layout dựng tay.
                      if (widget.printText.trim().isNotEmpty)
                        _ReceiptPaper(text: widget.printText)
                      else
                        _ReceiptCard(receipt: widget.receipt),
                      if (_activeForm == 'refund') _buildRefundForm(),
                      if (_activeForm == 'invoice') _buildInvoiceForm(),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildRefundForm() {
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.late.withValues(alpha: .07),
        border: Border.all(color: DanColors.late.withValues(alpha: .25)),
        borderRadius: BorderRadius.circular(DanRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Lý do đổi trả / hoàn hàng',
            style: TextStyle(
                color: DanColors.muted,
                fontSize: 11,
                fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 5),
          TextField(
            controller: _refundReasonCtrl,
            decoration: const InputDecoration(
              hintText: 'VD: Khách trả hàng',
              isDense: true,
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => setState(() => _activeForm = null),
                  child: const Text('Hủy'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  onPressed: () {
                    final reason = _refundReasonCtrl.text.trim();
                    widget.onRefund
                        ?.call(reason.isEmpty ? 'Khách trả hàng' : reason);
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor: DanColors.late,
                    foregroundColor: Colors.white,
                  ),
                  child: Text(
                      'Xác nhận hoàn ${Fmt.money(_n(widget.receipt['total']))}'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildInvoiceForm() {
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        border: Border.all(color: DanColors.border2),
        borderRadius: BorderRadius.circular(DanRadius.sm),
      ),
      child: ListenableBuilder(
        listenable: _taxLookup,
        builder: (context, _) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Mã số thuế',
                style: TextStyle(
                    fontSize: 11,
                    color: DanColors.muted,
                    fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            MstField(
              lookup: _taxLookup,
              label: '',
              hint: 'MST (nếu xuất cho công ty)',
              onMessage: (m, {bool error = false}) =>
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                content: Text(m),
                backgroundColor: error ? DanColors.late : DanColors.text,
              )),
            ),
            const SizedBox(height: 8),
            const Text('Tên người mua / công ty',
                style: TextStyle(
                    fontSize: 11,
                    color: DanColors.muted,
                    fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            TextField(
              controller: _invoiceNameCtrl,
              readOnly: _taxLookup.companyLocked,
              decoration: taxLockedDecoration(
                      label: '', locked: _taxLookup.companyLocked)
                  .copyWith(hintText: 'Tên cá nhân hoặc công ty'),
            ),
            const SizedBox(height: 8),
            const Text('Địa chỉ',
                style: TextStyle(
                    fontSize: 11,
                    color: DanColors.muted,
                    fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            AddressFields(
              address: _invoiceAddrCtrl,
              detail: _invoiceAddrDetailCtrl,
              ward: _invoiceAddrWardCtrl,
              province: _invoiceAddrProvinceCtrl,
              wardCode: _invoiceWardCodeCtrl,
              provinceCode: _invoiceProvinceCodeCtrl,
              label: 'Địa chỉ trên hóa đơn',
              locked: _taxLookup.addressLocked,
            ),
            const SizedBox(height: 8),
            const Text('Email nhận hóa đơn',
                style: TextStyle(
                    fontSize: 11,
                    color: DanColors.muted,
                    fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            TextField(
              controller: _invoiceEmailCtrl,
              decoration: const InputDecoration(
                  hintText: 'email@congty.vn', isDense: true),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => setState(() => _activeForm = null),
                    child: const Text('Hủy'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    onPressed: () {
                      widget.onIssueInvoice?.call({
                        'name': _invoiceNameCtrl.text.trim(),
                        'tax_code': _invoiceTaxCtrl.text.trim(),
                        'address': _invoiceAddrCtrl.text.trim(),
                        'address_detail': _invoiceAddrDetailCtrl.text.trim(),
                        'address_ward': _invoiceAddrWardCtrl.text.trim(),
                        'address_province':
                            _invoiceAddrProvinceCtrl.text.trim(),
                        'ward_code': _invoiceWardCodeCtrl.text.trim(),
                        'province_code': _invoiceProvinceCodeCtrl.text.trim(),
                        'email': _invoiceEmailCtrl.text.trim(),
                      });
                    },
                    child: const Text('Xuất hóa đơn VAT'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> _launchUrl(String url) async {
  if (url.isEmpty) return;
  try {
    if (Platform.isWindows) {
      await Process.run('cmd', ['/c', 'start', '', url]);
    } else if (Platform.isMacOS) {
      await Process.run('open', [url]);
    } else if (Platform.isLinux) {
      await Process.run('xdg-open', [url]);
    }
  } catch (e) {
    debugPrint('Failed to open URL: $e');
  }
}

/// Tờ bill "giấy": hiển thị NGUYÊN VĂN nội dung server render theo mẫu in đã
/// cấu hình (monospace = khớp từng cột với tờ in nhiệt).
class _ReceiptPaper extends StatelessWidget {
  final String text;
  const _ReceiptPaper({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border2),
        boxShadow: const [
          BoxShadow(
            color: Color(0x12102840),
            blurRadius: 20,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SelectableText(
          text,
          style: const TextStyle(
            fontFamily: 'JetBrains Mono',
            fontSize: 12,
            height: 1.45,
            color: DanColors.text,
          ),
        ),
      ),
    );
  }
}

class _ReceiptCard extends StatelessWidget {
  final Map<String, dynamic> receipt;

  const _ReceiptCard({required this.receipt});

  @override
  Widget build(BuildContext context) {
    final company = _map(receipt['company']);
    final customer = _map(receipt['customer']);
    final invoice = _map(receipt['invoice']);
    final items = _list(receipt['items']);
    final lines = _list(receipt['lines']);
    return Center(
      child: Container(
        constraints: const BoxConstraints(maxWidth: 620),
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(DanRadius.md),
          border: Border.all(color: DanColors.border2),
          boxShadow: const [
            BoxShadow(
              color: Color(0x12102840),
              blurRadius: 20,
              offset: Offset(0, 8),
            ),
          ],
        ),
        child: DefaultTextStyle(
          style: const TextStyle(color: DanColors.text, fontSize: 12.5),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Column(
                  children: [
                    Text(
                      _s(company['name']).isEmpty
                          ? 'DAN D PAK'
                          : _s(company['name']),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    if (_s(company['address']).isNotEmpty)
                      Text(
                        _s(company['address']),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                            color: DanColors.muted, fontSize: 11),
                      ),
                    Text(
                      [
                        if (_s(company['tax_code']).isNotEmpty)
                          'MST: ${_s(company['tax_code'])}',
                        if (_s(company['phone']).isNotEmpty)
                          'ĐT: ${_s(company['phone'])}',
                      ].join(' · '),
                      textAlign: TextAlign.center,
                      style:
                          const TextStyle(color: DanColors.muted, fontSize: 11),
                    ),
                  ],
                ),
              ),
              const Divider(height: 24, color: DanColors.border2),
              const Text(
                'HÓA ĐƠN BÁN HÀNG',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 2),
              const Text(
                '(Khởi tạo từ máy tính tiền)',
                textAlign: TextAlign.center,
                style: TextStyle(color: DanColors.muted, fontSize: 11),
              ),
              const SizedBox(height: 14),
              Wrap(
                spacing: 10,
                runSpacing: 8,
                children: [
                  _Meta(
                    label: 'Số Bill nội bộ',
                    value: _s(receipt['bill_no'] ?? receipt['number']),
                  ),
                  _Meta(
                    label: 'Transaction ID',
                    value: _s(receipt['id']),
                  ),
                  if (invoice.isNotEmpty &&
                      _s(invoice['invoice_no']).isNotEmpty)
                    _Meta(label: 'Số HĐĐT', value: _s(invoice['invoice_no'])),
                  if (invoice.isNotEmpty &&
                      _s(invoice['invoice_series']).isNotEmpty)
                    _Meta(
                        label: 'Ký hiệu HĐ',
                        value: _s(invoice['invoice_series'])),
                  _Meta(
                    label: 'Ngày lập',
                    value: _date(receipt['paid_at'] ?? receipt['created_at']),
                  ),
                  _Meta(
                    label: 'Thu ngân',
                    value: _s(receipt['cashier']).isEmpty
                        ? '-'
                        : _s(receipt['cashier']),
                  ),
                  _Meta(label: 'Quầy / Bàn', value: _placeLabel(receipt)),
                  if (_s(customer['name']).isNotEmpty)
                    _Meta(label: 'Khách hàng', value: _s(customer['name'])),
                  if (_s(customer['tax_code']).isNotEmpty)
                    _Meta(label: 'MST khách', value: _s(customer['tax_code'])),
                ],
              ),
              const SizedBox(height: 16),
              _ItemsTable(items: items),
              const Divider(height: 22, color: DanColors.border2),
              _sumLine('Cộng tiền hàng',
                  receipt['goods_amount'] ?? receipt['subtotal']),
              if (_n(receipt['discount']) > 0)
                _sumLine('Giảm giá', -_n(receipt['discount'])),
              _sumLine('Thuế GTGT (${_n(receipt['vat_rate']).round()}%)',
                  receipt['vat_amount']),
              _sumLine('TỔNG THANH TOÁN', receipt['total'], grand: true),
              if (_s(receipt['total_words']).isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  'Bằng chữ: ${_s(receipt['total_words'])}',
                  style: const TextStyle(
                    color: DanColors.muted,
                    fontSize: 11.5,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ],
              const SizedBox(height: 12),
              _sumLine('Hình thức TT', _paymentMethods(lines), money: false),
              _sumLine('Trạng thái', _statusLabel(_s(receipt['status'])),
                  money: false),
              if (_n(receipt['change']) > 0)
                _sumLine('Tiền thối', receipt['change']),
              if (invoice.isNotEmpty) ...[
                const Divider(height: 22, color: DanColors.border2),
                Text(
                  'MÃ CỦA CƠ QUAN THUẾ:\n${_s(invoice['lookup_code'])}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontFamily: 'JetBrains Mono',
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
              const Divider(height: 22, color: DanColors.border2),
              const Text(
                'HÓA ĐƠN ĐIỆN TỬ KHỞI TẠO TỪ MÁY TÍNH TIỀN\nCẢM ƠN QUÝ KHÁCH - HẸN GẶP LẠI!',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sumLine(
    String label,
    dynamic value, {
    bool grand = false,
    bool money = true,
  }) {
    final text = money
        ? Fmt.money(value is num ? value : _n(value))
        : (value is String ? value : _s(value));
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontWeight: grand ? FontWeight.w900 : FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Text(
            text,
            textAlign: TextAlign.right,
            style: TextStyle(
              fontSize: grand ? 16 : 12.5,
              fontWeight: FontWeight.w900,
              color: grand ? DanColors.brand : DanColors.text,
            ),
          ),
        ],
      ),
    );
  }
}

class _ItemsTable extends StatelessWidget {
  final List<Map<String, dynamic>> items;

  const _ItemsTable({required this.items});

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 18),
        child: Center(
          child: Text('Không có món', style: TextStyle(color: DanColors.faint)),
        ),
      );
    }
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: const BoxDecoration(
            border: Border(
              bottom: BorderSide(color: DanColors.border2),
              top: BorderSide(color: DanColors.border2),
            ),
          ),
          child: const Row(
            children: [
              SizedBox(width: 34, child: Text('STT')),
              Expanded(child: Text('Mặt hàng')),
              SizedBox(
                  width: 96,
                  child: Text('Thành tiền', textAlign: TextAlign.right)),
            ],
          ),
        ),
        for (var i = 0; i < items.length; i++)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 8),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: DanColors.border)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 34,
                  child: Text((i + 1).toString().padLeft(2, '0')),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _s(items[i]['name']),
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                      if (_modsText(items[i]).isNotEmpty)
                        Text(
                          '+ ${_modsText(items[i])}',
                          style: const TextStyle(
                            color: DanColors.muted,
                            fontSize: 11,
                          ),
                        ),
                      if (_promoText(items[i]).isNotEmpty)
                        Text(
                          'KM: ${_promoText(items[i])}',
                          style: const TextStyle(
                            color: DanColors.brand,
                            fontSize: 11,
                            fontStyle: FontStyle.italic,
                          ),
                        ),
                      Text(
                        '${_n(items[i]['qty'])} x ${Fmt.money(_n(items[i]['unit_price']))}',
                        style: const TextStyle(
                          color: DanColors.faint,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(
                  width: 96,
                  child: Text(
                    Fmt.money(items[i]['line_total'] is num
                        ? items[i]['line_total']
                        : _n(items[i]['qty']) * _n(items[i]['unit_price'])),
                    textAlign: TextAlign.right,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _Meta extends StatelessWidget {
  final String label;
  final String value;

  const _Meta({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 180,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: DanColors.surface2,
          borderRadius: BorderRadius.circular(DanRadius.sm),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(color: DanColors.muted, fontSize: 10.5),
            ),
            const SizedBox(height: 2),
            Text(
              value.isEmpty ? '-' : value,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
          ],
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String text;
  final Color color;

  const _Badge(this.text, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

String _date(dynamic value) {
  final d = DateTime.tryParse(_s(value))?.toLocal();
  return d == null ? '-' : Fmt.dmyHm(d);
}

String _paymentMethods(dynamic value) {
  final rows = _list(value);
  if (rows.isEmpty) return '';
  return rows
      .map((row) => _methodLabels[_s(row['method'])] ?? _s(row['method']))
      .where((label) => label.isNotEmpty)
      .join(', ');
}

String _placeLabel(Map<String, dynamic> receipt) {
  final online = _s(receipt['online_channel']);
  if (online.isNotEmpty) return online;
  final channel = _s(receipt['channel']);
  if (channel == 'retail') return 'Bán lẻ';
  if (channel == 'takeaway') return 'Mang đi';
  final table = _s(receipt['table_code']);
  return table.isEmpty ? 'Tại quầy' : 'Bàn $table';
}

String _statusLabel(String status) {
  switch (status) {
    case 'paid':
      return 'Đã thanh toán';
    case 'void':
      return 'Đã hủy';
    case 'open':
      return 'Đang mở';
    default:
      return status.isEmpty ? '-' : status;
  }
}

Color _statusColor(Map<String, dynamic> receipt) {
  return _s(receipt['status']) == 'void' ? DanColors.late : DanColors.done;
}

String _modsText(Map<String, dynamic> item) {
  final mods = item['mods'];
  if (mods is! List) return '';
  return mods
      .map((mod) {
        if (mod is Map) return _s(mod['label'] ?? mod['name']);
        return _s(mod);
      })
      .where((text) => text.isNotEmpty)
      .join(', ');
}

String _promoText(Map<String, dynamic> item) {
  final promo = _map(item['promo']);
  if (promo.isEmpty) return '';
  final name = _s(promo['name'] ?? promo['code']);
  final amount = _n(promo['amount']);
  final free = _n(promo['free_units']);
  final parts = <String>[
    if (amount > 0) 'giảm ${Fmt.money(amount)}',
    if (free > 0)
      'tặng ${free.round()} ${_s(promo['free_product_name']).isEmpty ? 'sản phẩm' : _s(promo['free_product_name'])}',
  ];
  if (parts.isEmpty && _s(promo['description']).isNotEmpty) {
    return _s(promo['description']);
  }
  if (name.isEmpty) return parts.join(', ');
  return parts.isEmpty ? name : '$name: ${parts.join(', ')}';
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map) return Map<String, dynamic>.from(value);
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _list(dynamic value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((row) => Map<String, dynamic>.from(row))
      .toList();
}

String _receiptText(Map<String, dynamic> r) {
  final items = _list(r['items']);
  final lines = _list(r['lines']);
  final buffer = StringBuffer()
    ..writeln('HOA DON BAN HANG')
    ..writeln('Bill: ${_s(r['bill_no'] ?? r['number'])}')
    ..writeln('Ngay: ${_date(r['paid_at'] ?? r['created_at'])}')
    ..writeln('Thu ngan: ${_s(r['cashier'])}')
    ..writeln('Ban/Kenh: ${_placeLabel(r)}')
    ..writeln('------------------------------');
  for (final item in items) {
    buffer.writeln(
      '${_n(item['qty'])} x ${_s(item['name'])} = ${Fmt.money(item['line_total'] is num ? item['line_total'] : _n(item['qty']) * _n(item['unit_price']))}',
    );
    final promo = _promoText(item);
    if (promo.isNotEmpty) buffer.writeln('  KM: $promo');
  }
  buffer
    ..writeln('------------------------------')
    ..writeln('Tong: ${Fmt.money(_n(r['total']))}')
    ..writeln('Thanh toan: ${_paymentMethods(lines)}')
    ..writeln('Trang thai: ${_statusLabel(_s(r['status']))}');
  return buffer.toString();
}
