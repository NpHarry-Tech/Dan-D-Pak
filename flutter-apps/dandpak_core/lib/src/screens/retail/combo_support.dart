// Combo (Phương án B) DÙNG CHUNG cho Retail POS (tablet/desktop) và POS cầm tay
// (phone). Combo là 1 item bấm chọn: khách chọn đủ N món (vị nào cũng được), giỏ
// gom các thành phần thành 1 dòng combo. Thành phần là CartLine gắn `comboId` nên
// checkout gửi như hàng thường + `selected_combos` để server áp đúng combo.
import 'package:flutter/material.dart';

import '../../models/retail_models.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
// foldSearch/searchMatches (utils/search.dart) được re-export qua translation.dart —
// dùng CHUNG search engine của Retail, KHÔNG viết thuật toán tìm mới.
import '../../utils/translation.dart';

// SKU đủ điều kiện cho 1 combo: id nằm trong danh sách SKU HOẶC nhóm hàng khớp.
List<Sku> comboEligibleSkus(RetailVoucher v, List<Sku> skus) {
  final ids = v.comboSkus.toSet();
  final groups = v.comboGroups.toSet();
  return skus
      .where((s) =>
          ids.contains(s.id) ||
          (groups.isNotEmpty && groups.contains(s.category)))
      .toList();
}

// Gom các dòng thành phần cùng comboId (1 combo = 1 nhóm dòng trong giỏ).
Map<String, List<CartLine>> comboGroups(List<CartLine> cart) {
  final map = <String, List<CartLine>>{};
  for (final c in cart) {
    if (c.isCombo) (map[c.comboId!] ??= <CartLine>[]).add(c);
  }
  return map;
}

// Số combo trong 1 nhóm = qty / comboPer (mọi dòng cùng bội số vì +/− cộng đều).
int comboCount(List<CartLine> lines) {
  final first = lines.isEmpty ? null : lines.first;
  if (first == null || first.comboPer <= 0) return 0;
  return first.qty ~/ first.comboPer;
}

num comboGrossPerCombo(List<CartLine> lines) =>
    lines.fold<num>(0, (s, l) => s + l.sku.price * l.comboPer);

// Đơn giá 1 combo sau ưu đãi (khớp engine server: fixed/amount/pct).
num comboUnitPrice(RetailVoucher v, num gross) {
  switch (v.type) {
    case 'fixed':
      return v.value;
    case 'amount':
      return (gross - v.value).clamp(0, double.infinity);
    case 'pct':
      return (gross * (100 - v.value) / 100).round();
    default:
      return gross;
  }
}

// Tổng giảm combo (client) cho cả giỏ — dùng khi màn tự tính (phone / fallback).
num comboDiscountTotal(
    List<CartLine> cart, RetailVoucher? Function(String comboId) voucherFor) {
  num d = 0;
  for (final entry in comboGroups(cart).entries) {
    final v = voucherFor(entry.key);
    if (v == null) continue;
    final count = comboCount(entry.value);
    final gross = comboGrossPerCombo(entry.value);
    d += (gross - comboUnitPrice(v, gross)) * count;
  }
  return d;
}

// id các combo (theo voucher id, bỏ hậu tố #seq) đang có trong giỏ → gửi server.
List<String> selectedComboIds(List<CartLine> cart) => cart
    .where((c) => c.isCombo)
    .map((c) => c.comboId!.split('#').first)
    .toSet()
    .toList();

/// Dialog chọn thành phần combo: khách chọn ĐỦ N món (vị nào cũng được) + số combo.
/// Trả về `{'perCombo': Map<Sku,int>, 'count': int}` hoặc null nếu hủy.
class ComboPickerDialog extends StatefulWidget {
  final RetailVoucher voucher;
  final List<Sku> eligible;
  final Map<Sku, int>? initial;
  final int initialCount;
  const ComboPickerDialog({
    super.key,
    required this.voucher,
    required this.eligible,
    this.initial,
    this.initialCount = 1,
  });
  @override
  State<ComboPickerDialog> createState() => _ComboPickerDialogState();
}

class _ComboPickerDialogState extends State<ComboPickerDialog> {
  final Map<String, int> _per = {}; // skuId -> số món trong 1 combo
  late int _count;

  @override
  void initState() {
    super.initState();
    _count = widget.initialCount < 1 ? 1 : widget.initialCount;
    widget.initial?.forEach((s, n) {
      if (n > 0) _per[s.id] = n;
    });
  }

  int get _n => widget.voucher.comboQty;
  int get _sum => _per.values.fold(0, (a, b) => a + b);
  Sku _skuById(String id) => widget.eligible.firstWhere((s) => s.id == id);

