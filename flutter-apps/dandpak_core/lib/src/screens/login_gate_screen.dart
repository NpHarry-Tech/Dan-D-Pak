import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/pos_models.dart';
import '../providers/auth_provider.dart';
import '../ui/app_theme.dart';
import '../utils/translation.dart';
import '../widgets/window_controls.dart';
import '../widgets/dan_tile_grid.dart';
import '../widgets/pin_key_capture.dart';
import '../services/black_box.dart';

Map<String, String> get _roleLabels => {
      'owner': 'Admin',
      'manager': t('Quản lý'),
      'cashier': t('Thu ngân'),
      'kitchen': t('Bếp'),
      'warehouse': t('Thủ kho'),
    };

/// Nhân viên bị ẩn khỏi lưới đăng nhập (admin/owner đăng nhập qua link riêng).
bool _isHiddenFromGrid(User u) =>
    u.role == 'owner' || u.username.toLowerCase() == 'admin';

class LoginGateScreen extends StatefulWidget {
  LoginGateScreen({super.key});

  @override
  State<LoginGateScreen> createState() => _LoginGateScreenState();
}

class _LoginGateScreenState extends State<LoginGateScreen> {
  String? _error;
  String _query = '';

  @override
  void initState() {
    super.initState();
    BlackBox.screen = 'login';
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

  Future<void> _login(String username, String pin, {String? lang}) async {
    final auth = context.read<AuthProvider>();
    try {
      await auth.login(username, pin, auth.selectedBranchId,
          preferredLang: lang);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${t('PIN không đúng hoặc không đăng nhập được')}: $e'),
          backgroundColor: DanColors.late,
        ),
      );
    }
  }

  Future<void> _openPin(User user) async {
    final auth = context.read<AuthProvider>();
    final res = await showDialog<Map<String, String>?>(
      context: context,
      barrierDismissible: false,
      barrierColor: Color(0x8F0A121C),
      builder: (_) => _PinDialog(user: user),
    );
    if (res == null || !mounted) return;
    await _login(user.username, res['pin'] ?? '', lang: auth.language);
  }

  Future<void> _openAdminLogin() async {
    final creds = await showDialog<Map<String, String>?>(
      context: context,
      barrierDismissible: false,
      barrierColor: Color(0x8F0A121C),
      builder: (_) => _AdminLoginDialog(),
    );
    if (creds == null || !mounted) return;
    await _login(creds['username'] ?? '', creds['pin'] ?? '',
        lang: context.read<AuthProvider>().language);
  }

  List<User> _visibleUsers(List<User> all) {
    final q = foldSearch(_query);
    return all.where((u) => !_isHiddenFromGrid(u)).where((u) {
      if (q.isEmpty) return true;
      return searchMatches(u.name, q) || searchMatches(u.username, q);
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
                  padding: EdgeInsets.all(24),
                  child: ConstrainedBox(
                    constraints: BoxConstraints(maxWidth: 560),
                    child: Card(
                      child: Padding(
                        padding: EdgeInsets.fromLTRB(22, 26, 22, 18),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Image.asset(
                              'assets/brand/DanOnLogo.png',
                              width: 78,
                              fit: BoxFit.contain,
                            ),
                            SizedBox(height: 14),
                            Text(
                              t('Đăng nhập nhân viên'),
                              style: TextStyle(
                                color: DanColors.muted,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            SizedBox(height: 12),
                            _BranchBar(
                              branchName: branch.name.isNotEmpty
                                  ? branch.name
                                  : branch.id,
                              onChange: auth.changeBranch,
                            ),
                            SizedBox(height: 10),
                            _LanguagePicker(
                              value: auth.language,
                              onChanged: auth.setLoginLanguage,
                            ),
                            SizedBox(height: 16),
                            if (_error == null &&
                                !(auth.isLoading && auth.loginUsers.isEmpty))
                              _SearchField(
                                onChanged: (v) => setState(() => _query = v),
                              ),
                            SizedBox(height: 14),
                            _employeeArea(auth, users),
                            SizedBox(height: 8),
                            Divider(height: 24, color: DanColors.border),
                            TextButton.icon(
                              onPressed: _openAdminLogin,
                              icon: Icon(Icons.shield_outlined, size: 17),
                              style: TextButton.styleFrom(
                                foregroundColor: DanColors.faint,
                                textStyle: TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w800),
                              ),
                              label: Text(t('Đăng nhập quản trị viên')),
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
              child: DragToMoveArea(
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
      return _EmployeeSkeleton();
    }
    if (auth.loginUsers.where((u) => !_isHiddenFromGrid(u)).isEmpty) {
      return _InlineHint(
        message:
            '${t('Chưa có nhân viên để hiển thị.')}\n${t('Dùng "Đăng nhập quản trị viên" bên dưới.')}',
      );
    }
    if (users.isEmpty) {
      return _InlineHint(message: t('Không tìm thấy nhân viên phù hợp.'));
    }
    // QUY TẮC LƯỚI CHUNG: ô nhân viên có kích thước CỐ ĐỊNH; thêm/bớt người thì các
    // ô sau tự dịch trái – lùi lên, KHÔNG giãn ô ra cho vừa hàng (xem DanTileGrid).
    return DanTileGrid(
      tileWidth: 150,
      tileHeight: 122,
      children: [
        for (final user in users)
          _EmployeeGridTile(user: user, onTap: () => _openPin(user)),
      ],
    );
  }
}

class _BranchBar extends StatelessWidget {
  final String branchName;
  final VoidCallback onChange;

  _BranchBar({required this.branchName, required this.onChange});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(12, 6, 6, 6),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        border: Border.all(color: DanColors.border2),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(Icons.storefront_outlined, size: 18, color: DanColors.brand),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              branchName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
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
              padding: EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              textStyle: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800),
            ),
            child: Text(t('Đổi cơ sở')),
          ),
        ],
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  final ValueChanged<String> onChanged;

  _SearchField({required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return TextField(
      onChanged: onChanged,
      decoration: InputDecoration(
        isDense: true,
        hintText: t('Tìm nhân viên theo tên hoặc tài khoản...'),
        prefixIcon: Icon(Icons.search, size: 20, color: DanColors.faint),
      ),
    );
  }
}

class _LanguagePicker extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;

  _LanguagePicker({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return SegmentedButton<String>(
      segments: [
        ButtonSegment(value: 'vi', label: Text(t('Tiếng Việt'))),
        ButtonSegment(value: 'en', label: Text('English')),
      ],
      selected: {L10n.clean(value)},
      onSelectionChanged: (v) => onChanged(v.first),
      showSelectedIcon: false,
    );
  }
}

class _EmployeeGridTile extends StatelessWidget {
  final User user;
  final VoidCallback onTap;

  _EmployeeGridTile({required this.user, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final displayName = user.name.isNotEmpty ? user.name : user.username;
    final initial = displayName.isNotEmpty ? displayName.characters.first : '?';
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 8, vertical: 10),
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
                style: TextStyle(
                  color: DanColors.brand,
                  fontWeight: FontWeight.w800,
                  fontSize: 17,
                ),
              ),
            ),
            SizedBox(height: 8),
            Text(
              displayName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5),
            ),
            Text(
              _roleLabels[user.role] ?? user.role,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
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

  _PinDialog({required this.user});

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
      Future.delayed(Duration(milliseconds: 90), () {
        if (mounted) Navigator.of(context).pop({'pin': next});
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
      insetPadding: EdgeInsets.all(20),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: 450,
          // Cap chiều cao theo màn hình: tablet mini màn thấp thì nội dung CUỘN được
          // (dưới đây bọc SingleChildScrollView) để hàng phím 0/⌫ không bị đáy màn che.
          maxHeight: MediaQuery.sizeOf(context).height - 32,
        ),
        child: SingleChildScrollView(
          child: Container(
          // Tablet mini: KHÔNG ép cứng 450 khi màn hẹp hơn → tránh tràn ngang.
          width: MediaQuery.sizeOf(context).width - 40 < 450
              ? MediaQuery.sizeOf(context).width - 40
              : 450,
          padding: EdgeInsets.fromLTRB(30, 22, 30, 25),
          decoration: BoxDecoration(
            color: DanColors.surface,
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: DanColors.border2),
            boxShadow: [
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
                    padding: EdgeInsets.symmetric(horizontal: 8, vertical: 7),
                    textStyle:
                        TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
                  ),
                  child: Text(t('Chọn lại')),
                ),
              ),
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(height: 22),
                  Text(
                    t('Nhập mã PIN'),
                    style: TextStyle(
                        fontSize: 21,
                        fontWeight: FontWeight.w800,
                        height: 1.25),
                  ),
                  SizedBox(height: 7),
                  Text(
                    '${t('Đăng nhập')} $displayName',
                    style: TextStyle(
                      color: DanColors.muted,
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      height: 1.35,
                    ),
                  ),
                  SizedBox(height: 10),
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: DanColors.brandDim,
                      borderRadius: BorderRadius.circular(99),
                    ),
                    child: Text(
                      (_roleLabels[widget.user.role] ?? widget.user.role)
                          .toUpperCase(),
                      style: TextStyle(
                        color: DanColors.brand,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        letterSpacing: .3,
                      ),
                    ),
                  ),
                  SizedBox(height: 28),
                  _PinDots(length: _pin.length),
                  SizedBox(height: 36),
                  // Bọc keypad để CŨNG nhận bàn phím thiết bị/rời (gõ số/Backspace).
                  // Enter bỏ qua vì PIN đủ 4 số là tự đăng nhập.
                  PinKeyCapture(
                    onKey: (k) {
                      if (k == 'enter') return;
                      _press(k);
                    },
                    child: _PinPad(onPressed: _press),
                  ),
                ],
              ),
            ],
          ),
        ),
        ),
      ),
    );
  }
}

