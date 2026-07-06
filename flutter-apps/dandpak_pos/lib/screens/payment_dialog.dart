import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';

import '../providers/customer_display_controller.dart';
import '../providers/pos_provider.dart';
import '../services/card_terminal_service.dart';
import '../ui/app_theme.dart';
import '../widgets/manual_confirm_dialog.dart';

class PaymentDialog extends StatefulWidget {
  const PaymentDialog({super.key});

  @override
  State<PaymentDialog> createState() => _PaymentDialogState();
}

class _PaymentDialogState extends State<PaymentDialog> {
  String _paymentMethod = 'cash';
  double _customerPaid = 0;
  final TextEditingController _paidController = TextEditingController();
  final TextEditingController _approvalCodeController = TextEditingController();
  final _currencyFormat = NumberFormat.decimalPattern('vi-VN');

  bool _isProcessingCard = false;
  bool _submitting = false;
  String? _cardError;
  bool _forceManual = false;

  Map<String, dynamic>? _qrData;
  bool _qrLoading = false;
  String? _qrError;
  CustomerDisplayController? _display;
  String? _orderId;
  String? _billNo;
  double _subtotal = 0;
  double _discount = 0;
  double _total = 0;
  Map<String, dynamic>? _customer;

  @override
  void initState() {
    super.initState();
    final provider = context.read<PosProvider>();
    _orderId = provider.activeOrderId;
    _billNo = provider.activeBillNo;
    _subtotal = provider.cartSubtotal;
    _discount = provider.activeDiscount;
    _total = provider.cartTotal;
    _customer = provider.selectedCustomer == null
        ? null
        : Map<String, dynamic>.from(provider.selectedCustomer!);
    _customerPaid = _total;
    _paidController.text = _total.toStringAsFixed(0);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    try {
      _display ??= context.read<CustomerDisplayController>();
    } catch (_) {}
  }

  @override
  void dispose() {
    _display?.resume();
    _paidController.dispose();
    _approvalCodeController.dispose();
    super.dispose();
  }

  String _money(num value) => '${_currencyFormat.format(value)}đ';

  bool get _hasPayableBill =>
      (_orderId?.trim().isNotEmpty ?? false) && _total > 0;

  Future<void> _buildBankQr(double total) async {
    final provider = context.read<PosProvider>();
    final ref = _billNo ?? 'DANBILL${DateTime.now().millisecondsSinceEpoch}';
    setState(() {
      _qrLoading = true;
      _qrError = null;
    });
    try {
      final data = await provider.apiService.buildPaymentQr({
        'amount': total.round(),
        'reference': ref,
        'method': 'bank',
      });
      if (!mounted) return;
      setState(() {
        _qrData = data;
        _qrLoading = false;
      });
      _display?.showPayment(
        method: 'Chuyển khoản QR',
        total: total,
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

  void _quickCash(double amount) {
    setState(() {
      _customerPaid = amount;
      _paidController.text = amount.toStringAsFixed(0);
    });
  }

  Future<void> _triggerCardPayment(double total) async {
    if (_isProcessingCard || _submitting) return;
    final provider = context.read<PosProvider>();
    final ops = provider.operationsConfig;
    final cardTerminal = ops?['operations_config']?['payment']
            ?['cardTerminal'] ??
        ops?['payment']?['cardTerminal'] ??
        {};
    final mode = cardTerminal['mode'] ?? 'manual';
    final terminalName = cardTerminal['terminalName'] ?? 'VCB SmartPOS';
    final ip = cardTerminal['ip']?.toString();
    final portVal = cardTerminal['port'];
    final port =
        portVal is int ? portVal : int.tryParse(portVal?.toString() ?? '');

    if (mode == 'manual') return;

    setState(() {
      _isProcessingCard = true;
      _cardError = null;
    });

    try {
      final res = await CardTerminalService.charge(
        amount: total,
        reference: _billNo ?? 'DANBILL${DateTime.now().millisecondsSinceEpoch}',
        billNo: _billNo ?? '',
        terminalName: terminalName,
        mode: mode,
        ip: ip,
        port: port,
      );

      if (res['approved'] == true) {
        if (mounted) setState(() => _isProcessingCard = false);
        await _submitWithCardResult(res);
      } else if (mounted) {
        setState(() {
          _cardError = res['error'] ?? 'Giao dịch bị hủy hoặc thất bại.';
          _isProcessingCard = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _cardError = 'Lỗi kết nối máy POS: $e';
          _isProcessingCard = false;
        });
      }
    }
  }

  Future<void> _submitWithCardResult(Map<String, dynamic> res) async {
    if (_submitting) return;
    final provider = context.read<PosProvider>();
    final orderId = _orderId;
    final billNo = _billNo;
    final ops = provider.operationsConfig;
    final cardTerminal = ops?['operations_config']?['payment']
            ?['cardTerminal'] ??
        ops?['payment']?['cardTerminal'] ??
        {};
    final mode = cardTerminal['mode'] ?? 'manual';

    try {
      setState(() => _submitting = true);
      final cardMeta = {
        'txnId': res['txnId'] ?? '',
        'rrn': res['rrn'] ?? '',
        'approval': res['approval'] ?? '',
        'mask': res['mask'] ?? '',
        'scheme': res['scheme'] ?? '',
        'terminal': res['terminal'] ?? '',
        'mode': mode,
      };

      await provider.payOrder(
        'visa',
        _total,
        cardMeta: cardMeta,
        orderId: orderId,
        totalOverride: _total,
        discountOverride: _discount,
        customerOverride: _customer,
      );
      await _finishPaidOrder(orderId, billNo);
    } catch (e) {
      if (await _finishIfAlreadyPaid(orderId, billNo, e)) return;
      if (mounted) {
        setState(() {
          _submitting = false;
          _cardError =
              'Lỗi lưu giao dịch vào bill: ${_friendlyError(e)}. Bạn hãy nhập mã phê duyệt.';
          _forceManual = true;
        });
      }
    }
  }

  Future<void> _submit(BuildContext context) async {
    if (_submitting) return;
    final provider = context.read<PosProvider>();
    final total = _total;
    final orderId = _orderId;
    final billNo = _billNo;

    if (!_hasPayableBill) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
              'Không tìm thấy bill đang mở để thanh toán. Vui lòng chọn lại bàn.'),
          backgroundColor: DanColors.late,
        ),
      );
      return;
    }

