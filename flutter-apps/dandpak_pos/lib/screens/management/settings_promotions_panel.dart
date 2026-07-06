import 'package:flutter/material.dart';

import '../../models/retail_models.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../widgets/manager_pin_dialog.dart';
import 'management_widgets.dart';
import 'settings_tab.dart';

String _s(dynamic v) => v?.toString() ?? '';
int _i(dynamic v, [int fallback = 0]) =>
    v is num ? v.round() : int.tryParse(_s(v).trim()) ?? fallback;
Map<String, dynamic> _m(dynamic v) =>
    v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

String _joinList(dynamic v) => v is List
    ? v.map((e) => _s(e).trim()).where((e) => e.isNotEmpty).join(', ')
    : '';

List<String> _csv(String value) =>
    value.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toList();

const _scopeLabels = {
  'order': 'Hóa đơn / toàn bill',
  'sku': 'Hàng hóa / SKU cụ thể',
  'all_sku': 'Hàng hóa / mọi SKU',
};

const _typeLabels = {
  'pct': 'Giảm theo %',
  'amount': 'Giảm số tiền',
  'buy_x_get_1': 'Mua X tặng 1',
};

class PromotionSettingsPanel extends StatefulWidget {
  final ApiService api;
  const PromotionSettingsPanel({super.key, required this.api});

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
      ]);
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
        _rawRows.firstWhere((e) => _s(e['id']) == v.id, orElse: () => {});
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
        },
        'security_pin': pin,
      };

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      _toast('Nhập tên chương trình khuyến mại', error: true);
      return;
    }
    if (_scope == 'sku' && _skuId.isEmpty) {
      _toast('Chọn SKU áp dụng', error: true);
      return;
    }
    final pin = await requestManagerPin(
      context,
      _editing == null
          ? 'Tạo chương trình khuyến mại.'
          : 'Lưu chỉnh sửa chương trình khuyến mại.',
      label: 'PIN tài khoản đang đăng nhập / Admin',
    );
    if (pin == null) return;
    setState(() => _saving = true);
    try {
      if (_editing == null) {
        await widget.api.createVoucher(_body(pin));
      } else {
        await widget.api.updateVoucher(_editing!.id, _body(pin));
      }
      _toast('Đã lưu chương trình khuyến mại');
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
          ? 'Tắt chương trình "${v.name}".'
          : 'Bật chương trình "${v.name}".',
      label: 'PIN tài khoản đang đăng nhập / Admin',
    );
    if (pin == null) return;
    try {
      await widget.api.toggleVoucher(v.id, !v.active, pin: pin);
      await _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  void _toast(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? DanColors.late : DanColors.text,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: 'Khuyến mại / Voucher',
      addLabel: 'Tạo CTKM',
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
                  width: 690,
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: _formPanel(),
                  ),
                ),
                const VerticalDivider(width: 1, color: DanColors.border),
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: _listPanel(),
                  ),
                ),
              ],
            );
          }
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _formPanel(),
              const SizedBox(height: 14),
              _listPanel(),
            ],
          );
        }),
      ),
    );
  }

  Widget _formPanel() {
    final typeOptions = [
      'pct',
      'amount',
      if (_scope != 'order') 'buy_x_get_1',
    ];
    return Panel(
      title: _editing == null ? 'Tạo chương trình' : 'Chỉnh sửa chương trình',
      trailing: _editing == null
          ? null
          : TextButton.icon(
              onPressed: _reset,
              icon: const Icon(Icons.add, size: 16),
              label: const Text('Tạo mới'),
            ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _SectionTitle('Thông tin'),
          _grid([
            _field(_name, 'Tên chương trình', hint: 'VD: Giảm 10% đơn từ 500k'),
            _field(_code, 'Mã voucher', hint: 'Tự động nếu bỏ trống'),
            _dropdown(
              label: 'Khuyến mại theo',
              value: _scope,
              items: _scopeLabels,
              onChanged: (v) => setState(() {
                _scope = v ?? 'order';
                if (_scope != 'sku') {
                  _skuId = '';
                  _lotNo = '';
                }
                if (_scope == 'order' && _type == 'buy_x_get_1') _type = 'pct';
              }),
            ),
            _dropdown(
              label: 'Hình thức khuyến mại',
              value: _type,
              items: {for (final key in typeOptions) key: _typeLabels[key]!},
              onChanged: (v) => setState(() => _type = v ?? 'pct'),
            ),
            _field(_value, _type == 'buy_x_get_1' ? 'Mua X' : 'Giá trị',
                keyboardType: TextInputType.number),
            _field(_minTotal, 'Bill tối thiểu',
                keyboardType: TextInputType.number),
          ]),
          if (_scope == 'sku') ...[
            const SizedBox(height: 12),
            _grid([
              _skuDropdown(),
              _lotDropdown(),
            ]),
          ],
          const SizedBox(height: 18),
          const _SectionTitle('Hiệu lực & lịch chạy'),
          _grid([
            _field(_startsAt, 'Từ ngày', hint: 'YYYY-MM-DD HH:mm'),
            _field(_endsAt, 'Đến ngày', hint: 'YYYY-MM-DD HH:mm'),
            _field(_timeStart, 'Giờ bắt đầu', hint: '18:00'),
            _field(_timeEnd, 'Giờ kết thúc', hint: '22:00'),
            _dropdown(
              label: 'Sinh nhật khách',
              value: _birthdayMode,
              items: const {
                'off': 'Không ràng buộc',
                'day': 'Đúng ngày sinh nhật',
                'month': 'Trong tháng sinh nhật',
              },
              onChanged: (v) => setState(() => _birthdayMode = v ?? 'off'),
            ),
            _dropdown(
              label: 'Số lần/khách',
              value: _usageLimit,
              items: const {
                'unlimited': 'Không giới hạn',
                'once': 'Chỉ 1 lần',
              },
              onChanged: (v) => setState(() => _usageLimit = v ?? 'unlimited'),
            ),
          ]),
          const SizedBox(height: 12),
          _setPicker('Tháng áp dụng', List.generate(12, (i) => i + 1), _months,
              (v) => 'T$v', (v) => setState(() => _months = v)),
          _setPicker('Ngày trong tháng', List.generate(31, (i) => i + 1),
              _monthDays, (v) => '$v', (v) => setState(() => _monthDays = v)),
          _setPicker(
              'Thứ trong tuần',
              List.generate(7, (i) => i + 1),
              _weekdays,
              (v) => const {
                    1: 'T2',
                    2: 'T3',
                    3: 'T4',
                    4: 'T5',
                    5: 'T6',
                    6: 'T7',
                    7: 'CN'
                  }[v]!,
              (v) => setState(() => _weekdays = v)),
          const SizedBox(height: 18),
          const _SectionTitle('Phạm vi áp dụng'),
          _grid([
            _scopePicker(
              _branches,
              'Chi nhánh',
              _branchRows,
              idKey: 'id',
              labelKeys: const ['name', 'id'],
              emptyLabel: 'Toàn hệ thống',
            ),
            _field(_customerGroups, 'Nhóm khách hàng',
                hint: 'Để trống = tất cả'),
            _scopePicker(
              _staffIds,
              'Người tạo giao dịch',
              _userRows,
              idKey: 'id',
              labelKeys: const ['name', 'username', 'id'],
              emptyLabel: 'Tất cả nhân viên',
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Đang kích hoạt'),
              value: _active,
              onChanged: (v) => setState(() => _active = v),
            ),
          ]),
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'Ghi chú',
              hintText: 'Ghi chú nội bộ / mô tả cách chạy CTKM',
            ),
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              OutlinedButton(onPressed: _reset, child: const Text('Bỏ qua')),
              const SizedBox(width: 10),
              FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.save_outlined, size: 18),
                label: Text(_editing == null ? 'Lưu CTKM' : 'Lưu chỉnh sửa'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _listPanel() {
    return Panel(
      title: 'Danh sách chương trình',
      trailing: Text('${_rows.length} CTKM',
          style: const TextStyle(color: DanColors.muted)),
      child: _rows.isEmpty
          ? const Padding(
              padding: EdgeInsets.symmetric(vertical: 30),
              child: Center(
                child: Text('Chưa có chương trình khuyến mại',
                    style: TextStyle(color: DanColors.faint)),
              ),
            )
          : Column(
              children: [
                for (final v in _rows) ...[
                  _voucherCard(v),
                  if (v != _rows.last) const SizedBox(height: 10),
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
      padding: const EdgeInsets.all(12),
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
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(v.displayName,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontWeight: FontWeight.w900, fontSize: 13.5)),
                const SizedBox(height: 5),
                Text(
                  '${_typeLabels[v.type] ?? v.type}: ${v.valueLabel}'
                  '${v.minTotal > 0 ? ' · từ ${Fmt.money(v.minTotal)}' : ''}',
                  style: const TextStyle(
                      color: DanColors.muted,
                      fontWeight: FontWeight.w700,
                      fontSize: 12),
                ),
                const SizedBox(height: 3),
                Text(target,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style:
                        const TextStyle(color: DanColors.faint, fontSize: 11)),
                if (v.scheduleLabel.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(v.scheduleLabel,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: DanColors.faint, fontSize: 11)),
                ],
                if (v.scopeLabel.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(v.scopeLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: DanColors.faint, fontSize: 11)),
                ],
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            children: [
              Switch(
                value: v.active,
                onChanged: (_) => _toggle(v),
                activeThumbColor: DanColors.brand,
              ),
              IconButton(
                onPressed: () => _loadIntoForm(v),
                icon: const Icon(Icons.edit_outlined),
                tooltip: 'Sửa',
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
      decoration: const InputDecoration(labelText: 'SKU áp dụng'),
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
      decoration: const InputDecoration(labelText: 'Lot/Date áp dụng'),
      items: [
        const DropdownMenuItem(value: '', child: Text('Tất cả lot của SKU')),
        for (final lot in lots) DropdownMenuItem(value: lot, child: Text(lot)),
      ],
      onChanged: (v) => setState(() => _lotNo = v ?? ''),
    );
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
      for (final r in rows) _s(r[idKey]): r,
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
      icon: const Icon(Icons.arrow_drop_down_circle_outlined, size: 17),
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
      final v = _s(row[key]).trim();
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
            width: 440,
            child: ListView(
              shrinkWrap: true,
              children: [
                for (final row in rows)
                  CheckboxListTile(
                    dense: true,
                    value: draft.contains(_s(row[idKey])),
                    title: Text(
                        _scopeLabel(row, labelKeys, fallback: _s(row[idKey]))),
                    onChanged: (on) => setLocal(() {
                      final id = _s(row[idKey]);
                      on == true ? draft.add(id) : draft.remove(id);
                    }),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => setLocal(() => draft = <String>{}),
                child: const Text('Tất cả')),
            TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text('Hủy')),
            FilledButton(
                onPressed: () => Navigator.of(ctx).pop(draft),
                child: const Text('Áp dụng')),
          ],
        ),
      ),
    );
  }

  Widget _field(TextEditingController controller, String label,
      {String? hint, TextInputType? keyboardType}) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
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
        ? 'Tất cả'
        : (selected.toList()..sort()).map(label).join(', ');
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: const TextStyle(
                  color: DanColors.muted,
                  fontSize: 12,
                  fontWeight: FontWeight.w900)),
          const SizedBox(height: 7),
          OutlinedButton.icon(
            onPressed: () async {
              final picked = await _pickSet(title, values, selected, label);
              if (picked != null) onChanged(picked);
            },
            icon: const Icon(Icons.tune_outlined, size: 17),
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
            width: 420,
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
                child: const Text('Tất cả')),
            TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text('Hủy')),
            FilledButton(
                onPressed: () => Navigator.of(ctx).pop(draft),
                child: const Text('Áp dụng')),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;
  const _SectionTitle(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text(text.toUpperCase(),
          style: const TextStyle(
              color: DanColors.muted,
              fontSize: 11.5,
              fontWeight: FontWeight.w900)),
    );
  }
}