/// Đăng nhập quản trị: gõ tài khoản + PIN (admin không hiện trong lưới).
class _AdminLoginDialog extends StatefulWidget {
  _AdminLoginDialog();

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
      Future.delayed(Duration(milliseconds: 90), () {
        if (mounted) _submit();
      });
    }
  }

  void _submit() {
    if (_username.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(t('Nhập tài khoản quản trị'))),
      );
      return;
    }
    if (_pin.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(t('Nhập mã PIN'))),
      );
      return;
    }
    Navigator.of(context).pop({'username': _username.text.trim(), 'pin': _pin});
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      elevation: 0,
      backgroundColor: Colors.transparent,
      insetPadding: EdgeInsets.all(20),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 450),
        child: Container(
          // Tablet mini: KHÔNG ép cứng 450 khi màn hẹp hơn → tránh tràn ngang.
          width: MediaQuery.sizeOf(context).width - 40 < 450
              ? MediaQuery.sizeOf(context).width - 40
              : 450,
          padding: EdgeInsets.fromLTRB(30, 20, 30, 24),
          decoration: BoxDecoration(
            color: DanColors.surface,
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: DanColors.border2),
            boxShadow: [
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
                    padding: EdgeInsets.symmetric(horizontal: 8, vertical: 7),
                    textStyle:
                        TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
                  ),
                  child: Text(t('Đóng')),
                ),
              ),
              // Cuộn được để khi BÀN PHÍM mở, bàn phím số PIN + nút đăng nhập
              // không bị che (nội dung cao hơn khoảng trống còn lại thì cuộn).
              SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SizedBox(height: 22),
                    Text(
                      t('Đăng nhập quản trị'),
                      style: TextStyle(
                          fontSize: 21,
                          fontWeight: FontWeight.w800,
                          height: 1.25),
                    ),
                    SizedBox(height: 7),
                    Text(
                      t('Nhập tài khoản và mã PIN quản trị viên'),
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: DanColors.muted,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        height: 1.35,
                      ),
                    ),
                    SizedBox(height: 20),
                    TextField(
                      controller: _username,
                      autofocus: true,
                      textInputAction: TextInputAction.done,
                      decoration: InputDecoration(
                        isDense: true,
                        labelText: t('Tài khoản'),
                        prefixIcon: Icon(Icons.person_outline, size: 20),
                      ),
                    ),
                    SizedBox(height: 18),
                    _PinDots(length: _pin.length),
                    SizedBox(height: 22),
                    _PinPad(onPressed: _press),
                    SizedBox(height: 18),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: _submit,
                        child: Text(t('ĐĂNG NHẬP')),
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

  _PinDots({required this.length});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(4, (i) {
        final active = i < length;
        return Container(
          width: 13,
          height: 13,
          margin: EdgeInsets.symmetric(horizontal: 7),
          decoration: BoxDecoration(
            color: active ? DanColors.brand : Colors.transparent,
            border: Border.all(
              color: active ? DanColors.brand : Color(0xFF94A3B8),
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

  _PinPad({required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 312,
      child: GridView.count(
        shrinkWrap: true,
        physics: NeverScrollableScrollPhysics(),
        crossAxisCount: 3,
        mainAxisSpacing: 12,
        crossAxisSpacing: 14,
        childAspectRatio: 1.33,
        children: [
          for (final key in ['1', '2', '3', '4', '5', '6', '7', '8', '9'])
            _PinKey(label: key, onPressed: () => onPressed(key)),
          SizedBox.shrink(),
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

  _PinKey({
    required this.label,
    required this.onPressed,
    this.muted = false,
  });

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        shape: StadiumBorder(),
        backgroundColor: muted ? Colors.transparent : Color(0xFFF8FAFC),
        foregroundColor: label == 'C' ? DanColors.late : DanColors.text,
        side: BorderSide(color: muted ? Colors.transparent : Color(0x4794A3B8)),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 25,
          fontWeight: FontWeight.w700,
          fontFamily: 'JetBrains Mono',
        ),
      ),
    );
  }
}

class _EmployeeSkeleton extends StatelessWidget {
  _EmployeeSkeleton();

  @override
  Widget build(BuildContext context) {
    // Skeleton dùng ĐÚNG kích thước ô như lưới nhân viên thật → không "nhảy" layout.
    return DanTileGrid(
      tileWidth: 150,
      tileHeight: 122,
      children: List.generate(
        8,
        (_) => DecoratedBox(
          decoration: BoxDecoration(
            color: DanColors.surface2,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: DanColors.border),
          ),
        ),
      ),
    );
  }
}

class _InlineHint extends StatelessWidget {
  final String message;

  _InlineHint({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        border: Border.all(color: DanColors.border2),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        message,
        textAlign: TextAlign.center,
        style: TextStyle(
            color: DanColors.muted, fontWeight: FontWeight.w700, height: 1.4),
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  final String message;

  _InlineError({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Color(0xFFFFF5F5),
        border: Border.all(color: Color(0x33FF6B6B)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        message,
        textAlign: TextAlign.center,
        style: TextStyle(color: DanColors.late, fontWeight: FontWeight.w700),
      ),
    );
  }
}
