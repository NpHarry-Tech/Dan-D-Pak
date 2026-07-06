import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../providers/pos_provider.dart';
import '../ui/app_theme.dart';
import '../ui/file_pick.dart';

final _money = NumberFormat.decimalPattern('vi-VN');
String fmtMoney(num v) => '${_money.format(v.round())}đ';

num _num(dynamic v) => v is num ? v : num.tryParse('$v') ?? 0;
String _s(dynamic v) => v?.toString() ?? '';

const _methodLabels = {
  'cash': 'Tiền mặt',
  'card': 'Máy POS',
  'pos_card': 'Máy POS',
  'visa': 'Visa',
  'qr': 'QR',
  'qrcode': 'QR Code',
  'voucher': 'Voucher',
  'bank_transfer': 'Chuyển khoản',
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
  const ShiftDialog({super.key});

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

  void _toast(String msg, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? DanColors.late : DanColors.text,
    ));
  }

  String _err(Object e) => e.toString().replaceFirst('Exception: ', '');

  Future<bool> _confirm(String msg) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        content: Text(msg),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Hủy')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Đồng ý')),
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
        _toast('Đã mở ca');
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
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: Colors.orange),
            SizedBox(width: 8),
            Text('Cảnh báo Compliance'),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(warningMessage, style: const TextStyle(fontSize: 14)),
            const SizedBox(height: 16),
            const Text(
              'Nhập PIN Quản lý để xác nhận đưa các hóa đơn lỗi vào hàng đợi gửi lại sau và kết ca:',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: ctrl,
              obscureText: true,
              keyboardType: TextInputType.number,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Mã PIN Quản lý',
                isDense: true,
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Hủy bỏ'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()),
            child: const Text('Bỏ qua & Kết ca'),
          ),
        ],
      ),
    );
  }

  Future<void> _closeShift(PosProvider pos, List<int> denoms) async {
    final confirmed =
        await _confirm('Kết ca hiện tại? Hệ thống sẽ chốt báo cáo ca.');
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
        _toast('Đã kết ca');
        await auth.logout(keepBranch: true);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        final msg = _err(e);
        if (msg.contains('hóa đơn chưa') || msg.contains('MISA')) {
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
                _toast('Đã kết ca (ghi nhận quản lý bỏ qua)');
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
      builder: (_) => const CashExpenseDialog(),
    );
    if (done == true) await _reloadDrawer();
  }

  Future<void> _openReimbursement() async {
    final done = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const CashReimbursementDialog(),
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
      insetPadding: const EdgeInsets.all(18),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: 1040,
          maxHeight: size.height - 36,
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                isOpen ? 'Ca đang mở' : 'Mở ca làm việc',
                style:
                    const TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 4),
              Text(
                isOpen
                    ? 'Nhân viên ${_s(raw?['user_name'])} mở ${_s(raw?['shift_label'])} lúc ${_fmtDateTime(raw?['opened_at'])}'
                    : 'Không nhập kiểm đếm thì hệ thống dùng ${fmtMoney(pos.openingSuggestion)} từ ca trước / tiền két gốc.',
                style: const TextStyle(
                    fontSize: 12.5, color: DanColors.muted, height: 1.4),
              ),
              const SizedBox(height: 12),
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
                          const SizedBox(height: 12),
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
                          const SizedBox(width: 14),
                          Expanded(child: right),
                        ],
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  OutlinedButton(
                    onPressed: _busy ? null : () => Navigator.of(context).pop(),
                    child: const Text('Đóng'),
                  ),
                  const Spacer(),
                  if (isOpen)
                    FilledButton(
                      onPressed: _busy ? null : () => _closeShift(pos, denoms),
                      style: FilledButton.styleFrom(
                          backgroundColor: DanColors.late,
                          minimumSize: const Size(120, 44)),
                      child: _busy ? const _Spinner() : const Text('Kết ca'),
                    )
                  else
                    FilledButton(
                      onPressed: _busy ? null : () => _openShift(pos, denoms),
                      style: FilledButton.styleFrom(
                          minimumSize: const Size(120, 44)),
                      child: _busy ? const _Spinner() : const Text('Mở ca'),
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
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.lg),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            isOpen ? 'Kiểm đếm khi kết ca' : 'Kiểm đếm đầu ca',
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              SizedBox(
                width: 150,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Ca làm việc',
                        style: TextStyle(
                            fontSize: 12,
                            color: DanColors.muted,
                            fontWeight: FontWeight.w700)),
                    const SizedBox(height: 5),
                    DropdownButtonFormField<String>(
                      initialValue: selectedKey,
                      isExpanded: true,
                      decoration: const InputDecoration(isDense: true),
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
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Tổng kiểm đếm',
                        style: TextStyle(
                            fontSize: 11,
                            color: DanColors.muted,
                            fontWeight: FontWeight.w800)),
                    const SizedBox(height: 4),
                    Text(
                      showSuggestion
                          ? 'Tự dùng ${fmtMoney(pos.openingSuggestion)}'
                          : fmtMoney(total),
                      style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w900,
                          fontFamily: 'JetBrains Mono'),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          const Text('Mệnh giá tiền mặt',
              style: TextStyle(
                  fontSize: 12,
                  color: DanColors.muted,
                  fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
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
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _openExpense,
                    icon: const Icon(Icons.north_east, size: 15),
                    label: const Text('Chi từ két'),
                    style: OutlinedButton.styleFrom(
                        foregroundColor: DanColors.late,
                        side: BorderSide(
                            color: DanColors.late.withValues(alpha: .45))),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _openReimbursement,
                    icon: const Icon(Icons.south_west, size: 15),
                    label: const Text('Hoàn chi'),
                    style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFF047857),
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
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.lg),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Báo cáo ca',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
          const SizedBox(height: 10),
          Expanded(
            child: isOpen
                ? _reportBody(pos)
                : const Center(
                    child: Padding(
                      padding: EdgeInsets.all(20),
                      child: Text(
                        'Chưa có ca đang mở. Sau khi mở ca, doanh thu thanh toán sẽ được gom vào báo cáo tại đây.',
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
          _Brow(label: 'Số bill', value: '${_num(r['bill_count']).round()}'),
          _Brow(
              label: 'Tiền mặt bán hàng',
              value: fmtMoney(_num(r['cash_sales']))),
          _Brow(
              label: 'Chi từ két',
              value: fmtMoney(_num(r['drawer_expenses'])),
              valueColor: DanColors.late),
          _Brow(
              label: 'Hoàn chi',
              value: fmtMoney(_num(r['drawer_reimbursements'])),
              valueColor: const Color(0xFF047857)),
          _Brow(
              label: 'Chuyển khoản / ví',
              value: fmtMoney(_num(r['transfer_sales']))),
          _Brow(label: 'Máy POS / thẻ', value: fmtMoney(_num(r['pos_sales']))),
          _Brow(
              label: 'Tiền mặt dự kiến',
              value: fmtMoney(_num(r['expected_cash'])),
              bold: true),
          if (methodTotals is Map && methodTotals.isNotEmpty) ...[
            const _DashDivider(),
            for (final e in methodTotals.entries)
              _Brow(
                  label: _methodLabel(_s(e.key)),
                  value: fmtMoney(_num(e.value)),
                  muted: true),
          ],
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: DanColors.surface,
              borderRadius: BorderRadius.circular(DanRadius.md),
              border: Border.all(color: DanColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _Brow(
                    label: 'Tổng ngày vận hành',
                    value: fmtMoney(_num(day['total_revenue'])),
                    bold: true),
                _Brow(
                    label: 'Số bill trong ngày',
                    value: '${_num(day['bill_count']).round()}'),
                _Brow(
                    label: 'Tiền mặt trong ngày',
                    value: fmtMoney(_num(day['cash_sales']))),
                _Brow(
                    label: 'Chuyển khoản / ví trong ngày',
                    value: fmtMoney(_num(day['transfer_sales']))),
                _Brow(
                    label: 'Máy POS / thẻ trong ngày',
                    value: fmtMoney(_num(day['pos_sales']))),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const Text('GIAO DỊCH KÉT CA NÀY',
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .5,
                  color: DanColors.faint)),
          const SizedBox(height: 6),
          if (_drawerEntries.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 6),
              child: Text('Chưa có giao dịch két trong ca này',
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

  const _DenomField({
    required this.denom,
    required this.controller,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 108,
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(fmtMoney(denom),
              style: const TextStyle(
                  fontSize: 12,
                  color: DanColors.muted,
                  fontFamily: 'JetBrains Mono',
                  fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
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
              style: const TextStyle(
                  fontFamily: 'JetBrains Mono',
                  fontWeight: FontWeight.w800,
                  fontSize: 15),
              decoration: const InputDecoration(
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

  const _Brow({
    required this.label,
    required this.value,
    this.bold = false,
    this.muted = false,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.5),
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
  const _DashDivider();
  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.symmetric(vertical: 6),
        child: Divider(height: 1, color: DanColors.border),
      );
}

class _DrawerEntryTile extends StatelessWidget {
  final Map<String, dynamic> entry;
  const _DrawerEntryTile({required this.entry});

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
      margin: const EdgeInsets.only(bottom: 5),
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(9),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${isExpense ? 'Chi' : 'Hoàn chi'} ${fmtMoney(_num(entry['amount']))}',
            style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
                color: isExpense ? DanColors.late : const Color(0xFF047857)),
          ),
          if (parts.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(parts.join(' · '),
                  style: const TextStyle(
                      fontSize: 11.5, color: DanColors.muted, height: 1.3)),
            ),
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              '${_fmtTime(entry['occurred_at'])} · ${_s(entry['actor_name'])}',
              style: const TextStyle(fontSize: 10.5, color: DanColors.faint),
            ),
          ),
        ],
      ),
    );
  }
}

class _Spinner extends StatelessWidget {
  const _Spinner();
  @override
  Widget build(BuildContext context) => const SizedBox(
      width: 18,
      height: 18,
      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white));
}

