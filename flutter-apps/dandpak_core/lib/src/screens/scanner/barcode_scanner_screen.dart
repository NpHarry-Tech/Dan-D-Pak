import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../services/system_log.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';

/// Mở trình quét mã vạch/QR bằng camera và trả về chuỗi mã quét được, hoặc
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
  // thừa nên NHANH và ÍT nhận nhầm hơn. noDuplicates để không bắn lặp một mã.
  // KHÔNG ép cameraResolution: để plugin tự chọn độ phân giải hợp lệ theo máy
  // (ép 1080p làm CameraX bind lỗi NPE trên một số máy Samsung).
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    // Camera SAU (không gương). Camera trước mới bị lật gương — ép back để
    // hình quét đúng chiều, không soi gương trên tablet.
    facing: CameraFacing.back,
    formats: [
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
  bool _errorLogged = false;
  // FIX "quét xoay mãi": nhiều tablet khoá landscape ở manifest nên yêu cầu xoay
  // portrait KHÔNG có hiệu lực → MediaQuery.orientation mãi không phải portrait →
  // camera không bao giờ mount, vòng xoay quay vô tận. Sau tối đa 900ms mà chưa
  // portrait thì MOUNT camera luôn (thà preview hơi lệch còn hơn treo cứng).
  bool _forceMount = false;

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
    return _ScannerError(error: error, onClose: _close);
  }

  @override
  void initState() {
    super.initState();
    // App khoá landscape (manifest sensorLandscape). Ở landscape, mobile_scanner
    // trên nhiều máy Samsung render hình camera XOAY 90° (mã vạch nằm ngang →
    // không đọc được / hình bị lệch). ÉP màn quét về DỌC (portrait) — đúng chiều
    // tự nhiên của cảm biến camera → hình thẳng, quét chuẩn. Người dùng cầm máy
    // dọc để quét (tự nhiên). Khôi phục landscape khi thoát.
    SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
    // Chốt an toàn: nếu máy không xoay được sang portrait (bị khoá landscape), sau
    // 900ms vẫn mount camera để không treo màn quét.
    Future.delayed(const Duration(milliseconds: 900), () {
      if (mounted && !_forceMount) setState(() => _forceMount = true);
    });
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
    SystemChrome.setPreferredOrientations([
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

    // CHỜ MÀN XOAY DỌC XONG rồi mới mount camera: initState ép portrait nhưng
    // Android xoay activity mất vài frame — nếu MobileScanner khởi tạo NGAY
    // khi còn landscape, CameraX bind với rotation ngang và trên nhiều máy
    // Samsung KHÔNG cập nhật lại sau khi xoay → hình camera nằm ngang vĩnh
    // viễn. Đợi MediaQuery báo portrait (build chạy lại tự nhiên khi xoay)
    // thì camera bind đúng chiều ngay từ đầu.
    final isPortrait =
        MediaQuery.orientationOf(context) == Orientation.portrait;

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          if (isPortrait || _forceMount)
            MobileScanner(
              controller: _controller,
              onDetect: _onDetect,
              scanWindow: window,
              fit: BoxFit.cover,
              errorBuilder: (context, error, child) =>
                  _buildError(context, error),
              placeholderBuilder: (context, child) =>
                  ColoredBox(color: Colors.black),
            )
          else
            Center(
              child: CircularProgressIndicator(color: Colors.white54),
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
                t('Đưa mã vạch / QR vào khung để quét'),
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
  final VoidCallback onClose;
  _ScannerError({required this.error, required this.onClose});

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
          FilledButton(onPressed: onClose, child: Text(t('Đóng'))),
        ],
      ),
    );
  }
}
