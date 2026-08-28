import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../ui/app_theme.dart';
import '../utils/translation.dart';
import 'manager_pin_dialog.dart';

/// Hộp thoại TRẢ HÀNG dùng chung (Desktop/Tablet/Phone). Chọn từng món + số lượng
/// trả (giới hạn theo SL còn lại = đã bán − đã trả), disposition nhập kho / hàng
/// hỏng, lý do, phương thức hoàn; xem trước số tiền hoàn. Gọi POST /retail/:id/return.
/// Trả về true nếu đã trả hàng thành công.
Future<bool?> showReturnDialog(
  BuildContext context, {
  required ApiService api,
  required String orderId,
  required List<Map<String, dynamic>> receiptItems,
  String? securityPin,
}) {
  return showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _ReturnDialog(
        api: api,
        orderId: orderId,
        receiptItems: receiptItems,
        securityPin: securityPin),
  );
}

String _money(num v) {
  final s = v.round().abs().toString();
  final b = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write('.');
    b.write(s[i]);
  }
  return '${v < 0 ? '-' : ''}${b}đ';
}

class _Line {
  final String orderItemId;
  final String name;
  final int sold;
  final int returned;
  final int unitPrice;
  final bool hasSku;
  int qty = 0;
  String disposition = 'restock';
  _Line(this.orderItemId, this.name, this.sold, this.returned, this.unitPrice,
      this.hasSku);
  int get remaining => sold - returned;
}

class _ReturnDialog extends StatefulWidget {
  final ApiService api;
  final String orderId;
  final List<Map<String, dynamic>> receiptItems;
  final String? securityPin;
  const _ReturnDialog(
      {required this.api,
      required this.orderId,
      required this.receiptItems,
      this.securityPin});

  @override
  State<_ReturnDialog> createState() => _ReturnDialogState();
}

