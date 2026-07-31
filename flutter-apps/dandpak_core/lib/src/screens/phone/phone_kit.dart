import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../ui/app_theme.dart';
import '../../utils/translation.dart';

/// Bộ widget dùng chung cho BẢN ĐIỆN THOẠI.
///
/// Vì sao tách riêng khỏi widget desktop/tablet: điện thoại cầm một tay, ngón
/// cái chỉ với tới 1/3 dưới màn hình. Nên mọi thao tác chính ở đây đều nằm
/// trong [PhoneActionBar] ghim đáy, mọi vùng chạm ≥ 44px, và số tiền dùng chữ
/// số đều (tabular) để cột tiền không nhảy khi đổi giá trị.
///
/// Màu lấy nguyên từ [DanColors] — KHÔNG khai báo màu mới ở đây. Bản thiết kế
/// điện thoại được vẽ trên đúng bộ token đó nên hai bên không lệch nhau.

/// Chữ số đều — bắt buộc cho mọi con số tiền/số lượng.
const _tabular = <FontFeature>[FontFeature.tabularFigures()];

String phoneMoney(num n) {
  final v = n.round();
  final s = v.abs().toString();
  final b = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write('.');
    b.write(s[i]);
  }
  return '${v < 0 ? '-' : ''}$bđ';
}

String phoneInt(num n) {
  final v = n.round();
  final s = v.abs().toString();
  final b = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write('.');
    b.write(s[i]);
  }
  return '${v < 0 ? '-' : ''}$b';
}

/// Thanh tiêu đề 56px, dính đỉnh.
class PhoneHeader extends StatelessWidget implements PreferredSizeWidget {
  final String title;
  final String? subtitle;
  final Color? subtitleColor;
  final VoidCallback? onBack;
  final List<Widget> actions;

  const PhoneHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.subtitleColor,
    this.onBack,
    this.actions = const [],
  });

  @override
  Size get preferredSize => const Size.fromHeight(56);

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 56,
      decoration: const BoxDecoration(
        color: DanColors.surface,
        border: Border(bottom: BorderSide(color: DanColors.border)),
      ),
      padding: const EdgeInsets.only(left: 4, right: 8),
      child: Row(
        children: [
          if (onBack != null)
            _TapTarget(
              onTap: onBack!,
              child: const Icon(Icons.arrow_back_ios_new,
                  size: 19, color: DanColors.text),
            )
          else
            const SizedBox(width: 12),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 16.5,
                        fontWeight: FontWeight.w800,
                        height: 1.15)),
                if (subtitle != null && subtitle!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 1),
                    child: Text(subtitle!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: subtitleColor ?? DanColors.muted)),
                  ),
              ],
            ),
          ),
          ...actions,
        ],
      ),
    );
  }
}

/// Nút biểu tượng 44x44 — kích thước chạm tối thiểu.
class PhoneIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onTap;
  final Color? color;
  final bool dot;

  const PhoneIconButton(
      {super.key,
      required this.icon,
      this.onTap,
      this.color,
      this.dot = false});

  @override
  Widget build(BuildContext context) {
    return _TapTarget(
      onTap: onTap,
      child: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.center,
        children: [
          Icon(icon, size: 20, color: color ?? DanColors.text),
          if (dot)
            Positioned(
              top: 2,
              right: 2,
              child: Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: DanColors.late,
                  shape: BoxShape.circle,
                  border: Border.all(color: DanColors.surface, width: 2),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _TapTarget extends StatelessWidget {
  final Widget child;
  final VoidCallback? onTap;
  const _TapTarget({required this.child, this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkResponse(
      onTap: onTap,
      radius: 24,
      child: SizedBox(width: 44, height: 44, child: Center(child: child)),
    );
  }
}

/// Chip lọc/chọn — chạm mở bảng chọn dạng bottom sheet.
class PhoneChip extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback? onTap;
  final bool caret;

  const PhoneChip(
      {super.key,
      required this.label,
      this.active = false,
      this.onTap,
      this.caret = false});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        height: 34,
        padding: const EdgeInsets.symmetric(horizontal: 11),
        decoration: BoxDecoration(
          color: active ? const Color(0xFFE4F5F9) : DanColors.surface,
          border:
              Border.all(color: active ? DanColors.brand : DanColors.border2),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color:
                          active ? DanColors.brandHover : DanColors.muted)),
            ),
            if (caret) ...[
              const SizedBox(width: 5),
              Icon(Icons.keyboard_arrow_down,
                  size: 15,
                  color: active ? DanColors.brandHover : DanColors.faint),
            ],
          ],
        ),
      ),
    );
  }
}

enum PhoneTone { ok, warn, bad, neutral }

class PhoneBadge extends StatelessWidget {
  final String label;
  final PhoneTone tone;
  const PhoneBadge(this.label, {super.key, this.tone = PhoneTone.neutral});

