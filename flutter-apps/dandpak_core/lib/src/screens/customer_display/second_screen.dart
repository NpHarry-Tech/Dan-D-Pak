import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';

import '../../providers/customer_display_controller.dart';
import '../../services/ad_cache.dart';
import '../../services/black_box.dart';
import '../../services/second_window_fullscreen.dart';
import '../../ui/app_theme.dart';
import 'customer_display_screen.dart';
import '../../utils/translation.dart';

/// Owns an isolated customer-display process. Process isolation keeps a GPU or
/// Flutter renderer failure on weak POS hardware from terminating the POS.
class SecondScreen {
  SecondScreen._();
  static final SecondScreen instance = SecondScreen._();

  static const _port = 47831;
  Process? _process;
  bool _open = false;
  CustomerDisplayController? _ctrl;
  Timer? _pushTimer;
  String _lastAdsJson = '';
  int _pushFailures = 0;
  Future<void>? _opening;

  bool get isOpen => _open;

  Future<void> open(CustomerDisplayController ctrl) async {
    final inFlight = _opening;
    if (inFlight != null) {
      await inFlight;
      return open(ctrl);
    }
    final operation = _openOnce(ctrl);
    _opening = operation;
    try {
      await operation;
    } finally {
      if (identical(_opening, operation)) _opening = null;
    }
  }

  Future<void> _openOnce(CustomerDisplayController ctrl) async {
    if (await _ping()) {
      _open = true;
      if (!identical(_ctrl, ctrl)) {
        _ctrl?.removeListener(_schedulePush);
        _ctrl = ctrl;
        ctrl.addListener(_schedulePush);
        _lastAdsJson = '';
      }
      _push();
      return;
    }
    BlackBox.add('display', 'start isolated process');
    _process = await Process.start(
      Platform.resolvedExecutable,
      const ['--customer-display'],
      mode: ProcessStartMode.normal,
    );
    unawaited(_process!.stdout.drain<void>());
    unawaited(_process!.stderr.drain<void>());
    unawaited(_process!.exitCode.then((code) {
      _open = false;
      BlackBox.add('display', 'isolated process exited code=$code');
    }));
    for (var i = 0; i < 50 && !await _ping(); i++) {
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    if (!await _ping()) throw StateError('Màn hình phụ không khởi động được');
    _open = true;
    BlackBox.add('display', 'isolated process ready pid=${_process?.pid}');
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
    final c = _ctrl;
    if (!_open || c == null) return;
    // Ad images are data-URLs that can be SEVERAL MB. Đẩy nguyên base64 qua
    // Ghi ảnh ra file tạm MỘT LẦN và chỉ gửi
    // ĐƯỜNG DẪN (nhẹ) — cửa sổ phụ đọc thẳng từ đĩa (Image.file). Chỉ gửi lại
    // khối ads khi nó thật sự đổi.
    final adsJson = jsonEncode(c.ads.toJson());
    final payload = <String, dynamic>{'data': c.data.toJson()};
    final includesAds = adsJson != _lastAdsJson;
    if (includesAds) {
      payload['ads'] = await _materializeAds(c.ads);
    }
    try {
      await _request('update', payload);
      if (includesAds) _lastAdsJson = adsJson;
      _pushFailures = 0;
    } catch (_) {
      // createWindow().show() returns before the child Flutter engine has
      // necessarily installed its method handler. That startup race is not a
      // closed window: keep the controller listener and retry briefly.
      if (!_open || _ctrl == null) return;
      _pushFailures++;
      if (_pushFailures >= 10) {
        _detach();
        return;
      }
      _pushTimer?.cancel();
      _pushTimer = Timer(const Duration(milliseconds: 150), _push);
    }
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
    if (forgetWindow) _open = false;
    _lastAdsJson = '';
    _pushFailures = 0;
  }

  Future<void> close() async {
    _detach(forgetWindow: false);
    try {
      await _request('close');
    } catch (_) {
      _process?.kill();
    }
    _process = null;
    _open = false;
  }

  Future<bool> _ping() async {
    try {
      await _request('health');
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> _request(String path, [Object? body]) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 1);
    try {
      final request =
          await client.postUrl(Uri.parse('http://127.0.0.1:$_port/$path'));
      if (body != null) {
        request.headers.contentType = ContentType.json;
        request.write(jsonEncode(body));
      }
      final response =
          await request.close().timeout(const Duration(seconds: 2));
      await response.drain<void>();
      if (response.statusCode != HttpStatus.ok) {
        throw HttpException('Display bridge HTTP ${response.statusCode}');
      }
    } finally {
      client.close(force: true);
    }
  }
}

final class _DisplayBridge {
  CustomerDisplayData data = const CustomerDisplayData();
  CustomerAdConfig ads = const CustomerAdConfig();
  VoidCallback? onUpdate;
}

final _displayBridge = _DisplayBridge();

Future<bool> startCustomerDisplayProcessBridge() async {
  try {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 47831);
    unawaited(server.forEach((request) async {
      try {
        if (request.method != 'POST') {
          request.response.statusCode = HttpStatus.methodNotAllowed;
        } else if (request.uri.path == '/health') {
          request.response.statusCode = HttpStatus.ok;
        } else if (request.uri.path == '/update') {
          if (request.contentLength > 2 * 1024 * 1024) {
            request.response.statusCode = HttpStatus.requestEntityTooLarge;
            await request.response.close();
            return;
          }
          final raw = await utf8.decoder.bind(request).join();
          final m = jsonDecode(raw) as Map<String, dynamic>;
          _displayBridge.data = CustomerDisplayData.fromJson(
              Map<String, dynamic>.from(m['data'] ?? {}));
          if (m['ads'] is Map) {
            _displayBridge.ads = CustomerAdConfig.fromJson(
                Map<String, dynamic>.from(m['ads'] as Map));
          }
          _displayBridge.onUpdate?.call();
        } else if (request.uri.path == '/close') {
          request.response.statusCode = HttpStatus.ok;
          await request.response.close();
          Timer(const Duration(milliseconds: 50), () => exit(0));
          return;
        } else {
          request.response.statusCode = HttpStatus.notFound;
        }
      } catch (_) {
        request.response.statusCode = HttpStatus.badRequest;
      }
      await request.response.close();
    }));
    return true;
  } on SocketException {
    return false;
  }
}

/// Root widget of the isolated secondary-display process.
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
    _displayBridge.onUpdate = () {
      if (!mounted) return;
      setState(() {
        _data = _displayBridge.data;
        _ads = _displayBridge.ads;
      });
    };
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      BlackBox.add('display', 'first-frame rendered');
      if (hasSecondMonitor()) await makeSecondWindowFullscreen();
    });
  }

  @override
  void dispose() {
    _displayBridge.onUpdate = null;
    super.dispose();
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
