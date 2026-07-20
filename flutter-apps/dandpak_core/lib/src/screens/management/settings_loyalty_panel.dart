import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import 'management_widgets.dart';
import 'settings_tab.dart';
import '../../utils/translation.dart';

String _s(dynamic v) => v?.toString() ?? '';
bool _b(dynamic v, [bool fallback = false]) =>
    v == null ? fallback : (v == true || v == 1 || v == '1' || v == 'true');
int _i(dynamic v, [int fallback = 0]) =>
    v is num ? v.round() : int.tryParse(_s(v)) ?? fallback;
double _d(dynamic v, [double fallback = 0]) =>
    v is num ? v.toDouble() : double.tryParse(_s(v)) ?? fallback;
Map<String, dynamic> _m(dynamic v) =>
    v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
List<Map<String, dynamic>> _lm(dynamic v) => v is List
    ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
    : <Map<String, dynamic>>[];

class LoyaltySettingsPanel extends StatefulWidget {
  final ApiService api;
  LoyaltySettingsPanel({super.key, required this.api});

  @override
  State<LoyaltySettingsPanel> createState() => _LoyaltySettingsPanelState();
}

class _LoyaltySettingsPanelState extends State<LoyaltySettingsPanel> {
  bool _loading = true;
  bool _saving = false;
  String? _error;

  bool _enabled = false;
  bool _phoneRequired = true;
  bool _amountEnabled = true;
  bool _orderEnabled = false;
  bool _birthdayEnabled = false;
  bool _redeemEnabled = false;
  bool _cashbackEnabled = false;

  final _amountSpend = TextEditingController(text: '10000');
  final _amountPoints = TextEditingController(text: '1');
  final _amountMin = TextEditingController(text: '0');
  final _orderPoints = TextEditingController(text: '1');
  final _orderMin = TextEditingController(text: '0');
  final _birthdayMultiplier = TextEditingController(text: '2');
  final _pointValue = TextEditingController(text: '1000');
  final _minPoints = TextEditingController(text: '10');
  final _maxPercent = TextEditingController(text: '50');
  final _cashbackPercent = TextEditingController(text: '0');
  final _cashbackMin = TextEditingController(text: '0');