  @override
  Widget build(BuildContext context) {
    late final Color fg;
    late final Color bg;
    switch (tone) {
      case PhoneTone.ok:
        fg = const Color(0xFF047857);
        bg = const Color(0xFFE9FBF2);
      case PhoneTone.warn:
        fg = const Color(0xFFB4740A);
        bg = const Color(0xFFFFF6E4);
      case PhoneTone.bad:
        fg = const Color(0xFFD94A4A);
        bg = const Color(0xFFFFF1F1);
      case PhoneTone.neutral:
        fg = DanColors.muted;
        bg = DanColors.surface2;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration:
          BoxDecoration(color: bg, borderRadius: BorderRadius.circular(99)),
      child: Text(label,
          style: TextStyle(
              fontSize: 10.5, fontWeight: FontWeight.w800, color: fg)),
    );
  }
}

/// Dòng nhãn — giá trị.
class PhoneKv extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  final bool big;

  const PhoneKv(this.label, this.value,
      {super.key, this.valueColor, this.big = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Text(label,
                style: TextStyle(
                    fontSize: big ? 13 : 12.5,
                    fontWeight: big ? FontWeight.w800 : FontWeight.w600,
                    color: big ? DanColors.text : DanColors.muted)),
          ),
          const SizedBox(width: 10),
          Text(value,
              style: TextStyle(
                  fontSize: big ? 19 : 13,
                  fontWeight: FontWeight.w800,
                  fontFeatures: _tabular,
                  color: valueColor ?? DanColors.text)),
        ],
      ),
    );
  }
}

/// Hàng bấm được (khách hàng, voucher…).
class PhoneRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final VoidCallback? onTap;
  final Color? valueColor;

  const PhoneRow(
      {super.key,
      required this.icon,
      required this.label,
      required this.value,
      this.onTap,
      this.valueColor});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 52),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: const BoxDecoration(
          color: DanColors.surface,
          border: Border(
            top: BorderSide(color: DanColors.border),
            bottom: BorderSide(color: DanColors.border),
          ),
        ),
        child: Row(
          children: [
            Icon(icon, size: 18, color: DanColors.muted),
            const SizedBox(width: 11),
            Text(label,
                style: const TextStyle(
                    fontSize: 13, fontWeight: FontWeight.w700)),
            const Spacer(),
            Flexible(
              child: Text(value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.right,
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: valueColor ?? DanColors.muted)),
            ),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right, size: 17, color: DanColors.faint),
          ],
        ),
      ),
    );
  }
}

