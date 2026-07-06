import 'dart:async';

import 'package:flutter/material.dart';

import '../services/socket_service.dart';
import '../ui/app_theme.dart';
import '../ui/format.dart';
import 'window_controls.dart';

/// Shared top bar for native module screens.
///
/// Mirrors the web `topbar()` contract:
/// [brand + branch] · [page title] · [actions · clock].
class DanModuleTopBar extends StatelessWidget implements PreferredSizeWidget {
  final String brandName;
  final String title;
  final String subtitle;
  final IconData? titleIcon;
  final String userName;
  final String userRole;
  final bool online;
  final List<Widget> actions;
  final VoidCallback? onBack;
  final VoidCallback? onLogout;

  const DanModuleTopBar({
    super.key,
    required this.brandName,
    required this.title,
    required this.subtitle,
    this.titleIcon,
    required this.userName,
    required this.userRole,
    this.online = true,
    this.actions = const [],
    this.onBack,
    this.onLogout,
  });

  @override
  Size get preferredSize => const Size.fromHeight(62);

  @override
  Widget build(BuildContext context) {
    return Material(
      color: DanColors.surface,
      child: SafeArea(
        bottom: false,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final compact = constraints.maxWidth < 1700;
            final branchWidth = compact ? 132.0 : 190.0;

            return Container(
              constraints: const BoxConstraints(minHeight: 62),
              padding: EdgeInsets.symmetric(
                horizontal: compact ? 12 : 18,
                vertical: 9,
              ),
              decoration: const BoxDecoration(
                color: DanColors.surface,
                border: Border(bottom: BorderSide(color: DanColors.border)),
              ),
              child: DragToMoveArea(
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    // Left brand · right cluster (actions, clock) with trailing
                    // space reserved for the window buttons overlay. The
                    // notification bell is intentionally NOT global here — only
                    // the POS screen adds one via `actions` (staff read new
                    // dishes there). Other modules stay bell-free.
                    Row(
                      children: [
                        _Brand(
                          brandName: brandName,
                          width: branchWidth,
                          onTap: onBack,
                        ),
                        const Spacer(),
                        if (actions.isNotEmpty)
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              for (var i = 0; i < actions.length; i++) ...[
                                if (i > 0) const SizedBox(width: 8),
                                actions[i],
                              ],
                            ],
                          ),
                        const SizedBox(width: 12),
                        const _LiveClock(),
                        // Reserve room for the global window buttons (min/max/close)
                        // pinned at the top-right of the window.
                        SizedBox(width: WindowControls.supported ? 146 : 0),
                      ],
                    ),
                    // Centered page title.
                    if (constraints.maxWidth >= 1150)
                      IgnorePointer(
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (titleIcon != null) ...[
                              Icon(titleIcon, size: 22, color: DanColors.muted),
                              const SizedBox(width: 9),
                            ],
                            Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w900,
                                height: 1.18,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
 
class DanTopBarButton extends StatelessWidget {
  final String label;
  final VoidCallback onPressed;
  final IconData? icon;
  final bool danger;
  final bool success;
  final double? minWidth;
 
  const DanTopBarButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.danger = false,
    this.success = false,
    this.minWidth,
  });
 
  @override
  Widget build(BuildContext context) {
    final Color border;
    final Color background;
    final Color color;
    if (danger) {
      border = DanColors.late.withValues(alpha: .45);
      background = DanColors.late.withValues(alpha: .10);
      color = DanColors.late;
    } else if (success) {
      border = DanColors.done.withValues(alpha: .45);
      background = DanColors.done.withValues(alpha: .12);
      color = const Color(0xFF047857);
    } else {
      border = DanColors.border2;
      background = DanColors.surface2;
      color = DanColors.text;
    }
 
    final screenWidth = MediaQuery.of(context).size.width;
    final showLabel = icon == null || screenWidth >= 1100;
 
    return InkWell(
      onTap: onPressed,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        height: 36,
        constraints: BoxConstraints(minWidth: showLabel ? (minWidth ?? 0) : 36),
        padding: EdgeInsets.symmetric(horizontal: showLabel ? 12 : 8),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: border),
        ),
        alignment: Alignment.center,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 15, color: color),
              if (showLabel) const SizedBox(width: 6),
            ],
            if (showLabel)
              Text(
                label,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w800,
                  color: color,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class DanTopBarCountChip extends StatelessWidget {
  final String label;

  const DanTopBarCountChip({super.key, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 26,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: DanColors.surface3,
        borderRadius: BorderRadius.circular(99),
      ),
      alignment: Alignment.center,
      child: Text(
        label,
        style: const TextStyle(
          color: DanColors.muted,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class DanTopBarIconButton extends StatelessWidget {
  final String label;
  final IconData? icon;
  final VoidCallback onPressed;

  const DanTopBarIconButton({
    super.key,
    this.label = '',
    this.icon,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onPressed,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(
          color: DanColors.surface2,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: DanColors.border2),
        ),
        alignment: Alignment.center,
        child: icon != null
            ? Icon(icon, size: 18, color: DanColors.text)
            : Text(label, style: const TextStyle(fontSize: 15)),
      ),
    );
  }
}

class _Brand extends StatelessWidget {
  final String brandName;
  final double width;
  final VoidCallback? onTap;

  const _Brand({
    required this.brandName,
    required this.width,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final content = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Image.asset(
          'assets/web/assets/DanOnLogo.png',
          height: 44,
          fit: BoxFit.contain,
          errorBuilder: (_, __, ___) => const SizedBox(width: 44, height: 44),
        ),
        const SizedBox(width: 12),
        Container(width: 1, height: 39, color: DanColors.border2),
        const SizedBox(width: 13),
        SizedBox(
          width: width,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                brandName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w800,
                  height: 1.1,
                ),
              ),
              const SizedBox(height: 2),
              // Trạng thái kết nối realtime THẬT: đứt socket = dữ liệu có thể
              // cũ so với các máy khác — nhân viên phải nhìn thấy ngay.
              ValueListenableBuilder<bool>(
                valueListenable: SocketService().connected,
                builder: (_, online, __) => Row(
                  children: [
                    _Dot(
                        color: online ? DanColors.done : DanColors.late,
                        size: 6),
                    const SizedBox(width: 5),
                    Text(
                      online ? 'TRỰC TIẾP' : 'MẤT KẾT NỐI',
                      style: TextStyle(
                        fontSize: 9.5,
                        letterSpacing: .4,
                        fontWeight: FontWeight.w800,
                        color: online ? DanColors.done : DanColors.late,
                        height: 1.1,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );

    if (onTap == null) return content;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: content,
    );
  }
}

class _LiveClock extends StatefulWidget {
  const _LiveClock();

  @override
  State<_LiveClock> createState() => _LiveClockState();
}

class _LiveClockState extends State<_LiveClock> {
  Timer? _timer;
  DateTime _now = DateTime.now();

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Text(
      Fmt.hms(_now),
      style: const TextStyle(
        color: DanColors.muted,
        fontFamily: 'JetBrains Mono',
        fontSize: 13,
        fontWeight: FontWeight.w500,
        fontFeatures: [FontFeature.tabularFigures()],
      ),
    );
  }
}

class _Dot extends StatelessWidget {
  final Color color;
  final double size;

  const _Dot({required this.color, this.size = 7});

  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(color: color.withValues(alpha: .45), blurRadius: 8),
          ],
        ),
      );
}

/// Maps a backend role id to a Vietnamese label for the user chip.
String roleLabel(String role) {
  switch (role) {
    case 'owner':
    case 'admin':
      return 'Admin';
    case 'manager':
      return 'Quản lý';
    case 'cashier':
      return 'Thu ngân';
    case 'kitchen':
      return 'Bếp';
    case 'warehouse':
      return 'Kho';
    default:
      return role;
  }
}
