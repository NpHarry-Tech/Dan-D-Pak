import 'package:dandpak_core/dandpak_core.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _serverController = TextEditingController();
  final TextEditingController _usernameController = TextEditingController(text: DanDpakDefaults.username);
  String _pin = '';
  final String _branchId = DanDpakDefaults.branchId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _serverController.text = context.read<AuthProvider>().serverUrl;
    });
  }

  void _onKeyPress(String val) {
    if (_pin.length >= 6) return;
    setState(() {
      _pin += val;
    });
  }

  void _onBackspace() {
    if (_pin.isEmpty) return;
    setState(() {
      _pin = _pin.substring(0, _pin.length - 1);
    });
  }

  void _onClear() {
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

    final auth = context.read<AuthProvider>();
    await auth.updateServerUrl(_serverController.text.trim());

    try {
      await auth.login(
        _usernameController.text.trim(),
        _pin,
        _branchId,
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.redAccent),
        );
        _onClear();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    return Scaffold(
      backgroundColor: const Color(0xFF141923),
      body: Center(
        child: SingleChildScrollView(
          child: Container(
            width: 460,
            padding: const EdgeInsets.all(32),
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
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Dan D Pak POS',
                  style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w900,
                    color: Colors.white,
                    letterSpacing: 0.8,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'ĐĂNG NHẬP THU NGÂN',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: Colors.amber[600],
                    letterSpacing: 1.5,
                  ),
                ),
                const SizedBox(height: 24),
                // Server Url input
                TextField(
                  controller: _serverController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Địa chỉ Server',
                    labelStyle: TextStyle(color: Color(0xFF8A99AD)),
                    enabledBorder: UnderlineInputBorder(
                      borderSide: BorderSide(color: Color(0xFF2C384E)),
                    ),
                    focusedBorder: UnderlineInputBorder(
                      borderSide: BorderSide(color: Colors.amber),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                // Username field
                TextField(
                  controller: _usernameController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Tài khoản',
                    labelStyle: TextStyle(color: Color(0xFF8A99AD)),
                    enabledBorder: UnderlineInputBorder(
                      borderSide: BorderSide(color: Color(0xFF2C384E)),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                // PIN dots indicators
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(6, (index) {
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
                const SizedBox(height: 24),
                // Numpad Grid
                GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 3,
                    crossAxisSpacing: 16,
                    mainAxisSpacing: 16,
                    childAspectRatio: 1.5,
                  ),
                  itemCount: 12,
                  itemBuilder: (context, index) {
                    if (index == 9) {
                      // Clear button
                      return OutlinedButton(
                        onPressed: _onClear,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.redAccent,
                          side: const BorderSide(color: Color(0xFF2C384E)),
                        ),
                        child: const Text('C', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                      );
                    }
                    if (index == 11) {
                      // Backspace
                      return OutlinedButton(
                        onPressed: _onBackspace,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: const Color(0xFF8A99AD),
                          side: const BorderSide(color: Color(0xFF2C384E)),
                        ),
                        child: const Icon(Icons.backspace_outlined),
                      );
                    }
                    final number = index == 10 ? '0' : '${index + 1}';
                    return ElevatedButton(
                      onPressed: () => _onKeyPress(number),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF252F42),
                        foregroundColor: Colors.white,
                      ),
                      child: Text(number, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                    );
                  },
                ),
                const SizedBox(height: 28),
                // Submit Button
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton(
                    onPressed: auth.isLoading ? null : _submitLogin,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.amber,
                      foregroundColor: const Color(0xFF141923),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    child: auth.isLoading
                        ? const CircularProgressIndicator(color: Color(0xFF141923))
                        : const Text(
                            'ĐĂNG NHẬP',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 1.0,
                            ),
                          ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
