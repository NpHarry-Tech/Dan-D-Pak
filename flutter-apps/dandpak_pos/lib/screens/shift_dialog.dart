import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../providers/pos_provider.dart';

class ShiftDialog extends StatefulWidget {
  const ShiftDialog({super.key});

  @override
  State<ShiftDialog> createState() => _ShiftDialogState();
}

class _ShiftDialogState extends State<ShiftDialog> {
  final TextEditingController _amountController = TextEditingController();
  final _currencyFormat = NumberFormat.decimalPattern('vi-VN');

  @override
  void initState() {
    super.initState();
    final shift = context.read<PosProvider>().currentShift;
    if (shift != null) {
      // Pre-fill expected balance if closing
      _amountController.text = (shift.expectedBalance ?? 0.0).toStringAsFixed(0);
    } else {
      _amountController.text = '1000000'; // Default 1,000,000đ drawer start
    }
  }

  Future<void> _submit(BuildContext context) async {
    final amount = double.tryParse(_amountController.text.trim()) ?? 0.0;
    final provider = context.read<PosProvider>();

    try {
      if (provider.currentShift == null) {
        await provider.openShift(amount);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Đã mở ca làm việc thành công')),
          );
          Navigator.of(context).pop();
        }
      } else {
        await provider.closeShift(amount);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Đã kết ca làm việc thành công')),
          );
          Navigator.of(context).pop();
        }
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
    final shift = provider.currentShift;
    final isClosing = shift != null;

    return Dialog(
      backgroundColor: const Color(0xFF1E2633),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        width: 420,
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              isClosing ? 'KẾT THÚC CA LÀM VIỆC' : 'MỞ CA LÀM VIỆC MỚI',
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: Colors.white,
                letterSpacing: 0.5,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              isClosing 
                ? 'Nhập số tiền mặt thực tế kiểm đếm được trong két để kết ca.'
                : 'Nhập số tiền mặt ban đầu để bắt đầu ca bán hàng mới.',
              style: const TextStyle(fontSize: 13, color: Color(0xFF8A99AD)),
            ),
            const SizedBox(height: 20),
            if (isClosing) ...[
              _buildInfoRow('Thu ngân:', shift.cashier),
              _buildInfoRow('Giờ mở ca:', _formatDate(shift.openedAt)),
              _buildInfoRow('Tiền ban đầu:', '${_currencyFormat.format(shift.openingBalance)}đ'),
              _buildInfoRow('Doanh thu dự kiến:', '${_currencyFormat.format(shift.expectedBalance)}đ'),
              const Divider(color: Color(0xFF2C384E), height: 24),
            ],
            TextField(
              controller: _amountController,
              keyboardType: TextInputType.number,
              style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
              decoration: InputDecoration(
                labelText: isClosing ? 'Tiền mặt thực tế trong két (VND)' : 'Tiền mặt ban đầu trong két (VND)',
                labelStyle: const TextStyle(color: Color(0xFF8A99AD), fontSize: 13),
                suffixText: 'đ',
                suffixStyle: const TextStyle(color: Colors.amber, fontSize: 18),
                enabledBorder: const UnderlineInputBorder(
                  borderSide: BorderSide(color: Color(0xFF2C384E)),
                ),
                focusedBorder: const UnderlineInputBorder(
                  borderSide: BorderSide(color: Colors.amber),
                ),
              ),
            ),
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
                  onPressed: () => _submit(context),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: isClosing ? Colors.redAccent : Colors.amber,
                    foregroundColor: const Color(0xFF141923),
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: Text(
                    isClosing ? 'KẾT CA' : 'BẮT ĐẦU CA',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Color(0xFF8A99AD), fontSize: 13)),
          Text(value, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  String _formatDate(String isoString) {
    try {
      final dt = DateTime.parse(isoString).toLocal();
      return DateFormat('dd/MM/yyyy HH:mm').format(dt);
    } catch (_) {
      return isoString;
    }
  }
}
