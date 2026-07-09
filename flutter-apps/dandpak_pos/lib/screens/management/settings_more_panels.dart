
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../warehouse/warehouse_screen.dart';
import 'management_widgets.dart';
import 'settings_tab.dart';

String _s(dynamic v) => v?.toString() ?? '';
bool _b(dynamic v) => v == true || v == 1 || v == '1';

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

// ── Integrations ─────────────────────────────────────────────────────────

class IntegrationDef {
  final String key;
  final String icon;
  final String name;
  final String desc;
  final String type;
  final String? channel;
  final String? imageAsset;

  const IntegrationDef({
    required this.key,
    required this.icon,
    required this.name,
    required this.desc,
    required this.type,
    this.channel,
    this.imageAsset,
  });
}

const _integrationDefs = [
  IntegrationDef(
      key: 'misa',
      icon: '🧾',
      name: 'MISA',
      desc: 'Xuất hóa đơn điện tử, đồng bộ khách hàng và trạng thái hóa đơn.',
      type: 'misa',
      imageAsset: 'assets/web/assets/MISA.jpg'),
  IntegrationDef(
      key: 'payos',
      icon: '💳',
      name: 'payOS',
      desc:
          'Cổng thanh toán QR/thẻ payOS — tạo link thanh toán và nhận webhook xác nhận đã thanh toán.',
      type: 'payos',
      channel: 'payos',
      imageAsset: 'assets/web/assets/payoslogo.png'),
  IntegrationDef(
      key: 'vietqr',
      icon: '🇻🇳',
      name: 'VietQR API',
      desc:
          'Sinh mã QR thanh toán động cho từng bill iPad/POS và sẵn sàng đối soát khi VietQR callback.',
      type: 'vietqr',
      channel: 'vietqr',
      imageAsset: 'assets/web/assets/vietqr.png'),
  IntegrationDef(
      key: 'sepay',
      icon: '🏦',
      name: 'SePay — tự đối soát chuyển khoản',
      desc:
          'Đường B: đọc biến động số dư ngân hàng, khi khách chuyển khoản/quét VietQR đúng nội dung bill thì tự đóng bill. Rẻ nhất cho chuyển khoản.',
      type: 'bank_webhook',
      channel: 'sepay',
      imageAsset: 'assets/web/assets/sepay.webp'),
  IntegrationDef(
      key: 'casso',
      icon: '🏦',
      name: 'Casso — tự đối soát chuyển khoản',
      desc:
          'Đường B (phương án thay thế SePay): đọc giao dịch ngân hàng và bắn webhook xác nhận tiền về theo nội dung bill.',
      type: 'bank_webhook',
      channel: 'casso',
      imageAsset: 'assets/web/assets/Casso.png'),
  IntegrationDef(
      key: 'grabmerchant',
      icon: '🟢',
      name: 'GrabMerchant / GrabFood',
      desc:
          'Nhận đơn, đồng bộ menu, trạng thái món và tồn khả dụng cho kênh Grab.',
      type: 'delivery',
      channel: 'grabmerchant',
      imageAsset: 'assets/web/assets/grabmerchantlogo.webp'),
  IntegrationDef(
      key: 'shopeefood',
      icon: '🟠',
      name: 'Shopee Food',
      desc:
          'Nhận đơn Shopee Food, quản lý xác nhận đơn và đồng bộ món bán online.',
      type: 'delivery',
      channel: 'shopeefood',
      imageAsset: 'assets/web/assets/shopeefoodlogo.png'),
  IntegrationDef(
      key: 'befood',
      icon: '🟡',
      name: 'Be / beFood',
      desc: 'Chuẩn bị cấu hình merchant, store và webhook cho đơn từ Be.',
      type: 'delivery',
      channel: 'befood',
      imageAsset: 'assets/web/assets/befoodlogo.png'),
  IntegrationDef(
      key: 'grabmart',
      icon: '🛒',
      name: 'GrabMart',
      desc: 'Đồng bộ sản phẩm retail, tồn kho và đơn hàng mart.',
      type: 'mart',
      channel: 'grabmart',
      imageAsset: 'assets/web/assets/grabmartlogo.png'),
  IntegrationDef(
      key: 'website',
      icon: '🌐',
      name: 'Website / QR order',
      desc:
          'Kênh đặt món từ website, QR bàn, landing page hoặc kiosk tự gọi món.',
      type: 'website',
      channel: 'website',
      imageAsset: 'assets/web/assets/DanOnLogo.png'),
];

