import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/pos_models.dart';
import '../providers/auth_provider.dart';
import '../ui/app_theme.dart';
import '../widgets/window_controls.dart';

const _roleLabels = {
  'owner': 'Admin',
  'manager': 'Quản lý',
  'cashier': 'Thu ngân',
  'kitchen': 'Bếp',
  'warehouse': 'Thủ kho',
};

/// Nhân viên bị ẩn khỏi lưới đăng nhập (admin/owner đăng nhập qua link riêng).
bool _isHiddenFromGrid(User u) =>
    u.role == 'owner' || u.username.toLowerCase() == 'admin';

class LoginGateScreen extends StatefulWidget {
  const LoginGateScreen({super.key});

  @override
  State<LoginGateScreen> createState() => _LoginGateScreenState();
}

class _LoginGateScreenState extends State<LoginGateScreen> {
  String? _error;
  String _query = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final auth = context.read<AuthProvider>();
      if (auth.loginUsers.isNotEmpty) return;
      try {
        await auth.loadLoginUsers();
      } catch (e) {
        if (mounted) setState(() => _error = e.toString());
      }
    });
  }

  Future<void> _login(String username, String pin) async {
    final auth = context.read<AuthProvider>();
    try {
      await auth.login(username, pin, auth.selectedBranchId);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('PIN không đúng hoặc không đăng nhập được: $e'),
          backgroundColor: DanColors.late,
        ),
      );
    }
  }

  Future<void> _openPin(User user) async {
    final pin = await showDialog<String?>(
      context: context,
      barrierDismissible: false,
      barrierColor: const Color(0x8F0A121C),
      builder: (_) => _PinDialog(user: user),
    );
    if (pin == null || !mounted) return;
    await _login(user.username, pin);
  }

  Future<void> _openAdminLogin() async {
    final creds = await showDialog<Map<String, String>?>(
      context: context,
      barrierDismissible: false,
      barrierColor: const Color(0x8F0A121C),
      builder: (_) => const _AdminLoginDialog(),
    );
    if (creds == null || !mounted) return;
    await _login(creds['username'] ?? '', creds['pin'] ?? '');
  }

  List<User> _visibleUsers(List<User> all) {
    final q = _query.trim().toLowerCase();
    return all.where((u) => !_isHiddenFromGrid(u)).where((u) {
      if (q.isEmpty) return true;
      return u.name.toLowerCase().contains(q) ||
          u.username.toLowerCase().contains(q);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final branch = auth.selectedBranch;
    final users = _visibleUsers(auth.loginUsers);

    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(24),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 560),
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(22, 26, 22, 18),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Image.asset(
                              'assets/web/assets/DanOnLogo.png',
                              width: 78,
                              fit: BoxFit.contain,
                            ),
                            const SizedBox(height: 14),
                            const Text(
                              'Đăng nhập nhân viên',
                              style: TextStyle(
                                color: DanColors.muted,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 12),
                            _BranchBar(
                              branchName: branch.name.isNotEmpty
                                  ? branch.name
                                  : branch.id,
                              onChange: auth.changeBranch,
                            ),
                            const SizedBox(height: 16),
                            if (_error == null &&
                                !(auth.isLoading && auth.loginUsers.isEmpty))
                              _SearchField(
                                onChanged: (v) => setState(() => _query = v),
                              ),
                            const SizedBox(height: 14),
                            _employeeArea(auth, users),
                            const SizedBox(height: 8),
                            const Divider(height: 24, color: DanColors.border),
                            TextButton.icon(
                              onPressed: _openAdminLogin,
                              icon: const Icon(Icons.shield_outlined, size: 17),
                              style: TextButton.styleFrom(
                                foregroundColor: DanColors.faint,
                                textStyle: const TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w800),
                              ),
                              label: const Text('Đăng nhập quản trị viên'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              top: 0,
              left: 0,
              right: 146,
              height: 62,
              child: const DragToMoveArea(
                child: SizedBox.expand(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _employeeArea(AuthProvider auth, List<User> users) {
    if (_error != null) return _InlineError(message: _error!);
    if (auth.isLoading && auth.loginUsers.isEmpty) {
      return const _EmployeeSkeleton();
    }
    if (auth.loginUsers.where((u) => !_isHiddenFromGrid(u)).isEmpty) {
      return const _InlineHint(
        message:
            'Chưa có nhân viên để hiển thị.\nDùng "Đăng nhập quản trị viên" bên dưới.',
      );
    }
    if (users.isEmpty) {
      return const _InlineHint(message: 'Không tìm thấy nhân viên phù hợp.');
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final columns = width >= 460
            ? 4
            : width >= 340
                ? 3
                : 2;
        return GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: users.length,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            mainAxisExtent: 122,
          ),
          itemBuilder: (context, index) {
            final user = users[index];
            return _EmployeeGridTile(
              user: user,
              onTap: () => _openPin(user),
            );
          },
        );
      },
    );
  }
}

class _BranchBar extends StatelessWidget {
  final String branchName;
  final VoidCallback onChange;

  const _BranchBar({required this.branchName, required this.onChange});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 6, 6, 6),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        border: Border.all(color: DanColors.border2),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          const Icon(Icons.storefront_outlined,
              size: 18, color: DanColors.brand),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              branchName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: DanColors.text,
                fontWeight: FontWeight.w900,
                fontSize: 13.5,
              ),
            ),
          ),
          TextButton(
            onPressed: onChange,
            style: TextButton.styleFrom(
              foregroundColor: DanColors.brand,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              textStyle:
                  const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800),
            ),
            child: const Text('Đổi cơ sở'),
          ),
        ],
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  final ValueChanged<String> onChanged;

  const _SearchField({required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return TextField(
      onChanged: onChanged,
      decoration: const InputDecoration(
        isDense: true,
        hintText: 'Tìm nhân viên theo tên hoặc tài khoản...',
        prefixIcon: Icon(Icons.search, size: 20, color: DanColors.faint),
      ),
    );
  }
}

