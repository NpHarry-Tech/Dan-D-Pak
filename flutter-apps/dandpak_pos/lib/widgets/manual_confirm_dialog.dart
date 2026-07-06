import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/api_service.dart';
import '../ui/app_theme.dart';
import '../ui/format.dart';

/// Kết quả xác nhận thủ công một khoản chuyển khoản.
/// Server yêu cầu PIN của CHÍNH người thao tác (hoặc PIN Admin) cho cả hai
/// nhánh; `bankTxId` có khi thu ngân đối chiếu được giao dịch tiền-về chưa
/// khớp (ví dụ khách quét QR CŨ sau khi app đã tạo QR mới).
class ManualConfirmResult {
  final String? bankTxId;
  final String reference;
  final String reason;
  final String pin;

  const ManualConfirmResult({
    this.bankTxId,
    this.reference = '',
    required this.reason,
    required this.pin,
  });
}

/// Dialog dùng chung cho POS FnB + Retail: xử lý ca "khách báo đã chuyển
/// nhưng hệ thống không tự khớp" — liệt kê các khoản tiền-về CHƯA KHỚP gần
/// đây để đối chiếu (số tiền trùng được đánh dấu), hoặc xác nhận tay hoàn
/// toàn khi không có webhook. Cả hai đường đều bắt PIN + lý do, server ghi
/// audit người duyệt.
Future<ManualConfirmResult?> showManualConfirmDialog(
  BuildContext context, {
  required ApiService api,
  required num amount,
}) {
  return showDialog<ManualConfirmResult>(
    context: context,
    builder: (_) => _ManualConfirmDialog(api: api, amount: amount),
  );
}

class _ManualConfirmDialog extends StatefulWidget {
  final ApiService api;
  final num amount;
  const _ManualConfirmDialog({required this.api, required this.amount});

  @override
  State<_ManualConfirmDialog> createState() => _ManualConfirmDialogState();
}

