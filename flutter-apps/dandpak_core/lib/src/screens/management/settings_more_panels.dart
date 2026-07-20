import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;

import '../../app_defaults.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../warehouse/warehouse_screen.dart';
import 'management_widgets.dart';
import 'settings_tab.dart';
import '../../utils/translation.dart';

String _s(dynamic v) => v?.toString() ?? '';
bool _b(dynamic v) => v == true || v == 1 || v == '1';
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;

String _prettyField(String key) {
  final withSpaces = key
      .replaceAllMapped(RegExp(r'([A-Z])'), (m) => ' ${m[1]}')
      .replaceAll('_', ' ')
      .trim();
  if (withSpaces.isEmpty) return key;
  return withSpaces[0].toUpperCase() + withSpaces.substring(1);
}

bool _isSecret(String key) =>
    RegExp(r'password|secret|apikey|checksum|token', caseSensitive: false)
        .hasMatch(key);
bool _isMaskedSecretValue(String value) =>
    value.trim().startsWith('********') || RegExp(r'^•{4,}').hasMatch(value.trim());

// ── Integrations ─────────────────────────────────────────────────────────

class IntegrationDef {
  final String key;
  final String icon;
  final String name;
  final String desc;
  final String type;
  final String? channel;
  final String? imageAsset;
  final String? imageUrl;

  IntegrationDef({
    required this.key,
    required this.icon,
    required this.name,
    required this.desc,
    required this.type,
    this.channel,
    this.imageAsset,
    this.imageUrl,
  });
}

List<IntegrationDef> get _integrationDefs => [
      IntegrationDef(
          key: 'misa',
          icon: '🧾',
          name: 'MISA',
          desc: t(
              'Xuất hóa đơn điện tử, đồng bộ khách hàng và trạng thái hóa đơn.'),
          type: 'misa',
          imageAsset: 'assets/brand/MISA.jpg'),
      IntegrationDef(
          key: 'payos',
          icon: '💳',
          name: 'payOS',
          desc: t(
              'Cổng thanh toán QR/thẻ payOS — tạo link thanh toán và nhận webhook xác nhận đã thanh toán.'),
          type: 'payos',
          channel: 'payos',
          imageAsset: 'assets/brand/payoslogo.png'),
      IntegrationDef(
          key: 'vietqr',
          icon: '🇻🇳',
          name: 'VietQR API',
          desc: t(
              'Sinh mã QR thanh toán động cho từng bill iPad/POS và sẵn sàng đối soát khi VietQR callback.'),
          type: 'vietqr',
          channel: 'vietqr',
          imageAsset: 'assets/brand/vietqr.png'),
      IntegrationDef(
          key: 'sepay',
          icon: '🏦',
          name: t('SePay — tự đối soát chuyển khoản'),
          desc: t(
              'Đường B: đọc biến động số dư ngân hàng, khi khách chuyển khoản/quét VietQR đúng nội dung bill thì tự đóng bill. Rẻ nhất cho chuyển khoản.'),
          type: 'bank_webhook',
          channel: 'sepay',
          imageAsset: 'assets/brand/sepay.webp'),
      IntegrationDef(
          key: 'casso',
          icon: '🏦',
          name: t('Casso — tự đối soát chuyển khoản'),
          desc: t(
              'Đường B (phương án thay thế SePay): đọc giao dịch ngân hàng và bắn webhook xác nhận tiền về theo nội dung bill.'),
          type: 'bank_webhook',
          channel: 'casso',
          imageAsset: 'assets/brand/Casso.png'),
      IntegrationDef(
          key: 'grabmerchant',
          icon: '🟢',
          name: 'GrabMerchant / GrabFood',
          desc: t(
              'Nhận đơn, đồng bộ menu, trạng thái món và tồn khả dụng cho kênh Grab.'),
          type: 'delivery',
          channel: 'grabmerchant',
          imageAsset: 'assets/brand/grabmerchantlogo.webp'),
      IntegrationDef(
          key: 'shopeefood',
          icon: '🟠',
          name: 'Shopee Food',
          desc: t(
              'Nhận đơn Shopee Food, quản lý xác nhận đơn và đồng bộ món bán online.'),
          type: 'delivery',
          channel: 'shopeefood',
          imageAsset: 'assets/brand/shopeefoodlogo.png'),
      IntegrationDef(
          key: 'befood',
          icon: '🟡',
          name: 'Be / beFood',
          desc:
              t('Chuẩn bị cấu hình merchant, store và webhook cho đơn từ Be.'),
          type: 'delivery',
          channel: 'befood',
          imageAsset: 'assets/brand/befoodlogo.png'),
      IntegrationDef(
          key: 'grabmart',
          icon: '🛒',
          name: 'GrabMart',
          desc: t('Đồng bộ sản phẩm retail, tồn kho và đơn hàng mart.'),
          type: 'mart',
          channel: 'grabmart',
          imageAsset: 'assets/brand/grabmartlogo.png'),
      IntegrationDef(
          key: 'website',
          icon: '🌐',
          name: 'Website / QR order',
          desc: t(
              'Kênh đặt món từ website, QR bàn, landing page hoặc kiosk tự gọi món.'),
          type: 'website',
          channel: 'website',
          imageAsset: 'assets/brand/DanOnLogo.png'),
      IntegrationDef(
          key: 'haravan',
          icon: 'H',
          name: 'Haravan',
          desc: t('Kênh bán hàng online Haravan: nhận đơn, khách hàng, sản phẩm và tồn kho qua backend.'),
          type: 'haravan',
          channel: 'haravan',
          imageAsset: 'assets/brand/Haravan.png'),
    ];

Map<String, List<String>> _channelTextFields = {
  'misa': [
    'apiBase',
    'taxCode',
    'companyName',
    'username',
    'password',
    'appId',
    'secretKey'
  ],
  'payos': [
    'clientId',
    'apiKey',
    'checksumKey',
    'apiBase',
    'returnUrl',
    'cancelUrl'
  ],
  'vietqr': [
    'username',
    'password',
    'bankCode',
    'bankAccount',
    'userBankName',
    'terminalCode',
    'subTerminalCode',
    'serviceCode',
    'apiBase'
  ],
  'sepay': ['apiKey', 'accountNumber', 'bankCode'],
  'casso': ['webhookSecret', 'accountNumber'],
  'website': ['publicUrl', 'apiKey', 'webhookSecret'],
  'grabmerchant': [
    'merchantId',
    'storeId',
    'clientId',
    'clientSecret',
    'webhookSecret'
  ],
  'shopeefood': [
    'merchantId',
    'storeId',
    'clientId',
    'clientSecret',
    'webhookSecret'
  ],
  'befood': [
    'merchantId',
    'storeId',
    'clientId',
    'clientSecret',
    'webhookSecret'
  ],
  'grabmart': [
    'merchantId',
    'storeId',
    'clientId',
    'clientSecret',
    'webhookSecret'
  ],
  'haravan': [
    'shopDomain',
    'accessToken',
    'webhookSecret',
    'clientId',
    'clientSecret',
    'verifyToken',
    'locationId',
    'apiBase',
    'defaultBranchId'
  ],
};

