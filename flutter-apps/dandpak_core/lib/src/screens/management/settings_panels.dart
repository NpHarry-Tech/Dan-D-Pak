import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../widgets/address_fields.dart';
import '../../widgets/side_sheet.dart';
import 'settings_tab.dart';
import '../../utils/translation.dart';

String _s(dynamic v) => v?.toString() ?? '';
bool _b(dynamic v) => v == true || v == 1 || v == '1';

final _roles = ['owner', 'manager', 'cashier', 'kitchen', 'warehouse'];

// ── Users & permissions ──────────────────────────────────────────────────

class UsersPanel extends StatefulWidget {
  final ApiService api;
  UsersPanel({super.key, required this.api});

  @override
  State<UsersPanel> createState() => _UsersPanelState();
}

class _UsersPanelState extends State<UsersPanel> {
  List<Map<String, dynamic>> _users = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await widget.api.getSettingsUsers();
      if (!mounted) return;
      setState(() {
        _users = rows
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

  void _toast(String m, {bool error = false}) =>
      appToast(context, m, isError: error);

  Future<void> _openForm([Map<String, dynamic>? user]) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (_) => _UserFormDialog(api: widget.api, user: user),
    );
    if (result == true) _load();
  }

  Future<void> _delete(Map<String, dynamic> user) async {
    final pin =
        await settingsPin(context, 'Xóa nhân viên "${_s(user['name'])}".');
    if (pin == null) return;
    try {
      await widget.api.deleteSettingsUser(_s(user['id']), pin);
      _toast(t('Đã xóa nhân viên'));
      _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: t('Nhân sự & Phân quyền'),
      addLabel: t('Thêm nhân viên'),
      onAdd: () => _openForm(),
      onRefresh: _load,
      child: settingsState(
        loading: _loading && _users.isEmpty,
        error: _users.isEmpty ? _error : null,
        onRetry: _load,
        child: ListView.separated(
          padding: EdgeInsets.all(16),
          itemCount: _users.length,
          separatorBuilder: (_, __) => SizedBox(height: 8),
          itemBuilder: (_, i) {
            final u = _users[i];
            final active = _b(u['active']);
            return Container(
              padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: DanColors.surface,
                border: Border.all(color: DanColors.border),
                borderRadius: BorderRadius.circular(DanRadius.md),
              ),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 18,
                    backgroundColor: DanColors.brandDim,
                    child: Text(
                      (_s(u['name']).isNotEmpty ? _s(u['name'])[0] : '?')
                          .toUpperCase(),
                      style: TextStyle(
                          color: DanColors.brand, fontWeight: FontWeight.w900),
                    ),
                  ),
                  SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(_s(u['name']),
                            style: TextStyle(
                                fontSize: 14, fontWeight: FontWeight.w800)),
                        Text('@${_s(u['username'])}',
                            style: TextStyle(
                                fontSize: 11.5, color: DanColors.faint)),
                      ],
                    ),
                  ),
                  _Pill(settingsRoleLabel(_s(u['role'])), DanColors.brand),
                  SizedBox(width: 8),
                  _Pill(active ? t('Hoạt động') : t('Đã khóa'),
                      active ? DanColors.done : DanColors.muted),
                  SizedBox(width: 6),
                  TextButton(
                      onPressed: () => _openForm(u), child: Text(t('Sửa'))),
                  if (_s(u['role']) != 'owner')
                    TextButton(
                      onPressed: () => _delete(u),
                      style:
                          TextButton.styleFrom(foregroundColor: DanColors.late),
                      child: Text(t('Xóa')),
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _UserFormDialog extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic>? user;
  _UserFormDialog({required this.api, this.user});

  @override
  State<_UserFormDialog> createState() => _UserFormDialogState();
}

class _UserFormDialogState extends State<_UserFormDialog> {
  late final TextEditingController _name;
  late final TextEditingController _username;
  late final TextEditingController _pin;
  late String _role;
  late bool _active;
  bool _saving = false;

  bool get _isEdit => widget.user != null;

  @override
  void initState() {
    super.initState();
    final u = widget.user;
    _name = TextEditingController(text: _s(u?['name']));
    _username = TextEditingController(text: _s(u?['username']));
    _pin = TextEditingController();
    final rawRole = _s(u?['role']);
    _role = _roles.contains(rawRole) ? rawRole : 'cashier';
    _active = u == null ? true : _b(u['active']);
  }

  @override
  void dispose() {
    _name.dispose();
    _username.dispose();
    _pin.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty || _username.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Cần nhập tên và tên đăng nhập')),
          backgroundColor: DanColors.late));
      return;
    }
    final pinText = _pin.text.trim();
    if (!_isEdit && !RegExp(r'^\d{4}$').hasMatch(pinText)) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Mã PIN phải đúng 4 chữ số')),
          backgroundColor: DanColors.late));
      return;
    }
    final approval = await settingsPin(
        context,
        _isEdit
            ? t('Cập nhật nhân viên "${_name.text.trim()}".')
            : t('Tạo tài khoản "${_name.text.trim()}".'));
    if (approval == null) return;

    final body = <String, dynamic>{
      'name': _name.text.trim(),
      'username': _username.text.trim(),
      'role': _role,
      'active': _active,
      if (pinText.isNotEmpty) 'pin': pinText,
      'security_pin': approval,
    };

    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await widget.api.updateSettingsUser(_s(widget.user!['id']), body);
      } else {
        await widget.api.createSettingsUser(body);
      }
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

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: DanColors.surface,
      title: Text(_isEdit ? t('Sửa nhân viên') : t('Thêm nhân viên'),
          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
      content: SizedBox(
        width: 380,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
                controller: _name,
                decoration: InputDecoration(labelText: t('Họ tên'))),
            SizedBox(height: 12),
            TextField(
                controller: _username,
                enabled: !_isEdit,
                decoration: InputDecoration(labelText: t('Tên đăng nhập'))),
            SizedBox(height: 12),
            TextField(
              controller: _pin,
              keyboardType: TextInputType.number,
              obscureText: true,
              decoration: InputDecoration(
                  labelText: _isEdit
                      ? t('PIN mới (để trống nếu giữ nguyên)')
                      : t('PIN (4 số)')),
            ),
            SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _role,
              decoration: InputDecoration(labelText: t('Vai trò')),
              items: [
                for (final r in _roles)
                  DropdownMenuItem(value: r, child: Text(settingsRoleLabel(r))),
              ],
              onChanged: (v) => setState(() => _role = v ?? _role),
            ),
            SizedBox(height: 4),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _active,
              activeThumbColor: DanColors.done,
              title: Text(t('Cho phép đăng nhập'),
                  style:
                      TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
              onChanged: (v) => setState(() => _active = v),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(t('Hủy'))),
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
    );
  }
}

