// GENERATED SPLIT of settings_more_panels.dart — panel In ấn + Thiết bị khách (part of, cùng library).
part of 'settings_more_panels.dart';

class PrintSettingsPanel extends StatelessWidget {
  final ApiService api;
  PrintSettingsPanel({super.key, required this.api});

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: t('Bill & Tem nhãn'),
      child: ListView(
        padding: EdgeInsets.all(18),
        children: [
          Panel(
            title: t('Thiết kế mẫu in'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t('Cấu hình máy in, in thử và lịch sử lệnh in đã có trong module "Máy in" ở màn hình ứng dụng.'),
                    style: TextStyle(
                        fontSize: 13, color: DanColors.muted, height: 1.5)),
                SizedBox(height: 10),
                Text(t('Trình thiết kế trực quan mẫu hóa đơn & tem nhãn (kéo-thả) sẽ được bổ sung — hiện dùng mẫu mặc định của hệ thống.'),
                    style: TextStyle(
                        fontSize: 12.5, color: DanColors.faint, height: 1.5)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Devices (Thiết bị khách) ───────────────────────────────────────────────

class DevicesPanel extends StatefulWidget {
  final ApiService api;
  DevicesPanel({super.key, required this.api});

  @override
  State<DevicesPanel> createState() => _DevicesPanelState();
}

class _DevicesPanelState extends State<DevicesPanel> {
  final _pin = TextEditingController();
  String _currentPin = '';
  bool _loading = true;
  bool _saving = false;
  bool _isDefaultPin = false;
  String? _error;

  // Mật khẩu 4 số dễ đoán — chặn tại chỗ (server cũng chốt chặn lại).
  static const _weakPins = {
    '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888',
    '9999', '1234', '4321', '2345', '3456', '4567', '5678', '6789', '0123',
    '1212', '2580',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _pin.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final s = await widget.api.getAppSettings();
      if (!mounted) return;
      setState(() {
        _currentPin = _s(s['ipad_staff_pin']);
        _isDefaultPin = s['ipad_pin_is_default'] == true;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _save() async {
    final newPin = _pin.text.trim();
    if (!RegExp(r'^\d{4}$').hasMatch(newPin)) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('PIN phải đúng 4 chữ số')),
          backgroundColor: DanColors.late));
      return;
    }
    if (_weakPins.contains(newPin)) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Mật khẩu quá dễ đoán (0000/1111/1234…). Hãy chọn 4 số khác.')),
          backgroundColor: DanColors.late));
      return;
    }
    final approval = await settingsPin(
        context, t('Đổi mật khẩu (PIN) mở khóa thiết bị khách.'));
    if (approval == null) return;
    setState(() => _saving = true);
    try {
      await widget.api.saveAppSettings(
          {'ipad_staff_pin': newPin, 'security_pin': approval});
      if (!mounted) return;
      setState(() {
        _currentPin = newPin;
        _isDefaultPin = false;
        _pin.clear();
        _saving = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Đã đổi PIN thiết bị khách')),
          backgroundColor: DanColors.text));
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: t('Thiết bị khách'),
      onRefresh: _load,
      child: settingsState(
        loading: _loading,
        error: _error,
        onRetry: _load,
        child: ListView(
          padding: EdgeInsets.all(18),
          children: [
            Panel(
              title: t('Màn hình tự order (iPad / máy khách)'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                      t('PIN này dùng để nhân viên mở khóa/thoát chế độ tự order trên thiết bị khách.'),
                      style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
                  if (_isDefaultPin) ...[
                    SizedBox(height: 12),
                    Container(
                      padding: EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: DanColors.late.withValues(alpha: 0.10),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                            color: DanColors.late.withValues(alpha: 0.45)),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(Icons.warning_amber_rounded,
                              size: 20, color: DanColors.late),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              t('Thiết bị khách đang dùng mật khẩu MẶC ĐỊNH — ai cũng đoán được. Hãy đặt mã PIN mới ngay để tránh khách tự thoát vào màn nhân viên.'),
                              style: TextStyle(
                                  fontSize: 12.5,
                                  height: 1.4,
                                  color: DanColors.text,
                                  fontWeight: FontWeight.w600),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  SizedBox(height: 12),
                  Row(
                    children: [
                      Text(t('PIN hiện tại: '),
                          style: TextStyle(fontWeight: FontWeight.w700)),
                      Text(_currentPin.isEmpty ? t('(chưa đặt)') : '••••',
                          style: TextStyle(
                              fontFamily: 'JetBrains Mono',
                              fontWeight: FontWeight.w800)),
                    ],
                  ),
                  SizedBox(height: 12),
                  SizedBox(
                    width: 220,
                    child: TextField(
                      controller: _pin,
                      keyboardType: TextInputType.number,
                      obscureText: true,
                      maxLength: 4,
                      decoration: InputDecoration(
                          labelText: t('PIN mới (4 số)'), isDense: true),
                    ),
                  ),
                  SizedBox(height: 8),
                  FilledButton(
                    onPressed: _saving ? null : _save,
                    style: FilledButton.styleFrom(minimumSize: Size(0, 42)),
                    child: _saving
                        ? SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
                        : Text(t('Đổi PIN')),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
