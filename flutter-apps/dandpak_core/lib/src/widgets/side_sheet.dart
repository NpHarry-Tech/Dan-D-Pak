import 'package:flutter/material.dart';

import '../ui/app_theme.dart';
import '../utils/translation.dart';

/// Opens a panel that slides in from the LEFT over a dimmed backdrop —
/// iPad-Settings-style deep edit. Replaces centered popup dialogs for
/// settings edit forms. Returns the value the sheet is popped with.
Future<T?> showSideSheet<T>(
  BuildContext context, {
  required WidgetBuilder builder,
  double width = 480,
  Color? backgroundColor,
  double? elevation,
}) {
  return showGeneralDialog<T>(
    context: context,
    barrierDismissible: true,
    barrierLabel: t('Đóng'),
    barrierColor: Colors.black.withValues(alpha: .42),
    transitionDuration: Duration(milliseconds: 240),
    pageBuilder: (ctx, _, __) {
      final maxW = MediaQuery.of(ctx).size.width;
      return Align(
        alignment: Alignment.centerLeft,
        child: SizedBox(
          width: width > maxW ? maxW : width,
          height: double.infinity,
          child: Material(
            color: backgroundColor ?? DanColors.surface,
            elevation: elevation ?? 16,
            child: builder(ctx),
          ),
        ),
      );
    },
    transitionBuilder: (ctx, anim, _, child) {
      final curved = CurvedAnimation(parent: anim, curve: Curves.easeOutCubic);
      return SlideTransition(
        position: Tween<Offset>(begin: Offset(-1, 0), end: Offset.zero)
            .animate(curved),
        child: child,
      );
    },
  );
}

/// Standard chrome for a [showSideSheet] panel: header (title + close),
/// scrollable body, and a pinned footer with actions.
class SideSheetScaffold extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Widget child;
  final List<Widget> actions;
  final Widget? leadingFooter;

  SideSheetScaffold({
    super.key,
    required this.title,
    this.subtitle,
    required this.child,
    this.actions = const [],
    this.leadingFooter,
  });

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(20, 18, 10, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title,
                          style: TextStyle(
                              fontSize: 20, fontWeight: FontWeight.w900)),
                      if (subtitle != null && subtitle!.isNotEmpty) ...[
                        SizedBox(height: 2),
                        Text(subtitle!,
                            style: TextStyle(
                                fontSize: 12.5, color: DanColors.muted)),
                      ],
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).maybePop(),
                  icon: Icon(Icons.close),
                  splashRadius: 20,
                ),
              ],
            ),
          ),
          Divider(height: 1, color: DanColors.border),
          Expanded(
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(20, 18, 20, 18),
              child: child,
            ),
          ),
          if (actions.isNotEmpty || leadingFooter != null) ...[
            Divider(height: 1, color: DanColors.border),
            Padding(
              padding: EdgeInsets.all(14),
              child: Row(
                children: [
                  if (leadingFooter != null) leadingFooter!,
                  Spacer(),
                  ...actions.expand((w) => [w, SizedBox(width: 8)]),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
