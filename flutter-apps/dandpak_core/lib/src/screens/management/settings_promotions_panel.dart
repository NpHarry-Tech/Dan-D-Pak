import 'package:flutter/material.dart';

import '../../models/retail_models.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../widgets/manager_pin_dialog.dart';
import 'management_widgets.dart';
import 'settings_tab.dart';
import '../../utils/translation.dart';
import 'settings_value_utils.dart';

int _i(dynamic v, [int fallback = 0]) =>
    v is num ? v.round() : int.tryParse(asText(v).trim()) ?? fallback;
Map<String, dynamic> _m(dynamic v) =>
    v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

String _joinList(dynamic v) => v is List
    ? v.map((e) => asText(e).trim()).where((e) => e.isNotEmpty).join(', ')
    : '';

List<String> _csv(String value) =>
    value.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toList();

Map<String, String> get _scopeLabels => {
      'order': t('Hóa đơn / toàn bill'),
      'sku': t('Hàng hóa / SKU cụ thể'),
      'all_sku': t('Hàng hóa / mọi SKU'),
      'combo': t('Combo (mua N món bất kỳ trong tập)'),
    };

Map<String, String> get _typeLabels => {
      'pct': t('Giảm theo %'),
      'amount': t('Giảm số tiền'),
      'buy_x_get_1': t('Mua X tặng 1'),
      'fixed': t('Giá combo cố định (N món = X đ)'),
    };

class PromotionSettingsPanel extends StatefulWidget {
  final ApiService api;
  PromotionSettingsPanel({super.key, required this.api});

  @override
  State<PromotionSettingsPanel> createState() => _PromotionSettingsPanelState();
}

class _PromotionSettingsPanelState extends State<PromotionSettingsPanel> {
  final _name = TextEditingController();
  final _code = TextEditingController();
  final _value = TextEditingController(text: '10');
  final _minTotal = TextEditingController(text: '0');
  final _startsAt = TextEditingController();
  final _endsAt = TextEditingController();
  final _timeStart = TextEditingController();
  final _timeEnd = TextEditingController();
  final _note = TextEditingController();
  final _branches = TextEditingController();
  final _customerGroups = TextEditingController();
  final _staffIds = TextEditingController();
  // Combo: danh sách sku_id (multi-picker), nhóm hàng (category, cách nhau phẩy),
  // và số lượng cần mua N.
  final _comboSkus = TextEditingController();
  final _comboGroups = TextEditingController();
  final _comboQty = TextEditingController(text: '2');
  // §9 COMPLIANCE ADVISORY (owner: KHÔNG enforce cap). Metadata truy vết do người
  // có quyền nhập tay — KHÔNG ảnh hưởng giá/checkout/tồn/thanh toán.
  final _complianceNote = TextEditingController();
  final _approvalRef = TextEditingController();
  bool _isInternalUse = false;
  String _programType = 'PRODUCTION_USE';

  // Cấu hình advisory từ SERVER (operationsConfig.promotions) — KHÔNG hardcode:
  //  advisoryThresholdPct: ngưỡng CẢNH BÁO % (null = không cảnh báo);
  //  legalNoteText/legalNoteUrl: "Lưu ý pháp lý" + link tài liệu quy định.
  num? _advisoryThresholdPct;
  String _legalNoteText = '';
  String _legalNoteUrl = '';

  List<Map<String, dynamic>> _rawRows = [];
  List<Map<String, dynamic>> _branchRows = [];
  List<Map<String, dynamic>> _userRows = [];
  List<RetailVoucher> _rows = [];
  List<Sku> _skus = [];
  List<StockLot> _lots = [];
  RetailVoucher? _editing;
  bool _loading = true;
  bool _saving = false;
  String? _error;

