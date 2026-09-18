import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../online/online_shared.dart';
import 'management_widgets.dart';
import 'settings_tab.dart' show settingsPin;

/// MISA meInvoice — luồng kết nối kiểu KiotViet: cửa hàng chỉ nhập tài khoản
/// MISA meInvoice của họ (mã số thuế/tên đăng nhập/mật khẩu). AppID và địa chỉ
/// API là credential của ỨNG DỤNG Dan D Pak POS, nằm ở biến môi trường server
/// (xem server/services/misa/config.js resolveServerCredentials) — KHÔNG BAO
/// GIỜ hiển thị hay nhập được ở đây.
class MisaMeInvoicePanel extends StatefulWidget {
  final VoidCallback? onChanged;
  const MisaMeInvoicePanel({super.key, this.onChanged});

  @override
  State<MisaMeInvoicePanel> createState() => _MisaMeInvoicePanelState();
}

const _STATUS_LABELS = {
  'DISCONNECTED': 'Chưa kết nối',
  'SERVER_NOT_CONFIGURED': 'Máy chủ chưa được cấp AppID',
  'AUTHENTICATED': 'Đã đăng nhập — thiếu mẫu hóa đơn',
  'REQUIRES_TEMPLATE': 'Đã đăng nhập — cần chọn mẫu hóa đơn',
  'DEGRADED': 'Kết nối không ổn định',
  'REAUTH_REQUIRED': 'Phiên đăng nhập hết hạn',
  'READY': 'Đã kết nối',
  'ERROR': 'Kết nối lỗi',
};

String _statusLabel(String status) =>
    t(_STATUS_LABELS[status] ?? _STATUS_LABELS['DISCONNECTED']!);

Color _statusColor(String status) {
  switch (status) {
    case 'READY':
      return DanColors.done;
    case 'DEGRADED':
    case 'AUTHENTICATED':
    case 'REQUIRES_TEMPLATE':
      return DanColors.doing;
    case 'DISCONNECTED':
      return DanColors.faint;
    default:
      return DanColors.late;
  }
}

class _MisaMeInvoicePanelState extends State<MisaMeInvoicePanel> {
  Map<String, dynamic> _cfg = {};
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() => _loading = true);
    try {
      final data = await context.read<ApiService>().getIntegrations();
      final misa = oMap(oMap(data['channels'])['misa']);
      if (!mounted) return;
      setState(() {
        _cfg = misa;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _openSetup() async {
    final changed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _MisaSetupModal(initial: _cfg),
    );
    if (changed == true) {
      await _load();
      widget.onChanged?.call();
    }
  }

  Future<void> _disconnect() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(t('Ngắt kết nối MISA meInvoice?')),
        content: Text(t(
            'Hóa đơn đã phát hành vẫn được giữ nguyên. Cửa hàng sẽ ngừng tự động phát hành hóa đơn điện tử cho tới khi kết nối lại.')),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text(t('Hủy'))),
          FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: Text(t('Ngắt kết nối'))),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final pin = await settingsPin(context, t('Ngắt kết nối MISA meInvoice.'));
    if (pin == null) return;
    try {
      await context.read<ApiService>().saveIntegrations({
        'channels': {
          'misa': {
            'enabled': false,
            'username': '',
            'password': '',
            'taxCode': '',
            'templateId': '',
            'series': '',
            'configurationTestPassed': false,
          }
        },
        'security_pin': pin,
      });
      if (!mounted) return;
      appToast(context, t('Đã ngắt kết nối MISA meInvoice'));
      await _load();
      widget.onChanged?.call();
    } catch (e) {
      if (!mounted) return;
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 40),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 20),
        child: InlineMessage(_error!, error: true, onRetry: _load),
      );
    }
    final status =
        oStr(_cfg['status']).isEmpty ? 'DISCONNECTED' : oStr(_cfg['status']);
    return status == 'READY'
        ? _buildConnectedSummary(status)
        : _buildDisconnectedCard(status);
  }

  Widget _statusPill(String status) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: _statusColor(status).withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(_statusLabel(status),
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w800,
                color: _statusColor(status))),
      );

  Widget _buildDisconnectedCard(String status) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(children: [
          Expanded(
              child: Text(t('MISA meInvoice'),
                  style: const TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w800))),
          _statusPill(status),
        ]),
        const SizedBox(height: 6),
        Text(
            t('Kết nối MISA meInvoice để tự động phát hành và quản lý hóa đơn điện tử.'),
            style: TextStyle(color: DanColors.muted, height: 1.4)),
        if (oStr(_cfg['lastTestError']).isNotEmpty) ...[
          const SizedBox(height: 10),
          InlineMessage(oStr(_cfg['lastTestError']), error: true),
        ],
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: _openSetup,
          icon: const Icon(Icons.link),
          label: Text(t('Kết nối')),
        ),
      ],
    );
  }

  Widget _buildConnectedSummary(String status) {
    final rows = <(String, String)>[
      ('Trạng thái', _statusLabel(status)),
      ('Nhà cung cấp', 'MISA meInvoice'),
      ('Mã số thuế', oStr(_cfg['taxCode'])),
      ('Tên đơn vị', oStr(_cfg['companyName'])),
      ('Tài khoản kết nối', _maskUsername(oStr(_cfg['username']))),
      (
        'Hình thức hóa đơn',
        oStr(_cfg['invoiceCodeType']) == 'WITHOUT_CODE'
            ? t('Không có mã CQT')
            : t('Có mã CQT')
      ),
      ('Mẫu số', oStr(_cfg['templateId'])),
      ('Ký hiệu', oStr(_cfg['series'])),
      ('Lần kiểm tra gần nhất', oStr(_cfg['lastTestedAt'])),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(children: [
          Expanded(
              child: Text(t('MISA meInvoice'),
                  style: const TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w800))),
          _statusPill(status),
        ]),
        const SizedBox(height: 14),
        for (final r in rows)
          if (r.$2.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                      width: 160,
                      child: Text(t(r.$1),
                          style: TextStyle(color: DanColors.muted))),
                  Expanded(
                      child: Text(r.$2,
                          style: const TextStyle(fontWeight: FontWeight.w700))),
                ],
              ),
            ),
        const SizedBox(height: 16),
        Wrap(spacing: 10, runSpacing: 10, children: [
          OutlinedButton.icon(
            onPressed: _openSetup,
            icon: const Icon(Icons.refresh),
            label: Text(t('Kiểm tra lại kết nối')),
          ),
          OutlinedButton.icon(
            onPressed: _openSetup,
            icon: const Icon(Icons.edit_outlined),
            label: Text(t('Sửa thiết lập')),
          ),
          OutlinedButton.icon(
            onPressed: _openSetup,
            icon: const Icon(Icons.swap_horiz),
            label: Text(t('Đổi tài khoản')),
          ),
          OutlinedButton.icon(
            onPressed: _disconnect,
            icon: Icon(Icons.link_off, color: DanColors.late),
            label: Text(t('Ngắt kết nối'),
                style: TextStyle(color: DanColors.late)),
          ),
        ]),
      ],
    );
  }
}

