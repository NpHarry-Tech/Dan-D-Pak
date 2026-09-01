import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../services/system_log.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';

const _retailBarcodeFormats = <BarcodeFormat>[
  BarcodeFormat.ean13,
  BarcodeFormat.ean8,
  BarcodeFormat.upcA,
  BarcodeFormat.upcE,
  BarcodeFormat.code128,
  BarcodeFormat.code39,
];

@visibleForTesting
MobileScannerController createRetailBarcodeController() =>
    MobileScannerController(
      autoStart: true,
      detectionSpeed: DetectionSpeed.normal,
      // Default 250ms chỉ phân tích khoảng 4 frame/giây. 120ms vẫn giữ
      // throttling bảo vệ máy yếu nhưng phản hồi nhanh hơn rõ rệt khi người dùng
      // vừa đưa mã vào nét hoặc camera đang tự lấy nét lại.
      detectionTimeoutMs: 120,
      facing: CameraFacing.back,
      formats: _retailBarcodeFormats,
      returnImage: false,
    );

@visibleForTesting
bool isUsableRetailBarcode(BarcodeFormat format, String? rawValue) {
  if (!_retailBarcodeFormats.contains(format)) return false;
  return (rawValue?.trim().length ?? 0) >= 6;
}

/// Mở trình quét mã vạch bán lẻ bằng camera và trả về chuỗi mã quét được, hoặc
/// null nếu người dùng thoát. CHỈ gọi trên tablet/điện thoại (xem
/// [kCameraScanSupported]); desktop dùng máy quét USB (gõ thẳng vào ô tìm).
Future<String?> scanBarcode(BuildContext context, {String? title}) {
  return Navigator.of(context).push<String>(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => _BarcodeScannerScreen(title: title ?? t('Quét mã vạch')),
    ),
  );
}

class _BarcodeScannerScreen extends StatefulWidget {
  final String title;
  _BarcodeScannerScreen({required this.title});

  @override
  State<_BarcodeScannerScreen> createState() => _BarcodeScannerScreenState();
}

class _BarcodeScannerScreenState extends State<_BarcodeScannerScreen> {
  // Chỉ nhận các định dạng mã vạch hay gặp trong bán lẻ/kho → ML Kit khỏi dò
  // thừa nên NHANH và ÍT nhận nhầm hơn.
  // KHÔNG ép cameraResolution: để plugin tự chọn độ phân giải hợp lệ theo máy
  // (ép 1080p làm CameraX bind lỗi NPE trên một số máy Samsung).
  final MobileScannerController _controller = createRetailBarcodeController();
  // Không dùng `noDuplicates`: nếu frame đầu là một mảnh chưa hợp lệ, scanner
  // phải phát lại mã đó khi camera lấy nét. `_handled` vẫn chặn pop hai lần.

  bool _handled = false;
  bool _errorLogged = false;
  // Camera/scanner lỗi → app KHÔNG chết (errorBuilder hiện màn lỗi nghiệp vụ)
  // nhưng phải ghi nhật ký để biết máy nào camera hỏng/bị chặn quyền.
  Widget _buildError(BuildContext context, MobileScannerException error) {
    if (!_errorLogged) {
      _errorLogged = true;
      SystemLog.log(
        level: 'warn',
        source: 'flutter_app',
        eventType: 'scanner_error',
        title: t('Camera quét mã lỗi (${error.errorCode.name})'),
        message: error.errorDetails?.message ?? error.toString(),
        action: 'barcode_scan',
        exceptionType: 'MobileScannerException',
      );
    }
    return _ScannerError(error: error, onRetry: _retry, onClose: _close);
  }

  Future<void> _retry() async {
    if (!mounted) return;
    setState(() => _errorLogged = false);
    // start() requests/binds the camera again and clears the controller error
    // on success. stop() is harmless when initialization never completed.
    await _controller.stop();
    await _controller.start();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_handled || !mounted) return;
    for (final b in capture.barcodes) {
      // Chốt an toàn: dù đã giới hạn format, vẫn BỎ QUA mã 2D (QR/DataMatrix…) và
      // mã quá ngắn — tránh nhận nhầm QR hay mảnh mã lỗi.
      final code = b.rawValue?.trim();
      if (isUsableRetailBarcode(b.format, code)) {
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
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    // Mã vạch bán lẻ là dải ngang dài. Khung chữ nhật rộng giúp ML Kit nhận đủ
    // hai mép mã và vẫn hoạt động đúng ở cả tablet landscape lẫn phone portrait.
    final width = (size.width * 0.88).clamp(260.0, 760.0);
    final height = (size.height * 0.42).clamp(180.0, 360.0);
    final window = Rect.fromCenter(
      center: Offset(size.width / 2, size.height / 2),
      width: width,
      height: height,
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
            scanWindowUpdateThreshold: 4,
            fit: BoxFit.cover,
            errorBuilder: (context, error, child) =>
                _buildError(context, error),
            placeholderBuilder: (context, child) =>
                ColoredBox(color: Colors.black),
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
              padding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: Row(
                children: [
                  _RoundIconButton(
                    icon: Icons.close,
                    onTap: _close,
                  ),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      widget.title,
                      style: TextStyle(
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
                      final hasTorch =
                          state.torchState != TorchState.unavailable;
                      if (!hasTorch) return SizedBox.shrink();
                      return _RoundIconButton(
                        icon: on ? Icons.flash_on : Icons.flash_off,
                        active: on,
                        onTap: () => _controller.toggleTorch(),
                      );
                    },
                  ),
                  SizedBox(width: 6),
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
            child: Center(
              child: Text(
                t('Đưa mã vạch vào khung để quét'),
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
  _RoundIconButton({
    required this.icon,
    required this.onTap,
    this.active = false,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: active ? DanColors.brand : Colors.black45,
      shape: CircleBorder(),
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
  _ViewfinderPainter(this.window);

  @override
  void paint(Canvas canvas, Size size) {
    final scrim = Paint()..color = Colors.black.withValues(alpha: .55);
    final rrect = RRect.fromRectAndRadius(window, Radius.circular(18));
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
  _CornerBrackets({required this.rect});

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
    final len = 28.0;
    final w = size.width, h = size.height;
    // Trên-trái
    canvas.drawLine(Offset(0, 0), Offset(len, 0), p);
    canvas.drawLine(Offset(0, 0), Offset(0, len), p);
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
  final Future<void> Function() onRetry;
  final VoidCallback onClose;
  _ScannerError({
    required this.error,
    required this.onRetry,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    final denied = error.errorCode == MobileScannerErrorCode.permissionDenied;
    return Container(
      color: Colors.black,
      alignment: Alignment.center,
      padding: EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(denied ? Icons.no_photography_outlined : Icons.error_outline,
              color: Colors.white70, size: 54),
          SizedBox(height: 16),
          Text(
            denied
                ? t('Ứng dụng chưa được cấp quyền camera.\nVào Cài đặt → Ứng dụng → cấp quyền Camera rồi thử lại.')
                : t('Không mở được camera để quét.'),
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white, fontSize: 14, height: 1.5),
          ),
          SizedBox(height: 22),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              OutlinedButton(onPressed: onClose, child: Text(t('Đóng'))),
              SizedBox(width: 10),
              FilledButton.icon(
                onPressed: onRetry,
                icon: Icon(Icons.refresh),
                label: Text(t('Thử lại')),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
