import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/file_pick.dart';
import '../../ui/format.dart';
import '../../widgets/address_fields.dart';
import '../../widgets/dan_top_bar.dart';
import '../../widgets/tax_lookup.dart';
import '../management/management_widgets.dart';
import '../../utils/translation.dart';

String _s(dynamic v) => v?.toString() ?? '';
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;
bool _b(dynamic v) => v == true || v == 1 || v == '1';

String _assetUrl(String baseUrl, String value) {
  final raw = value.trim();
  if (raw.isEmpty || raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  return '$baseUrl${raw.startsWith('/') ? '' : '/'}$raw';
}

String _mimeForFileName(String name) {
  final lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

List<List<String>> get _types => [
      ['all', t('Tất cả')],
      ['customer', t('Khách hàng')],
      ['supplier', t('Nhà cung cấp')],
      ['staff', t('Nhân viên')],
    ];

/// Native port of the web Liên hệ (contacts.html): shared customer/supplier/
/// staff directory with type tabs, search and a contact editor.
class _CustomerColumn {
  final String key;
  final String label;
  final double width;
  final bool numeric;
  _CustomerColumn(this.key, this.label, this.width, {this.numeric = false});
}

List<List<String>> get _customerTypes => [
      ['customer', t('Khách hàng')],
      ['supplier', t('Nhà cung cấp')],
      ['both', t('Khách hàng + NCC')],
      ['staff', t('Nhân viên')],
      ['all', t('Tất cả')],
    ];

List<_CustomerColumn> get _customerColumns => [
      _CustomerColumn('code', t('Mã khách hàng'), 132),
      _CustomerColumn('name', t('Tên khách hàng'), 220),
      _CustomerColumn('phone', t('Điện thoại'), 130),
      _CustomerColumn('type', t('Loại khách hàng'), 130),
      _CustomerColumn('group', t('Nhóm khách hàng'), 150),
      _CustomerColumn('email', 'Email', 180),
      _CustomerColumn('company', t('Công ty'), 190),
      _CustomerColumn('tax', t('Mã số thuế'), 130),
      _CustomerColumn('address', t('Địa chỉ'), 240),
      _CustomerColumn('currentDebt', t('Nợ hiện tại'), 130, numeric: true),
      _CustomerColumn('debtDays', t('Số ngày nợ'), 110, numeric: true),
      _CustomerColumn('totalSpent', t('Tổng bán'), 135, numeric: true),
      _CustomerColumn('points', t('Điểm hiện tại'), 125, numeric: true),
      _CustomerColumn('tier', t('Hạng'), 110),
      _CustomerColumn('afterReturn', t('Tổng bán trừ trả hàng'), 170,
          numeric: true),
      _CustomerColumn('status', t('Trạng thái'), 120),
    ];

final _defaultCustomerColumns = {
  'code',
  'name',
  'phone',
  'currentDebt',
  'debtDays',
  'totalSpent',
  'points',
  'afterReturn',
};

class ContactsScreen extends StatefulWidget {
  /// Tab mở đầu: 'customer' | 'supplier' — menu "Nhà cung cấp" trong module
  /// Kho mở thẳng tab NCC của cùng danh bạ Liên hệ.
  final String initialType;
  ContactsScreen({super.key, this.initialType = 'customer'});

  @override
  State<ContactsScreen> createState() => _KiotCustomerScreenState();
}

class _KiotCustomerScreenState extends State<ContactsScreen> {
  List<Map<String, dynamic>> _partners = [];
  Map<String, dynamic> _counts = {};
  late String _type = widget.initialType;
  String _status = 'active';
  String _search = '';
  String? _selectedId;
  String _detailTab = 'info';
  bool _loading = true;
  String? _error;

  final _salesFrom = TextEditingController();
  final _salesTo = TextEditingController();
  final _pointsFrom = TextEditingController();
  final _pointsTo = TextEditingController();
  final Set<String> _visibleColumns = {..._defaultCustomerColumns};

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _salesFrom.dispose();
    _salesTo.dispose();
    _pointsFrom.dispose();
    _pointsTo.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await context.read<ApiService>().getPartners(
            type: _type,
            q: _search.trim(),
            includeInactive: _status != 'active',
          );
      if (!mounted) return;
      setState(() {
        _partners = (res['partners'] is List)
            ? (res['partners'] as List)
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : [];
        _counts = res['counts'] is Map
            ? Map<String, dynamic>.from(res['counts'])
            : {};
        _loading = false;
        _error = null;
        if (_selectedId != null &&
            !_partners.any((c) => _s(c['id']) == _selectedId)) {
          _selectedId = null;
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

  Future<void> _openForm([Map<String, dynamic>? partner]) async {
    final auth = context.read<AuthProvider>();
    final permission = partner == null ? 'contacts.create' : 'contacts.edit';
    if (!auth.hasPermission(permission)) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(t('Bạn không có quyền thực hiện thao tác này')),
        backgroundColor: DanColors.late,
      ));
      return;
    }
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _PartnerForm(
        api: context.read<ApiService>(),
        partner: partner,
        canDelete: auth.hasPermission('contacts.delete'),
      ),
    );
    if (saved == true) _load();
  }

  int? _ctrlInt(TextEditingController c) {
    final raw = c.text.replaceAll(RegExp(r'[^0-9]'), '');
    return raw.isEmpty ? null : int.tryParse(raw);
  }

  List<Map<String, dynamic>> get _filteredPartners {
    final minSales = _ctrlInt(_salesFrom);
    final maxSales = _ctrlInt(_salesTo);
    final minPoints = _ctrlInt(_pointsFrom);
    final maxPoints = _ctrlInt(_pointsTo);
    return _partners.where((c) {
      if (_status == 'active' && !_b(c['active'])) return false;
      if (_status == 'inactive' && _b(c['active'])) return false;
      final spent = _n(c['total_spent']).round();
      final points = _n(c['loyalty_points']).round();
      if (minSales != null && spent < minSales) return false;
      if (maxSales != null && spent > maxSales) return false;
      if (minPoints != null && points < minPoints) return false;
      if (maxPoints != null && points > maxPoints) return false;
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentUser;
    final branch = auth.selectedBranch;
    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: DanModuleTopBar(
        brandName: branch.name.isNotEmpty ? branch.name : branch.id,
        title: t('Khách hàng'),
        subtitle: '',
        titleIcon: Icons.people_alt_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
      ),
      body: _body(),
    );
  }

  Widget _body() {
    if (_loading && _partners.isEmpty) {
      return Center(child: CircularProgressIndicator());
    }
    if (_error != null && _partners.isEmpty) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được danh bạ ($_error)'),
            error: true, onRetry: _load),
      );
    }
    return Row(
      children: [
        SizedBox(width: 290, child: _sidebar()),
        VerticalDivider(width: 1, color: DanColors.border),
        Expanded(child: _mainPanel()),
      ],
    );
  }

  Widget _sidebar() {
    return Container(
      color: DanColors.surface,
      child: ListView(
        padding: EdgeInsets.fromLTRB(18, 16, 16, 24),
        children: [
          _filterTitle(t('Loại đối tác')),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: [
              for (final t in _customerTypes)
                ChoiceChip(
                  label: Text(
                      t[0] == 'all' ? t[1] : '${t[1]} (${_counts[t[0]] ?? 0})'),
                  selected: _type == t[0],
                  onSelected: (_) {
                    setState(() => _type = t[0]);
                    _load();
                  },
                ),
            ],
          ),
          _dividerGap(),
          _filterTitle(t('Ngày tạo')),
          _radioLine(t('Toàn thời gian'), true),
          _radioLine(t('Tùy chỉnh'), false,
              trailing: Icons.calendar_month_outlined),
          _dividerGap(),
          _filterTitle(t('Sinh nhật')),
          _radioLine(t('Toàn thời gian'), true),
          _radioLine(t('Tùy chỉnh'), false,
              trailing: Icons.calendar_month_outlined),
          _dividerGap(),
          _filterTitle(t('Ngày giao dịch cuối')),
          _radioLine(t('Toàn thời gian'), true),
          _radioLine(t('Tùy chỉnh'), false,
              trailing: Icons.calendar_month_outlined),
          _dividerGap(),
          _filterTitle(t('Tổng bán')),
          _rangeFields(_salesFrom, _salesTo, onChanged: (_) => setState(() {})),
          _dividerGap(),
          _filterTitle(t('Nợ hiện tại')),
          _disabledRangeFields(),
          _dividerGap(),
          _filterTitle(t('Số ngày nợ')),
          _disabledRangeFields(),
          _dividerGap(),
          _filterTitle(t('Điểm hiện tại')),
          _rangeFields(_pointsFrom, _pointsTo,
              onChanged: (_) => setState(() {})),
          _dividerGap(),
          _filterTitle(t('Trạng thái')),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: [
              _statusChip('all', t('Tất cả')),
              _statusChip('active', t('Đang hoạt động')),
              _statusChip('inactive', t('Ngưng hoạt động')),
            ],
          ),
        ],
      ),
    );
  }

  Widget _mainPanel() {
    final rows = _filteredPartners;
    final canCreate =
        context.watch<AuthProvider>().hasPermission('contacts.create');
    return Column(
      children: [
        Container(
          color: DanColors.bg,
          padding: EdgeInsets.fromLTRB(18, 14, 18, 10),
          child: Row(
            children: [
              Text(t('Khách hàng'),
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
              SizedBox(width: 18),
              SizedBox(
                width: dialogWidth(context, 420),
                child: TextField(
                  decoration: InputDecoration(
                    hintText: t('Theo mã, tên, số điện thoại'),
                    prefixIcon: Icon(Icons.search),
                    suffixIcon: Icon(Icons.tune_outlined),
                    isDense: true,
                  ),
                  onChanged: (v) => _search = v,
                  onSubmitted: (_) => _load(),
                ),
              ),
              Spacer(),
              if (canCreate)
                OutlinedButton.icon(
                  onPressed: () => _openForm(),
                  icon: Icon(Icons.add, size: 18),
                  label: Text(t('Khách hàng')),
                ),
              SizedBox(width: 8),
              Tooltip(
                message: t('Cột hiển thị'),
                child: IconButton.outlined(
                  onPressed: _showColumnsDialog,
                  icon: Icon(Icons.view_column_outlined),
                ),
              ),
              SizedBox(width: 4),
              IconButton.outlined(
                tooltip: t('Tải lại'),
                onPressed: _load,
                icon: _loading
                    ? SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : Icon(Icons.refresh),
              ),
            ],
          ),
        ),
        Divider(height: 1, color: DanColors.border),
        Expanded(
          child: rows.isEmpty
              ? Center(
                  child: Text(t('Chưa có khách hàng phù hợp'),
                      style: TextStyle(color: DanColors.faint)))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: SingleChildScrollView(
                    physics: AlwaysScrollableScrollPhysics(),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: ConstrainedBox(
                        constraints: BoxConstraints(minWidth: 1180),
                        child: _table(rows),
                      ),
                    ),
                  ),
                ),
        ),
      ],
    );
  }

  Widget _table(List<Map<String, dynamic>> rows) {
    final cols =
        _customerColumns.where((c) => _visibleColumns.contains(c.key)).toList();
    final width = cols.fold<double>(0, (sum, c) => sum + c.width);
    return SizedBox(
      width: width,
      child: Column(
        children: [
          _tableLine(cols, header: true),
          for (final c in rows) _customerRow(c, cols),
        ],
      ),
    );
  }

  Widget _tableLine(List<_CustomerColumn> cols, {bool header = false}) {
    return Container(
      height: header ? 42 : 38,
      color: header ? Color(0xFFEAF4FF) : DanColors.surface,
      child: Row(
        children: [
          for (final col in cols)
            _cell(
              header ? col.label : '',
              col.width,
              numeric: col.numeric,
              bold: header,
              color: header ? DanColors.text : DanColors.muted,
            ),
        ],
      ),
    );
  }

  Widget _customerRow(Map<String, dynamic> c, List<_CustomerColumn> cols) {
    final selected = _selectedId == _s(c['id']);
    return Column(
      children: [
        InkWell(
          onTap: () => setState(() {
            _selectedId = selected ? null : _s(c['id']);
            _detailTab = 'info';
          }),
          onDoubleTap: () => _openForm(c),
          child: Container(
            height: 44,
            decoration: BoxDecoration(
              color: selected ? Color(0xFFF1F8FF) : DanColors.surface,
              border:
                  Border(top: BorderSide(color: DanColors.border, width: .6)),
            ),
            child: Row(
              children: [
                for (final col in cols)
                  _cell(_valueFor(c, col.key), col.width,
                      numeric: col.numeric,
                      color: selected ? DanColors.brand : DanColors.text),
              ],
            ),
          ),
        ),
        if (selected)
          _detail(c, cols.fold<double>(0, (s, col) => s + col.width)),
      ],
    );
  }

  Widget _detail(Map<String, dynamic> c, double width) {
    return Container(
      width: width,
      padding: EdgeInsets.fromLTRB(18, 10, 18, 18),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.brand, width: 1.2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _detailTabButton('info', t('Thông tin')),
              _detailTabButton('address', t('Địa chỉ nhận hàng')),
              _detailTabButton('orders', t('Lịch sử đặt hàng')),
              _detailTabButton('debt', t('Nợ cần thu từ khách')),
              _detailTabButton('points', t('Lịch sử tích điểm')),
              Spacer(),
              if (context.read<AuthProvider>().hasPermission('contacts.edit'))
                TextButton.icon(
                  onPressed: () => _openForm(c),
                  icon: Icon(Icons.edit_outlined, size: 16),
                  label: Text(t('Sửa')),
                ),
            ],
          ),
          Divider(height: 18, color: DanColors.border),
          if (_detailTab == 'info') _infoDetail(c),
          if (_detailTab == 'address') _addressDetail(c),
          if (_detailTab == 'orders')
            _emptyDetail(t('Chưa có lịch sử đặt hàng chi tiết')),
          if (_detailTab == 'debt')
            _emptyDetail(t('Khách hàng không có công nợ')),
          if (_detailTab == 'points') _pointsDetail(c),
        ],
      ),
    );
  }

  Widget _infoDetail(Map<String, dynamic> c) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _ContactAvatar(
          name: _s(c['name']),
          avatar: _s(c['avatar']),
          baseUrl: context.read<ApiService>().baseUrl,
        ),
        SizedBox(width: 18),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Flexible(
                    child: Text(
                      _s(c['name']).isEmpty
                          ? t('Khách chưa đặt tên')
                          : _s(c['name']),
                      overflow: TextOverflow.ellipsis,
                      style:
                          TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                    ),
                  ),
                  SizedBox(width: 8),
                  Text(_valueFor(c, 'code'),
                      style: TextStyle(
                          color: DanColors.muted, fontWeight: FontWeight.w700)),
                ],
              ),
              SizedBox(height: 9),
              Wrap(
                spacing: 32,
                runSpacing: 14,
                children: [
                  _infoPair(t('Điện thoại'), _s(c['phone'])),
                  _infoPair('Email', _s(c['email'])),
                  _infoPair(t('Sinh nhật'), _s(c['birthday'])),
                  _infoPair(t('Công ty'), _s(c['company'])),
                  _infoPair(t('Mã số thuế'), _s(c['tax_code'])),
                  _infoPair(t('Địa chỉ'), _s(c['address']), wide: true),
                  _infoPair(t('Ghi chú'), _s(c['note']), wide: true),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _addressDetail(Map<String, dynamic> c) {
    if (_s(c['address']).isEmpty &&
        _s(c['address_detail']).isEmpty &&
        _s(c['address_ward']).isEmpty &&
        _s(c['address_province']).isEmpty) {
      return _emptyDetail(t('Chưa có địa chỉ nhận hàng riêng'));
    }
    return Wrap(
      spacing: 32,
      runSpacing: 14,
      children: [
        _infoPair(
            t('Địa chỉ'),
            _s(c['address_detail']).isEmpty
                ? _s(c['address'])
                : _s(c['address_detail']),
            wide: true),
        _infoPair(t('Phường/Xã'), _s(c['address_ward'])),
        _infoPair(t('Tỉnh/Thành phố'), _s(c['address_province'])),
        _infoPair(t('Mã phường/xã'), _s(c['ward_code'])),
        _infoPair(t('Mã tỉnh/thành'), _s(c['province_code'])),
        _infoPair(t('Dòng đầy đủ'), _s(c['address']), wide: true),
      ],
    );
  }

  Widget _pointsDetail(Map<String, dynamic> c) {
    return Wrap(
      spacing: 24,
      runSpacing: 14,
      children: [
        _metric(t('Điểm hiện tại'), Fmt.int0(_n(c['loyalty_points']))),
        _metric(
            t('Hạng thành viên'),
            _s(c['loyalty_tier']).isEmpty
                ? t('Chưa có')
                : _s(c['loyalty_tier'])),
        _metric(t('Tổng đơn'), Fmt.int0(_n(c['total_orders']))),
        _metric(t('Tổng mua'), Fmt.money(_n(c['total_spent']))),
        _infoPair(
          t('Sở thích / insight'),
          _s(c['profile_summary']).isEmpty
              ? t('Chưa đủ dữ liệu')
              : _s(c['profile_summary']),
          wide: true,
        ),
      ],
    );
  }

  Widget _emptyDetail(String text) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 18),
      child: Text(text, style: TextStyle(color: DanColors.faint)),
    );
  }

  Widget _metric(String label, String value) {
    return SizedBox(
      width: 170,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(fontSize: 12, color: DanColors.faint)),
          SizedBox(height: 4),
          Text(value,
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
        ],
      ),
    );
  }

  Widget _infoPair(String label, String value, {bool wide = false}) {
    return SizedBox(
      width: wide ? 520 : 250,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(fontSize: 12, color: DanColors.faint)),
          SizedBox(height: 3),
          Text(value.trim().isEmpty ? t('Chưa có') : value,
              maxLines: wide ? 2 : 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }

  Widget _detailTabButton(String key, String label) {
    final selected = _detailTab == key;
    return TextButton(
      onPressed: () => setState(() => _detailTab = key),
      style: TextButton.styleFrom(
        foregroundColor: selected ? DanColors.brand : DanColors.text,
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      ),
      child: Text(label,
          style: TextStyle(
              fontWeight: selected ? FontWeight.w900 : FontWeight.w700)),
    );
  }

  Widget _cell(String text, double width,
      {bool numeric = false, bool bold = false, Color? color}) {
    return SizedBox(
      width: width,
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: 12),
        child: Align(
          alignment: numeric ? Alignment.centerRight : Alignment.centerLeft,
          child: Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 13,
              fontWeight: bold ? FontWeight.w900 : FontWeight.w600,
              color: color ?? DanColors.text,
            ),
          ),
        ),
      ),
    );
  }

  String _valueFor(Map<String, dynamic> c, String key) {
    final spent = _n(c['total_spent']);
    return switch (key) {
      'code' => _s(c['code']).isNotEmpty ? _s(c['code']) : 'DC...',
      'name' => _s(c['name']).isEmpty ? t('Khách chưa đặt tên') : _s(c['name']),
      'phone' => _s(c['phone']),
      'type' => _partnerTypeLabel(c),
      'group' =>
        _s(c['perk_type']) == 'none' ? t('Chưa có') : t('Ưu đãi riêng'),
      'email' => _s(c['email']),
      'company' => _s(c['company']),
      'tax' => _s(c['tax_code']),
      'address' => _s(c['address']),
      'currentDebt' => '0',
      'debtDays' => '',
      'totalSpent' => Fmt.money(spent),
      'points' => Fmt.int0(_n(c['loyalty_points'])),
      'tier' =>
        _s(c['loyalty_tier']).isEmpty ? t('Chưa có') : _s(c['loyalty_tier']),
      'afterReturn' => Fmt.money(spent),
      'status' => _b(c['active']) ? t('Đang hoạt động') : t('Ngưng hoạt động'),
      _ => '',
    };
  }

  String _partnerTypeLabel(Map<String, dynamic> c) {
    final type = _s(c['partner_type']);
    return switch (type) {
      'supplier' => t('Nhà cung cấp'),
      'both' => t('Khách hàng + NCC'),
      'staff' => t('Nhân viên'),
      _ => t('Cá nhân'),
    };
  }

  Widget _filterTitle(String label) => Padding(
        padding: EdgeInsets.only(bottom: 8),
        child: Text(label,
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900)),
      );

  Widget _dividerGap() => Padding(
        padding: EdgeInsets.symmetric(vertical: 13),
        child: Divider(height: 1, color: DanColors.border),
      );

  Widget _statusChip(String key, String label) {
    return ChoiceChip(
      label: Text(label),
      selected: _status == key,
      onSelected: (_) {
        setState(() => _status = key);
        _load();
      },
    );
  }

  Widget _radioLine(String label, bool selected, {IconData? trailing}) {
    return Container(
      height: 36,
      margin: EdgeInsets.only(bottom: 5),
      padding: EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.sm),
        color: selected ? DanColors.brandDim : Colors.white,
      ),
      child: Row(
        children: [
          Icon(selected ? Icons.radio_button_checked : Icons.radio_button_off,
              size: 16, color: selected ? DanColors.brand : DanColors.muted),
          SizedBox(width: 8),
          Expanded(child: Text(label, style: TextStyle(fontSize: 12.5))),
          if (trailing != null)
            Icon(trailing, size: 16, color: DanColors.muted),
        ],
      ),
    );
  }

  Widget _rangeFields(TextEditingController from, TextEditingController to,
      {ValueChanged<String>? onChanged}) {
    return Column(
      children: [
        _rangeField(t('Từ'), from, onChanged: onChanged),
        SizedBox(height: 6),
        _rangeField(t('Tới'), to, onChanged: onChanged),
      ],
    );
  }

  Widget _disabledRangeFields() {
    return Column(
      children: [
        _disabledRangeField(t('Từ')),
        SizedBox(height: 6),
        _disabledRangeField(t('Tới')),
      ],
    );
  }

  Widget _rangeField(String label, TextEditingController c,
      {ValueChanged<String>? onChanged}) {
    return SizedBox(
      height: 34,
      child: TextField(
        controller: c,
        keyboardType: TextInputType.number,
        onChanged: onChanged,
        decoration: InputDecoration(
          prefixIcon: SizedBox(
            width: 44,
            child: Center(
              child: Text(label, style: TextStyle(fontWeight: FontWeight.w800)),
            ),
          ),
          hintText: t('Nhập giá trị'),
          isDense: true,
        ),
      ),
    );
  }

  Widget _disabledRangeField(String label) {
    return SizedBox(
      height: 34,
      child: TextField(
        enabled: false,
        decoration: InputDecoration(
          prefixIcon: SizedBox(
            width: 44,
            child: Center(
              child: Text(label, style: TextStyle(fontWeight: FontWeight.w800)),
            ),
          ),
          hintText: t('Nhập giá trị'),
          isDense: true,
        ),
      ),
    );
  }

  Future<void> _showColumnsDialog() async {
    final draft = {..._visibleColumns};
    final next = await showDialog<Set<String>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          backgroundColor: DanColors.surface,
          title: Text(t('Cột hiển thị')),
          content: SizedBox(
            width: dialogWidth(context, 560),
            child: Wrap(
              spacing: 20,
              runSpacing: 4,
              children: [
                for (final col in _customerColumns)
                  SizedBox(
                    width: 240,
                    child: CheckboxListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      value: draft.contains(col.key),
                      title: Text(col.label),
                      onChanged: (v) => setLocal(() {
                        if (v == true) {
                          draft.add(col.key);
                        } else if (draft.length > 3) {
                          draft.remove(col.key);
                        }
                      }),
                    ),
                  ),
              ],
            ),
          ),
          actions: [
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
    if (next != null) {
      setState(() {
        _visibleColumns
          ..clear()
          ..addAll(next);
      });
    }
  }
}