// ── Branches ─────────────────────────────────────────────────────────────

class BranchesPanel extends StatefulWidget {
  final ApiService api;
  BranchesPanel({super.key, required this.api});

  @override
  State<BranchesPanel> createState() => _BranchesPanelState();
}

class _BranchesPanelState extends State<BranchesPanel> {
  List<Map<String, dynamic>> _branches = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await widget.api.getSettingsBranches();
      if (!mounted) return;
      setState(() {
        _branches = rows
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

  Future<void> _openForm([Map<String, dynamic>? branch]) async {
    final result = await showSideSheet<bool>(
      context,
      builder: (_) => _BranchFormDialog(api: widget.api, branch: branch),
    );
    if (result == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: t('Chi nhánh'),
      addLabel: t('Thêm chi nhánh'),
      onAdd: () => _openForm(),
      onRefresh: _load,
      child: settingsState(
        loading: _loading && _branches.isEmpty,
        error: _branches.isEmpty ? _error : null,
        onRetry: _load,
        child: ListView.separated(
          padding: EdgeInsets.all(16),
          itemCount: _branches.length,
          separatorBuilder: (_, __) => SizedBox(height: 8),
          itemBuilder: (_, i) {
            final b = _branches[i];
            return Container(
              padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: DanColors.surface,
                border: Border.all(color: DanColors.border),
                borderRadius: BorderRadius.circular(DanRadius.md),
              ),
              child: Row(
                children: [
                  Icon(Icons.store_mall_directory_outlined,
                      color: DanColors.muted),
                  SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${_s(b['name'])}  ·  ${_s(b['code'])}',
                            style: TextStyle(
                                fontSize: 14, fontWeight: FontWeight.w800)),
                        if (_s(b['address']).isNotEmpty)
                          Text(_s(b['address']),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  fontSize: 11.5, color: DanColors.faint)),
                      ],
                    ),
                  ),
                  _Pill(_b(b['active']) ? t('Đang mở') : t('Đã đóng'),
                      _b(b['active']) ? DanColors.done : DanColors.muted),
                  TextButton(
                      onPressed: () => _openForm(b), child: Text(t('Sửa'))),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _BranchFormDialog extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic>? branch;
  _BranchFormDialog({required this.api, this.branch});

  @override
  State<_BranchFormDialog> createState() => _BranchFormDialogState();
}

class _BranchFormDialogState extends State<_BranchFormDialog> {
  late final TextEditingController _name;
  late final TextEditingController _code;
  late final TextEditingController _address;
  late final TextEditingController _addressDetail;
  late final TextEditingController _addressWard;
  late final TextEditingController _addressProvince;
  late final TextEditingController _wardCode;
  late final TextEditingController _provinceCode;
  late bool _active;
  bool _saving = false;

  bool get _isEdit => widget.branch != null;

  @override
  void initState() {
    super.initState();
    final b = widget.branch;
    _name = TextEditingController(text: _s(b?['name']));
    _code = TextEditingController(text: _s(b?['code']));
    _address = TextEditingController(text: _s(b?['address']));
    _addressDetail = TextEditingController(text: _s(b?['address_detail']));
    _addressWard = TextEditingController(text: _s(b?['address_ward']));
    _addressProvince = TextEditingController(text: _s(b?['address_province']));
    _wardCode = TextEditingController(text: _s(b?['ward_code']));
    _provinceCode = TextEditingController(text: _s(b?['province_code']));
    _active = b == null ? true : _b(b['active']);
  }

  @override
  void dispose() {
    _name.dispose();
    _code.dispose();
    _address.dispose();
    _addressDetail.dispose();
    _addressWard.dispose();
    _addressProvince.dispose();
    _wardCode.dispose();
    _provinceCode.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Cần nhập tên chi nhánh')),
          backgroundColor: DanColors.late));
      return;
    }
    final body = {
      'name': _name.text.trim(),
      'code': _code.text.trim(),
      'address': _address.text.trim(),
      'address_detail': _addressDetail.text.trim(),
      'address_ward': _addressWard.text.trim(),
      'address_province': _addressProvince.text.trim(),
      'ward_code': _wardCode.text.trim(),
      'province_code': _provinceCode.text.trim(),
      'active': _active,
    };
    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await widget.api.updateBranch(_s(widget.branch!['id']), body);
      } else {
        await widget.api.createBranch(body);
      }
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

  @override
  Widget build(BuildContext context) {
    return SideSheetScaffold(
      title: _isEdit ? t('Sửa chi nhánh') : t('Thêm chi nhánh'),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(t('Hủy'))),
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
              controller: _name,
              decoration: InputDecoration(labelText: t('Tên chi nhánh'))),
          SizedBox(height: 12),
          TextField(
              controller: _code,
              decoration: InputDecoration(labelText: t('Mã chi nhánh'))),
          SizedBox(height: 12),
          AddressFields(
            address: _address,
            detail: _addressDetail,
            ward: _addressWard,
            province: _addressProvince,
            wardCode: _wardCode,
            provinceCode: _provinceCode,
          ),
          SizedBox(height: 4),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _active,
            activeThumbColor: DanColors.done,
            title: Text(t('Đang hoạt động'),
                style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
            onChanged: (v) => setState(() => _active = v),
          ),
        ],
      ),
    );
  }
}