  String _rounding = 'floor';
  String _cashbackAs = 'points';
  List<Map<String, dynamic>> _tiers = [];
  List<Map<String, dynamic>> _productBonus = [];
  List<Map<String, dynamic>> _actions = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in [
      _amountSpend,
      _amountPoints,
      _amountMin,
      _orderPoints,
      _orderMin,
      _birthdayMultiplier,
      _pointValue,
      _minPoints,
      _maxPercent,
      _cashbackPercent,
      _cashbackMin,
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
      final settings = await widget.api.getAppSettings();
      _apply(_m(settings['loyalty_config']));
      if (mounted) setState(() => _loading = false);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  void _apply(Map<String, dynamic> cfg) {
    final earn = _m(cfg['earn']);
    final amount = _m(earn['amount']);
    final order = _m(earn['order']);
    final birthday = _m(earn['birthday']);
    final redeem = _m(cfg['redeem']);
    final cashback = _m(cfg['cashback']);
    _enabled = _b(cfg['enabled']);
    _phoneRequired = _b(cfg['phoneRequired'], true);
    _amountEnabled = _b(amount['enabled'], true);
    _orderEnabled = _b(order['enabled']);
    _birthdayEnabled = _b(birthday['enabled']);
    _redeemEnabled = _b(redeem['enabled']);
    _cashbackEnabled = _b(cashback['enabled']);
    _amountSpend.text = _i(amount['spend'], 10000).toString();
    _amountPoints.text = _i(amount['points'], 1).toString();
    _amountMin.text = _i(amount['minSpend'], 0).toString();
    _orderPoints.text = _i(order['points'], 1).toString();
    _orderMin.text = _i(order['minSpend'], 0).toString();
    _birthdayMultiplier.text = _d(birthday['multiplier'], 2).toString();
    _rounding = ['floor', 'round', 'ceil'].contains(amount['rounding'])
        ? _s(amount['rounding'])
        : 'floor';
    _pointValue.text = _i(redeem['pointValue'], 1000).toString();
    _minPoints.text = _i(redeem['minPoints'], 10).toString();
    _maxPercent.text = _d(redeem['maxPercent'], 50).toString();
    _cashbackPercent.text = _d(cashback['percent'], 0).toString();
    _cashbackMin.text = _i(cashback['minSpend'], 0).toString();
    _cashbackAs = _s(cashback['as']) == 'voucher' ? 'voucher' : 'points';
    _tiers = _lm(cfg['tiers']);
    if (_tiers.isEmpty) {
      _tiers = [
        {
          'name': 'Silver',
          'fromPoints': 0,
          'earnMultiplier': 1,
          'discountPct': 0
        },
        {
          'name': 'Gold',
          'fromPoints': 200,
          'earnMultiplier': 1.1,
          'discountPct': 3
        },
        {
          'name': 'Platinum',
          'fromPoints': 600,
          'earnMultiplier': 1.25,
          'discountPct': 5
        },
      ];
    }
    _productBonus = _lm(earn['productBonus']);
    _actions = _lm(cfg['actions']);
    if (_actions.isEmpty) {
      _actions = [
        {
          'key': 'signup',
          'label': t('Đăng ký số điện thoại'),
          'points': 10,
          'enabled': true
        },
        {
          'key': 'referral',
          'label': t('Giới thiệu bạn bè'),
          'points': 30,
          'enabled': false
        },
        {
          'key': 'review',
          'label': t('Đánh giá trải nghiệm'),
          'points': 5,
          'enabled': false
        },
      ];
    }
  }

  Map<String, dynamic> _config() => {
        'enabled': _enabled,
        'phoneRequired': _phoneRequired,
        'earn': {
          'amount': {
            'enabled': _amountEnabled,
            'spend': _i(_amountSpend.text, 10000),
            'points': _i(_amountPoints.text, 1),
            'rounding': _rounding,
            'minSpend': _i(_amountMin.text, 0),
          },
          'order': {
            'enabled': _orderEnabled,
            'points': _i(_orderPoints.text, 1),
            'minSpend': _i(_orderMin.text, 0),
          },
          'birthday': {
            'enabled': _birthdayEnabled,
            'multiplier': _d(_birthdayMultiplier.text, 2),
          },
          'productBonus': _productBonus,
        },
        'redeem': {
          'enabled': _redeemEnabled,
          'pointValue': _i(_pointValue.text, 1000),
          'minPoints': _i(_minPoints.text, 10),
          'maxPercent': _d(_maxPercent.text, 50),
        },
        'cashback': {
          'enabled': _cashbackEnabled,
          'percent': _d(_cashbackPercent.text, 0),
          'as': _cashbackAs,
          'minSpend': _i(_cashbackMin.text, 0),
        },
        'tiers': _tiers,
        'actions': _actions,
      };

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await widget.api.saveAppSettings({'loyalty_config': _config()});
      _toast(t('Đã lưu cấu hình tích điểm'));
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _toast(String msg, {bool error = false}) =>
      appToast(context, msg, isError: error);

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: t('Tích điểm & CTKM'),
      onRefresh: _load,
      child: settingsState(
        loading: _loading,
        error: _error,
        onRetry: _load,
        child: ListView(
          padding: EdgeInsets.all(18),
          children: [
            Panel(
              title: t('Kích hoạt'),
              child: Column(
                children: [
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: _enabled,
                    onChanged: (v) => setState(() => _enabled = v),
                    title: Text(
                        t('Bật chương trình tích điểm theo số điện thoại')),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: _phoneRequired,
                    onChanged: (v) => setState(() => _phoneRequired = v),
                    title: Text(t('Chỉ tích điểm khi khách có số điện thoại')),
                  ),
                ],
              ),
            ),
            SizedBox(height: 14),
            Panel(title: t('Cách tích điểm tự động'), child: _earnPanel()),
            SizedBox(height: 14),
            Panel(title: t('Đổi điểm & cashback'), child: _redeemPanel()),
            SizedBox(height: 14),
            Panel(title: t('Hạng thành viên'), child: _tiersPanel()),
            SizedBox(height: 14),
            Panel(
                title: t('Thưởng theo sản phẩm ưu tiên'),
                child: _productPanel()),
            SizedBox(height: 14),
            Panel(
                title: t('Điểm hành vi ngoài mua hàng'),
                child: _actionsPanel()),
            SizedBox(height: 18),
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
                    : Icon(Icons.save_outlined, size: 18),
                label: Text(t('Lưu')),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _earnPanel() {
    return Column(
      children: [
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _amountEnabled,
          onChanged: (v) => setState(() => _amountEnabled = v),
          title: Text(t('Tích điểm theo giá trị mua hàng')),
        ),
        Row(children: [
          _numField(t('Chi tiêu'), _amountSpend),
          _numField(t('Điểm'), _amountPoints),
          _numField(t('Tối thiểu'), _amountMin),
          SizedBox(
            width: 150,
            child: DropdownButtonFormField<String>(
              initialValue: _rounding,
              decoration: InputDecoration(labelText: t('Làm tròn')),
              items: [
                DropdownMenuItem(value: 'floor', child: Text(t('Xuống'))),
                DropdownMenuItem(value: 'round', child: Text(t('Gần nhất'))),
                DropdownMenuItem(value: 'ceil', child: Text(t('Lên'))),
              ],
              onChanged: (v) => setState(() => _rounding = v ?? 'floor'),
            ),
          ),
        ]),
        Divider(height: 24),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _orderEnabled,
          onChanged: (v) => setState(() => _orderEnabled = v),
          title: Text(t('Tích điểm theo số lần giao dịch')),
        ),
        Row(children: [
          _numField(t('Điểm / hóa đơn'), _orderPoints),
          _numField(t('Hóa đơn tối thiểu'), _orderMin),
          Spacer(),
        ]),
        Divider(height: 24),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _birthdayEnabled,
          onChanged: (v) => setState(() => _birthdayEnabled = v),
          title: Text(t('Nhân điểm trong ngày sinh nhật')),
        ),
        Row(children: [
          _numField(t('Hệ số nhân'), _birthdayMultiplier),
          Spacer(),
        ]),
      ],
    );
  }

