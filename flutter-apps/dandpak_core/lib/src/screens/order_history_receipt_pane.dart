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
    _refundReasonCtrl = TextEditingController(text: t('Khách trả hàng'));
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
    _refundReasonCtrl.text = t('Khách trả hàng');
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
                    onPressed: () {
                      setState(() {
                        _activeForm =
                            _activeForm == 'invoice' ? null : 'invoice';
                      });
                    },
                    icon: Icon(Icons.receipt_outlined, size: 17),
                    label: Text(t('Xuất hóa đơn VAT')),
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
                      side: BorderSide(color: DanColors.late),
                    ),
                    icon: Icon(Icons.undo, size: 17),
                    label: Text(t('Đổi trả / Hoàn hàng')),
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
      margin: EdgeInsets.only(top: 12),
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.late.withValues(alpha: .07),
        border: Border.all(color: DanColors.late.withValues(alpha: .25)),
        borderRadius: BorderRadius.circular(DanRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            t('Lý do đổi trả / hoàn hàng'),
            style: TextStyle(
                color: DanColors.muted,
                fontSize: 11,
                fontWeight: FontWeight.bold),
          ),
          SizedBox(height: 5),
          TextField(
            controller: _refundReasonCtrl,
            decoration: InputDecoration(
              hintText: t('VD: Khách trả hàng'),
              isDense: true,
            ),
          ),
          SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => setState(() => _activeForm = null),
                  child: Text(t('Hủy')),
                ),
              ),
              SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  onPressed: () {
                    final reason = _refundReasonCtrl.text.trim();
                    widget.onRefund
                        ?.call(reason.isEmpty ? t('Khách trả hàng') : reason);
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
      margin: EdgeInsets.only(top: 12),
      padding: EdgeInsets.all(12),
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
              decoration: taxLockedDecoration(
                      label: '', locked: _taxLookup.companyLocked)
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
                    onPressed: () => setState(() => _activeForm = null),
                    child: Text(t('Hủy')),
                  ),
                ),
                SizedBox(width: 8),
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
                    child: Text(t('Xuất hóa đơn VAT')),
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