class _LegacyContactsScreen extends StatefulWidget {
  _LegacyContactsScreen();

  @override
  State<_LegacyContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<_LegacyContactsScreen> {
  List<Map<String, dynamic>> _partners = [];
  Map<String, dynamic> _counts = {};
  String _type = 'all';
  String _search = '';
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await context
          .read<ApiService>()
          .getPartners(type: _type, q: _search.trim());
      if (!mounted) return;
      setState(() {
        _partners = (res['partners'] is List)
            ? (res['partners'] as List)
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : [];
        _counts = res['counts'] is Map
            ? Map<String, dynamic>.from(res['counts'])
            : {};
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

  Future<void> _openForm([Map<String, dynamic>? partner]) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) =>
          _PartnerForm(api: context.read<ApiService>(), partner: partner),
    );
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentUser;
    final branch = auth.selectedBranch;

    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: DanModuleTopBar(
        brandName: branch.name.isNotEmpty ? branch.name : branch.id,
        title: t('Liên hệ'),
        subtitle: '',
        titleIcon: Icons.groups_2_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
        actions: [
          DanTopBarButton(
            onPressed: () => _openForm(),
            icon: Icons.person_add_alt,
            label: t('Thêm liên hệ'),
          ),
        ],
      ),
      body: Column(
        children: [
          _filterBar(),
          Divider(height: 1, color: DanColors.border),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _filterBar() {
    return Container(
      color: DanColors.surface,
      padding: EdgeInsets.all(14),
      child: Row(
        children: [
          for (final t in _types) ...[
            ChoiceChip(
              label: Text(
                  t[0] == 'all' ? t[1] : '${t[1]} (${_counts[t[0]] ?? 0})'),
              selected: _type == t[0],
              onSelected: (_) {
                setState(() => _type = t[0]);
                _load();
              },
            ),
            SizedBox(width: 8),
          ],
          SizedBox(width: 4),
          Expanded(
            child: TextField(
              decoration: InputDecoration(
                  hintText: t('Tìm theo tên, SĐT, MST…'),
                  prefixIcon: Icon(Icons.search),
                  isDense: true),
              onChanged: (v) => _search = v,
              onSubmitted: (_) => _load(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading && _partners.isEmpty) {
      return Center(child: CircularProgressIndicator());
    }
    if (_error != null && _partners.isEmpty) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được danh bạ ($_error)'),
            error: true, onRetry: _load),
      );
    }
    if (_partners.isEmpty) {
      return Center(
          child: Text(t('Chưa có liên hệ nào'),
              style: TextStyle(color: DanColors.faint)));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: EdgeInsets.all(16),
        itemCount: _partners.length,
        separatorBuilder: (_, __) => SizedBox(height: 8),
        itemBuilder: (_, i) => _row(_partners[i]),
      ),
    );
  }

  Widget _row(Map<String, dynamic> c) {
    final isCustomer = _b(c['is_customer']);
    final isSupplier = _b(c['is_supplier']);
    final orders = _n(c['total_orders']);
    final spent = _n(c['total_spent']);
    return InkWell(
      onTap: () => _openForm(c),
      borderRadius: BorderRadius.circular(DanRadius.md),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: DanColors.surface,
          border: Border.all(color: DanColors.border),
          borderRadius: BorderRadius.circular(DanRadius.md),
        ),
        child: Row(
          children: [
            _ContactAvatar(
              name: _s(c['name']),
              avatar: _s(c['avatar']),
              baseUrl: context.read<ApiService>().baseUrl,
            ),
            SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(_s(c['name']),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 14.5, fontWeight: FontWeight.w800)),
                      ),
                      if (isCustomer) ...[
                        SizedBox(width: 6),
                        _Tag(t('Khách'), DanColors.brand),
                      ],
                      if (isSupplier) ...[
                        SizedBox(width: 6),
                        _Tag('NCC', Color(0xFFB45309)),
                      ],
                    ],
                  ),
                  SizedBox(height: 2),
                  Text(
                    [
                      if (_s(c['phone']).isNotEmpty) _s(c['phone']),
                      if (_s(c['company']).isNotEmpty) _s(c['company']),
                    ].join('  ·  '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12, color: DanColors.faint),
                  ),
                ],
              ),
            ),
            if (isCustomer && orders > 0)
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(t('${Fmt.int0(orders)} đơn'),
                      style:
                          TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                  Text(Fmt.money(spent),
                      style: TextStyle(
                          fontSize: 12,
                          color: DanColors.brand,
                          fontWeight: FontWeight.w800)),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  final String label;
  final Color color;
  _Tag(this.label, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
          color: color.withValues(alpha: .13),
          borderRadius: BorderRadius.circular(5)),
      child: Text(label,
          style: TextStyle(
              fontSize: 10.5, fontWeight: FontWeight.w800, color: color)),
    );
  }
}

