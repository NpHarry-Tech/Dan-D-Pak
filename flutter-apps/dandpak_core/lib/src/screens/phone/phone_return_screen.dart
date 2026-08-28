import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../../widgets/manager_pin_dialog.dart';
import '../../widgets/online_only_gate.dart';
import 'phone_kit.dart';

/// TRẢ HÀNG bản điện thoại — màn RIÊNG mobile-first (KHÔNG bê "return-as-tab"
/// của desktop xuống). Cùng domain/API trả hàng: `POST /api/retail/:id/return`
/// (services/returns.js) + duyệt Quản lý one-shot (ManagerApprovalService).
///
/// Luồng: mở bill đã thanh toán → chọn món + số lượng CÒN được trả → nhập kho /
/// hàng hỏng → phương thức hoàn → (thiếu quyền refund thì xin PIN duyệt) → xác
/// nhận. Bill gốc GIỮ NGUYÊN; server tạo giao dịch trả riêng.
num _n(dynamic v) {
  if (v is num) return v;
  return num.tryParse('${v ?? ''}'.replaceAll(',', '')) ?? 0;
}

String _s(dynamic v) => '${v ?? ''}';

/// Một dòng hàng có thể trả, dựng từ `item_snapshot` của ledgerDetail.
class _ReturnLine {
  final String orderItemId;
  final String name;
  final String code;
  final int sold;
  final int returned;
  final num unitPrice;
  int qty = 0;
  String disposition = 'restock'; // 'restock' | 'damaged'

  _ReturnLine({
    required this.orderItemId,
    required this.name,
    required this.code,
    required this.sold,
    required this.returned,
    required this.unitPrice,
  });

  int get remaining => (sold - returned).clamp(0, sold);
}

class PhoneReturnScreen extends StatefulWidget {
  final Map<String, dynamic> order;
  const PhoneReturnScreen({super.key, required this.order});

  @override
  State<PhoneReturnScreen> createState() => _PhoneReturnScreenState();
}

class _PhoneReturnScreenState extends State<PhoneReturnScreen> {
  bool _loading = true;
  String? _error;
  final List<_ReturnLine> _lines = [];

  /// 'original' = hoàn theo đúng phương thức đã thu; còn lại ép 1 phương thức.
  String _method = 'original';
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  String get _orderId => _s(widget.order['order_id'] ?? widget.order['id']);

