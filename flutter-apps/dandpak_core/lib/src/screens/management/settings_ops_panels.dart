import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import 'management_widgets.dart';
import 'settings_tab.dart';
import '../../utils/translation.dart';

part 'settings_connections_panel.dart';

String _s(dynamic v) => v?.toString() ?? '';
bool _b(dynamic v) => v == true || v == 1 || v == '1';
int _i(dynamic v) => v is num ? v.toInt() : int.tryParse(_s(v)) ?? 0;

// Loại màn hình (device) → tên tiếng Việt để hiển thị ở t("Thiết bị đang kết nối").
String _connDeviceLabel(String d) {
  switch (d) {
    case 'admin':
      return t('Bảng quản lý');
    case 'pos':
      return t('POS nhà hàng');
    case 'retail':
      return t('Bán lẻ (Retail POS)');
    case 'kds':
      return t('Màn bếp (KDS)');
    case 'ipad':
      return t('iPad khách');
    case 'online':
      return t('Kênh online');
    case 'warehouse':
      return 'Kho';
    default:
      return d.isEmpty || d == 'unknown' ? t('Thiết bị') : d;
  }
}

String _connRoleLabel(String r) {
  switch (r) {
    case 'owner':
    case 'admin':
      return 'Admin';
    case 'manager':
      return t('Quản lý');
    case 'cashier':
      return t('Thu ngân');
    case 'kitchen':
      return t('Bếp');
    case 'warehouse':
      return t('Thủ kho');
    default:
      return r;
  }
}

// Ưu tiên hiện người đăng nhập thực; iPad công cộng thì hiện loại màn hình.
String _connTitle(Map c) {
  final name = _s(c['user_name']);
  final role = _s(c['user_role']);
  if (name.isNotEmpty) {
    return role.isNotEmpty ? '$name · ${_connRoleLabel(role)}' : name;
  }
  return _connDeviceLabel(_s(c['device']));
}

String _cleanIp(String ip) => ip
    .replaceFirst('::ffff:', '')
    .replaceFirst(RegExp(r'^::1$'), 'localhost')
    .replaceFirst(RegExp(r'^127\.0\.0\.1$'), 'localhost');

IconData _connIcon(String device) {
  switch (device) {
    case 'admin':
      return Icons.dashboard_outlined;
    case 'kds':
      return Icons.soup_kitchen_outlined;
    case 'ipad':
      return Icons.tablet_mac_outlined;
    case 'retail':
      return Icons.storefront_outlined;
    default:
      return Icons.point_of_sale_outlined;
  }
}

// ── Operations: Tài chính & Hóa đơn ──────────────────────────────────────

class OperationsPanel extends StatefulWidget {
  final ApiService api;
  OperationsPanel({super.key, required this.api});

  @override
  State<OperationsPanel> createState() => _OperationsPanelState();
}

class _OperationsPanelState extends State<OperationsPanel> {
  Map<String, dynamic> _ops = {};
  Map<String, dynamic> _einvoice = {};
  Map<String, dynamic> _misaInteg = {};
  bool _loading = true;
  bool _saving = false;
  String? _error;

  final _bankName = TextEditingController();
  final _bankAccount = TextEditingController();
  final _accountName = TextEditingController();
  final _transferPrefix = TextEditingController();
  final _drawerCash = TextEditingController();

  late List<Map<String, dynamic>> _methods;
  bool _requireOpenShift = true;
  int _origDrawerCash = 0;

  String _subtab = 'tax_profile';
  Map<String, dynamic> _taxProfile = {};
  Map<String, dynamic> _wiz = {};
  int _wizStep = 1;
  List<Map<String, dynamic>> _branches = [];
  List<Map<String, dynamic>> _categories = [];

  final _wizTaxCode = TextEditingController();
  final _wizBusinessName = TextEditingController();
  final _wizTransitionDate = TextEditingController();

  @override
  void initState() {
    super.initState();
    _methods = [];
    _load();
  }

  @override
  void dispose() {
    _bankName.dispose();
    _bankAccount.dispose();
    _accountName.dispose();
    _transferPrefix.dispose();
    _drawerCash.dispose();
    _wizTaxCode.dispose();
    _wizBusinessName.dispose();
    _wizTransitionDate.dispose();
    super.dispose();
  }

