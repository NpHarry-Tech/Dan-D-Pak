import 'package:flutter/material.dart';

import '../../ui/app_theme.dart';
import '../../ui/format.dart';

/// White rounded panel container used across the management module.
class Panel extends StatelessWidget {
  final String? title;
  final Widget? trailing;
  final Widget child;
  final EdgeInsetsGeometry padding;

  const Panel({
    super.key,
    this.title,
    this.trailing,
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.lg),
        boxShadow: const [
          BoxShadow(color: Color(0x0A102840), blurRadius: 2, offset: Offset(0, 1)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (title != null) ...[
            Row(
              children: [
                Expanded(
                  child: Text(
                    title!,
                    style: const TextStyle(
                        fontSize: 15, fontWeight: FontWeight.w800),
                  ),
                ),
                if (trailing != null) trailing!,
              ],
            ),
            const SizedBox(height: 14),
          ],
          child,
        ],
      ),
    );
  }
}

/// A single KPI metric card.
class KpiCard extends StatelessWidget {
  final String label;
  final String value;
  final Color valueColor;

  const KpiCard({
    super.key,
    required this.label,
    required this.value,
    this.valueColor = DanColors.text,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.lg),
        boxShadow: const [
          BoxShadow(color: Color(0x0A102840), blurRadius: 2, offset: Offset(0, 1)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label.toUpperCase(),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: DanColors.muted,
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: .3,
              height: 1.3,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: valueColor,
              fontSize: 26,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

/// One vertical column in [VerticalBarChart].
class BarDatum {
  final num value;
  final String topLabel; // shown above the bar (e.g. compact money)
  final String axisLabel; // shown under the bar (e.g. "8h")
  final String tooltip;
  const BarDatum({
    required this.value,
    this.topLabel = '',
    this.axisLabel = '',
    this.tooltip = '',
  });
}

/// Vertical bar chart used for "revenue by hour" and "revenue trends".
class VerticalBarChart extends StatelessWidget {
  final List<BarDatum> bars;
  final String emptyText;
  final double height;

  const VerticalBarChart({
    super.key,
    required this.bars,
    this.emptyText = 'Chưa có dữ liệu',
    this.height = 190,
  });

  @override
  Widget build(BuildContext context) {
    final total = bars.fold<num>(0, (a, b) => a + b.value);
    if (bars.isEmpty || total <= 0) {
      return SizedBox(
        height: height,
        child: Center(
          child: Text(emptyText,
              style: const TextStyle(color: DanColors.faint, fontSize: 13)),
        ),
      );
    }
    final maxV =
        bars.map((b) => b.value).fold<num>(1, (a, b) => b > a ? b : a);

    return SizedBox(
      height: height,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          for (final b in bars)
            Expanded(
              child: Tooltip(
                message: b.tooltip,
                child: _Bar(datum: b, maxValue: maxV, peak: b.value == maxV),
              ),
            ),
        ],
      ),
    );
  }
}

class _Bar extends StatelessWidget {
  final BarDatum datum;
  final num maxValue;
  final bool peak;
  const _Bar({required this.datum, required this.maxValue, required this.peak});

  @override
  Widget build(BuildContext context) {
    final hasRev = datum.value > 0;
    final frac = hasRev
        ? (datum.value / maxValue).clamp(0.06, 1.0).toDouble()
        : 0.03;
    final color = !hasRev
        ? DanColors.surface3
        : peak
            ? DanColors.brand
            : DanColors.brand.withValues(alpha: .55);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 3),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          if (hasRev && datum.topLabel.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: FittedBox(
                child: Text(
                  datum.topLabel,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: peak ? DanColors.brand : DanColors.muted,
                  ),
                ),
              ),
            ),
          Expanded(
            child: FractionallySizedBox(
              alignment: Alignment.bottomCenter,
              heightFactor: frac,
              child: Container(
                decoration: BoxDecoration(
                  color: color,
                  borderRadius:
                      const BorderRadius.vertical(top: Radius.circular(4)),
                ),
              ),
            ),
          ),
          const SizedBox(height: 5),
          FittedBox(
            child: Text(
              datum.axisLabel,
              style: const TextStyle(
                  fontSize: 10, color: DanColors.faint, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// One labelled horizontal progress row (payment methods / channels / stations).
class StatBarRow extends StatelessWidget {
  final String label;
  final num value;
  final num total; // for proportion; if 0, uses [fraction]
  final double? fraction; // explicit 0..1 override
  final Color color;
  final String valueText;
  final bool idle;

  const StatBarRow({
    super.key,
    required this.label,
    required this.value,
    required this.total,
    required this.color,
    required this.valueText,
    this.fraction,
    this.idle = false,
  });

  @override
  Widget build(BuildContext context) {
    final frac = (fraction ?? (total > 0 ? value / total : 0)).clamp(0.0, 1.0);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          SizedBox(
            width: 96,
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  fontSize: 12.5, fontWeight: FontWeight.w700, color: DanColors.text),
            ),
          ),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: Container(
                height: 12,
                color: DanColors.surface2,
                child: FractionallySizedBox(
                  alignment: Alignment.centerLeft,
                  widthFactor: frac.toDouble(),
                  child: Container(color: color),
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(
            width: 96,
            child: Text(
              valueText,
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: idle ? DanColors.faint : DanColors.text,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Compact segmented control (Ngày / Tuần / Tháng …).
class SegmentedTabs extends StatelessWidget {
  final List<String> labels;
  final int selected;
  final ValueChanged<int> onChanged;

  const SegmentedTabs({
    super.key,
    required this.labels,
    required this.selected,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.sm),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 0; i < labels.length; i++)
            GestureDetector(
              onTap: () => onChanged(i),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 120),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                decoration: BoxDecoration(
                  color: i == selected ? DanColors.surface : Colors.transparent,
                  borderRadius: BorderRadius.circular(6),
                  boxShadow: i == selected
                      ? const [
                          BoxShadow(
                              color: Color(0x14102840),
                              blurRadius: 3,
                              offset: Offset(0, 1))
                        ]
                      : null,
                ),
                child: Text(
                  labels[i],
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                    color: i == selected ? DanColors.brand : DanColors.muted,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Shared empty/error inline message.
class InlineMessage extends StatelessWidget {
  final String text;
  final VoidCallback? onRetry;
  final bool error;
  const InlineMessage(this.text, {super.key, this.onRetry, this.error = false});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            text,
            textAlign: TextAlign.center,
            style: TextStyle(
                color: error ? DanColors.late : DanColors.muted,
                fontWeight: FontWeight.w600),
          ),
          if (onRetry != null) ...[
            const SizedBox(height: 10),
            OutlinedButton(onPressed: onRetry, child: const Text('Thử lại')),
          ],
        ],
      ),
    );
  }
}

/// Rank badge (1/2/3 highlighted) for the top-items table.
class RankBadge extends StatelessWidget {
  final int rank;
  const RankBadge(this.rank, {super.key});

  @override
  Widget build(BuildContext context) {
    Color bg;
    switch (rank) {
      case 1:
        bg = const Color(0xFFFFC24D);
        break;
      case 2:
        bg = const Color(0xFFB8C2D0);
        break;
      case 3:
        bg = const Color(0xFFE0A878);
        break;
      default:
        bg = DanColors.surface3;
    }
    return Container(
      width: 22,
      height: 22,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6)),
      child: Text(
        '$rank',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w900,
          color: rank <= 3 ? Colors.white : DanColors.muted,
        ),
      ),
    );
  }
}

String moneyShort(num v) => Fmt.moneyShort(v);