// ── Chi từ két ──────────────────────────────────────────────────────────────
class CashExpenseDialog extends StatefulWidget {
  const CashExpenseDialog({super.key});

  @override
  State<CashExpenseDialog> createState() => _CashExpenseDialogState();
}

class _CashExpenseDialogState extends State<CashExpenseDialog> {
  final _amount = TextEditingController();
  final _counterparty = TextEditingController();
  final _reason = TextEditingController();
  final _product = TextEditingController();
  final _note = TextEditingController();
  DateTime _at = DateTime.now();
  String? _image;
  bool _busy = false;

  @override
  void dispose() {
    _amount.dispose();
    _counterparty.dispose();
    _reason.dispose();
    _product.dispose();
    _note.dispose();
    super.dispose();
  }

  void _toast(String msg, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(msg),
        backgroundColor: error ? DanColors.late : DanColors.text));
  }

  Future<void> _pickAt() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _at,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (d == null || !mounted) return;
    final t = await showTimePicker(
        context: context, initialTime: TimeOfDay.fromDateTime(_at));
    if (!mounted) return;
    setState(() => _at = DateTime(
        d.year, d.month, d.day, t?.hour ?? _at.hour, t?.minute ?? _at.minute));
  }

  Future<void> _pickImage() async {
    final data = await pickReceiptAsDataUrl();
    if (data != null && mounted) setState(() => _image = data);
  }

  Future<void> _submit() async {
    final amount = int.tryParse(_amount.text.trim()) ?? 0;
    if (amount <= 0) return _toast('Nhập số tiền chi', error: true);
    if (_counterparty.text.trim().isEmpty) {
      return _toast('Nhập bên nhận tiền / NCC', error: true);
    }
    if (_reason.text.trim().isEmpty) {
      return _toast('Nhập lý do chi', error: true);
    }
    setState(() => _busy = true);
    try {
      await context.read<PosProvider>().createCashExpense({
        'amount': amount,
        'occurred_at': _at.toIso8601String(),
        'counterparty': _counterparty.text.trim(),
        'reason': _reason.text.trim(),
        'product': _product.text.trim(),
        'invoice_image': _image ?? '',
        'note': _note.text.trim(),
      });
      if (mounted) {
        Navigator.of(context).pop(true);
        _toast('Đã ghi nhận chi tiền két');
      }
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: DanColors.surface,
      insetPadding: const EdgeInsets.all(20),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Chi từ két',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
              const SizedBox(height: 14),
              _field('Số tiền *', _amount,
                  keyboard: TextInputType.number,
                  formatters: [FilteringTextInputFormatter.digitsOnly],
                  hint: 'VD: 50000'),
              const SizedBox(height: 10),
              _labeled(
                'Ngày giờ chi',
                OutlinedButton.icon(
                  onPressed: _pickAt,
                  icon: const Icon(Icons.event, size: 16),
                  label: Text(DateFormat('dd/MM/yyyy HH:mm').format(_at)),
                  style: OutlinedButton.styleFrom(
                      alignment: Alignment.centerLeft,
                      minimumSize: const Size.fromHeight(42)),
                ),
              ),
              const SizedBox(height: 10),
              _field('Bên nhận tiền / NCC *', _counterparty,
                  hint: 'Tên người / nhà cung cấp nhận tiền'),
              const SizedBox(height: 10),
              _field('Lý do *', _reason, hint: 'Lý do chi tiền'),
              const SizedBox(height: 10),
              _field('Hàng hóa / dịch vụ', _product, hint: '(không bắt buộc)'),
              const SizedBox(height: 10),
              _labeled('Ảnh hóa đơn', _imagePicker()),
              const SizedBox(height: 10),
              _field('Ghi chú', _note, hint: '(không bắt buộc)', maxLines: 2),
              const SizedBox(height: 18),
              Row(
                children: [
                  OutlinedButton(
                      onPressed:
                          _busy ? null : () => Navigator.of(context).pop(false),
                      child: const Text('Hủy')),
                  const Spacer(),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    style: FilledButton.styleFrom(
                        backgroundColor: DanColors.late,
                        minimumSize: const Size(0, 44)),
                    child: _busy
                        ? const _Spinner()
                        : const Text('Xác nhận chi tiền'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _imagePicker() {
    if (_image == null) {
      return OutlinedButton.icon(
        onPressed: _pickImage,
        icon: const Icon(Icons.attach_file, size: 16),
        label: const Text('Chọn ảnh / PDF hóa đơn'),
        style: OutlinedButton.styleFrom(
            alignment: Alignment.centerLeft,
            minimumSize: const Size.fromHeight(42)),
      );
    }
    final isImage = _image!.startsWith('data:image');
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Row(
        children: [
          if (isImage)
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: Image.memory(
                _decodeDataUrl(_image!),
                width: 44,
                height: 44,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) =>
                    const Icon(Icons.image_not_supported, size: 24),
              ),
            )
          else
            const Icon(Icons.picture_as_pdf, size: 30, color: DanColors.late),
          const SizedBox(width: 10),
          const Expanded(
            child: Text('Đã đính kèm tài liệu',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
          ),
          IconButton(
            onPressed: () => setState(() => _image = null),
            icon: const Icon(Icons.close, size: 18),
            tooltip: 'Bỏ ảnh',
          ),
        ],
      ),
    );
  }

  Widget _labeled(String label, Widget child) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: const TextStyle(
                fontSize: 12,
                color: DanColors.muted,
                fontWeight: FontWeight.w700)),
        const SizedBox(height: 5),
        child,
      ],
    );
  }

  Widget _field(String label, TextEditingController c,
      {String? hint,
      int maxLines = 1,
      TextInputType? keyboard,
      List<TextInputFormatter>? formatters}) {
    return _labeled(
      label,
      TextField(
        controller: c,
        maxLines: maxLines,
        keyboardType: keyboard,
        inputFormatters: formatters,
        decoration: InputDecoration(isDense: true, hintText: hint),
      ),
    );
  }
}