class _EmployeeGridTile extends StatelessWidget {
  final User user;
  final VoidCallback onTap;

  const _EmployeeGridTile({required this.user, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final displayName = user.name.isNotEmpty ? user.name : user.username;
    final initial = displayName.isNotEmpty ? displayName.characters.first : '?';
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
        decoration: BoxDecoration(
          color: DanColors.surface2,
          border: Border.all(color: DanColors.border2),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircleAvatar(
              radius: 21,
              backgroundColor: DanColors.brandDim,
              child: Text(
                initial.toUpperCase(),
                style: const TextStyle(
                  color: DanColors.brand,
                  fontWeight: FontWeight.w800,
                  fontSize: 17,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              displayName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontWeight: FontWeight.w800, fontSize: 12.5),
            ),
            Text(
              _roleLabels[user.role] ?? user.role,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: DanColors.muted,
                fontSize: 10.5,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PinDialog extends StatefulWidget {
  final User user;

  const _PinDialog({required this.user});

  @override
  State<_PinDialog> createState() => _PinDialogState();
}

class _PinDialogState extends State<_PinDialog> {
  String _pin = '';

  void _press(String key) {
    if (key == 'back') {
      setState(
          () => _pin = _pin.isEmpty ? '' : _pin.substring(0, _pin.length - 1));
      return;
    }
    if (_pin.length >= 4) return;
    final next = _pin + key;
    setState(() => _pin = next);
    if (next.length == 4) {
      Future.delayed(const Duration(milliseconds: 90), () {
        if (mounted) Navigator.of(context).pop(next);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final displayName =
        widget.user.name.isNotEmpty ? widget.user.name : widget.user.username;
    return Dialog(
      elevation: 0,
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.all(20),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 450),
        child: Container(
          width: 450,
          padding: const EdgeInsets.fromLTRB(30, 22, 30, 25),
          decoration: BoxDecoration(
            color: DanColors.surface,
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: DanColors.border2),
            boxShadow: const [
              BoxShadow(
                color: Color(0x330F172A),
                blurRadius: 90,
                offset: Offset(0, 28),
              ),
            ],
          ),
          child: Stack(
            children: [
              Positioned(
                top: 2,
                left: 0,
                child: TextButton(
                  onPressed: () => Navigator.of(context).pop(null),
                  style: TextButton.styleFrom(
                    foregroundColor: DanColors.brand,
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
                    textStyle: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w800),
                  ),
                  child: const Text('Chọn lại'),
                ),
              ),
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(height: 22),
                  const Text(
                    'Nhập mã PIN',
                    style: TextStyle(
                        fontSize: 21,
                        fontWeight: FontWeight.w800,
                        height: 1.25),
                  ),
                  const SizedBox(height: 7),
                  Text(
                    'Đăng nhập $displayName',
                    style: const TextStyle(
                      color: DanColors.muted,
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: DanColors.brandDim,
                      borderRadius: BorderRadius.circular(99),
                    ),
                    child: Text(
                      (_roleLabels[widget.user.role] ?? widget.user.role)
                          .toUpperCase(),
                      style: const TextStyle(
                        color: DanColors.brand,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        letterSpacing: .3,
                      ),
                    ),
                  ),
                  const SizedBox(height: 28),
                  _PinDots(length: _pin.length),
                  const SizedBox(height: 36),
                  _PinPad(onPressed: _press),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Đăng nhập quản trị: gõ tài khoản + PIN (admin không hiện trong lưới).
class _AdminLoginDialog extends StatefulWidget {
  const _AdminLoginDialog();

  @override
  State<_AdminLoginDialog> createState() => _AdminLoginDialogState();
}

class _AdminLoginDialogState extends State<_AdminLoginDialog> {
  final TextEditingController _username = TextEditingController();
  String _pin = '';

  @override
  void dispose() {
    _username.dispose();
    super.dispose();
  }

  void _press(String key) {
    if (key == 'back') {
      setState(
          () => _pin = _pin.isEmpty ? '' : _pin.substring(0, _pin.length - 1));
      return;
    }
    if (_pin.length >= 4) return; // PIN 4 số như mọi tài khoản khác
    final next = _pin + key;
    setState(() => _pin = next);
    // Đủ 4 số + đã nhập tài khoản → tự đăng nhập (giống luồng nhân viên).
    if (next.length == 4 && _username.text.trim().isNotEmpty) {
      Future.delayed(const Duration(milliseconds: 90), () {
        if (mounted) _submit();
      });
    }
  }

  void _submit() {
    if (_username.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Nhập tài khoản quản trị')),
      );
      return;
    }
    if (_pin.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Nhập mã PIN')),
      );
      return;
    }
    Navigator.of(context)
        .pop({'username': _username.text.trim(), 'pin': _pin});
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      elevation: 0,
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.all(20),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 450),
        child: Container(
          width: 450,
          padding: const EdgeInsets.fromLTRB(30, 20, 30, 24),
          decoration: BoxDecoration(
            color: DanColors.surface,
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: DanColors.border2),
            boxShadow: const [
              BoxShadow(
                color: Color(0x330F172A),
                blurRadius: 90,
                offset: Offset(0, 28),
              ),
            ],
          ),
          child: Stack(
            children: [
              Positioned(
                top: 2,
                left: 0,
                child: TextButton(
                  onPressed: () => Navigator.of(context).pop(null),
                  style: TextButton.styleFrom(
                    foregroundColor: DanColors.brand,
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
                    textStyle: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w800),
                  ),
                  child: const Text('Đóng'),
                ),
              ),
              // Cuộn được để khi BÀN PHÍM mở, bàn phím số PIN + nút đăng nhập
              // không bị che (nội dung cao hơn khoảng trống còn lại thì cuộn).
              SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const SizedBox(height: 22),
                    const Text(
                      'Đăng nhập quản trị',
                      style: TextStyle(
                          fontSize: 21,
                          fontWeight: FontWeight.w800,
                          height: 1.25),
                    ),
                    const SizedBox(height: 7),
                    const Text(
                      'Nhập tài khoản và mã PIN quản trị viên',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: DanColors.muted,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        height: 1.35,
                      ),
                    ),
                    const SizedBox(height: 20),
                    TextField(
                      controller: _username,
                      autofocus: true,
                      textInputAction: TextInputAction.done,
                      decoration: const InputDecoration(
                        isDense: true,
                        labelText: 'Tài khoản',
                        prefixIcon: Icon(Icons.person_outline, size: 20),
                      ),
                    ),
                    const SizedBox(height: 18),
                    _PinDots(length: _pin.length),
                    const SizedBox(height: 22),
                    _PinPad(onPressed: _press),
                    const SizedBox(height: 18),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: _submit,
                        child: const Text('ĐĂNG NHẬP'),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PinDots extends StatelessWidget {
  final int length;

  const _PinDots({required this.length});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(4, (i) {
        final active = i < length;
        return Container(
          width: 13,
          height: 13,
          margin: const EdgeInsets.symmetric(horizontal: 7),
          decoration: BoxDecoration(
            color: active ? DanColors.brand : Colors.transparent,
            border: Border.all(
              color: active ? DanColors.brand : const Color(0xFF94A3B8),
              width: 1.8,
            ),
            borderRadius: BorderRadius.circular(99),
          ),
        );
      }),
    );
  }
}

class _PinPad extends StatelessWidget {
  final ValueChanged<String> onPressed;

  const _PinPad({required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 312,
      child: GridView.count(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisCount: 3,
        mainAxisSpacing: 12,
        crossAxisSpacing: 14,
        childAspectRatio: 1.33,
        children: [
          for (final key in ['1', '2', '3', '4', '5', '6', '7', '8', '9'])
            _PinKey(label: key, onPressed: () => onPressed(key)),
          const SizedBox.shrink(),
          _PinKey(label: '0', onPressed: () => onPressed('0')),
          _PinKey(label: '⌫', muted: true, onPressed: () => onPressed('back')),
        ],
      ),
    );
  }
}

class _PinKey extends StatelessWidget {
  final String label;
  final bool muted;
  final VoidCallback onPressed;

  const _PinKey({
    required this.label,
    required this.onPressed,
    this.muted = false,
  });

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        shape: const StadiumBorder(),
        backgroundColor: muted ? Colors.transparent : const Color(0xFFF8FAFC),
        foregroundColor: label == 'C' ? DanColors.late : DanColors.text,
        side: BorderSide(
            color: muted ? Colors.transparent : const Color(0x4794A3B8)),
      ),
      child: Text(
        label,
        style: const TextStyle(
          fontSize: 25,
          fontWeight: FontWeight.w700,
          fontFamily: 'JetBrains Mono',
        ),
      ),
    );
  }
}

class _EmployeeSkeleton extends StatelessWidget {
  const _EmployeeSkeleton();

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: 8,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
        mainAxisExtent: 122,
      ),
      itemBuilder: (_, __) => DecoratedBox(
        decoration: BoxDecoration(
          color: DanColors.surface2,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: DanColors.border),
        ),
      ),
    );
  }
}

class _InlineHint extends StatelessWidget {
  final String message;

  const _InlineHint({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        border: Border.all(color: DanColors.border2),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        message,
        textAlign: TextAlign.center,
        style: const TextStyle(
            color: DanColors.muted, fontWeight: FontWeight.w700, height: 1.4),
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  final String message;

  const _InlineError({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF5F5),
        border: Border.all(color: const Color(0x33FF6B6B)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        message,
        textAlign: TextAlign.center,
        style:
            const TextStyle(color: DanColors.late, fontWeight: FontWeight.w700),
      ),
    );
  }
}
