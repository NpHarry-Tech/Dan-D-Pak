import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;

import '../../app_defaults.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../warehouse/warehouse_screen.dart';
import 'management_widgets.dart';
import 'settings_tab.dart';
import '../../utils/translation.dart';

part 'settings_warehouse_panel.dart';
part 'settings_print_devices_panel.dart';

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