  void _initWizard() {
    final tp = _taxProfile;
    _wizStep = 1;
    _wizTaxCode.text = _s(tp['taxCode']);
    _wizBusinessName.text = _s(tp['businessName']);
    _wizTransitionDate.text = _s(tp['transitionDate']).isEmpty
        ? DateTime.now().toIso8601String().split('T')[0]
        : _s(tp['transitionDate']);

    _wiz = {
      'locations':
          (tp['locations'] is List && (tp['locations'] as List).isNotEmpty)
              ? (tp['locations'] as List)
                  .map((e) => Map<String, dynamic>.from(e))
                  .toList()
              : _branches.asMap().entries.map((entry) {
                  final idx = entry.key;
                  final b = entry.value;
                  return {
                    'id': _s(b['id']),
                    'name': _s(b['name']),
                    'address': _s(b['address']),
                    'branchId': _s(b['id']),
                    'isHeadquarters': idx == 0
                  };
                }).toList(),
      'revenueGroup': _i(tp['revenueGroup'] ?? 1),
      'productScope': _s(tp['productScope'] ?? 'all'),
      'scopeValue': (tp['scopeValue'] is List)
          ? (tp['scopeValue'] as List).cast<String>().toList()
          : <String>[],
      'confirmNoTax': _b(tp['confirmNoTax']),
      'taxRates':
          (tp['taxRates'] is List && (tp['taxRates'] as List).isNotEmpty)
              ? (tp['taxRates'] as List)
                  .map((e) => Map<String, dynamic>.from(e))
                  .toList()
              : [
                  {
                    'category': 'distribution',
                    'name': t('Bán buôn/Bán lẻ'),
                    'vat': 1.0,
                    'pit': 0.5
                  },
                  {
                    'category': 'services',
                    'name': t('Dịch vụ'),
                    'vat': 5.0,
                    'pit': 2.0
                  },
                  {
                    'category': 'manufacturing',
                    'name': t('Sản xuất'),
                    'vat': 3.0,
                    'pit': 1.5
                  },
                  {
                    'category': 'catering',
                    'name': t('Ăn uống/Giải trí'),
                    'vat': 2.0,
                    'pit': 1.0
                  }
                ],
    };
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final settings = await widget.api.getAppSettings();
      final integrations = await widget.api.getIntegrations();
      final ops = settings['operations_config'];
      final opsMap =
          ops is Map ? Map<String, dynamic>.from(ops) : <String, dynamic>{};

      final taxProfile = settings['tax_filing_profile'] is Map
          ? Map<String, dynamic>.from(settings['tax_filing_profile'])
          : <String, dynamic>{};

      final printConfig = settings['print_config'] is Map
          ? Map<String, dynamic>.from(settings['print_config'])
          : <String, dynamic>{};

      final einvoiceMap = printConfig['einvoice'] is Map
          ? Map<String, dynamic>.from(printConfig['einvoice'])
          : <String, dynamic>{};

      final channels = integrations['channels'] is Map
          ? Map<String, dynamic>.from(integrations['channels'])
          : <String, dynamic>{};

      final misaIntegMap = channels['misa'] is Map
          ? Map<String, dynamic>.from(channels['misa'])
          : <String, dynamic>{};

      final branchesList = await widget.api.getSettingsBranches();
      final categoriesList = await widget.api.getCategories();

      if (!mounted) return;
      setState(() {
        _ops = opsMap;
        _einvoice = einvoiceMap;
        _misaInteg = misaIntegMap;
        _taxProfile = taxProfile;
        _branches =
            branchesList.map((e) => Map<String, dynamic>.from(e)).toList();
        _categories =
            categoriesList.map((e) => Map<String, dynamic>.from(e)).toList();

        final pay = opsMap['payment'] is Map
            ? Map<String, dynamic>.from(opsMap['payment'])
            : <String, dynamic>{};
        final shifts = opsMap['shifts'] is Map
            ? Map<String, dynamic>.from(opsMap['shifts'])
            : <String, dynamic>{};
        _bankName.text = _s(pay['bankName']);
        _bankAccount.text = _s(pay['bankAccount']);
        _accountName.text = _s(pay['accountName']);
        _transferPrefix.text = _s(pay['transferPrefix']);
        _methods = (pay['methods'] is List)
            ? (pay['methods'] as List)
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : [];
        _requireOpenShift = _b(shifts['requireOpenShift']);
        _origDrawerCash = _i(shifts['defaultDrawerCash']);
        _drawerCash.text = _origDrawerCash.toString();

        _initWizard();
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

  Future<void> _saveTaxProfile() async {
    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'tax_filing_profile': _taxProfile,
      };
      final settings = await widget.api.saveAppSettings(body);
      if (!mounted) return;
      setState(() {
        _taxProfile = settings['tax_filing_profile'] is Map
            ? Map<String, dynamic>.from(settings['tax_filing_profile'])
            : <String, dynamic>{};
        _saving = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Đã lưu hồ sơ kê khai thuế thành công!')),
          backgroundColor: DanColors.text));
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late));
    }
  }

  Future<void> _save() async {
    final newDrawer = int.tryParse(_drawerCash.text.trim()) ?? _origDrawerCash;
    String? pin;
    if (newDrawer != _origDrawerCash) {
      pin = await settingsPin(context, t('Đổi tiền két gốc mặc định.'));
      if (pin == null) return;
    }

    final pay = _ops['payment'] is Map
        ? Map<String, dynamic>.from(_ops['payment'])
        : <String, dynamic>{};
    pay['bankName'] = _bankName.text.trim();
    pay['bankAccount'] = _bankAccount.text.trim();
    pay['accountName'] = _accountName.text.trim();
    pay['transferPrefix'] = _transferPrefix.text.trim();
    pay['methods'] = _methods;

    final shifts = _ops['shifts'] is Map
        ? Map<String, dynamic>.from(_ops['shifts'])
        : <String, dynamic>{};
    shifts['requireOpenShift'] = _requireOpenShift;
    shifts['defaultDrawerCash'] = newDrawer;

    final ops = Map<String, dynamic>.from(_ops);
    ops['payment'] = pay;
    ops['shifts'] = shifts;

    final body = <String, dynamic>{
      'operations_config': ops,
      if (pin != null) 'security_pin': pin,
    };

    setState(() => _saving = true);
    try {
      await widget.api.saveAppSettings(body);
      if (!mounted) return;
      _origDrawerCash = newDrawer;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Đã lưu cấu hình tài chính')),
          backgroundColor: DanColors.text));
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late));
    }
  }

  Widget _buildStepIndicator() {
    final steps = [
      t('Giới thiệu'),
      t('Thông tin'),
      t('Chi nhánh'),
      'Doanh thu',
      t('Thuế suất'),
      t('Xác nhận')
    ];
    return Padding(
      padding: EdgeInsets.only(bottom: 20),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: List.generate(steps.length, (idx) {
          final stepNum = idx + 1;
          final active = stepNum == _wizStep;
          final done = stepNum < _wizStep;
          return Expanded(
            child: Row(
              children: [
                Container(
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    color: active
                        ? DanColors.brand
                        : done
                            ? DanColors.done
                            : DanColors.surface3,
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: Text(
                      done ? '✓' : '$stepNum',
                      style: TextStyle(
                        fontSize: 11,
                        color: active || done ? Colors.white : DanColors.muted,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
                SizedBox(width: 4),
                Expanded(
                  child: Text(
                    steps[idx],
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: active ? FontWeight.bold : FontWeight.normal,
                      color: active ? DanColors.brand : DanColors.muted,
                    ),
                  ),
                ),
                if (idx < steps.length - 1)
                  Padding(
                    padding: EdgeInsets.symmetric(horizontal: 4),
                    child: Icon(Icons.chevron_right,
                        size: 12, color: DanColors.faint),
                  ),
              ],
            ),
          );
        }),
      ),
    );
  }

  Widget _buildWizardStep() {
    switch (_wizStep) {
      case 1:
        return Panel(
          title: t('Thiết lập hồ sơ kê khai thuế lần đầu'),
          child: Column(
            children: [
              SizedBox(height: 12),
              Icon(Icons.description_outlined,
                  size: 64, color: DanColors.brand),
              SizedBox(height: 12),
              Text(
                t('Chào mừng bạn đến với tính năng Thuế & Kế toán!'),
                textAlign: TextAlign.center,
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
              ),
              SizedBox(height: 8),
              Text(
                t('Hệ thống sẽ hướng dẫn bạn thiết lập hồ sơ kê khai thuế, tự động gán thuế suất mặc định và hỗ trợ xuất biểu mẫu kê khai theo quy định mới nhất.'),
                textAlign: TextAlign.center,
                style: TextStyle(color: DanColors.muted, fontSize: 12.5),
              ),
              SizedBox(height: 20),
              FilledButton(
                onPressed: () => setState(() => _wizStep = 2),
                child: Text(t('Bắt đầu thiết lập →')),
              ),
            ],
          ),
        );
      case 2:
        return Panel(
          title: t('Thông tin đăng ký kinh doanh'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _field(t('Mã số thuế (MST) (bỏ qua nếu chưa có)'), _wizTaxCode),
              _field(t('Tên Hộ kinh doanh *'), _wizBusinessName),
              _field(t('Ngày chuyển sang phương pháp kê khai *'),
                  _wizTransitionDate,
                  hint: 'YYYY-MM-DD'),
              SizedBox(height: 16),
              _stepNavigation(),
            ],
          ),
        );
      case 3:
        final locs = (_wiz['locations'] as List);
        return Panel(
          title: t('Chi nhánh & Địa điểm kinh doanh'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                t('Nhập mã địa điểm kinh doanh (MST 13 số nếu có) và chọn trụ sở chính:'),
                style: TextStyle(fontSize: 12.5, color: DanColors.muted),
              ),
              SizedBox(height: 12),
              for (int idx = 0; idx < locs.length; idx++) ...[
                Container(
                  padding: EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: DanColors.surface2,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: DanColors.border),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _s(locs[idx]['name']),
                        style: TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 13.5),
                      ),
                      SizedBox(height: 8),
                      TextFormField(
                        initialValue: _s(locs[idx]['address']),
                        decoration: InputDecoration(
                          hintText: t('Mã địa điểm kinh doanh...'),
                          isDense: true,
                        ),
                        onChanged: (v) =>
                            setState(() => locs[idx]['address'] = v),
                      ),
                      SizedBox(height: 8),
                      RadioGroup<bool>(
                        groupValue: _b(locs[idx]['isHeadquarters']),
                        onChanged: (v) {
                          setState(() {
                            for (var l in locs) {
                              l['isHeadquarters'] = false;
                            }
                            locs[idx]['isHeadquarters'] = true;
                          });
                        },
                        child: Row(
                          children: [
                            Radio<bool>(
                              value: true,
                              activeColor: DanColors.brand,
                            ),
                            Text(t('Đặt làm trụ sở chính'),
                                style: TextStyle(fontSize: 12)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(height: 8),
              ],
              SizedBox(height: 12),
              _stepNavigation(),
            ],
          ),
        );
      case 4:
        final currentGroup = _i(_wiz['revenueGroup']);
        final groups = [
          {
            'id': 1,
            'name': t('Nhóm 1: Doanh thu < 1 tỷ đồng / năm'),
            'desc': t(
                'Miễn thuế GTGT và TNCN. Sử dụng Sổ kế toán S1a đơn giản, không bắt buộc HĐĐT.')
          },
          {
            'id': 2,
            'name': t('Nhóm 2: Doanh thu 1 tỷ – 3 tỷ đồng / năm'),
            'desc': t(
                'Thuế GTGT/TNCN tính theo tỷ lệ %. Kê khai thuế theo Quý, bắt buộc sử dụng HĐĐT và Sổ S2a.')
          },
          {
            'id': 3,
            'name': t('Nhóm 3: Doanh thu 3 tỷ – 50 tỷ đồng / năm'),
            'desc': t(
                'Thuế GTGT/TNCN tính theo tỷ lệ %. Kê khai thuế theo Quý/Năm, bắt buộc sử dụng Bộ 4 sổ và HĐĐT.')
          },
          {
            'id': 4,
            'name': t('Nhóm 4: Doanh thu > 50 tỷ đồng / năm'),
            'desc': t(
                'Mô hình HKD quy mô lớn. Nghĩa vụ thuế và báo cáo tài chính bắt buộc tương đương doanh nghiệp.')
          }
        ];
        return Panel(
          title: t('Phân loại nhóm doanh thu kinh doanh'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                t('Lựa chọn quy mô doanh thu ước tính để kích hoạt biểu mẫu biểu thuế tương ứng:'),
                style: TextStyle(fontSize: 12.5, color: DanColors.muted),
              ),
              SizedBox(height: 12),
              for (final g in groups) ...[
                GestureDetector(
                  onTap: () => setState(() => _wiz['revenueGroup'] = g['id']),
                  child: Container(
                    padding: EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: currentGroup == g['id']
                          ? DanColors.brandDim
                          : DanColors.surface,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: currentGroup == g['id']
                            ? DanColors.brand
                            : DanColors.border,
                        width: 1.5,
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _s(g['name']),
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                            color: currentGroup == g['id']
                                ? DanColors.brand
                                : DanColors.text,
                          ),
                        ),
                        SizedBox(height: 4),
                        Text(
                          _s(g['desc']),
                          style:
                              TextStyle(fontSize: 11.5, color: DanColors.muted),
                        ),
                      ],
                    ),
                  ),
                ),
                SizedBox(height: 8),
              ],
              SizedBox(height: 12),
              _stepNavigation(),
            ],
          ),
        );
      case 5:
        final rates = (_wiz['taxRates'] as List);
        final scope = _s(_wiz['productScope']);
        return Panel(
          title: t('Phạm vi & Tỷ lệ thuế suất'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                t('Chọn phạm vi áp dụng thuế cho các mặt hàng trong thực đơn:'),
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 6),
              DropdownButtonFormField<String>(
                initialValue: scope,
                decoration: InputDecoration(isDense: true),
                items: [
                  DropdownMenuItem(
                      value: 'all', child: Text(t('Tất cả thực đơn'))),
                  DropdownMenuItem(
                      value: 'groups',
                      child: Text(t('Chỉ áp dụng cho các danh mục chọn'))),
                  DropdownMenuItem(
                      value: 'exclude',
                      child: Text(t('Tất cả ngoại trừ danh mục chọn'))),
                ],
                onChanged: (v) => setState(() => _wiz['productScope'] = v),
              ),
              if (scope != 'all') ...[
                SizedBox(height: 12),
                Text(t('Chọn danh mục hàng hóa áp dụng:'),
                    style:
                        TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final cat in _categories) ...[
                      FilterChip(
                        label: Text('${_s(cat['icon'])} ${_s(cat['name'])}'),
                        selected: (_wiz['scopeValue'] as List)
                            .contains(_s(cat['id'])),
                        onSelected: (selected) {
                          setState(() {
                            final list = (_wiz['scopeValue'] as List);
                            if (selected) {
                              list.add(_s(cat['id']));
                            } else {
                              list.remove(_s(cat['id']));
                            }
                          });
                        },
                      ),
                    ],
                  ],
                ),
                SizedBox(height: 8),
                Row(
                  children: [
                    Checkbox(
                      value: _b(_wiz['confirmNoTax']),
                      onChanged: (v) =>
                          setState(() => _wiz['confirmNoTax'] = v),
                    ),
                    Expanded(
                      child: Text(
                        t('Tôi xác nhận các hàng hóa khác không thuộc đối tượng chịu thuế'),
                        style: TextStyle(fontSize: 11.5),
                      ),
                    ),
                  ],
                ),
              ],
              SizedBox(height: 16),
              Text(
                t('Tỷ lệ thuế suất tính theo doanh thu (%) của từng nhóm ngành:'),
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 10),
              Table(
                columnWidths: {
                  0: FlexColumnWidth(2),
                  1: FixedColumnWidth(70),
                  2: FixedColumnWidth(70),
                },
                children: [
                  TableRow(
                    children: [
                      Padding(
                          padding: EdgeInsets.symmetric(vertical: 4),
                          child: Text(t('Nhóm ngành'),
                              style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 11.5))),
                      Padding(
                          padding: EdgeInsets.symmetric(vertical: 4),
                          child: Text('GTGT (%)',
                              style: TextStyle(
                                  fontWeight: FontWeight.bold, fontSize: 11.5),
                              textAlign: TextAlign.right)),
                      Padding(
                          padding: EdgeInsets.symmetric(vertical: 4),
                          child: Text('TNCN (%)',
                              style: TextStyle(
                                  fontWeight: FontWeight.bold, fontSize: 11.5),
                              textAlign: TextAlign.right)),
                    ],
                  ),
                  for (int idx = 0; idx < rates.length; idx++)
                    TableRow(
                      children: [
                        Padding(
                          padding: EdgeInsets.symmetric(vertical: 6),
                          child: Text(_s(rates[idx]['name']),
                              style: TextStyle(
                                  fontSize: 12.5, fontWeight: FontWeight.bold)),
                        ),
                        Padding(
                          padding:
                              EdgeInsets.symmetric(vertical: 2, horizontal: 4),
                          child: TextFormField(
                            initialValue: _s(rates[idx]['vat']),
                            keyboardType:
                                TextInputType.numberWithOptions(decimal: true),
                            textAlign: TextAlign.right,
                            decoration: InputDecoration(
                                isDense: true,
                                contentPadding: EdgeInsets.all(6)),
                            onChanged: (v) =>
                                rates[idx]['vat'] = double.tryParse(v) ?? 0.0,
                          ),
                        ),
                        Padding(
                          padding:
                              EdgeInsets.symmetric(vertical: 2, horizontal: 4),
                          child: TextFormField(
                            initialValue: _s(rates[idx]['pit']),
                            keyboardType:
                                TextInputType.numberWithOptions(decimal: true),
                            textAlign: TextAlign.right,
                            decoration: InputDecoration(
                                isDense: true,
                                contentPadding: EdgeInsets.all(6)),
                            onChanged: (v) =>
                                rates[idx]['pit'] = double.tryParse(v) ?? 0.0,
                          ),
                        ),
                      ],
                    ),
                ],
              ),
              SizedBox(height: 16),
              _stepNavigation(),
            ],
          ),
        );
      case 6:
        Map<String, dynamic> hq = {};
        if (_wiz['locations'] is List) {
          for (final l in _wiz['locations'] as List) {
            if (l is Map && _b(l['isHeadquarters'])) {
              hq = Map<String, dynamic>.from(l);
              break;
            }
          }
          if (hq.isEmpty && (_wiz['locations'] as List).isNotEmpty) {
            final first = (_wiz['locations'] as List).first;
            if (first is Map) {
              hq = Map<String, dynamic>.from(first);
            }
          }
        }
        final revGroupName = _wiz['revenueGroup'] == 1
            ? t('Nhóm 1 (< 1 tỷ/năm)')
            : _wiz['revenueGroup'] == 2
                ? t('Nhóm 2 (1 tỷ - 3 tỷ/năm)')
                : _wiz['revenueGroup'] == 3
                    ? t('Nhóm 3 (3 tỷ - 50 tỷ/năm)')
                    : t('Nhóm 4 (> 50 tỷ/năm)');
        return Panel(
          title: t('Xác nhận thông tin hồ sơ'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: DanColors.surface2,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  children: [
                    _confirmRow(
                        'MST',
                        _wizTaxCode.text.isEmpty
                            ? t('Chưa thiết lập')
                            : _wizTaxCode.text),
                    _confirmRow(t('Tên Hộ kinh doanh'), _wizBusinessName.text),
                    _confirmRow(
                        t('Ngày bắt đầu kê khai'), _wizTransitionDate.text),
                    _confirmRow(t('Phân loại doanh thu'), revGroupName),
                    _confirmRow(t('Trụ sở chính'),
                        '${_s(hq['name'])} - ${_s(hq['address']).isEmpty ? 'Chưa nhập' : _s(hq['address'])}'),
                  ],
                ),
              ),
              SizedBox(height: 16),
              Row(
                children: [
                  Checkbox(
                    value: _b(_wiz['confirmFinal']),
                    onChanged: (v) => setState(() => _wiz['confirmFinal'] = v),
                  ),
                  Expanded(
                    child: Text(
                      t('Tôi cam đoan thông tin khai trên là đúng sự thật và chịu hoàn toàn trách nhiệm.'),
                      style:
                          TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                  ),
                ],
              ),
              SizedBox(height: 16),
              _stepNavigation(isFinish: true),
            ],
          ),
        );
      default:
        return SizedBox.shrink();
    }
  }

  Widget _confirmRow(String label, String value) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 130,
            child: Text(label,
                style: TextStyle(fontSize: 12, color: DanColors.muted)),
          ),
          Expanded(
            child: Text(value,
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Widget _stepNavigation({bool isFinish = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        if (_wizStep > 1)
          OutlinedButton(
            onPressed: () => setState(() => _wizStep--),
            child: Text(t('Quay lại')),
          )
        else
          SizedBox.shrink(),
        if (isFinish)
          FilledButton(
            onPressed: _b(_wiz['confirmFinal']) ? _finishWizard : null,
            child: Text(t('Hoàn thành & Kích hoạt')),
          )
        else
          FilledButton(
            onPressed: _nextWizardStep,
            child: Text(t('Tiếp tục')),
          ),
      ],
    );
  }

  void _nextWizardStep() {
    if (_wizStep == 2) {
      if (_wizBusinessName.text.trim().isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(t('Vui lòng nhập tên Hộ kinh doanh')),
            backgroundColor: DanColors.late));
        return;
      }
    }
    setState(() => _wizStep++);
  }

  void _finishWizard() {
    setState(() {
      _taxProfile = {
        'hasProfile': true,
        'taxCode': _wizTaxCode.text.trim(),
        'businessName': _wizBusinessName.text.trim(),
        'transitionDate': _wizTransitionDate.text.trim(),
        'locations': _wiz['locations'],
        'revenueGroup': _wiz['revenueGroup'],
        'productScope': _wiz['productScope'],
        'scopeValue': _wiz['scopeValue'],
        'confirmNoTax': _wiz['confirmNoTax'],
        'taxRates': _wiz['taxRates'],
      };
    });
    _saveTaxProfile();
  }

  Widget _buildTaxDashboard() {
    final p = _taxProfile;
    Map<String, dynamic> hq = {};
    if (p['locations'] is List) {
      for (final l in p['locations'] as List) {
        if (l is Map && _b(l['isHeadquarters'])) {
          hq = Map<String, dynamic>.from(l);
          break;
        }
      }
      if (hq.isEmpty && (p['locations'] as List).isNotEmpty) {
        final first = (p['locations'] as List).first;
        if (first is Map) {
          hq = Map<String, dynamic>.from(first);
        }
      }
    }
    final revGroupName = p['revenueGroup'] == 1
        ? t('Nhóm 1 (< 1 tỷ/năm)')
        : p['revenueGroup'] == 2
            ? t('Nhóm 2 (1 tỷ - 3 tỷ/năm)')
            : p['revenueGroup'] == 3
                ? t('Nhóm 3 (3 tỷ - 50 tỷ/năm)')
                : t('Nhóm 4 (> 50 tỷ/năm)');
    final rates = (p['taxRates'] is List ? p['taxRates'] as List : []);

    return Column(
      children: [
        Panel(
          title: t('Hồ sơ khai thuế Hộ kinh doanh'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton(
                  onPressed: () {
                    setState(() {
                      _taxProfile['hasProfile'] = false;
                      _initWizard();
                    });
                  },
                  child: Text(t('Cập nhật hồ sơ')),
                ),
              ),
              SizedBox(height: 12),
              _confirmRow('MST', _s(p['taxCode'])),
              _confirmRow(t('Tên Hộ kinh doanh'), _s(p['businessName'])),
              _confirmRow(t('Ngày bắt đầu kê khai'), _s(p['transitionDate'])),
              _confirmRow(t('Quy mô doanh thu'), revGroupName),
              _confirmRow(t('Trụ sở chính'),
                  '${_s(hq['name'])} - ${_s(hq['address'])}'),
            ],
          ),
        ),
        SizedBox(height: 16),
        Panel(
          title: t('Địa điểm kinh doanh liên kết'),
          child: Column(
            children: [
              for (final loc
                  in (p['locations'] is List ? p['locations'] as List : []))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(_s(loc['name']),
                      style: TextStyle(
                          fontWeight: FontWeight.bold, fontSize: 13.5)),
                  subtitle: Text(
                      'Mã địa điểm: ${_s(loc['address']).isEmpty ? 'Chưa gán' : _s(loc['address'])}',
                      style: TextStyle(fontSize: 11.5, color: DanColors.muted)),
                  trailing: _b(loc['isHeadquarters'])
                      ? Chip(
                          label: Text(t('Trụ sở chính'),
                              style: TextStyle(fontSize: 10)))
                      : null,
                ),
            ],
          ),
        ),
        SizedBox(height: 16),
        Panel(
          title: t('Tỷ lệ thuế suất áp dụng'),
          child: Table(
            columnWidths: {
              0: FlexColumnWidth(2),
              1: FixedColumnWidth(80),
              2: FixedColumnWidth(80),
            },
            children: [
              TableRow(
                children: [
                  Padding(
                      padding: EdgeInsets.symmetric(vertical: 4),
                      child: Text(t('Nhóm ngành'),
                          style: TextStyle(
                              fontWeight: FontWeight.bold, fontSize: 12))),
                  Padding(
                      padding: EdgeInsets.symmetric(vertical: 4),
                      child: Text('GTGT',
                          style: TextStyle(
                              fontWeight: FontWeight.bold, fontSize: 12),
                          textAlign: TextAlign.right)),
                  Padding(
                      padding: EdgeInsets.symmetric(vertical: 4),
                      child: Text('TNCN',
                          style: TextStyle(
                              fontWeight: FontWeight.bold, fontSize: 12),
                          textAlign: TextAlign.right)),
                ],
              ),
              for (final tr in rates)
                TableRow(
                  children: [
                    Padding(
                      padding: EdgeInsets.symmetric(vertical: 6),
                      child: Text(_s(tr['name']),
                          style: TextStyle(
                              fontSize: 12.5, fontWeight: FontWeight.bold)),
                    ),
                    Padding(
                      padding: EdgeInsets.symmetric(vertical: 6),
                      child: Text('${_s(tr['vat'])}%',
                          style: TextStyle(fontSize: 12.5),
                          textAlign: TextAlign.right),
                    ),
                    Padding(
                      padding: EdgeInsets.symmetric(vertical: 6),
                      child: Text('${_s(tr['pit'])}%',
                          style: TextStyle(fontSize: 12.5),
                          textAlign: TextAlign.right),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildTaxProfile() {
    if (_b(_taxProfile['hasProfile'])) {
      return _buildTaxDashboard();
    }
    return Column(
      children: [
        _buildStepIndicator(),
        _buildWizardStep(),
      ],
    );
  }

  Widget _buildEInvoiceConfig() {
    final enabled = _b(_misaInteg['enabled']);
    final username = _s(_misaInteg['username']);
    final series = _s(_einvoice['series']);
    final template = _s(_einvoice['template']);

    return Panel(
      title: t('Cấu hình kết nối Hóa đơn điện tử (MISA meInvoice)'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(height: 8),
          Text(
            t('Hệ thống liên kết trực tiếp với nhà cung cấp MISA meInvoice để phát hành hóa đơn tự động từ máy tính tiền.'),
            style: TextStyle(fontSize: 13, color: DanColors.muted),
          ),
          SizedBox(height: 16),
          Text(t('Trạng thái kết nối:'),
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
          SizedBox(height: 6),
          Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: enabled ? DanColors.done : DanColors.muted,
                  shape: BoxShape.circle,
                ),
              ),
              SizedBox(width: 6),
              Text(
                enabled
                    ? t('Đã liên kết (Đang hoạt động)')
                    : t('Chưa liên kết'),
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                  color: enabled ? DanColors.done : DanColors.muted,
                ),
              ),
            ],
          ),
          SizedBox(height: 16),
          _confirmRow(t('Tài khoản kết nối'),
              username.isEmpty ? t('Chưa thiết lập') : username),
          _confirmRow(t('Ký hiệu hóa đơn'),
              series.isEmpty ? t('Chưa thiết lập') : series),
          _confirmRow(t('Mẫu số hóa đơn'),
              template.isEmpty ? t('Chưa thiết lập') : template),
          SizedBox(height: 12),
          Divider(),
          SizedBox(height: 12),
          Text(
            t('Lưu ý: Mọi cấu hình chi tiết khác cần thiết lập trên giao diện Web quản trị.'),
            style: TextStyle(
                fontSize: 11.5,
                fontStyle: FontStyle.italic,
                color: DanColors.muted),
          ),
        ],
      ),
    );
  }

  Widget _subtabBtn(String key, String label) {
    final active = _subtab == key;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _subtab = key),
        child: Container(
          padding: EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: active ? DanColors.surface : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
            boxShadow: active
                ? [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.05),
                      blurRadius: 3,
                      offset: Offset(0, 1),
                    )
                  ]
                : null,
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.bold,
              color: active ? DanColors.brand : DanColors.muted,
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: t('Kế toán'),
      onRefresh: _load,
      child: settingsState(
        loading: _loading && _ops.isEmpty,
        error: _ops.isEmpty ? _error : null,
        onRetry: _load,
        child: ListView(
          padding: EdgeInsets.all(18),
          children: [
            Container(
              margin: EdgeInsets.only(bottom: 18),
              padding: EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: DanColors.surface2,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: DanColors.border, width: 1),
              ),
              child: Row(
                children: [
                  _subtabBtn('tax_profile', t('Hồ sơ thuế')),
                  _subtabBtn('payments', t('Thanh toán & Ca')),
                  _subtabBtn('einvoice_cfg', t('HĐĐT (MISA)')),
                ],
              ),
            ),
            if (_subtab == 'tax_profile')
              _buildTaxProfile()
            else if (_subtab == 'einvoice_cfg')
              _buildEInvoiceConfig()
            else ...[
              Panel(
                title: t('Tài khoản ngân hàng nhận chuyển khoản'),
                child: Column(
                  children: [
                    _field(t('Tên ngân hàng'), _bankName),
                    _field(t('Số tài khoản'), _bankAccount),
                    _field(t('Tên chủ tài khoản'), _accountName),
                    _field(t('Tiền tố nội dung CK (memo)'), _transferPrefix,
                        hint: 'VD: DANBILL'),
                  ],
                ),
              ),
              SizedBox(height: 16),
              Panel(
                title: t('Phương thức thanh toán'),
                child: Column(
                  children: [
                    for (var i = 0; i < _methods.length; i++)
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        value: _b(_methods[i]['enabled']),
                        activeThumbColor: DanColors.done,
                        title: Text(_s(_methods[i]['label']),
                            style: TextStyle(
                                fontSize: 13.5, fontWeight: FontWeight.w700)),
                        subtitle: Text(_kindLabel(_s(_methods[i]['kind'])),
                            style: TextStyle(
                                fontSize: 11, color: DanColors.faint)),
                        onChanged: (v) =>
                            setState(() => _methods[i]['enabled'] = v),
                      ),
                  ],
                ),
              ),
              SizedBox(height: 16),
              Panel(
                title: t('Ca làm việc & Két tiền'),
                child: Column(
                  children: [
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      value: _requireOpenShift,
                      activeThumbColor: DanColors.brand,
                      title: Text(t('Bắt buộc mở ca trước khi bán'),
                          style: TextStyle(
                              fontSize: 13.5, fontWeight: FontWeight.w700)),
                      onChanged: (v) => setState(() => _requireOpenShift = v),
                    ),
                    _field(t('Tiền két gốc mặc định (đ)'), _drawerCash,
                        number: true),
                    if (_drawerCash.text.trim() == _origDrawerCash.toString())
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                            t('Hiện tại: ${Fmt.money(_origDrawerCash)}'),
                            style: TextStyle(
                                fontSize: 11.5, color: DanColors.faint)),
                      ),
                  ],
                ),
              ),
              SizedBox(height: 20),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton.icon(
                  onPressed: _saving ? null : _save,
                  icon: _saving
                      ? SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : Icon(Icons.save, size: 18),
                  label: Text(t('Lưu thay đổi')),
                  style: FilledButton.styleFrom(minimumSize: Size(0, 44)),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _kindLabel(String kind) {
    switch (kind) {
      case 'cash':
        return t('Tiền mặt');
      case 'qr':
        return t('Mã QR / chuyển khoản');
      case 'pos':
        return t('Máy POS / thẻ');
      case 'wallet':
        return t('Ví điện tử');
      case 'voucher':
        return 'Voucher';
      default:
        return t('Khác');
    }
  }

  Widget _field(String label, TextEditingController c,
      {bool number = false, String? hint}) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 7),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          SizedBox(height: 5),
          TextField(
            controller: c,
            keyboardType: number ? TextInputType.number : null,
            decoration: InputDecoration(hintText: hint, isDense: true),
            onChanged: (_) => setState(() {}),
          ),
        ],
      ),
    );
  }
}

// ── Connections: Kết nối ─────────────────────────────────────────────────