String _fieldLabel(String key) {
  switch (key) {
    case 'apiBase':
      return 'API Base URL';
    case 'taxCode':
      return t('Mã số thuế');
    case 'companyName':
      return t('Tên công ty');
    case 'username':
      return t('Tài khoản / Username');
    case 'password':
      return t('Mật khẩu / Token / Password');
    case 'appId':
      return 'App ID';
    case 'secretKey':
      return 'Secret Key';
    case 'clientId':
      return 'Client ID (x-client-id)';
    case 'apiKey':
      return 'API Key (x-api-key / Authorization)';
    case 'checksumKey':
      return 'Checksum Key';
    case 'returnUrl':
      return t('Return URL (Thành công)');
    case 'cancelUrl':
      return t('Cancel URL (Hủy thanh toán)');
    case 'webhookSecret':
      return 'Webhook Secret / Secure Token';
    case 'verifyToken':
      return 'Webhook Verify Token';
    case 'accessToken':
      return 'Access Token';
    case 'locationId':
      return 'Haravan Location ID';
    case 'shopDomain':
      return 'Shop Domain';
    case 'defaultBranchId':
      return t('Chi nhánh mặc định');
    case 'accountNumber':
      return t('Số tài khoản nhận tiền');
    case 'bankCode':
      return t('Mã ngân hàng (VCB, MB, ACB...)');
    case 'publicUrl':
      return 'Public URL (Website)';
    case 'merchantId':
      return 'Merchant ID';
    case 'storeId':
      return 'Store ID';
    case 'clientSecret':
      return 'Client Secret';
    default:
  return _prettyField(key);
}
}

Widget _integrationLogo(IntegrationDef def, double size, double fallbackSize) {
  final url = def.imageUrl == null ? null : '${DanDpakDefaults.baseUrl}${def.imageUrl}';
  Widget fallback() => Text(def.icon, style: TextStyle(fontSize: fallbackSize));
  if (url != null) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(4),
      child: Image.network(
        url,
        width: size,
        height: size,
        fit: BoxFit.contain,
        errorBuilder: (context, error, stackTrace) => fallback(),
      ),
    );
  }
  if (def.imageAsset != null) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(4),
      child: Image.asset(
        def.imageAsset!,
        width: size,
        height: size,
        fit: BoxFit.contain,
        errorBuilder: (context, error, stackTrace) => fallback(),
      ),
    );
  }
  return fallback();
}

class IntegrationsPanel extends StatefulWidget {
  final ApiService api;
  IntegrationsPanel({super.key, required this.api});

  @override
  State<IntegrationsPanel> createState() => _IntegrationsPanelState();
}

class _IntegrationsPanelState extends State<IntegrationsPanel> {
  Map<String, Map<String, dynamic>> _channels = {};
  final Map<String, TextEditingController> _ctrls = {};
  bool _loading = true;
  bool _saving = false;
  String? _testingKey;
  String? _error;
  String _selectedKey = 'misa';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final cfg = await widget.api.getIntegrations();
      final channelsRaw = cfg['channels'];
      final channels = <String, Map<String, dynamic>>{};
      if (channelsRaw is Map) {
        channelsRaw.forEach((k, v) {
          if (v is Map) channels[k.toString()] = Map<String, dynamic>.from(v);
        });
      }
      for (final c in _ctrls.values) {
        c.dispose();
      }
      _ctrls.clear();

      for (final def in _integrationDefs) {
        final key = def.key;
        final conf = channels[key] ??= {};

        conf['enabled'] ??= false;

        final textFields = _channelTextFields[key] ?? [];
        for (final field in textFields) {
          final val = conf[field] ?? '';
          _ctrls['$key:$field'] = TextEditingController(
              text: _isSecret(field) && _isMaskedSecretValue(val.toString())
                  ? ''
                  : val.toString());
        }

        final noteVal = conf['note'] ?? '';
        _ctrls['$key:note'] = TextEditingController(text: noteVal.toString());

        if (key == 'misa') {
          conf['autoIssue'] ??= false;
          conf['syncInvoices'] ??= true;
          conf['syncCustomers'] ??= true;
        } else if (key == 'haravan') {
          conf['syncOrders'] ??= true;
          conf['syncProducts'] ??= true;
          conf['syncInventory'] ??= true;
          conf['printOnReceive'] ??= true;
        } else if (key == 'website') {
          conf['syncOrders'] ??= true;
          conf['syncMenu'] ??= true;
          conf['printOnReceive'] ??= true;
        } else if (def.type == 'delivery') {
          conf['syncOrders'] ??= true;
          conf['syncMenu'] ??= true;
          conf['syncInventory'] ??= false;
          conf['autoAccept'] ??= false;
          conf['printOnReceive'] ??= true;
        } else if (def.type == 'mart') {
          conf['syncOrders'] ??= true;
          conf['syncProducts'] ??= true;
          conf['syncInventory'] ??= true;
          conf['autoAccept'] ??= false;
          conf['printOnReceive'] ??= true;
        }

        if (key == 'website' || key == 'haravan' || def.type == 'delivery' || def.type == 'mart') {
          conf['orderMode'] ??= 'manual_confirm';
        }
      }