  String _q = '';
  // DÙNG CHUNG search engine của Retail (utils/search.dart: foldSearch bỏ dấu +
  // searchMatches theo tên/SKU/barcode/nhóm) — KHÔNG viết thuật toán tìm mới.
  List<Sku> get _filtered {
    final q = foldSearch(_q);
    if (q.isEmpty) return widget.eligible;
    return widget.eligible
        .where((s) =>
            searchMatches(s.name, q) ||
            searchMatches(s.barcode, q) ||
            searchMatches(s.category, q))
        .toList();
  }

  num get _gross {
    num g = 0;
    _per.forEach((id, n) => g += _skuById(id).price * n);
    return g;
  }

  void _bump(Sku s, int d) {
    setState(() {
      final cur = _per[s.id] ?? 0;
      if (d > 0) {
        if (_sum >= _n) return; // đã đủ N món
        _per[s.id] = cur + 1;
      } else {
        if (cur <= 1) {
          _per.remove(s.id);
        } else {
          _per[s.id] = cur - 1;
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final ready = _sum == _n && _count > 0;
    final unit = comboUnitPrice(widget.voucher, _gross);
    return AlertDialog(
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.card_giftcard, color: DanColors.brand, size: 20),
            SizedBox(width: 8),
            Expanded(
                child: Text(widget.voucher.displayName,
                    style:
                        TextStyle(fontSize: 16, fontWeight: FontWeight.w900))),
          ]),
          SizedBox(height: 4),
          Text(
            '${t('Chọn đủ')} $_n ${t('món')} — ${t('đã chọn')} $_sum/$_n',
            style: TextStyle(
                fontSize: 12.5,
                color: _sum == _n ? DanColors.brand : DanColors.muted,
                fontWeight: FontWeight.w600),
          ),
        ],
      ),
      content: SizedBox(
        width: 380,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              onChanged: (v) => setState(() => _q = v),
              decoration: InputDecoration(
                isDense: true,
                hintText: t('Tìm tên / SKU / mã vạch'),
                prefixIcon: Icon(Icons.search, size: 18),
                border: OutlineInputBorder(),
              ),
            ),
            SizedBox(height: 8),
            Flexible(
              child: Builder(builder: (_) {
                final items = _filtered;
                return ListView.separated(
                  shrinkWrap: true,
                  itemCount: items.length,
                  separatorBuilder: (_, __) =>
                      Divider(height: 1, color: DanColors.border),
                  itemBuilder: (_, i) {
                    final s = items[i];
                    final n = _per[s.id] ?? 0;
                    return Padding(
                      padding: EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(6),
                            child: s.image.isNotEmpty
                                ? Image.network(s.image,
                                    width: 34,
                                    height: 34,
                                    fit: BoxFit.cover,
                                    errorBuilder: (_, __, ___) => _thumb())
                                : _thumb(),
                          ),
                          SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(s.name,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                        fontWeight: FontWeight.w600,
                                        fontSize: 13)),
                                Text(
                                    '${s.barcode.isNotEmpty ? '${s.barcode} · ' : ''}${Fmt.money(s.price)}',
                                    style: TextStyle(
                                        fontSize: 11.5,
                                        color: DanColors.muted)),
                              ],
                            ),
                          ),
                          _stepBtn(
                              Icons.remove, n > 0 ? () => _bump(s, -1) : null),
                          SizedBox(
                            width: 30,
                            child: Text('$n',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                    fontWeight: FontWeight.w800, fontSize: 15)),
                          ),
                          _stepBtn(
                              Icons.add, _sum < _n ? () => _bump(s, 1) : null),
                        ],
                      ),
                    );
                  },
                );
              }),
            ),
            Divider(height: 16, color: DanColors.border),
            Row(
              children: [
                Text(t('Số combo'),
                    style: TextStyle(fontWeight: FontWeight.w700)),
                Spacer(),
                _stepBtn(Icons.remove,
                    _count > 1 ? () => setState(() => _count--) : null),
                SizedBox(
                  width: 34,
                  child: Text('$_count',
                      textAlign: TextAlign.center,
                      style:
                          TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                ),
                _stepBtn(Icons.add, () => setState(() => _count++)),
              ],
            ),
            SizedBox(height: 10),
            Container(
              padding: EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: DanColors.brand.withValues(alpha: .07),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  Text('${Fmt.money(unit)}/${t('combo')} × $_count',
                      style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
                  Spacer(),
                  Text(Fmt.money(unit * _count),
                      style: TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 16,
                          color: DanColors.brand)),
                ],
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context), child: Text(t('Hủy'))),
        FilledButton(
          onPressed: ready
              ? () => Navigator.pop(context, {
                    'perCombo': {
                      for (final e in _per.entries) _skuById(e.key): e.value
                    },
                    'count': _count,
                  })
              : null,
          child: Text(widget.initial == null ? t('Thêm vào giỏ') : t('Lưu')),
        ),
      ],
    );
  }

  Widget _thumb() => Container(
      width: 34,
      height: 34,
      color: DanColors.surface2,
      child: Icon(Icons.image_outlined, size: 15, color: DanColors.faint));

  Widget _stepBtn(IconData icon, VoidCallback? onTap) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: onTap == null
                ? DanColors.surface
                : DanColors.brand.withValues(alpha: .10),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
                color: onTap == null
                    ? DanColors.border
                    : DanColors.brand.withValues(alpha: .35)),
          ),
          child: Icon(icon,
              size: 16,
              color: onTap == null ? DanColors.faint : DanColors.brand),
        ),
      );
}