Uint8List _decodeDataUrl(String dataUrl) {
  final i = dataUrl.indexOf(',');
  return base64Decode(i >= 0 ? dataUrl.substring(i + 1) : dataUrl);
}

// ── Hoàn chi ────────────────────────────────────────────────────────────────
class CashReimbursementDialog extends StatefulWidget {
  const CashReimbursementDialog({super.key});

  @override
  State<CashReimbursementDialog> createState() =>
      _CashReimbursementDialogState();
}

class _CashReimbursementDialogState extends State<CashReimbursementDialog> {
  final Map<int, TextEditingController> _ctrls = {};
  final Set<String> _selected = {};
  final _counterparty = TextEditingController();
  final _note = TextEditingController();
  DateTime _at = DateTime.now();

  List<int> _denoms = const [];
  List<Map<String, dynamic>> _expenses = [];
  num _drawerBefore = 0;
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final pos = context.read<PosProvider>();
    _denoms = pos.shiftDenominations;
    for (final d in _denoms) {
      _ctrls.putIfAbsent(d, () => TextEditingController(text: '0'));
    }
    try {
      final data = await pos.getCashDrawer();
      final ex = data['reimbursable_expenses'];
      final summary = data['summary'];
      if (mounted) {
        setState(() {
          _expenses = ex is List
              ? ex
                  .whereType<Map>()
                  .map((e) => Map<String, dynamic>.from(e))
                  .toList()
              : [];
          _drawerBefore = summary is Map ? _num(summary['expected_cash']) : 0;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) {
      c.dispose();
    }
    _counterparty.dispose();
    _note.dispose();
    super.dispose();
  }

  void _toast(String msg, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(msg),
        backgroundColor: error ? DanColors.late : DanColors.text));
  }

