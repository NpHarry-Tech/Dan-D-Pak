// lib/screens/login_screen.dart
import 'package:dandpak_core/dandpak_core.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_provider.dart';
import '../providers/auth_provider.dart';
import '../services/app_updater.dart';
import 'connection_screen.dart';
import 'dashboard_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _usernameController = TextEditingController(text: DanDpakDefaults.username);
  String _pin = '';

  @override
  void initState() {
    super.initState();
    // Vừa vào màn đăng nhập (server đã kết nối được) → hỏi server có bản
    // cập nhật mới không; có thì hiện hộp thoại mời tải. Lỗi mạng bỏ qua.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final url = context.read<AppProvider>().serverUrl;
      TabletUpdater.checkAndPrompt(context, url);
    });
  }

  void _handleKeyPress(String value) {
    if (_pin.length < 4) {
      setState(() {
        _pin += value;
      });
    }
  }

  void _handleBackspace() {
    if (_pin.isNotEmpty) {
      setState(() {
        _pin = _pin.substring(0, _pin.length - 1);
      });
    }
  }

  Future<void> _submitLogin() async {
    if (_pin.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Vui lòng nhập mã PIN')),
      );
      return;
    }

    final appProv = Provider.of<AppProvider>(context, listen: false);
    final authProv = Provider.of<AuthProvider>(context, listen: false);

    if (appProv.activeBranch == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Vui lòng chọn chi nhánh')),
      );
      return;
    }

    final ok = await authProv.login(
      appProv.serverUrl,
      _usernameController.text.trim(),
      _pin,
      appProv.activeBranch!.id,
    );

    if (ok) {
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const DashboardScreen()),
        );
      }
    }
  }

  @override
  void dispose() {
    _usernameController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final appProv = Provider.of<AppProvider>(context);
    final authProv = Provider.of<AuthProvider>(context);

    return Scaffold(
      backgroundColor: const Color(0xFF141923),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.settings, color: Colors.white70),
            onPressed: () {
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(builder: (_) => const ConnectionScreen()),
              );
            },
          ),
        ],
      ),
      extendBodyBehindAppBar: true,
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 800),
            child: Container(
              padding: const EdgeInsets.all(40),
              decoration: BoxDecoration(
                color: const Color(0xFF1E2633),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFF2C384E)),
                boxShadow: const [
                  BoxShadow(
                    color: Colors.black26,
                    blurRadius: 24,
                    offset: Offset(0, 8),
                  )
                ],
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  // Left info column
                  Expanded(
                    flex: 4,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text(
                          'ĐĂNG NHẬP',
                          style: TextStyle(fontSize: 26, fontWeight: FontWeight.w900, letterSpacing: 1.2, color: Colors.white),
                        ),
                        const SizedBox(height: 6),
                        const Text(
                          'ỨNG DỤNG MÁY TÍNH BẢNG DAN D PAK',
                          style: TextStyle(
                            color: Colors.amber,
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 1.5,
                          ),
                        ),
                        const SizedBox(height: 36),
                        TextField(
                          controller: _usernameController,
                          style: const TextStyle(color: Colors.white),
                          decoration: const InputDecoration(
                            labelText: 'Tên tài khoản',
                            labelStyle: TextStyle(color: Color(0xFF8A99AD)),
                            enabledBorder: UnderlineInputBorder(
                              borderSide: BorderSide(color: Color(0xFF2C384E)),
                            ),
                            focusedBorder: UnderlineInputBorder(
                              borderSide: BorderSide(color: Colors.amber),
                            ),
                          ),
                        ),
                        const SizedBox(height: 24),
                        DropdownButtonFormField<String>(
                          dropdownColor: const Color(0xFF1E2633),
                          initialValue: appProv.activeBranch?.id,
                          style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w500),
                          decoration: const InputDecoration(
                            labelText: 'Chi nhánh',
                            labelStyle: TextStyle(color: Color(0xFF8A99AD)),
                            enabledBorder: UnderlineInputBorder(
                              borderSide: BorderSide(color: Color(0xFF2C384E)),
                            ),
                            focusedBorder: UnderlineInputBorder(
                              borderSide: BorderSide(color: Colors.amber),
                            ),
                          ),
                          items: appProv.branches.map((b) {
                            return DropdownMenuItem(
                              value: b.id,
                              child: Text(b.name),
                            );
                          }).toList(),
                          onChanged: (val) {
                            if (val != null) {
                              final selected = appProv.branches.firstWhere((b) => b.id == val);
                              appProv.setActiveBranch(selected);
                            }
                          },
                        ),
                        if (authProv.error != null) ...[
                          const SizedBox(height: 18),
                          Text(
                            authProv.error!,
                            style: const TextStyle(color: Color(0xFFFF7A7A), fontSize: 13, fontWeight: FontWeight.w500),
                          ),
                        ],
                        const SizedBox(height: 32),
                        if (authProv.busy)
                          const Center(child: CircularProgressIndicator(color: Colors.amber))
                        else
                          SizedBox(
                            width: double.infinity,
                            height: 50,
                            child: ElevatedButton(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: Colors.amber,
                                foregroundColor: const Color(0xFF141923),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                              ),
                              onPressed: _submitLogin,
                              child: const Text('ĐĂNG NHẬP', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, letterSpacing: 0.5)),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 40),
                  // Right custom PIN pad column
                  Expanded(
                    flex: 5,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 24),
                          decoration: BoxDecoration(
                            color: const Color(0xFF141923),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: const Color(0xFF2C384E)),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: List.generate(4, (index) {
                              final active = index < _pin.length;
                              return Container(
                                margin: const EdgeInsets.symmetric(horizontal: 8),
                                width: 14,
                                height: 14,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: active ? Colors.amber : const Color(0xFF2C384E),
                                  border: Border.all(
                                    color: active ? Colors.amber : const Color(0xFF3D4E6D),
                                  ),
                                ),
                              );
                            }),
                          ),
                        ),
                        const SizedBox(height: 20),
                        GridView.builder(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 3,
                            childAspectRatio: 1.4,
                            crossAxisSpacing: 12,
                            mainAxisSpacing: 12,
                          ),
                          itemCount: 12,
                          itemBuilder: (context, index) {
                            final isBlank = index == 9;
                            final isZero = index == 10;
                            final isBackspace = index == 11;

                            if (isBlank) {
                              return const SizedBox.shrink();
                            }

                            String keyLabel = '';
                            if (isZero) {
                              keyLabel = '0';
                            } else if (isBackspace) {
                              keyLabel = '⌫';
                            } else {
                              keyLabel = '${index + 1}';
                            }

                            return ElevatedButton(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF252F42),
                                foregroundColor: Colors.white,
                                elevation: 0,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  side: const BorderSide(color: Color(0xFF2C384E)),
                                ),
                              ),
                              onPressed: () {
                                if (isBackspace) {
                                  _handleBackspace();
                                } else {
                                  _handleKeyPress(keyLabel);
                                }
                              },
                              child: isBackspace
                                  ? const Icon(Icons.backspace_outlined, color: Color(0xFF8A99AD), size: 22)
                                  : Text(
                                      keyLabel,
                                      style: const TextStyle(
                                        fontSize: 22,
                                        fontWeight: FontWeight.bold,
                                        color: Colors.white,
                                      ),
                                    ),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