class _ContactAvatar extends StatelessWidget {
  final String name;
  final String avatar;
  final String baseUrl;
  final double radius;

  _ContactAvatar({
    required this.name,
    required this.avatar,
    required this.baseUrl,
    this.radius = 20,
  });

  @override
  Widget build(BuildContext context) {
    final fallback = CircleAvatar(
      radius: radius,
      backgroundColor: DanColors.brandDim,
      child: Text(
        (name.isNotEmpty ? name[0] : '?').toUpperCase(),
        style: TextStyle(
          color: DanColors.brand,
          fontWeight: FontWeight.w900,
          fontSize: radius * .72,
        ),
      ),
    );
    if (avatar.trim().isEmpty) return fallback;

    return ClipOval(
      child: Image.network(
        _assetUrl(baseUrl, avatar),
        width: radius * 2,
        height: radius * 2,
        fit: BoxFit.cover,
        // Avatar-size decode: contact lists can be long.
        cacheWidth: (radius * 4).round(),
        filterQuality: FilterQuality.low,
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) => fallback,
      ),
    );
  }
}

class _PartnerForm extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic>? partner;
  final bool canDelete;
  _PartnerForm({required this.api, this.partner, this.canDelete = false});

  @override
  State<_PartnerForm> createState() => _PartnerFormState();
}

