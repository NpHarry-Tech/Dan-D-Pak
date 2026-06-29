// lib/screens/login_screen.dart
import 'package:dandpak_core/dandpak_core.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_provider.dart';
import '../providers/auth_provider.dart';
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

  void _handleKeyPress(String value) {
    if (_pin.length < 6) {
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

  void _handleClear() {
    setState(() {
      _pin = '';
    });
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
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF0F141C), Color(0xFF161C26)],
          ),
        ),
        child: Center(
          child: SingleChildScrollView(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 800),
              child: Card(
                color: const Color(0xFF1C2430),
                elevation: 10,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                child: Padding(
                  padding: const EdgeInsets.all(40),
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
                              'Ứng dụng máy tính bảng Dan D Pak',
                              style: TextStyle(color: Colors.white60, fontSize: 13),
                            ),
                            const SizedBox(height: 36),
                            TextField(
                              controller: _usernameController,
                              style: const TextStyle(color: Colors.white),
                              decoration: InputDecoration(
                                labelText: 'Tên tài khoản',
                                labelStyle: const TextStyle(color: Colors.white70),
                                filled: true,
                                fillColor: const Color(0xFF0F151D),
                                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                              ),
                            ),
                            const SizedBox(height: 18),
                            DropdownButtonFormField<String>(
                              dropdownColor: const Color(0xFF1C2430),
                              value: appProv.activeBranch?.id,
                              style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w500),
                              decoration: InputDecoration(
                                labelText: 'Chi nhánh',
                                labelStyle: const TextStyle(color: Colors.white70),
                                filled: true,
                                fillColor: const Color(0xFF0F151D),
                                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
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
                            const SizedBox(height: 24),
                            if (authProv.busy)
                              const Center(child: CircularProgressIndicator(color: Color(0xFF2F7D6B)))
                            else
                              FilledButton(
                                style: FilledButton.styleFrom(
                                  backgroundColor: const Color(0xFF2F7D6B),
                                  padding: const EdgeInsets.symmetric(vertical: 16),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                ),
                                onPressed: _submitLogin,
                                child: const Text('ĐĂNG NHẬP', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
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
                                color: const Color(0xFF0F151D),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: List.generate(6, (index) {
                                  final active = index < _pin.length;
                                  return Container(
                                    margin: const EdgeInsets.symmetric(horizontal: 8),
                                    width: 14,
                                    height: 14,
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: active ? const Color(0xFF2F7D6B) : Colors.white24,
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
                                crossAxisSpacing: 10,
                                mainAxisSpacing: 10,
                              ),
                              itemCount: 12,
                              itemBuilder: (context, index) {
                                final isClear = index == 9;
                                final isZero = index == 10;
                                final isBackspace = index == 11;
                                
                                String keyLabel = '';
                                if (isClear) keyLabel = 'C';
                                else if (isZero) keyLabel = '0';
                                else if (isBackspace) keyLabel = '⌫';
                                else keyLabel = '${index + 1}';

                                return InkWell(
                                  onTap: () {
                                    if (isClear) _handleClear();
                                    else if (isBackspace) _handleBackspace();
                                    else keyLabel == '0' ? _handleKeyPress('0') : _handleKeyPress(keyLabel);
                                  },
                                  borderRadius: BorderRadius.circular(12),
                                  child: Container(
                                    decoration: BoxDecoration(
                                      color: const Color(0xFF242F3D),
                                      borderRadius: BorderRadius.circular(12),
                                      border: Border.all(color: Colors.white10),
                                    ),
                                    alignment: Alignment.center,
                                    child: Text(
                                      keyLabel,
                                      style: TextStyle(
                                        color: isClear ? const Color(0xFFFF7A7A) : Colors.white,
                                        fontSize: 22,
                                        fontWeight: FontWeight.bold,
                                      ),
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
        ),
      ),
    );
  }
}