  Widget _redeemPanel() {
    return Column(
      children: [
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _redeemEnabled,
          onChanged: (v) => setState(() => _redeemEnabled = v),
          title: Text(t('Cho phép đổi điểm thành giảm giá')),
        ),
        Row(children: [
          _numField(t('1 điểm = VND'), _pointValue),
          _numField(t('Điểm tối thiểu'), _minPoints),
          _numField(t('Tối đa % bill'), _maxPercent),
          Spacer(),
        ]),
        Divider(height: 24),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _cashbackEnabled,
          onChanged: (v) => setState(() => _cashbackEnabled = v),
          title: Text(t('Hoàn tiền / cashback')),
        ),
        Row(children: [
          _numField('% cashback', _cashbackPercent),
          _numField(t('Chi tiêu tối thiểu'), _cashbackMin),
          SizedBox(
            width: 170,
            child: DropdownButtonFormField<String>(
              initialValue: _cashbackAs,
              decoration: InputDecoration(labelText: t('Quy đổi')),
              items: [
                DropdownMenuItem(value: 'points', child: Text(t('Thành điểm'))),
                DropdownMenuItem(
                    value: 'voucher', child: Text(t('Thành voucher'))),
              ],
              onChanged: (v) => setState(() => _cashbackAs = v ?? 'points'),
            ),
          ),
          Spacer(),
        ]),
      ],
    );
  }

  Widget _tiersPanel() {
    return Column(
      children: [
        for (var i = 0; i < _tiers.length; i++) _tierRow(i),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: () => setState(() => _tiers.add({
                  'name': 'Tier ${_tiers.length + 1}',
                  'fromPoints': 0,
                  'earnMultiplier': 1,
                  'discountPct': 0,
                })),
            icon: Icon(Icons.add),
            label: Text(t('Thêm hạng')),
          ),
        ),
      ],
    );
  }

  Widget _tierRow(int i) {
    final tier = _tiers[i];
    return Padding(
      padding: EdgeInsets.only(bottom: 10),
      child: Row(children: [
        _textField(t('Tên hạng'), _s(tier['name']), (v) => tier['name'] = v,
            width: 180),
        _inlineNum(t('Từ điểm'), tier['fromPoints'],
            (v) => tier['fromPoints'] = _i(v)),
        _inlineNum(t('Nhân điểm'), tier['earnMultiplier'],
            (v) => tier['earnMultiplier'] = _d(v, 1)),
        _inlineNum(t('% ưu đãi'), tier['discountPct'],
            (v) => tier['discountPct'] = _d(v)),
        IconButton(
          onPressed: _tiers.length <= 1
              ? null
              : () => setState(() => _tiers.removeAt(i)),
          icon: Icon(Icons.delete_outline, color: DanColors.late),
        ),
      ]),
    );
  }

  Widget _productPanel() {
    return Column(children: [
      for (var i = 0; i < _productBonus.length; i++) _productRow(i),
      Align(
        alignment: Alignment.centerLeft,
        child: TextButton.icon(
          onPressed: () => setState(() => _productBonus.add({
                'key': 'product_${_productBonus.length + 1}',
                'match': 'sku',
                'value': '',
                'multiplier': 2,
                'extraPoints': 0,
                'enabled': true,
              })),
          icon: Icon(Icons.add),
          label: Text(t('Thêm sản phẩm / nhóm ưu tiên')),
        ),
      ),
    ]);
  }

  Widget _productRow(int i) {
    final p = _productBonus[i];
    return Padding(
      padding: EdgeInsets.only(bottom: 10),
      child: Row(children: [
        Switch(
            value: _b(p['enabled'], true),
            onChanged: (v) => setState(() => p['enabled'] = v)),
        SizedBox(
          width: 140,
          child: DropdownButtonFormField<String>(
            initialValue: _s(p['match']).isEmpty ? 'sku' : _s(p['match']),
            decoration: InputDecoration(labelText: 'Match'),
            items: [
              DropdownMenuItem(value: 'sku', child: Text(t('Mã hàng'))),
              DropdownMenuItem(value: 'category', child: Text(t('Nhóm hàng'))),
              DropdownMenuItem(value: 'brand', child: Text(t('Thương hiệu'))),
              DropdownMenuItem(value: 'name', child: Text(t('Tên chứa'))),
            ],
            onChanged: (v) => setState(() => p['match'] = v ?? 'sku'),
          ),
        ),
        _textField(t('Giá trị'), _s(p['value']), (v) => p['value'] = v,
            width: 220),
        _inlineNum(
            t('Nhân'), p['multiplier'], (v) => p['multiplier'] = _d(v, 1)),
        _inlineNum(
            t('Điểm cộng'), p['extraPoints'], (v) => p['extraPoints'] = _i(v)),
        IconButton(
          onPressed: () => setState(() => _productBonus.removeAt(i)),
          icon: Icon(Icons.delete_outline, color: DanColors.late),
        ),
      ]),
    );
  }

  Widget _actionsPanel() {
    return Column(children: [
      for (var i = 0; i < _actions.length; i++) _actionRow(i),
      Align(
        alignment: Alignment.centerLeft,
        child: TextButton.icon(
          onPressed: () => setState(() => _actions.add({
                'key': 'action_${_actions.length + 1}',
                'label': '',
                'points': 0,
                'enabled': false,
              })),
          icon: Icon(Icons.add),
          label: Text(t('Thêm hành vi')),
        ),
      ),
    ]);
  }

  Widget _actionRow(int i) {
    final a = _actions[i];
    return Padding(
      padding: EdgeInsets.only(bottom: 10),
      child: Row(children: [
        Switch(
            value: _b(a['enabled']),
            onChanged: (v) => setState(() => a['enabled'] = v)),
        _textField(t('Mã'), _s(a['key']), (v) => a['key'] = v, width: 150),
        _textField(t('Tên hành vi'), _s(a['label']), (v) => a['label'] = v,
            width: 260),
        _inlineNum(t('Điểm'), a['points'], (v) => a['points'] = _i(v)),
        IconButton(
          onPressed: () => setState(() => _actions.removeAt(i)),
          icon: Icon(Icons.delete_outline, color: DanColors.late),
        ),
      ]),
    );
  }

  Widget _numField(String label, TextEditingController c) {
    return Padding(
      padding: EdgeInsets.only(right: 12, top: 8, bottom: 4),
      child: SizedBox(
        width: 150,
        child: TextField(
          controller: c,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(labelText: label, isDense: true),
        ),
      ),
    );
  }

  Widget _inlineNum(
      String label, dynamic value, ValueChanged<String> onChanged) {
    return _textField(label, _s(value), onChanged, width: 130, numeric: true);
  }

  Widget _textField(String label, String value, ValueChanged<String> onChanged,
      {double width = 180, bool numeric = false}) {
    return Padding(
      padding: EdgeInsets.only(right: 10),
      child: SizedBox(
        width: width,
        child: TextFormField(
          initialValue: value,
          keyboardType: numeric ? TextInputType.number : TextInputType.text,
          decoration: InputDecoration(labelText: label, isDense: true),
          onChanged: onChanged,
        ),
      ),
    );
  }
}
