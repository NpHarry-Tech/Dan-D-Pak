import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../providers/customer_display_controller.dart';
import '../../services/ad_cache.dart';
import '../../services/black_box.dart';
import '../../services/second_window_fullscreen.dart';
import '../../ui/app_theme.dart';
import 'customer_display_screen.dart';

/// Owns the secondary display window on the 2nd monitor. Opened via
/// desktop_multi_window; the main window streams [CustomerDisplayData] to it
/// over the plugin's own method channel (no server relay), and it renders the
/// shared [CustomerDisplayScreen].
class SecondScreen {
  SecondScreen._();
  static final SecondScreen instance = SecondScreen._();

  int? _windowId;
  CustomerDisplayController? _ctrl;
  Timer? _pushTimer;
  String _lastAdsJson = '';

  bool get isOpen => _windowId != null;

  Future<void> open(CustomerDisplayController ctrl) async {
    if (_windowId != null) {
      _ctrl = ctrl;
      _push();
      return;
    }
    final window = await DesktopMultiWindow.createWindow(
        jsonEncode({'route': 'customer_display'}));
    _windowId = window.windowId;
    await window.setFrame(const Offset(160, 120) & const Size(1024, 768));
    await window.setTitle('Màn hình phụ');
    await window.show();
    // Kiosk toàn màn hình CHỈ khi máy thật sự có màn hình thứ 2 — trên máy
    // 1 màn hình thì giữ cửa sổ thường 1024x768 để xem trước, không để
    // kiosk TOPMOST chiếm mất màn POS đang bán hàng.
    if (hasSecondMonitor()) {
      unawaited(makeSecondWindowFullscreen());
    }
    _ctrl = ctrl;
    _lastAdsJson = '';
    ctrl.addListener(_schedulePush);
    _push();
  }

  /// Coalesce bursts of controller notifications (each cart tap can notify
  /// several times) into a single channel push per ~30ms window.
  void _schedulePush() {
    if (_pushTimer?.isActive == true) return;
    _pushTimer = Timer(const Duration(milliseconds: 30), _push);
  }

  Future<void> _push() async {
    final id = _windowId;
    final c = _ctrl;
    if (id == null || c == null) return;
    // Ad images are data-URLs that can be SEVERAL MB. Đẩy nguyên base64 qua
    // method channel của desktop_multi_window làm SẬP app (message quá lớn cho
    // IPC giữa 2 cửa sổ). Thay vào đó ghi ảnh ra file tạm MỘT LẦN và chỉ gửi
    // ĐƯỜNG DẪN (nhẹ) — cửa sổ phụ đọc thẳng từ đĩa (Image.file). Chỉ gửi lại
    // khối ads khi nó thật sự đổi.
    final adsJson = jsonEncode(c.ads.toJson());
    final payload = <String, dynamic>{'data': c.data.toJson()};
    if (adsJson != _lastAdsJson) {
      payload['ads'] = await _materializeAds(c.ads);
      _lastAdsJson = adsJson;
    }
    // Fire-and-forget; if the window was closed by the user this just no-ops.
    DesktopMultiWindow.invokeMethod(
      id,
      'update',
      jsonEncode(payload),
    ).catchError((_) => _detach());
  }

  /// Ads gửi sang cửa sổ phụ dưới dạng ĐƯỜNG DẪN file (nhẹ) — xem ad_cache.dart.
  Future<Map<String, dynamic>> _materializeAds(CustomerAdConfig ads) async => {
        'images': await materializeAdSources(ads.images),
        'secondsPerImage': ads.secondsPerImage,
      };

  void _detach() {
    _pushTimer?.cancel();
    _ctrl?.removeListener(_schedulePush);
    _ctrl = null;
    _windowId = null;
    _lastAdsJson = '';
  }

  Future<void> close() async {
    final id = _windowId;
    _detach();
    if (id != null) {
      try {
        await WindowController.fromWindowId(id).close();
      } catch (_) {}
    }
  }
}

/// Root widget of the secondary display window. Receives display data over the
/// plugin channel and paints the shared customer display.
class CustomerDisplayWindowApp extends StatefulWidget {
  const CustomerDisplayWindowApp({super.key});

