import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import 'management_widgets.dart';
import 'settings_tab.dart';

String _s(dynamic v) => v?.toString() ?? '';
bool _b(dynamic v) => v == true || v == 1 || v == '1';
int _i(dynamic v) => v is num ? v.toInt() : int.tryParse(_s(v)) ?? 0;

// Loại màn hình (device) → tên tiếng Việt để hiển thị ở "Thiết bị đang kết nối".
String _connDeviceLabel(String d) {
  switch (d) {
    case 'admin':
      return 'Bảng quản lý';
    case 'pos':
      return 'POS nhà hàng';
    case 'retail':
      return 'Bán lẻ (Retail POS)';
    case 'kds':
      return 'Màn bếp (KDS)';
    case 'ipad':
      return 'iPad khách';
    case 'online':
      return 'Kênh online';
    case 'warehouse':
      return 'Kho';
    default:
      return d.isEmpty || d == 'unknown' ? 'Thiết bị' : d;
  }
}

String _connRoleLabel(String r) {
  switch (r) {
    case 'owner':
    case 'admin':
      return 'Admin';
    case 'manager':
      return 'Quản lý';
    case 'cashier':
      return 'Thu ngân';
    case 'kitchen':
      return 'Bếp';
    case 'warehouse':
      return 'Thủ kho';
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
  const OperationsPanel({super.key, required this.api});

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
      'locations': (tp['locations'] is List && (tp['locations'] as List).isNotEmpty)
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
      'taxRates': (tp['taxRates'] is List && (tp['taxRates'] as List).isNotEmpty)
          ? (tp['taxRates'] as List)
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
          : [
              { 'category': 'distribution', 'name': 'Bán buôn/Bán lẻ', 'vat': 1.0, 'pit': 0.5 },
              { 'category': 'services', 'name': 'Dịch vụ', 'vat': 5.0, 'pit': 2.0 },
              { 'category': 'manufacturing', 'name': 'Sản xuất', 'vat': 3.0, 'pit': 1.5 },
              { 'category': 'catering', 'name': 'Ăn uống/Giải trí', 'vat': 2.0, 'pit': 1.0 }
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
      final opsMap = ops is Map ? Map<String, dynamic>.from(ops) : <String, dynamic>{};
      
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
        _branches = branchesList.map((e) => Map<String, dynamic>.from(e)).toList();
        _categories = categoriesList.map((e) => Map<String, dynamic>.from(e)).toList();

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
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Đã lưu hồ sơ kê khai thuế thành công!'),
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
      pin = await settingsPin(context, 'Đổi tiền két gốc mặc định.');
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
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Đã lưu cấu hình tài chính'),
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
    final steps = ['Giới thiệu', 'Thông tin', 'Chi nhánh', 'Doanh thu', 'Thuế suất', 'Xác nhận'];
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
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
                const SizedBox(width: 4),
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
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 4),
                    child: Icon(Icons.chevron_right, size: 12, color: DanColors.faint),
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
          title: 'Thiết lập hồ sơ kê khai thuế lần đầu',
          child: Column(
            children: [
              const SizedBox(height: 12),
              const Icon(Icons.description_outlined, size: 64, color: DanColors.brand),
              const SizedBox(height: 12),
              const Text(
                'Chào mừng bạn đến với tính năng Thuế & Kế toán!',
                textAlign: TextAlign.center,
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
              ),
              const SizedBox(height: 8),
              const Text(
                'Hệ thống sẽ hướng dẫn bạn thiết lập hồ sơ kê khai thuế, tự động gán thuế suất mặc định và hỗ trợ xuất biểu mẫu kê khai theo quy định mới nhất.',
                textAlign: TextAlign.center,
                style: TextStyle(color: DanColors.muted, fontSize: 12.5),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () => setState(() => _wizStep = 2),
                child: const Text('Bắt đầu thiết lập →'),
              ),
            ],
          ),
        );
      case 2:
        return Panel(
          title: 'Thông tin đăng ký kinh doanh',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _field('Mã số thuế (MST) (bỏ qua nếu chưa có)', _wizTaxCode),
              _field('Tên Hộ kinh doanh *', _wizBusinessName),
              _field('Ngày chuyển sang phương pháp kê khai *', _wizTransitionDate, hint: 'YYYY-MM-DD'),
              const SizedBox(height: 16),
              _stepNavigation(),
            ],
          ),
        );
      case 3:
        final locs = (_wiz['locations'] as List);
        return Panel(
          title: 'Chi nhánh & Địa điểm kinh doanh',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Nhập mã địa điểm kinh doanh (MST 13 số nếu có) và chọn trụ sở chính:',
                style: TextStyle(fontSize: 12.5, color: DanColors.muted),
              ),
              const SizedBox(height: 12),
              for (int idx = 0; idx < locs.length; idx++) ...[
                Container(
                  padding: const EdgeInsets.all(12),
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
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5),
                      ),
                      const SizedBox(height: 8),
                      TextFormField(
                        initialValue: _s(locs[idx]['address']),
                        decoration: const InputDecoration(
                          hintText: 'Mã địa điểm kinh doanh...',
                          isDense: true,
                        ),
                        onChanged: (v) => setState(() => locs[idx]['address'] = v),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Radio<bool>(
                            value: true,
                            groupValue: _b(locs[idx]['isHeadquarters']),
                            activeColor: DanColors.brand,
                            onChanged: (v) {
                              setState(() {
                                for (var l in locs) {
                                  l['isHeadquarters'] = false;
                                }
                                locs[idx]['isHeadquarters'] = true;
                              });
                            },
                          ),
                          const Text('Đặt làm trụ sở chính', style: TextStyle(fontSize: 12)),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
              ],
              const SizedBox(height: 12),
              _stepNavigation(),
            ],
          ),
        );
      case 4:
        final currentGroup = _i(_wiz['revenueGroup']);
        final groups = [
          { 'id': 1, 'name': 'Nhóm 1: Doanh thu < 1 tỷ đồng / năm', 'desc': 'Miễn thuế GTGT và TNCN. Sử dụng Sổ kế toán S1a đơn giản, không bắt buộc HĐĐT.' },
          { 'id': 2, 'name': 'Nhóm 2: Doanh thu 1 tỷ – 3 tỷ đồng / năm', 'desc': 'Thuế GTGT/TNCN tính theo tỷ lệ %. Kê khai thuế theo Quý, bắt buộc sử dụng HĐĐT và Sổ S2a.' },
          { 'id': 3, 'name': 'Nhóm 3: Doanh thu 3 tỷ – 50 tỷ đồng / năm', 'desc': 'Thuế GTGT/TNCN tính theo tỷ lệ %. Kê khai thuế theo Quý/Năm, bắt buộc sử dụng Bộ 4 sổ và HĐĐT.' },
          { 'id': 4, 'name': 'Nhóm 4: Doanh thu > 50 tỷ đồng / năm', 'desc': 'Mô hình HKD quy mô lớn. Nghĩa vụ thuế và báo cáo tài chính bắt buộc tương đương doanh nghiệp.' }
        ];
        return Panel(
          title: 'Phân loại nhóm doanh thu kinh doanh',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Lựa chọn quy mô doanh thu ước tính để kích hoạt biểu mẫu biểu thuế tương ứng:',
                style: TextStyle(fontSize: 12.5, color: DanColors.muted),
              ),
              const SizedBox(height: 12),
              for (final g in groups) ...[
                GestureDetector(
                  onTap: () => setState(() => _wiz['revenueGroup'] = g['id']),
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: currentGroup == g['id'] ? DanColors.brandDim : DanColors.surface,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: currentGroup == g['id'] ? DanColors.brand : DanColors.border,
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
                            color: currentGroup == g['id'] ? DanColors.brand : DanColors.text,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          _s(g['desc']),
                          style: const TextStyle(fontSize: 11.5, color: DanColors.muted),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 8),
              ],
              const SizedBox(height: 12),
              _stepNavigation(),
            ],
          ),
        );
      case 5:
        final rates = (_wiz['taxRates'] as List);
        final scope = _s(_wiz['productScope']);
        return Panel(
          title: 'Phạm vi & Tỷ lệ thuế suất',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Chọn phạm vi áp dụng thuế cho các mặt hàng trong thực đơn:',
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 6),
              DropdownButtonFormField<String>(
                value: scope,
                decoration: const InputDecoration(isDense: true),
                items: const [
                  DropdownMenuItem(value: 'all', child: Text('Tất cả thực đơn')),
                  DropdownMenuItem(value: 'groups', child: Text('Chỉ áp dụng cho các danh mục chọn')),
                  DropdownMenuItem(value: 'exclude', child: Text('Tất cả ngoại trừ danh mục chọn')),
                ],
                onChanged: (v) => setState(() => _wiz['productScope'] = v),
              ),
              if (scope != 'all') ...[
                const SizedBox(height: 12),
                const Text('Chọn danh mục hàng hóa áp dụng:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final cat in _categories) ...[
                      FilterChip(
                        label: Text('${_s(cat['icon'])} ${_s(cat['name'])}'),
                        selected: (_wiz['scopeValue'] as List).contains(_s(cat['id'])),
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
                const SizedBox(height: 8),
                Row(
                  children: [
                    Checkbox(
                      value: _b(_wiz['confirmNoTax']),
                      onChanged: (v) => setState(() => _wiz['confirmNoTax'] = v),
                    ),
                    const Expanded(
                      child: Text(
                        'Tôi xác nhận các hàng hóa khác không thuộc đối tượng chịu thuế',
                        style: TextStyle(fontSize: 11.5),
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 16),
              const Text(
                'Tỷ lệ thuế suất tính theo doanh thu (%) của từng nhóm ngành:',
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 10),
              Table(
                columnWidths: const {
                  0: FlexColumnWidth(2),
                  1: FixedColumnWidth(70),
                  2: FixedColumnWidth(70),
                },
                children: [
                  const TableRow(
                    children: [
                      Padding(padding: EdgeInsets.symmetric(vertical: 4), child: Text('Nhóm ngành', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11.5))),
                      Padding(padding: EdgeInsets.symmetric(vertical: 4), child: Text('GTGT (%)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11.5), textAlign: TextAlign.right)),
                      Padding(padding: EdgeInsets.symmetric(vertical: 4), child: Text('TNCN (%)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11.5), textAlign: TextAlign.right)),
                    ],
                  ),
                  for (int idx = 0; idx < rates.length; idx++)
                    TableRow(
                      children: [
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Text(_s(rates[idx]['name']), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold)),
                        ),
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 2, horizontal: 4),
                          child: TextFormField(
                            initialValue: _s(rates[idx]['vat']),
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            textAlign: TextAlign.right,
                            decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.all(6)),
                            onChanged: (v) => rates[idx]['vat'] = double.tryParse(v) ?? 0.0,
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 2, horizontal: 4),
                          child: TextFormField(
                            initialValue: _s(rates[idx]['pit']),
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            textAlign: TextAlign.right,
                            decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.all(6)),
                            onChanged: (v) => rates[idx]['pit'] = double.tryParse(v) ?? 0.0,
                          ),
                        ),
                      ],
                    ),
                ],
              ),
              const SizedBox(height: 16),
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
        final revGroupName = _wiz['revenueGroup'] == 1 ? 'Nhóm 1 (< 1 tỷ/năm)' : _wiz['revenueGroup'] == 2 ? 'Nhóm 2 (1 tỷ - 3 tỷ/năm)' : _wiz['revenueGroup'] == 3 ? 'Nhóm 3 (3 tỷ - 50 tỷ/năm)' : 'Nhóm 4 (> 50 tỷ/năm)';
        return Panel(
          title: 'Xác nhận thông tin hồ sơ',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: DanColors.surface2,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  children: [
                    _confirmRow('MST', _wizTaxCode.text.isEmpty ? 'Chưa thiết lập' : _wizTaxCode.text),
                    _confirmRow('Tên Hộ kinh doanh', _wizBusinessName.text),
                    _confirmRow('Ngày bắt đầu kê khai', _wizTransitionDate.text),
                    _confirmRow('Phân loại doanh thu', revGroupName),
                    _confirmRow('Trụ sở chính', '${_s(hq['name'])} - ${_s(hq['address']).isEmpty ? 'Chưa nhập' : _s(hq['address'])}'),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Checkbox(
                    value: _b(_wiz['confirmFinal']),
                    onChanged: (v) => setState(() => _wiz['confirmFinal'] = v),
                  ),
                  const Expanded(
                    child: Text(
                      'Tôi cam đoan thông tin khai trên là đúng sự thật và chịu hoàn toàn trách nhiệm.',
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              _stepNavigation(isFinish: true),
            ],
          ),
        );
      default:
        return const SizedBox.shrink();
    }
  }

  Widget _confirmRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 130,
            child: Text(label, style: const TextStyle(fontSize: 12, color: DanColors.muted)),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold)),
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
            child: const Text('Quay lại'),
          )
        else
          const SizedBox.shrink(),
        if (isFinish)
          FilledButton(
            onPressed: _b(_wiz['confirmFinal']) ? _finishWizard : null,
            child: const Text('Hoàn thành & Kích hoạt'),
          )
        else
          FilledButton(
            onPressed: _nextWizardStep,
            child: const Text('Tiếp tục'),
          ),
      ],
    );
  }

  void _nextWizardStep() {
    if (_wizStep == 2) {
      if (_wizBusinessName.text.trim().isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Vui lòng nhập tên Hộ kinh doanh'),
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
    final revGroupName = p['revenueGroup'] == 1 ? 'Nhóm 1 (< 1 tỷ/năm)' : p['revenueGroup'] == 2 ? 'Nhóm 2 (1 tỷ - 3 tỷ/năm)' : p['revenueGroup'] == 3 ? 'Nhóm 3 (3 tỷ - 50 tỷ/năm)' : 'Nhóm 4 (> 50 tỷ/năm)';
    final rates = (p['taxRates'] is List ? p['taxRates'] as List : []);

    return Column(
      children: [
        Panel(
          title: 'Hồ sơ khai thuế Hộ kinh doanh',
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
                  child: const Text('Cập nhật hồ sơ'),
                ),
              ),
              const SizedBox(height: 12),
              _confirmRow('MST', _s(p['taxCode'])),
              _confirmRow('Tên Hộ kinh doanh', _s(p['businessName'])),
              _confirmRow('Ngày bắt đầu kê khai', _s(p['transitionDate'])),
              _confirmRow('Quy mô doanh thu', revGroupName),
              _confirmRow('Trụ sở chính', '${_s(hq['name'])} - ${_s(hq['address'])}'),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Panel(
          title: 'Địa điểm kinh doanh liên kết',
          child: Column(
            children: [
              for (final loc in (p['locations'] is List ? p['locations'] as List : []))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(_s(loc['name']), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5)),
                  subtitle: Text('Mã địa điểm: ${_s(loc['address']).isEmpty ? 'Chưa gán' : _s(loc['address'])}', style: const TextStyle(fontSize: 11.5, color: DanColors.muted)),
                  trailing: _b(loc['isHeadquarters']) ? const Chip(label: Text('Trụ sở chính', style: TextStyle(fontSize: 10))) : null,
                ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Panel(
          title: 'Tỷ lệ thuế suất áp dụng',
          child: Table(
            columnWidths: const {
              0: FlexColumnWidth(2),
              1: FixedColumnWidth(80),
              2: FixedColumnWidth(80),
            },
            children: [
              const TableRow(
                children: [
                  Padding(padding: EdgeInsets.symmetric(vertical: 4), child: Text('Nhóm ngành', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12))),
                  Padding(padding: EdgeInsets.symmetric(vertical: 4), child: Text('GTGT', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12), textAlign: TextAlign.right)),
                  Padding(padding: EdgeInsets.symmetric(vertical: 4), child: Text('TNCN', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12), textAlign: TextAlign.right)),
                ],
              ),
              for (final tr in rates)
                TableRow(
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Text(_s(tr['name']), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold)),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Text('${_s(tr['vat'])}%', style: const TextStyle(fontSize: 12.5), textAlign: TextAlign.right),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Text('${_s(tr['pit'])}%', style: const TextStyle(fontSize: 12.5), textAlign: TextAlign.right),
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
      title: 'Cấu hình kết nối Hóa đơn điện tử (MISA meInvoice)',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),
          const Text(
            'Hệ thống liên kết trực tiếp với nhà cung cấp MISA meInvoice để phát hành hóa đơn tự động từ máy tính tiền.',
            style: TextStyle(fontSize: 13, color: DanColors.muted),
          ),
          const SizedBox(height: 16),
          const Text('Trạng thái kết nối:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
          const SizedBox(height: 6),
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
              const SizedBox(width: 6),
              Text(
                enabled ? 'Đã liên kết (Đang hoạt động)' : 'Chưa liên kết',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                  color: enabled ? DanColors.done : DanColors.muted,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _confirmRow('Tài khoản kết nối', username.isEmpty ? 'Chưa thiết lập' : username),
          _confirmRow('Ký hiệu hóa đơn', series.isEmpty ? 'Chưa thiết lập' : series),
          _confirmRow('Mẫu số hóa đơn', template.isEmpty ? 'Chưa thiết lập' : template),
          const SizedBox(height: 12),
          const Divider(),
          const SizedBox(height: 12),
          const Text(
            'Lưu ý: Mọi cấu hình chi tiết khác cần thiết lập trên giao diện Web quản trị.',
            style: TextStyle(fontSize: 11.5, fontStyle: FontStyle.italic, color: DanColors.muted),
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
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: active ? DanColors.surface : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
            boxShadow: active
                ? [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.05),
                      blurRadius: 3,
                      offset: const Offset(0, 1),
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
      title: 'Kế toán',
      onRefresh: _load,
      child: settingsState(
        loading: _loading && _ops.isEmpty,
        error: _ops.isEmpty ? _error : null,
        onRetry: _load,
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            Container(
              margin: const EdgeInsets.only(bottom: 18),
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: DanColors.surface2,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: DanColors.border, width: 1),
              ),
              child: Row(
                children: [
                  _subtabBtn('tax_profile', 'Hồ sơ thuế'),
                  _subtabBtn('payments', 'Thanh toán & Ca'),
                  _subtabBtn('einvoice_cfg', 'HĐĐT (MISA)'),
                ],
              ),
            ),
            if (_subtab == 'tax_profile')
              _buildTaxProfile()
            else if (_subtab == 'einvoice_cfg')
              _buildEInvoiceConfig()
            else ...[
              Panel(
                title: 'Tài khoản ngân hàng nhận chuyển khoản',
                child: Column(
                  children: [
                    _field('Tên ngân hàng', _bankName),
                    _field('Số tài khoản', _bankAccount),
                    _field('Tên chủ tài khoản', _accountName),
                    _field('Tiền tố nội dung CK (memo)', _transferPrefix,
                        hint: 'VD: DANBILL'),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Panel(
                title: 'Phương thức thanh toán',
                child: Column(
                  children: [
                    for (var i = 0; i < _methods.length; i++)
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        value: _b(_methods[i]['enabled']),
                        activeThumbColor: DanColors.done,
                        title: Text(_s(_methods[i]['label']),
                            style: const TextStyle(
                                fontSize: 13.5, fontWeight: FontWeight.w700)),
                        subtitle: Text(_kindLabel(_s(_methods[i]['kind'])),
                            style: const TextStyle(fontSize: 11, color: DanColors.faint)),
                        onChanged: (v) =>
                            setState(() => _methods[i]['enabled'] = v),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Panel(
                title: 'Ca làm việc & Két tiền',
                child: Column(
                  children: [
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      value: _requireOpenShift,
                      activeThumbColor: DanColors.brand,
                      title: const Text('Bắt buộc mở ca trước khi bán',
                          style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
                      onChanged: (v) => setState(() => _requireOpenShift = v),
                    ),
                    _field('Tiền két gốc mặc định (đ)', _drawerCash, number: true),
                    if (_drawerCash.text.trim() == _origDrawerCash.toString())
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text('Hiện tại: ${Fmt.money(_origDrawerCash)}',
                            style: const TextStyle(
                                fontSize: 11.5, color: DanColors.faint)),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton.icon(
                  onPressed: _saving ? null : _save,
                  icon: _saving
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.save, size: 18),
                  label: const Text('Lưu thay đổi'),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
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
        return 'Tiền mặt';
      case 'qr':
        return 'Mã QR / chuyển khoản';
      case 'pos':
        return 'Máy POS / thẻ';
      case 'wallet':
        return 'Ví điện tử';
      case 'voucher':
        return 'Voucher';
      default:
        return 'Khác';
    }
  }

  Widget _field(String label, TextEditingController c,
      {bool number = false, String? hint}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          const SizedBox(height: 5),
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

class ConnectionsPanel extends StatefulWidget {
  final ApiService api;
  const ConnectionsPanel({super.key, required this.api});

  @override
  State<ConnectionsPanel> createState() => _ConnectionsPanelState();
}

const _ctModeOptions = [
  ['auto', 'Tự động — máy tự quẹt thẻ qua app ngân hàng (cần app POS Android)'],
  ['manual', 'Thủ công — thu ngân tự quẹt rồi nhập approval code'],
  ['off', 'Tắt — không dùng máy POS thẻ'],
];

const _outputLabels = {
  'kitchen_ticket': 'Phiếu bếp',
  'receipt': 'Hóa đơn',
  'cup_label': 'Tem ly',
  'product_label': 'Tem sản phẩm',
  'runner': 'Phiếu chạy',
  'report': 'Báo cáo',
  'test': 'In thử',
  'cash_drawer': 'Mở két',
};

String _fmtTime(String iso) {
  if (iso.isEmpty) return '';
  try {
    final dt = DateTime.parse(iso).toLocal();
    final h = dt.hour.toString().padLeft(2, '0');
    final m = dt.minute.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    final mo = dt.month.toString().padLeft(2, '0');
    return '$h:$m $d/$mo';
  } catch (_) {
    return '';
  }
}

class _ConnectionsPanelState extends State<ConnectionsPanel> {
  Map<String, dynamic> _status = {};
  Map<String, dynamic> _ops = {};
  Map<String, dynamic> _printConfig = {};
  List<Map<String, dynamic>> _printers = [];
  List<Map<String, dynamic>> _systemPrinters = [];
  List<Map<String, dynamic>> _recentJobs = [];
  int _pingMs = 0;
  bool _loading = true;
  bool _savingCt = false;
  bool _savingPrinters = false;
  bool _loadingSystemPrinters = false;
  String? _error;

  // Card-terminal state
  String _ctMode = 'auto';
  final _ctProvider = TextEditingController();
  final _ctName = TextEditingController();
  final _ctIp = TextEditingController();
  final _ctPort = TextEditingController();
  bool _ctAutoPrint = true;

  List<PrinterControllers> _printerControllersList = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _ctProvider.dispose();
    _ctName.dispose();
    _ctIp.dispose();
    _ctPort.dispose();
    for (final c in _printerControllersList) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load({bool force = false}) async {
    setState(() { _loading = true; _error = null; });
    try {
      final sw = Stopwatch()..start();
      final results = await Future.wait([
        widget.api.getConnectionsStatus(force: force),
        widget.api.getAppSettings(),
        widget.api.getSystemPrinters(force: force).catchError((_) => <String, dynamic>{}),
        widget.api.getPrintJobs().catchError((_) => <dynamic>[]),
      ]);
      sw.stop();
      if (!mounted) return;
      setState(() {
        _status = Map<String, dynamic>.from(results[0] as Map);
        _pingMs = sw.elapsedMilliseconds;
        final settings = Map<String, dynamic>.from(results[1] as Map);
        _ops = settings['operations_config'] is Map
            ? Map<String, dynamic>.from(settings['operations_config'])
            : {};
        _printConfig = settings['print_config'] is Map
            ? Map<String, dynamic>.from(settings['print_config'])
            : {};
        _printers = (_printConfig['printers'] as List? ?? [])
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();

        final systemPrintersData = results[2] as Map;
        _systemPrinters = (systemPrintersData['printers'] as List? ?? [])
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();

        _recentJobs = (results[3] as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .take(20)
            .toList();

        for (final c in _printerControllersList) {
          c.dispose();
        }
        _printerControllersList = _printers.map((p) => PrinterControllers(
          idVal: _s(p['id']),
          systemNameVal: _s(p['systemName'] ?? p['name']),
          ipVal: _s(p['ip']),
          portVal: _s(p['port'] ?? '9100'),
          labelVal: _s(p['label'] ?? p['type']),
          locationVal: _s(p['location']),
        )).toList();

        _syncCardTerminal();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString().replaceFirst('Exception: ', ''); _loading = false; });
    }
  }

  Map<String, dynamic> get _cardTerminal {
    final pay = _ops['payment'];
    final ct = pay is Map ? pay['cardTerminal'] : null;
    return ct is Map ? Map<String, dynamic>.from(ct) : {};
  }

  void _syncCardTerminal() {
    final ct = _cardTerminal;
    _ctMode = _s(ct['mode']).isNotEmpty ? _s(ct['mode']) : 'auto';
    _ctProvider.text = _s(ct['provider']).isNotEmpty ? _s(ct['provider']) : 'vcb';
    _ctName.text = _s(ct['terminalName']);
    _ctIp.text = _s(ct['ip']).isNotEmpty ? _s(ct['ip']) : '127.0.0.1';
    _ctPort.text = _s(ct['port']).isNotEmpty ? _s(ct['port']) : '25000';
    _ctAutoPrint = ct['autoPrint'] == null ? true : _b(ct['autoPrint']);
  }

  Future<void> _saveCardTerminal() async {
    final pin = await settingsPin(context, 'Xác nhận thay đổi cấu hình máy POS thẻ.');
    if (pin == null) return;
    final ops = Map<String, dynamic>.from(_ops);
    final pay = ops['payment'] is Map
        ? Map<String, dynamic>.from(ops['payment'])
        : <String, dynamic>{};
    pay['cardTerminal'] = {
      'mode': _ctMode,
      'provider': _ctProvider.text.trim(),
      'terminalName': _ctName.text.trim(),
      'ip': _ctIp.text.trim(),
      'port': int.tryParse(_ctPort.text.trim()) ?? 25000,
      'autoPrint': _ctAutoPrint,
    };
    ops['payment'] = pay;
    setState(() => _savingCt = true);
    try {
      await widget.api.saveAppSettings({'operations_config': ops, 'security_pin': pin});
      if (!mounted) return;
      _ops = ops;
      setState(() => _savingCt = false);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Đã lưu cấu hình máy POS thẻ'),
          backgroundColor: DanColors.text));
    } catch (e) {
      if (!mounted) return;
      setState(() => _savingCt = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late));
    }
  }

  Future<void> _testPrinter(String id) async {
    try {
      await widget.api.testPrinter(id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Đã gửi job in thử'), backgroundColor: DanColors.text));
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
      title: 'Kết nối',
      onRefresh: () => _load(force: true),
      child: settingsState(
        loading: _loading && _status.isEmpty,
        error: _status.isEmpty ? _error : null,
        onRetry: () => _load(force: true),
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            _twoCol(_networkPanel(), _storagePanel()),
            const SizedBox(height: 16),
            _twoCol(_printerStatusPanel(), _cardPosPanel()),
            const SizedBox(height: 16),
            _devicesPanel(),
            const SizedBox(height: 16),
            _printerRegistryPanel(),
            const SizedBox(height: 16),
            _recentJobsPanel(),
          ],
        ),
      ),
    );
  }

  Widget _twoCol(Widget a, Widget b) => LayoutBuilder(builder: (context, c) {
    if (c.maxWidth >= 900) {
      return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: a), const SizedBox(width: 16), Expanded(child: b),
      ]);
    }
    return Column(children: [a, const SizedBox(height: 16), b]);
  });

  // ── Mạng & Máy chủ ──
  Widget _networkPanel() {
    final internet = _b(_status['internet']);
    final wan = _status['internetCheck'] is Map
        ? Map<String, dynamic>.from(_status['internetCheck']) : {};
    final wanMs = _i(wan['latency_ms']);
    final ips = (_status['serverIps'] is List)
        ? (_status['serverIps'] as List).map(_s).where((e) => e.isNotEmpty).toList()
        : <String>[];
    return Panel(
      title: 'Mạng & Máy chủ',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _infoRow('Internet / WAN',
            internet ? _pill('Online · ${wanMs}ms', DanColors.done) : _pill('Offline', DanColors.late)),
        const Divider(height: 18, color: DanColors.border),
        _infoRow('Địa chỉ Server (IP LAN)',
            Text(ips.isEmpty ? '127.0.0.1' : ips.join(', '),
                style: const TextStyle(fontFamily: 'JetBrains Mono', fontSize: 12.5,
                    fontWeight: FontWeight.w700, color: DanColors.brand))),
        const Divider(height: 18, color: DanColors.border),
        _infoRow('Độ trễ (Ping)',
            _pill('${_pingMs}ms · ${_pingLabel(_pingMs)}', _pingColor(_pingMs))),
      ]),
    );
  }

  String _pingLabel(int ms) => ms < 100 ? 'Nhanh' : (ms < 250 ? 'Bình thường' : 'Chậm');
  Color _pingColor(int ms) => ms < 100 ? DanColors.done : (ms < 250 ? DanColors.doing : DanColors.late);

  // ── Lưu trữ cục bộ ──
  Widget _storagePanel() {
    final st = _status['storage'] is Map
        ? Map<String, dynamic>.from(_status['storage']) : {};
    final db = _s(st['database']).isNotEmpty ? _s(st['database']) : 'SQLite';
    final dbMode = _s(st['databaseMode']).isNotEmpty ? _s(st['databaseMode']) : 'WAL';
    final rt = _s(st['realtime']).isNotEmpty ? _s(st['realtime']) : 'Socket.IO';
    final lt = _s(st['longTerm']).isNotEmpty ? _s(st['longTerm']) : 'Permanent JSON';
    return Panel(
      title: 'Lưu trữ cục bộ',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _infoRow('Cơ sở dữ liệu', _pill('$db · $dbMode mode', DanColors.done)),
        const Divider(height: 18, color: DanColors.border),
        _infoRow('Realtime', _pill(rt, DanColors.done)),
        const Divider(height: 18, color: DanColors.border),
        _infoRow('Lưu trữ lâu dài', _pill(lt, DanColors.done)),
      ]),
    );
  }

  // ── Trạng thái máy in (dùng printerStatuses từ API) ──
  Widget _printerStatusPanel() {
    final printers = (_status['printerStatuses'] is List)
        ? (_status['printerStatuses'] as List).whereType<Map>().toList()
        : <Map>[];
    return Panel(
      title: 'Trạng thái máy in',
      child: printers.isEmpty
          ? const Padding(
              padding: EdgeInsets.symmetric(vertical: 14),
              child: Text('Chưa có máy in nào được cấu hình trong Danh mục in',
                  style: TextStyle(color: DanColors.faint)))
          : Column(children: [for (final p in printers) _printerStatusRow(p)]),
    );
  }

  Widget _printerStatusRow(Map p) {
    final label = _s(p['label']).isNotEmpty ? _s(p['label']) : _s(p['name']);
    final location = _s(p['location']);
    final connection = _s(p['connection']);
    final ip = _s(p['ip']);
    final port = _i(p['port']) > 0 ? _i(p['port']) : 9100;
    final output = _outputLabels[_s(p['output'])] ?? _s(p['output']);
    final state = _s(p['state']);
    final statusText = _s(p['statusText']);
    final online = _b(p['online']);

    final (statusLabel, statusColor) = switch (state) {
      'ok' => ('Kết nối', DanColors.done),
      'warn' => ('Cảnh báo', DanColors.doing),
      'bad' => ('Mất kết nối', DanColors.late),
      _ => online ? ('Kết nối', DanColors.done) : ('Không kết nối', DanColors.late),
    };

    final connDetail = connection == 'lan'
        ? (ip.isNotEmpty ? '$ip:$port' : 'Chưa có IP')
        : connection == 'system'
            ? (_s(p['systemName']).isNotEmpty ? _s(p['systemName']) : 'Máy in hệ thống')
            : 'Trình duyệt';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(children: [
        const Icon(Icons.print_outlined, size: 18, color: DanColors.muted),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label.isNotEmpty ? label : 'Máy in',
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            Text(
              [if (location.isNotEmpty) location, if (output.isNotEmpty) output, connDetail]
                  .join(' · '),
              style: const TextStyle(fontSize: 11, color: DanColors.muted),
            ),
            if (statusText.isNotEmpty && state != 'ok')
              Text(statusText, style: const TextStyle(fontSize: 11, color: DanColors.late)),
          ]),
        ),
        _pill(statusLabel, statusColor),
      ]),
    );
  }

  // ── Máy POS thẻ (khớp web: mode, provider text, terminal name text) ──
  Widget _cardPosPanel() {
    final modeKeys = _ctModeOptions.map((e) => e[0]).toList();
    final safeMode = modeKeys.contains(_ctMode) ? _ctMode : modeKeys.first;
    return Panel(
      title: 'Máy POS thẻ (quẹt thẻ)',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text(
            'Cấu hình cách máy POS xử lý khi bấm "Thanh toán thẻ". "Tự động" khi máy chưa cấu nối sẽ tự hạ xuống "Thủ công", không bị treo.',
            style: TextStyle(fontSize: 11.5, color: DanColors.muted, height: 1.4)),
        const SizedBox(height: 12),
        _ctLabel('CHẾ ĐỘ HOẠT ĐỘNG'),
        DropdownButtonFormField<String>(
          initialValue: safeMode,
          isExpanded: true,
          decoration: const InputDecoration(isDense: true),
          items: [
            for (final m in _ctModeOptions)
              DropdownMenuItem(value: m[0], child: Text(m[1], overflow: TextOverflow.ellipsis)),
          ],
          onChanged: (v) => setState(() => _ctMode = v ?? _ctMode),
        ),
        const SizedBox(height: 10),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            _ctLabel('NHÀ CUNG CẤP'),
            TextField(
              controller: _ctProvider,
              decoration: const InputDecoration(isDense: true, hintText: 'vcb'),
            ),
          ])),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            _ctLabel('TÊN MÁY POS THẺ'),
            TextField(
              controller: _ctName,
              decoration: const InputDecoration(isDense: true, hintText: 'VD: VCB SmartPOS'),
            ),
          ])),
        ]),
        if (_ctMode == 'auto') ...[
          const SizedBox(height: 10),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              _ctLabel('IP MÁY POS THẺ (TETHERING/LAN)'),
              TextField(
                controller: _ctIp,
                decoration: const InputDecoration(isDense: true, hintText: 'VD: 192.168.42.129 hoặc 127.0.0.1'),
              ),
            ])),
            const SizedBox(width: 10),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              _ctLabel('CỔNG (PORT)'),
              TextField(
                controller: _ctPort,
                decoration: const InputDecoration(isDense: true, hintText: '25000'),
                keyboardType: TextInputType.number,
              ),
            ])),
          ]),
        ],
        const SizedBox(height: 4),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          dense: true,
          value: _ctAutoPrint,
          activeThumbColor: DanColors.brand,
          title: const Text('Tự in bill hệ thống sau khi quẹt thẻ thành công',
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
          onChanged: (v) => setState(() => _ctAutoPrint = v),
        ),
        const SizedBox(height: 8),
        FilledButton.icon(
          onPressed: _savingCt ? null : _saveCardTerminal,
          icon: _savingCt
              ? const SizedBox(width: 16, height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.save, size: 18),
          label: const Text('Lưu cấu hình máy POS thẻ'),
          style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
        ),
      ]),
    );
  }

  // ── Thiết bị & POS đang hoạt động ──
  Widget _devicesPanel() {
    final connections = (_status['connections'] is List)
        ? (_status['connections'] as List).whereType<Map>().toList()
        : <Map>[];
    return Panel(
      title: 'Thiết bị & POS đang hoạt động (${connections.length})',
      child: connections.isEmpty
          ? const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('Chưa có thiết bị nào kết nối',
                  style: TextStyle(color: DanColors.faint)))
          : Column(children: [
              for (final c in connections)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: Icon(_connIcon(_s(c['device'])), color: DanColors.brand, size: 20),
                  title: Text(_connTitle(c),
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text(
                    [
                      _connDeviceLabel(_s(c['device'])),
                      _cleanIp(_s(c['ip'])),
                      if (_fmtTime(_s(c['connectedAt'])).isNotEmpty)
                        'kết nối ${_fmtTime(_s(c['connectedAt']))}',
                    ].where((e) => e.isNotEmpty).join(' · '),
                    style: const TextStyle(fontSize: 11.5),
                  ),
                  trailing: _pill('Online', DanColors.done),
                ),
            ]),
    );
  }

  // ── Danh mục in ──
  Widget _printerRegistryPanel() {
    return Panel(
      title: 'Danh mục in',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Chọn đúng tên máy in thật từ hệ điều hành, đặt nhãn hiển thị và tuyến nhận job in.',
            style: TextStyle(fontSize: 12.5, color: DanColors.muted, height: 1.45),
          ),
          const SizedBox(height: 14),
          _guideBox(),
          if (_printers.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Text(
                'Chưa có máy in nào. Bấm "+ Thêm danh mục in" bên dưới để thêm.',
                textAlign: TextAlign.center,
                style: TextStyle(color: DanColors.faint, fontSize: 13),
              ),
            )
          else
            for (int i = 0; i < _printers.length; i++)
              if (i < _printerControllersList.length)
                _printerEditorRow(i, _printers[i], _printerControllersList[i]),
          const SizedBox(height: 12),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              OutlinedButton.icon(
                onPressed: _loadingSystemPrinters ? null : _syncSystemPrinters,
                icon: _loadingSystemPrinters
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.sync, size: 16),
                label: const Text('Đồng bộ máy in hệ điều hành'),
              ),
              OutlinedButton.icon(
                onPressed: () {
                  setState(() {
                    final newRow = {
                      'id': 'printer_${_printers.length + 1}',
                      'name': '',
                      'systemName': '',
                      'connection': 'browser',
                      'ip': '',
                      'port': 9100,
                      'label': 'Nhãn in',
                      'type': 'Nhãn in',
                      'output': 'custom',
                      'location': '',
                      'active': true,
                      'auto': false,
                      'cashDrawer': false,
                      'openDrawerOnPrint': false,
                    };
                    _printers.add(newRow);
                    _printerControllersList.add(PrinterControllers(
                      idVal: 'printer_${_printers.length}',
                      systemNameVal: '',
                      ipVal: '',
                      portVal: '9100',
                      labelVal: 'Nhãn in',
                      locationVal: '',
                    ));
                  });
                },
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Thêm danh mục in'),
              ),
              FilledButton.icon(
                onPressed: _savingPrinters ? null : _savePrinters,
                icon: _savingPrinters
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.save, size: 16),
                label: const Text('Lưu danh mục in'),
                style: FilledButton.styleFrom(
                  backgroundColor: DanColors.brand,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _guideBox() {
    return Container(
      decoration: BoxDecoration(
        color: DanColors.surface2,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(12),
      ),
      margin: const EdgeInsets.only(bottom: 16),
      child: ExpansionTile(
        title: const Text(
          'Hướng dẫn cấu hình in trực tiếp qua LAN (Mô hình IPOS - Không dùng KDS)',
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w800,
            color: DanColors.brand,
          ),
        ),
        initiallyExpanded: false,
        childrenPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Mô hình này giúp máy POS quầy và iPad tự động gửi lệnh in trực tiếp đến máy in bếp/bar qua mạng LAN nội bộ, phù hợp khi quán chưa trang bị màn hình KDS. Hãy làm theo các bước sau:',
            style: TextStyle(fontSize: 12, color: DanColors.muted, height: 1.45),
          ),
          const SizedBox(height: 12),
          _stepRow('1', 'Kết nối phần cứng', 'Cắm máy in bếp/bar vào switch hoặc router bằng dây mạng LAN. Đảm bảo thiết bị POS ở quầy và iPad cũng kết nối cùng mạng LAN (chung Wi-Fi/mạng nội bộ) đó.'),
          const SizedBox(height: 10),
          _stepRow('2', 'Xác định địa chỉ IP của máy in', 'In phiếu tự kiểm tra (Self-Test) bằng cách tắt nguồn máy in, nhấn giữ nút FEED rồi bật nguồn lại, thả tay sau 3 giây. Ghi lại địa chỉ IP tĩnh hiển thị trên phiếu (ví dụ: 192.168.1.50).\nLưu ý: Hãy đặt IP tĩnh (Static IP) hoặc gán IP cố định trong Router cho máy in để tránh bị thay đổi IP khi khởi động lại.'),
          const SizedBox(height: 10),
          _stepRow('3', 'Cấu hình trong hệ thống ERP/POS (Tại đây)', 'Bấm nút [+ Thêm danh mục in] ở bên dưới:\n• Chọn kết nối: Network Printer (LAN/IP).\n• Nhập IP máy in bếp/bar vào cột IP máy in (LAN) (VD: 192.168.1.50).\n• Nhập Port (mặc định là 9100).\n• Chọn Định dạng in tương ứng (VD: Phiếu bếp/bar (Kitchen ticket) cho bếp, Tem ly (Cup label) cho tem nhãn...).'),
          const SizedBox(height: 10),
          _stepRow('4', 'Phân quyền in & Kích hoạt', '• Tích chọn ô Đang sử dụng và Tự động in trên dòng máy in vừa thêm.\n• Trong Thực đơn FnB, gán đúng Station cho từng món ăn (chọn Bếp hoặc Bar). Hệ thống sẽ tự động gửi món đến máy in tương ứng khi nhận đơn từ iPad hoặc POS quầy.\n• Bấm nút [Lưu danh mục in] để hoàn tất cấu hình.'),
        ],
      ),
    );
  }

  Widget _stepRow(String num, String title, String desc) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 20,
          height: 20,
          decoration: const BoxDecoration(
            color: DanColors.brandDim,
            shape: BoxShape.circle,
          ),
          alignment: Alignment.center,
          child: Text(
            num,
            style: const TextStyle(
              color: DanColors.brand,
              fontWeight: FontWeight.bold,
              fontSize: 11,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
              const SizedBox(height: 2),
              Text(desc, style: const TextStyle(fontSize: 11.5, color: DanColors.muted, height: 1.4)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _printerEditorRow(int index, Map<String, dynamic> p, PrinterControllers ctrl) {
    final conn = _s(p['connection']);
    final output = _s(p['output']);

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: const BoxDecoration(
              color: DanColors.surface2,
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(11),
                topRight: Radius.circular(11),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Máy in #${index + 1} (${ctrl.id.text.isNotEmpty ? ctrl.id.text : "Chưa đặt tên"})',
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                ),
                Row(
                  children: [
                    if (ctrl.id.text.isNotEmpty)
                      TextButton.icon(
                        onPressed: () => _testPrinter(ctrl.id.text.trim()),
                        icon: const Icon(Icons.print_outlined, size: 16, color: DanColors.brand),
                        label: const Text('In thử', style: TextStyle(color: DanColors.brand, fontSize: 12)),
                      ),
                    const SizedBox(width: 8),
                    TextButton.icon(
                      onPressed: () {
                        setState(() {
                          _printers.removeAt(index);
                          _printerControllersList[index].dispose();
                          _printerControllersList.removeAt(index);
                        });
                      },
                      icon: const Icon(Icons.delete_outline, size: 16, color: DanColors.late),
                      label: const Text('Xóa dòng', style: TextStyle(color: DanColors.late, fontSize: 12)),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                LayoutBuilder(builder: (context, constraints) {
                  final isWide = constraints.maxWidth > 700;

                  Widget buildIdField() => Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Text('Trạm/Tuyến in (ID)', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                          const SizedBox(height: 6),
                          TextField(
                            controller: ctrl.id,
                            decoration: const InputDecoration(isDense: true, hintText: 'VD: kitchen, bar, bill'),
                            onChanged: (val) => setState(() {}),
                          ),
                        ],
                      );

                  Widget buildConnField() => Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Text('Kết nối', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                          const SizedBox(height: 6),
                          DropdownButtonFormField<String>(
                            value: conn.isEmpty ? 'browser' : conn,
                            isExpanded: true,
                            decoration: const InputDecoration(isDense: true),
                            items: const [
                              DropdownMenuItem(value: 'browser', child: Text('Trình duyệt (Browser)')),
                              DropdownMenuItem(value: 'lan', child: Text('Network Printer (LAN/IP)')),
                              DropdownMenuItem(value: 'system', child: Text('Máy in hệ điều hành (OS)')),
                            ],
                            onChanged: (val) {
                              setState(() {
                                p['connection'] = val;
                              });
                            },
                          ),
                        ],
                      );

                  Widget buildOutputField() => Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Text('Định dạng in', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                          const SizedBox(height: 6),
                          DropdownButtonFormField<String>(
                            value: output.isEmpty ? 'custom' : output,
                            isExpanded: true,
                            decoration: const InputDecoration(isDense: true),
                            items: const [
                              DropdownMenuItem(value: 'kitchen_ticket', child: Text('Phiếu bếp (Kitchen ticket)')),
                              DropdownMenuItem(value: 'receipt', child: Text('Hóa đơn / Tạm tính')),
                              DropdownMenuItem(value: 'cup_label', child: Text('Tem ly (Cup label)')),
                              DropdownMenuItem(value: 'product_label', child: Text('Tem sản phẩm (Product label)')),
                              DropdownMenuItem(value: 'runner', child: Text('Phiếu chạy món (Runner)')),
                              DropdownMenuItem(value: 'report', child: Text('Báo cáo (Report)')),
                              DropdownMenuItem(value: 'custom', child: Text('Khác (Custom)')),
                            ],
                            onChanged: (val) {
                              setState(() {
                                p['output'] = val;
                              });
                            },
                          ),
                        ],
                      );

                  if (isWide) {
                    return Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: buildIdField()),
                        const SizedBox(width: 12),
                        Expanded(child: buildConnField()),
                        const SizedBox(width: 12),
                        Expanded(child: buildOutputField()),
                      ],
                    );
                  } else {
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        buildIdField(),
                        const SizedBox(height: 12),
                        buildConnField(),
                        const SizedBox(height: 12),
                        buildOutputField(),
                      ],
                    );
                  }
                }),
                const SizedBox(height: 12),
                if (conn == 'system') ...[
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text('Máy in hệ điều hành (OS)', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 6),
                      TextField(
                        controller: ctrl.systemName,
                        decoration: InputDecoration(
                          isDense: true,
                          hintText: 'Nhập hoặc chọn tên máy in thật (VD: EPSON TM-T82)',
                          suffixIcon: _systemPrinters.isEmpty
                              ? null
                              : PopupMenuButton<String>(
                                  icon: const Icon(Icons.arrow_drop_down),
                                  onSelected: (val) {
                                    setState(() {
                                      ctrl.systemName.text = val;
                                    });
                                  },
                                  itemBuilder: (context) => _systemPrinters
                                      .map((sp) => PopupMenuItem<String>(
                                            value: _s(sp['name']),
                                            child: Text(_s(sp['name'])),
                                          ))
                                      .toList(),
                                ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                ] else if (conn == 'lan') ...[
                  LayoutBuilder(builder: (context, constraints) {
                    final isWide = constraints.maxWidth > 500;

                    Widget buildIpField() => Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text('IP máy in (LAN)', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                            const SizedBox(height: 6),
                            TextField(
                              controller: ctrl.ip,
                              decoration: const InputDecoration(isDense: true, hintText: 'VD: 192.168.1.50'),
                            ),
                          ],
                        );

                    Widget buildPortField() => Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text('Port', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                            const SizedBox(height: 6),
                            TextField(
                              controller: ctrl.port,
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(isDense: true, hintText: '9100'),
                            ),
                          ],
                        );

                    if (isWide) {
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(flex: 2, child: buildIpField()),
                          const SizedBox(width: 12),
                          Expanded(flex: 1, child: buildPortField()),
                        ],
                      );
                    } else {
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          buildIpField(),
                          const SizedBox(height: 12),
                          buildPortField(),
                        ],
                      );
                    }
                  }),
                  const SizedBox(height: 12),
                ],
                LayoutBuilder(builder: (context, constraints) {
                  final isWide = constraints.maxWidth > 500;

                  Widget buildLabelField() => Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Text('Nhãn sau tên', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                          const SizedBox(height: 6),
                          TextField(
                            controller: ctrl.label,
                            decoration: const InputDecoration(isDense: true, hintText: 'VD: Bếp, Bar, Bill'),
                          ),
                        ],
                      );

                  Widget buildLocationField() => Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Text('Vị trí', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                          const SizedBox(height: 6),
                          TextField(
                            controller: ctrl.location,
                            decoration: const InputDecoration(isDense: true, hintText: 'VD: Quầy, Bếp nóng, Bar'),
                          ),
                        ],
                      );

                  if (isWide) {
                    return Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: buildLabelField()),
                        const SizedBox(width: 12),
                        Expanded(child: buildLocationField()),
                      ],
                    );
                  } else {
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        buildLabelField(),
                        const SizedBox(height: 12),
                        buildLocationField(),
                      ],
                    );
                  }
                }),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 16,
                  runSpacing: 10,
                  children: [
                    _switchRow('Đang sử dụng', p['active'] != false, (val) {
                      setState(() {
                        p['active'] = val;
                      });
                    }),
                    _switchRow('Tự động in', p['auto'] == true, (val) {
                      setState(() {
                        p['auto'] = val;
                      });
                    }),
                    _switchRow('Có két', p['cashDrawer'] == true, (val) {
                      setState(() {
                        p['cashDrawer'] = val;
                      });
                    }),
                    _switchRow('Mở két khi in', p['openDrawerOnPrint'] == true, (val) {
                      setState(() {
                        p['openDrawerOnPrint'] = val;
                      });
                    }),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _switchRow(String label, bool value, ValueChanged<bool> onChanged) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          height: 24,
          width: 38,
          child: Transform.scale(
            scale: 0.75,
            child: Switch(
              value: value,
              onChanged: onChanged,
              activeColor: DanColors.brand,
            ),
          ),
        ),
        const SizedBox(width: 4),
        Text(label, style: const TextStyle(fontSize: 12.5)),
      ],
    );
  }

  Future<void> _syncSystemPrinters() async {
    setState(() => _loadingSystemPrinters = true);
    try {
      final res = await widget.api.getSystemPrinters(force: true);
      if (!mounted) return;
      setState(() {
        _systemPrinters = (res['printers'] as List? ?? [])
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _loadingSystemPrinters = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Đã đồng bộ ${_systemPrinters.length} máy in từ hệ điều hành'),
        backgroundColor: DanColors.text,
      ));
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadingSystemPrinters = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
        backgroundColor: DanColors.late,
      ));
    }
  }

  Future<void> _savePrinters() async {
    final pin = await settingsPin(context, 'Xác nhận thay đổi cấu hình danh mục máy in.');
    if (pin == null) return;
    if (!mounted) return;

    final List<Map<String, dynamic>> updatedPrinters = [];
    for (int i = 0; i < _printers.length; i++) {
      final p = _printers[i];
      final ctrl = _printerControllersList[i];
      
      final id = ctrl.id.text.trim();
      if (id.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Vui lòng nhập ID cho dòng máy in thứ ${i + 1}'),
          backgroundColor: DanColors.late,
        ));
        return;
      }

      updatedPrinters.add({
        'id': id,
        'connection': p['connection'] ?? 'browser',
        'systemName': ctrl.systemName.text.trim(),
        'name': ctrl.systemName.text.trim(),
        'ip': ctrl.ip.text.trim(),
        'port': int.tryParse(ctrl.port.text.trim()) ?? 9100,
        'label': ctrl.label.text.trim(),
        'type': ctrl.label.text.trim(),
        'output': p['output'] ?? 'custom',
        'location': ctrl.location.text.trim(),
        'active': p['active'] == true,
        'auto': p['auto'] == true,
        'cashDrawer': p['cashDrawer'] == true,
        'openDrawerOnPrint': p['openDrawerOnPrint'] == true,
      });
    }

    final newPrintConfig = Map<String, dynamic>.from(_printConfig);
    newPrintConfig['printers'] = updatedPrinters;

    setState(() => _savingPrinters = true);
    try {
      await widget.api.saveAppSettings({
        'print_config': newPrintConfig,
        'security_pin': pin,
      });
      if (!mounted) return;
      _printConfig = newPrintConfig;
      _printers = updatedPrinters;
      setState(() => _savingPrinters = false);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Đã lưu danh mục in thành công'),
        backgroundColor: DanColors.text,
      ));
      _load(force: true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _savingPrinters = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
        backgroundColor: DanColors.late,
      ));
    }
  }

  // ── Job in gần đây ──
  Widget _recentJobsPanel() {
    return Panel(
      title: 'Job in gần đây',
      child: _recentJobs.isEmpty
          ? const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('Chưa có job in nào', style: TextStyle(color: DanColors.faint)))
          : Column(children: [
              for (final j in _recentJobs) _jobRow(j),
            ]),
    );
  }

  Widget _jobRow(Map<String, dynamic> j) {
    final type = _outputLabels[_s(j['type'])] ?? _s(j['type']);
    final title = _s(j['title']);
    final printer = _s(j['printer']);
    final printerLabel = _printers.firstWhere(
      (p) => _s(p['id']) == printer,
      orElse: () => <String, dynamic>{},
    );
    final printerName = _s(printerLabel['label']).isNotEmpty
        ? _s(printerLabel['label'])
        : printer;
    final status = _s(j['status']);
    final createdAt = _fmtTime(_s(j['created_at']));

    final (statusLabel, statusColor) = switch (status) {
      'queued' => ('Chờ in', DanColors.doing),
      'printing' => ('Đang in', const Color(0xFFB7791F)),
      'printed' => ('Đã in', DanColors.done),
      'failed' => ('Lỗi', DanColors.late),
      _ => (status, DanColors.muted),
    };

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${type.isNotEmpty ? type : 'In'}${title.isNotEmpty ? ' · $title' : ''}',
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
              overflow: TextOverflow.ellipsis),
          Text([if (printerName.isNotEmpty) printerName, if (createdAt.isNotEmpty) createdAt].join(' · '),
              style: const TextStyle(fontSize: 11, color: DanColors.muted)),
        ])),
        const SizedBox(width: 8),
        _pill(statusLabel, statusColor),
      ]),
    );
  }

  Widget _infoRow(String label, Widget value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(children: [
      Expanded(child: Text(label,
          style: const TextStyle(fontSize: 12.5, color: DanColors.muted, fontWeight: FontWeight.w600))),
      value,
    ]),
  );

  Widget _ctLabel(String t) => Padding(
    padding: const EdgeInsets.only(bottom: 5),
    child: Text(t,
        style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w900,
            letterSpacing: .4, color: DanColors.faint)),
  );

  Widget _pill(String text, Color color) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    decoration: BoxDecoration(
      color: color.withValues(alpha: .14),
      borderRadius: BorderRadius.circular(99),
    ),
    child: Text(text,
        style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w800)),
  );
}

class PrinterControllers {
  final id = TextEditingController();
  final systemName = TextEditingController();
  final ip = TextEditingController();
  final port = TextEditingController();
  final label = TextEditingController();
  final location = TextEditingController();

  PrinterControllers({
    required String idVal,
    required String systemNameVal,
    required String ipVal,
    required String portVal,
    required String labelVal,
    required String locationVal,
  }) {
    id.text = idVal;
    systemName.text = systemNameVal;
    ip.text = ipVal;
    port.text = portVal;
    label.text = labelVal;
    location.text = locationVal;
  }

  void dispose() {
    id.dispose();
    systemName.dispose();
    ip.dispose();
    port.dispose();
    label.dispose();
    location.dispose();
  }
}