// ── Tables ───────────────────────────────────────────────────────────────

class TablesPanel extends StatefulWidget {
  final ApiService api;
  TablesPanel({super.key, required this.api});

  @override
  State<TablesPanel> createState() => _TablesPanelState();
}

class _TablesPanelState extends State<TablesPanel> {
  List<Map<String, dynamic>> _tables = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await widget.api.getTables();
      if (!mounted) return;
      setState(() {
        _tables = rows
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

  void _toast(String m, {bool error = false}) =>
      appToast(context, m, isError: error);

  Future<void> _openForm([Map<String, dynamic>? table]) async {
    final result = await showSideSheet<bool>(
      context,
      builder: (_) => _TableFormDialog(api: widget.api, table: table),
    );
    if (result == true) _load();
  }

  Future<void> _delete(Map<String, dynamic> table) async {
    final pin = await settingsPin(context, 'Xóa bàn "${_s(table['code'])}".');
    if (pin == null) return;
    try {
      await widget.api.deleteTable(_s(table['id']), pin);
      _toast(t('Đã xóa bàn'));
      _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final zones = <String, List<Map<String, dynamic>>>{};
    for (final table in _tables) {
      zones
          .putIfAbsent(
              _s(table['zone']).isEmpty ? t('Khác') : _s(table['zone']),
              () => [])
          .add(table);
    }

    return SettingsPanelScaffold(
      title: t('Cấu hình bàn & Sơ đồ'),
      addLabel: t('Thêm bàn'),
      onAdd: () => _openForm(),
      onRefresh: _load,
      child: settingsState(
        loading: _loading && _tables.isEmpty,
        error: _tables.isEmpty ? _error : null,
        onRetry: _load,
        child: ListView(
          padding: EdgeInsets.all(16),
          children: [
            for (final entry in zones.entries) ...[
              Padding(
                padding: EdgeInsets.only(top: 6, bottom: 10),
                child: Text(entry.key.toUpperCase(),
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w900,
                        color: DanColors.muted,
                        letterSpacing: .3)),
              ),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (final t in entry.value)
                    _TableCard(
                      table: t,
                      onEdit: () => _openForm(t),
                      onDelete: () => _delete(t),
                    ),
                ],
              ),
              SizedBox(height: 18),
            ],
          ],
        ),
      ),
    );
  }
}

