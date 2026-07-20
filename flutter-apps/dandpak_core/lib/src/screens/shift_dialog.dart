import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../providers/pos_provider.dart';
import '../ui/app_theme.dart';
import '../ui/file_pick.dart';
import '../utils/translation.dart';

part 'shift_cash_dialogs.dart';

final _money = NumberFormat.decimalPattern('vi-VN');
String fmtMoney(num v) => t('${_money.format(v.round())}đ');

num _num(dynamic v) => v is num ? v : num.tryParse('$v') ?? 0;
String _s(dynamic v) => v?.toString() ?? '';

Map<String, String> get _methodLabels => {
      'cash': t('Tiền mặt'),
      'card': t('Máy POS'),
      'pos_card': t('Máy POS'),
      'visa': 'Visa',
      'qr': 'QR',
      'qrcode': 'QR Code',
      'voucher': 'Voucher',
      'bank_transfer': t('Chuyển khoản'),
      'internet_banking': 'Internet Banking',
      'momo': 'MoMo',
      'zalopay': 'ZaloPay',
    };
String _methodLabel(String m) => _methodLabels[m] ?? m;

String _fmtDateTime(dynamic iso) {
  try {
    return DateFormat('dd/MM/yyyy HH:mm')
        .format(DateTime.parse(_s(iso)).toLocal());
  } catch (_) {
    return _s(iso);
  }
}

String _fmtTime(dynamic iso) {
  try {
    return DateFormat('HH:mm:ss').format(DateTime.parse(_s(iso)).toLocal());
  } catch (_) {
    return _s(iso);
  }
}

// ── Shared shift + cash-drawer panel (used by both F&B POS and Retail POS) ──
// The backend is branch-scoped, so both surfaces read/write one shift and one
// cash drawer per branch — they stay in sync automatically.
class ShiftDialog extends StatefulWidget {
  ShiftDialog({super.key});

  @override
  State<ShiftDialog> createState() => _ShiftDialogState();
}

