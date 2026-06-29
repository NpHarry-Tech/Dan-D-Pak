import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../providers/pos_provider.dart';
import '../services/card_terminal_service.dart';

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
  String? _cardError;
  bool _forceManual = false;

  @override
  void initState() {
    super.initState();
    final total = context.read<PosProvider>().cartTotal;
    _customerPaid = total;
    _paidController.text = total.toStringAsFixed(0);
  }

  void _quickCash(double amount) {
    setState(() {
      _customerPaid = amount;
      _paidController.text = amount.toStringAsFixed(0);
    });
  }

  Future<void> _triggerCardPayment(double total) async {
    final provider = context.read<PosProvider>();
    final ops = provider.operationsConfig;
    final cardTerminal = ops?['operations_config']?['payment']?['cardTerminal'] ?? ops?['payment']?['cardTerminal'] ?? {};
    final mode = cardTerminal['mode'] ?? 'manual';
    final terminalName = cardTerminal['terminalName'] ?? 'VCB SmartPOS';

    if (mode == 'manual') return;

    setState(() {
      _isProcessingCard = true;
      _cardError = null;
    });

    try {
      final res = await CardTerminalService.charge(
        amount: total,
        reference: provider.activeBillNo ?? 'DANBILL${DateTime.now().millisecondsSinceEpoch}',
        billNo: provider.activeBillNo ?? '',
        terminalName: terminalName,
        mode: mode,
      );

      if (res['approved'] == true) {
        setState(() {
          _isProcessingCard = false;
        });
        _submitWithCardResult(res);
      } else {
        setState(() {
          _cardError = res['error'] ?? 'Giao dịch bị hủy hoặc thất bại.';
          _isProcessingCard = false;
        });
      }
    } catch (e) {
      setState(() {
        _cardError = 'Lỗi kết nối máy POS: $e';
        _isProcessingCard = false;
      });
    }
  }

  Future<void> _submitWithCardResult(Map<String, dynamic> res) async {
    final provider = context.read<PosProvider>();
    final ops = provider.operationsConfig;
    final cardTerminal = ops?['operations_config']?['payment']?['cardTerminal'] ?? ops?['payment']?['cardTerminal'] ?? {};
    final mode = cardTerminal['mode'] ?? 'manual';

    try {
      final cardMeta = {
        'txnId': res['txnId'] ?? '',
        'rrn': res['rrn'] ?? '',
        'approval': res['approval'] ?? '',
        'mask': res['mask'] ?? '',
        'scheme': res['scheme'] ?? '',
        'terminal': res['terminal'] ?? '',
        'mode': mode,
      };

      await provider.payOrder('card', provider.cartTotal, cardMeta: cardMeta);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Thanh toán thẻ thành công!'), backgroundColor: Colors.green),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _cardError = 'Lỗi lưu giao dịch vào bill: $e. Bạn hãy nhập tay.';
          _forceManual = true;
        });
      }
    }
  }

  Future<void> _submit(BuildContext context) async {
    final provider = context.read<PosProvider>();
    final total = provider.cartTotal;
    
    if (_paymentMethod == 'cash' && _customerPaid < total) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Số tiền khách đưa không đủ'), backgroundColor: Colors.redAccent),
      );
      return;
    }

    try {
      if (_paymentMethod == 'card') {
        final ops = provider.operationsConfig;
        final cardTerminal = ops?['operations_config']?['payment']?['cardTerminal'] ?? ops?['payment']?['cardTerminal'] ?? {};
        final configMode = cardTerminal['mode'] ?? 'manual';
        final terminalName = cardTerminal['terminalName'] ?? 'VCB SmartPOS';
        
        final isManual = configMode == 'manual' || _forceManual;
        
        if (isManual) {
          final approvalCode = _approvalCodeController.text.trim();
          final cardMeta = {
            'approval': approvalCode.isNotEmpty ? approvalCode : null,
            'mode': 'manual',
            'terminal': terminalName,
          };
          await provider.payOrder('card', total, cardMeta: cardMeta);
        } else {
          _triggerCardPayment(total);
          return;
        }
      } else {
        await provider.payOrder(_paymentMethod, _customerPaid);
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Thanh toán thành công!'), backgroundColor: Colors.green),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<PosProvider>();
    final total = provider.cartTotal;
    final change = _customerPaid - total;

    return Dialog(
      backgroundColor: const Color(0xFF1E2633),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        width: 500,
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'THANH TOÁN HÓA ĐƠN',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: Colors.white,
                letterSpacing: 0.5,
              ),
            ),
            const SizedBox(height: 4),
            if (provider.activeBillNo != null)
              Text(
                'Mã hóa đơn: ${provider.activeBillNo}',
                style: const TextStyle(fontSize: 12, color: Color(0xFF8A99AD)),
              ),
            const SizedBox(height: 24),
            // Amount Summary Card
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF141923),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFF2C384E)),
              ),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Tạm tính:', style: TextStyle(color: Color(0xFF8A99AD))),
                      Text('${_currencyFormat.format(provider.cartSubtotal)}đ', style: const TextStyle(color: Colors.white)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Giảm giá:', style: TextStyle(color: Color(0xFF8A99AD))),
                      Text('-${_currencyFormat.format(provider.activeDiscount)}đ', style: const TextStyle(color: Colors.redAccent)),
                    ],
                  ),
                  const Divider(color: Color(0xFF2C384E), height: 24),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'CẦN THANH TOÁN:',
                        style: TextStyle(fontWeight: FontWeight.bold, color: Colors.white),
                      ),
                      Text(
                        '${_currencyFormat.format(total)}đ',
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.black,
                          color: Colors.amber,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            // Payment Method Tabs
            Row(
              children: [
                _buildMethodTab('cash', 'Tiền mặt', Icons.payments_outlined),
                const SizedBox(width: 12),
                _buildMethodTab('bank', 'Chuyển khoản', Icons.qr_code_scanner),
                const SizedBox(width: 12),
                _buildMethodTab('card', 'Thẻ POS', Icons.credit_card_outlined),
              ],
            ),
            const SizedBox(height: 24),
            // Cash Calculator Inputs
            if (_paymentMethod == 'cash') ...[
              TextField(
                controller: _paidController,
                keyboardType: TextInputType.number,
                style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                onChanged: (val) {
                  setState(() {
                    _customerPaid = double.tryParse(val) ?? 0.0;
                  });
                },
                decoration: const InputDecoration(
                  labelText: 'Khách đưa (VND)',
                  labelStyle: TextStyle(color: Color(0xFF8A99AD)),
                  suffixText: 'đ',
                  suffixStyle: TextStyle(color: Colors.amber, fontSize: 18),
                  enabledBorder: UnderlineInputBorder(
                    borderSide: BorderSide(color: Color(0xFF2C384E)),
                  ),
                  focusedBorder: UnderlineInputBorder(
                    borderSide: BorderSide(color: Colors.amber),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              // Quick amount suggestions
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
              const SizedBox(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Tiền thừa:', style: TextStyle(color: Color(0xFF8A99AD), fontSize: 14)),
                  Text(
                    change >= 0 ? '${_currencyFormat.format(change)}đ' : 'Chưa đủ tiền',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: change >= 0 ? Colors.greenAccent : Colors.redAccent,
                    ),
                  ),
                ],
              ),
            ] else if (_paymentMethod == 'card') ...[
              Builder(
                builder: (context) {
                  final ops = provider.operationsConfig;
                  final cardTerminal = ops?['operations_config']?['payment']?['cardTerminal'] ?? ops?['payment']?['cardTerminal'] ?? {};
                  final configMode = cardTerminal['mode'] ?? 'manual';
                  final terminalName = cardTerminal['terminalName'] ?? 'VCB SmartPOS';
                  
                  final isManual = configMode == 'manual' || _forceManual;
                  
                  if (isManual) {
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Nhập mã phê duyệt (Approval Code) từ máy POS để đối soát:',
                          style: TextStyle(color: Color(0xFF8A99AD), fontSize: 13),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _approvalCodeController,
                          style: const TextStyle(color: Colors.white),
                          decoration: const InputDecoration(
                            labelText: 'Mã phê duyệt / Approval Code',
                            labelStyle: TextStyle(color: Color(0xFF8A99AD)),
                            enabledBorder: OutlineInputBorder(
                              borderSide: BorderSide(color: Color(0xFF2C384E)),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderSide: BorderSide(color: Colors.amber),
                            ),
                          ),
                        ),
                        if (_forceManual) ...[
                          const SizedBox(height: 12),
                          TextButton.icon(
                            onPressed: () {
                              setState(() {
                                _forceManual = false;
                                _cardError = null;
                              });
                              _triggerCardPayment(total);
                            },
                            icon: const Icon(Icons.refresh, size: 16, color: Colors.amber),
                            label: const Text('Thử lại kết nối Tự động', style: TextStyle(color: Colors.amber, fontSize: 12)),
                          )
                        ]
                      ],
                    );
                  }
                  
                  // Auto or Mock
                  return Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        if (_isProcessingCard) ...[
                          const SizedBox(
                            width: 32,
                            height: 32,
                            child: CircularProgressIndicator(color: Colors.amber, strokeWidth: 3),
                          ),
                          const SizedBox(height: 16),
                          Text(
                            configMode == 'mock'
                                ? 'Đang giả lập giao dịch...'
                                : 'ĐANG CHỜ QUẸT THẺ TRÊN MÁY $terminalName...',
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                            textAlign: TextAlign.center,
                          ),
                        ] else if (_cardError != null) ...[
                          const Icon(Icons.error_outline, color: Colors.redAccent, size: 48),
                          const SizedBox(height: 8),
                          Text(
                            _cardError!,
                            style: const TextStyle(color: Colors.redAccent, fontSize: 13),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 16),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              ElevatedButton(
                                onPressed: () => _triggerCardPayment(total),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFF252F42),
                                  foregroundColor: Colors.white,
                                ),
                                child: const Text('Thử lại'),
                              ),
                              const SizedBox(width: 12),
                              ElevatedButton(
                                onPressed: () {
                                  setState(() {
                                    _forceManual = true;
                                    _cardError = null;
                                  });
                                },
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: Colors.amber,
                                  foregroundColor: const Color(0xFF141923),
                                ),
                                child: const Text('Nhập tay'),
                              ),
                            ],
                          )
                        ] else ...[
                          const Icon(Icons.contactless, color: Colors.amber, size: 48),
                          const SizedBox(height: 8),
                          Text(
                            'Sẵn sàng thanh toán tự động qua $terminalName',
                            style: const TextStyle(color: Colors.white, fontSize: 13),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 16),
                          ElevatedButton.icon(
                            onPressed: () => _triggerCardPayment(total),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.amber,
                              foregroundColor: const Color(0xFF141923),
                            ),
                            icon: const Icon(Icons.flash_on, size: 16),
                            label: const Text('KÍCH HOẠT QUẸT THẺ'),
                          )
                        ]
                      ],
                    ),
                  );
                },
              )
            ] else ...[
              Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 24.0),
                  child: Column(
                    children: [
                      const Icon(
                        Icons.qr_code_2,
                        size: 64,
                        color: Colors.amber,
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Mở mã QR động trên thiết bị hoặc in phiếu thanh toán QR.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Color(0xFF8A99AD), fontSize: 12),
                      ),
                    ],
                  ),
                ),
              )
            ],
            const SizedBox(height: 28),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('HỦY', style: TextStyle(color: Color(0xFF8A99AD))),
                ),
                const SizedBox(width: 16),
                ElevatedButton(
                  onPressed: provider.isSavingOrder ? null : () => _submit(context),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.amber,
                    foregroundColor: const Color(0xFF141923),
                    padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: provider.isSavingOrder
                      ? const CircularProgressIndicator(color: Color(0xFF141923))
                      : const Text(
                          'HOÀN TẤT',
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMethodTab(String method, String label, IconData icon) {
    final active = _paymentMethod == method;
    return Expanded(
      child: InkWell(
        onTap: () {
          setState(() {
            _paymentMethod = method;
            if (method != 'cash') {
              _customerPaid = context.read<PosProvider>().cartTotal;
            }
            if (method == 'card') {
              _forceManual = false;
              _cardError = null;
            }
          });
          if (method == 'card') {
            _triggerCardPayment(context.read<PosProvider>().cartTotal);
          }
        },
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: active ? Colors.amber : const Color(0xFF252F42),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: active ? Colors.amber : const Color(0xFF2C384E),
            ),
          ),
          child: Column(
            children: [
              Icon(icon, color: active ? const Color(0xFF141923) : Colors.white),
              const SizedBox(height: 4),
              Text(
                label,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: active ? const Color(0xFF141923) : Colors.white,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _quickAmountBtn(String label, double amount) {
    return ElevatedButton(
      onPressed: () => _quickCash(amount),
      style: ElevatedButton.styleFrom(
        backgroundColor: const Color(0xFF252F42),
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        minimumSize: Size.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
      child: Text(label),
    );
  }
}