const Map<String, List<String>> _channelTextFields = {
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
};

String _fieldLabel(String key) {
  switch (key) {
    case 'apiBase':
      return 'API Base URL';
    case 'taxCode':
      return 'Mã số thuế';
    case 'companyName':
      return 'Tên công ty';
    case 'username':
      return 'Tài khoản / Username';
    case 'password':
      return 'Mật khẩu / Token / Password';
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
      return 'Return URL (Thành công)';
    case 'cancelUrl':
      return 'Cancel URL (Hủy thanh toán)';
    case 'webhookSecret':
      return 'Webhook Secret / Secure Token';
    case 'accountNumber':
      return 'Số tài khoản nhận tiền';
    case 'bankCode':
      return 'Mã ngân hàng (VCB, MB, ACB...)';
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

class IntegrationsPanel extends StatefulWidget {
  final ApiService api;
  const IntegrationsPanel({super.key, required this.api});

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
          _ctrls['$key:$field'] = TextEditingController(text: val.toString());
        }

        final noteVal = conf['note'] ?? '';
        _ctrls['$key:note'] = TextEditingController(text: noteVal.toString());

        if (key == 'misa') {
          conf['autoIssue'] ??= false;
          conf['syncInvoices'] ??= true;
          conf['syncCustomers'] ??= true;
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

        if (key == 'website' || def.type == 'delivery' || def.type == 'mart') {
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
        await settingsPin(context, 'Thay đổi cấu hình liên kết đối tác.');
    if (pin == null) return;

    final out = <String, dynamic>{};
    _channels.forEach((ck, conf) {
      final merged = Map<String, dynamic>.from(conf);

      final textFields = _channelTextFields[ck] ?? [];
      for (final f in textFields) {
        final ctrl = _ctrls['$ck:$f'];
        if (ctrl != null) {
          merged[f] = ctrl.text.trim();
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
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Đã lưu liên kết'), backgroundColor: DanColors.text));
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
      final msg =
          res['message'] ?? (ok ? 'Kết nối thành công!' : 'Kết nối thất bại.');

      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Row(
            children: [
              Icon(
                ok ? Icons.check_circle : Icons.error,
                color: ok ? DanColors.done : DanColors.late,
              ),
              const SizedBox(width: 10),
              Text(ok ? 'Kiểm tra thành công' : 'Kiểm tra thất bại'),
            ],
          ),
          content: Text(msg.toString()),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Đóng'),
            ),
          ],
        ),
      );
    } catch (e) {
      if (!mounted) return;
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Row(
            children: [
              Icon(Icons.error, color: DanColors.late),
              SizedBox(width: 10),
              Text('Lỗi kết nối'),
            ],
          ),
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Đóng'),
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
    } else {
      webhookUrl = '${widget.api.baseUrl}/api/online/webhook';
    }

    final fields = _channelTextFields[def.key] ?? [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
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
                        child: def.imageAsset != null
                            ? ClipRRect(
                                borderRadius:
                                    BorderRadius.circular(DanRadius.sm),
                                child: Image.asset(
                                  def.imageAsset!,
                                  width: 38,
                                  height: 38,
                                  fit: BoxFit.contain,
                                  errorBuilder: (context, error, stackTrace) =>
                                      Text(
                                    def.icon,
                                    style: const TextStyle(fontSize: 28),
                                  ),
                                ),
                              )
                            : Text(
                                def.icon,
                                style: const TextStyle(fontSize: 28),
                              ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              def.name,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              def.desc,
                              style: const TextStyle(
                                fontSize: 12.5,
                                color: DanColors.muted,
                                height: 1.4,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 16),
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
                const SizedBox(height: 16),
                if (def.type != 'misa') ...[
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF1F5F9),
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
                                style: const TextStyle(
                                  fontFamily: 'JetBrains Mono',
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFF334155),
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            ElevatedButton(
                              style: ElevatedButton.styleFrom(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 14, vertical: 8),
                                minimumSize: Size.zero,
                                textStyle: const TextStyle(
                                    fontSize: 12, fontWeight: FontWeight.bold),
                              ),
                              onPressed: () {
                                Clipboard.setData(
                                    ClipboardData(text: webhookUrl));
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text(
                                        'Đã sao chép Webhook URL vào bộ nhớ tạm'),
                                    backgroundColor: DanColors.text,
                                  ),
                                );
                              },
                              child: const Text('Copy'),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text(
                          _webhookHintText(def),
                          style: const TextStyle(
                            fontSize: 11.5,
                            color: Color(0xFF64748B),
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                if (fields.isNotEmpty) ...[
                  const Text(
                    'CẤU HÌNH CHI TIẾT',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w900,
                      letterSpacing: .5,
                      color: DanColors.faint,
                    ),
                  ),
                  const SizedBox(height: 10),
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    gridDelegate:
                        const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      crossAxisSpacing: 16,
                      mainAxisSpacing: 12,
                      mainAxisExtent: 68,
                    ),
                    itemCount: fields.length,
                    itemBuilder: (ctx, i) {
                      final field = fields[i];
                      return TextField(
                        controller: _ctrls['${def.key}:$field'],
                        obscureText: _isSecret(field),
                        decoration: InputDecoration(
                          labelText: _fieldLabel(field),
                          isDense: true,
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: 16),
                ],
                _buildAdditionalControls(def, conf),
                _buildGuidePanel(def),
                const SizedBox(height: 16),
                const Text(
                  'GHI CHÚ NỘI BỘ',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .5,
                    color: DanColors.faint,
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _ctrls['${def.key}:note'],
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'Ghi chú phục vụ đối soát, vận hành nội bộ...',
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 20),
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: DanColors.text,
                      side: const BorderSide(color: DanColors.border),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 12),
                    ),
                    onPressed:
                        _testingKey != null ? null : () => _testConnection(def),
                    icon: _testingKey == def.key
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: DanColors.text,
                            ),
                          )
                        : const Icon(Icons.bolt, size: 16),
                    label: Text(_testingKey == def.key
                        ? 'Đang kiểm tra...'
                        : 'Kiểm tra cấu hình'),
                  ),
                ),
                const SizedBox(height: 30),
              ],
            ),
          ),
        ),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: const BoxDecoration(
            color: DanColors.surface,
            border: Border(top: BorderSide(color: DanColors.border)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.save, size: 18),
                label: const Text('Lưu kết nối đang chọn'),
                style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
              ),
            ],
          ),
        ),
      ],
    );
  }

  String _webhookHintText(IntegrationDef def) {
    if (def.key == 'payos') {
      return 'Dán URL này vào payOS Dashboard → Kênh thanh toán → Cấu hình Webhook. payOS sẽ gọi về đây khi khách thanh toán xong.';
    }
    if (def.key == 'vietqr') {
      return 'Tự đóng bill bằng chính VietQR: nếu gói VietQR của bạn có callback, dán URL này vào mục đăng ký callback của VietQR. Khi khách trả tiền, VietQR gọi về đây → hệ thống tự đóng đúng bill (khớp theo nội dung DANBILL+mã bill). Khi đó không cần SePay. VietQR thường gửi kèm Basic Auth = chính username/password ở trên.';
    }
    if (def.key == 'sepay') {
      return 'Dán URL này vào SePay → Tích hợp → Cấu hình Webhooks. SePay gửi kèm header Authorization: Apikey <API Key>. Khi tiền về khớp nội dung DANBILL+mã bill và đủ tiền, hệ thống tự đóng bill + in hoá đơn.';
    }
    if (def.key == 'casso') {
      return 'Dán URL này vào Casso → Cấu hình Webhook. Casso gửi kèm header secure-token = secret bên dưới. Khi tiền về khớp nội dung DANBILL+mã bill và đủ tiền, hệ thống tự đóng bill + in hoá đơn.';
    }
    if (def.key == 'website') {
      return 'Webhook nhận JSON có field channel="website". Tắt kết nối này thì website/kênh bán hàng sẽ không gửi đơn được.';
    }
    return 'Webhook hiện tại nhận JSON có field channel="${def.key}". Sau này khi có API chính thức, adapter của từng bên sẽ đọc cùng cấu hình này.';
  }

  Widget _buildAdditionalControls(
      IntegrationDef def, Map<String, dynamic> conf) {
    final checkboxes = <Widget>[];

    Widget? dropdown;
    if (def.key == 'website' || def.type == 'delivery' || def.type == 'mart') {
      dropdown = Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: DropdownButtonFormField<String>(
          initialValue: conf['orderMode'],
          decoration:
              const InputDecoration(labelText: 'Cách nhận đơn', isDense: true),
          items: const [
            DropdownMenuItem(
                value: 'manual_confirm', child: Text('Nhân viên xác nhận')),
            DropdownMenuItem(
                value: 'auto_confirm', child: Text('Tự xác nhận nếu còn hàng')),
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
            conf, 'autoIssue', 'Tự phát hành hóa đơn sau thanh toán'),
        _buildCheckboxRow(conf, 'syncInvoices', 'Đồng bộ trạng thái hóa đơn'),
        _buildCheckboxRow(
            conf, 'syncCustomers', 'Đồng bộ thông tin khách hàng'),
      ]);
    } else if (def.key == 'website') {
      checkboxes.addAll([
        _buildCheckboxRow(conf, 'syncOrders', 'Nhận và đồng bộ đơn hàng'),
        _buildCheckboxRow(conf, 'syncMenu', 'Đồng bộ menu'),
        _buildCheckboxRow(conf, 'printOnReceive', 'Tự in khi có đơn mới'),
      ]);
    } else if (def.type == 'delivery') {
      checkboxes.addAll([
        _buildCheckboxRow(conf, 'syncOrders', 'Nhận và đồng bộ đơn hàng'),
        _buildCheckboxRow(conf, 'syncMenu', 'Đồng bộ menu'),
        _buildCheckboxRow(conf, 'syncInventory', 'Đồng bộ tồn kho'),
        _buildCheckboxRow(conf, 'autoAccept', 'Tự nhận đơn hợp lệ'),
        _buildCheckboxRow(conf, 'printOnReceive', 'Tự in khi có đơn mới'),
      ]);
    } else if (def.type == 'mart') {
      checkboxes.addAll([
        _buildCheckboxRow(conf, 'syncOrders', 'Nhận và đồng bộ đơn hàng'),
        _buildCheckboxRow(conf, 'syncProducts', 'Đồng bộ sản phẩm'),
        _buildCheckboxRow(conf, 'syncInventory', 'Đồng bộ tồn kho'),
        _buildCheckboxRow(conf, 'autoAccept', 'Tự nhận đơn hợp lệ'),
        _buildCheckboxRow(conf, 'printOnReceive', 'Tự in khi có đơn mới'),
      ]);
    }

    if (checkboxes.isEmpty && dropdown == null) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (dropdown != null) dropdown,
        if (checkboxes.isNotEmpty) ...[
          const Text(
            'THIẾT LẬP TÍNH NĂNG',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w900,
              letterSpacing: .5,
              color: DanColors.faint,
            ),
          ),
          const SizedBox(height: 6),
          ...checkboxes,
          const SizedBox(height: 16),
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
      title: Text(label, style: const TextStyle(fontSize: 13.5)),
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
      title = 'Đường dẫn API payOS (soạn sẵn để nối sau)';
      steps = [
        'Tạo link thanh toán: POST /v2/payment-requests',
        'Lấy thông tin đơn: GET /v2/payment-requests/{id}',
        'Huỷ link thanh toán: POST /v2/payment-requests/{id}/cancel',
        'Đăng ký webhook: POST /confirm-webhook',
        'Header bắt buộc mọi request: x-client-id + x-api-key',
        'Xác thực dữ liệu webhook: ký HMAC-SHA256 bằng Checksum Key rồi so với field signature'
      ];
    } else if (def.key == 'vietqr') {
      title = 'Luồng VietQR API đang dùng';
      steps = [
        'Lấy token: POST /token_generate',
        'Tạo QR động: POST /qr/generate-customer',
        'iPad sẽ gửi order hiện tại lên backend, backend tạo content/orderId riêng cho bill rồi trả QR về màn hình phụ.',
        'Nếu credential chưa đủ hoặc API lỗi, hệ thống vẫn dùng QR public từ thông tin ngân hàng để không đứng bill.'
      ];
    } else if (def.key == 'sepay' || def.key == 'casso') {
      title = 'Cách hoạt động (Đường B — tự đối soát)';
      steps = [
        'Khách quét QR VietQR và chuyển khoản kèm nội dung DANBILL+mã bill (sinh tự động trên màn thanh toán).',
        '${def.name} phát hiện tiền về tài khoản → gọi Webhook URL ở trên.',
        'Hệ thống khớp đúng bill theo nội dung; đủ tiền thì tự đóng bill, in hoá đơn, đẩy realtime cho POS/iPad.',
        'Giao dịch không khớp / chưa đủ tiền được ghi vào nhật ký để đối soát thủ công.'
      ];
    }

    if (steps.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Container(
        padding: const EdgeInsets.all(14),
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
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 12.5,
              ),
            ),
            const SizedBox(height: 8),
            ...steps.map((s) => Padding(
                  padding: const EdgeInsets.only(bottom: 5),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('• ',
                          style: TextStyle(fontWeight: FontWeight.bold)),
                      Expanded(
                        child: Text(
                          s,
                          style: const TextStyle(fontSize: 12, height: 1.4),
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
      title: 'Liên kết',
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
              decoration: const BoxDecoration(
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
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 14),
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
                            child: def.imageAsset != null
                                ? ClipRRect(
                                    borderRadius: BorderRadius.circular(4.0),
                                    child: Image.asset(
                                      def.imageAsset!,
                                      width: 24,
                                      height: 24,
                                      fit: BoxFit.contain,
                                      errorBuilder:
                                          (context, error, stackTrace) => Text(
                                        def.icon,
                                        style: const TextStyle(fontSize: 18),
                                      ),
                                    ),
                                  )
                                : Text(
                                    def.icon,
                                    style: const TextStyle(fontSize: 18),
                                  ),
                          ),
                          const SizedBox(width: 14),
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
                                const SizedBox(height: 2),
                                Text(
                                  enabled ? 'Đã kết nối' : 'Chưa kết nối',
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
  const WarehouseSettingsPanel({super.key, required this.api});

  @override
  State<WarehouseSettingsPanel> createState() => _WarehouseSettingsPanelState();
}

class _WarehouseSettingsPanelState extends State<WarehouseSettingsPanel> {
  List<Map<String, dynamic>> _warehouses = [];
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

  static const List<(String, String)> _allChannels = [
    ('ipad', 'iPad self-order'),
    ('pos', 'POS nhà hàng'),
    ('retail', 'Retail POS'),
    ('online', 'Kênh online chung'),
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
      if (!mounted) return;
      setState(() {
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
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(m),
          backgroundColor: error ? DanColors.late : DanColors.text));

  Future<void> _save() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) {
      _toast('Nhập tên kho', error: true);
      return;
    }

    final code = _codeCtrl.text.trim();
    final sortText = _sortCtrl.text.trim();
    int? sort;
    if (sortText.isNotEmpty) {
      sort = int.tryParse(sortText) ?? 0;
    }

    final reason =
        _selectedId == null ? 'Tạo kho "$name".' : 'Cập nhật kho "$name".';

    final pin = await settingsPin(context, reason);
    if (pin == null) {
      _toast('Đã hủy lưu cấu hình kho', error: true);
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

      _toast('Đã lưu cấu hình kho');

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
      return const Text(
        'Chưa nối kênh bán hàng',
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
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: DanColors.doing.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(4),
          ),
          child: Text(
            found.$2,
            style: const TextStyle(
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

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: 'Kho & kênh bán',
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
              decoration: const BoxDecoration(
                border: Border(
                  right: BorderSide(color: DanColors.border),
                ),
              ),
              child: ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: _warehouses.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (_, i) {
                  final w = _warehouses[i];
                  final isSelected = _s(w['id']) == _selectedId;
                  final kitchen = _s(w['type']) == 'kitchen';
                  final active = _b(w['active']);

                  return InkWell(
                    onTap: () => _selectWarehouse(w),
                    borderRadius: BorderRadius.circular(DanRadius.md),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 12),
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
                            padding: const EdgeInsets.only(top: 2),
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
                          const SizedBox(width: 12),
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
                                const SizedBox(height: 3),
                                Text(
                                  '${kitchen ? 'Kho bếp' : 'Kho retail'} · ${_s(w['code']).isNotEmpty ? _s(w['code']) : _s(w['id'])}',
                                  style: const TextStyle(
                                      fontSize: 11.5, color: DanColors.faint),
                                ),
                                const SizedBox(height: 6),
                                _buildChannelBadges(w),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: (active ? DanColors.done : DanColors.faint)
                                  .withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(99),
                            ),
                            child: Text(
                              active ? 'Bật' : 'Tắt',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                                color: active
                                    ? const Color(0xFF047857)
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

            // Right Side: Configuration/Creation Form
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Form Header
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Text(
                          _selectedId == null ? 'Tạo kho mới' : 'Cấu hình kho',
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: DanColors.text,
                          ),
                        ),
                        if (_selectedId != null) ...[
                          const SizedBox(width: 8),
                          Text(
                            '(ID: $_selectedId)',
                            style: const TextStyle(
                              fontSize: 12,
                              fontStyle: FontStyle.italic,
                              color: DanColors.faint,
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 16),

                    // Card Form Container
                    Container(
                      padding: const EdgeInsets.all(18),
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
                                  decoration: const InputDecoration(
                                    labelText: 'Tên kho',
                                    hintText: 'VD: Kho Dan D Pak Sala',
                                  ),
                                ),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: TextField(
                                  controller: _codeCtrl,
                                  decoration: const InputDecoration(
                                    labelText: 'Mã kho',
                                    hintText: 'Tự sinh nếu để trống',
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 14),

                          Row(
                            children: [
                              Expanded(
                                child: DropdownButtonFormField<String>(
                                  initialValue: _type,
                                  decoration: const InputDecoration(
                                      labelText: 'Loại kho'),
                                  items: const [
                                    DropdownMenuItem(
                                      value: 'retail',
                                      child: Text('Kho retail / showroom'),
                                    ),
                                    DropdownMenuItem(
                                      value: 'kitchen',
                                      child: Text('Kho bếp / vật dụng'),
                                    ),
                                  ],
                                  onChanged: _onTypeChanged,
                                ),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: TextField(
                                  controller: _sortCtrl,
                                  keyboardType: TextInputType.number,
                                  decoration: const InputDecoration(
                                    labelText: 'Sắp xếp',
                                    hintText: '0',
                                  ),
                                ),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: DropdownButtonFormField<bool>(
                                  initialValue: _active,
                                  decoration: const InputDecoration(
                                      labelText: 'Trạng thái'),
                                  items: const [
                                    DropdownMenuItem(
                                      value: true,
                                      child: Text('Đang bật'),
                                    ),
                                    DropdownMenuItem(
                                      value: false,
                                      child: Text('Tắt kho'),
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
                          const SizedBox(height: 20),

                          // Sales channels connection section
                          const Text(
                            'Kênh bán hàng đang nối với kho này',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: DanColors.text,
                            ),
                          ),
                          const SizedBox(height: 10),

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
                                  padding: const EdgeInsets.symmetric(
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
                                      const SizedBox(width: 8),
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
                          const SizedBox(height: 8),
                          const Text(
                            'Ví dụ: kho bếp nối iPad/POS nhà hàng; kho bán lẻ nối Retail POS, GrabMart hoặc Website.',
                            style: TextStyle(
                              fontSize: 11.5,
                              fontStyle: FontStyle.italic,
                              color: DanColors.faint,
                            ),
                          ),
                          const SizedBox(height: 24),

                          // Form Action Buttons — Wrap để không tràn ngang khi
                          // panel hẹp (tablet): 3 nút có nhãn dài dễ vượt bề
                          // rộng, tự xuống dòng thay vì overflow đỏ.
                          Wrap(
                            spacing: 10,
                            runSpacing: 10,
                            children: [
                              OutlinedButton.icon(
                                onPressed: () => _selectWarehouse(null),
                                icon: const Icon(Icons.add, size: 16),
                                label: const Text('Tạo kho mới'),
                              ),
                              FilledButton.icon(
                                onPressed: _save,
                                icon: const Icon(Icons.save, size: 16),
                                label: Text(_selectedId == null
                                    ? 'Tạo kho'
                                    : 'Lưu cấu hình kho'),
                              ),
                              OutlinedButton.icon(
                                onPressed: () {
                                  Navigator.of(context).push(
                                    MaterialPageRoute(
                                        builder: (_) =>
                                            const WarehouseScreen()),
                                  );
                                },
                                icon: const Icon(Icons.warehouse_outlined,
                                    size: 16),
                                label: const Text('Mở màn Kho'),
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
  const PrintSettingsPanel({super.key, required this.api});

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: 'Bill & Tem nhãn',
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: const [
          Panel(
            title: 'Thiết kế mẫu in',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                    'Cấu hình máy in, in thử và lịch sử lệnh in đã có trong module "Máy in" ở màn hình ứng dụng.',
                    style: TextStyle(
                        fontSize: 13, color: DanColors.muted, height: 1.5)),
                SizedBox(height: 10),
                Text(
                    'Trình thiết kế trực quan mẫu hóa đơn & tem nhãn (kéo-thả) sẽ được bổ sung — hiện dùng mẫu mặc định của hệ thống.',
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
  const DevicesPanel({super.key, required this.api});

  @override
  State<DevicesPanel> createState() => _DevicesPanelState();
}

class _DevicesPanelState extends State<DevicesPanel> {
  final _pin = TextEditingController();
  String _currentPin = '';
  bool _loading = true;
  bool _saving = false;
  String? _error;

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
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('PIN phải đúng 4 chữ số'),
          backgroundColor: DanColors.late));
      return;
    }
    final approval = await settingsPin(
        context, 'Đổi mật khẩu (PIN) mở khóa thiết bị khách.');
    if (approval == null) return;
    setState(() => _saving = true);
    try {
      await widget.api.saveAppSettings(
          {'ipad_staff_pin': newPin, 'security_pin': approval});
      if (!mounted) return;
      setState(() {
        _currentPin = newPin;
        _pin.clear();
        _saving = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Đã đổi PIN thiết bị khách'),
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
      title: 'Thiết bị khách',
      onRefresh: _load,
      child: settingsState(
        loading: _loading,
        error: _error,
        onRetry: _load,
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            Panel(
              title: 'Màn hình tự order (iPad / máy khách)',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                      'PIN này dùng để nhân viên mở khóa/thoát chế độ tự order trên thiết bị khách.',
                      style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      const Text('PIN hiện tại: ',
                          style: TextStyle(fontWeight: FontWeight.w700)),
                      Text(_currentPin.isEmpty ? '(chưa đặt)' : '••••',
                          style: const TextStyle(
                              fontFamily: 'JetBrains Mono',
                              fontWeight: FontWeight.w800)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: 220,
                    child: TextField(
                      controller: _pin,
                      keyboardType: TextInputType.number,
                      obscureText: true,
                      maxLength: 4,
                      decoration: const InputDecoration(
                          labelText: 'PIN mới (4 số)', isDense: true),
                    ),
                  ),
                  const SizedBox(height: 8),
                  FilledButton(
                    onPressed: _saving ? null : _save,
                    style:
                        FilledButton.styleFrom(minimumSize: const Size(0, 42)),
                    child: _saving
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
                        : const Text('Đổi PIN'),
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