class _ReturnDialogState extends State<_ReturnDialog> {
  bool _loading = true;
  bool _busy = false;
  String? _error;
  final List<_Line> _lines = [];
  final _reasonCtrl = TextEditingController(text: 'Trả hàng / hoàn hàng');
  String _refundMethod = 'original';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reasonCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      // SL đã trả theo từng dòng (từ các return trước) để tính "còn lại".
      final returns = await widget.api.retailReturns(widget.orderId);
      final returnedBy = <String, int>{};
      for (final r in returns) {
        final items = (r is Map ? r['items'] : null);
        if (items is List) {
          for (final it in items) {
            if (it is Map) {
              final id = '${it['order_item_id'] ?? ''}';
              returnedBy[id] =
                  (returnedBy[id] ?? 0) + ((it['qty'] as num?)?.toInt() ?? 0);
            }
          }
        }
      }
      final lines = <_Line>[];
      for (final raw in widget.receiptItems) {
        final id = '${raw['order_item_id'] ?? ''}';
        if (id.isEmpty) continue;
        final sold = (raw['qty'] as num?)?.toInt() ?? 0;
        final returned = returnedBy[id] ?? 0;
        if (sold - returned <= 0) continue;
        lines.add(_Line(
          id,
          '${raw['name'] ?? ''}',
          sold,
          returned,
          (raw['unit_price'] as num?)?.toInt() ?? 0,
          '${raw['sku_id'] ?? ''}'.isNotEmpty,
        ));
      }
      if (!mounted) return;
      setState(() {
        _lines
          ..clear()
          ..addAll(lines);
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

  int get _refundTotal => _lines.fold(0, (s, l) => s + l.qty * l.unitPrice);

  Future<void> _submit() async {
    final items = _lines
        .where((l) => l.qty > 0)
        .map((l) => {
              'order_item_id': l.orderItemId,
              'qty': l.qty,
              'disposition': l.disposition,
            })
        .toList();
    if (items.isEmpty) {
      appToast(context, t('Chọn ít nhất một món để trả'), isError: true);
      return;
    }
    setState(() => _busy = true);
    try {
      await _doReturn(items, null);
      if (!mounted) return;
      appToast(
          context, t('Đã trả hàng — bill gốc vẫn được giữ trong lịch sử.'));
      Navigator.of(context).pop(true);
    } catch (e) {
      final msg = e.toString();
      // Thiếu quyền 'refund' → cần Quản lý/Admin DUYỆT: xin uỷ quyền one-shot rồi
      // thử lại với approval_token (KHÔNG bao giờ tự chạy khi không có duyệt hợp lệ).
      if (msg.contains('uỷ quyền') || msg.contains('Trả hàng, ho')) {
        if (!mounted) return;
        final pin = await requestManagerPin(
            context, t('Cần Quản lý/Admin duyệt thao tác trả hàng.'));
        if (pin == null || pin.isEmpty) {
          if (mounted) setState(() => _busy = false);
          return;
        }
        try {
          final g = await widget.api.grantApproval(
              action: 'return',
              targetId: widget.orderId,
              requiredPerm: 'refund',
              pin: pin);
          await _doReturn(items, '${g['token'] ?? ''}');
          if (!mounted) return;
          appToast(context, t('Đã trả hàng (có Quản lý duyệt).'));
          Navigator.of(context).pop(true);
          return;
        } catch (e2) {
          if (mounted) {
            setState(() => _busy = false);
            appToast(context, e2.toString().replaceFirst('Exception: ', ''),
                isError: true);
          }
          return;
        }
      }
      if (mounted) {
        setState(() => _busy = false);
        appToast(context, msg.replaceFirst('Exception: ', ''), isError: true);
      }
    }
  }

  Future<void> _doReturn(
      List<Map<String, dynamic>> items, String? approvalToken) {
    return widget.api.retailReturn(widget.orderId, {
      'items': items,
      'reason': _reasonCtrl.text.trim(),
      'refund_method': _refundMethod,
      if ((widget.securityPin ?? '').isNotEmpty)
        'security_pin': widget.securityPin,
      if (approvalToken != null && approvalToken.isNotEmpty)
        'approval_token': approvalToken,
    });
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: DanColors.surface,
      title: Text(t('Trả hàng'),
          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
      content: SizedBox(
        width: dialogWidth(context, 520),
        child: _loading
            ? const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()))
            : _error != null
                ? Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Text(_error!,
                          style: const TextStyle(color: DanColors.late)),
                      const SizedBox(height: 8),
                      TextButton(
                          onPressed: () {
                            setState(() {
                              _loading = true;
                              _error = null;
                            });
                            _load();
                          },
                          child: Text(t('Thử lại'))),
                    ]))
                : _lines.isEmpty
                    ? Padding(
                        padding: const EdgeInsets.all(16),
                        child: Text(t('Bill này đã được trả hết.'),
                            style: const TextStyle(color: DanColors.muted)))
                    : Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Flexible(
                            child: SingleChildScrollView(
                              child:
                                  Column(children: _lines.map(_row).toList()),
                            ),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _reasonCtrl,
                            decoration: InputDecoration(
                                labelText: t('Lý do trả'),
                                isDense: true,
                                border: const OutlineInputBorder()),
                          ),
                          const SizedBox(height: 10),
                          Row(children: [
                            Text('${t('Hoàn qua')}: ',
                                style: const TextStyle(color: DanColors.muted)),
                            DropdownButton<String>(
                              value: _refundMethod,
                              onChanged: (v) => setState(
                                  () => _refundMethod = v ?? 'original'),
                              items: [
                                DropdownMenuItem(
                                    value: 'original',
                                    child: Text(t('Theo phương thức gốc'))),
                                DropdownMenuItem(
                                    value: 'cash', child: Text(t('Tiền mặt'))),
                                DropdownMenuItem(
                                    value: 'bank',
                                    child: Text(t('Chuyển khoản'))),
                                DropdownMenuItem(
                                    value: 'card', child: Text(t('Thẻ'))),
                              ],
                            ),
                            const Spacer(),
                            Text('${t('Hoàn')}: ${_money(_refundTotal)}',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w900,
                                    fontSize: 16,
                                    color: DanColors.late)),
                          ]),
                        ],
                      ),
      ),
      actions: [
        TextButton(
            onPressed: _busy ? null : () => Navigator.of(context).pop(false),
            child: Text(t('Hủy'))),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: DanColors.late),
          onPressed: (_busy || _loading || _lines.isEmpty) ? null : _submit,
          child: _busy
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white))
              : Text('${t('Trả hàng')} ${_money(_refundTotal)}'),
        ),
      ],
    );
  }

  Widget _row(_Line l) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l.name,
              style:
                  const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
          const SizedBox(height: 2),
          Text(
              '${t('Đã bán')} ${l.sold} · ${t('Đã trả')} ${l.returned} · ${t('Còn')} ${l.remaining} · ${_money(l.unitPrice)}',
              style: const TextStyle(fontSize: 11.5, color: DanColors.faint)),
          const SizedBox(height: 6),
          Row(children: [
            _stepBtn(Icons.remove, l.qty > 0, () => setState(() => l.qty--)),
            Container(
              width: 40,
              alignment: Alignment.center,
              child: Text('${l.qty}',
                  style: const TextStyle(
                      fontWeight: FontWeight.w900, fontSize: 15)),
            ),
            _stepBtn(
                Icons.add, l.qty < l.remaining, () => setState(() => l.qty++)),
            const Spacer(),
            if (l.hasSku)
              ToggleButtons(
                isSelected: [
                  l.disposition == 'restock',
                  l.disposition == 'damaged'
                ],
                onPressed: (i) => setState(
                    () => l.disposition = i == 0 ? 'restock' : 'damaged'),
                borderRadius: BorderRadius.circular(DanRadius.sm),
                constraints: const BoxConstraints(minHeight: 30, minWidth: 74),
                children: [Text(t('Nhập kho')), Text(t('Hàng hỏng'))],
              ),
          ]),
        ],
      ),
    );
  }

  Widget _stepBtn(IconData icon, bool enabled, VoidCallback onTap) {
    return InkWell(
      onTap: enabled ? onTap : null,
      borderRadius: BorderRadius.circular(DanRadius.sm),
      child: Container(
        width: 32,
        height: 32,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: enabled ? DanColors.surface : DanColors.surface2,
          borderRadius: BorderRadius.circular(DanRadius.sm),
          border: Border.all(color: DanColors.border),
        ),
        child: Icon(icon,
            size: 17, color: enabled ? DanColors.text : DanColors.faint),
      ),
    );
  }
}
