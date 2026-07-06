import 'package:flutter/material.dart';
import '../ui/app_theme.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: DanColors.surface,
                borderRadius: BorderRadius.circular(DanRadius.lg),
                border: Border.all(color: DanColors.border),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.03),
                    blurRadius: 15,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Image.asset(
                    'assets/web/assets/DanOnLogo.png',
                    width: 140,
                    height: 140,
                    fit: BoxFit.contain,
                    errorBuilder: (_, __, ___) => const Icon(
                      Icons.store_outlined,
                      size: 140,
                      color: DanColors.brand,
                    ),
                  ),
                  const SizedBox(height: 24),
                  const SizedBox(
                    width: 120,
                    child: LinearProgressIndicator(
                      backgroundColor: DanColors.surface3,
                      valueColor: AlwaysStoppedAnimation<Color>(DanColors.brand),
                      minHeight: 4,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            const Text(
              'Dan D Pak POS',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w900,
                color: DanColors.text,
                letterSpacing: 0.5,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Đang khởi động hệ thống...',
              style: TextStyle(
                fontSize: 13,
                color: DanColors.muted,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
