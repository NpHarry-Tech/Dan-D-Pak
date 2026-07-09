// lib/screens/ordering_module/payment_dialog.dart
import 'package:flutter/material.dart';
import '../../services/api_service.dart';

int _intValue(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return double.tryParse(value?.toString() ?? '')?.toInt() ?? 0;
}

class PaymentDialog extends StatefulWidget {
  final Map<String, dynamic> order; // { id, bill_no, total }
  final ApiService api;
  final VoidCallback onSuccess;

  const PaymentDialog({
    super.key,
    required this.order,
    required this.api,
    required this.onSuccess,
  });

  @override
  State<PaymentDialog> createState() => _PaymentDialogState();
}

class _PaymentDialogState extends State<PaymentDialog> {
  String _paymentMethod = 'cash'; // 'cash', 'bank', 'card'
  final _amountController = TextEditingController();
  int _receivedAmount = 0;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final total = _intValue(widget.order['total']);
    _receivedAmount = total;
    _amountController.text = total.toString();
  }

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  int get _orderTotal {
    return _intValue(widget.order['total']);
  }

  int get _changeDue {
    final diff = _receivedAmount - _orderTotal;
    return diff > 0 ? diff : 0;
  }

  void _selectCashReceived(int amount) {
    setState(() {
      _receivedAmount = amount;
      _amountController.text = amount.toString();
    });
  }

  Future<void> _submitPayment() async {
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      await widget.api.checkoutOrder(
        widget.order['id'].toString(),
        _paymentMethod,
        _receivedAmount,
      );
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Thanh toán thành công!'), backgroundColor: Colors.green),
        );
        widget.onSuccess();
        Navigator.of(context).pop();
      }
    } catch (e) {
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final total = _orderTotal;
    final suggestCashList = [total, 100000, 200000, 500000].where((a) => a >= total).toSet().toList();

    return Dialog(
      backgroundColor: const Color(0xFFFFFFFF),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFFE7EAEE)),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 600, maxHeight: 600),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Thanh toán hóa đơn: ${widget.order['bill_no']}',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF1A2230)),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: Color(0xFF677084)),
                    onPressed: () => Navigator.of(context).pop(),
                  )
                ],
              ),
              const Divider(color: Color(0xFFE7EAEE)),
              const SizedBox(height: 10),
              // Payment method row
              Row(
                children: [
                  _methodButton('cash', 'Tiền mặt', Icons.payments),
                  const SizedBox(width: 10),
                  _methodButton('bank', 'Chuyển khoản', Icons.qr_code_scanner),
                  const SizedBox(width: 10),
                  _methodButton('card', 'Thẻ POS', Icons.credit_card),
                ],
              ),
              const SizedBox(height: 24),
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Tổng cần thanh toán:', style: TextStyle(color: Color(0xFF1A2230), fontSize: 16)),
                          Text(
                            'đ$total',
                            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Color(0xFF0891B2)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 20),
                      if (_paymentMethod == 'cash') ...[
                        const Text('KHÁCH ĐƯA', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF677084))),
                        const SizedBox(height: 8),
                        TextField(
                          controller: _amountController,
                          keyboardType: TextInputType.number,
                          style: const TextStyle(color: Color(0xFF1A2230), fontSize: 18, fontWeight: FontWeight.bold),
                          decoration: InputDecoration(
                            filled: true,
                            fillColor: const Color(0xFFF3F5F7),
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                          ),
                          onChanged: (val) {
                            setState(() {
                              _receivedAmount = int.tryParse(val) ?? 0;
                            });
                          },
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 10,
                          runSpacing: 10,
                          children: suggestCashList.map((cash) {
                            return InkWell(
                              onTap: () => _selectCashReceived(cash),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFFFFFFF),
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: const Color(0xFFE7EAEE)),
                                ),
                                child: Text('đ$cash', style: const TextStyle(color: Color(0xFF1A2230), fontWeight: FontWeight.bold)),
                              ),
                            );
                          }).toList(),
                        ),
                        const SizedBox(height: 24),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('TIỀN THỪA TRẢ KHÁCH:', style: TextStyle(color: Color(0xFF677084), fontSize: 15)),
                            Text(
                              'đ$_changeDue',
                              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.orangeAccent),
                            ),
                          ],
                        ),
                      ] else if (_paymentMethod == 'bank') ...[
                        Center(
                          child: Column(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(color: const Color(0xFFE7EAEE)),
                                ),
                                child: const Icon(Icons.qr_code_2, size: 200, color: Color(0xFF1A2230)),
                              ),
                              const SizedBox(height: 14),
                              const Text(
                                'Quét mã QR để chuyển khoản trực tiếp.',
                                style: TextStyle(color: Color(0xFF677084), fontSize: 13),
                              )
                            ],
                          ),
                        ),
                      ] else ...[
                        const Center(
                          child: Padding(
                            padding: EdgeInsets.symmetric(vertical: 40),
                            child: Column(
                              children: [
                                Icon(Icons.contactless, size: 72, color: Color(0xFF9AA3B2)),
                                SizedBox(height: 16),
                                Text(
                                  'Chèn hoặc quẹt thẻ trên thiết bị POS thanh toán.',
                                  style: TextStyle(color: Color(0xFF677084), fontSize: 14),
                                )
                              ],
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              if (_error != null) ...[
                Text(_error!, style: const TextStyle(color: Color(0xFFFF7A7A), fontWeight: FontWeight.bold), textAlign: TextAlign.center),
                const SizedBox(height: 10),
              ],
              const Divider(color: Color(0xFFE7EAEE)),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: Color(0xFFD3D8DF)),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Hủy', style: TextStyle(color: Color(0xFF677084))),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF0891B2),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      onPressed: _busy ? null : _submitPayment,
                      child: _busy
                          ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Text('Xác nhận thanh toán', style: TextStyle(fontWeight: FontWeight.bold)),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _methodButton(String method, String label, IconData icon) {
    final active = _paymentMethod == method;
    return Expanded(
      child: InkWell(
        onTap: () => setState(() => _paymentMethod = method),
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: active ? const Color(0xFF0891B2) : const Color(0xFFF3F5F7),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: active ? const Color(0xFF0891B2) : const Color(0xFFE7EAEE)),
          ),
          child: Column(
            children: [
              Icon(icon, color: active ? Colors.white : const Color(0xFF677084), size: 24),
              const SizedBox(height: 6),
              Text(
                label,
                style: TextStyle(
                  color: active ? Colors.white : const Color(0xFF677084),
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
