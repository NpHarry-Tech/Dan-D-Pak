import 'package:flutter/material.dart';

import '../ui/app_theme.dart';
import '../utils/translation.dart';

/// Bộ chọn NGÀY + GIỜ gọn trong MỘT hộp thoại — thay cho showDatePicker +
/// showTimePicker (clock-face) hai bước rườm rà. Giờ/phút chọn bằng bánh xe
/// (wheel) kiểu iOS cho nhanh, ngày dùng lịch inline. Trả về DateTime local
/// hoặc null nếu huỷ.
Future<DateTime?> pickDanDateTime(BuildContext context, {DateTime? initial}) {
  return showDialog<DateTime>(
    context: context,
    builder: (_) => _DanDateTimeDialog(initial: initial ?? DateTime.now()),
  );
}

class _DanDateTimeDialog extends StatefulWidget {
  final DateTime initial;
  const _DanDateTimeDialog({required this.initial});

  @override
  State<_DanDateTimeDialog> createState() => _DanDateTimeDialogState();
}

class _DanDateTimeDialogState extends State<_DanDateTimeDialog> {
  late DateTime _date;
  late int _hour;
  late int _minute;

  @override
  void initState() {
    super.initState();
    _date =
        DateTime(widget.initial.year, widget.initial.month, widget.initial.day);
    _hour = widget.initial.hour;
    _minute = widget.initial.minute;
  }

  DateTime get _value =>
      DateTime(_date.year, _date.month, _date.day, _hour, _minute);

  void _now() {
    final n = DateTime.now();
    setState(() {
      _date = DateTime(n.year, n.month, n.day);
      _hour = n.hour;
      _minute = n.minute;
    });
  }

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width > 640;
    final calendar = _calendar();
    final time = _timeWheels();
    return Dialog(
      backgroundColor: DanColors.surface,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: wide ? 620 : 380,
          maxHeight: MediaQuery.sizeOf(context).height * .9,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 4),
              child: Row(children: [
                const Icon(Icons.event_available_outlined,
                    size: 20, color: DanColors.brand),
                const SizedBox(width: 8),
                Expanded(
                    child: Text(t('Chọn ngày giờ'),
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w900))),
                Text(_fmt(_value),
                    style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: DanColors.brand)),
              ]),
            ),
            const Divider(height: 1, color: DanColors.border),
            Flexible(
              child: SingleChildScrollView(
                child: wide
                    ? Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                            Expanded(child: calendar),
                            Container(
                                width: 1,
                                color: DanColors.border,
                                height: 300,
                                margin:
                                    const EdgeInsets.symmetric(vertical: 12)),
                            Expanded(
                                child: Padding(
                                    padding: const EdgeInsets.only(top: 24),
                                    child: time)),
                          ])
                    : Column(children: [
                        calendar,
                        const Divider(height: 1, color: DanColors.border),
                        Padding(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            child: time)
                      ]),
              ),
            ),
            const Divider(height: 1, color: DanColors.border),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Row(children: [
                TextButton.icon(
                  onPressed: _now,
                  icon: const Icon(Icons.schedule, size: 16),
                  label: Text(t('Bây giờ')),
                ),
                const Spacer(),
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: Text(t('Hủy'))),
                const SizedBox(width: 6),
                FilledButton(
                  onPressed: () => Navigator.pop(context, _value),
                  child: Text(t('Xong')),
                ),
              ]),
            ),
          ],
        ),
      ),
    );
  }

  Widget _calendar() {
    return SizedBox(
      height: 320,
      child: CalendarDatePicker(
        initialDate: _date,
        firstDate: DateTime(2020),
        lastDate: DateTime(2100),
        onDateChanged: (d) => setState(() => _date = d),
      ),
    );
  }

  Widget _timeWheels() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(t('Giờ'),
            style: const TextStyle(
                fontSize: 12,
                color: DanColors.muted,
                fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _wheel(24, _hour, (v) => setState(() => _hour = v)),
            const Padding(
                padding: EdgeInsets.symmetric(horizontal: 4),
                child: Text(':',
                    style:
                        TextStyle(fontSize: 24, fontWeight: FontWeight.w900))),
            _wheel(60, _minute, (v) => setState(() => _minute = v)),
          ],
        ),
      ],
    );
  }

  Widget _wheel(int count, int value, ValueChanged<int> onChanged) {
    return SizedBox(
      width: 70,
      height: 132,
      child: Stack(
        children: [
          Positioned.fill(
            top: 50,
            bottom: 50,
            child: Container(
              decoration: BoxDecoration(
                color: DanColors.brandDim,
                borderRadius: BorderRadius.circular(DanRadius.sm),
              ),
            ),
          ),
          ListWheelScrollView.useDelegate(
            controller: FixedExtentScrollController(initialItem: value),
            itemExtent: 44,
            physics: const FixedExtentScrollPhysics(),
            perspective: 0.004,
            onSelectedItemChanged: onChanged,
            childDelegate: ListWheelChildBuilderDelegate(
              childCount: count,
              builder: (_, i) => Center(
                child: Text(i.toString().padLeft(2, '0'),
                    style: TextStyle(
                        fontSize: 22,
                        fontWeight:
                            i == value ? FontWeight.w900 : FontWeight.w500,
                        color: i == value ? DanColors.brand : DanColors.muted)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  static const _weekdays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  String _fmt(DateTime d) {
    final wd = _weekdays[(d.weekday - 1) % 7];
    String two(int n) => n.toString().padLeft(2, '0');
    return '$wd, ${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
  }
}
