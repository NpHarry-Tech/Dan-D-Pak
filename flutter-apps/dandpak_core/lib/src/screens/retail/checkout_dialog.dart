import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/retail_models.dart';
import '../../providers/customer_display_controller.dart';
import '../../services/api_service.dart';
import '../../services/card_terminal_service.dart';
import '../../services/system_log.dart';
import '../../ui/app_theme.dart';
import '../../widgets/address_fields.dart';
import '../../widgets/manual_confirm_dialog.dart';
import '../../widgets/tax_lookup.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';

class CheckoutDialog extends StatefulWidget {
  final ApiService api;
  final List<CartLine> cart;
  final Map<String, dynamic> operationsConfig;
  final String invoiceLabel;
  final RetailCustomer? customer;
  final RetailVoucher? voucher;
  final num subtotal;
  final num productDiscount;
  final num orderDiscount;
  final num customerDiscount;
  final num manualDiscount;
  final num total;
  final num vatAmount;
  final String? orderId;
  final int? itemCount;
  final String channelLabel;

  CheckoutDialog({
    super.key,
    required this.api,
    required this.cart,
    required this.operationsConfig,
    required this.invoiceLabel,
    required this.customer,
    required this.voucher,
    required this.subtotal,
    required this.productDiscount,
    required this.orderDiscount,
    required this.customerDiscount,
    required this.manualDiscount,
    required this.total,
    this.vatAmount = 0,
    this.orderId,
    this.itemCount,
    this.channelLabel = 'Checkout',
  });

  bool get existingOrder => orderId?.trim().isNotEmpty == true;

  @override
  State<CheckoutDialog> createState() => _CheckoutDialogState();
}

class _CheckoutDialogState extends State<CheckoutDialog> {
  final String _clientRequestId =
      'retail_${DateTime.now().microsecondsSinceEpoch}';
  final _amountCtrl = TextEditingController();
  final _adjustmentCtrl = TextEditingController();
  final _refCtrl = TextEditingController();
  final _taxCtrl = TextEditingController();
  final _companyCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  final _addressCtrl = TextEditingController();
  final _addressDetailCtrl = TextEditingController();
  final _addressWardCtrl = TextEditingController();
  final _addressProvinceCtrl = TextEditingController();
  final _wardCodeCtrl = TextEditingController();
  final _provinceCodeCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();

  final List<PaymentLine> _lines = [];
  String _method = 'cash';
  bool _invoiceEnabled = false;
  bool _paying = false;
  bool _qrLoading = false;
  bool _posLoading = false;
  Map<String, dynamic>? _qrData;
  String? _qrError;