/// Tiêu đề nhóm.
class PhoneSectionTitle extends StatelessWidget {
  final String title;
  final Widget? trailing;
  const PhoneSectionTitle(this.title, {super.key, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 8),
      child: Row(
        children: [
          Expanded(
            child: Text(title,
                style: const TextStyle(
                    fontSize: 13.5, fontWeight: FontWeight.w800)),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

/// Thanh hành động ghim đáy — luôn nằm trong vùng ngón cái, trên safe area.
class PhoneActionBar extends StatelessWidget {
  final Widget child;
  const PhoneActionBar({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: DanColors.surface,
        border: Border(top: BorderSide(color: DanColors.border)),
      ),
      padding: EdgeInsets.fromLTRB(
          16, 10, 16, 10 + MediaQuery.of(context).padding.bottom),
      child: child,
    );
  }
}

/// Nút hành động chính. Cao 52 — bấm được chắc tay khi đang cầm hàng.
class PhoneCta extends StatelessWidget {
  final String label;
  final String? trailing;
  final VoidCallback? onPressed;
  final bool busy;

  const PhoneCta(
      {super.key,
      required this.label,
      this.trailing,
      this.onPressed,
      this.busy = false});

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !busy;
    return Opacity(
      opacity: enabled ? 1 : .5,
      child: Material(
        color: DanColors.brand,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          onTap: enabled ? onPressed : null,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            height: 52,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            alignment: Alignment.center,
            child: busy
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                        strokeWidth: 2.4, color: Colors.white))
                : Row(
                    children: [
                      Expanded(
                        child: Text(label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 14.5,
                                fontWeight: FontWeight.w800,
                                color: Colors.white)),
                      ),
                      if (trailing != null)
                        Text(trailing!,
                            style: const TextStyle(
                                fontSize: 14.5,
                                fontWeight: FontWeight.w800,
                                color: Colors.white,
                                fontFeatures: _tabular)),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

/// Nút phụ (viền).
class PhoneSecondaryButton extends StatelessWidget {
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  const PhoneSecondaryButton(
      {super.key, required this.label, this.icon, this.onPressed});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: DanColors.surface,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          height: 52,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            border: Border.all(color: DanColors.border2),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 18, color: DanColors.text),
                const SizedBox(width: 9),
              ],
              Flexible(
                child: Text(label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 13.5, fontWeight: FontWeight.w800)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Bảng chọn dạng bottom sheet — theo kỷ luật thiết kế, MỌI lựa chọn trên điện
/// thoại đều mở từ đáy màn, không dùng hộp thoại giữa màn.
Future<T?> showPhoneSheet<T>({
  required BuildContext context,
  required String title,
  required Widget Function(BuildContext) builder,
}) {
  return showModalBottomSheet<T>(
    context: context,
    backgroundColor: DanColors.surface,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (ctx) => SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 8),
          Container(
            width: 38,
            height: 4,
            decoration: BoxDecoration(
                color: DanColors.border2,
                borderRadius: BorderRadius.circular(99)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
            child: Row(
              children: [
                Expanded(
                  child: Text(title,
                      style: const TextStyle(
                          fontSize: 15.5, fontWeight: FontWeight.w800)),
                ),
                PhoneIconButton(
                    icon: Icons.close,
                    onTap: () => Navigator.of(ctx).pop(),
                    color: DanColors.muted),
              ],
            ),
          ),
          Flexible(
            child: ConstrainedBox(
              constraints: BoxConstraints(
                  maxHeight: MediaQuery.of(ctx).size.height * .62),
              child: builder(ctx),
            ),
          ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
}

/// Danh sách lựa chọn trong bottom sheet.
class PhonePickList extends StatelessWidget {
  final List<String> options;
  final String selected;
  final ValueChanged<String> onPick;
  const PhonePickList(
      {super.key,
      required this.options,
      required this.selected,
      required this.onPick});

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      shrinkWrap: true,
      itemCount: options.length,
      itemBuilder: (_, i) {
        final o = options[i];
        final on = o == selected;
        return InkWell(
          onTap: () => onPick(o),
          child: Container(
            constraints: const BoxConstraints(minHeight: 52),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: DanColors.border)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(o,
                      style: TextStyle(
                          fontSize: 14,
                          fontWeight:
                              on ? FontWeight.w800 : FontWeight.w600)),
                ),
                if (on)
                  const Icon(Icons.check, size: 19, color: DanColors.brand),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Bàn phím số. [big] = bàn phím PIN (phím cao 60), ngược lại là bàn phím tiền.
class PhoneNumPad extends StatelessWidget {
  final ValueChanged<String> onKey;
  final bool big;
  final String extraKey;

  const PhoneNumPad(
      {super.key,
      required this.onKey,
      this.big = false,
      this.extraKey = '000'});

  @override
  Widget build(BuildContext context) {
    final keys = <String>[
      '1', '2', '3', '4', '5', '6', '7', '8', '9',
      big ? '' : extraKey, '0', 'del',
    ];
    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 3,
      mainAxisSpacing: big ? 8 : 6,
      crossAxisSpacing: big ? 8 : 6,
      childAspectRatio: big ? 1.72 : 2.0,
      children: [
        for (final k in keys)
          if (k.isEmpty)
            const SizedBox.shrink()
          else
            Material(
              color: (k == 'del' || k == extraKey)
                  ? DanColors.surface2
                  : DanColors.surface,
              borderRadius: BorderRadius.circular(big ? 10 : 9),
              child: InkWell(
                onTap: () {
                  HapticFeedback.selectionClick();
                  onKey(k);
                },
                borderRadius: BorderRadius.circular(big ? 10 : 9),
                child: Container(
                  decoration: BoxDecoration(
                    border: Border.all(color: DanColors.border),
                    borderRadius: BorderRadius.circular(big ? 10 : 9),
                  ),
                  alignment: Alignment.center,
                  child: k == 'del'
                      ? const Icon(Icons.backspace_outlined,
                          size: 21, color: DanColors.muted)
                      : Text(k,
                          style: TextStyle(
                              fontSize: big ? 23 : (k == extraKey ? 16 : 20),
                              fontWeight: FontWeight.w700)),
                ),
              ),
            ),
      ],
    );
  }
}

/// Trạng thái rỗng dùng chung.
class PhoneEmpty extends StatelessWidget {
  final String title;
  final String hint;
  final IconData icon;
  const PhoneEmpty(
      {super.key,
      required this.title,
      required this.hint,
      this.icon = Icons.inventory_2_outlined});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 60, horizontal: 20),
      child: Column(
        children: [
          Icon(icon, size: 54, color: DanColors.border2),
          const SizedBox(height: 14),
          Text(t(title),
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: DanColors.muted)),
          const SizedBox(height: 4),
          Text(t(hint),
              textAlign: TextAlign.center,
              style:
                  const TextStyle(fontSize: 12, color: DanColors.faint)),
        ],
      ),
    );
  }
}

/// Hàng có công tắc bật/tắt. Chạm vào CẢ HÀNG là đổi, không bắt trúng đúng cái
/// công tắc bé xíu — ngón tay trên máy POS cầm tay thường đeo găng hoặc ướt.
class PhoneSwitchRow extends StatelessWidget {
  final String label;
  final String? hint;
  final bool value;
  final ValueChanged<bool> onChanged;

  const PhoneSwitchRow({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    this.hint,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => onChanged(!value),
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: DanColors.border)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label,
                      style: const TextStyle(
                          fontSize: 13.5, fontWeight: FontWeight.w700)),
                  if (hint != null && hint!.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(hint!,
                        style: const TextStyle(
                            fontSize: 11, color: DanColors.faint)),
                  ],
                ],
              ),
            ),
            Switch(value: value, onChanged: onChanged),
          ],
        ),
      ),
    );
  }
}
