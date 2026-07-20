import 'dart:async';
import 'dart:convert';

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../providers/customer_display_controller.dart';
import '../../services/ad_cache.dart';
import '../../services/black_box.dart';
import '../../services/second_window_fullscreen.dart';
import '../../ui/app_theme.dart';
import 'customer_display_screen.dart';
import '../../utils/translation.dart';

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
    final existingId = _windowId;
    if (existingId != null) {
      if (!identical(_ctrl, ctrl)) {
        _ctrl?.removeListener(_schedulePush);
        _ctrl = ctrl;
        ctrl.addListener(_schedulePush);
        _lastAdsJson = '';
      }
      await WindowController.fromWindowId(existingId).show();
      _push();
      return;
    }
    final window = await DesktopMultiWindow.createWindow(
        jsonEncode({'route': 'customer_display'}));
    _windowId = window.windowId;
    await window.setFrame(Offset(160, 120) & Size(1024, 768));
    await window.setTitle(t('Màn hình phụ'));
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
    _pushTimer = Timer(Duration(milliseconds: 30), _push);
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

  void _detach({bool forgetWindow = true}) {
    _pushTimer?.cancel();
    _ctrl?.removeListener(_schedulePush);
    _ctrl = null;
    if (forgetWindow) _windowId = null;
    _lastAdsJson = '';
  }

  Future<void> close() async {
    final id = _windowId;
    _detach(forgetWindow: false);
    if (id != null) {
      try {
        // desktop_multi_window 0.2.1 destroys its Flutter engine from inside
        // WM_DESTROY; toggling the setting then caused a native use-after-free.
        // Keep the one secondary engine alive and only change its visibility.
        await WindowController.fromWindowId(id).hide();
      } catch (_) {
        _windowId = null;
      }
    }
  }
}

/// Root widget of the secondary display window. Receives display data over the
/// plugin channel and paints the shared customer display.
class CustomerDisplayWindowApp extends StatefulWidget {
  CustomerDisplayWindowApp({super.key});

  @override
  State<CustomerDisplayWindowApp> createState() =>
      _CustomerDisplayWindowAppState();
}

class _CustomerDisplayWindowAppState extends State<CustomerDisplayWindowApp> {
  CustomerDisplayData _data = CustomerDisplayData();
  CustomerAdConfig _ads = CustomerAdConfig();

  @override
  void initState() {
    super.initState();
    DesktopMultiWindow.setMethodHandler(
        (MethodCall call, int fromWindowId) async {
      if (call.method == 'update') {
        try {
          final m =
              jsonDecode(call.arguments as String) as Map<String, dynamic>;
          if (!mounted) return;
          setState(() {
            _data = CustomerDisplayData.fromJson(
                Map<String, dynamic>.from(m['data'] ?? {}));
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
      title: t('Màn hình phụ'),
      theme: DanTheme.light(),
      home: Stack(
        children: [
          CustomerDisplayScreen(data: _data, ads: _ads),
          // Vùng kéo ẩn trên cùng: đè chuột + kéo để di chuyển cửa sổ,
          // nhấp đúp để bật/tắt toàn màn hình. Bình thường trong suốt
          // (khách không thấy), rê chuột vào mới hiện gợi ý mờ cho nhân viên.
          Positioned(
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
/// Cài đặt → Màn hình phụ → t("Cách sử dụng") (settings_customer_display_panel).
class _HiddenDragBar extends StatefulWidget {
  _HiddenDragBar();

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
          duration: Duration(milliseconds: 150),
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
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.drag_indicator, size: 16, color: Colors.white70),
                SizedBox(width: 6),
                Text(
                  t('Kéo để di chuyển  •  Nhấp đúp để phóng to / thu nhỏ'),
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
