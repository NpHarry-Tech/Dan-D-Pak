import 'dart:async';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// iPad Self-order — chế độ KHÁCH tự gọi món trên tablet đặt tại bàn.
///
/// Bê NGUYÊN màn /ipad của web (đã chạy ổn định, đủ ảnh món, giỏ hàng, gọi
/// nhân viên, chờ xác nhận) vào một WebView toàn màn hình — không viết lại
/// UI mới, mọi cải tiến trên /ipad tự có mặt ở đây.
///
/// Kiosk: khách không có nút thoát. Nhân viên thoát bằng cách chạm 5 lần
/// liên tiếp vào góc trên-trái trong vòng 3 giây.
class SelfOrderScreen extends StatefulWidget {
  final String serverUrl;
  const SelfOrderScreen({super.key, required this.serverUrl});

  @override
  State<SelfOrderScreen> createState() => _SelfOrderScreenState();
}

class _SelfOrderScreenState extends State<SelfOrderScreen> {
  late final WebViewController _controller;
  int _exitTaps = 0;
  Timer? _exitWindow;
  bool _loading = true;
  String? _error;

  String get _ipadUrl {
    final root = widget.serverUrl.replaceAll(RegExp(r'/+$'), '');
    return '$root/ipad';
  }

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..setNavigationDelegate(NavigationDelegate(
        onPageFinished: (_) {
          if (mounted) setState(() => _loading = false);
        },
        onWebResourceError: (e) {
          if (mounted && e.isForMainFrame == true) {
            setState(() {
              _loading = false;
              _error = e.description;
            });
          }
        },
      ))
      ..loadRequest(Uri.parse(_ipadUrl));
  }

  @override
  void dispose() {
    _exitWindow?.cancel();
    super.dispose();
  }

  void _cornerTap() {
    _exitTaps++;
    _exitWindow ??= Timer(const Duration(seconds: 3), () {
      _exitTaps = 0;
      _exitWindow = null;
    });
    if (_exitTaps >= 5) {
      _exitWindow?.cancel();
      _exitWindow = null;
      _exitTaps = 0;
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Stack(
        children: [
          Positioned.fill(child: WebViewWidget(controller: _controller)),
          if (_loading)
            const Positioned.fill(
              child: ColoredBox(
                color: Colors.white,
                child: Center(child: CircularProgressIndicator()),
              ),
            ),
          if (_error != null)
            Positioned.fill(
              child: ColoredBox(
                color: Colors.white,
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('Không mở được màn tự gọi món\n$_error',
                          textAlign: TextAlign.center),
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: () {
                          setState(() {
                            _error = null;
                            _loading = true;
                          });
                          _controller.loadRequest(Uri.parse(_ipadUrl));
                        },
                        child: const Text('Thử lại'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          // Vùng thoát ẩn cho nhân viên (5 chạm / 3 giây, góc trên-trái).
          Positioned(
            top: 0,
            left: 0,
            width: 72,
            height: 72,
            child: GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: _cornerTap,
            ),
          ),
        ],
      ),
    );
  }
}