  int _actual() {
    var t = 0;
    for (final d in _denoms) {
      t += d * (int.tryParse(_ctrls[d]?.text.trim() ?? '') ?? 0);
    }
    return t;
  }

  num _due() {
    num t = 0;
    for (final e in _expenses) {
      if (_selected.contains(_s(e['id']))) {
        t += _num(e['outstanding_amount']);
      }
    }
    return t;
  }

  Future<void> _submit() async {
    final amount = _actual();
    if (amount <= 0) {
      return _toast('Vui lòng kiểm đếm số tiền thực nhận', error: true);
    }
    final due = _due();
    if (_selected.isNotEmpty && amount > due) {
      return _toast('Tiền thực nhận lớn hơn số phải hoàn của các khoản đã chọn',
          error: true);
    }
    setState(() => _busy = true);
    try {
      await context.read<PosProvider>().createCashReimbursement({
        'amount': amount,
        'occurred_at': _at.toIso8601String(),
        'counterparty': _counterparty.text.trim(),
        'note': _note.text.trim(),
        'reimburses_entry_ids': _selected.toList(),
      });
      if (mounted) {
        Navigator.of(context).pop(true);
        _toast('Đã ghi nhận hoàn chi');
      }
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    final actual = _actual();
    return Dialog(
      backgroundColor: DanColors.surface,
      insetPadding: const EdgeInsets.all(18),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 900, maxHeight: size.height - 36),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: _loading
              ? const SizedBox(
                  height: 200,
                  child: Center(child: CircularProgressIndicator()))
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text('Hoàn chi',
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w900)),
                    const SizedBox(height: 10),
                    _summaryCards(actual),
                    const SizedBox(height: 12),
                    Flexible(
                      child: LayoutBuilder(builder: (context, c) {
                        final narrow = c.maxWidth < 640;
                        final left = _expenseList();
                        final right = _denomCount();
                        if (narrow) {
                          return SingleChildScrollView(
                            child: Column(children: [
                              left,
                              const SizedBox(height: 12),
                              right
                            ]),
                          );
                        }
                        return Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(child: left),
                            const SizedBox(width: 14),
                            SizedBox(width: 300, child: right),
                          ],
                        );
                      }),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        OutlinedButton(
                            onPressed: _busy
                                ? null
                                : () => Navigator.of(context).pop(false),
                            child: const Text('Hủy')),
                        const Spacer(),
                        FilledButton(
                          onPressed: _busy ? null : _submit,
                          style: FilledButton.styleFrom(
                              minimumSize: const Size(0, 44)),
                          child: _busy
                              ? const _Spinner()
                              : const Text('Xác nhận hoàn chi'),
                        ),
                      ],
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  Widget _summaryCards(int actual) {
    Widget card(String label, String value, Color color) => Expanded(
          child: Container(
            padding: const EdgeInsets.all(10),
            margin: const EdgeInsets.only(right: 8),
            decoration: BoxDecoration(
              color: DanColors.surface2,
              borderRadius: BorderRadius.circular(DanRadius.md),
              border: Border.all(color: DanColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label.toUpperCase(),
                    style: const TextStyle(
                        fontSize: 9.5,
                        fontWeight: FontWeight.w800,
                        color: DanColors.muted)),
                const SizedBox(height: 4),
                Text(value,
                    style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                        fontFamily: 'JetBrains Mono',
                        color: color)),
              ],
            ),
          ),
        );
    return Row(
      children: [
        card('Két trước hoàn chi', fmtMoney(_drawerBefore), DanColors.text),
        card('Số phải hoàn (đã chọn)', fmtMoney(_due()), DanColors.late),
        card('Thực nhận đã kiểm đếm', fmtMoney(actual), DanColors.brand),
        Container(
          padding: const EdgeInsets.all(10),
          constraints: const BoxConstraints(minWidth: 150),
          decoration: BoxDecoration(
            color: DanColors.surface2,
            borderRadius: BorderRadius.circular(DanRadius.md),
            border: Border.all(color: DanColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('KÉT SAU HOÀN CHI',
                  style: TextStyle(
                      fontSize: 9.5,
                      fontWeight: FontWeight.w800,
                      color: DanColors.muted)),
              const SizedBox(height: 4),
              Text(fmtMoney(_drawerBefore + actual),
                  style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                      fontFamily: 'JetBrains Mono',
                      color: Color(0xFF047857))),
            ],
          ),
        ),
      ],
    );
  }

  Widget _expenseList() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Chọn các khoản chi được hoàn',
            style: TextStyle(
                fontSize: 12,
                color: DanColors.muted,
                fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        Container(
          constraints: const BoxConstraints(maxHeight: 240),
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: DanColors.surface2,
            borderRadius: BorderRadius.circular(DanRadius.md),
            border: Border.all(color: DanColors.border),
          ),
          child: _expenses.isEmpty
              ? const Padding(
                  padding: EdgeInsets.all(10),
                  child: Text('Không có khoản chi nào đang chờ hoàn',
                      style: TextStyle(color: DanColors.muted)))
              : SingleChildScrollView(
                  child: Column(
                    children: [
                      for (final e in _expenses) _expenseRow(e),
                    ],
                  ),
                ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _labeled(
                'Ngày giờ hoàn',
                OutlinedButton.icon(
                  onPressed: _pickAt,
                  icon: const Icon(Icons.event, size: 15),
                  label: Text(DateFormat('dd/MM HH:mm').format(_at),
                      style: const TextStyle(fontSize: 12)),
                  style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(40)),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _labeled(
                'Người hoàn tiền',
                TextField(
                  controller: _counterparty,
                  decoration: const InputDecoration(
                      isDense: true, hintText: 'Kế toán / người giao'),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        _labeled(
          'Ghi chú',
          TextField(
            controller: _note,
            maxLines: 2,
            decoration: const InputDecoration(
                isDense: true, hintText: '(không bắt buộc)'),
          ),
        ),
      ],
    );
  }

  Future<void> _pickAt() async {
    final d = await showDatePicker(
        context: context,
        initialDate: _at,
        firstDate: DateTime(2020),
        lastDate: DateTime(2100));
    if (d == null || !mounted) return;
    final t = await showTimePicker(
        context: context, initialTime: TimeOfDay.fromDateTime(_at));
    if (!mounted) return;
    setState(() => _at = DateTime(
        d.year, d.month, d.day, t?.hour ?? _at.hour, t?.minute ?? _at.minute));
  }

  Widget _expenseRow(Map<String, dynamic> e) {
    final id = _s(e['id']);
    final checked = _selected.contains(id);
    return InkWell(
      onTap: () => setState(() {
        if (checked) {
          _selected.remove(id);
        } else {
          _selected.add(id);
        }
      }),
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
        decoration: BoxDecoration(
          color: DanColors.surface,
          borderRadius: BorderRadius.circular(9),
          border:
              Border.all(color: checked ? DanColors.brand : DanColors.border),
        ),
        child: Row(
          children: [
            Icon(checked ? Icons.check_box : Icons.check_box_outline_blank,
                size: 20, color: checked ? DanColors.brand : DanColors.faint),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                      _s(e['title']).isNotEmpty
                          ? _s(e['title'])
                          : (_s(e['reason']).isNotEmpty
                              ? _s(e['reason'])
                              : _s(e['id'])),
                      style: const TextStyle(
                          fontSize: 12.5, fontWeight: FontWeight.w700)),
                  Text(_fmtDateTime(e['occurred_at']),
                      style: const TextStyle(
                          fontSize: 10.5, color: DanColors.muted)),
                ],
              ),
            ),
            Text(fmtMoney(_num(e['outstanding_amount'])),
                style: const TextStyle(
                    fontFamily: 'JetBrains Mono',
                    fontWeight: FontWeight.w800,
                    fontSize: 12.5,
                    color: DanColors.late)),
          ],
        ),
      ),
    );
  }

  Widget _denomCount() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Kiểm đếm tiền thực nhận',
            style: TextStyle(
                fontSize: 12,
                color: DanColors.muted,
                fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final d in _denoms)
              _DenomField(
                denom: d,
                controller: _ctrls[d]!,
                onChanged: () => setState(() {}),
              ),
          ],
        ),
      ],
    );
  }

  Widget _labeled(String label, Widget child) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: const TextStyle(
                fontSize: 12,
                color: DanColors.muted,
                fontWeight: FontWeight.w700)),
        const SizedBox(height: 5),
        child,
      ],
    );
  }
}
