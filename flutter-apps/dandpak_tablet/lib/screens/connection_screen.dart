// lib/screens/connection_screen.dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_provider.dart';
import 'login_screen.dart';

class ConnectionScreen extends StatefulWidget {
  const ConnectionScreen({super.key});

  @override
  State<ConnectionScreen> createState() => _ConnectionScreenState();
}

class _ConnectionScreenState extends State<ConnectionScreen> {
  final _urlController = TextEditingController();
  bool _testing = false;
  String? _statusMessage;
  bool _isSuccess = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _urlController.text = Provider.of<AppProvider>(context, listen: false).serverUrl;
    });
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _testConnection() async {
    setState(() {
      _testing = true;
      _statusMessage = null;
      _isSuccess = false;
    });

    final appProv = Provider.of<AppProvider>(context, listen: false);
    await appProv.saveServerUrl(_urlController.text);
    final ok = await appProv.testConnection();

    setState(() {
      _testing = false;
      if (ok) {
        _isSuccess = true;
        _statusMessage = 'Kết nối thành công! Đang chuyển hướng...';
        Future.delayed(const Duration(seconds: 1), () {
          if (mounted) {
            Navigator.of(context).pushReplacement(
              MaterialPageRoute(builder: (_) => const LoginScreen()),
            );
          }
        });
      } else {
        _isSuccess = false;
        _statusMessage = 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra lại IP/Cổng.';
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final appProv = Provider.of<AppProvider>(context);

    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FA),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Container(
              padding: const EdgeInsets.all(32),
              decoration: BoxDecoration(
                color: const Color(0xFFFFFFFF),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFFE7EAEE)),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x0F102840),
                    blurRadius: 24,
                    offset: Offset(0, 8),
                  )
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Image.asset(
                    'assets/DanOnLogo.png',
                    width: 360,
                    height: 140,
                    fit: BoxFit.contain,
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'KẾT NỐI MÁY CHỦ POS',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFF0891B2),
                      letterSpacing: 1.5,
                    ),
                  ),
                  const SizedBox(height: 28),
                  TextField(
                    controller: _urlController,
                    style: const TextStyle(color: Color(0xFF1A2230), fontFamily: 'monospace'),
                    decoration: const InputDecoration(
                      labelText: 'Địa chỉ máy chủ POS (URL)',
                      labelStyle: TextStyle(color: Color(0xFF677084)),
                      hintText: 'http://192.168.1.10:3000',
                      hintStyle: TextStyle(color: Color(0xFF9AA3B2)),
                      prefixIcon: Icon(Icons.computer, color: Color(0xFF677084)),
                      enabledBorder: UnderlineInputBorder(
                        borderSide: BorderSide(color: Color(0xFFE7EAEE)),
                      ),
                      focusedBorder: UnderlineInputBorder(
                        borderSide: BorderSide(color: Color(0xFF0891B2)),
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  if (appProv.isScanning) ...[
                    LinearProgressIndicator(
                      backgroundColor: const Color(0xFFF3F5F7),
                      valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF0891B2)),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      appProv.scanProgressText,
                      style: const TextStyle(color: Color(0xFF677084), fontSize: 13, fontStyle: FontStyle.italic),
                      textAlign: TextAlign.center,
                    ),
                  ] else ...[
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              foregroundColor: const Color(0xFF0891B2),
                              side: const BorderSide(color: Color(0xFFD3D8DF)),
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                            onPressed: appProv.startAutoDiscovery,
                            icon: const Icon(Icons.search, color: Color(0xFF0891B2)),
                            label: const Text('Tự động quét', style: TextStyle(fontWeight: FontWeight.bold)),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: FilledButton(
                            style: FilledButton.styleFrom(
                              backgroundColor: const Color(0xFF0891B2),
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                            onPressed: _testing ? null : _testConnection,
                            child: _testing
                                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                : const Text('Kết nối', style: TextStyle(fontWeight: FontWeight.bold)),
                          ),
                        ),
                      ],
                    ),
                  ],
                  if (_statusMessage != null) ...[
                    const SizedBox(height: 20),
                    Text(
                      _statusMessage!,
                      style: TextStyle(
                        color: _isSuccess ? const Color(0xFF49D17F) : const Color(0xFFFF7A7A),
                        fontWeight: FontWeight.w600,
                        fontSize: 13.5,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