String _maskUsername(String u) {
  if (u.isEmpty) return '';
  if (u.length <= 3) return '${u[0]}***';
  return '${u.substring(0, 3)}***';
}

/// Modal "Thiết lập kết nối hóa đơn điện tử" — CHỈ nhập thông tin tài khoản
/// MISA meInvoice. Không có ô AppID/Secret Key/API Base URL/token: các trường
/// đó là credential ứng dụng, cấu hình ở server (MISA_MEINVOICE_APP_ID/ENV/
/// BASE_URL), Flutter không bao giờ đọc/ghi được.
class _MisaSetupModal extends StatefulWidget {
  final Map<String, dynamic> initial;
  const _MisaSetupModal({required this.initial});

  @override
  State<_MisaSetupModal> createState() => _MisaSetupModalState();
}

class _MisaSetupModalState extends State<_MisaSetupModal> {
  late final TextEditingController _taxCodeCtrl;
  late final TextEditingController _usernameCtrl;
  final TextEditingController _passwordCtrl = TextEditingController();
  String _invoiceCodeType = 'WITH_CODE';
  bool _obscure = true;
  bool _busy = false;
  String? _error;
  Map<String, dynamic>? _testResult;
  List<Map<String, dynamic>> _templates = [];
  String? _selectedTemplateId;

  @override
  void initState() {
    super.initState();
    _taxCodeCtrl = TextEditingController(text: oStr(widget.initial['taxCode']));
    _usernameCtrl =
        TextEditingController(text: oStr(widget.initial['username']));
    _invoiceCodeType = oStr(widget.initial['invoiceCodeType']) == 'WITHOUT_CODE'
        ? 'WITHOUT_CODE'
        : 'WITH_CODE';
    _selectedTemplateId = oStr(widget.initial['templateId']).isEmpty
        ? null
        : oStr(widget.initial['templateId']);
  }

