import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../providers/customer_display_controller.dart';
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

  /// Ghi mỗi ảnh data-URL ra 1 file tạm (đặt tên theo hash nội dung để tái dùng)
  /// và trả về ads với danh sách images = đường dẫn file. Ảnh http giữ nguyên.
  Future<Map<String, dynamic>> _materializeAds(CustomerAdConfig ads) async {
    final dir = Directory('${Directory.systemTemp.path}/dandpak_ads');
    try {
      dir.createSync(recursive: true);
    } catch (_) {}
    final out = <String>[];
    for (final img in ads.images) {
      if (img.startsWith('data:image/')) {
        try {
          final comma = img.indexOf(',');
          final bytes = base64Decode(comma >= 0 ? img.substring(comma + 1) : img);
          final name = 'ad_${img.hashCode & 0x7fffffff}.img';
          final f = File('${dir.path}/$name');
          if (!f.existsSync() || f.lengthSync() != bytes.length) {
            f.writeAsBytesSync(bytes);
          }
          out.add(f.path);
        } catch (_) {
          // ảnh hỏng → bỏ qua, không để làm sập
        }
      } else if (img.isNotEmpty) {
        out.add(img); // http/url giữ nguyên
      }
    }
    return {'images': out, 'secondsPerImage': ads.secondsPerImage};
  }

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
      home: CustomerDisplayScreen(data: _data, ads: _ads),
    );
  }
}
