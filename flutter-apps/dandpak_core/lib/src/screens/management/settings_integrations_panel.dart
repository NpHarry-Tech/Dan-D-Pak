import 'package:flutter/material.dart';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:provider/provider.dart';

import '../../app_defaults.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/file_pick.dart';
import '../../ui/app_theme.dart';
import '../online/marketplace_connect_panel.dart';
import 'settings_erp_panel.dart';
import 'settings_tab.dart';
import 'settings_value_utils.dart';
import '../../utils/translation.dart';

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
    value.trim().startsWith('********') ||
    RegExp(r'^•{4,}').hasMatch(value.trim());

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
          key: 'erp',
          icon: '🧩',
          name: 'Business Central',
          desc: t(
              'Đồng bộ bán hàng sang Microsoft Dynamics 365 Business Central.'),
          type: 'erp'),
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
      // QR TINH — phuong an TAM khi chua dau noi cong thanh toan theo phap
      // nhan. Dat canh VietQR vi cung tra loi mot cau hoi "khach quet gi de
      // chuyen khoan", chi khac: QR dong sinh theo tung bill va tu doi soat,
      // QR tinh thi KHONG — cua hang doi soat bang mat.
      IntegrationDef(
          key: 'static_qr',
          icon: '🧾',
          name: t('Mã QR tĩnh (đối soát tay)'),
          desc: t(
              'Ảnh QR cố định của cửa hàng, hiện trên màn khách catalogue khi chưa đấu nối được cổng thanh toán. Không tự đối soát.'),
          type: 'static_qr'),
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
          desc: t(
              'Haravan: đồng bộ khách hàng, sản phẩm và tồn kho. Đơn hàng được quản lý trực tiếp trên Haravan.'),
          type: 'haravan',
          channel: 'haravan',
          imageAsset: 'assets/brand/Haravan.png'),
      // ── Sàn TMĐT (Dan D Pak Omni) — kết nối đơn/hàng/tồn qua Open Platform ──
      IntegrationDef(
          key: 'shopee',
          icon: '🛍️',
          name: 'Shopee',
          desc: t(
              'Shopee Open Platform: nhận đơn, đồng bộ hàng hóa và tồn kho. Cần Partner ID + Shop được ủy quyền.'),
          type: 'marketplace',
          channel: 'shopee',
          imageAsset: 'assets/brand/shopee.png'),
      IntegrationDef(
          key: 'tiktokshop',
          icon: '🎵',
          name: 'TikTok Shop',
          desc: t(
              'TikTok Shop Partner: nhận đơn, đồng bộ hàng và tồn. Cần app được ủy quyền và shop cipher.'),
          type: 'marketplace',
          channel: 'tiktokshop',
          imageAsset: 'assets/brand/tiktok.png'),
      IntegrationDef(
          key: 'lazada',
          icon: '🛒',
          name: 'Lazada',
          desc: t(
              'Lazada Open Platform: nhận đơn và đồng bộ sản phẩm/tồn kho. Cần App Key/Secret và seller token.'),
          type: 'marketplace',
          channel: 'lazada',
          imageAsset: 'assets/brand/Lazada.png'),
      IntegrationDef(
          key: 'tiki',
          icon: '🔷',
          name: 'Tiki',
          desc: t(
              'Tiki Integration: nhận đơn và đồng bộ hàng hóa/tồn. Cần Client ID/Secret của seller.'),
          type: 'marketplace',
          channel: 'tiki'),
      // ── Mạng xã hội — hội thoại đa kênh Dan D Pak Omni ─────────────────────
      IntegrationDef(
          key: 'facebook',
          icon: '📘',
          name: 'Facebook Messenger',
          desc: t(
              'Nhận tin nhắn Trang qua Meta webhook (X-Hub-Signature-256). Cần Meta App, Page token và Advanced Access.'),
          type: 'social',
          channel: 'facebook',
          imageAsset: 'assets/brand/Facebook_Logo.png'),
      IntegrationDef(
          key: 'instagram',
          icon: '📷',
          name: 'Instagram',
          desc: t(
              'Nhận tin nhắn Instagram Professional qua Meta webhook. Cần tài khoản Professional và Advanced Access.'),
          type: 'social',
          channel: 'instagram',
          imageAsset: 'assets/brand/Instagram_Glyph_Gradient.png'),
      IntegrationDef(
          key: 'zalooa',
          icon: '💬',
          name: 'Zalo OA',
          desc: t(
              'Zalo Official Account OpenAPI + webhook. Cần OA App, access token và webhook secret được cấp.'),
          type: 'social',
          channel: 'zalooa',
          imageAsset: 'assets/brand/Zalo_logo.png'),
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
  'shopee': [
    'partnerId',
    'shopId',
    'secretKey',
    'accessToken',
    'refreshToken',
    'webhookSecret',
    'apiBase'
  ],
  'tiktokshop': [
    'appId',
    'serviceId',
    'shopId',
    'shopCipher',
    'secretKey',
    'accessToken',
    'refreshToken',
    'webhookSecret',
    'apiBase'
  ],
  'lazada': [
    'appId',
    'sellerId',
    'secretKey',
    'accessToken',
    'refreshToken',
    'webhookSecret',
    'apiBase'
  ],
  'tiki': [
    'sellerId',
    'clientId',
    'clientSecret',
    'accessToken',
    'refreshToken',
    'webhookSecret',
    'apiBase'
  ],
  'facebook': [
    'appId',
    'pageId',
    'clientSecret',
    'accessToken',
    'verifyToken',
    'apiBase'
  ],
  'instagram': [
    'appId',
    'igUserId',
    'pageId',
    'clientSecret',
    'accessToken',
    'verifyToken',
    'apiBase'
  ],
  'zalooa': [
    'oaId',
    'appId',
    'secretKey',
    'accessToken',
    'refreshToken',
    'webhookSecret',
    'verifyToken',
    'apiBase'
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
    case 'refreshToken':
      return 'Refresh Token';
    case 'partnerId':
      return 'Partner ID';
    case 'shopId':
      return 'Shop ID';
    case 'shopCipher':
      return 'Shop Cipher';
    case 'sellerId':
      return 'Seller ID';
    case 'pageId':
      return 'Page ID';
    case 'igUserId':
      return 'Instagram User ID';
    case 'oaId':
      return 'Zalo OA ID';
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
  final url =
      def.imageUrl == null ? null : '${DanDpakDefaults.baseUrl}${def.imageUrl}';
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

  /// Trạng thái kết nối của các sàn "1 chạm" (shopee/lazada) — lấy từ Connection
  /// Platform, không phải cờ enabled cũ. Dùng để hiện "Đã/Chưa kết nối" ở danh sách.
  final Map<String, bool> _mpConnected = {};

  Future<void> _loadMarketplaceState() async {
    for (final p in kMarketplaceOneClickProviders) {
      try {
        final res = await widget.api.getMarketplaceConnections(p);
        final list = (res['connections'] as List?) ?? const [];
        _mpConnected[p] = list.any((c) {
          final s = (c is Map ? c['status'] : '').toString();
          return s == 'active' || s == 'connected';
        });
      } catch (_) {
        // Chưa lấy được thì giữ nguyên trạng thái đã biết.
      }
    }
    if (mounted) setState(() {});
  }

  bool _loading = true;
  bool _saving = false;
  String? _testingKey;
  String? _error;
  String _selectedKey = 'misa';
  bool _haravanBusy = false;

  /// Mẫu hóa đơn MISA trả về ở lần "Kiểm tra kết nối" gần nhất.
  /// KHÔNG hard-code danh sách này — mẫu là do doanh nghiệp khai trên MISA.
  List<Map<String, dynamic>> _misaTemplates = const [];
  String _misaStatus = '';

  /// Cấu hình màn khách catalogue — chỉ dùng cho mục "Mã QR tĩnh". Nằm ở
  /// endpoint riêng (/settings/catalogue) chứ không thuộc bảng liên kết, vì nó
  /// không phải một cổng thanh toán có khoá API và webhook.
  Map<String, dynamic> _catalogueCfg = const {};
  final _qrNoteCtrl = TextEditingController();
  bool _uploadingQr = false;

  @override
  void initState() {
    super.initState();
    _load();
    _loadCatalogueCfg();
    _loadMarketplaceState();
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) {
      c.dispose();
    }
    _qrNoteCtrl.dispose();
    super.dispose();
  }

  /// QR tĩnh nằm trong CẤU HÌNH THANH TOÁN, không phải cấu hình catalogue.
  ///
  /// Nó là một phương thức thanh toán của cửa hàng: bật lên là hiện ở màn phụ,
  /// iPad self-order, catalogue và POS. Cất riêng trong catalogue thì ba màn kia
  /// không thấy, và người đi tìm chỗ cấu hình thanh toán cũng không nghĩ tới đó.
  Future<void> _loadCatalogueCfg() async {
    try {
      final app = Map<String, dynamic>.from(await widget.api.getAppSettings());
      final ops = app['operations_config'];
      final pay = (ops is Map && ops['payment'] is Map)
          ? Map<String, dynamic>.from(ops['payment'] as Map)
          : <String, dynamic>{};
      if (!mounted) return;
      setState(() {
        _catalogueCfg = pay;
        _qrNoteCtrl.text = asText(pay['staticQrNote']);
      });
    } catch (_) {
      // Chưa đọc được thì thôi — mục QR tĩnh vẫn mở được để tải ảnh lên.
    }
  }

  /// Ghi một khoá vào operations_config.payment mà KHÔNG đụng các khoá khác.
  Future<void> _luuThanhToan(Map<String, dynamic> patch) async {
    final app = Map<String, dynamic>.from(await widget.api.getAppSettings());
    final ops = app['operations_config'] is Map
        ? Map<String, dynamic>.from(app['operations_config'] as Map)
        : <String, dynamic>{};
    final pay = ops['payment'] is Map
        ? Map<String, dynamic>.from(ops['payment'] as Map)
        : <String, dynamic>{};
    ops['payment'] = {...pay, ...patch};
    await widget.api.saveAppSettings({'operations_config': ops});
  }

  Future<void> _uploadStaticQr() async {
    final path =
        await pickImagePathCross(title: t('Chọn ảnh mã QR'), context: context);
    if (path == null || path.isEmpty) return;
    setState(() => _uploadingQr = true);
    try {
      final bytes = await File(path).readAsBytes();
      final name = path.split(RegExp(r'[\/]')).last;
      final n = name.toLowerCase();
      await widget.api.uploadCatalogueQr(
        originalName: name,
        mimeType: n.endsWith('.png')
            ? 'image/png'
            : (n.endsWith('.webp') ? 'image/webp' : 'image/jpeg'),
        base64Data: base64Encode(bytes),
      );
      if (!mounted) return;
      setState(() => _uploadingQr = false);
      await _loadCatalogueCfg();
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploadingQr = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
        backgroundColor: DanColors.late,
      ));
    }
  }

  Future<void> _saveQrNote() async {
    setState(() => _uploadingQr = true);
    try {
      await _luuThanhToan({'staticQrNote': _qrNoteCtrl.text.trim()});
      if (!mounted) return;
      setState(() => _uploadingQr = false);
      await _loadCatalogueCfg();
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploadingQr = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
        backgroundColor: DanColors.late,
      ));
    }
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
          conf['syncCustomers'] ??= true;
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

      // MISA: kiểm tra kết nối cũng chính là lúc TẢI VỀ danh sách mẫu hóa đơn
      // và thông tin doanh nghiệp. Giữ lại để người dùng chọn mẫu ngay, không
      // phải bấm thêm nút nào nữa.
      if (def.key == 'misa') {
        setState(() {
          _misaTemplates = (res['templates'] as List?)
                  ?.whereType<Map>()
                  .map((e) => Map<String, dynamic>.from(e))
                  .toList() ??
              const [];
          final c = res['company'];
          if (c is Map) {
            _channels['misa']?['companyName'] = c['name'] ?? '';
            final coMa = c['invoiceWithCode'];
            if (coMa is bool) {
              _channels['misa']?['invoiceCodeType'] =
                  coMa ? 'WITH_CODE' : 'WITHOUT_CODE';
            }
          }
          _misaStatus = '${res['status'] ?? ''}';
        });
      }

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

  /// Webhook mà đối tác sẽ gọi về. Mỗi nhóm kênh có đường dẫn riêng; các kênh
  /// giao đồ ăn/website dùng chung cổng vào của module "Kênh online".
  String _channelWebhookUrl(IntegrationDef def) {
    final base = widget.api.baseUrl;
    final branch = Uri.encodeQueryComponent(widget.api.branchId?.trim() ?? '');
    final scope = branch.isEmpty ? '' : '?branch_id=$branch';
    switch (def.key) {
      case 'payos':
      case 'vietqr':
      case 'sepay':
      case 'casso':
        return '$base/api/${def.key}/webhook$scope';
      case 'haravan':
        return '$base/webhooks/haravan$scope';
      default:
        return '$base/api/online/webhook$scope';
    }
  }

  // ── Các khối của khung bên phải, theo đúng thứ tự hiển thị ────────────────

  /// Logo + tên + mô tả + công tắc bật/tắt kênh.
  Widget _buildChannelHeader(IntegrationDef def, Map conf, bool enabled) {
    return Container(
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
    );
  }

  /// Hộp Webhook URL + nút Copy. MISA phát hành hóa đơn theo chiều đi nên
  /// không có webhook nhận về — khối này ẩn với kênh MISA.
  Widget _buildWebhookBox(IntegrationDef def, String webhookUrl) {
    return Container(
      padding: EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Color(0xFFF1F5F9),
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '${t('Chi nhánh')}: ${widget.api.branchId ?? ''}',
            style: TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w800,
              color: DanColors.brand,
            ),
          ),
          SizedBox(height: 8),
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
                  padding: EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  minimumSize: Size.zero,
                  textStyle:
                      TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                ),
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: webhookUrl));
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content:
                          Text(t('Đã sao chép Webhook URL vào bộ nhớ tạm')),
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
    );
  }

  /// Lưới ô nhập "CẤU HÌNH CHI TIẾT" — danh sách field lấy từ _channelTextFields.
  Widget _buildConfigFields(IntegrationDef def, Map conf, List<String> fields) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _sectionLabel(t('CẤU HÌNH CHI TIẾT')),
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
                _isSecret(field) && _isMaskedSecretValue(asText(conf[field]))
                    ? asText(conf[field]).trim()
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
                        message:
                            t('Đã lưu trên server — để trống nếu giữ nguyên'),
                        child: Icon(Icons.check_circle,
                            size: 18, color: Color(0xFF10B981)),
                      )
                    : null,
                isDense: true,
              ),
            );
          },
        ),
      ],
    );
  }

  /// Ô "GHI CHÚ NỘI BỘ" — không gửi cho đối tác, chỉ phục vụ đối soát nội bộ.
  /// KHỐI ĐIỀU KHIỂN RIÊNG CỦA MISA.
  ///
  /// Những mục ở đây đều là ĐIỀU KIỆN BẮT BUỘC để được phép phát hành hóa đơn
  /// (xem `activationBlockers` phía server). Trước đây chúng có trong lược đồ
  /// cấu hình nhưng KHÔNG có ô nhập nào trên màn hình, nên người dùng điền đủ
  /// tài khoản mà hệ thống vẫn không bao giờ phát hành được — và không báo lỗi,
  /// vì đó không phải lỗi, chỉ là "chưa cấu hình xong".
  Widget _buildMisaControls(Map<String, dynamic> conf) {
    Widget chon(String key, String nhan, Map<String, String> luaChon,
        {String? goiY}) {
      final hienTai = asText(conf[key]);
      final hopLe = luaChon.containsKey(hienTai) ? hienTai : null;
      return Padding(
        padding: EdgeInsets.only(bottom: 12),
        child: DropdownButtonFormField<String>(
          initialValue: hopLe,
          isExpanded: true,
          decoration: InputDecoration(
              labelText: t(nhan),
              isDense: true,
              helperText: goiY == null ? null : t(goiY),
              helperMaxLines: 3),
          items: [
            for (final e in luaChon.entries)
              DropdownMenuItem(value: e.key, child: Text(t(e.value))),
          ],
          onChanged: (v) => setState(() => conf[key] = v),
        ),
      );
    }

    final mauDaTai = _misaTemplates;
    final mauDangChon = asText(conf['templateId']);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(t('CẤU HÌNH HÓA ĐƠN'),
            style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w900,
                letterSpacing: .5,
                color: DanColors.faint)),
        SizedBox(height: 10),

        chon(
            'environment',
            'Môi trường',
            {
              'sandbox': 'Sandbox / Thử nghiệm',
              'production': 'Production / Chính thức',
            },
            goiY:
                'Để trống Địa chỉ API thì hệ thống tự dùng đúng máy chủ của môi trường đã chọn.'),

        chon('integrationType', 'Loại API MISA', {
          'MISA_API_V3': 'meInvoice API v3',
          'UNCONFIRMED': 'Chưa xác nhận',
        }),

        chon(
            'invoiceType',
            'Loại nghiệp vụ hóa đơn',
            {
              'CASH_REGISTER': 'Hóa đơn khởi tạo từ máy tính tiền',
              'VAT': 'Hóa đơn GTGT',
              'SALES': 'Hóa đơn bán hàng',
            },
            goiY: 'Phải khớp với đăng ký của doanh nghiệp với cơ quan thuế.'),

        chon(
            'taxMethod',
            'Phương pháp tính thuế',
            {
              'CREDIT_METHOD': 'Khấu trừ',
              'DIRECT_METHOD': 'Trực tiếp',
              'UNCONFIRMED': 'Chưa xác nhận',
            },
            goiY: 'Kế toán phải xác nhận trước khi phát hành hóa đơn thật.'),

        chon('roundingPolicy', 'Quy tắc làm tròn', {
          'PER_INVOICE': 'Làm tròn theo hóa đơn',
          'PER_LINE': 'Làm tròn theo từng dòng',
          'UNCONFIRMED': 'Chưa xác nhận',
        }),

        // Hình thức có mã / không mã LẤY TỪ MISA và khóa lại — chọn sai là hóa
        // đơn bị cơ quan thuế từ chối.
        Padding(
          padding: EdgeInsets.only(bottom: 12),
          child: TextField(
            readOnly: true,
            controller: TextEditingController(
                text: asText(conf['invoiceCodeType']) == 'WITHOUT_CODE'
                    ? t('Không có mã CQT')
                    : asText(conf['invoiceCodeType']) == 'WITH_CODE'
                        ? t('Có mã CQT')
                        : t('Chưa xác định — bấm Kiểm tra kết nối')),
            decoration: InputDecoration(
                labelText: t('Hình thức hóa đơn'),
                isDense: true,
                helperText: t(
                    'Lấy tự động từ MISA theo doanh nghiệp, không chỉnh tay.')),
          ),
        ),

        // Mẫu hóa đơn: chỉ hiện những mẫu MISA THẬT SỰ trả về.
        if (mauDaTai.isEmpty)
          Container(
            padding: EdgeInsets.all(12),
            margin: EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: DanColors.surface2,
              border: Border.all(color: DanColors.border),
              borderRadius: BorderRadius.circular(DanRadius.md),
            ),
            child: Text(
                mauDangChon.isEmpty
                    ? t(
                        'Chưa có mẫu hóa đơn. Bấm "Kiểm tra kết nối" để tải danh sách mẫu từ MISA.')
                    : '${t('Đang dùng mẫu')} $mauDangChon · ${t('bấm "Kiểm tra kết nối" để tải lại danh sách')}',
                style: TextStyle(
                    fontSize: 12.5, color: DanColors.muted, height: 1.45)),
          )
        else
          Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: DropdownButtonFormField<String>(
              initialValue: mauDaTai.any((m) => asText(m['id']) == mauDangChon)
                  ? mauDangChon
                  : null,
              isExpanded: true,
              decoration: InputDecoration(
                  labelText: t('Mẫu hóa đơn'),
                  isDense: true,
                  helperText: t(
                      'Lấy trực tiếp từ MISA. Ký hiệu đi kèm mẫu, không nhập tay.'),
                  helperMaxLines: 2),
              items: [
                for (final m in mauDaTai)
                  DropdownMenuItem(
                    value: asText(m['id']),
                    child: Text('${asText(m['name'])} · ${asText(m['series'])}',
                        overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: (v) => setState(() {
                conf['templateId'] = v;
                // Ký hiệu LUÔN đi theo mẫu — không để hai thứ lệch nhau.
                final m = mauDaTai.firstWhere((e) => asText(e['id']) == v,
                    orElse: () => const {});
                conf['series'] = asText(m['series']);
              }),
            ),
          ),

        if (asText(conf['series']).isNotEmpty)
          Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Text('${t('Ký hiệu hóa đơn')}: ${asText(conf['series'])}',
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
          ),

        if (_misaStatus.isNotEmpty)
          Padding(
            padding: EdgeInsets.only(bottom: 4),
            child: Text('${t('Trạng thái cấu hình')}: $_misaStatus',
                style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: _misaStatus == 'READY'
                        ? DanColors.done
                        : DanColors.doing)),
          ),
      ],
    );
  }

  Widget _buildInternalNote(IntegrationDef def) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _sectionLabel(t('GHI CHÚ NỘI BỘ')),
        SizedBox(height: 10),
        TextField(
          controller: _ctrls['${def.key}:note'],
          maxLines: 2,
          decoration: InputDecoration(
            labelText: t('Ghi chú phục vụ đối soát, vận hành nội bộ...'),
            isDense: true,
          ),
        ),
      ],
    );
  }

  /// Nút "Kiểm tra cấu hình" — gọi POST /settings/integrations/:channel/test.
  Widget _buildTestButton(IntegrationDef def) {
    final testing = _testingKey == def.key;
    return Align(
      alignment: Alignment.centerLeft,
      child: OutlinedButton.icon(
        style: OutlinedButton.styleFrom(
          foregroundColor: DanColors.text,
          side: BorderSide(color: DanColors.border),
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        ),
        onPressed: _testingKey != null ? null : () => _testConnection(def),
        icon: testing
            ? SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: DanColors.text,
                ),
              )
            : Icon(Icons.bolt, size: 16),
        label: Text(testing ? t('Đang kiểm tra...') : t('Kiểm tra cấu hình')),
      ),
    );
  }

  Future<void> _syncHaravanNow() async {
    setState(() => _haravanBusy = true);
    try {
      final result = await widget.api.syncHaravanNow();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(
              '${t('Đồng bộ Haravan hoàn tất')}: ${result['queued'] ?? 0} ${t('bản ghi')}')));
    } catch (e) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _haravanBusy = false);
    }
  }

  Future<void> _showHaravanSessions() async {
    final sessions = await widget.api.getHaravanSyncSessions();
    if (!mounted) return;
    await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
              title: Text(t('Phiên đồng bộ Haravan')),
              content: SizedBox(
                  width: 720,
                  height: 480,
                  child: sessions.isEmpty
                      ? Center(child: Text(t('Chưa có phiên đồng bộ')))
                      : ListView.separated(
                          itemCount: sessions.length,
                          separatorBuilder: (_, __) => Divider(height: 1),
                          itemBuilder: (_, index) {
                            final row = Map<String, dynamic>.from(
                                sessions[index] as Map);
                            final failed =
                                (row['failed'] as num?)?.toInt() ?? 0;
                            final pending =
                                (row['pending'] as num?)?.toInt() ?? 0;
                            return ListTile(
                              leading: Icon(
                                  failed > 0
                                      ? Icons.error_outline
                                      : pending > 0
                                          ? Icons.sync
                                          : Icons.check_circle_outline,
                                  color: failed > 0
                                      ? Colors.red
                                      : pending > 0
                                          ? Colors.orange
                                          : Colors.green),
                              title: Text(
                                  '${row['direction'] == 'outbound' ? t('Gửi lên Haravan') : t('Nhận từ Haravan')} • ${row['total'] ?? 0}'),
                              subtitle: Text(
                                  '${row['started_at'] ?? ''}\n${row['topics'] ?? ''}'),
                              isThreeLine: true,
                              trailing: failed > 0
                                  ? Text('$failed ${t('lỗi')}',
                                      style: TextStyle(color: Colors.red))
                                  : null,
                              onTap: () async {
                                final details = await widget.api
                                    .getHaravanSyncSessionDetails(
                                        '${row['id']}');
                                if (!dialogContext.mounted) return;
                                await showDialog<void>(
                                    context: dialogContext,
                                    builder: (_) => AlertDialog(
                                          title:
                                              Text(t('Chi tiết phiên Haravan')),
                                          content: SizedBox(
                                              width: 760,
                                              height: 480,
                                              child: ListView.builder(
                                                  itemCount: details.length,
                                                  itemBuilder: (_, i) {
                                                    final d = Map<String,
                                                            dynamic>.from(
                                                        details[i] as Map);
                                                    return ListTile(
                                                        dense: true,
                                                        title: Text(
                                                            '${d['topic']} • ${d['status']}'),
                                                        subtitle: Text(
                                                            '${d['external_id'] ?? ''}${d['error_message'] == null ? '' : '\n${d['error_message']}'}'));
                                                  })),
                                          actions: [
                                            TextButton(
                                                onPressed: () => Navigator.pop(
                                                    dialogContext),
                                                child: Text(t('Đóng')))
                                          ],
                                        ));
                              },
                            );
                          })),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dialogContext),
                    child: Text(t('Đóng')))
              ],
            ));
  }

  Widget _buildHaravanActions() => Wrap(spacing: 10, runSpacing: 10, children: [
        FilledButton.icon(
            onPressed: _haravanBusy ? null : _syncHaravanNow,
            icon: _haravanBusy
                ? SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(Icons.sync),
            label:
                Text(_haravanBusy ? t('Đang đồng bộ...') : t('Đồng bộ ngay'))),
        OutlinedButton.icon(
            onPressed: _showHaravanSessions,
            icon: Icon(Icons.history),
            label: Text(t('Xem các phiên đồng bộ'))),
      ]);

  /// Thanh đáy cố định với nút "Lưu kết nối đang chọn" (yêu cầu PIN Manager).
  Widget _buildSaveBar() {
    return Container(
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
    );
  }

  Widget _sectionLabel(String text) => Text(
        text,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w900,
          letterSpacing: .5,
          color: DanColors.faint,
        ),
      );

  /// MÃ QR TĨNH — ảnh cố định của cửa hàng, hiện trên màn khách catalogue.
  ///
  /// Cố ý KHÔNG gộp vào luồng VietQR động: QR động sinh theo TỪNG BILL và tự
  /// đối soát khi tiền về; QR tĩnh thì mọi khách quét cùng một mã, không mang
  /// số tiền và không có gì để đối chiếu tự động. Trộn hai thứ vào một chỗ là
  /// sớm muộn có người tưởng đơn đã tự khớp rồi giao hàng nhầm.
  Widget _buildStaticQrBox() {
    final url = asText(_catalogueCfg['staticQrUrl']);
    final base =
        context.read<AuthProvider>().serverUrl.replaceFirst(RegExp(r'/$'), '');
    return Container(
      padding: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (url.isNotEmpty)
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.network(
                      url.startsWith('http') ? url : '$base$url',
                      width: 170,
                      height: 170,
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) =>
                          Icon(Icons.qr_code_2, size: 60)),
                )
              else
                Container(
                  width: 170,
                  height: 170,
                  decoration: BoxDecoration(
                    color: DanColors.surface2,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child:
                      Icon(Icons.qr_code_2, size: 52, color: DanColors.faint),
                ),
              SizedBox(width: 18),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(t('Khách quét mã này để chuyển khoản, sau đó nhân viên đối soát bằng mắt rồi mới xác nhận đơn.'),
                        style: TextStyle(
                            fontSize: 12.5,
                            color: DanColors.muted,
                            height: 1.5)),
                    SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: _uploadingQr ? null : _uploadStaticQr,
                      icon: Icon(Icons.upload_outlined, size: 18),
                      label: Text(
                          url.isEmpty ? t('Tải ảnh QR lên') : t('Đổi ảnh QR')),
                    ),
                  ],
                ),
              ),
            ],
          ),
          SizedBox(height: 14),
          TextField(
            controller: _qrNoteCtrl,
            maxLines: 2,
            decoration: InputDecoration(
                labelText: t('Ghi chú hiện dưới mã QR trên màn khách'),
                isDense: true),
          ),
          SizedBox(height: 6),
          Divider(),
          // CÔNG TẮC TẮT QR NGÂN HÀNG.
          //
          // Không thể tắt bằng cách xoá trống số tài khoản: cấu hình luôn rơi về
          // giá trị mặc định khi để trống, nên xoá xong QR ngân hàng vẫn chạy.
          // Tắt ở đây + không bật cổng nào thì QR TĨNH tự lên thay ở MỌI màn:
          // màn phụ, iPad self-order, catalogue, POS.
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _catalogueCfg['bankQrEnabled'] != false,
            onChanged: _uploadingQr
                ? null
                : (v) async {
                    setState(() {
                      _catalogueCfg = {..._catalogueCfg, 'bankQrEnabled': v};
                    });
                    await _luuThanhToan({'bankQrEnabled': v});
                    await _loadCatalogueCfg();
                  },
            title: Text(t('Dùng QR ngân hàng (VietQR)')),
            subtitle: Text(
                t('Tắt đi và không bật cổng nào thì mã QR tĩnh ở trên được dùng cho mọi màn hình thanh toán.'),
                style: TextStyle(fontSize: 11.5)),
          ),
          SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: _uploadingQr ? null : _saveQrNote,
              child: Text(t('Lưu')),
            ),
          ),
        ],
      ),
    );
  }

  /// Khung bên phải: ghép các khối ở trên theo đúng thứ tự trên màn hình.
  Widget _buildDetailsPane() {
    // ERP — Business Central dùng backend riêng (/erp/*), không theo hệ field
    // của các cổng thanh toán → render UI riêng, vẫn nằm trong khung "Liên kết".
    if (_selectedKey == 'erp') return ErpConfigView(api: widget.api);
    // Sàn TMĐT qua Connection Platform (Shopee/Lazada…): kết nối "1 chạm" — user
    // chỉ đăng nhập + đồng ý, KHÔNG nhập Partner ID/Key/token. Gộp thẳng vào detail
    // của màn Liên kết (một màn duy nhất), không dựng UI kết nối riêng.
    if (kMarketplaceOneClickProviders.contains(_selectedKey)) {
      return MarketplaceConnectPanel(
          provider: _selectedKey,
          embedded: true,
          onChanged: _loadMarketplaceState);
    }
    final def = _integrationDefs.firstWhere((d) => d.key == _selectedKey);
    final conf = _channels[def.key] ?? {};
    final enabled = asFlag(conf['enabled']);
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
                _buildChannelHeader(def, conf, enabled),
                SizedBox(height: 16),
                // QR tĩnh không có webhook/khoá API — nó chỉ là một tấm ảnh.
                // Dựng khối riêng và dừng ở đây, không mượn bộ khung của các
                // cổng thanh toán thật (webhook, test kết nối… đều vô nghĩa).
                if (def.key == 'static_qr') ...[
                  _buildStaticQrBox(),
                  SizedBox(height: 30),
                ] else ...[
                  if (def.type != 'misa') ...[
                    _buildWebhookBox(def, _channelWebhookUrl(def)),
                    SizedBox(height: 16),
                  ],
                  if (fields.isNotEmpty) ...[
                    _buildConfigFields(def, conf, fields),
                    SizedBox(height: 16),
                  ],
                  if (def.key == 'misa') ...[
                    _buildMisaControls(conf),
                    SizedBox(height: 16),
                  ],
                  _buildAdditionalControls(def, conf),
                  if (def.key == 'haravan') ...[
                    SizedBox(height: 14),
                    _buildHaravanActions(),
                  ],
                  _buildGuidePanel(def),
                  SizedBox(height: 16),
                  _buildInternalNote(def),
                  SizedBox(height: 20),
                  _buildTestButton(def),
                  SizedBox(height: 30),
                ],
              ],
            ),
          ),
        ),
        _buildSaveBar(),
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
      return t(
          'Webhook Haravan dùng URL /webhooks/haravan. Token và webhook secret chỉ lưu trên server, không đưa xuống POS.');
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
    if (def.key == 'website' ||
        def.type == 'delivery' ||
        def.type == 'mart' ||
        def.type == 'marketplace') {
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
        _buildCheckboxRow(conf, 'syncOrders',
            t('Đồng bộ đơn hàng và gửi thông báo khách mua tại POS')),
        _buildCheckboxRow(
            conf, 'syncCustomers', t('Đồng bộ thông tin khách hàng')),
        _buildCheckboxRow(conf, 'syncProducts', t('Đồng bộ sản phẩm')),
        _buildCheckboxRow(conf, 'syncInventory', t('Đồng bộ tồn kho')),
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
    final val = asFlag(conf[field]);
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
                  final enabled =
                      kMarketplaceOneClickProviders.contains(def.key)
                          ? (_mpConnected[def.key] ?? false)
                          : asFlag(conf['enabled']);

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