  Future<void> _load() async {
    final id = _orderId;
    if (id.isEmpty) {
      setState(() {
        _loading = false;
        _error = t('Không xác định được hóa đơn');
      });
      return;
    }
    try {
      final d = await context.read<ApiService>().getInvoiceDetail(id);
      final items = (d['item_snapshot'] as List?) ?? const [];
      _lines.clear();
      for (final raw in items.whereType<Map>()) {
        final sold = _n(raw['qty']).toInt();
        if (sold <= 0) continue;
        _lines.add(_ReturnLine(
          orderItemId: _s(raw['order_item_id'] ?? raw['id']),
          name: _s(raw['name']),
          code: _s(raw['item_barcode']).isNotEmpty
              ? _s(raw['item_barcode'])
              : _s(raw['sku_id']),
          sold: sold,
          returned: _n(raw['returned_qty']).toInt(),
          unitPrice: _n(raw['unit_price']),
        ));
      }
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  num get _refundTotal =>
      _lines.fold<num>(0, (a, l) => a + l.qty * l.unitPrice);
  bool get _hasSelection => _lines.any((l) => l.qty > 0);

  void _setQty(_ReturnLine l, int q) {
    setState(() => l.qty = q.clamp(0, l.remaining));
  }

  Future<void> _submit() async {
    // ONLINE-ONLY: trả hàng là ghi tiền/kho — chặn khi mất kết nối máy chủ.
    if (!ensureOnlineForMutation(context, action: t('Trả hàng'))) return;
    final id = _orderId;
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
    setState(() => _submitting = true);
    final api = context.read<ApiService>();
    Future<Map<String, dynamic>> doReturn(String? token) =>
        api.retailReturn(id, {
          'items': items,
          'reason': t('Trả hàng'),
          'refund_method': _method,
          if (token != null && token.isNotEmpty) 'approval_token': token,
        });
    try {
      Map<String, dynamic> res;
      try {
        res = await doReturn(null);
      } catch (e) {
        final msg = e.toString();
        // Thiếu quyền refund → cần Quản lý/Admin duyệt (one-shot token). Cùng
        // cơ chế với desktop/tablet: KHÔNG fallback PIN legacy.
        if (msg.contains('uỷ quyền') || msg.contains('Trả hàng, ho')) {
          if (!mounted) return;
          final pin = await requestManagerPin(
              context, t('Cần Quản lý/Admin duyệt trả hàng.'));
          if (pin == null || pin.isEmpty) {
            if (mounted) setState(() => _submitting = false);
            return;
          }
          final g = await api.grantApproval(
              action: 'return', targetId: id, requiredPerm: 'refund', pin: pin);
          res = await doReturn('${g['token'] ?? ''}');
        } else {
          rethrow;
        }
      }
      // In Phiếu trả hàng — không chặn UX nếu máy in lỗi.
      final rid = '${res['return_id'] ?? ''}';
      if (rid.isNotEmpty) {
        try {
          await api.printReturnVoucher(rid);
        } catch (_) {/* máy in lỗi — return vẫn thành công */}
      }
      if (!mounted) return;
      appToast(context, t('Đã trả hàng — bill gốc vẫn được giữ.'));
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final billNo = _s(widget.order['bill_code']).isNotEmpty
        ? _s(widget.order['bill_code'])
        : (_s(widget.order['number']).isNotEmpty
            ? _s(widget.order['number'])
            : _s(widget.order['bill_no']));
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            PhoneHeader(
              title: t('Trả hàng'),
              subtitle: billNo,
              onBack: () => Navigator.of(context).maybePop(),
            ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(_error!,
                                    textAlign: TextAlign.center,
                                    style:
                                        const TextStyle(color: DanColors.late)),
                                const SizedBox(height: 12),
                                PhoneSecondaryButton(
                                    label: t('Thử lại'),
                                    icon: Icons.refresh,
                                    onPressed: _load),
                              ],
                            ),
                          ),
                        )
                      : ListView(
                          padding: const EdgeInsets.only(top: 8, bottom: 16),
                          children: [
                            for (final l in _lines) _returnRow(l),
                            const SizedBox(height: 8),
                            _methodPicker(),
                          ],
                        ),
            ),
            if (!_loading && _error == null)
              PhoneActionBar(
                child: PhoneCta(
                  label: _hasSelection
                      ? '${t('Trả hàng')} · ${phoneMoney(_refundTotal)}'
                      : t('Chọn món để trả'),
                  busy: _submitting,
                  onPressed: _hasSelection && !_submitting ? _submit : null,
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _returnRow(_ReturnLine l) {
    final disabled = l.remaining <= 0;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 6, 12, 0),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(l.name,
                        style: const TextStyle(
                            fontSize: 14, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 2),
                    Text(
                        [
                          if (l.code.isNotEmpty) l.code,
                          '${t('Đã bán')} ${l.sold}',
                          if (l.returned > 0) '${t('Đã trả')} ${l.returned}',
                          '${t('Còn')} ${l.remaining}',
                        ].join(' · '),
                        style: const TextStyle(
                            fontSize: 11.5, color: DanColors.faint)),
                  ],
                ),
              ),
              Text(phoneMoney(l.unitPrice),
                  style: const TextStyle(
                      fontSize: 12.5, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 10),
          // Stepper + thành tiền dòng này (giữ hẹp cho màn 6"); phân loại
          // nhập kho/hàng hỏng xuống dòng riêng để KHÔNG tràn khung.
          Row(
            children: [
              _stepBtn(Icons.remove,
                  enabled: !disabled && l.qty > 0,
                  onTap: () => _setQty(l, l.qty - 1)),
              SizedBox(
                width: 44,
                child: Text('${l.qty}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        fontSize: 17, fontWeight: FontWeight.w900)),
              ),
              _stepBtn(Icons.add,
                  enabled: !disabled && l.qty < l.remaining,
                  onTap: () => _setQty(l, l.qty + 1)),
              const Spacer(),
              if (l.qty > 0)
                Text(phoneMoney(l.qty * l.unitPrice),
                    style: const TextStyle(
                        fontSize: 14, fontWeight: FontWeight.w900)),
            ],
          ),
          if (l.qty > 0) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                PhoneChip(
                    label: t('Nhập kho'),
                    active: l.disposition == 'restock',
                    onTap: () => setState(() => l.disposition = 'restock')),
                PhoneChip(
                    label: t('Hàng hỏng'),
                    active: l.disposition == 'damaged',
                    onTap: () => setState(() => l.disposition = 'damaged')),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _stepBtn(IconData icon,
      {required bool enabled, required VoidCallback onTap}) {
    return Material(
      color: enabled ? DanColors.brandDim : DanColors.bg,
      borderRadius: BorderRadius.circular(9),
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(9),
        child: Container(
          width: 40,
          height: 40,
          alignment: Alignment.center,
          child: Icon(icon,
              size: 20, color: enabled ? DanColors.brand : DanColors.faint),
        ),
      ),
    );
  }

  Widget _methodPicker() {
    const methods = <(String, String)>[
      ('original', 'Theo gốc'),
      ('cash', 'Tiền mặt'),
      ('bank', 'Chuyển khoản'),
      ('card', 'Thẻ'),
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PhoneSectionTitle(t('Phương thức hoàn tiền')),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final m in methods)
                PhoneChip(
                    label: t(m.$2),
                    active: _method == m.$1,
                    onTap: () => setState(() => _method = m.$1)),
            ],
          ),
        ],
      ),
    );
  }
}