class _TableCard extends StatelessWidget {
  final Map<String, dynamic> table;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  _TableCard(
      {required this.table, required this.onEdit, required this.onDelete});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 150,
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.table_restaurant, size: 18, color: DanColors.brand),
              SizedBox(width: 6),
              Expanded(
                child: Text('Bàn ${_s(table['code'])}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style:
                        TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
              ),
            ],
          ),
          SizedBox(height: 4),
          Text('${_s(table['seats'])} chỗ',
              style: TextStyle(fontSize: 12, color: DanColors.faint)),
          SizedBox(height: 6),
          Row(
            children: [
              TextButton(
                onPressed: onEdit,
                style: TextButton.styleFrom(
                    padding: EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: Size(0, 30)),
                child: Text(t('Sửa'), style: TextStyle(fontSize: 12)),
              ),
              TextButton(
                onPressed: onDelete,
                style: TextButton.styleFrom(
                    foregroundColor: DanColors.late,
                    padding: EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: Size(0, 30)),
                child: Text(t('Xóa'), style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TableFormDialog extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic>? table;
  _TableFormDialog({required this.api, this.table});

  @override
  State<_TableFormDialog> createState() => _TableFormDialogState();
}

class _TableFormDialogState extends State<_TableFormDialog> {
  late final TextEditingController _zone;
  late final TextEditingController _code;
  late final TextEditingController _seats;
  bool _saving = false;

  bool get _isEdit => widget.table != null;

  @override
  void initState() {
    super.initState();
    final t = widget.table;
    _zone = TextEditingController(text: _s(t?['zone']));
    _code = TextEditingController(text: _s(t?['code']));
    _seats = TextEditingController(text: t != null ? _s(t['seats']) : '4');
    for (final c in [_zone, _code, _seats]) {
      c.addListener(() {
        if (mounted) setState(() {});
      });
    }
  }

  @override
  void dispose() {
    _zone.dispose();
    _code.dispose();
    _seats.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_zone.text.trim().isEmpty || _code.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(t('Cần nhập khu vực và số bàn')),
          backgroundColor: DanColors.late));
      return;
    }
    final pin = await settingsPin(
        context,
        _isEdit
            ? t('Cập nhật bàn "${_code.text.trim()}".')
            : t('Tạo bàn "${_code.text.trim()}".'));
    if (pin == null) return;

    final body = {
      'zone': _zone.text.trim(),
      'code': _code.text.trim(),
      'seats': int.tryParse(_seats.text.trim()) ?? 4,
      'security_pin': pin,
    };
    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await widget.api.updateTable(_s(widget.table!['id']), body);
      } else {
        await widget.api.createTable(body);
      }
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

  @override
  Widget build(BuildContext context) {
    return SideSheetScaffold(
      title: _isEdit ? t('Sửa bàn') : t('Thêm bàn'),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(t('Hủy'))),
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(t('XEM TRƯỚC TRÊN SƠ ĐỒ BÀN'),
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .4,
                  color: DanColors.faint)),
          SizedBox(height: 10),
          Center(child: _tablePreview()),
          SizedBox(height: 20),
          TextField(
              controller: _zone,
              decoration: InputDecoration(
                  labelText: t('Khu vực'),
                  hintText: t('VD: Tầng 1, Sân vườn'))),
          SizedBox(height: 12),
          TextField(
              controller: _code,
              decoration: InputDecoration(labelText: t('Số bàn / Mã bàn'))),
          SizedBox(height: 12),
          TextField(
              controller: _seats,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: t('Số chỗ ngồi'))),
        ],
      ),
    );
  }

  Widget _tablePreview() {
    final code = _code.text.trim().isEmpty ? '—' : _code.text.trim();
    final seats = _seats.text.trim().isEmpty ? '0' : _seats.text.trim();
    final zone = _zone.text.trim();
    return Container(
      width: 180,
      padding: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.done, width: 1.5),
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
              color: Color(0x0F102840), blurRadius: 8, offset: Offset(0, 3)),
        ],
      ),
      child: Column(
        children: [
          Icon(Icons.table_restaurant, size: 34, color: DanColors.brand),
          SizedBox(height: 8),
          Text(t('Bàn $code'),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
          SizedBox(height: 2),
          Text(t('$seats chỗ'),
              style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
          if (zone.isNotEmpty) ...[
            SizedBox(height: 8),
            Container(
              padding: EdgeInsets.symmetric(horizontal: 9, vertical: 3),
              decoration: BoxDecoration(
                  color: DanColors.surface2,
                  borderRadius: BorderRadius.circular(6)),
              child: Text(zone,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: DanColors.muted)),
            ),
          ],
          SizedBox(height: 10),
          Container(
            padding: EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
                color: DanColors.done.withValues(alpha: .14),
                borderRadius: BorderRadius.circular(99)),
            child: Text(t('Trống'),
                style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: Color(0xFF047857))),
          ),
        ],
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  final String label;
  final Color color;
  _Pill(this.label, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(label,
          style: TextStyle(
              fontSize: 11, fontWeight: FontWeight.w800, color: color)),
    );
  }
}