class _ShiftDialogState extends State<ShiftDialog> {
  final Map<int, TextEditingController> _ctrls = {};
  final Set<int> _touched = {};
  String _shiftKey = '';
  List<Map<String, dynamic>> _drawerEntries = [];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _init());
  }

  Future<void> _init() async {
    final pos = context.read<PosProvider>();
    if (pos.shiftState == null) await pos.loadShift();
    if (!mounted) return;
    _syncShiftKey();
    await _reloadDrawer();
    if (mounted) setState(() {});
  }

  void _syncShiftKey() {
    final pos = context.read<PosProvider>();
    final labels = pos.shiftLabels;
    final current = pos.rawShift?['shift_key'];
    if (current is String && labels.any((l) => l['key'] == current)) {
      _shiftKey = current;
    } else if (labels.isNotEmpty) {
      _shiftKey = _s(labels.first['key']);
    }
  }

  Future<void> _reloadDrawer() async {
    final pos = context.read<PosProvider>();
    if (pos.currentShift == null) {
      if (mounted) setState(() => _drawerEntries = []);
      return;
    }
    try {
      final data = await pos.getCashDrawer();
      final entries = data['entries'];
      if (mounted) {
        setState(() {
          _drawerEntries = entries is List
              ? entries
                  .whereType<Map>()
                  .map((e) => Map<String, dynamic>.from(e))
                  .toList()
              : [];
        });
      }
    } catch (_) {}
  }

  void _ensureCtrls(List<int> denoms) {
    for (final d in denoms) {
      _ctrls.putIfAbsent(d, () => TextEditingController(text: '0'));
    }
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  int _countCash(List<int> denoms) {
    var total = 0;
    for (final d in denoms) {
      total += d * (int.tryParse(_ctrls[d]?.text.trim() ?? '') ?? 0);
    }
    return total;
  }

  Map<String, int> _countsMap(List<int> denoms) {
    final m = <String, int>{};
    for (final d in denoms) {
      m['$d'] = int.tryParse(_ctrls[d]?.text.trim() ?? '') ?? 0;
    }
    return m;
  }

  void _toast(String msg, {bool error = false}) =>
      appToast(context, msg, isError: error);

  String _err(Object e) => e.toString().replaceFirst('Exception: ', '');

  Future<bool> _confirm(String msg) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        content: Text(msg),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(t('Hủy'))),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(t('Đồng ý'))),
        ],
      ),
    );
    return ok ?? false;
  }

  Future<void> _openShift(PosProvider pos, List<int> denoms) async {
    setState(() => _busy = true);
    try {
      await pos.openShiftCounts(
        shiftKey: _shiftKey,
        counts: _countsMap(denoms),
        openingCash: _countCash(denoms),
        cashManual: _touched.isNotEmpty,
      );
      if (mounted) {
        Navigator.of(context).pop();
        _toast(t('Đã mở ca'));
      }
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        _toast(_err(e), error: true);
      }
    }
  }

  Future<String?> _promptManagerPin(String warningMessage) async {
    final ctrl = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: Colors.orange),
            SizedBox(width: 8),
            Text(t('Cảnh báo Compliance')),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(warningMessage, style: TextStyle(fontSize: 14)),
            SizedBox(height: 16),
            Text(
              t('Nhập PIN Quản lý để xác nhận đưa các hóa đơn lỗi vào hàng đợi gửi lại sau và kết ca:'),
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
            ),
            SizedBox(height: 8),
            TextField(
              controller: ctrl,
              obscureText: true,
              keyboardType: TextInputType.number,
              autofocus: true,
              decoration: InputDecoration(
                labelText: t('Mã PIN Quản lý'),
                isDense: true,
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text(t('Hủy bỏ')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()),
            child: Text(t('Bỏ qua & Kết ca')),
          ),
        ],
      ),
    );
  }

  Future<void> _closeShift(PosProvider pos, List<int> denoms) async {
    final confirmed =
        await _confirm(t('Kết ca hiện tại? Hệ thống sẽ chốt báo cáo ca.'));
    if (!confirmed || !mounted) {
      return;
    }
    setState(() => _busy = true);
    final auth = context.read<AuthProvider>();
    try {
      await pos.closeShiftCounts(
        shiftKey: _shiftKey,
        counts: _countsMap(denoms),
        closingCash: _countCash(denoms),
      );
      if (mounted) {
        Navigator.of(context).pop();
        _toast(t('Đã kết ca'));
        await auth.logout(keepBranch: true);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        final msg = _err(e);
        if (msg.contains(t('hóa đơn chưa')) || msg.contains('MISA')) {
          final pin = await _promptManagerPin(msg);
          if (pin != null && pin.isNotEmpty) {
            setState(() => _busy = true);
            try {
              await pos.closeShiftCounts(
                shiftKey: _shiftKey,
                counts: _countsMap(denoms),
                closingCash: _countCash(denoms),
                managerOverridePin: pin,
              );
              if (mounted) {
                Navigator.of(context).pop();
                _toast(t('Đã kết ca (ghi nhận quản lý bỏ qua)'));
                await auth.logout(keepBranch: true);
              }
            } catch (retryErr) {
              if (mounted) {
                setState(() => _busy = false);
                _toast(_err(retryErr), error: true);
              }
            }
          }
        } else {
          _toast(msg, error: true);
        }
      }
    }
  }

  Future<void> _openExpense() async {
    final done = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => CashExpenseDialog(),
    );
    if (done == true) await _reloadDrawer();
  }

  Future<void> _openReimbursement() async {
    final done = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => CashReimbursementDialog(),
    );
    if (done == true) await _reloadDrawer();
  }

  @override
  Widget build(BuildContext context) {
    final pos = context.watch<PosProvider>();
    final denoms = pos.shiftDenominations;
    _ensureCtrls(denoms);
    final isOpen = pos.currentShift != null;
    final raw = pos.rawShift;
    final size = MediaQuery.of(context).size;

    if (_shiftKey.isEmpty) _syncShiftKey();

    return Dialog(
      backgroundColor: DanColors.surface,
      insetPadding: EdgeInsets.all(18),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: 1040,
          maxHeight: size.height - 36,
        ),
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                isOpen ? t('Ca đang mở') : t('Mở ca làm việc'),
                style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
              ),
              SizedBox(height: 4),
              Text(
                isOpen
                    ? 'Nhân viên ${_s(raw?['user_name'])} mở ${_s(raw?['shift_label'])} lúc ${_fmtDateTime(raw?['opened_at'])}'
                    : t('Không nhập kiểm đếm thì hệ thống dùng ${fmtMoney(pos.openingSuggestion)} từ ca trước / tiền két gốc.'),
                style: TextStyle(
                    fontSize: 12.5, color: DanColors.muted, height: 1.4),
              ),
              SizedBox(height: 12),
              Flexible(
                child: LayoutBuilder(
                  builder: (context, c) {
                    final narrow = c.maxWidth < 760;
                    final left = _countPanel(pos, denoms, isOpen);
                    final right = _reportPanel(pos, isOpen);
                    if (narrow) {
                      return SingleChildScrollView(
                        child: Column(children: [
                          left,
                          SizedBox(height: 12),
                          SizedBox(height: 320, child: right),
                        ]),
                      );
                    }
                    return SizedBox(
                      height: c.maxHeight.isFinite ? c.maxHeight : 480,
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          SizedBox(
                            width: 384,
                            child: SingleChildScrollView(child: left),
                          ),
                          SizedBox(width: 14),
                          Expanded(child: right),
                        ],
                      ),
                    );
                  },
                ),
              ),
              SizedBox(height: 12),
              Row(
                children: [
                  OutlinedButton(
                    onPressed: _busy ? null : () => Navigator.of(context).pop(),
                    child: Text(t('Đóng')),
                  ),
                  Spacer(),
                  if (isOpen)
                    FilledButton(
                      onPressed: _busy ? null : () => _closeShift(pos, denoms),
                      style: FilledButton.styleFrom(
                          backgroundColor: DanColors.late,
                          minimumSize: Size(120, 44)),
                      child: _busy ? _Spinner() : Text(t('Kết ca')),
                    )
                  else
                    FilledButton(
                      onPressed: _busy ? null : () => _openShift(pos, denoms),
                      style: FilledButton.styleFrom(minimumSize: Size(120, 44)),
                      child: _busy ? _Spinner() : Text(t('Mở ca')),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _countPanel(PosProvider pos, List<int> denoms, bool isOpen) {
    final total = _countCash(denoms);
    final showSuggestion = !isOpen && _touched.isEmpty;
    final labels = pos.shiftLabels;
    final selectedKey = labels.any((l) => _s(l['key']) == _shiftKey)
        ? _shiftKey
        : (labels.isNotEmpty ? _s(labels.first['key']) : null);
    return Container(
      padding: EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.lg),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            isOpen ? t('Kiểm đếm khi kết ca') : t('Kiểm đếm đầu ca'),
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900),
          ),
          SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              SizedBox(
                width: 150,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(t('Ca làm việc'),
                        style: TextStyle(
                            fontSize: 12,
                            color: DanColors.muted,
                            fontWeight: FontWeight.w700)),
                    SizedBox(height: 5),
                    DropdownButtonFormField<String>(
                      initialValue: selectedKey,
                      isExpanded: true,
                      decoration: InputDecoration(isDense: true),
                      items: [
                        for (final l in labels)
                          DropdownMenuItem(
                            value: _s(l['key']),
                            child: Text(_s(l['label']),
                                overflow: TextOverflow.ellipsis),
                          ),
                      ],
                      onChanged: (v) =>
                          setState(() => _shiftKey = v ?? _shiftKey),
                    ),
                  ],
                ),
              ),
              SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(t('Tổng kiểm đếm'),
                        style: TextStyle(
                            fontSize: 11,
                            color: DanColors.muted,
                            fontWeight: FontWeight.w800)),
                    SizedBox(height: 4),
                    Text(
                      showSuggestion
                          ? t('Tự dùng ${fmtMoney(pos.openingSuggestion)}')
                          : fmtMoney(total),
                      style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w900,
                          fontFamily: 'JetBrains Mono'),
                    ),
                  ],
                ),
              ),
            ],
          ),
          SizedBox(height: 14),
          Text(t('Mệnh giá tiền mặt'),
              style: TextStyle(
                  fontSize: 12,
                  color: DanColors.muted,
                  fontWeight: FontWeight.w700)),
          SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final d in denoms)
                _DenomField(
                  denom: d,
                  controller: _ctrls[d]!,
                  onChanged: () {
                    _touched.add(d);
                    setState(() {});
                  },
                ),
            ],
          ),
          if (isOpen) ...[
            SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _openExpense,
                    icon: Icon(Icons.north_east, size: 15),
                    label: Text(t('Chi từ két')),
                    style: OutlinedButton.styleFrom(
                        foregroundColor: DanColors.late,
                        side: BorderSide(
                            color: DanColors.late.withValues(alpha: .45))),
                  ),
                ),
                SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _openReimbursement,
                    icon: Icon(Icons.south_west, size: 15),
                    label: Text(t('Hoàn chi')),
                    style: OutlinedButton.styleFrom(
                        foregroundColor: Color(0xFF047857),
                        side: BorderSide(
                            color: DanColors.done.withValues(alpha: .55))),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _reportPanel(PosProvider pos, bool isOpen) {
    return Container(
      padding: EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.lg),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(t('Báo cáo ca'),
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
          SizedBox(height: 10),
          Expanded(
            child: isOpen
                ? _reportBody(pos)
                : Center(
                    child: Padding(
                      padding: EdgeInsets.all(20),
                      child: Text(
                        t('Chưa có ca đang mở. Sau khi mở ca, doanh thu thanh toán sẽ được gom vào báo cáo tại đây.'),
                        textAlign: TextAlign.center,
                        style: TextStyle(color: DanColors.muted, height: 1.5),
                      ),
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _reportBody(PosProvider pos) {
    final r = pos.shiftReport;
    final day = pos.dayReport;
    final methodTotals = r['method_totals'];
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _Brow(label: t('Số bill'), value: '${_num(r['bill_count']).round()}'),
          _Brow(
              label: t('Tiền mặt bán hàng'),
              value: fmtMoney(_num(r['cash_sales']))),
          _Brow(
              label: t('Chi từ két'),
              value: fmtMoney(_num(r['drawer_expenses'])),
              valueColor: DanColors.late),
          _Brow(
              label: t('Hoàn chi'),
              value: fmtMoney(_num(r['drawer_reimbursements'])),
              valueColor: Color(0xFF047857)),
          _Brow(
              label: t('Chuyển khoản / ví'),
              value: fmtMoney(_num(r['transfer_sales']))),
          _Brow(
              label: t('Máy POS / thẻ'), value: fmtMoney(_num(r['pos_sales']))),
          _Brow(
              label: t('Tiền mặt dự kiến'),
              value: fmtMoney(_num(r['expected_cash'])),
              bold: true),
          if (methodTotals is Map && methodTotals.isNotEmpty) ...[
            _DashDivider(),
            for (final e in methodTotals.entries)
              _Brow(
                  label: _methodLabel(_s(e.key)),
                  value: fmtMoney(_num(e.value)),
                  muted: true),
          ],
          SizedBox(height: 12),
          Container(
            padding: EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: DanColors.surface,
              borderRadius: BorderRadius.circular(DanRadius.md),
              border: Border.all(color: DanColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _Brow(
                    label: t('Tổng ngày vận hành'),
                    value: fmtMoney(_num(day['total_revenue'])),
                    bold: true),
                _Brow(
                    label: t('Số bill trong ngày'),
                    value: '${_num(day['bill_count']).round()}'),
                _Brow(
                    label: t('Tiền mặt trong ngày'),
                    value: fmtMoney(_num(day['cash_sales']))),
                _Brow(
                    label: t('Chuyển khoản / ví trong ngày'),
                    value: fmtMoney(_num(day['transfer_sales']))),
                _Brow(
                    label: t('Máy POS / thẻ trong ngày'),
                    value: fmtMoney(_num(day['pos_sales']))),
              ],
            ),
          ),
          SizedBox(height: 12),
          Text(t('GIAO DỊCH KÉT CA NÀY'),
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .5,
                  color: DanColors.faint)),
          SizedBox(height: 6),
          if (_drawerEntries.isEmpty)
            Padding(
              padding: EdgeInsets.symmetric(vertical: 6),
              child: Text(t('Chưa có giao dịch két trong ca này'),
                  style: TextStyle(fontSize: 12, color: DanColors.muted)),
            )
          else
            for (final e in _drawerEntries) _DrawerEntryTile(entry: e),
        ],
      ),
    );
  }
}