/// Dialog GIẢM GIÁ TAY dùng chung (Retail POS + phone): giảm theo TIỀN hoặc %.
/// Trả về số tiền giảm (đã quy đổi nếu %), hoặc null nếu Hủy. Trả 0 = bỏ giảm.
class ManualDiscountDialog extends StatefulWidget {
  final num baseTotal; // tổng TRƯỚC giảm tay — dùng làm gốc tính %
  final num current;
  const ManualDiscountDialog(
      {super.key, required this.baseTotal, this.current = 0});
  @override
  State<ManualDiscountDialog> createState() => _ManualDiscountDialogState();
}

class _ManualDiscountDialogState extends State<ManualDiscountDialog> {
  bool _pct = false;
  final _ctrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    if (widget.current > 0) _ctrl.text = widget.current.round().toString();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  num get _raw =>
      num.tryParse(_ctrl.text.trim().replaceAll(RegExp(r'[.,\s]'), '')) ?? 0;

  num get _amount {
    final v = _raw;
    if (v <= 0) return 0;
    final amt = _pct ? (widget.baseTotal * v / 100).round() : v;
    return amt.clamp(0, widget.baseTotal);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(t('Giảm giá')),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SegmentedButton<bool>(
            segments: [
              ButtonSegment(value: false, label: Text(t('Số tiền'))),
              ButtonSegment(value: true, label: Text('%')),
            ],
            selected: {_pct},
            onSelectionChanged: (s) => setState(() => _pct = s.first),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _ctrl,
            keyboardType: TextInputType.number,
            autofocus: true,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              isDense: true,
              border: const OutlineInputBorder(),
              suffixText: _pct ? '%' : 'đ',
              hintText: _pct ? t('vd 10') : t('vd 50000'),
            ),
          ),
          const SizedBox(height: 10),
          Row(children: [
            Text(t('Giảm'), style: TextStyle(color: DanColors.muted)),
            const Spacer(),
            Text('-${Fmt.money(_amount)}',
                style: TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                    color: DanColors.brand)),
          ]),
        ],
      ),
      actions: [
        if (widget.current > 0)
          TextButton(
            onPressed: () => Navigator.pop(context, 0),
            child: Text(t('Bỏ giảm'), style: TextStyle(color: DanColors.late)),
          ),
        TextButton(
            onPressed: () => Navigator.pop(context), child: Text(t('Hủy'))),
        FilledButton(
          onPressed: () => Navigator.pop(context, _amount),
          child: Text(t('Áp dụng')),
        ),
      ],
    );
  }
}

/// Dialog CHỈNH GIÁ BÁN 1 dòng (cần PIN Quản lý — kiểm ở nơi gọi). Trả giá mới
/// (đồng), hoặc -1 nếu bấm "Về giá gốc", hoặc null nếu Hủy.
class LinePriceDialog extends StatefulWidget {
  final Sku sku;
  final num? current;
  const LinePriceDialog({super.key, required this.sku, this.current});
  @override
  State<LinePriceDialog> createState() => _LinePriceDialogState();
}

class _LinePriceDialogState extends State<LinePriceDialog> {
  final _ctrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    final v = widget.current ?? widget.sku.price;
    _ctrl.text = v.round().toString();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(t('Chỉnh giá bán')),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.sku.name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text('${t('Giá niêm yết')}: ${Fmt.money(widget.sku.price)}',
              style: TextStyle(fontSize: 12, color: DanColors.muted)),
          const SizedBox(height: 12),
          TextField(
            controller: _ctrl,
            keyboardType: TextInputType.number,
            autofocus: true,
            decoration: InputDecoration(
              isDense: true,
              border: const OutlineInputBorder(),
              suffixText: 'đ',
              labelText: t('Giá bán mới'),
            ),
          ),
        ],
      ),
      actions: [
        if (widget.current != null)
          TextButton(
            onPressed: () => Navigator.pop(context, -1),
            child:
                Text(t('Về giá gốc'), style: TextStyle(color: DanColors.late)),
          ),
        TextButton(
            onPressed: () => Navigator.pop(context), child: Text(t('Hủy'))),
        FilledButton(
          onPressed: () {
            final v = num.tryParse(
                    _ctrl.text.trim().replaceAll(RegExp(r'[.,\s]'), '')) ??
                -1;
            Navigator.pop(context, v < 0 ? 0 : v);
          },
          child: Text(t('Áp dụng')),
        ),
      ],
    );
  }
}