class _ManualConfirmDialogState extends State<_ManualConfirmDialog> {
  final _reason = TextEditingController();
  final _pin = TextEditingController();
  List<Map<String, dynamic>> _txns = [];
  String? _selectedTxId;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reason.dispose();
    _pin.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await widget.api.getBankTransactions();
      if (!mounted) return;
      setState(() {
        _txns = rows
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        // Ưu tiên chọn sẵn giao dịch trùng đúng số tiền cần thu.
        final match = _txns.where((t) => _num(t['amount']) == widget.amount);
        _selectedTxId =
            match.isNotEmpty ? match.first['id']?.toString() : null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  num _num(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;

  String _time(dynamic iso) {
    final d = DateTime.tryParse('${iso ?? ''}')?.toLocal();
    if (d == null) return '';
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')} ${d.day}/${d.month}';
  }

  void _submit() {
    final reason = _reason.text.trim();
    final pin = _pin.text.trim();
    if (_selectedTxId == null && reason.isEmpty) {
      _toast('Chọn giao dịch tiền-về khớp, hoặc nhập lý do xác nhận tay.');
      return;
    }
    if (pin.isEmpty) {
      _toast('Nhập mật khẩu (PIN) của bạn để chịu trách nhiệm xác nhận này.');
      return;
    }
    final tx = _txns
        .where((t) => t['id']?.toString() == _selectedTxId)
        .cast<Map<String, dynamic>?>()
        .firstOrNull;
    Navigator.of(context).pop(ManualConfirmResult(
      bankTxId: _selectedTxId,
      reference: tx == null
          ? ''
          : 'bank_tx:${tx['provider']}:${tx['id']}',
      reason: reason.isEmpty ? 'Đối chiếu giao dịch tiền-về' : reason,
      pin: pin,
    ));
  }

  void _toast(String m) {
    ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(m), backgroundColor: DanColors.late));
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    return Dialog(
      backgroundColor: DanColors.surface,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 560, maxHeight: size.height - 60),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 12, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Xác nhận thủ công',
                            style: TextStyle(
                                fontSize: 17, fontWeight: FontWeight.w900)),
                        const SizedBox(height: 2),
                        Text(
                          'Khách báo đã chuyển ${Fmt.money(widget.amount)} nhưng hệ thống chưa tự khớp (QR cũ, webhook chậm, mất mạng...).',
                          style: const TextStyle(
                              color: DanColors.muted, fontSize: 12.5),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close)),
                ],
              ),
            ),
            const Divider(height: 1, color: DanColors.border),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        const Expanded(
                          child: Text('1. Đối chiếu tiền-về chưa khớp',
                              style: TextStyle(
                                  fontSize: 13, fontWeight: FontWeight.w800)),
                        ),
                        TextButton.icon(
                          onPressed: _loading ? null : _load,
                          icon: const Icon(Icons.refresh, size: 16),
                          label: const Text('Tải lại'),
                        ),
                      ],
                    ),
                    if (_loading)
                      const Padding(
                        padding: EdgeInsets.all(18),
                        child: Center(
                            child: SizedBox(
                                width: 22,
                                height: 22,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2))),
                      )
                    else if (_error != null)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        child: Text('Không tải được: $_error',
                            style: const TextStyle(
                                color: DanColors.late, fontSize: 12)),
                      )
                    else if (_txns.isEmpty)
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: DanColors.surface2,
                          borderRadius: BorderRadius.circular(DanRadius.sm),
                        ),
                        child: const Text(
                          'Không có khoản tiền-về nào chưa khớp trong 4 giờ qua. Nếu khách đã chuyển mà webhook chưa về, dùng bước 2 bên dưới.',
                          style: TextStyle(
                              color: DanColors.muted, fontSize: 12.5),
                        ),
                      )
                    else
                      Column(
                        children: [
                          for (final t in _txns)
                            _txRow(t,
                                selected:
                                    t['id']?.toString() == _selectedTxId),
                        ],
                      ),
                    const SizedBox(height: 14),
                    const Text('2. Lý do / ghi chú đối soát',
                        style: TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 6),
                    TextField(
                      controller: _reason,
                      decoration: const InputDecoration(
                        isDense: true,
                        hintText:
                            'VD: Khách quét QR cũ, đã kiểm tra app ngân hàng thấy tiền về',
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _pin,
                      obscureText: true,
                      keyboardType: TextInputType.number,
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(8),
                      ],
                      onSubmitted: (_) => _submit(),
                      decoration: const InputDecoration(
                        isDense: true,
                        labelText: 'PIN của bạn (hoặc Admin)',
                        helperText:
                            'Bạn chịu trách nhiệm xác nhận khoản thu này — được ghi vào nhật ký.',
                        helperMaxLines: 2,
                        prefixIcon: Icon(Icons.lock_outline, size: 18),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const Divider(height: 1, color: DanColors.border),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Hủy'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      onPressed: _submit,
                      child: Text(
                          'Xác nhận đã thu ${Fmt.money(widget.amount)}'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _txRow(Map<String, dynamic> t, {required bool selected}) {
    final amount = _num(t['amount']);
    final exact = amount == widget.amount;
    final id = t['id']?.toString() ?? '';
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: InkWell(
        onTap: () =>
            setState(() => _selectedTxId = selected ? null : id),
        borderRadius: BorderRadius.circular(DanRadius.sm),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: selected ? DanColors.brandDim : DanColors.surface,
            borderRadius: BorderRadius.circular(DanRadius.sm),
            border: Border.all(
                color: selected ? DanColors.brand : DanColors.border),
          ),
          child: Row(
            children: [
              Icon(
                selected
                    ? Icons.radio_button_checked
                    : Icons.radio_button_off,
                size: 17,
                color: selected ? DanColors.brand : DanColors.faint,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(Fmt.money(amount),
                            style: TextStyle(
                                fontWeight: FontWeight.w900,
                                color: exact
                                    ? DanColors.done
                                    : DanColors.text)),
                        const SizedBox(width: 6),
                        if (exact)
                          const Text('đúng số tiền',
                              style: TextStyle(
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w800,
                                  color: DanColors.done)),
                        const Spacer(),
                        Text(
                            '${t['provider'] ?? ''} · ${_time(t['created_at'])}',
                            style: const TextStyle(
                                fontSize: 11, color: DanColors.faint)),
                      ],
                    ),
                    if ('${t['content'] ?? ''}'.trim().isNotEmpty)
                      Text('${t['content']}'.trim(),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 11, color: DanColors.muted)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