class _DenomField extends StatelessWidget {
  final int denom;
  final TextEditingController controller;
  final VoidCallback onChanged;

  _DenomField({
    required this.denom,
    required this.controller,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 108,
      padding: EdgeInsets.fromLTRB(10, 8, 10, 8),
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(fmtMoney(denom),
              style: TextStyle(
                  fontSize: 12,
                  color: DanColors.muted,
                  fontFamily: 'JetBrains Mono',
                  fontWeight: FontWeight.w700)),
          SizedBox(height: 6),
          SizedBox(
            height: 36,
            child: TextField(
              controller: controller,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              textAlign: TextAlign.right,
              onChanged: (_) => onChanged(),
              onTap: () {
                if (controller.text == '0') controller.clear();
              },
              style: TextStyle(
                  fontFamily: 'JetBrains Mono',
                  fontWeight: FontWeight.w800,
                  fontSize: 15),
              decoration: InputDecoration(
                isDense: true,
                contentPadding:
                    EdgeInsets.symmetric(horizontal: 8, vertical: 8),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Brow extends StatelessWidget {
  final String label;
  final String value;
  final bool bold;
  final bool muted;
  final Color? valueColor;

  _Brow({
    required this.label,
    required this.value,
    this.bold = false,
    this.muted = false,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 4.5),
      child: Row(
        children: [
          Expanded(
            child: Text(label,
                style: TextStyle(
                  fontSize: muted ? 12 : 13,
                  color: muted ? DanColors.muted : DanColors.text,
                  fontWeight: bold ? FontWeight.w900 : FontWeight.w600,
                )),
          ),
          Text(value,
              style: TextStyle(
                fontSize: bold ? 14 : 13,
                fontFamily: 'JetBrains Mono',
                fontWeight: bold ? FontWeight.w900 : FontWeight.w700,
                color: valueColor ?? (bold ? DanColors.text : DanColors.text),
              )),
        ],
      ),
    );
  }
}

class _DashDivider extends StatelessWidget {
  _DashDivider();
  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.symmetric(vertical: 6),
        child: Divider(height: 1, color: DanColors.border),
      );
}

class _DrawerEntryTile extends StatelessWidget {
  final Map<String, dynamic> entry;
  _DrawerEntryTile({required this.entry});

  @override
  Widget build(BuildContext context) {
    final isExpense = _s(entry['kind']) == 'expense';
    final parts = <String>[
      if (_s(entry['counterparty']).isNotEmpty) _s(entry['counterparty']),
      if (_s(entry['reason']).isNotEmpty) _s(entry['reason']),
      if (_s(entry['linked_expense_title']).isNotEmpty)
        'Hoàn cho: ${_s(entry['linked_expense_title'])}',
      if (_s(entry['note']).isNotEmpty) _s(entry['note']),
    ];
    return Container(
      margin: EdgeInsets.only(bottom: 5),
      padding: EdgeInsets.symmetric(horizontal: 9, vertical: 7),
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(9),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${isExpense ? t('Chi') : t('Hoàn chi')} ${fmtMoney(_num(entry['amount']))}',
            style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
                color: isExpense ? DanColors.late : Color(0xFF047857)),
          ),
          if (parts.isNotEmpty)
            Padding(
              padding: EdgeInsets.only(top: 2),
              child: Text(parts.join(' · '),
                  style: TextStyle(
                      fontSize: 11.5, color: DanColors.muted, height: 1.3)),
            ),
          Padding(
            padding: EdgeInsets.only(top: 2),
            child: Text(
              '${_fmtTime(entry['occurred_at'])} · ${_s(entry['actor_name'])}',
              style: TextStyle(fontSize: 10.5, color: DanColors.faint),
            ),
          ),
        ],
      ),
    );
  }
}

class _Spinner extends StatelessWidget {
  _Spinner();
  @override
  Widget build(BuildContext context) => SizedBox(
      width: 18,
      height: 18,
      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white));
}

