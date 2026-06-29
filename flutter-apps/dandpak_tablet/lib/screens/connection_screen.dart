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
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF0F141C), Color(0xFF1E2633)],
          ),
        ),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Card(
              color: const Color(0xFF161D26),
              elevation: 8,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 30, vertical: 40),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: const Color(0xFF2F7D6B).withOpacity(0.15),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Icon(Icons.wifi_tethering, size: 36, color: Color(0xFF2F7D6B)),
                        ),
                        const SizedBox(width: 14),
                        const Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'DAN D PAK',
                              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: 1.5, color: Colors.white),
                            ),
                            Text(
                              'Kết nối máy chủ POS',
                              style: TextStyle(fontSize: 13, color: Colors.white54, fontWeight: FontWeight.w500),
                            ),
                          ],
                        )
                      ],
                    ),
                    const SizedBox(height: 32),
                    TextField(
                      controller: _urlController,
                      style: const TextStyle(color: Colors.white, fontFamily: 'monospace'),
                      decoration: InputDecoration(
                        labelText: 'Địa chỉ máy chủ POS (URL)',
                        labelStyle: const TextStyle(color: Colors.white70),
                        hintText: 'http://192.168.1.10:3000',
                        hintStyle: const TextStyle(color: Colors.white30),
                        prefixIcon: const Icon(Icons.computer, color: Colors.white54),
                        filled: true,
                        fillColor: const Color(0xFF0F151D),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(color: Color(0xFF2F7D6B), width: 1.5),
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),
                    if (appProv.isScanning) ...[
                      LinearProgressIndicator(
                        backgroundColor: const Color(0xFF0F151D),
                        valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF2F7D6B)),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        appProv.scanProgressText,
                        style: const TextStyle(color: Colors.white70, fontSize: 13, fontStyle: FontStyle.italic),
                        textAlign: TextAlign.center,
                      ),
                    ] else ...[
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              style: OutlinedButton.styleFrom(
                                side: const BorderSide(color: Color(0xFF2F7D6B)),
                                padding: const EdgeInsets.symmetric(vertical: 14),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                              onPressed: appProv.startAutoDiscovery,
                              icon: const Icon(Icons.search, color: Color(0xFF2F7D6B)),
                              label: const Text('Tự động quét', style: TextStyle(color: Color(0xFF2F7D6B), fontWeight: FontWeight.bold)),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: FilledButton(
                              style: FilledButton.styleFrom(
                                backgroundColor: const Color(0xFF2F7D6B),
                                padding: const EdgeInsets.symmetric(vertical: 14),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
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
      ),
    );
  }
}