    if (_paymentMethod == 'cash' && _customerPaid < total) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Số tiền khách đưa không đủ'),
          backgroundColor: DanColors.late,
        ),
      );
      return;
    }

    try {
      if (_paymentMethod == 'visa') {
        final ops = provider.operationsConfig;
        final cardTerminal = ops?['operations_config']?['payment']
                ?['cardTerminal'] ??
            ops?['payment']?['cardTerminal'] ??
            {};
        final configMode = cardTerminal['mode'] ?? 'manual';
        final terminalName = cardTerminal['terminalName'] ?? 'VCB SmartPOS';
        final isManual = configMode == 'manual' || _forceManual;

        if (isManual) {
          setState(() => _submitting = true);
          final approvalCode = _approvalCodeController.text.trim();
          await provider.payOrder(
            'visa',
            total,
            cardMeta: {
              'approval': approvalCode.isNotEmpty ? approvalCode : null,
              'mode': 'manual',
              'terminal': terminalName,
            },
            orderId: orderId,
            totalOverride: total,
            discountOverride: _discount,
            customerOverride: _customer,
          );
        } else {
          await _triggerCardPayment(total);
          return;
        }
      } else {
        setState(() => _submitting = true);
        await provider.payOrder(
          _paymentMethod,
          _customerPaid,
          orderId: orderId,
          totalOverride: total,
          discountOverride: _discount,
          customerOverride: _customer,
        );
      }

      await _finishPaidOrder(orderId, billNo,
          markBankPaid: _paymentMethod == 'bank');
    } catch (e) {
      if (await _finishIfAlreadyPaid(orderId, billNo, e)) return;
      if (mounted) setState(() => _submitting = false);
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_friendlyError(e)),
          backgroundColor: DanColors.late,
        ),
      );
    }
  }

  Future<void> _finishPaidOrder(String? orderId, String? billNo,
      {bool markBankPaid = false}) async {
    if (orderId == null || orderId.trim().isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text(
            'Đã ghi nhận thanh toán nhưng thiếu mã bill để gửi lệnh in. Vui lòng mở lịch sử bán hàng để in lại.'),
        backgroundColor: DanColors.late,
      ));
      Navigator.of(context).pop();
      return;
    }
    final api = context.read<PosProvider>().apiService;
    final printError = await api.forcePrintReceiptJob(
      orderId: orderId,
      billNo: billNo ?? '',
    );
    if (!mounted) return;
    if (markBankPaid) _display?.markPaid();
    if (printError != null && printError.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Đã thanh toán, nhưng chưa in được: $printError'),
        backgroundColor: DanColors.late,
      ));
    }
    Navigator.of(context).pop();
  }

  Future<bool> _finishIfAlreadyPaid(
      String? orderId, String? billNo, Object error) async {
    final id = orderId?.trim() ?? '';
    if (id.isEmpty) return false;
    final message = _friendlyError(error).toLowerCase();
    final shouldCheck = message.contains('quá thời gian chờ') ||
        message.contains('đã đóng') ||
        message.contains('đã được thanh toán') ||
        message.contains('không còn ở trạng thái mở');
    if (!shouldCheck) return false;

    final provider = context.read<PosProvider>();
    await Future.delayed(const Duration(milliseconds: 600));
    try {
      final order = await provider.apiService.getOrder(id);
      if ('${order['status']}'.toLowerCase() != 'paid') return false;
      await provider.selectTable(null);
      await provider.loadFloor();
      await provider.loadShift();
      if (!mounted) return true;
      await _finishPaidOrder(id, billNo);
      return true;
    } catch (_) {
      return false;
    }
  }

  String _friendlyError(Object error) {
    final raw = error.toString().replaceFirst('Exception: ', '').trim();
    if (error is TimeoutException || raw.contains('TimeoutException')) {
      return 'Thanh toán quá thời gian chờ. App sẽ tự kiểm tra lại bill; nếu bill chưa đóng, vui lòng thử lại.';
    }
    if (raw.contains('Future not completed')) {
      return 'Thanh toán quá thời gian chờ. App sẽ tự kiểm tra lại bill; nếu bill chưa đóng, vui lòng thử lại.';
    }
    return raw;
  }

  @override
  Widget build(BuildContext context) {
    final total = _total;
    final change = _customerPaid - total;
    final busy = _submitting || _isProcessingCard;
    final size = MediaQuery.sizeOf(context);

    return Dialog(
      backgroundColor: DanColors.surface,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: DanColors.border),
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 760, maxHeight: size.height * .9),
        child: Column(
          children: [
            _header(total, busy),
            const Divider(height: 1, color: DanColors.border),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _summaryCard(total),
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        _methodButton(
                            'cash', 'Tiền mặt', Icons.payments_outlined, total),
                        const SizedBox(width: 8),
                        _methodButton(
                            'bank', 'Chuyển khoản', Icons.qr_code_2, total),
                        const SizedBox(width: 8),
                        _methodButton(
                            'visa', 'Visa', Icons.credit_card_outlined, total),
                      ],
                    ),
                    const SizedBox(height: 14),
                    if (_paymentMethod == 'cash')
                      _cashSection(total, change)
                    else if (_paymentMethod == 'visa')
                      _cardSection(context.watch<PosProvider>(), total)
                    else
                      _bankQrView(total),
                  ],
                ),
              ),
            ),
            const Divider(height: 1, color: DanColors.border),
            _footer(total, busy),
          ],
        ),
      ),
    );
  }

  Widget _header(double total, bool busy) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 18, 12, 14),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: DanColors.brand.withValues(alpha: .12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.payments_outlined, color: DanColors.brand),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Thanh toán hóa đơn',
                    style:
                        TextStyle(fontSize: 19, fontWeight: FontWeight.w900)),
                if (_billNo != null)
                  Text('Mã hóa đơn: $_billNo',
                      style: const TextStyle(
                          fontSize: 12.5, color: DanColors.faint)),
              ],
            ),
          ),
          Text(_money(total),
              style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                  color: DanColors.brand)),
          IconButton(
            onPressed: busy ? null : () => Navigator.of(context).pop(),
            icon: const Icon(Icons.close, color: DanColors.faint),
          ),
        ],
      ),
    );
  }

  Widget _summaryCard(double total) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        children: [
          _totalRow('Tạm tính', _money(_subtotal)),
          if (_discount > 0)
            _totalRow('Khuyến mãi', '-${_money(_discount)}',
                accent: DanColors.done),
          const Divider(height: 18, color: DanColors.border),
          _totalRow('Cần thanh toán', _money(total), big: true),
        ],
      ),
    );
  }

  Widget _methodButton(
      String method, String label, IconData icon, double total) {
    final active = _paymentMethod == method;
    return Expanded(
      child: InkWell(
        onTap: () {
          setState(() {
            _paymentMethod = method;
            if (method != 'cash') {
              _customerPaid = total;
              _paidController.text = total.toStringAsFixed(0);
            }
            if (method == 'visa') {
              _forceManual = false;
              _cardError = null;
            }
          });
          if (method == 'bank') {
            _buildBankQr(total);
          } else {
            _display?.resume();
          }
        },
        borderRadius: BorderRadius.circular(DanRadius.md),
        child: Container(
          height: 74,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            color: active ? DanColors.brand : DanColors.surface,
            borderRadius: BorderRadius.circular(DanRadius.md),
            border: Border.all(
              color: active ? DanColors.brand : DanColors.border2,
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: active ? Colors.white : DanColors.muted),
              const SizedBox(height: 5),
              Text(label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w900,
                      color: active ? Colors.white : DanColors.text)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _cashSection(double total, double change) {
    return _section(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _paidController,
            keyboardType: TextInputType.number,
            autofocus: true,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
            onChanged: (val) {
              setState(() {
                _customerPaid = double.tryParse(val.replaceAll('.', '')) ?? 0.0;
              });
            },
            decoration: const InputDecoration(
              labelText: 'Khách đưa (VND)',
              suffixText: 'đ',
              isDense: true,
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _quickAmountBtn('Đủ', total),
              _quickAmountBtn('50K', 50000),
              _quickAmountBtn('100K', 100000),
              _quickAmountBtn('200K', 200000),
              _quickAmountBtn('500K', 500000),
            ],
          ),
          const Divider(height: 20, color: DanColors.border),
          _totalRow(
            'Tiền thối',
            change >= 0 ? _money(change) : 'Chưa đủ tiền',
            accent: change >= 0 ? DanColors.done : DanColors.late,
          ),
        ],
      ),
    );
  }

  Widget _cardSection(PosProvider provider, double total) {
    final ops = provider.operationsConfig;
    final cardTerminal = ops?['operations_config']?['payment']
            ?['cardTerminal'] ??
        ops?['payment']?['cardTerminal'] ??
        {};
    final configMode = cardTerminal['mode'] ?? 'manual';
    final terminalName = cardTerminal['terminalName'] ?? 'VCB SmartPOS';
    final isManual = configMode == 'manual' || _forceManual;

    return _section(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (isManual) ...[
            const Text(
              'Quẹt thẻ trên máy POS rồi nhập mã phê duyệt để đối soát.',
              style: TextStyle(fontSize: 12.5, color: DanColors.muted),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _approvalCodeController,
              decoration: const InputDecoration(
                labelText: 'Mã phê duyệt / Approval code',
                isDense: true,
              ),
            ),
            if (_forceManual) ...[
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () {
                    setState(() {
                      _forceManual = false;
                      _cardError = null;
                    });
                    _triggerCardPayment(total);
                  },
                  icon: const Icon(Icons.refresh, size: 16),
                  label: const Text('Thử lại kết nối tự động'),
                ),
              ),
            ],
          ] else if (_isProcessingCard) ...[
            const Center(child: CircularProgressIndicator()),
            const SizedBox(height: 12),
            Text(
              configMode == 'mock'
                  ? 'Đang giả lập giao dịch...'
                  : 'Đang chờ quẹt thẻ trên máy $terminalName',
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ] else if (_cardError != null) ...[
            const Icon(Icons.error_outline, color: DanColors.late, size: 42),
            const SizedBox(height: 8),
            Text(_cardError!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: DanColors.late)),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              alignment: WrapAlignment.center,
              children: [
                OutlinedButton(
                    onPressed: () => _triggerCardPayment(total),
                    child: const Text('Thử lại')),
                FilledButton(
                  onPressed: () {
                    setState(() {
                      _forceManual = true;
                      _cardError = null;
                    });
                  },
                  child: const Text('Nhập tay'),
                ),
              ],
            ),
          ] else ...[
            const Icon(Icons.contactless, color: DanColors.brand, size: 46),
            const SizedBox(height: 8),
            Text('Sẵn sàng thanh toán qua $terminalName',
                textAlign: TextAlign.center,
                style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            Center(
              child: OutlinedButton.icon(
                onPressed: () => _triggerCardPayment(total),
                icon: const Icon(Icons.tap_and_play_outlined, size: 18),
                label: const Text('Gọi máy POS'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _bankQrView(double total) {
    final img = _qrData?['imageUrl']?.toString() ?? '';
    return _section(
      child: Column(
        children: [
          if (_qrLoading)
            const Padding(
              padding: EdgeInsets.all(24),
              child: CircularProgressIndicator(),
            )
          else if (_qrError != null) ...[
            const Icon(Icons.error_outline, color: DanColors.late, size: 40),
            const SizedBox(height: 8),
            Text(_qrError!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: DanColors.late, fontSize: 12.5)),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () => _buildBankQr(total),
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Thử lại QR'),
            ),
          ] else if (img.isEmpty) ...[
            const Icon(Icons.qr_code_2, color: DanColors.brand, size: 56),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () => _buildBankQr(total),
              icon: const Icon(Icons.qr_code_2, size: 16),
              label: const Text('Tạo QR chuyển khoản'),
            ),
          ] else ...[
            Container(
              width: 236,
              height: 236,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: DanColors.border),
              ),
              child: Image.network(
                img,
                fit: BoxFit.contain,
                errorBuilder: (_, __, ___) =>
                    const Icon(Icons.qr_code_2, size: 92),
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'Màn hình phụ đang hiển thị đúng QR của hóa đơn này.',
              textAlign: TextAlign.center,
              style: TextStyle(color: DanColors.muted, fontSize: 12.5),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              alignment: WrapAlignment.center,
              children: [
                OutlinedButton.icon(
                  onPressed: () => _buildBankQr(total),
                  icon: const Icon(Icons.refresh, size: 16),
                  label: const Text('Tạo lại QR'),
                ),
                OutlinedButton.icon(
                  onPressed: () => _manualConfirmBank(total),
                  icon: const Icon(Icons.rule, size: 16),
                  label: const Text('Khách đã chuyển? Xác nhận thủ công'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _footer(double total, bool busy) {
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          TextButton(
            onPressed: busy ? null : () => Navigator.of(context).pop(),
            child: const Text('Hủy'),
          ),
          const Spacer(),
          FilledButton.icon(
            onPressed: busy || !_hasPayableBill ? null : () => _submit(context),
            style: FilledButton.styleFrom(minimumSize: const Size(190, 46)),
            icon: busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.check_circle_outline),
            label: Text(_payLabel(total),
                style: const TextStyle(fontWeight: FontWeight.w900)),
          ),
        ],
      ),
    );
  }

  Widget _section({required Widget child}) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: child,
    );
  }

  Widget _totalRow(String label, String value,
      {bool big = false, Color? accent}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(label,
                style: TextStyle(
                    fontSize: big ? 15 : 12.5,
                    fontWeight: big ? FontWeight.w900 : FontWeight.w700,
                    color: big ? DanColors.text : DanColors.muted)),
          ),
          const SizedBox(width: 12),
          Text(value,
              style: TextStyle(
                  fontSize: big ? 21 : 13,
                  fontWeight: FontWeight.w900,
                  color: big ? DanColors.brand : (accent ?? DanColors.text))),
        ],
      ),
    );
  }

  String _payLabel(double total) {
    if (_paymentMethod == 'visa' && !_forceManual) return 'Gọi máy POS';
    return 'Xác nhận ${_money(total)}';
  }

  Future<void> _manualConfirmBank(double total) async {
    if (_submitting) return;
    final provider = context.read<PosProvider>();
    final orderId = _orderId;
    final billNo = _billNo;
    final result = await showManualConfirmDialog(
      context,
      api: provider.apiService,
      amount: total.round(),
    );
    if (result == null || !mounted) return;
    try {
      setState(() => _submitting = true);
      await provider.payOrder(
        'bank',
        total,
        bankTxId: result.bankTxId,
        manualReason: result.reason,
        securityPin: result.pin,
        orderId: orderId,
        totalOverride: total,
        discountOverride: _discount,
        customerOverride: _customer,
      );
      if (!mounted) return;
      await _finishPaidOrder(orderId, billNo, markBankPaid: true);
    } catch (e) {
      if (await _finishIfAlreadyPaid(orderId, billNo, e)) return;
      if (mounted) setState(() => _submitting = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(_friendlyError(e)),
          backgroundColor: DanColors.late,
        ));
      }
    }
  }

  Widget _quickAmountBtn(String label, double amount) {
    return OutlinedButton(
      onPressed: () => _quickCash(amount),
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        minimumSize: Size.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
      child: Text(label),
    );
  }
}