  CustomerDisplayController? _display; // 2nd-screen mirror (may be absent)
  // Tra cuu Cuc Thue theo MST; ten cong ty va dia chi tra ve se bi khoa.
  late final TaxLookupController _taxLookup;
  // PIN xac nhan thu cong neu co dong bank doi soat tay, gui kem checkout.
  String? _manualPin;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    try {
      _display ??= context.read<CustomerDisplayController>();
    } catch (_) {}
  }

  @override
  void initState() {
    super.initState();
    _taxLookup = TaxLookupController(
      api: widget.api,
      mst: _taxCtrl,
      company: _companyCtrl,
      address: _addressCtrl,
    );
    // Header box khách hiển thị tên công ty khi bật xuất hóa đơn — cập nhật
    // theo từng phím gõ.
    _companyCtrl.addListener(() {
      if (_invoiceEnabled && mounted) setState(() {});
    });
    final methods = _methods;
    _method = methods.isNotEmpty ? methods.first.key : 'cash';
    _amountCtrl.text = _payable.round().toString();
    if (widget.manualDiscount > 0) {
      _adjustmentCtrl.text = widget.manualDiscount.round().toString();
    }
    _applyDefaultRef();

    final c = widget.customer;
    if (c != null && c.autoInvoice) {
      _invoiceEnabled = true;
      _taxCtrl.text = c.taxCode;
      _companyCtrl.text = c.company;
      _nameCtrl.text = c.name;
      _addressCtrl.text = c.address;
      _addressDetailCtrl.text = c.addressDetail;
      _addressWardCtrl.text = c.addressWard;
      _addressProvinceCtrl.text = c.addressProvince;
      _wardCodeCtrl.text = c.wardCode;
      _provinceCodeCtrl.text = c.provinceCode;
      _emailCtrl.text = c.email;
      _phoneCtrl.text = c.phone;
    }
  }

  @override
  void dispose() {
    _display?.resume(); // customer screen back to ads/order
    _taxLookup.dispose();
    _amountCtrl.dispose();
    _adjustmentCtrl.dispose();
    _refCtrl.dispose();
    _taxCtrl.dispose();
    _companyCtrl.dispose();
    _nameCtrl.dispose();
    _addressCtrl.dispose();
    _addressDetailCtrl.dispose();
    _addressWardCtrl.dispose();
    _addressProvinceCtrl.dispose();
    _wardCodeCtrl.dispose();
    _provinceCodeCtrl.dispose();
    _emailCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  Map<String, dynamic> get _paymentCfg {
    final raw = widget.operationsConfig['payment'];
    return raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
  }

  List<_PayMethod> get _methods {
    final raw = _paymentCfg['methods'];
    final rows = raw is List ? raw : [];
    final parsed = rows
        .whereType<Map>()
        .map((e) => _PayMethod.fromJson(Map<String, dynamic>.from(e)))
        .where((m) => m.enabled)
        .toList();
    if (parsed.isNotEmpty) return parsed;
    // 4 phương thức chuẩn (đã gom): Internet Banking + QR → Chuyển khoản;
    // Máy POS + Visa → Visa. Server cũng consolidate config cũ về đúng bộ này.
    return [
      _PayMethod('cash', t('Tiền mặt'), 'cash', true),
      _PayMethod('bank', t('Chuyển khoản'), 'qr', true),
      _PayMethod('visa', 'Visa', 'pos', true),
      _PayMethod('voucher', 'Voucher', 'voucher', true),
    ];
  }

  _PayMethod get _currentMethod => _methods.firstWhere(
        (m) => m.key == _method,
        orElse: () => _PayMethod(_method, _method, 'other', true),
      );

  bool get _isQr {
    final m = _currentMethod;
    return m.kind == 'qr' ||
        m.kind == 'wallet' ||
        ['bank', 'internet_banking', 'qrcode', 'qr', 'momo', 'zalopay']
            .contains(m.key);
  }

  bool get _isPos {
    final m = _currentMethod;
    return m.kind == 'pos' || ['card', 'visa', 'pos_card'].contains(m.key);
  }

  num get _adjustment => retailN(_adjustmentCtrl.text.trim())
      .clamp(0, (widget.total + widget.manualDiscount).toDouble());
  num get _payable => (widget.total - _adjustment).clamp(0, double.infinity);
  num get _vatPayable => widget.total > 0
      ? (widget.vatAmount * _payable / widget.total).round()
      : 0;
  num get _paid => _lines.fold<num>(0, (s, l) => s + l.amount);
  num get _remain => (_payable - _paid).clamp(0, double.infinity);
  num get _change => (_paid - _payable).clamp(0, double.infinity);
  num get _pendingAmount {
    final typed = retailN(_amountCtrl.text.trim());
    return typed > 0 ? typed : (_remain > 0 ? _remain : _payable);
  }

  void _toast(String message, {bool error = false}) =>
      appToast(context, message, isError: error);

  void _applyDefaultRef() {
    final ref = _defaultReference(_method);
    if (_refCtrl.text.trim().isEmpty && ref.isNotEmpty) _refCtrl.text = ref;
  }

  String _defaultReference(String method) {
    final prefix = retailS(_paymentCfg['transferPrefix']).trim().isEmpty
        ? 'DANBILL'
        : retailS(_paymentCfg['transferPrefix']).trim().toUpperCase();
    final invoice = widget.invoiceLabel.replaceAll(RegExp(r'\s+'), '');
    if (['card', 'visa', 'pos_card'].contains(method)) {
      return 'POS-$invoice';
    }
    if (['bank', 'internet_banking', 'qrcode', 'qr', 'momo', 'zalopay']
        .contains(method)) {
      return '$prefix-$invoice';
    }
    return '';
  }

  String _dynamicQrUrl(num amount, String ref) {
    final bankCode = retailS(_paymentCfg['bankCode']).trim();
    final bankAccount = retailS(_paymentCfg['bankAccount']).trim();
    if (bankCode.isEmpty || bankAccount.isEmpty) return '';
    return Uri.https(
      'img.vietqr.io',
      '/image/$bankCode-$bankAccount-compact2.png',
      {
        'amount': amount.round().toString(),
        'addInfo': ref,
        'accountName': retailS(_paymentCfg['accountName']),
      },
    ).toString();
  }

  Future<void> _refreshQr() async {
    if (!_isQr) return;
    final amount = _pendingAmount;
    final ref = _refCtrl.text.trim().isEmpty
        ? _defaultReference(_method)
        : _refCtrl.text.trim();
    setState(() {
      _qrLoading = true;
      _qrError = null;
      _qrData = {
        'imageUrl': _dynamicQrUrl(amount, ref),
        'reference': ref,
        'providerLabel': t('Đang tạo QR...'),
      };
    });
    try {
      final data = await widget.api.buildPaymentQr({
        'amount': amount.round(),
        'reference': ref,
        'method': _method,
      });
      if (!mounted) return;
      setState(() {
        _qrData = data;
        _qrLoading = false;
      });
      // Mirror the QR onto the customer-facing 2nd screen.
      _display?.showPayment(
        method: t('Chuyển khoản QR'),
        total: amount,
        subtotal: amount - _vatPayable,
        tax: _vatPayable,
        qrImageUrl: data['imageUrl']?.toString() ?? '',
        qrData: data['qrString']?.toString() ?? data['qr']?.toString() ?? '',
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _qrError = e.toString().replaceFirst('Exception: ', '');
        _qrLoading = false;
      });
    }
  }

  Future<void> _checkPayos() async {
    final orderCode = retailS(_qrData?['orderCode']);
    if (orderCode.isEmpty) return;
    try {
      final status = await widget.api.getPayosPaymentStatus(orderCode);
      if (retailB(status['paid'])) {
        final amount = retailN(status['amountPaid']);
        _addLine(amount > 0 ? amount : _pendingAmount,
            ref: retailS(_qrData?['reference']).isEmpty
                ? _refCtrl.text.trim()
                : retailS(_qrData?['reference']));
        _display?.markPaid();
        _toast(t('Khách đã thanh toán qua payOS'));
      } else {
        _toast(
            'payOS: ${retailS(status['status']).isEmpty ? 'chưa thanh toán' : status['status']}');
      }
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  Future<void> _chargePos() async {
    final card = _paymentCfg['cardTerminal'] is Map
        ? Map<String, dynamic>.from(_paymentCfg['cardTerminal'])
        : <String, dynamic>{};
    final mode =
        retailS(card['mode']).isEmpty ? 'manual' : retailS(card['mode']);
    final terminal = retailS(card['terminalName']).isEmpty
        ? retailS(_paymentCfg['posTerminalName'])
        : retailS(card['terminalName']);
    final ip = card['ip']?.toString();
    final portVal = card['port'];
    final port =
        portVal is int ? portVal : int.tryParse(portVal?.toString() ?? '');

    setState(() => _posLoading = true);
    try {
      final result = await CardTerminalService.charge(
        amount: _pendingAmount.toDouble(),
        reference: _refCtrl.text.trim().isEmpty
            ? _defaultReference(_method)
            : _refCtrl.text.trim(),
        billNo: widget.invoiceLabel,
        terminalName: terminal,
        mode: mode,
        ip: ip,
        port: port,
      );
      if (!mounted) return;
      if (retailB(result['approved'])) {
        final ref = [
          retailS(result['txnId']),
          retailS(result['approval']),
          retailS(result['rrn']),
        ].where((s) => s.isNotEmpty).join(' / ');
        _addLine(_pendingAmount, ref: ref.isEmpty ? _refCtrl.text.trim() : ref);
        _toast(t('Máy POS đã duyệt giao dịch'));
      } else {
        _toast(
            retailS(result['error']).isEmpty
                ? t('Nhập approval code thủ công rồi thêm dòng thanh toán')
                : retailS(result['error']),
            error: true);
      }
    } finally {
      if (mounted) setState(() => _posLoading = false);
    }
  }

  void _addLine(num amount, {String? ref}) {
    if (amount <= 0) {
      _toast(t('Nhập số tiền > 0'), error: true);
      return;
    }
    setState(() {
      _lines.add(PaymentLine(
        method: _method,
        amount: amount,
        reference: ref ?? _refCtrl.text.trim(),
      ));
      _amountCtrl.text = _remain.round().toString();
      _refCtrl.clear();
      _applyDefaultRef();
      _qrData = null;
      _qrError = null;
    });
  }

  /// Khách báo đã chuyển nhưng hệ thống không tự khớp (quét QR cũ, webhook
  /// chậm, mất mạng): đối soát tiền-về chưa khớp hoặc xác nhận tay — cả hai
  /// đường server đều bắt PIN của chính thu ngân + ghi audit.
  Future<void> _manualConfirmBank() async {
    final amount = _pendingAmount;
    if (amount <= 0) {
      _toast(t('Không còn số tiền cần thu'), error: true);
      return;
    }
    final result = await showManualConfirmDialog(
      context,
      api: widget.api,
      amount: amount.round(),
    );
    if (result == null || !mounted) return;
    setState(() {
      _manualPin = result.pin;
      _lines.add(PaymentLine(
        method: 'bank',
        amount: amount,
        reference: result.reference.isEmpty
            ? (_refCtrl.text.trim().isEmpty
                ? _defaultReference('bank')
                : _refCtrl.text.trim())
            : result.reference,
        bankTxId: result.bankTxId,
        manualReason: result.reason,
      ));
      _amountCtrl.text = _remain.round().toString();
      _refCtrl.clear();
      _applyDefaultRef();
      _qrData = null;
      _qrError = null;
    });
    _display?.markPaid();
  }

  Map<String, dynamic>? _invoicePayload() {
    if (!_invoiceEnabled) return null;
    final taxCode = _taxCtrl.text.trim();
    final company = _companyCtrl.text.trim();
    final name = _nameCtrl.text.trim();
    final address = _addressCtrl.text.trim();
    final email = _emailCtrl.text.trim();
    final phone = _phoneCtrl.text.trim();

    final hasAny = taxCode.isNotEmpty ||
        company.isNotEmpty ||
        name.isNotEmpty ||
        address.isNotEmpty ||
        email.isNotEmpty ||
        phone.isNotEmpty;

    if (!hasAny) throw Exception(t('Nhập thông tin xuất hóa đơn'));
    if (name.isEmpty && company.isEmpty) {
      throw Exception(t('Nhập tên khách hoặc tên công ty xuất hóa đơn'));
    }

    return {
      'invoice_request': true,
      'tax_code': taxCode,
      'company': company,
      'name': name,
      'address': address,
      'address_detail': _addressDetailCtrl.text.trim(),
      'address_ward': _addressWardCtrl.text.trim(),
      'address_province': _addressProvinceCtrl.text.trim(),
      'ward_code': _wardCodeCtrl.text.trim(),
      'province_code': _provinceCodeCtrl.text.trim(),
      'email': email,
      'phone': phone,
    };
  }

  Future<void> _confirm() async {
    if (_lines.isEmpty && _pendingAmount > 0) _addLine(_pendingAmount);
    if (_paid < _payable) {
      _toast(t('Chưa đủ tiền thanh toán'), error: true);
      return;
    }

    Map<String, dynamic>? invoiceCustomer;
    try {
      invoiceCustomer = _invoicePayload();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
      return;
    }

    setState(() => _paying = true);
    final body = {
      'items': [
        for (final c in widget.cart)
          {
            'sku_id': c.sku.id,
            'qty': c.qty,
            'lot_id': c.lotId,
            'voucher_id': c.voucherId,
          },
      ],
      'voucher_id': widget.voucher?.id,
      'payments': [for (final l in _lines) l.toJson()],
      'customer': widget.customer?.toCheckoutCustomer(),
      'customer_id': widget.customer?.id,
      'invoice_customer': invoiceCustomer,
      'manual_discount': _adjustment.round(),
      'client_request_id': _clientRequestId,
      if (_manualPin != null && _manualPin!.isNotEmpty)
        'security_pin': _manualPin,
    };
    try {
      // Checkout va in bill dung chung mot correlationId de truy vet tron flow.
      await SystemLog.runFlow('checkout', () async {
        final receipt = widget.existingOrder
            ? await widget.api.payOrder(widget.orderId!.trim(), {
                'lines': [for (final l in _lines) l.toJson()],
                'discount': (widget.productDiscount +
                        widget.orderDiscount +
                        widget.customerDiscount +
                        _adjustment)
                    .round(),
                'customer': widget.customer?.toCheckoutCustomer(),
                'invoice_customer': invoiceCustomer,
                if (_manualPin != null && _manualPin!.isNotEmpty)
                  'security_pin': _manualPin,
              })
            : await widget.api.retailCheckout(body);
        final orderId =
            receipt['id']?.toString() ?? receipt['order_id']?.toString() ?? '';
        final billNo = receipt['bill_no']?.toString() ??
            receipt['number']?.toString() ??
            '';
        final printError = receipt['idempotent_replay'] == true
            ? null
            : await widget.api
                .forcePrintReceiptJob(orderId: orderId, billNo: billNo);
        if (!mounted) return;
        final out = Map<String, dynamic>.from(receipt);
        if (printError != null && printError.isNotEmpty) {
          out['print_error'] = printError;
        }
        Navigator.of(context).pop(out);
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _paying = false);
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    return Dialog(
      backgroundColor: DanColors.surface,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: 760,
          maxHeight: size.height * .9,
        ),
        child: Column(
          children: [
            _header(),
            Divider(height: 1, color: DanColors.border),
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _customerBox(),
                    SizedBox(height: 12),
                    _summaryBox(),
                    SizedBox(height: 14),
                    _methodBox(),
                    SizedBox(height: 12),
                    _paymentLines(),
                  ],
                ),
              ),
            ),
            Divider(height: 1, color: DanColors.border),
            _footer(),
          ],
        ),
      ),
    );
  }

  Widget _header() {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 18, 14, 14),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${widget.channelLabel} ${widget.invoiceLabel}',
                    style:
                        TextStyle(fontSize: 19, fontWeight: FontWeight.w900)),
                SizedBox(height: 3),
                Text(
                    '${widget.itemCount ?? widget.cart.length} ${t('dòng hàng')}',
                    style: TextStyle(fontSize: 12.5, color: DanColors.faint)),
              ],
            ),
          ),
          Text(Fmt.money(_payable),
              style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                  color: DanColors.brand)),
          IconButton(
            onPressed: () => Navigator.of(context).pop(),
            icon: Icon(Icons.close, color: DanColors.faint),
          ),
        ],
      ),
    );
  }

  Widget _customerBox() {
    final c = widget.customer;
    return Container(
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Icon(Icons.person_outline, size: 18, color: DanColors.muted),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  // Gạt t("Xuất hóa đơn công ty") = khách CÓ yêu cầu hóa đơn —
                  // không được hiện t("không yêu cầu") nữa.
                  c != null
                      ? c.title
                      : _invoiceEnabled
                          ? (_companyCtrl.text.trim().isNotEmpty
                              ? _companyCtrl.text.trim()
                              : t('Khách yêu cầu xuất hóa đơn'))
                          : t('Bán cho người tiêu dùng'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
              if (c?.perkLabel.isNotEmpty == true)
                _MiniPill(c!.perkLabel, DanColors.done),
            ],
          ),
          if (c != null && c.subtitle.isNotEmpty) ...[
            SizedBox(height: 4),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(c.subtitle,
                  style: TextStyle(fontSize: 11.5, color: DanColors.muted)),
            ),
          ],
          SizedBox(height: 10),
          SwitchListTile(
            value: _invoiceEnabled,
            dense: true,
            contentPadding: EdgeInsets.zero,
            title: Text(t('Xuất hóa đơn công ty'),
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
            onChanged: (v) => setState(() => _invoiceEnabled = v),
          ),
          if (_invoiceEnabled) ...[
            SizedBox(height: 8),
            _invoiceFields(),
          ],
        ],
      ),
    );
  }

  Widget _invoiceFields() {
    return LayoutBuilder(builder: (context, c) {
      final twoCols = c.maxWidth > 560;
      // Tên công ty / Địa chỉ truy xuất từ Cục Thuế bị khóa (readOnly) — muốn
      // đổi phải xóa MST và truy xuất lại; các trường nhập tay sửa tự do.
      return ListenableBuilder(
        listenable: _taxLookup,
        builder: (context, _) => Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            SizedBox(
              width: (twoCols ? 230.0 : c.maxWidth).clamp(140, double.infinity),
              child: MstField(
                lookup: _taxLookup,
                onMessage: (m, {bool error = false}) => _toast(m, error: error),
              ),
            ),
            _field(_companyCtrl, t('Tên công ty'),
                width: twoCols ? c.maxWidth - 238 : c.maxWidth,
                locked: _taxLookup.companyLocked),
            _field(_nameCtrl, t('Người nhận hóa đơn'),
                width: twoCols ? 220 : c.maxWidth),
            _field(_phoneCtrl, t('Số điện thoại'),
                width: twoCols ? 160 : c.maxWidth),
            _field(_emailCtrl, 'Email',
                width: twoCols ? c.maxWidth - 388 : c.maxWidth),
            SizedBox(
              width: c.maxWidth,
              child: AddressFields(
                address: _addressCtrl,
                detail: _addressDetailCtrl,
                ward: _addressWardCtrl,
                province: _addressProvinceCtrl,
                wardCode: _wardCodeCtrl,
                provinceCode: _provinceCodeCtrl,
                locked: _taxLookup.addressLocked,
              ),
            ),
          ],
        ),
      );
    });
  }

  Widget _field(TextEditingController ctrl, String label,
      {required double width, bool locked = false}) {
    return SizedBox(
      width: width.clamp(140, double.infinity),
      child: TextField(
        controller: ctrl,
        readOnly: locked,
        decoration: taxLockedDecoration(label: label, locked: locked),
      ),
    );
  }

  Widget _summaryBox() {
    return Container(
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        children: [
          _totalRow(t('Tạm tính'), Fmt.money(widget.subtotal)),
          if (widget.productDiscount > 0)
            _totalRow(t('Khuyến mãi sản phẩm'),
                '-${Fmt.money(widget.productDiscount)}',
                accent: DanColors.doing),
          if (widget.orderDiscount > 0)
            _totalRow(widget.voucher?.name ?? t('Voucher toàn bill'),
                '-${Fmt.money(widget.orderDiscount)}',
                accent: DanColors.done),
          if (widget.customerDiscount > 0)
            _totalRow(t('Ưu đãi khách hàng'),
                '-${Fmt.money(widget.customerDiscount)}',
                accent: DanColors.done),
          SizedBox(height: 8),
          TextField(
            controller: _adjustmentCtrl,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(
              labelText: t('Điều chỉnh hóa đơn (đ)'),
              isDense: true,
            ),
            onChanged: (_) => setState(() {
              if (_lines.isEmpty) {
                _amountCtrl.text = _payable.round().toString();
              }
            }),
          ),
          if (_adjustment > 0)
            _totalRow(t('Điều chỉnh hóa đơn'), '-${Fmt.money(_adjustment)}',
                accent: DanColors.late),
          Divider(height: 18, color: DanColors.border),
          if (_vatPayable > 0)
            _totalRow(t('Trong đó VAT'), Fmt.money(_vatPayable)),
          _totalRow(t('Cần thanh toán'), Fmt.money(_payable), big: true),
        ],
      ),
    );
  }

  Widget _methodBox() {
    return Container(
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(t('Phương thức'),
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900)),
          SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final m in _methods)
                ChoiceChip(
                  avatar: Icon(_methodIcon(m.key),
                      size: 16,
                      color: _method == m.key ? Colors.white : DanColors.muted),
                  label: Text(m.label),
                  selected: _method == m.key,
                  selectedColor: DanColors.brand,
                  labelStyle: TextStyle(
                      color: _method == m.key ? Colors.white : DanColors.text,
                      fontWeight: FontWeight.w800),
                  onSelected: (_) {
                    setState(() {
                      _method = m.key;
                      _refCtrl.clear();
                      _qrData = null;
                      _qrError = null;
                      _applyDefaultRef();
                    });
                    if (_isQr) _refreshQr();
                  },
                ),
            ],
          ),
          SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _amountCtrl,
                  keyboardType: TextInputType.number,
                  decoration:
                      InputDecoration(labelText: t('Số tiền'), isDense: true),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: _refCtrl,
                  decoration: InputDecoration(
                      labelText: t('Mã tham chiếu / approval'), isDense: true),
                  onChanged: (_) => setState(() => _qrData = null),
                ),
              ),
              SizedBox(width: 8),
              FilledButton.icon(
                onPressed: () => _addLine(_pendingAmount),
                icon: Icon(Icons.add, size: 18),
                label: Text(t('Thêm dòng')),
              ),
            ],
          ),
          if (_isQr) ...[
            SizedBox(height: 10),
            _qrHelper(),
          ],
          if (_isPos) ...[
            SizedBox(height: 10),
            _posHelper(),
          ],
        ],
      ),
    );
  }

  Widget _qrHelper() {
    final data = _qrData;
    final img = retailS(data?['imageUrl']);
    final ref = retailS(data?['reference']).isEmpty
        ? _refCtrl.text.trim()
        : retailS(data?['reference']);
    return Container(
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 154,
            height: 154,
            alignment: Alignment.center,
            color: Colors.white,
            child: img.isEmpty
                ? Icon(Icons.qr_code_2, size: 64, color: DanColors.faint)
                : Image.network(img, fit: BoxFit.contain),
          ),
          SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        retailS(data?['providerLabel']).isEmpty
                            ? t('QR thanh toán')
                            : retailS(data?['providerLabel']),
                        style: TextStyle(
                            color: DanColors.brand,
                            fontWeight: FontWeight.w900),
                      ),
                    ),
                    if (_qrLoading)
                      SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2)),
                  ],
                ),
                SizedBox(height: 8),
                _miniBankRow(
                    t('Ngân hàng'),
                    retailS(data?['bankName']).isEmpty
                        ? retailS(_paymentCfg['bankName'])
                        : retailS(data?['bankName'])),
                _miniBankRow(
                    t('Số tài khoản'),
                    retailS(data?['bankAccount']).isEmpty
                        ? retailS(_paymentCfg['bankAccount'])
                        : retailS(data?['bankAccount'])),
                _miniBankRow(t('Số tiền'), Fmt.money(_pendingAmount)),
                _miniBankRow(t('Nội dung CK'), ref),
                if (_qrError != null) ...[
                  SizedBox(height: 6),
                  Text(_qrError!,
                      style: TextStyle(
                          color: DanColors.late,
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700)),
                ],
                SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: _qrLoading ? null : _refreshQr,
                      icon: Icon(Icons.refresh, size: 16),
                      label: Text(t('Tạo lại QR')),
                    ),
                    if (retailS(data?['orderCode']).isNotEmpty)
                      OutlinedButton.icon(
                        onPressed: _checkPayos,
                        icon: Icon(Icons.verified_outlined, size: 16),
                        label: Text(t('Kiểm tra payOS')),
                      ),
                    // Ca sự cố: khách quét QR CŨ (đã t("Tạo lại QR")) hoặc
                    // webhook chậm → đối soát tiền-về + PIN + lý do.
                    OutlinedButton.icon(
                      onPressed: _manualConfirmBank,
                      style: OutlinedButton.styleFrom(
                          foregroundColor: DanColors.doing,
                          side: BorderSide(color: DanColors.doing)),
                      icon: Icon(Icons.rule, size: 16),
                      label: Text(t('Khách đã chuyển? Xác nhận thủ công')),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _posHelper() {
    final terminal = retailS(_paymentCfg['posTerminalName']).isEmpty
        ? t('Máy POS')
        : retailS(_paymentCfg['posTerminalName']);
    return Container(
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Row(
        children: [
          Icon(Icons.credit_card, color: DanColors.brand),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              t('$terminal · nhập approval code nếu quẹt thủ công.'),
              style: TextStyle(fontSize: 12.5, color: DanColors.muted),
            ),
          ),
          OutlinedButton.icon(
            onPressed: _posLoading ? null : _chargePos,
            icon: _posLoading
                ? SizedBox(
                    width: 15,
                    height: 15,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(Icons.tap_and_play_outlined, size: 16),
            label: Text(t('Gọi máy POS')),
          ),
        ],
      ),
    );
  }

  Widget _paymentLines() {
    return Container(
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(t('Các dòng thanh toán'),
                    style:
                        TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900)),
              ),
              TextButton(
                onPressed: _remain <= 0 ? null : () => _addLine(_remain),
                child: Text(t('Đủ tiền')),
              ),
            ],
          ),
          if (_lines.isEmpty)
            Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Text(t('Chưa có dòng thanh toán'),
                  style: TextStyle(color: DanColors.faint)),
            )
          else
            for (var i = 0; i < _lines.length; i++) ...[
              if (i > 0) Divider(height: 10, color: DanColors.border),
              Row(
                children: [
                  Icon(_methodIcon(_lines[i].method),
                      size: 16, color: DanColors.muted),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${_methodLabel(_lines[i].method)}${_lines[i].reference.isEmpty ? '' : ' · ${_lines[i].reference}'}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 12.5, fontWeight: FontWeight.w700),
                    ),
                  ),
                  Text(Fmt.money(_lines[i].amount),
                      style: TextStyle(
                          fontWeight: FontWeight.w900, color: DanColors.brand)),
                  IconButton(
                    onPressed: () => setState(() => _lines.removeAt(i)),
                    icon: Icon(Icons.close, size: 16, color: DanColors.faint),
                  ),
                ],
              ),
            ],
          Divider(height: 18, color: DanColors.border),
          _totalRow(t('Đã nhận'), Fmt.money(_paid)),
          _totalRow(_remain > 0 ? t('Còn thiếu') : t('Tiền thối'),
              Fmt.money(_remain > 0 ? _remain : _change),
              accent: _remain > 0 ? DanColors.doing : DanColors.done),
        ],
      ),
    );
  }

  Widget _footer() {
    return Padding(
      padding: EdgeInsets.all(14),
      child: Row(
        children: [
          TextButton(
            onPressed: _paying ? null : () => Navigator.of(context).pop(),
            child: Text(t('Hủy')),
          ),
          Spacer(),
          FilledButton.icon(
            onPressed: _paying ? null : _confirm,
            style: FilledButton.styleFrom(minimumSize: Size(180, 46)),
            icon: _paying
                ? SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white))
                : Icon(Icons.payments_outlined),
            label: Text(t('Xác nhận ${Fmt.money(_payable)}')),
          ),
        ],
      ),
    );
  }

  Widget _totalRow(String label, String value,
      {bool big = false, Color? accent}) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(label,
                style: TextStyle(
                    fontSize: big ? 15 : 12.5,
                    fontWeight: big ? FontWeight.w900 : FontWeight.w700,
                    color: big ? DanColors.text : DanColors.muted)),
          ),
          Text(value,
              style: TextStyle(
                  fontSize: big ? 20 : 13,
                  fontWeight: FontWeight.w900,
                  color: big ? DanColors.brand : (accent ?? DanColors.text))),
        ],
      ),
    );
  }

  Widget _miniBankRow(String label, String value) {
    return Padding(
      padding: EdgeInsets.only(bottom: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 92,
            child: Text(label,
                style: TextStyle(fontSize: 11.5, color: DanColors.faint)),
          ),
          Expanded(
            child: Text(value.isEmpty ? '—' : value,
                textAlign: TextAlign.right,
                style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
  }

  String _methodLabel(String key) => _methods
      .firstWhere((m) => m.key == key,
          orElse: () => _PayMethod(key, key, 'other', true))
      .label;

  IconData _methodIcon(String key) {
    switch (key) {
      case 'cash':
        return Icons.payments_outlined;
      case 'internet_banking':
      case 'bank':
      case 'qrcode':
      case 'qr':
      case 'momo':
      case 'zalopay':
        return Icons.qr_code_2;
      case 'card':
      case 'visa':
      case 'pos_card':
        return Icons.credit_card;
      case 'voucher':
        return Icons.local_activity_outlined;
      default:
        return Icons.circle_outlined;
    }
  }
}

class _PayMethod {
  final String key;
  final String label;
  final String kind;
  final bool enabled;

  _PayMethod(this.key, this.label, this.kind, this.enabled);

  factory _PayMethod.fromJson(Map<String, dynamic> j) {
    final key = retailS(j['key']);
    return _PayMethod(
      key,
      retailS(j['label']).isEmpty ? key : retailS(j['label']),
      retailS(j['kind']).isEmpty ? 'other' : retailS(j['kind']),
      j.containsKey('enabled') ? retailB(j['enabled']) : true,
    );
  }
}

class _MiniPill extends StatelessWidget {
  final String label;
  final Color color;
  _MiniPill(this.label, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .14),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(label,
          style: TextStyle(
              fontSize: 10.5, color: color, fontWeight: FontWeight.w900)),
    );
  }
}
