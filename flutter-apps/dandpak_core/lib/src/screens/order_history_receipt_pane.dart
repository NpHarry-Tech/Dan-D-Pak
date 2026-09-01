// GENERATED SPLIT of order_history_dialog.dart — khung xem hóa đơn (part of, cùng library).
part of 'order_history_dialog.dart';

class _ReceiptPane extends StatefulWidget {
  final Map<String, dynamic> receipt;

  /// Bill render sẵn theo mẫu in đã cấu hình (rỗng = fallback layout cũ).
  final String printText;
  final bool printing;
  final VoidCallback onPrint;
  final VoidCallback onCopy;
  final ValueChanged<String>? onRefund;
  final ValueChanged<Map<String, String>>? onIssueInvoice;

  _ReceiptPane({
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
    _refundReasonCtrl = TextEditingController(text: t('Trả hàng / hoàn hàng'));
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
    _refundReasonCtrl.text = t('Trả hàng / hoàn hàng');
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
    final reconciliation = _list(widget.receipt['payment_reconciliation']);
    final invoice = _map(widget.receipt['invoice']);
    final hasInvoice =
        invoice.isNotEmpty && _s(invoice['lookup_url']).isNotEmpty;

    return Column(
      children: [
        Container(
          padding: EdgeInsets.fromLTRB(16, 12, 16, 10),
          decoration: BoxDecoration(
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
                      style: TextStyle(
                        fontFamily: 'JetBrains Mono',
                        fontSize: 16,
                        color: DanColors.brand,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    _Badge(_statusLabel(_s(widget.receipt['status'])),
                        _statusColor(widget.receipt)),
                    if (locked) _Badge(t('Đã kết ca'), DanColors.text),
                    if (widget.receipt['invoice'] is Map)
                      _Badge(t('Đã xuất HĐĐT'), DanColors.brand),
                  ],
                ),
              ),
              SizedBox(width: 10),
              OutlinedButton.icon(
                onPressed: widget.onCopy,
                icon: Icon(Icons.copy_all_outlined),
                label: Text('Copy'),
              ),
              SizedBox(width: 8),
              FilledButton.icon(
                onPressed: widget.printing ? null : widget.onPrint,
                icon: widget.printing
                    ? SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(Icons.print_outlined),
                label: Text(t('In lại')),
              ),
            ],
          ),
        ),
        if (reconciliation.isNotEmpty)
          Container(
            width: double.infinity,
            padding: EdgeInsets.fromLTRB(16, 9, 16, 9),
            decoration: BoxDecoration(
              color: DanColors.brand.withValues(alpha: .06),
              border: Border(bottom: BorderSide(color: DanColors.border)),
            ),
            child: Wrap(
              spacing: 14,
              runSpacing: 6,
              children: [
                for (final row in reconciliation)
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('Mã đối soát CK: ${_s(row['reference'])}',
                          style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontFamily: 'JetBrains Mono',
                              color: DanColors.text)),
                      SizedBox(width: 6),
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        tooltip: 'Copy',
                        onPressed: () async {
                          await Clipboard.setData(
                              ClipboardData(text: _s(row['reference'])));
                          if (context.mounted)
                            ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text('Đã copy mã đối soát')));
                        },
                        icon: Icon(Icons.copy_outlined, size: 17),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        if (locked)
          Container(
            width: double.infinity,
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 9),
            color: DanColors.text.withValues(alpha: .06),
            child: Text(
              t('Bill đã kết ca. Các thao tác thay đổi sau bán cần PIN Quản lý/Admin.'),
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
            padding: EdgeInsets.fromLTRB(16, 10, 16, 10),
            decoration: BoxDecoration(
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
                    icon: Icon(Icons.search_outlined, size: 17),
                    label: Text(t('Tra cứu HĐĐT')),
                  ),
                if (widget.onIssueInvoice != null)
                  OutlinedButton.icon(
                    onPressed: _openInvoiceDialog,
                    icon: Icon(Icons.receipt_outlined, size: 17),
                    label: Text(t('Xuất hóa đơn VAT')),
                  ),
                if (widget.onRefund != null)
                  OutlinedButton.icon(
                    onPressed: _openRefundDialog,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: DanColors.late,
                      side: BorderSide(color: DanColors.late),
                    ),
                    icon: Icon(Icons.undo, size: 17),
                    label: Text(t('Trả hàng')),
                  ),
              ],
            ),
          ),
        Expanded(
          child: Container(
            color: DanColors.bg,
            child: SingleChildScrollView(
              padding: EdgeInsets.all(18),
              child: Center(
                child: Container(
                  constraints: BoxConstraints(maxWidth: 620),
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

  // #1a: Đổi trả hiện thành POPUP overlay (không expand dưới bill — khó thấy
  // trên màn nhỏ). Xác nhận thì đóng popup rồi mới gọi hoàn hàng.
  Future<void> _openRefundDialog() async {
    await showDialog<void>(
      context: context,
      builder: (dialogCtx) => Dialog(
        backgroundColor: DanColors.surface,
        insetPadding: EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: 440),
          child: SingleChildScrollView(
            padding: EdgeInsets.all(18),
            child: _buildRefundForm(dialogCtx),
          ),
        ),
      ),
    );
  }

  Widget _buildRefundForm(BuildContext dialogCtx) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Icon(Icons.undo, size: 18, color: DanColors.late),
          SizedBox(width: 8),
          Text(t('Trả hàng'),
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
        ]),
        SizedBox(height: 12),
        Text(
          t('Lý do xóa bill / hoàn trả'),
          style: TextStyle(
              color: DanColors.muted,
              fontSize: 11,
              fontWeight: FontWeight.bold),
        ),
        SizedBox(height: 5),
        TextField(
          controller: _refundReasonCtrl,
          decoration: InputDecoration(
            hintText: t('VD: Khách trả hàng / hủy bill sai'),
            isDense: true,
          ),
        ),
        SizedBox(height: 14),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () => Navigator.of(dialogCtx).pop(),
                child: Text(t('Hủy')),
              ),
            ),
            SizedBox(width: 8),
            Expanded(
              child: FilledButton(
                onPressed: () {
                  final reason = _refundReasonCtrl.text.trim();
                  Navigator.of(dialogCtx).pop();
                  widget.onRefund?.call(
                      reason.isEmpty ? t('Trả hàng / hoàn trả') : reason);
                },
                style: FilledButton.styleFrom(
                  backgroundColor: DanColors.late,
                  foregroundColor: Colors.white,
                ),
                child: Text('Hoàn ${Fmt.money(_n(widget.receipt['total']))}'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  // #1a: Xuất VAT cũng hiện thành POPUP overlay thay vì expand dưới bill.
  Future<void> _openInvoiceDialog() async {
    await showDialog<void>(
      context: context,
      builder: (dialogCtx) => Dialog(
        backgroundColor: DanColors.surface,
        insetPadding: EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: 520, maxHeight: 640),
          child: SingleChildScrollView(
            padding: EdgeInsets.all(18),
            child: _buildInvoiceForm(dialogCtx),
          ),
        ),
      ),
    );
  }

  Widget _buildInvoiceForm(BuildContext dialogCtx) {
    return ListenableBuilder(
      listenable: _taxLookup,
      builder: (context, _) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.receipt_outlined, size: 18, color: DanColors.brand),
            SizedBox(width: 8),
            Text(t('Xuất hóa đơn VAT'),
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
          ]),
          SizedBox(height: 12),
          Text(t('Mã số thuế'),
              style: TextStyle(
                  fontSize: 11,
                  color: DanColors.muted,
                  fontWeight: FontWeight.bold)),
          SizedBox(height: 4),
          MstField(
            lookup: _taxLookup,
            label: '',
            hint: t('MST (nếu xuất cho công ty)'),
            onMessage: (m, {bool error = false}) =>
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text(m),
              backgroundColor: error ? DanColors.late : DanColors.text,
            )),
          ),
          SizedBox(height: 8),
          Text(t('Tên người mua / công ty'),
              style: TextStyle(
                  fontSize: 11,
                  color: DanColors.muted,
                  fontWeight: FontWeight.bold)),
          SizedBox(height: 4),
          TextField(
            controller: _invoiceNameCtrl,
            readOnly: _taxLookup.companyLocked,
            decoration:
                taxLockedDecoration(label: '', locked: _taxLookup.companyLocked)
                    .copyWith(hintText: t('Tên cá nhân hoặc công ty')),
          ),
          SizedBox(height: 8),
          Text(t('Địa chỉ'),
              style: TextStyle(
                  fontSize: 11,
                  color: DanColors.muted,
                  fontWeight: FontWeight.bold)),
          SizedBox(height: 4),
          AddressFields(
            address: _invoiceAddrCtrl,
            detail: _invoiceAddrDetailCtrl,
            ward: _invoiceAddrWardCtrl,
            province: _invoiceAddrProvinceCtrl,
            wardCode: _invoiceWardCodeCtrl,
            provinceCode: _invoiceProvinceCodeCtrl,
            label: t('Địa chỉ trên hóa đơn'),
            locked: _taxLookup.addressLocked,
          ),
          SizedBox(height: 8),
          Text(t('Email nhận hóa đơn'),
              style: TextStyle(
                  fontSize: 11,
                  color: DanColors.muted,
                  fontWeight: FontWeight.bold)),
          SizedBox(height: 4),
          TextField(
            controller: _invoiceEmailCtrl,
            decoration:
                InputDecoration(hintText: 'email@congty.vn', isDense: true),
          ),
          SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.of(dialogCtx).pop(),
                  child: Text(t('Hủy')),
                ),
              ),
              SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  onPressed: () {
                    Navigator.of(dialogCtx).pop();
                    widget.onIssueInvoice?.call({
                      'name': _invoiceNameCtrl.text.trim(),
                      'tax_code': _invoiceTaxCtrl.text.trim(),
                      'address': _invoiceAddrCtrl.text.trim(),
                      'address_detail': _invoiceAddrDetailCtrl.text.trim(),
                      'address_ward': _invoiceAddrWardCtrl.text.trim(),
                      'address_province': _invoiceAddrProvinceCtrl.text.trim(),
                      'ward_code': _invoiceWardCodeCtrl.text.trim(),
                      'province_code': _invoiceProvinceCodeCtrl.text.trim(),
                      'email': _invoiceEmailCtrl.text.trim(),
                    });
                  },
                  child: Text(t('Xuất hóa đơn VAT')),
                ),
              ),
            ],
          ),
        ],
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
