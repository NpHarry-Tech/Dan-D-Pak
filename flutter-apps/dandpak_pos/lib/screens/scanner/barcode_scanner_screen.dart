import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../ui/app_theme.dart';

/// Mở trình quét mã vạch/QR bằng camera và trả về chuỗi mã quét được, hoặc
/// null nếu người dùng thoát. CHỈ gọi trên tablet/điện thoại (xem
/// [kCameraScanSupported]); desktop dùng máy quét USB (gõ thẳng vào ô tìm).
Future<String?> scanBarcode(BuildContext context, {String? title}) {
  return Navigator.of(context).push<String>(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => _BarcodeScannerScreen(title: title ?? 'Quét mã vạch'),
    ),
  );
}

class _BarcodeScannerScreen extends StatefulWidget {
  final String title;
  const _BarcodeScannerScreen({required this.title});

  @override
  State<_BarcodeScannerScreen> createState() => _BarcodeScannerScreenState();
}

class _BarcodeScannerScreenState extends State<_BarcodeScannerScreen> {
  // Chỉ nhận các định dạng mã vạch hay gặp trong bán lẻ/kho → ML Kit khỏi dò
  // thừa nên NHANH và ÍT nhận nhầm hơn. noDuplicates để không bắn lặp một mã.
  // KHÔNG ép cameraResolution: để plugin tự chọn độ phân giải hợp lệ theo máy
  // (ép 1080p làm CameraX bind lỗi NPE trên một số máy Samsung).
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    // Camera SAU (không gương). Camera trước mới bị lật gương — ép back để
    // hình quét đúng chiều, không soi gương trên tablet.
    facing: CameraFacing.back,
    formats: const [
      BarcodeFormat.ean13,
      BarcodeFormat.ean8,
      BarcodeFormat.upcA,
      BarcodeFormat.upcE,
      BarcodeFormat.code128,
      BarcodeFormat.code39,
      BarcodeFormat.code93,
      BarcodeFormat.itf,
      BarcodeFormat.codabar,
      BarcodeFormat.qrCode,
      BarcodeFormat.dataMatrix,
    ],
  );

  bool _handled = false;

  @override
  void initState() {
    super.initState();
    // App khoá landscape (manifest sensorLandscape). Ở landscape, mobile_scanner
    // trên nhiều máy Samsung render hình camera XOAY 90° (mã vạch nằm ngang →
    // không đọc được / hình bị lệch). ÉP màn quét về DỌC (portrait) — đúng chiều
    // tự nhiên của cảm biến camera → hình thẳng, quét chuẩn. Người dùng cầm máy
    // dọc để quét (tự nhiên). Khôi phục landscape khi thoát.
    SystemChrome.setPreferredOrientations(const [DeviceOrientation.portraitUp]);
  }

  void _onDetect(BarcodeCapture capture) {
    if (_handled || !mounted) return;
    for (final b in capture.barcodes) {
      final code = b.rawValue?.trim();
      if (code != null && code.isNotEmpty) {
        _handled = true;
        HapticFeedback.mediumImpact();
        Navigator.of(context).pop(code);
        return;
      }
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    // Trả app về khoá landscape như cũ khi rời màn quét.
    SystemChrome.setPreferredOrientations(const [
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    // Khung ngắm vuông ở giữa; quét trong khung này cho nhanh và có chủ đích.
    final side = (size.shortestSide * 0.72).clamp(220.0, 460.0);
    final window = Rect.fromCenter(
      center: Offset(size.width / 2, size.height / 2),
      width: side,
      height: side,
    );

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
            scanWindow: window,
            fit: BoxFit.cover,
            errorBuilder: (context, error, child) =>
                _ScannerError(error: error, onClose: _close),
            placeholderBuilder: (context, child) =>
                const ColoredBox(color: Colors.black),
          ),
          // Lớp phủ tối + ô khoét sáng giữa màn.
          CustomPaint(
            size: Size.infinite,
            painter: _ViewfinderPainter(window),
          ),
          _CornerBrackets(rect: window),
          // Thanh trên: đóng · đèn pin · đổi camera.
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: Row(
                children: [
                  _RoundIconButton(
                    icon: Icons.close,
                    onTap: _close,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      widget.title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  ValueListenableBuilder<MobileScannerState>(
                    valueListenable: _controller,
                    builder: (context, state, _) {
                      final on = state.torchState == TorchState.on;
                      final hasTorch = state.torchState != TorchState.unavailable;
                      if (!hasTorch) return const SizedBox.shrink();
                      return _RoundIconButton(
                        icon: on ? Icons.flash_on : Icons.flash_off,
                        active: on,
                        onTap: () => _controller.toggleTorch(),
                      );
                    },
                  ),
                  const SizedBox(width: 6),
                  _RoundIconButton(
                    icon: Icons.cameraswitch_outlined,
                    onTap: () => _controller.switchCamera(),
                  ),
                ],
              ),
            ),
          ),
          // Hướng dẫn dưới khung.
          Positioned(
            left: 0,
            right: 0,
            top: window.bottom + 24,
            child: const Center(
              child: Text(
                'Đưa mã vạch / QR vào khung để quét',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 13.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _close() {
    if (!mounted) return;
    Navigator.of(context).pop();
  }
}

class _RoundIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  final bool active;
  const _RoundIconButton({
    required this.icon,
    required this.onTap,
    this.active = false,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: active ? DanColors.brand : Colors.black45,
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          width: 44,
          height: 44,
          child: Icon(icon, color: Colors.white, size: 22),
        ),
      ),
    );
  }
}

/// Vẽ lớp phủ tối ra ngoài khung ngắm, chừa ô giữa trong suốt.
class _ViewfinderPainter extends CustomPainter {
  final Rect window;
  const _ViewfinderPainter(this.window);

  @override
  void paint(Canvas canvas, Size size) {
    final scrim = Paint()..color = Colors.black.withValues(alpha: .55);
    final rrect =
        RRect.fromRectAndRadius(window, const Radius.circular(18));
    final full = Path()..addRect(Offset.zero & size);
    final hole = Path()..addRRect(rrect);
    final overlay = Path.combine(PathOperation.difference, full, hole);
    canvas.drawPath(overlay, scrim);
  }

  @override
  bool shouldRepaint(covariant _ViewfinderPainter oldDelegate) =>
      oldDelegate.window != window;
}

/// Bốn góc sáng của khung ngắm cho dễ canh mã.
class _CornerBrackets extends StatelessWidget {
  final Rect rect;
  const _CornerBrackets({required this.rect});

  @override
  Widget build(BuildContext context) {
    return Positioned.fromRect(
      rect: rect,
      child: CustomPaint(painter: _BracketPainter()),
    );
  }
}

class _BracketPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = DanColors.brand
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    const len = 28.0;
    final w = size.width, h = size.height;
    // Trên-trái
    canvas.drawLine(const Offset(0, 0), const Offset(len, 0), p);
    canvas.drawLine(const Offset(0, 0), const Offset(0, len), p);
    // Trên-phải
    canvas.drawLine(Offset(w, 0), Offset(w - len, 0), p);
    canvas.drawLine(Offset(w, 0), Offset(w, len), p);
    // Dưới-trái
    canvas.drawLine(Offset(0, h), Offset(len, h), p);
    canvas.drawLine(Offset(0, h), Offset(0, h - len), p);
    // Dưới-phải
    canvas.drawLine(Offset(w, h), Offset(w - len, h), p);
    canvas.drawLine(Offset(w, h), Offset(w, h - len), p);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _ScannerError extends StatelessWidget {
  final MobileScannerException error;
  final VoidCallback onClose;
  const _ScannerError({required this.error, required this.onClose});

  @override
  Widget build(BuildContext context) {
    final denied =
        error.errorCode == MobileScannerErrorCode.permissionDenied;
    return Container(
      color: Colors.black,
      alignment: Alignment.center,
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(denied ? Icons.no_photography_outlined : Icons.error_outline,
              color: Colors.white70, size: 54),
          const SizedBox(height: 16),
          Text(
            denied
                ? 'Ứng dụng chưa được cấp quyền camera.\nVào Cài đặt → Ứng dụng → cấp quyền Camera rồi thử lại.'
                : 'Không mở được camera để quét.',
            textAlign: TextAlign.center,
            style: const TextStyle(
                color: Colors.white, fontSize: 14, height: 1.5),
          ),
          const SizedBox(height: 22),
          FilledButton(onPressed: onClose, child: const Text('Đóng')),
        ],
      ),
    );
  }
}