class _PartnerFormState extends State<_PartnerForm> {
  late final TextEditingController _code;
  late final TextEditingController _name;
  late final TextEditingController _company;
  late final TextEditingController _phone;
  late final TextEditingController _email;
  late final TextEditingController _tax;
  late final TextEditingController _contact;
  late final TextEditingController _address;
  late final TextEditingController _addressDetail;
  late final TextEditingController _addressWard;
  late final TextEditingController _addressProvince;
  late final TextEditingController _wardCode;
  late final TextEditingController _provinceCode;
  late final TextEditingController _perkValue;
  late final TextEditingController _note;
  late String _avatar;
  late String _partnerType;
  late String _perkType;
  late bool _active;
  late bool _autoInvoice;
  bool _uploadingAvatar = false;
  bool _saving = false;
  bool _searchingTaxCode = false;
  String? _taxHint;
  // Truy xuất Cục Thuế theo MST; công ty + địa chỉ truy xuất được sẽ khóa —
  // xóa MST để nhập/kiểm tra lại.
  late final TaxLookupController _taxLookup;

  bool get _isEdit => widget.partner != null;

  @override
  void initState() {
    super.initState();
    final c = widget.partner;
    _code = TextEditingController(text: _s(c?['code']));
    _name = TextEditingController(text: _s(c?['name']));
    _company = TextEditingController(text: _s(c?['company']));
    _phone = TextEditingController(text: _s(c?['phone']));
    _email = TextEditingController(text: _s(c?['email']));
    _tax = TextEditingController(text: _s(c?['tax_code']));
    _contact = TextEditingController(text: _s(c?['contact_person']));
    _address = TextEditingController(text: _s(c?['address']));
    _addressDetail = TextEditingController(text: _s(c?['address_detail']));
    _addressWard = TextEditingController(text: _s(c?['address_ward']));
    _addressProvince = TextEditingController(text: _s(c?['address_province']));
    _wardCode = TextEditingController(text: _s(c?['ward_code']));
    _provinceCode = TextEditingController(text: _s(c?['province_code']));
    _perkValue = TextEditingController(
        text: _n(c?['perk_value']) > 0
            ? _n(c?['perk_value']).round().toString()
            : '');
    _note = TextEditingController(text: _s(c?['note']));
    _avatar = _s(c?['avatar']);
    _partnerType =
        _s(c?['partner_type']).isNotEmpty ? _s(c?['partner_type']) : 'customer';
    final rawPerk =
        _s(c?['perk_type']) == 'percent' ? 'pct' : _s(c?['perk_type']);
    _perkType =
        {'none', 'pct', 'amount', 'free'}.contains(rawPerk) ? rawPerk : 'none';
    _active = c == null ? true : _b(c['active']);
    _autoInvoice = c == null ? false : _b(c['auto_invoice']);
    _taxLookup = TaxLookupController(
      api: widget.api,
      mst: _tax,
      company: _company,
      address: _address,
    );
    _taxLookup.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _taxLookup.dispose();
    for (final c in [
      _code,
      _name,
      _company,
      _phone,
      _email,
      _tax,
      _contact,
      _address,
      _addressDetail,
      _addressWard,
      _addressProvince,
      _wardCode,
      _provinceCode,
      _perkValue,
      _note,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Cần nhập tên liên hệ')),
          backgroundColor: DanColors.late));
      return;
    }
    final body = <String, dynamic>{
      if (_isEdit) 'id': widget.partner!['id'],
      'code': _code.text.trim(),
      'partner_type': _partnerType,
      'name': _name.text.trim(),
      'avatar': _avatar,
      'company': _company.text.trim(),
      'phone': _phone.text.trim(),
      'email': _email.text.trim(),
      'tax_code': _tax.text.trim(),
      'contact_person': (_partnerType == 'supplier' || _partnerType == 'both')
          ? _contact.text.trim()
          : '',
      'address': _address.text.trim(),
      'address_detail': _addressDetail.text.trim(),
      'address_ward': _addressWard.text.trim(),
      'address_province': _addressProvince.text.trim(),
      'ward_code': _wardCode.text.trim(),
      'province_code': _provinceCode.text.trim(),
      'perk_type': (_partnerType == 'customer' ||
              _partnerType == 'both' ||
              _partnerType == 'staff')
          ? _perkType
          : 'none',
      'perk_value': (_partnerType == 'customer' ||
              _partnerType == 'both' ||
              _partnerType == 'staff')
          ? (int.tryParse(_perkValue.text.trim()) ?? 0)
          : 0,
      'note': _note.text.trim(),
      'active': _active ? 1 : 0,
      'auto_invoice': (_partnerType == 'customer' || _partnerType == 'both')
          ? (_autoInvoice ? 1 : 0)
          : 0,
    };
    setState(() => _saving = true);
    try {
      await widget.api.upsertPartner(body);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: DanColors.late));
      }
    }
  }

  Future<void> _lookupTax() async {
    setState(() {
      _searchingTaxCode = true;
      _taxHint = null;
    });
    // Controller dùng chung: điền + KHÓA công ty/địa chỉ; xóa MST để mở khóa.
    final err = await _taxLookup.lookup();
    if (!mounted) return;
    setState(() {
      _searchingTaxCode = false;
      if (err != null) {
        _taxHint = err;
      } else {
        final res = _taxLookup.lastResult ?? {};
        // Tên liên hệ (người) vẫn nhập tay — chỉ gợi ý khi đang trống.
        if (_name.text.isEmpty && _s(res['name']).isNotEmpty) {
          _name.text = _s(res['name']);
        }
        _taxHint =
            '✓ ${_company.text}${_address.text.isNotEmpty ? ' · ${_address.text}' : ''}';
      }
    });
  }

  Future<void> _pickAvatar() async {
    final path = await _pickImagePath();
    if (path == null || path.isEmpty) return;

    final file = File(path);
    final length = await file.length();
    if (length > 20 * 1024 * 1024) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Ảnh tối đa 20MB')),
          backgroundColor: DanColors.late));
      return;
    }

    setState(() => _uploadingAvatar = true);
    try {
      final bytes = await file.readAsBytes();
      final name = path.split(RegExp(r'[\\/]')).last;
      final res = await widget.api.uploadPartnerAvatar(
        originalName: name,
        mimeType: _mimeForFileName(name),
        data: base64Encode(bytes),
      );
      if (!mounted) return;
      setState(() {
        _avatar = _s(res['url']);
        _uploadingAvatar = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploadingAvatar = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late));
    }
  }

  // Helper chung: tablet/điện thoại mở thư viện ảnh (image_picker), desktop
  // mở hộp thoại hệ điều hành — bản cũ chỉ có PowerShell nên trên Android
  // bấm nút không có phản ứng gì.
  Future<String?> _pickImagePath() =>
      pickImagePathCross(title: 'Chọn ảnh đại diện');

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(t('Xóa liên hệ')),
        content: Text('${t('Xóa')} "${_name.text.trim()}"?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(t('Hủy'))),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: FilledButton.styleFrom(backgroundColor: DanColors.late),
            child: Text(t('Xóa')),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.api.deletePartner('${widget.partner!['id']}');
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: DanColors.late));
      }
    }
  }

  Widget _typeSelector() {
    final options = [
      ('customer', Icons.shopping_bag_outlined, t('Khách hàng')),
      ('supplier', Icons.storefront_outlined, t('Nhà cung cấp')),
      ('both', Icons.people_outline, t('Cả hai')),
      ('staff', Icons.badge_outlined, t('Nhân viên')),
    ];
    return Row(
      children: [
        for (var i = 0; i < options.length; i++) ...[
          Expanded(
            child: InkWell(
              onTap: () {
                setState(() {
                  _partnerType = options[i].$1;
                });
              },
              borderRadius: BorderRadius.circular(DanRadius.md),
              child: Container(
                padding: EdgeInsets.symmetric(vertical: 8),
                decoration: BoxDecoration(
                  color: _partnerType == options[i].$1
                      ? DanColors.brand.withValues(alpha: 0.08)
                      : Colors.transparent,
                  border: Border.all(
                    color: _partnerType == options[i].$1
                        ? DanColors.brand
                        : DanColors.border,
                    width: _partnerType == options[i].$1 ? 1.5 : 1,
                  ),
                  borderRadius: BorderRadius.circular(DanRadius.md),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      options[i].$2,
                      size: 16,
                      color: _partnerType == options[i].$1
                          ? DanColors.brand
                          : DanColors.text,
                    ),
                    SizedBox(width: 5),
                    Text(
                      options[i].$3,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: _partnerType == options[i].$1
                            ? FontWeight.bold
                            : FontWeight.normal,
                        color: _partnerType == options[i].$1
                            ? DanColors.brand
                            : DanColors.text,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (i < options.length - 1) SizedBox(width: 8),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: DanColors.surface,
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 580, maxHeight: 720),
        child: Scaffold(
          backgroundColor: DanColors.surface,
          body: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: EdgeInsets.fromLTRB(20, 18, 12, 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_isEdit ? t('Sửa liên hệ') : t('Thêm liên hệ'),
                              style: TextStyle(
                                  fontSize: 19, fontWeight: FontWeight.w900)),
                          SizedBox(height: 3),
                          Text(t('Khách hàng, nhà cung cấp hoặc nhân viên'),
                              style: TextStyle(
                                  fontSize: 12.5, color: DanColors.muted)),
                        ],
                      ),
                    ),
                    IconButton(
                        onPressed: () => Navigator.of(context).pop(),
                        icon: Icon(Icons.close)),
                  ],
                ),
              ),
              Divider(height: 1, color: DanColors.border),
              Flexible(
                child: ListView(
                  padding: EdgeInsets.all(20),
                  children: [
                    Text(t('LOẠI LIÊN HỆ'),
                        style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: DanColors.text)),
                    SizedBox(height: 6),
                    _typeSelector(),
                    SizedBox(height: 14),
                    _avatarEditor(),
                    _field(t('MÃ KH'), _code,
                        hint: t('Để trống tự sinh DC000001')),
                    SizedBox(height: 8),
                    _field(
                      t('TÊN *'),
                      _name,
                      hint: _partnerType == 'staff'
                          ? t('Tên nhân viên')
                          : t('Tên khách / tên nhà cung cấp'),
                    ),
                    _field(t('CÔNG TY'), _company,
                        hint: t('Tên công ty (nếu có)'),
                        locked: _taxLookup.companyLocked),
                    Row(
                      children: [
                        Expanded(
                          child: _field(t('SỐ ĐIỆN THOẠI'), _phone,
                              hint: '09xx xxx xxx'),
                        ),
                        SizedBox(width: 12),
                        Expanded(
                          child: _field('EMAIL', _email, hint: 'email@vd.com'),
                        ),
                      ],
                    ),
                    _field(
                      t('MÃ SỐ THUẾ'),
                      _tax,
                      hint: t('10 hoặc 13 chữ số'),
                      suffix: Padding(
                        padding: EdgeInsets.only(right: 6),
                        child: TextButton(
                          onPressed: _searchingTaxCode ? null : _lookupTax,
                          style: TextButton.styleFrom(
                            padding: EdgeInsets.symmetric(horizontal: 12),
                            minimumSize: Size.zero,
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            side: BorderSide(color: DanColors.border),
                            shape: RoundedRectangleBorder(
                                borderRadius:
                                    BorderRadius.circular(DanRadius.sm)),
                          ),
                          child: _searchingTaxCode
                              ? SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: DanColors.brand))
                              : Text(
                                  t('Tra cứu'),
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                    color: DanColors.text,
                                  ),
                                ),
                        ),
                      ),
                    ),
                    if (_taxHint != null)
                      Padding(
                        padding: EdgeInsets.only(bottom: 8),
                        child: Text(
                          _taxHint!,
                          style: TextStyle(
                            fontSize: 12,
                            color: _taxHint!.startsWith('✓')
                                ? DanColors.done
                                : DanColors.late,
                          ),
                        ),
                      ),
                    if (_partnerType == 'supplier' || _partnerType == 'both')
                      _field(t('NGƯỜI LIÊN HỆ'), _contact,
                          hint: t('Tên người phụ trách bên NCC')),
                    AddressFields(
                      address: _address,
                      detail: _addressDetail,
                      ward: _addressWard,
                      province: _addressProvince,
                      wardCode: _wardCode,
                      provinceCode: _provinceCode,
                      label: t('Địa chỉ giao / nhận hàng'),
                      locked: _taxLookup.addressLocked,
                    ),
                    if (_partnerType == 'customer' ||
                        _partnerType == 'both' ||
                        _partnerType == 'staff') ...[
                      Row(
                        children: [
                          Expanded(
                            child: Padding(
                              padding: EdgeInsets.symmetric(vertical: 7),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _partnerType == 'staff'
                                        ? t('ƯU ĐÃI MẶC ĐỊNH CHO NHÂN VIÊN')
                                        : t('ƯU ĐÃI MẶC ĐỊNH CHO KHÁCH'),
                                    style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w700,
                                        color: DanColors.text),
                                  ),
                                  SizedBox(height: 5),
                                  DropdownButtonFormField<String>(
                                    initialValue: _perkType,
                                    decoration: InputDecoration(isDense: true),
                                    items: [
                                      DropdownMenuItem(
                                          value: 'none',
                                          child: Text(t('Không ưu đãi'))),
                                      DropdownMenuItem(
                                          value: 'pct',
                                          child: Text(t('Giảm theo %'))),
                                      DropdownMenuItem(
                                          value: 'amount',
                                          child: Text(t('Giảm số tiền'))),
                                      DropdownMenuItem(
                                          value: 'free',
                                          child: Text(t('Miễn phí'))),
                                    ],
                                    onChanged: (v) =>
                                        setState(() => _perkType = v ?? 'none'),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          SizedBox(width: 12),
                          Expanded(
                            child: _field(t('Giá trị'), _perkValue,
                                number: true, hint: t('Giá trị')),
                          ),
                        ],
                      ),
                    ],
                    _field(t('GHI CHÚ'), _note,
                        lines: 2, hint: t('Ghi chú nội bộ')),
                    SizedBox(height: 12),
                    Row(
                      children: [
                        Checkbox(
                          value: _active,
                          onChanged: (v) =>
                              setState(() => _active = v ?? false),
                        ),
                        Expanded(
                          child: RichText(
                            text: TextSpan(
                              style: TextStyle(
                                fontFamily: 'Be Vietnam Pro',
                                fontSize: 13,
                                color: DanColors.text,
                              ),
                              children: [
                                TextSpan(
                                    text: t('Active — đang hoạt động'),
                                    style:
                                        TextStyle(fontWeight: FontWeight.bold)),
                                TextSpan(
                                    text: t(
                                        ' (bỏ chọn = Inactive, lưu trữ — không xóa)'),
                                    style: TextStyle(color: DanColors.muted)),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (_partnerType == 'customer' ||
                        _partnerType == 'both') ...[
                      SizedBox(height: 8),
                      Row(
                        children: [
                          Checkbox(
                            value: _autoInvoice,
                            onChanged: (v) =>
                                setState(() => _autoInvoice = v ?? false),
                          ),
                          Expanded(
                            child: Text(
                              t('Tự động chọn xuất hóa đơn VAT khi thanh toán'),
                              style: TextStyle(
                                fontFamily: 'Be Vietnam Pro',
                                fontSize: 13,
                                color: DanColors.text,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              Divider(height: 1, color: DanColors.border),
              Padding(
                padding: EdgeInsets.all(14),
                child: Row(
                  children: [
                    if (_isEdit && widget.canDelete)
                      TextButton.icon(
                        onPressed: _delete,
                        icon: Icon(Icons.delete_outline, size: 18),
                        label: Text(t('Xóa')),
                        style: TextButton.styleFrom(
                            foregroundColor: DanColors.late),
                      ),
                    Spacer(),
                    TextButton(
                        onPressed: () => Navigator.of(context).pop(),
                        child: Text(t('Hủy'))),
                    SizedBox(width: 8),
                    FilledButton(
                      onPressed: _saving ? null : _save,
                      child: _saving
                          ? SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white))
                          : Text(_isEdit ? t('Lưu') : t('Tạo')),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _field(String label, TextEditingController c,
      {bool number = false,
      int lines = 1,
      String? hint,
      Widget? suffix,
      bool locked = false}) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 7),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(label.replaceAll('*', '').trim(),
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: DanColors.text)),
              if (label.contains('*'))
                Text(' *',
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: DanColors.late)),
            ],
          ),
          SizedBox(height: 5),
          TextField(
            controller: c,
            maxLines: lines,
            readOnly: locked,
            keyboardType: number ? TextInputType.number : null,
            decoration: InputDecoration(
              isDense: true,
              hintText: hint,
              // Field khóa (dữ liệu tự truy xuất): chỉ tối nền, KHÔNG icon khóa.
              filled: locked,
              fillColor: locked ? DanColors.surface3 : null,
              suffixIcon: locked ? null : suffix,
              suffixIconConstraints: BoxConstraints(minHeight: 0, minWidth: 0),
            ),
          ),
        ],
      ),
    );
  }

  Widget _avatarEditor() {
    return Container(
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Row(
        children: [
          _ContactAvatar(
            name: _name.text.trim(),
            avatar: _avatar,
            baseUrl: widget.api.baseUrl,
            radius: 28,
          ),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t('Ảnh đại diện'),
                    style:
                        TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
                SizedBox(height: 3),
                Text(
                  _avatar.isEmpty
                      ? t('Chưa có ảnh')
                      : t('Đã chọn ảnh đại diện'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 12, color: DanColors.faint),
                ),
              ],
            ),
          ),
          TextButton.icon(
            onPressed: _uploadingAvatar ? null : _pickAvatar,
            icon: _uploadingAvatar
                ? SizedBox(
                    width: 15,
                    height: 15,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(Icons.photo_camera_outlined, size: 17),
            label: Text(_uploadingAvatar ? t('Đang tải') : t('Chọn ảnh')),
          ),
          if (_avatar.isNotEmpty)
            IconButton(
              tooltip: t('Xóa ảnh'),
              onPressed:
                  _uploadingAvatar ? null : () => setState(() => _avatar = ''),
              icon: Icon(Icons.close, size: 18),
            ),
        ],
      ),
    );
  }
}