  String _scope = 'order';
  String _type = 'pct';
  String _skuId = '';
  String _lotNo = '';
  bool _active = true;
  String _birthdayMode = 'off';
  String _usageLimit = 'unlimited';
  Set<int> _months = {};
  Set<int> _monthDays = {};
  Set<int> _weekdays = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in [
      _name,
      _code,
      _value,
      _minTotal,
      _startsAt,
      _endsAt,
      _timeStart,
      _timeEnd,
      _note,
      _branches,
      _customerGroups,
      _staffIds,
      _comboSkus,
      _comboGroups,
      _comboQty,
      _complianceNote,
      _approvalRef,
    ]) {
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
      final results = await Future.wait<dynamic>([
        widget.api.getVouchers(),
        widget.api.getSkus(),
        widget.api.getRetailLots().catchError((_) => <dynamic>[]),
        widget.api.getBranches().catchError((_) => <dynamic>[]),
        widget.api.getUsers().catchError((_) => <dynamic>[]),
        widget.api.getOperationsConfig().catchError((_) => <String, dynamic>{}),
      ]);
      final ops = (results[5] is Map)
          ? Map<String, dynamic>.from(results[5] as Map)
          : <String, dynamic>{};
      final promoCfg = ops['promotions'] is Map
          ? Map<String, dynamic>.from(ops['promotions'] as Map)
          : <String, dynamic>{};
      final raw = (results[0] as List)
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      if (!mounted) return;
      setState(() {
        _rawRows = raw;
        _rows = raw.map((e) => RetailVoucher.fromJson(e)).toList();
        _skus = (results[1] as List)
            .whereType<Map>()
            .map((e) => Sku.fromJson(Map<String, dynamic>.from(e)))
            .toList();
        _lots = (results[2] as List)
            .whereType<Map>()
            .map((e) => StockLot.fromJson(Map<String, dynamic>.from(e)))
            .toList();
        _branchRows = (results[3] as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _userRows = (results[4] as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        final thr = promoCfg['advisoryThresholdPct'] ??
            promoCfg['advisory_threshold_pct'];
        _advisoryThresholdPct =
            (thr is num) ? thr : num.tryParse('${thr ?? ''}');
        _legalNoteText =
            '${promoCfg['legalNoteText'] ?? promoCfg['legal_note_text'] ?? ''}';
        _legalNoteUrl =
            '${promoCfg['legalNoteUrl'] ?? promoCfg['legal_note_url'] ?? ''}';
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

  void _reset() {
    setState(() {
      _editing = null;
      _name.clear();
      _code.clear();
      _value.text = '10';
      _minTotal.text = '0';
      _startsAt.clear();
      _endsAt.clear();
      _timeStart.clear();
      _timeEnd.clear();
      _note.clear();
      _branches.clear();
      _customerGroups.clear();
      _staffIds.clear();
      _comboSkus.clear();
      _comboGroups.clear();
      _comboQty.text = '2';
      _complianceNote.clear();
      _approvalRef.clear();
      _isInternalUse = false;
      _programType = 'PRODUCTION_USE';
      _scope = 'order';
      _type = 'pct';
      _skuId = '';
      _lotNo = '';
      _active = true;
      _birthdayMode = 'off';
      _usageLimit = 'unlimited';
      _months = {};
      _monthDays = {};
      _weekdays = {};
    });
  }

  void _loadIntoForm(RetailVoucher v) {
    final raw =
        _rawRows.firstWhere((e) => asText(e['id']) == v.id, orElse: () => {});
    final schedule = _m(raw['schedule']);
    final scopeConfig = _m(raw['scope_config']);
    setState(() {
      _editing = v;
      _name.text = v.name;
      _code.text = v.code;
      _value.text = v.value.round().toString();
      _minTotal.text = v.minTotal.round().toString();
      _startsAt.text = v.startsAt;
      _endsAt.text = v.endsAt;
      _timeStart.text = v.timeStart;
      _timeEnd.text = v.timeEnd;
      _note.text = v.note;
      _scope = _scopeLabels.containsKey(v.scope) ? v.scope : 'order';
      _type = _typeLabels.containsKey(v.type) ? v.type : 'pct';
      if (_scope == 'order' && _type == 'buy_x_get_1') _type = 'pct';
      _skuId = v.skuId;
      _lotNo = v.lotNo;
      _active = v.active;
      _birthdayMode = v.birthdayMode;
      _usageLimit = v.usageLimit;
      _months = retailIntList(schedule['months']).toSet();
      _monthDays =
          retailIntList(schedule['monthDays'] ?? schedule['month_days'])
              .toSet();
      _weekdays = retailIntList(schedule['weekdays']).toSet();
      _branches.text = _joinList(scopeConfig['branches']);
      _customerGroups.text = _joinList(
          scopeConfig['customerGroups'] ?? scopeConfig['customer_groups']);
      _staffIds.text =
          _joinList(scopeConfig['staffIds'] ?? scopeConfig['staff_ids']);
      _comboSkus.text = _joinList(scopeConfig['skus']);
      _comboGroups.text = _joinList(scopeConfig['groups']);
      final q = scopeConfig['qty'];
      _comboQty.text = (q == null || '$q'.isEmpty) ? '2' : '$q';
      _isInternalUse =
          raw['is_internal_use'] == true || raw['is_internal_use'] == 1;
      _programType = '${raw['program_type'] ?? 'PRODUCTION_USE'}';
      _complianceNote.text = '${raw['compliance_note'] ?? ''}';
      _approvalRef.text = '${raw['approval_reference'] ?? ''}';
    });
  }

  Map<String, dynamic> _body(String pin) => {
        'name': _name.text.trim(),
        'code': _code.text.trim(),
        'scope': _scope,
        'sku_id': _scope == 'sku' ? _skuId : null,
        'lot_no': _scope == 'sku' ? _lotNo : null,
        'type': _type,
        'value': _i(_value.text),
        'min_total': _i(_minTotal.text),
        'active': _active,
        'starts_at': _startsAt.text.trim(),
        'ends_at': _endsAt.text.trim(),
        'note': _note.text.trim(),
        'schedule': {
          'months': (_months.toList()..sort()),
          'monthDays': (_monthDays.toList()..sort()),
          'weekdays': (_weekdays.toList()..sort()),
          'timeStart': _timeStart.text.trim(),
          'timeEnd': _timeEnd.text.trim(),
          'birthdayMode': _birthdayMode,
          'usageLimit': _usageLimit,
        },
        'scope_config': {
          'branches': _csv(_branches.text),
          'customerGroups': _csv(_customerGroups.text),
          'staffIds': _csv(_staffIds.text),
          if (_scope == 'combo') 'skus': _csv(_comboSkus.text),
          if (_scope == 'combo') 'groups': _csv(_comboGroups.text),
          if (_scope == 'combo') 'qty': _i(_comboQty.text),
        },
        // §9 compliance metadata (audit-only; server KHÔNG dùng để đổi giá/chặn).
        'is_internal_use': _isInternalUse,
        if (_isInternalUse) 'program_type': _programType,
        if (_complianceNote.text.trim().isNotEmpty)
          'compliance_note': _complianceNote.text.trim(),
        if (_approvalRef.text.trim().isNotEmpty)
          'approval_reference': _approvalRef.text.trim(),
        'security_pin': pin,
      };

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      _toast(t('Nhập tên chương trình khuyến mại'), error: true);
      return;
    }
    if (_scope == 'sku' && _skuId.isEmpty) {
      _toast(t('Chọn SKU áp dụng'), error: true);
      return;
    }
    if (_scope == 'combo' &&
        _csv(_comboSkus.text).isEmpty &&
        _csv(_comboGroups.text).isEmpty) {
      _toast(t('Combo cần chọn ít nhất 1 SKU hoặc 1 nhóm hàng'), error: true);
      return;
    }
    final pin = await requestManagerPin(
      context,
      _editing == null
          ? t('Tạo chương trình khuyến mại.')
          : t('Lưu chỉnh sửa chương trình khuyến mại.'),
      label: t('PIN tài khoản đang đăng nhập / Admin'),
      // Khuyến mại ảnh hưởng trực tiếp tới doanh thu nên người thao tác PHẢI tự
      // nhập PIN của chính mình, kể cả khi đang đăng nhập bằng tài khoản Quản lý
      // — đây là dấu vết trách nhiệm, không phải bước kiểm tra quyền.
      selfPinOnly: true,
    );
    if (pin == null) return;
    setState(() => _saving = true);
    try {
      if (_editing == null) {
        await widget.api.createVoucher(_body(pin));
      } else {
        await widget.api.updateVoucher(_editing!.id, _body(pin));
      }
      _toast(t('Đã lưu chương trình khuyến mại'));
      _reset();
      await _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _toggle(RetailVoucher v) async {
    final pin = await requestManagerPin(
      context,
      v.active
          ? t('Tắt chương trình "${v.name}".')
          : t('Bật chương trình "${v.name}".'),
      label: t('PIN tài khoản đang đăng nhập / Admin'),
      // Khuyến mại ảnh hưởng trực tiếp tới doanh thu nên người thao tác PHẢI tự
      // nhập PIN của chính mình, kể cả khi đang đăng nhập bằng tài khoản Quản lý
      // — đây là dấu vết trách nhiệm, không phải bước kiểm tra quyền.
      selfPinOnly: true,
    );
    if (pin == null) return;
    try {
      await widget.api.toggleVoucher(v.id, !v.active, pin: pin);
      await _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  // XÓA HẲN CTKM — admin cần xóa được, không chỉ bật/tắt. PIN vừa là xác nhận vừa
  // là dấu vết trách nhiệm (giống _toggle). Đơn cũ đã chụp mã/tên nên không hỏng.
  Future<void> _delete(RetailVoucher v) async {
    final pin = await requestManagerPin(
      context,
      t('XÓA HẲN chương trình "${v.name}"? Không thể hoàn tác.'),
      label: t('PIN tài khoản đang đăng nhập / Admin'),
      selfPinOnly: true,
    );
    if (pin == null) return;
    try {
      await widget.api.deleteVoucher(v.id, pin: pin);
      if (_editing?.id == v.id) _reset();
      await _load();
      if (mounted) _toast(t('Đã xóa "${v.name}"'));
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  void _toast(String msg, {bool error = false}) =>
      appToast(context, msg, isError: error);

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: t('Khuyến mại / Voucher'),
      addLabel: t('Tạo CTKM'),
      onAdd: _reset,
      onRefresh: _load,
      child: settingsState(
        loading: _loading,
        error: _error,
        onRetry: _load,
        child: LayoutBuilder(builder: (context, c) {
          final wide = c.maxWidth >= 1040;
          if (wide) {
            return Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  width: dialogWidth(context, 690),
                  child: SingleChildScrollView(
                    padding: EdgeInsets.all(16),
                    child: _formPanel(),
                  ),
                ),
                VerticalDivider(width: 1, color: DanColors.border),
                Expanded(
                  child: SingleChildScrollView(
                    padding: EdgeInsets.all(16),
                    child: _listPanel(),
                  ),
                ),
              ],
            );
          }
          return ListView(
            padding: EdgeInsets.all(16),
            children: [
              _formPanel(),
              SizedBox(height: 14),
              _listPanel(),
            ],
          );
        }),
      ),
    );
  }

  Widget _formPanel() {
    final typeOptions = _scope == 'combo'
        ? const ['fixed', 'amount', 'pct']
        : [
            'pct',
            'amount',
            if (_scope != 'order') 'buy_x_get_1',
          ];
    return Panel(
      title: _editing == null
          ? t('Tạo chương trình')
          : t('Chỉnh sửa chương trình'),
      trailing: _editing == null
          ? null
          : TextButton.icon(
              onPressed: _reset,
              icon: Icon(Icons.add, size: 16),
              label: Text(t('Tạo mới')),
            ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SectionTitle(t('Thông tin')),
          _grid([
            _field(_name, t('Tên chương trình'),
                hint: t('VD: Giảm 10% đơn từ 500k')),
            _field(_code, t('Mã voucher'), hint: t('Tự động nếu bỏ trống')),
            _dropdown(
              label: t('Khuyến mại theo'),
              value: _scope,
              items: _scopeLabels,
              onChanged: (v) => setState(() {
                _scope = v ?? 'order';
                if (_scope != 'sku') {
                  _skuId = '';
                  _lotNo = '';
                }
                if (_scope == 'order' && _type == 'buy_x_get_1') _type = 'pct';
                // Đồng bộ kiểu ưu đãi hợp lệ theo scope.
                if (_scope == 'combo' &&
                    !const ['fixed', 'amount', 'pct'].contains(_type)) {
                  _type = 'fixed';
                }
                if (_scope != 'combo' && _type == 'fixed') _type = 'pct';
              }),
            ),
            _dropdown(
              label: t('Hình thức khuyến mại'),
              value: _type,
              items: {for (final key in typeOptions) key: _typeLabels[key]!},
              onChanged: (v) => setState(() => _type = v ?? 'pct'),
            ),
            _field(_value, _valueLabel(),
                keyboardType: TextInputType.number,
                // Rebuild để banner advisory cập nhật LIVE theo % vừa nhập.
                onChanged: (_) => setState(() {})),
            _field(_minTotal, t('Bill tối thiểu'),
                keyboardType: TextInputType.number),
          ]),
          if (_scope == 'sku') ...[
            SizedBox(height: 12),
            _grid([
              _skuDropdown(),
              _lotDropdown(),
            ]),
          ],
          if (_scope == 'combo') ...[
            SizedBox(height: 12),
            _grid([
              _scopePicker(
                _comboSkus,
                t('SKU trong combo'),
                [
                  for (final s in _skus)
                    {'id': s.id, 'name': s.name, 'barcode': s.barcode}
                ],
                idKey: 'id',
                labelKeys: ['name', 'barcode'],
                emptyLabel: t('Chọn 1 hoặc nhiều SKU'),
              ),
              _scopePicker(
                _comboGroups,
                t('Nhóm hàng trong combo'),
                [
                  for (final c in {
                    for (final s in _skus)
                      if (s.category.trim().isNotEmpty) s.category.trim()
                  })
                    {'cat': c}
                ],
                idKey: 'cat',
                labelKeys: ['cat'],
                emptyLabel: t('Chọn nhóm hàng (tùy chọn)'),
              ),
              _field(_comboQty, t('Số lượng cần mua (N)'),
                  keyboardType: TextInputType.number),
            ]),
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                  t(
                      'Khách mua đủ N món BẤT KỲ trong tập (SKU + nhóm hàng) → áp ưu đãi. Mua 2N món = 2 combo.'),
                  style: const TextStyle(
                      fontSize: 11.5, color: DanColors.muted, height: 1.4)),
            ),
          ],
          SizedBox(height: 18),
          _SectionTitle(t('Hiệu lực & lịch chạy')),
          _grid([
            _field(_startsAt, t('Từ ngày'), hint: 'YYYY-MM-DD HH:mm'),
            _field(_endsAt, t('Đến ngày'), hint: 'YYYY-MM-DD HH:mm'),
            _field(_timeStart, t('Giờ bắt đầu'), hint: '18:00'),
            _field(_timeEnd, t('Giờ kết thúc'), hint: '22:00'),
            _dropdown(
              label: t('Sinh nhật khách'),
              value: _birthdayMode,
              items: {
                'off': t('Không ràng buộc'),
                'day': t('Đúng ngày sinh nhật'),
                'month': t('Trong tháng sinh nhật'),
              },
              onChanged: (v) => setState(() => _birthdayMode = v ?? 'off'),
            ),
            _dropdown(
              label: t('Số lần/khách'),
              value: _usageLimit,
              items: {
                'unlimited': t('Không giới hạn'),
                'once': t('Chỉ 1 lần'),
              },
              onChanged: (v) => setState(() => _usageLimit = v ?? 'unlimited'),
            ),
          ]),
          SizedBox(height: 12),
          _setPicker(t('Tháng áp dụng'), List.generate(12, (i) => i + 1),
              _months, (v) => 'T$v', (v) => setState(() => _months = v)),
          _setPicker(t('Ngày trong tháng'), List.generate(31, (i) => i + 1),
              _monthDays, (v) => '$v', (v) => setState(() => _monthDays = v)),
          _setPicker(
              t('Thứ trong tuần'),
              List.generate(7, (i) => i + 1),
              _weekdays,
              (v) => {
                    1: 'T2',
                    2: 'T3',
                    3: 'T4',
                    4: 'T5',
                    5: 'T6',
                    6: 'T7',
                    7: 'CN'
                  }[v]!,
              (v) => setState(() => _weekdays = v)),
          SizedBox(height: 18),
          _SectionTitle(t('Phạm vi áp dụng')),
          _grid([
            _scopePicker(
              _branches,
              t('Chi nhánh'),
              _branchRows,
              idKey: 'id',
              labelKeys: ['name', 'id'],
              emptyLabel: t('Toàn hệ thống'),
            ),
            _field(_customerGroups, t('Nhóm khách hàng'),
                hint: t('Để trống = tất cả')),
            _scopePicker(
              _staffIds,
              t('Người tạo giao dịch'),
              _userRows,
              idKey: 'id',
              labelKeys: ['name', 'username', 'id'],
              emptyLabel: t('Tất cả nhân viên'),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(t('Đang kích hoạt')),
              value: _active,
              onChanged: (v) => setState(() => _active = v),
            ),
          ]),
          SizedBox(height: 12),
          TextField(
            controller: _note,
            minLines: 2,
            maxLines: 4,
            decoration: InputDecoration(
              labelText: t('Ghi chú'),
              hintText: t('Ghi chú nội bộ / mô tả cách chạy CTKM'),
            ),
          ),
          SizedBox(height: 16),
          _complianceSection(),
          SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              OutlinedButton(onPressed: _reset, child: Text(t('Bỏ qua'))),
              SizedBox(width: 10),
              FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: _saving
                    ? SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(Icons.save_outlined, size: 18),
                label:
                    Text(_editing == null ? t('Lưu CTKM') : t('Lưu chỉnh sửa')),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // §9 CẢNH BÁO advisory (KHÔNG chặn lưu): CTKM % vượt ngưỡng CẤU HÌNH từ server
  // (không hardcode). Chỉ nhắc kiểm tra quy định — không sửa value, không cản.
  bool get _advisoryTriggered =>
      _type == 'pct' &&
      _advisoryThresholdPct != null &&
      _i(_value.text) > _advisoryThresholdPct!;

  Widget _advisoryBanner() {
    if (!_advisoryTriggered) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.amber.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.amber.shade700.withValues(alpha: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 18, color: Colors.amber.shade800),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              t('Chương trình này có mức ưu đãi cao (${_i(_value.text)}% > ngưỡng ${_advisoryThresholdPct!.round()}%). Vui lòng kiểm tra quy định khuyến mại hiện hành và hồ sơ chương trình trước khi áp dụng. Đây chỉ là nhắc nhở — không chặn lưu.'),
              style: const TextStyle(fontSize: 12.5, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }

  // "Lưu ý pháp lý" + metadata truy vết (audit-only). Nội dung/link lấy từ CẤU
  // HÌNH server (operationsConfig.promotions) — KHÔNG hardcode luật vào app.
  Widget _complianceSection() {
    final hasLegalNote = _legalNoteText.isNotEmpty || _legalNoteUrl.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _advisoryBanner(),
        _SectionTitle(t('Lưu ý pháp lý & tuân thủ')),
        if (hasLegalNote)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: DanColors.surface2,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: DanColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_legalNoteText.isNotEmpty)
                  Text(_legalNoteText,
                      style: const TextStyle(fontSize: 12.5, height: 1.4)),
                if (_legalNoteUrl.isNotEmpty) ...[
                  if (_legalNoteText.isNotEmpty) const SizedBox(height: 6),
                  Row(
                    children: [
                      Icon(Icons.link, size: 15, color: DanColors.brand),
                      const SizedBox(width: 6),
                      Expanded(
                        child: SelectableText(_legalNoteUrl,
                            style: TextStyle(
                                fontSize: 12.5,
                                color: DanColors.brand,
                                decoration: TextDecoration.underline)),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          )
        else
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              t('Chưa cấu hình tài liệu quy định. Người quản trị có thể thêm link hướng dẫn ở Cấu hình vận hành (promotions.legalNoteUrl).'),
              style: TextStyle(fontSize: 12, color: DanColors.faint),
            ),
          ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(t('Chương trình dùng NỘI BỘ (không bán cho khách)')),
          subtitle: Text(
              t('QA / dùng bếp / dùng sản xuất — tách khỏi CTKM tiêu dùng trong báo cáo & đối soát.'),
              style: TextStyle(fontSize: 11.5, color: DanColors.faint)),
          value: _isInternalUse,
          onChanged: (v) => setState(() => _isInternalUse = v),
        ),
        if (_isInternalUse) ...[
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            initialValue: _programType,
            decoration: InputDecoration(labelText: t('Loại sử dụng nội bộ')),
            items: const [
              DropdownMenuItem(
                  value: 'QA_TESTING', child: Text('QA / kiểm thử')),
              DropdownMenuItem(value: 'KITCHEN_USE', child: Text('Dùng bếp')),
              DropdownMenuItem(
                  value: 'PRODUCTION_USE', child: Text('Dùng sản xuất')),
            ],
            onChanged: (v) =>
                setState(() => _programType = v ?? 'PRODUCTION_USE'),
          ),
        ],
        const SizedBox(height: 8),
        _field(_complianceNote, t('Ghi chú tuân thủ (compliance note)'),
            hint: t('VD: CT đã khai báo Sở Công Thương / căn cứ nội bộ')),
        const SizedBox(height: 8),
        _field(_approvalRef, t('Mã phê duyệt (approval reference)'),
            hint: t('VD: QĐ-123 / số công văn')),
      ],
    );
  }

  Widget _listPanel() {
    return Panel(
      title: t('Danh sách chương trình'),
      trailing: Text('${_rows.length} CTKM',
          style: TextStyle(color: DanColors.muted)),
      child: _rows.isEmpty
          ? Padding(
              padding: EdgeInsets.symmetric(vertical: 30),
              child: Center(
                child: Text(t('Chưa có chương trình khuyến mại'),
                    style: TextStyle(color: DanColors.faint)),
              ),
            )
          : Column(
              children: [
                for (final v in _rows) ...[
                  _voucherCard(v),
                  if (v != _rows.last) SizedBox(height: 10),
                ],
              ],
            ),
    );
  }

  Widget _voucherCard(RetailVoucher v) {
    final target = v.scope == 'sku'
        ? (v.skuName.isNotEmpty ? v.skuName : v.skuId)
        : (_scopeLabels[v.scope] ?? v.scope);
    return Container(
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: v.active ? DanColors.surface2 : DanColors.bg,
        border: Border.all(
            color: _editing?.id == v.id ? DanColors.brand : DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(v.scope == 'order' ? Icons.receipt_long : Icons.local_offer,
              color: v.active ? DanColors.brand : DanColors.faint),
          SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(v.displayName,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style:
                        TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5)),
                SizedBox(height: 5),
                Text(
                  '${_typeLabels[v.type] ?? v.type}: ${v.valueLabel}'
                  '${v.minTotal > 0 ? ' · ${t('từ')} ${Fmt.money(v.minTotal)}' : ''}',
                  style: TextStyle(
                      color: DanColors.muted,
                      fontWeight: FontWeight.w700,
                      fontSize: 12),
                ),
                SizedBox(height: 3),
                Text(target,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: DanColors.faint, fontSize: 11)),
                if (v.scheduleLabel.isNotEmpty) ...[
                  SizedBox(height: 3),
                  Text(v.scheduleLabel,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: DanColors.faint, fontSize: 11)),
                ],
                if (v.scopeLabel.isNotEmpty) ...[
                  SizedBox(height: 3),
                  Text(v.scopeLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: DanColors.faint, fontSize: 11)),
                ],
              ],
            ),
          ),
          SizedBox(width: 8),
          Column(
            children: [
              Switch(
                value: v.active,
                onChanged: (_) => _toggle(v),
                activeThumbColor: DanColors.brand,
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    onPressed: () => _loadIntoForm(v),
                    icon: Icon(Icons.edit_outlined),
                    tooltip: t('Sửa'),
                    visualDensity: VisualDensity.compact,
                  ),
                  IconButton(
                    onPressed: () => _delete(v),
                    icon: Icon(Icons.delete_outline, color: DanColors.late),
                    tooltip: t('Xóa'),
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _skuDropdown() {
    final value = _skus.any((s) => s.id == _skuId) ? _skuId : null;
    return DropdownButtonFormField<String>(
      key: ValueKey('sku:$_scope:$_skuId:${_skus.length}'),
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: t('SKU áp dụng')),
      items: [
        for (final s in _skus)
          DropdownMenuItem(
            value: s.id,
            child: Text(s.name, maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: (v) => setState(() {
        _skuId = v ?? '';
        _lotNo = '';
      }),
    );
  }

  Widget _lotDropdown() {
    final lots = _lots
        .where((l) => l.itemType == 'sku' && l.itemId == _skuId)
        .map((l) => l.lotNo)
        .where((e) => e.isNotEmpty)
        .toSet()
        .toList()
      ..sort();
    final value = _lotNo.isEmpty ? '' : (lots.contains(_lotNo) ? _lotNo : null);
    return DropdownButtonFormField<String>(
      key: ValueKey('lot:$_skuId:$_lotNo:${lots.length}'),
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: t('Lot/Date áp dụng')),
      items: [
        DropdownMenuItem(value: '', child: Text(t('Tất cả lot của SKU'))),
        for (final lot in lots) DropdownMenuItem(value: lot, child: Text(lot)),
      ],
      onChanged: (v) => setState(() => _lotNo = v ?? ''),
    );
  }

  String _valueLabel() {
    if (_scope == 'combo') {
      if (_type == 'fixed') return t('Giá combo (đ)');
      if (_type == 'amount') return t('Giảm (đ)');
      return t('Giảm (%)');
    }
    if (_type == 'buy_x_get_1') return 'Mua X';
    if (_type == 'pct') return t('Giảm (%)');
    return t('Giá trị');
  }

  Widget _scopePicker(
    TextEditingController controller,
    String label,
    List<Map<String, dynamic>> rows, {
    required String idKey,
    required List<String> labelKeys,
    required String emptyLabel,
  }) {
    if (rows.isEmpty) {
      return _field(controller, label, hint: emptyLabel);
    }
    final ids = _csv(controller.text).toSet();
    final rowById = {
      for (final r in rows) asText(r[idKey]): r,
    };
    final summary = ids.isEmpty
        ? emptyLabel
        : ids
            .map((id) => _scopeLabel(rowById[id], labelKeys, fallback: id))
            .join(', ');
    return OutlinedButton.icon(
      onPressed: () async {
        final picked = await _pickScopeIds(
          title: label,
          rows: rows,
          selected: ids,
          idKey: idKey,
          labelKeys: labelKeys,
        );
        if (picked == null) return;
        setState(() => controller.text = (picked.toList()..sort()).join(', '));
      },
      icon: Icon(Icons.arrow_drop_down_circle_outlined, size: 17),
      label: Align(
        alignment: Alignment.centerLeft,
        child: Text(summary, maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
    );
  }

  String _scopeLabel(Map<String, dynamic>? row, List<String> keys,
      {required String fallback}) {
    if (row == null) return fallback;
    for (final key in keys) {
      final v = asText(row[key]).trim();
      if (v.isNotEmpty) return v;
    }
    return fallback;
  }

  Future<Set<String>?> _pickScopeIds({
    required String title,
    required List<Map<String, dynamic>> rows,
    required Set<String> selected,
    required String idKey,
    required List<String> labelKeys,
  }) {
    var draft = Set<String>.of(selected);
    return showDialog<Set<String>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          backgroundColor: DanColors.surface,
          title: Text(title),
          content: SizedBox(
            width: dialogWidth(context, 440),
            child: ListView(
              shrinkWrap: true,
              children: [
                for (final row in rows)
                  CheckboxListTile(
                    dense: true,
                    value: draft.contains(asText(row[idKey])),
                    title: Text(_scopeLabel(row, labelKeys,
                        fallback: asText(row[idKey]))),
                    onChanged: (on) => setLocal(() {
                      final id = asText(row[idKey]);
                      on == true ? draft.add(id) : draft.remove(id);
                    }),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => setLocal(() => draft = <String>{}),
                child: Text(t('Tất cả'))),
            TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: Text(t('Hủy'))),
            FilledButton(
                onPressed: () => Navigator.of(ctx).pop(draft),
                child: Text(t('Áp dụng'))),
          ],
        ),
      ),
    );
  }

  Widget _field(TextEditingController controller, String label,
      {String? hint,
      TextInputType? keyboardType,
      ValueChanged<String>? onChanged}) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      onChanged: onChanged,
      decoration: InputDecoration(labelText: label, hintText: hint),
    );
  }

  Widget _dropdown({
    required String label,
    required String value,
    required Map<String, String> items,
    required ValueChanged<String?> onChanged,
  }) {
    return DropdownButtonFormField<String>(
      key: ValueKey('$label:$value:${items.keys.join('|')}'),
      initialValue: items.containsKey(value) ? value : items.keys.first,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [
        for (final e in items.entries)
          DropdownMenuItem(value: e.key, child: Text(e.value)),
      ],
      onChanged: onChanged,
    );
  }

  Widget _grid(List<Widget> children) {
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: [
        for (final child in children) SizedBox(width: 310, child: child),
      ],
    );
  }

  Widget _setPicker(
    String title,
    List<int> values,
    Set<int> selected,
    String Function(int) label,
    ValueChanged<Set<int>> onChanged,
  ) {
    final summary = selected.isEmpty
        ? t('Tất cả')
        : (selected.toList()..sort()).map(label).join(', ');
    return Padding(
      padding: EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: TextStyle(
                  color: DanColors.muted,
                  fontSize: 12,
                  fontWeight: FontWeight.w900)),
          SizedBox(height: 7),
          OutlinedButton.icon(
            onPressed: () async {
              final picked = await _pickSet(title, values, selected, label);
              if (picked != null) onChanged(picked);
            },
            icon: Icon(Icons.tune_outlined, size: 17),
            label: Align(
              alignment: Alignment.centerLeft,
              child:
                  Text(summary, maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
          ),
        ],
      ),
    );
  }

  Future<Set<int>?> _pickSet(String title, List<int> values, Set<int> selected,
      String Function(int) label) {
    var draft = Set<int>.of(selected);
    return showDialog<Set<int>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          backgroundColor: DanColors.surface,
          title: Text(title),
          content: SizedBox(
            width: dialogWidth(context, 420),
            child: Wrap(
              spacing: 7,
              runSpacing: 7,
              children: [
                for (final v in values)
                  FilterChip(
                    label: Text(label(v)),
                    selected: draft.contains(v),
                    onSelected: (on) => setLocal(() {
                      on ? draft.add(v) : draft.remove(v);
                    }),
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => setLocal(() => draft = <int>{}),
                child: Text(t('Tất cả'))),
            TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: Text(t('Hủy'))),
            FilledButton(
                onPressed: () => Navigator.of(ctx).pop(draft),
                child: Text(t('Áp dụng'))),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;
  _SectionTitle(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: 10),
      child: Text(text.toUpperCase(),
          style: TextStyle(
              color: DanColors.muted,
              fontSize: 11.5,
              fontWeight: FontWeight.w900)),
    );
  }
}