  @override
  State<CustomerDisplayWindowApp> createState() =>
      _CustomerDisplayWindowAppState();
}

class _CustomerDisplayWindowAppState extends State<CustomerDisplayWindowApp> {
  CustomerDisplayData _data = const CustomerDisplayData();
  CustomerAdConfig _ads = const CustomerAdConfig();

  @override
  void initState() {
    super.initState();
    // Bỏ thanh tiêu đề + 3 nút SAU khi cửa sổ khách đã vẽ xong frame đầu (view
    // sẵn sàng) — làm từ chính engine này nên đổi style không gây crash như khi
    // làm từ tiến trình chính lúc cửa sổ còn đang khởi tạo.
    //
    // CẦU CHÌ chống crash-loop: đặt 1 file cờ TRƯỚC khi bỏ khung, xoá NGAY SAU
    // khi thành công. Nếu bỏ khung lỡ làm sập (native), cờ còn lại → lần mở sau
    // tự bỏ qua bước này → app vẫn dùng được (tệ nhất là còn title bar).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Future.delayed(const Duration(milliseconds: 700), () {
        final lock = File('${Directory.systemTemp.path}/dandpak_borderless.lock');
        try {
          if (lock.existsSync()) return; // lần trước có thể đã sập → bỏ qua
          lock.createSync();
        } catch (_) {}
        makeWindowBorderless();
        try {
          lock.deleteSync();
        } catch (_) {}
      });
    });
    DesktopMultiWindow.setMethodHandler(
        (MethodCall call, int fromWindowId) async {
      if (call.method == 'update') {
        try {
          final m =
              jsonDecode(call.arguments as String) as Map<String, dynamic>;
          if (!mounted) return;
          setState(() {
            _data = CustomerDisplayData.fromJson(
                Map<String, dynamic>.from(m['data'] ?? const {}));
            // 'ads' is only sent when it changes — keep the previous config
            // when the key is absent.
            if (m['ads'] is Map) {
              _ads = CustomerAdConfig.fromJson(
                  Map<String, dynamic>.from(m['ads'] as Map));
            }
          });
        } catch (_) {}
      }
      return null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Màn hình phụ',
      theme: DanTheme.light(),
      home: Stack(
        children: [
          CustomerDisplayScreen(data: _data, ads: _ads),
          // Vùng kéo ẩn trên cùng: đè chuột + kéo để di chuyển cửa sổ,
          // nhấp đúp để bật/tắt toàn màn hình. Bình thường trong suốt
          // (khách không thấy), rê chuột vào mới hiện gợi ý mờ cho nhân viên.
          const Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: 36,
            child: _HiddenDragBar(),
          ),
        ],
      ),
    );
  }
}

/// Thanh kéo ẩn của cửa sổ phụ. Cách dùng được mô tả cho người dùng ngay trong
/// Cài đặt → Màn hình phụ → "Cách sử dụng" (settings_customer_display_panel).
class _HiddenDragBar extends StatefulWidget {
  const _HiddenDragBar();

  @override
  State<_HiddenDragBar> createState() => _HiddenDragBarState();
}

class _HiddenDragBarState extends State<_HiddenDragBar> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque, // vùng trong suốt vẫn nhận chuột
        // Kéo tự vẽ theo con trỏ (không chặn luồng UI — xem service).
        onPanStart: (_) {
          BlackBox.add('display', 'drag-start');
          beginSecondWindowDrag();
        },
        onPanUpdate: (_) => updateSecondWindowDrag(),
        onPanEnd: (_) => endSecondWindowDrag(),
        onPanCancel: endSecondWindowDrag,
        onDoubleTap: () {
          BlackBox.add('display', 'toggle-fullscreen');
          toggleSecondWindowFullscreen();
        },
        child: AnimatedOpacity(
          opacity: _hover ? 1 : 0,
          duration: const Duration(milliseconds: 150),
          child: Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.black.withValues(alpha: 0.45),
                  Colors.black.withValues(alpha: 0),
                ],
              ),
            ),
            alignment: Alignment.center,
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.drag_indicator, size: 16, color: Colors.white70),
                SizedBox(width: 6),
                Text(
                  'Kéo để di chuyển  •  Nhấp đúp để phóng to / thu nhỏ',
                  style: TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