  @override
  void dispose() {
    _taxCodeCtrl.dispose();
    _usernameCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  Map<String, dynamic> _draftConfig() => {
        ...widget.initial,
        'taxCode': _taxCodeCtrl.text.trim(),
        'username': _usernameCtrl.text.trim(),
        if (_passwordCtrl.text.isNotEmpty) 'password': _passwordCtrl.text,
        'invoiceType': 'CASH_REGISTER',
      };

  Future<void> _testConnection() async {
    if (_taxCodeCtrl.text.trim().isEmpty ||
        _usernameCtrl.text.trim().isEmpty ||
        _passwordCtrl.text.isEmpty) {
      setState(
          () => _error = t('Nhập đủ mã số thuế, tên đăng nhập và mật khẩu.'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _testResult = null;
    });
    try {
      final res = await context
          .read<ApiService>()
          .testIntegration('misa', _draftConfig());
      if (!mounted) return;
      final templates = oList(res['templates']);
      setState(() {
        _testResult = res;
        _templates = templates;
        _busy = false;
        if (res['company'] != null) {
          final withCode = oMap(res['company'])['invoiceWithCode'];
          if (withCode == true) _invoiceCodeType = 'WITH_CODE';
          if (withCode == false) _invoiceCodeType = 'WITHOUT_CODE';
        }
        final selected = oMap(res['selectedTemplate']);
        if (oStr(selected['id']).isNotEmpty) {
          _selectedTemplateId = oStr(selected['id']);
        } else if (_selectedTemplateId == null && templates.length == 1) {
          _selectedTemplateId = oStr(templates.first['id']);
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _connect() async {
    // Kết nối = kiểm tra thật rồi mới lưu — không lưu "Đã kết nối" khi MISA
    // chưa xác thực thành công.
    if (_testResult == null || _testResult?['ok'] != true) {
      await _testConnection();
      if (!mounted || _testResult?['ok'] != true) return;
    }
    if (_templates.isNotEmpty && _selectedTemplateId == null) {
      setState(() => _error = t('Chọn mẫu hóa đơn trước khi kết nối.'));
      return;
    }
    final pin = await settingsPin(context, t('Kết nối MISA meInvoice.'));
    if (pin == null || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final selectedTemplate = _templates.firstWhere(
        (t) => oStr(t['id']) == _selectedTemplateId,
        orElse: () => const {},
      );
      await context.read<ApiService>().saveIntegrations({
        'channels': {
          'misa': {
            ..._draftConfig(),
            'enabled': true,
            'invoiceCodeType': _invoiceCodeType,
            'templateId': _selectedTemplateId ?? '',
            'series': oStr(selectedTemplate['series']),
            'configurationTestPassed': true,
          }
        },
        'security_pin': pin,
      });
      if (!mounted) return;
      appToast(context, t('Đã kết nối MISA meInvoice'));
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(t('Thiết lập kết nối hóa đơn điện tử')),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(t('THÔNG TIN KẾT NỐI'),
                  style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w900,
                      letterSpacing: .5,
                      color: DanColors.faint)),
              const SizedBox(height: 10),
              TextField(
                controller: _taxCodeCtrl,
                keyboardType: TextInputType.number,
                decoration:
                    InputDecoration(labelText: t('Mã số thuế'), isDense: true),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _usernameCtrl,
                decoration: InputDecoration(
                    labelText: t('Tên đăng nhập MISA meInvoice'),
                    isDense: true),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _passwordCtrl,
                obscureText: _obscure,
                decoration: InputDecoration(
                  labelText: t('Mật khẩu'),
                  isDense: true,
                  suffixIcon: IconButton(
                    icon: Icon(
                        _obscure ? Icons.visibility_off : Icons.visibility,
                        size: 18),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Text(t('Hình thức hóa đơn'),
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              RadioGroup<String>(
                groupValue: _invoiceCodeType,
                onChanged: (v) {
                  if (v != null) setState(() => _invoiceCodeType = v);
                },
                child: Column(
                  children: [
                    RadioListTile<String>(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      title: Text(t('Hóa đơn có mã của cơ quan thuế')),
                      value: 'WITH_CODE',
                    ),
                    RadioListTile<String>(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      title: Text(t('Hóa đơn không có mã của cơ quan thuế')),
                      value: 'WITHOUT_CODE',
                    ),
                  ],
                ),
              ),
              if (_templates.isNotEmpty) ...[
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: _selectedTemplateId,
                  isExpanded: true,
                  decoration: InputDecoration(
                      labelText: t('Mẫu hóa đơn'),
                      isDense: true,
                      helperText:
                          t('Lấy trực tiếp từ MISA — ký hiệu đi kèm mẫu.'),
                      helperMaxLines: 2),
                  items: [
                    for (final tpl in _templates)
                      DropdownMenuItem(
                        value: oStr(tpl['id']),
                        child: Text(
                            '${oStr(tpl['name'])} · ${oStr(tpl['series'])}',
                            overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: (v) => setState(() => _selectedTemplateId = v),
                ),
              ],
              if (_testResult != null) ...[
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: (_testResult!['ok'] == true
                            ? DanColors.done
                            : DanColors.late)
                        .withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(oStr(_testResult!['message']),
                      style: TextStyle(
                          fontSize: 12.5,
                          color: _testResult!['ok'] == true
                              ? DanColors.done
                              : DanColors.late)),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 10),
                InlineMessage(_error!, error: true),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context, false),
          child: Text(t('Bỏ qua')),
        ),
        OutlinedButton(
          onPressed: _busy ? null : _testConnection,
          child: _busy
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : Text(t('Kiểm tra kết nối')),
        ),
        FilledButton(
          onPressed: _busy ? null : _connect,
          child: Text(t('Kết nối')),
        ),
      ],
    );
  }
}