      if (!mounted) return;
      setState(() {
        _channels = channels;
        _loading = false;
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
    final pin =
        await settingsPin(context, t('Thay đổi cấu hình liên kết đối tác.'));
    if (pin == null) return;

    final out = <String, dynamic>{};
    _channels.forEach((ck, conf) {
      final merged = Map<String, dynamic>.from(conf);

      final textFields = _channelTextFields[ck] ?? [];
      for (final f in textFields) {
        final ctrl = _ctrls['$ck:$f'];
        if (ctrl != null) {
          final text = ctrl.text.trim();
          if (!_isSecret(f) || text.isNotEmpty) merged[f] = text;
        }
      }

      final noteCtrl = _ctrls['$ck:note'];
      if (noteCtrl != null) {
        merged['note'] = noteCtrl.text.trim();
      }

      final def = _integrationDefs.firstWhere((d) => d.key == ck);
      if (def.type != 'misa' && def.channel != null) {
        merged['channel'] = def.channel;
      }

      out[ck] = merged;
    });

    setState(() => _saving = true);
    try {
      await widget.api.saveIntegrations({
        'channels': out,
        'security_pin': pin,
      });
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Đã lưu liên kết')),
          backgroundColor: DanColors.text));
      _load();
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late));
    }
  }

  Future<void> _testConnection(IntegrationDef def) async {
    final testCfg = <String, dynamic>{
      'enabled': _channels[def.key]?['enabled'] ?? false,
    };

    final fields = _channelTextFields[def.key] ?? [];
    for (final f in fields) {
      final ctrl = _ctrls['${def.key}:$f'];
      if (ctrl != null) {
        testCfg[f] = ctrl.text.trim();
      }
    }

    final noteCtrl = _ctrls['${def.key}:note'];
    if (noteCtrl != null) {
      testCfg['note'] = noteCtrl.text.trim();
    }

    _channels[def.key]?.forEach((k, v) {
      if (k == 'enabled' || fields.contains(k) || k == 'note') return;
      testCfg[k] = v;
    });

    if (def.type != 'misa' && def.channel != null) {
      testCfg['channel'] = def.channel;
    }

    setState(() {
      _testingKey = def.key;
    });

    try {
      final res = await widget.api.testIntegration(def.key, testCfg);
      if (!mounted) return;

      final ok = res['ok'] != false;
      final msg = res['message'] ??
          (ok ? t('Kết nối thành công!') : t('Kết nối thất bại.'));

      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Row(
            children: [
              Icon(
                ok ? Icons.check_circle : Icons.error,
                color: ok ? DanColors.done : DanColors.late,
              ),
              SizedBox(width: 10),
              Text(ok ? t('Kiểm tra thành công') : t('Kiểm tra thất bại')),
            ],
          ),
          content: Text(msg.toString()),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: Text(t('Đóng')),
            ),
          ],
        ),
      );
    } catch (e) {
      if (!mounted) return;
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Row(
            children: [
              Icon(Icons.error, color: DanColors.late),
              SizedBox(width: 10),
              Text(t('Lỗi kết nối')),
            ],
          ),
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: Text(t('Đóng')),
            ),
          ],
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _testingKey = null;
        });
      }
    }
  }

  Widget _buildDetailsPane() {
    final def = _integrationDefs.firstWhere((d) => d.key == _selectedKey);
    final conf = _channels[def.key] ?? {};
    final enabled = _b(conf['enabled']);

    String webhookUrl = '';
    if (def.key == 'payos') {
      webhookUrl = '${widget.api.baseUrl}/api/payos/webhook';
    } else if (def.key == 'vietqr') {
      webhookUrl = '${widget.api.baseUrl}/api/vietqr/webhook';
    } else if (def.key == 'sepay' || def.key == 'casso') {
      webhookUrl = '${widget.api.baseUrl}/api/${def.key}/webhook';
    } else if (def.key == 'haravan') {
      webhookUrl = '${widget.api.baseUrl}/webhooks/haravan';
    } else {
      webhookUrl = '${widget.api.baseUrl}/api/online/webhook';
    }

    final fields = _channelTextFields[def.key] ?? [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  padding: EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: DanColors.surface2,
                    border: Border.all(color: DanColors.border),
                    borderRadius: BorderRadius.circular(DanRadius.md),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 56,
                        height: 56,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: DanColors.surface,
                          borderRadius: BorderRadius.circular(DanRadius.md),
                          border: Border.all(color: DanColors.border),
                        ),
                        child: _integrationLogo(def, 38, 28),
                      ),
                      SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              def.name,
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            SizedBox(height: 4),
                            Text(
                              def.desc,
                              style: TextStyle(
                                fontSize: 12.5,
                                color: DanColors.muted,
                                height: 1.4,
                              ),
                            ),
                          ],
                        ),
                      ),
                      SizedBox(width: 16),
                      Switch(
                        value: enabled,
                        activeThumbColor: DanColors.done,
                        onChanged: (v) {
                          setState(() {
                            conf['enabled'] = v;
                          });
                        },
                      ),
                    ],
                  ),
                ),
                SizedBox(height: 16),
                if (def.type != 'misa') ...[
                  Container(
                    padding: EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Color(0xFFF1F5F9),
                      border: Border.all(color: DanColors.border),
                      borderRadius: BorderRadius.circular(DanRadius.md),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                webhookUrl,
                                style: TextStyle(
                                  fontFamily: 'JetBrains Mono',
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFF334155),
                                ),
                              ),
                            ),
                            SizedBox(width: 10),
                            ElevatedButton(
                              style: ElevatedButton.styleFrom(
                                padding: EdgeInsets.symmetric(
                                    horizontal: 14, vertical: 8),
                                minimumSize: Size.zero,
                                textStyle: TextStyle(
                                    fontSize: 12, fontWeight: FontWeight.bold),
                              ),
                              onPressed: () {
                                Clipboard.setData(
                                    ClipboardData(text: webhookUrl));
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text(t(
                                        'Đã sao chép Webhook URL vào bộ nhớ tạm')),
                                    backgroundColor: DanColors.text,
                                  ),
                                );
                              },
                              child: Text('Copy'),
                            ),
                          ],
                        ),
                        SizedBox(height: 8),
                        Text(
                          _webhookHintText(def),
                          style: TextStyle(
                            fontSize: 11.5,
                            color: Color(0xFF64748B),
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(height: 16),
                ],
                if (fields.isNotEmpty) ...[
                  Text(
                    t('CẤU HÌNH CHI TIẾT'),
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w900,
                      letterSpacing: .5,
                      color: DanColors.faint,
                    ),
                  ),
                  SizedBox(height: 10),
                  GridView.builder(
                    shrinkWrap: true,
                    physics: NeverScrollableScrollPhysics(),
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      crossAxisSpacing: 16,
                      mainAxisSpacing: 12,
                      mainAxisExtent: 68,
                    ),
                    itemCount: fields.length,
                    itemBuilder: (ctx, i) {
                      final field = fields[i];
                      final savedMask =
                          _isSecret(field) && _isMaskedSecretValue(_s(conf[field]))
                              ? _s(conf[field]).trim()
                              : null;
                      return TextField(
                        controller: _ctrls['${def.key}:$field'],
                        obscureText: _isSecret(field),
                        decoration: InputDecoration(
                          labelText: _fieldLabel(field),
                          // Secret đã lưu trên server: label luôn nổi + hiện mask
                          // thường trực để không bị tưởng nhầm là chưa điền
                          // (hint bị label che khi ô trống chưa focus).
                          hintText: savedMask,
                          floatingLabelBehavior:
                              savedMask != null ? FloatingLabelBehavior.always : null,
                          suffixIcon: savedMask != null
                              ? Tooltip(
                                  message: t('Đã lưu trên server — để trống nếu giữ nguyên'),
                                  child: Icon(Icons.check_circle,
                                      size: 18, color: Color(0xFF10B981)),
                                )
                              : null,
                          isDense: true,
                        ),
                      );
                    },
                  ),
                  SizedBox(height: 16),
                ],
                _buildAdditionalControls(def, conf),
                _buildGuidePanel(def),
                SizedBox(height: 16),
                Text(
                  t('GHI CHÚ NỘI BỘ'),
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .5,
                    color: DanColors.faint,
                  ),
                ),
                SizedBox(height: 10),
                TextField(
                  controller: _ctrls['${def.key}:note'],
                  maxLines: 2,
                  decoration: InputDecoration(
                    labelText:
                        t('Ghi chú phục vụ đối soát, vận hành nội bộ...'),
                    isDense: true,
                  ),
                ),
                SizedBox(height: 20),
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: DanColors.text,
                      side: BorderSide(color: DanColors.border),
                      padding:
                          EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    ),
                    onPressed:
                        _testingKey != null ? null : () => _testConnection(def),
                    icon: _testingKey == def.key
                        ? SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: DanColors.text,
                            ),
                          )
                        : Icon(Icons.bolt, size: 16),
                    label: Text(_testingKey == def.key
                        ? t('Đang kiểm tra...')
                        : t('Kiểm tra cấu hình')),
                  ),
                ),
                SizedBox(height: 30),
              ],
            ),
          ),
        ),
        Container(
          padding: EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: DanColors.surface,
            border: Border(top: BorderSide(color: DanColors.border)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: _saving
                    ? SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : Icon(Icons.save, size: 18),
                label: Text(t('Lưu kết nối đang chọn')),
                style: FilledButton.styleFrom(minimumSize: Size(0, 44)),
              ),
            ],
          ),
        ),
      ],
    );
  }

  String _webhookHintText(IntegrationDef def) {
    if (def.key == 'payos') {
      return t(
          'Dán URL này vào payOS Dashboard → Kênh thanh toán → Cấu hình Webhook. payOS sẽ gọi về đây khi khách thanh toán xong.');
    }
    if (def.key == 'vietqr') {
      return t(
          'Tự đóng bill bằng chính VietQR: nếu gói VietQR của bạn có callback, dán URL này vào mục đăng ký callback của VietQR. Khi khách trả tiền, VietQR gọi về đây → hệ thống tự đóng đúng bill (khớp theo nội dung DANBILL+mã bill). Khi đó không cần SePay. VietQR thường gửi kèm Basic Auth = chính username/password ở trên.');
    }
    if (def.key == 'sepay') {
      return t(
          'Dán URL này vào SePay → Tích hợp → Cấu hình Webhooks. SePay gửi kèm header Authorization: Apikey <API Key>. Khi tiền về khớp nội dung DANBILL+mã bill và đủ tiền, hệ thống tự đóng bill + in hoá đơn.');
    }
    if (def.key == 'casso') {
      return t(
          'Dán URL này vào Casso → Cấu hình Webhook. Casso gửi kèm header secure-token = secret bên dưới. Khi tiền về khớp nội dung DANBILL+mã bill và đủ tiền, hệ thống tự đóng bill + in hoá đơn.');
    }
    if (def.key == 'haravan') {
      return t('Webhook Haravan dùng URL /webhooks/haravan. Token và webhook secret chỉ lưu trên server, không đưa xuống POS.');
    }
    if (def.key == 'website') {
      return t(
          'Webhook nhận JSON có field channel="website". Tắt kết nối này thì website/kênh bán hàng sẽ không gửi đơn được.');
    }
    return t(
        'Webhook hiện tại nhận JSON có field channel="${def.key}". Sau này khi có API chính thức, adapter của từng bên sẽ đọc cùng cấu hình này.');
  }

  Widget _buildAdditionalControls(
      IntegrationDef def, Map<String, dynamic> conf) {
    final checkboxes = <Widget>[];

    Widget? dropdown;
    if (def.key == 'website' || def.key == 'haravan' || def.type == 'delivery' || def.type == 'mart') {
      dropdown = Padding(
        padding: EdgeInsets.only(bottom: 16),
        child: DropdownButtonFormField<String>(
          initialValue: conf['orderMode'],
          decoration:
              InputDecoration(labelText: t('Cách nhận đơn'), isDense: true),
          items: [
            DropdownMenuItem(
                value: 'manual_confirm', child: Text(t('Nhân viên xác nhận'))),
            DropdownMenuItem(
                value: 'auto_confirm',
                child: Text(t('Tự xác nhận nếu còn hàng'))),
          ],
          onChanged: (val) {
            setState(() {
              conf['orderMode'] = val;
            });
          },
        ),
      );
    }

    if (def.key == 'misa') {
      checkboxes.addAll([
        _buildCheckboxRow(
            conf, 'autoIssue', t('Tự phát hành hóa đơn sau thanh toán')),
        _buildCheckboxRow(
            conf, 'syncInvoices', t('Đồng bộ trạng thái hóa đơn')),
        _buildCheckboxRow(
            conf, 'syncCustomers', t('Đồng bộ thông tin khách hàng')),
      ]);
    } else if (def.key == 'haravan') {
      checkboxes.addAll([
        _buildCheckboxRow(conf, 'syncOrders', t('Nhận và đồng bộ đơn hàng')),
        _buildCheckboxRow(conf, 'syncProducts', t('Đồng bộ sản phẩm')),
        _buildCheckboxRow(conf, 'syncInventory', t('Đồng bộ tồn kho')),
        _buildCheckboxRow(conf, 'printOnReceive', t('Tự in khi có đơn mới')),
      ]);
    } else if (def.key == 'website') {
      checkboxes.addAll([
        _buildCheckboxRow(conf, 'syncOrders', t('Nhận và đồng bộ đơn hàng')),
        _buildCheckboxRow(conf, 'syncMenu', t('Đồng bộ menu')),
        _buildCheckboxRow(conf, 'printOnReceive', t('Tự in khi có đơn mới')),
      ]);
    } else if (def.type == 'delivery') {
      checkboxes.addAll([
        _buildCheckboxRow(conf, 'syncOrders', t('Nhận và đồng bộ đơn hàng')),
        _buildCheckboxRow(conf, 'syncMenu', t('Đồng bộ menu')),
        _buildCheckboxRow(conf, 'syncInventory', t('Đồng bộ tồn kho')),
        _buildCheckboxRow(conf, 'autoAccept', t('Tự nhận đơn hợp lệ')),
        _buildCheckboxRow(conf, 'printOnReceive', t('Tự in khi có đơn mới')),
      ]);
    } else if (def.type == 'mart') {
      checkboxes.addAll([
        _buildCheckboxRow(conf, 'syncOrders', t('Nhận và đồng bộ đơn hàng')),
        _buildCheckboxRow(conf, 'syncProducts', t('Đồng bộ sản phẩm')),
        _buildCheckboxRow(conf, 'syncInventory', t('Đồng bộ tồn kho')),
        _buildCheckboxRow(conf, 'autoAccept', t('Tự nhận đơn hợp lệ')),
        _buildCheckboxRow(conf, 'printOnReceive', t('Tự in khi có đơn mới')),
      ]);
    }

    if (checkboxes.isEmpty && dropdown == null) return SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (dropdown != null) dropdown,
        if (checkboxes.isNotEmpty) ...[
          Text(
            t('THIẾT LẬP TÍNH NĂNG'),
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w900,
              letterSpacing: .5,
              color: DanColors.faint,
            ),
          ),
          SizedBox(height: 6),
          ...checkboxes,
          SizedBox(height: 16),
        ],
      ],
    );
  }

  Widget _buildCheckboxRow(
      Map<String, dynamic> conf, String field, String label) {
    final val = _b(conf[field]);
    return CheckboxListTile(
      contentPadding: EdgeInsets.zero,
      value: val,
      title: Text(label, style: TextStyle(fontSize: 13.5)),
      onChanged: (v) {
        setState(() {
          conf[field] = v;
        });
      },
      controlAffinity: ListTileControlAffinity.leading,
    );
  }

  Widget _buildGuidePanel(IntegrationDef def) {
    List<String> steps = [];
    String title = '';

    if (def.key == 'payos') {
      title = t('Đường dẫn API payOS (soạn sẵn để nối sau)');
      steps = [
        t('Tạo link thanh toán: POST /v2/payment-requests'),
        t('Lấy thông tin đơn: GET /v2/payment-requests/{id}'),
        t('Huỷ link thanh toán: POST /v2/payment-requests/{id}/cancel'),
        t('Đăng ký webhook: POST /confirm-webhook'),
        t('Header bắt buộc mọi request: x-client-id + x-api-key'),
        t('Xác thực dữ liệu webhook: ký HMAC-SHA256 bằng Checksum Key rồi so với field signature')
      ];
    } else if (def.key == 'vietqr') {
      title = t('Luồng VietQR API đang dùng');
      steps = [
        t('Lấy token: POST /token_generate'),
        t('Tạo QR động: POST /qr/generate-customer'),
        t('iPad sẽ gửi order hiện tại lên backend, backend tạo content/orderId riêng cho bill rồi trả QR về màn hình phụ.'),
        t('Nếu credential chưa đủ hoặc API lỗi, hệ thống vẫn dùng QR public từ thông tin ngân hàng để không đứng bill.')
      ];
    } else if (def.key == 'sepay' || def.key == 'casso') {
      title = t('Cách hoạt động (Đường B — tự đối soát)');
      steps = [
        t('Khách quét QR VietQR và chuyển khoản kèm nội dung DANBILL+mã bill (sinh tự động trên màn thanh toán).'),
        t('${def.name} phát hiện tiền về tài khoản → gọi Webhook URL ở trên.'),
        t('Hệ thống khớp đúng bill theo nội dung; đủ tiền thì tự đóng bill, in hoá đơn, đẩy realtime cho POS/iPad.'),
        t('Giao dịch không khớp / chưa đủ tiền được ghi vào nhật ký để đối soát thủ công.')
      ];
    }

    if (steps.isEmpty) return SizedBox.shrink();

    return Padding(
      padding: EdgeInsets.only(bottom: 16),
      child: Container(
        padding: EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: DanColors.surface2,
          borderRadius: BorderRadius.circular(DanRadius.md),
          border: Border.all(color: DanColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 12.5,
              ),
            ),
            SizedBox(height: 8),
            ...steps.map((s) => Padding(
                  padding: EdgeInsets.only(bottom: 5),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('• ', style: TextStyle(fontWeight: FontWeight.bold)),
                      Expanded(
                        child: Text(
                          s,
                          style: TextStyle(fontSize: 12, height: 1.4),
                        ),
                      ),
                    ],
                  ),
                )),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: t('Liên kết'),
      onRefresh: _load,
      child: settingsState(
        loading: _loading && _channels.isEmpty,
        error: _channels.isEmpty ? _error : null,
        onRetry: _load,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              width: 300,
              decoration: BoxDecoration(
                border: Border(
                  right: BorderSide(color: DanColors.border),
                ),
              ),
              child: ListView.builder(
                itemCount: _integrationDefs.length,
                itemBuilder: (context, index) {
                  final def = _integrationDefs[index];
                  final isSelected = def.key == _selectedKey;
                  final conf = _channels[def.key] ?? {};
                  final enabled = _b(conf['enabled']);

                  return InkWell(
                    onTap: () {
                      setState(() {
                        _selectedKey = def.key;
                      });
                    },
                    child: Container(
                      color:
                          isSelected ? DanColors.surface2 : Colors.transparent,
                      padding:
                          EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                      child: Row(
                        children: [
                          Container(
                            width: 36,
                            height: 36,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: DanColors.surface,
                              borderRadius: BorderRadius.circular(DanRadius.sm),
                              border: Border.all(color: DanColors.border),
                            ),
                            child: _integrationLogo(def, 24, 18),
                          ),
                          SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  def.name,
                                  style: TextStyle(
                                    fontWeight: isSelected
                                        ? FontWeight.w800
                                        : FontWeight.w600,
                                    fontSize: 14,
                                    color: DanColors.text,
                                  ),
                                ),
                                SizedBox(height: 2),
                                Text(
                                  enabled ? t('Đã kết nối') : t('Chưa kết nối'),
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: enabled
                                        ? DanColors.done
                                        : DanColors.faint,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            Expanded(
              child: _buildDetailsPane(),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Warehouse & sales channels (Kho & kênh bán) ─────────────────────────────

class WarehouseSettingsPanel extends StatefulWidget {
  final ApiService api;
  WarehouseSettingsPanel({super.key, required this.api});

  @override
  State<WarehouseSettingsPanel> createState() => _WarehouseSettingsPanelState();
}

class _WarehouseSettingsPanelState extends State<WarehouseSettingsPanel> {
  List<Map<String, dynamic>> _warehouses = [];
  // Bảng giá (KiotViet): quản lý ở đây, dùng trong Kho → Thiết lập giá.
  List<Map<String, dynamic>> _priceBooks = [];
  // Cấu hình bán retail: kho + bảng giá cho Retail POS và Retail-trong-F&B;
  // sync=true → 2 bên dùng chung cấu hình (tick "đồng bộ cả 2").
  Map<String, dynamic> _retailCfg = {
    'sync': true,
    'standalone': {'warehouse_id': '', 'price_book_id': 'default'},
    'fnb': {'warehouse_id': '', 'price_book_id': 'default'},
  };
  bool _savingRetailCfg = false;
  bool _loading = true;
  String? _error;

  // Selected warehouse ID. If null, we are in "Create new warehouse" mode.
  String? _selectedId;

  // Form controllers and state
  final _nameCtrl = TextEditingController();
  final _codeCtrl = TextEditingController();
  final _sortCtrl = TextEditingController();
  String _type = 'retail';
  bool _active = true;
  Set<String> _selectedChannels = {'retail'};

  static List<(String, String)> _allChannels = [
    ('ipad', 'iPad self-order'),
    ('pos', t('POS nhà hàng')),
    ('retail', 'Retail POS'),
    ('online', t('Kênh online chung')),
    ('grabmerchant', 'GrabFood / GrabMerchant'),
    ('shopeefood', 'ShopeeFood'),
    ('befood', 'beFood'),
    ('grabmart', 'GrabMart'),
    ('website', 'Website order'),
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _codeCtrl.dispose();
    _sortCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final rows = await widget.api.getWarehouses();
      List<Map<String, dynamic>> books = [];
      try {
        books = (await widget.api.getPriceBooks())
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      } catch (_) {
        // Server cũ chưa có API bảng giá — vẫn hiện phần Kho bình thường.
      }
      try {
        final st = await widget.api.getAppSettings();
        if (st['retail_config'] is Map) {
          _retailCfg = _normalizeRetailCfg(
              Map<String, dynamic>.from(st['retail_config']));
        }
      } catch (_) {
        // Server cũ chưa có retail_config — dùng mặc định.
      }
      if (!mounted) return;
      setState(() {
        _priceBooks = books;
        _warehouses = rows
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _loading = false;
        _error = null;

        // If we had a selected ID, check if it still exists, otherwise clear selection
        if (_selectedId != null &&
            !_warehouses.any((w) => _s(w['id']) == _selectedId)) {
          _selectedId = null;
        }

        // Set form baseline from selected warehouse or default to new
        if (_selectedId != null) {
          final wh = _warehouses.firstWhere((w) => _s(w['id']) == _selectedId);
          _selectWarehouse(wh);
        } else {
          _selectWarehouse(null);
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  void _selectWarehouse(Map<String, dynamic>? wh) {
    setState(() {
      if (wh == null) {
        _selectedId = null;
        _nameCtrl.text = '';
        _codeCtrl.text = '';
        _sortCtrl.text = '';
        _type = 'retail';
        _active = true;
        _selectedChannels = {'retail'};
      } else {
        _selectedId = _s(wh['id']);
        _nameCtrl.text = _s(wh['name']);
        _codeCtrl.text = _s(wh['code']);
        _sortCtrl.text = wh['sort'] != null ? _s(wh['sort']) : '';
        _type = _s(wh['type']) == 'kitchen' ? 'kitchen' : 'retail';
        _active = _b(wh['active']);

        final channelsList = wh['sales_channels'] as List?;
        _selectedChannels = channelsList != null
            ? channelsList.map((e) => _s(e)).toSet()
            : <String>{};
      }
    });
  }

  void _onTypeChanged(String? newType) {
    if (newType == null) return;
    setState(() {
      _type = newType;
      // Auto-toggle default channels only when in creation mode
      if (_selectedId == null) {
        if (newType == 'kitchen') {
          _selectedChannels = {'ipad', 'pos'};
        } else {
          _selectedChannels = {'retail'};
        }
      }
    });
  }

  void _toast(String m, {bool error = false}) =>
      appToast(context, m, isError: error);

  Future<void> _save() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) {
      _toast(t('Nhập tên kho'), error: true);
      return;
    }

    final code = _codeCtrl.text.trim();
    final sortText = _sortCtrl.text.trim();
    int? sort;
    if (sortText.isNotEmpty) {
      sort = int.tryParse(sortText) ?? 0;
    }

    final reason = _selectedId == null
        ? t('Tạo kho "$name".')
        : t('Cập nhật kho "$name".');

    final pin = await settingsPin(context, reason);
    if (pin == null) {
      _toast(t('Đã hủy lưu cấu hình kho'), error: true);
      return;
    }

    try {
      final body = <String, dynamic>{
        'name': name,
        'code': code,
        'type': _type,
        'active': _active,
        'sales_channels': _selectedChannels.toList(),
        'security_pin': pin,
      };
      if (sort != null) {
        body['sort'] = sort;
      }

      if (_selectedId == null) {
        await widget.api.createWarehouse(body);
      } else {
        await widget.api.updateWarehouse(_selectedId!, body);
      }

      _toast(t('Đã lưu cấu hình kho'));

      // Reset selected ID and reload
      _selectedId = null;
      await _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  Widget _buildChannelBadges(Map<String, dynamic> w) {
    final channelsList = w['sales_channels'] as List?;
    if (channelsList == null || channelsList.isEmpty) {
      return Text(
        t('Chưa nối kênh bán hàng'),
        style: TextStyle(fontSize: 11, color: DanColors.faint),
      );
    }

    return Wrap(
      spacing: 4,
      runSpacing: 4,
      children: channelsList.map((c) {
        final key = _s(c);
        final found = _allChannels.firstWhere((ch) => ch.$1 == key,
            orElse: () => ('', key));
        return Container(
          padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: DanColors.doing.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(4),
          ),
          child: Text(
            found.$2,
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.bold,
              color: Color(
                  0xFFB45309), // Dark amber text for readability on light background
            ),
          ),
        );
      }).toList(),
    );
  }

  // ── Bảng giá: danh sách + tạo/sửa/tắt/xóa ────────────────────────────────
  Widget _priceBooksSection() {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 12, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.sell_outlined, size: 16, color: DanColors.muted),
              SizedBox(width: 6),
              Text(t('Bảng giá'),
                  style:
                      TextStyle(fontSize: 13.5, fontWeight: FontWeight.w900)),
              Spacer(),
              TextButton.icon(
                onPressed: () => _editPriceBook(),
                icon: Icon(Icons.add, size: 16),
                label: Text(t('Tạo bảng giá')),
                style: TextButton.styleFrom(
                    padding: EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: Size(0, 32)),
              ),
            ],
          ),
          Text(t('Chọn bảng giá khi bán / xem trong Kho → Thiết lập giá'),
              style: TextStyle(fontSize: 10.5, color: DanColors.faint)),
          SizedBox(height: 8),
          ConstrainedBox(
            constraints: BoxConstraints(maxHeight: 190),
            child: ListView(
              shrinkWrap: true,
              padding: EdgeInsets.zero,
              children: [
                for (final b in _priceBooks)
                  Padding(
                    padding: EdgeInsets.only(bottom: 6),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            _s(b['name']) +
                                (_n(b['item_count']) > 0
                                    ? ' · ${_n(b['item_count']).toInt()} giá riêng'
                                    : ''),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w700,
                                color: _s(b['status']) == 'inactive'
                                    ? DanColors.faint
                                    : DanColors.text),
                          ),
                        ),
                        if (_b(b['builtin']))
                          Container(
                            padding: EdgeInsets.symmetric(
                                horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                                color: DanColors.brandDim,
                                borderRadius: BorderRadius.circular(99)),
                            child: Text(t('Mặc định'),
                                style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w800,
                                    color: DanColors.brand)),
                          )
                        else ...[
                          IconButton(
                            tooltip: t('Đổi tên'),
                            visualDensity: VisualDensity.compact,
                            onPressed: () => _editPriceBook(existing: b),
                            icon: Icon(Icons.edit_outlined,
                                size: 16, color: DanColors.muted),
                          ),
                          SizedBox(
                            height: 24,
                            child: Switch(
                              value: _s(b['status']) != 'inactive',
                              activeThumbColor: DanColors.brand,
                              onChanged: (v) => _savePriceBook({
                                'id': b['id'],
                                'name': b['name'],
                                'status': v ? 'active' : 'inactive',
                              }),
                            ),
                          ),
                          IconButton(
                            tooltip: t('Xóa bảng giá'),
                            visualDensity: VisualDensity.compact,
                            onPressed: () => _deletePriceBook(b),
                            icon: Icon(Icons.delete_outline,
                                size: 16, color: DanColors.late),
                          ),
                        ],
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Cấu hình bán retail: kho + bảng giá cho Retail POS / Retail-F&B ──────
  Map<String, dynamic> _normalizeRetailCfg(Map<String, dynamic> raw) {
    Map<String, dynamic> sec(dynamic v) => {
          'warehouse_id': _s(v is Map ? v['warehouse_id'] : ''),
          'price_book_id': _s(v is Map ? v['price_book_id'] : '').isEmpty
              ? 'default'
              : _s(v is Map ? v['price_book_id'] : 'default'),
        };
    return {
      'sync': raw['sync'] != false,
      'standalone': sec(raw['standalone']),
      'fnb': sec(raw['fnb']),
    };
  }

  Future<void> _saveRetailCfg() async {
    if (_savingRetailCfg) return;
    setState(() => _savingRetailCfg = true);
    try {
      await widget.api.saveAppSettings({'retail_config': _retailCfg});
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late));
    } finally {
      if (mounted) setState(() => _savingRetailCfg = false);
    }
  }

  Widget _retailConfigSection() {
    final sync = _retailCfg['sync'] != false;
    final retailWhs =
        _warehouses.where((w) => _s(w['type']) != 'kitchen').toList();
    final activeBooks = _priceBooks
        .where((b) =>
            _s(b['status']) != 'inactive' || _b(b['builtin']))
        .toList();

    Widget sectionRow(String label, String key, {required bool enabled}) {
      final sec = Map<String, dynamic>.from(_retailCfg[key] as Map? ?? {});
      final whValue = retailWhs.any((w) => _s(w['id']) == _s(sec['warehouse_id']))
          ? _s(sec['warehouse_id'])
          : '';
      final bookValue =
          activeBooks.any((b) => _s(b['id']) == _s(sec['price_book_id']))
              ? _s(sec['price_book_id'])
              : 'default';
      void update(String field, String value) {
        sec[field] = value;
        setState(() {
          _retailCfg[key] = sec;
          if (_retailCfg['sync'] != false && key == 'standalone') {
            _retailCfg['fnb'] = Map<String, dynamic>.from(sec);
          }
        });
        _saveRetailCfg();
      }

      return Padding(
        padding: EdgeInsets.only(bottom: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label,
                style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w800,
                    color: enabled ? DanColors.muted : DanColors.faint)),
            SizedBox(height: 5),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: whValue,
                    isExpanded: true,
                    decoration: InputDecoration(
                        labelText: t('Kho'),
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(
                            horizontal: 8, vertical: 6)),
                    items: [
                      DropdownMenuItem(
                          value: '', child: Text(t('Theo kênh bán'))),
                      for (final w in retailWhs)
                        DropdownMenuItem(
                            value: _s(w['id']),
                            child: Text(_s(w['name']),
                                overflow: TextOverflow.ellipsis)),
                    ],
                    onChanged: enabled
                        ? (v) => update('warehouse_id', v ?? '')
                        : null,
                  ),
                ),
                SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: bookValue,
                    isExpanded: true,
                    decoration: InputDecoration(
                        labelText: t('Bảng giá'),
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(
                            horizontal: 8, vertical: 6)),
                    items: [
                      for (final b in activeBooks)
                        DropdownMenuItem(
                            value: _s(b['id']),
                            child: Text(_s(b['name']),
                                overflow: TextOverflow.ellipsis)),
                    ],
                    onChanged: enabled
                        ? (v) => update('price_book_id', v ?? 'default')
                        : null,
                  ),
                ),
              ],
            ),
          ],
        ),
      );
    }

    return Padding(
      padding: EdgeInsets.fromLTRB(16, 12, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.shopping_cart_outlined,
                  size: 16, color: DanColors.muted),
              SizedBox(width: 6),
              Text(t('Cấu hình bán retail'),
                  style:
                      TextStyle(fontSize: 13.5, fontWeight: FontWeight.w900)),
              if (_savingRetailCfg) ...[
                SizedBox(width: 8),
                SizedBox(
                    width: 12,
                    height: 12,
                    child: CircularProgressIndicator(strokeWidth: 2)),
              ],
            ],
          ),
          SizedBox(height: 4),
          // Tick đồng bộ: Retail POS và Retail-trong-F&B dùng chung cấu hình.
          InkWell(
            onTap: () {
              setState(() {
                final next = !(_retailCfg['sync'] != false);
                _retailCfg['sync'] = next;
                if (next) {
                  _retailCfg['fnb'] = Map<String, dynamic>.from(
                      _retailCfg['standalone'] as Map);
                }
              });
              _saveRetailCfg();
            },
            child: Row(
              children: [
                Icon(sync ? Icons.check_box : Icons.check_box_outline_blank,
                    size: 17,
                    color: sync ? DanColors.brand : DanColors.faint),
                SizedBox(width: 6),
                Expanded(
                  child: Text(
                      t('Đồng bộ cả 2 (F&B dùng y cấu hình Retail POS)'),
                      style: TextStyle(
                          fontSize: 12, fontWeight: FontWeight.w700)),
                ),
              ],
            ),
          ),
          SizedBox(height: 10),
          sectionRow(t('RETAIL POS (bán lẻ)'), 'standalone', enabled: true),
          sectionRow(t('RETAIL TRONG F&B (thêm retail ở POS nhà hàng)'), 'fnb',
              enabled: !sync),
        ],
      ),
    );
  }

  Future<void> _editPriceBook({Map<String, dynamic>? existing}) async {
    final ctrl = TextEditingController(text: _s(existing?['name']));
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(existing == null ? t('Tạo bảng giá') : t('Đổi tên bảng giá'),
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
        content: SizedBox(
          width: 340,
          child: TextField(
            controller: ctrl,
            autofocus: true,
            decoration: InputDecoration(
                labelText: t('Tên bảng giá'),
                hintText: t('VD: Giá sỉ, Giá GrabMart…')),
            onSubmitted: (_) => Navigator.of(ctx).pop(true),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(t('Hủy'))),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text(t('Lưu'))),
        ],
      ),
    );
    final name = ctrl.text.trim();
    ctrl.dispose();
    if (ok != true || name.isEmpty) return;
    await _savePriceBook({
      if (existing != null) 'id': existing['id'],
      'name': name,
      if (existing != null) 'status': existing['status'],
    });
  }

  Future<void> _savePriceBook(Map<String, dynamic> body) async {
    try {
      await widget.api.savePriceBook(body);
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late));
    }
  }

  Future<void> _deletePriceBook(Map<String, dynamic> b) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(t('Xóa bảng giá'),
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
        content: Text(t(
            'Xóa "${_s(b['name'])}"? Mọi giá riêng trong bảng này sẽ mất, sản phẩm quay về giá chung.')),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(t('Hủy'))),
          FilledButton(
              style: FilledButton.styleFrom(backgroundColor: DanColors.late),
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text(t('Xóa'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.api.deletePriceBook(_s(b['id']));
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: t('Kho & kênh bán'),
      onRefresh: _load,
      child: settingsState(
        loading: _loading && _warehouses.isEmpty,
        error: _warehouses.isEmpty ? _error : null,
        onRetry: _load,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Left Side: List of warehouses
            Container(
              width: 380,
              decoration: BoxDecoration(
                border: Border(
                  right: BorderSide(color: DanColors.border),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: ListView.separated(
                padding: EdgeInsets.all(16),
                itemCount: _warehouses.length,
                separatorBuilder: (_, __) => SizedBox(height: 8),
                itemBuilder: (_, i) {
                  final w = _warehouses[i];
                  final isSelected = _s(w['id']) == _selectedId;
                  final kitchen = _s(w['type']) == 'kitchen';
                  final active = _b(w['active']);

                  return InkWell(
                    onTap: () => _selectWarehouse(w),
                    borderRadius: BorderRadius.circular(DanRadius.md),
                    child: Container(
                      padding:
                          EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      decoration: BoxDecoration(
                        color:
                            isSelected ? DanColors.brandDim : DanColors.surface,
                        border: Border.all(
                          color:
                              isSelected ? DanColors.brand : DanColors.border,
                          width: isSelected ? 1.5 : 1,
                        ),
                        borderRadius: BorderRadius.circular(DanRadius.md),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Padding(
                            padding: EdgeInsets.only(top: 2),
                            child: Icon(
                              kitchen
                                  ? Icons.soup_kitchen_outlined
                                  : Icons.storefront_outlined,
                              size: 22,
                              color: isSelected
                                  ? DanColors.brand
                                  : DanColors.muted,
                            ),
                          ),
                          SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _s(w['name']),
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: isSelected
                                        ? FontWeight.w900
                                        : FontWeight.w800,
                                    color: DanColors.text,
                                  ),
                                ),
                                SizedBox(height: 3),
                                Text(
                                  '${kitchen ? t('Kho bếp') : t('Kho retail')} · ${_s(w['code']).isNotEmpty ? _s(w['code']) : _s(w['id'])}',
                                  style: TextStyle(
                                      fontSize: 11.5, color: DanColors.faint),
                                ),
                                SizedBox(height: 6),
                                _buildChannelBadges(w),
                              ],
                            ),
                          ),
                          SizedBox(width: 8),
                          Container(
                            padding: EdgeInsets.symmetric(
                                horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: (active ? DanColors.done : DanColors.faint)
                                  .withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(99),
                            ),
                            child: Text(
                              active ? t('Bật') : t('Tắt'),
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                                color: active
                                    ? Color(0xFF047857)
                                    : DanColors.muted,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
                  ),
                  Divider(height: 1, color: DanColors.border),
                  // Nửa dưới cuộn được: Bảng giá + Cấu hình bán retail —
                  // màn thấp (tablet) không bị tràn layout.
                  Flexible(
                    child: SingleChildScrollView(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _priceBooksSection(),
                          Divider(height: 1, color: DanColors.border),
                          _retailConfigSection(),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Right Side: Configuration/Creation Form
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Form Header
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Text(
                          _selectedId == null
                              ? t('Tạo kho mới')
                              : t('Cấu hình kho'),
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: DanColors.text,
                          ),
                        ),
                        if (_selectedId != null) ...[
                          SizedBox(width: 8),
                          Text(
                            '(ID: $_selectedId)',
                            style: TextStyle(
                              fontSize: 12,
                              fontStyle: FontStyle.italic,
                              color: DanColors.faint,
                            ),
                          ),
                        ],
                      ],
                    ),
                    SizedBox(height: 16),

                    // Card Form Container
                    Container(
                      padding: EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: DanColors.surface,
                        border: Border.all(color: DanColors.border),
                        borderRadius: BorderRadius.circular(DanRadius.lg),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Two-column layout for basic fields using Row/Expanded
                          Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _nameCtrl,
                                  decoration: InputDecoration(
                                    labelText: t('Tên kho'),
                                    hintText: 'VD: Kho Dan D Pak Sala',
                                  ),
                                ),
                              ),
                              SizedBox(width: 14),
                              Expanded(
                                child: TextField(
                                  controller: _codeCtrl,
                                  decoration: InputDecoration(
                                    labelText: t('Mã kho'),
                                    hintText: t('Tự sinh nếu để trống'),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          SizedBox(height: 14),

                          Row(
                            children: [
                              Expanded(
                                child: DropdownButtonFormField<String>(
                                  initialValue: _type,
                                  decoration:
                                      InputDecoration(labelText: t('Loại kho')),
                                  items: [
                                    DropdownMenuItem(
                                      value: 'retail',
                                      child: Text('Kho retail / showroom'),
                                    ),
                                    DropdownMenuItem(
                                      value: 'kitchen',
                                      child: Text(t('Kho bếp / vật dụng')),
                                    ),
                                  ],
                                  onChanged: _onTypeChanged,
                                ),
                              ),
                              SizedBox(width: 14),
                              Expanded(
                                child: TextField(
                                  controller: _sortCtrl,
                                  keyboardType: TextInputType.number,
                                  decoration: InputDecoration(
                                    labelText: t('Sắp xếp'),
                                    hintText: '0',
                                  ),
                                ),
                              ),
                              SizedBox(width: 14),
                              Expanded(
                                child: DropdownButtonFormField<bool>(
                                  initialValue: _active,
                                  decoration: InputDecoration(
                                      labelText: t('Trạng thái')),
                                  items: [
                                    DropdownMenuItem(
                                      value: true,
                                      child: Text(t('Đang bật')),
                                    ),
                                    DropdownMenuItem(
                                      value: false,
                                      child: Text(t('Tắt kho')),
                                    ),
                                  ],
                                  onChanged: (val) {
                                    if (val != null) {
                                      setState(() => _active = val);
                                    }
                                  },
                                ),
                              ),
                            ],
                          ),
                          SizedBox(height: 20),

                          // Sales channels connection section
                          Text(
                            t('Kênh bán hàng đang nối với kho này'),
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: DanColors.text,
                            ),
                          ),
                          SizedBox(height: 10),

                          // Grid of Sales channels (wrap with spacing)
                          Wrap(
                            spacing: 12,
                            runSpacing: 10,
                            children: _allChannels.map((c) {
                              final key = c.$1;
                              final label = c.$2;
                              final isChecked = _selectedChannels.contains(key);

                              return InkWell(
                                onTap: () {
                                  setState(() {
                                    if (isChecked) {
                                      _selectedChannels.remove(key);
                                    } else {
                                      _selectedChannels.add(key);
                                    }
                                  });
                                },
                                borderRadius:
                                    BorderRadius.circular(DanRadius.sm),
                                child: Container(
                                  width: 220,
                                  padding: EdgeInsets.symmetric(
                                      horizontal: 10, vertical: 8),
                                  decoration: BoxDecoration(
                                    color: isChecked
                                        ? DanColors.brandDim
                                        : Colors.transparent,
                                    border: Border.all(
                                      color: isChecked
                                          ? DanColors.brand
                                          : DanColors.border,
                                    ),
                                    borderRadius:
                                        BorderRadius.circular(DanRadius.sm),
                                  ),
                                  child: Row(
                                    children: [
                                      SizedBox(
                                        height: 24,
                                        width: 24,
                                        child: Checkbox(
                                          value: isChecked,
                                          activeColor: DanColors.brand,
                                          onChanged: (val) {
                                            setState(() {
                                              if (val == true) {
                                                _selectedChannels.add(key);
                                              } else {
                                                _selectedChannels.remove(key);
                                              }
                                            });
                                          },
                                        ),
                                      ),
                                      SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          label,
                                          style: TextStyle(
                                            fontSize: 12.5,
                                            fontWeight: isChecked
                                                ? FontWeight.w700
                                                : FontWeight.normal,
                                            color: DanColors.text,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              );
                            }).toList(),
                          ),
                          SizedBox(height: 8),
                          Text(
                            t('Ví dụ: kho bếp nối iPad/POS nhà hàng; kho bán lẻ nối Retail POS, GrabMart hoặc Website.'),
                            style: TextStyle(
                              fontSize: 11.5,
                              fontStyle: FontStyle.italic,
                              color: DanColors.faint,
                            ),
                          ),
                          SizedBox(height: 24),

                          // Form Action Buttons — Wrap để không tràn ngang khi
                          // panel hẹp (tablet): 3 nút có nhãn dài dễ vượt bề
                          // rộng, tự xuống dòng thay vì overflow đỏ.
                          Wrap(
                            spacing: 10,
                            runSpacing: 10,
                            children: [
                              OutlinedButton.icon(
                                onPressed: () => _selectWarehouse(null),
                                icon: Icon(Icons.add, size: 16),
                                label: Text(t('Tạo kho mới')),
                              ),
                              FilledButton.icon(
                                onPressed: _save,
                                icon: Icon(Icons.save, size: 16),
                                label: Text(_selectedId == null
                                    ? t('Tạo kho')
                                    : t('Lưu cấu hình kho')),
                              ),
                              OutlinedButton.icon(
                                onPressed: () {
                                  Navigator.of(context).push(
                                    MaterialPageRoute(
                                        builder: (_) => WarehouseScreen()),
                                  );
                                },
                                icon: Icon(Icons.warehouse_outlined, size: 16),
                                label: Text(t('Mở màn Kho')),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Print (Bill & Tem nhãn) ─────────────────────────────────────────────────

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
