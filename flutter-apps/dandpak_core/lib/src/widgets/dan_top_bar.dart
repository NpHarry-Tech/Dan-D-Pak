import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_service.dart';
import '../services/app_updater.dart';
import '../services/socket_service.dart';
import '../ui/app_theme.dart';
import '../ui/format.dart';
import 'window_controls.dart';
import '../utils/translation.dart';

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

  DanModuleTopBar({
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
  Size get preferredSize => Size.fromHeight(62);

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
              constraints: BoxConstraints(minHeight: 62),
              padding: EdgeInsets.symmetric(
                horizontal: compact ? 12 : 18,
                vertical: 9,
              ),
              decoration: BoxDecoration(
                color: DanColors.surface,
                border: Border(bottom: BorderSide(color: DanColors.border)),
              ),
              child: DragToMoveArea(
                // Row bố cục: [brand] · [tiêu đề co giãn ở giữa] · [actions ·
                // clock]. Trước đây tiêu đề canh giữa TUYỆT ĐỐI bằng Stack nên
                // ĐÈ LÊN cụm nút khi topbar chật (chữ chồng nhau). Giờ tiêu đề
                // nằm trong Expanded ở khoảng giữa → không bao giờ đè, tự cắt
                // "…" khi hết chỗ.
                child: Row(
                  children: [
                    _Brand(
                      brandName: brandName,
                      width: branchWidth,
                      onTap: onBack,
                    ),
                    Expanded(
                      child: Center(
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (titleIcon != null) ...[
                              Icon(titleIcon, size: 22, color: DanColors.muted),
                              SizedBox(width: 9),
                            ],
                            Flexible(
                              child: Text(
                                title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 17,
                                  fontWeight: FontWeight.w900,
                                  height: 1.18,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    _UpdateChip(),
                    SizedBox(width: 8),
                    if (actions.isNotEmpty)
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          for (var i = 0; i < actions.length; i++) ...[
                            if (i > 0) SizedBox(width: 8),
                            actions[i],
                          ],
                        ],
                      ),
                    SizedBox(width: 12),
                    _LiveClock(),
                    // Reserve room for the global window buttons (min/max/close)
                    // pinned at the top-right of the window (desktop only).
                    SizedBox(width: WindowControls.supported ? 146 : 0),
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

  DanTopBarButton({
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
      color = Color(0xFF047857);
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
              if (showLabel) SizedBox(width: 6),
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

  DanTopBarCountChip({super.key, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 26,
      padding: EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: DanColors.surface3,
        borderRadius: BorderRadius.circular(99),
      ),
      alignment: Alignment.center,
      child: Text(
        label,
        style: TextStyle(
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

  DanTopBarIconButton({
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
            : Text(label, style: TextStyle(fontSize: 15)),
      ),
    );
  }
}

class _UpdateChip extends StatefulWidget {
  _UpdateChip();

  @override
  State<_UpdateChip> createState() => _UpdateChipState();
}

class _UpdateChipState extends State<_UpdateChip> {
  UpdateInfo? _info;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _check());
  }

  Future<void> _check() async {
    try {
      final info = await AppUpdater.checkForUpdate(context.read<ApiService>());
      if (mounted) setState(() => _info = info);
    } catch (_) {}
  }

  Future<void> _install() async {
    final info = _info;
    if (info == null || _busy) return;
    setState(() => _busy = true);
    final err =
        await AppUpdater.downloadAndInstall(context.read<ApiService>(), info);
    if (!mounted) return;
    setState(() => _busy = false);
    if (err != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(err), backgroundColor: DanColors.late),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final info = _info;
    if (info == null) return SizedBox.shrink();
    return Tooltip(
      message: t('Cập nhật ${info.version} build ${info.buildNumber}'),
      child: DanTopBarButton(
        label: _busy ? t('Đang tải') : t('Cập nhật'),
        icon: _busy ? Icons.hourglass_empty : Icons.system_update_alt,
        success: true,
        onPressed: _install,
      ),
    );
  }
}

class _Brand extends StatelessWidget {
  final String brandName;
  final double width;
  final VoidCallback? onTap;

  _Brand({
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
          'assets/brand/DanOnLogo.png',
          height: 44,
          fit: BoxFit.contain,
          errorBuilder: (_, __, ___) => SizedBox(width: 44, height: 44),
        ),
        SizedBox(width: 12),
        Container(width: 1, height: 39, color: DanColors.border2),
        SizedBox(width: 13),
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
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w800,
                  height: 1.1,
                ),
              ),
              SizedBox(height: 2),
              // Trạng thái kết nối realtime THẬT: đứt socket = dữ liệu có thể
              // cũ so với các máy khác — nhân viên phải nhìn thấy ngay.
              ValueListenableBuilder<bool>(
                valueListenable: SocketService().connected,
                builder: (_, online, __) => Row(
                  children: [
                    _Dot(
                        color: online ? DanColors.done : DanColors.late,
                        size: 6),
                    SizedBox(width: 5),
                    Text(
                      online ? t('TRỰC TIẾP') : t('MẤT KẾT NỐI'),
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
  _LiveClock();

  @override
  State<_LiveClock> createState() => _LiveClockState();
}

class _LiveClockState extends State<_LiveClock> {
  Timer? _timer;
  DateTime _now = DateTime.now();

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(Duration(seconds: 1), (_) {
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
      style: TextStyle(
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

  _Dot({required this.color, this.size = 7});

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
      return t('Quản lý');
    case 'cashier':
      return t('Thu ngân');
    case 'kitchen':
      return t('Bếp');
    case 'warehouse':
      return 'Kho';
    default:
      return role;
  }
}
