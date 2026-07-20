import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../providers/customer_display_controller.dart';
import '../../ui/app_theme.dart';
import 'customer_display_screen.dart';
import '../../utils/translation.dart';

/// In-app fullscreen customer display — the cashier opens this and drags the
/// window onto monitor 2. It watches [CustomerDisplayController], so ads / the
/// live order / the payment QR all update in real time. (The auto-placed 2nd
/// window via desktop_multi_window is a later, native step.)
class CustomerDisplayRoute extends StatelessWidget {
  CustomerDisplayRoute({super.key});

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: (_, event) {
        if (event is KeyDownEvent &&
            event.logicalKey == LogicalKeyboardKey.escape) {
          Navigator.of(context).maybePop();
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      },
      child: Stack(
        children: [
          Consumer<CustomerDisplayController>(
            builder: (_, ctrl, __) =>
                CustomerDisplayScreen(data: ctrl.data, ads: ctrl.ads),
          ),
          // Subtle exit affordance for staff (customer ignores it). Esc also works.
          Positioned(
            top: 6,
            right: 6,
            child: Opacity(
              opacity: 0.35,
              child: IconButton(
                tooltip: t('Đóng (Esc)'),
                icon: Icon(Icons.close, color: DanColors.muted),
                onPressed: () => Navigator.of(context).maybePop(),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
