import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/file_pick.dart';
import '../../widgets/side_sheet.dart';
import 'settings_tab.dart';
import '../../utils/translation.dart';

String _s(dynamic v) => v?.toString() ?? '';
bool _b(dynamic v) => v == true || v == 1 || v == '1';

final _roleKeys = ['owner', 'manager', 'cashier', 'kitchen', 'warehouse'];
Map<String, String> get _roleLabels => {
      'owner': 'Admin',
      'manager': t('Quản lý'),
      'cashier': t('Thu ngân'),
      'kitchen': t('Bếp'),
      'warehouse': t('Thủ kho'),
    };

Map<String, List<String>> get _permissionGroups => {
      t('Bán hàng'): [
        'module.pos',
        'module.retail',
        'module.ipad',
        'sell',
        'pay',
        'discount',
        'refund',
        'void',
        'void.made',
        'table.move',
        'bill.split',
        'order.view',
        'order.confirm',
      ],
      t('Bếp & online'): [
        'module.kds',
        'module.online',
        'kds',
        'online',
      ],
      t('Kho & thực đơn'): [
        'module.inventory',
        'module.warehouse',
        'module.purchase',
        'menu.manage',
        'inventory.adjust',
        'warehouse.manage',
        'settings.warehouse',
      ],
      t('Tài chính'): [
        'module.accounting',
        'module.invoice',
        'module.expenses',
        'invoice',
      ],
      t('Báo cáo'): ['reports', 'audit.view'],
      t('Danh bạ'): [
        'module.contacts',
        'contacts.create',
        'contacts.edit',
        'contacts.delete',
      ],
      t('Cài đặt'): [
        'settings.manage',
        'settings.users',
        'settings.perms',
        'settings.branches',
        'settings.warehouse',
        'settings.tables',
        'settings.menu',
        'settings.bookmenu',
        'settings.operations',
        'settings.invoices',
        'settings.einvoice',
        'settings.print',
        'settings.printers',
        'settings.devices',
        'settings.connections',
        'settings.integrations',
        'settings.sync',
        'settings.notification_sound',
        'settings.loyalty',
        'settings.promotions',
      ],
      t('Hệ thống & module'): [
        'module.printing',
        'module.database',
        'module.crm',
        'module.sales',
        'module.subscriptions',
        'module.ecommerce',
        'module.manufacturing',
        'module.barcode',
        'module.fleet',
        'module.payment',
        'module.import_export',
        'module.project',
        'module.calendar',
        'module.discuss',
        'module.knowledge',
        'module.todo',
        'module.studio',
        'module.automation',
        'module.developer',
      ],
    };

String _roleLabel(String role) => _roleLabels[role] ?? role;

List<String> _stringList(dynamic value) {
  if (value is List) {
    return value.map((e) => _s(e)).where((e) => e.isNotEmpty).toList();
  }
  return [];
}

Map<String, Set<String>> _rolePermMap(dynamic roles) {
  final out = <String, Set<String>>{};
  if (roles is List) {
    for (final r in roles.whereType<Map>()) {
      final key = _s(r['key']);
      if (key.isNotEmpty) out[key] = _stringList(r['perms']).toSet();
    }
  }
  return out;
}

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

class UsersPanel extends StatefulWidget {
  final ApiService api;
  UsersPanel({super.key, required this.api});

  @override
  State<UsersPanel> createState() => _UsersPanelState();
}

class _UsersPanelState extends State<UsersPanel> {
  List<Map<String, dynamic>> _users = [];
  List<Map<String, dynamic>> _catalog = [];
  Map<String, Set<String>> _rolePerms = {};
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
      final perms = await widget.api.getPermissions();
      if (!mounted) return;
      setState(() {
        _users = rows
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _catalog = (perms['catalog'] is List)
            ? (perms['catalog'] as List)
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : [];
        _rolePerms = _rolePermMap(perms['roles']);
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

  void _toast(String message, {bool error = false}) =>
      appToast(context, message, isError: error);

  Future<void> _openForm([Map<String, dynamic>? user]) async {
    final saved = await showSideSheet<bool>(
      context,
      width: dialogWidth(context, 720),
      builder: (_) => _UserFormDialog(
        api: widget.api,
        user: user,
        catalog: _catalog,
        rolePerms: _rolePerms,
      ),
    );
    if (saved == true) _load();
  }

  Future<void> _openRoleEditor(String role) async {
    if (role == 'owner') {
      _toast(t('Admin luôn có toàn quyền, không cần chỉnh.'));
      return;
    }
    final saved = await showSideSheet<bool>(
      context,
      width: dialogWidth(context, 720),
      builder: (_) => _RolePermissionDialog(
        api: widget.api,
        role: role,
        catalog: _catalog,
        initialPerms: _rolePerms[role] ?? <String>{},
      ),
    );
    if (saved == true) _load();
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
        child: ListView(
          padding: EdgeInsets.all(16),
          children: [
            _RoleDefaultsPanel(
              rolePerms: _rolePerms,
              onEdit: _openRoleEditor,
            ),
            SizedBox(height: 14),
            for (final user in _users) ...[
              _UserRow(
                user: user,
                baseUrl: widget.api.baseUrl,
                onEdit: () => _openForm(user),
                onDelete:
                    _s(user['role']) == 'owner' ? null : () => _delete(user),
              ),
              SizedBox(height: 8),
            ],
          ],
        ),
      ),
    );
  }
}

class _RoleDefaultsPanel extends StatelessWidget {
  final Map<String, Set<String>> rolePerms;
  final ValueChanged<String> onEdit;
  _RoleDefaultsPanel({required this.rolePerms, required this.onEdit});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t('Quyền mặc định vai trò'),
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
          SizedBox(height: 4),
          Text(
            t('Nhân viên mới sẽ nhận quyền theo vai trò, sau đó có thể chỉnh riêng từng người.'),
            style: TextStyle(fontSize: 12, color: DanColors.faint),
          ),
          SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              for (final role in _roleKeys)
                SizedBox(
                  width: 210,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: DanColors.surface2,
                      border: Border.all(color: DanColors.border),
                      borderRadius: BorderRadius.circular(DanRadius.md),
                    ),
                    child: Padding(
                      padding: EdgeInsets.all(12),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(_roleLabel(role),
                                    style: TextStyle(
                                        fontSize: 13.5,
                                        fontWeight: FontWeight.w900)),
                                SizedBox(height: 2),
                                Text(
                                  role == 'owner'
                                      ? t('Toàn quyền')
                                      : '${rolePerms[role]?.length ?? 0} ${t('quyền')}',
                                  style: TextStyle(
                                      fontSize: 11.5, color: DanColors.faint),
                                ),
                              ],
                            ),
                          ),
                          TextButton(
                            onPressed: () => onEdit(role),
                            child: Text(role == 'owner' ? 'Xem' : t('Sửa')),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _UserRow extends StatelessWidget {
  final Map<String, dynamic> user;
  final String baseUrl;
  final VoidCallback onEdit;
  final VoidCallback? onDelete;
  _UserRow({
    required this.user,
    required this.baseUrl,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final active = _b(user['active']);
    final custom = _b(user['customized']);
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Row(
        children: [
          _Avatar(
              name: _s(user['name']),
              avatar: _s(user['avatar']),
              baseUrl: baseUrl),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_s(user['name']),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style:
                        TextStyle(fontSize: 14.5, fontWeight: FontWeight.w900)),
                SizedBox(height: 2),
                Text('@${_s(user['username'])}',
                    style: TextStyle(fontSize: 11.5, color: DanColors.faint)),
              ],
            ),
          ),
          _Pill(_roleLabel(_s(user['role'])), DanColors.brand),
          SizedBox(width: 8),
          _Pill(active ? t('Hoạt động') : t('Đã khóa'),
              active ? DanColors.done : DanColors.muted),
          if (custom) ...[
            SizedBox(width: 8),
            _Pill(t('Quyền riêng'), DanColors.paying),
          ],
          SizedBox(width: 6),
          TextButton(onPressed: onEdit, child: Text(t('Sửa'))),
          if (onDelete != null)
            TextButton(
              onPressed: onDelete,
              style: TextButton.styleFrom(foregroundColor: DanColors.late),
              child: Text(t('Xóa')),
            ),
        ],
      ),
    );
  }
}

class _UserFormDialog extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic>? user;
  final List<Map<String, dynamic>> catalog;
  final Map<String, Set<String>> rolePerms;
  _UserFormDialog({
    required this.api,
    required this.user,
    required this.catalog,
    required this.rolePerms,
  });

  @override
  State<_UserFormDialog> createState() => _UserFormDialogState();
}

class _UserFormDialogState extends State<_UserFormDialog> {
  late final TextEditingController _name;
  late final TextEditingController _username;
  late final TextEditingController _pin;
  late String _role;
  late String _lang;
  late String _avatar;
  late bool _active;
  late Set<String> _selectedPerms;
  bool _uploadingAvatar = false;
  bool _saving = false;

  bool get _isEdit => widget.user != null;
  bool get _isOwner => _role == 'owner';

  @override
  void initState() {
    super.initState();
    final user = widget.user;
    _name = TextEditingController(text: _s(user?['name']));
    _username = TextEditingController(text: _s(user?['username']));
    _pin = TextEditingController();
    final rawRole = _s(user?['role']);
    _role = _roleKeys.contains(rawRole) ? rawRole : 'cashier';
    _lang = _s(user?['lang']) == 'en' ? 'en' : 'vi';
    _avatar = _s(user?['avatar']);
    _active = user == null ? true : _b(user['active']);
    _selectedPerms = _initialPerms(user, _role);
  }

  Set<String> _initialPerms(Map<String, dynamic>? user, String role) {
    if (role == 'owner') {
      return widget.catalog
          .map((e) => _s(e['key']))
          .where((e) => e.isNotEmpty)
          .toSet();
    }
    final explicit = _stringList(user?['perms']).toSet();
    if (explicit.isNotEmpty) return explicit;
    return Set<String>.of(widget.rolePerms[role] ?? <String>{});
  }

  @override
  void dispose() {
    _name.dispose();
    _username.dispose();
    _pin.dispose();
    super.dispose();
  }

  Future<void> _pickAvatar() async {
    final path = await _pickImagePath();
    if (path == null || path.isEmpty) return;

    final file = File(path);
    final length = await file.length();
    if (length > 20 * 1024 * 1024) {
      if (!mounted) return;
      _toast(t('Ảnh tối đa 20MB'), error: true);
      return;
    }

    setState(() => _uploadingAvatar = true);
    try {
      final bytes = await file.readAsBytes();
      final name = path.split(RegExp(r'[\\/]')).last;
      final res = await widget.api.uploadUserAvatar(
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
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  // Helper chung: tablet/điện thoại mở thư viện ảnh (image_picker), desktop
  // mở hộp thoại hệ điều hành — bản cũ chỉ có PowerShell nên trên Android
  // bấm nút không có phản ứng gì.
  Future<String?> _pickImagePath() =>
      pickImagePathCross(title: 'Chọn ảnh đại diện');

  void _toast(String message, {bool error = false}) =>
      appToast(context, message, isError: error);

  void _changeRole(String value) {
    setState(() {
      _role = value;
      _selectedPerms = _initialPerms(null, value);
    });
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty || _username.text.trim().isEmpty) {
      _toast(t('Cần nhập tên và tên đăng nhập'), error: true);
      return;
    }
    final pinText = _pin.text.trim();
    if (!_isEdit && !RegExp(r'^\d{4}$').hasMatch(pinText)) {
      _toast(t('Mã PIN phải đúng 4 chữ số'), error: true);
      return;
    }

    final approval = await settingsPin(
      context,
      _isEdit
          ? t('Cập nhật nhân viên "${_name.text.trim()}".')
          : t('Tạo tài khoản "${_name.text.trim()}".'),
    );
    if (approval == null) return;

    final body = <String, dynamic>{
      'name': _name.text.trim(),
      'username': _username.text.trim(),
      'avatar': _avatar,
      'role': _role,
      'lang': _lang,
      'active': _active,
      'perms': _isOwner
          ? widget.catalog.map((e) => _s(e['key'])).toList()
          : _selectedPerms.toList()
        ..sort(),
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
      if (!mounted) return;
      setState(() => _saving = false);
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DanColors.surface,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(20, 16, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      _isEdit ? t('Sửa nhân viên') : t('Thêm nhân viên'),
                      style:
                          TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: Icon(Icons.close),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: DanColors.border),
            Expanded(
              child: ListView(
                padding: EdgeInsets.all(20),
                children: [
                  _avatarEditor(),
                  SizedBox(height: 14),
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: [
                      SizedBox(width: 330, child: _field(t('Họ tên'), _name)),
                      SizedBox(
                          width: 330,
                          child: _field(t('Tên đăng nhập'), _username,
                              enabled: !_isEdit)),
                      SizedBox(
                        width: 330,
                        child: _field(
                          _isEdit
                              ? t('PIN mới (để trống nếu giữ nguyên)')
                              : t('PIN (4 số)'),
                          _pin,
                          obscure: true,
                          number: true,
                        ),
                      ),
                      SizedBox(width: 330, child: _roleField()),
                      SizedBox(width: 330, child: _languageField()),
                    ],
                  ),
                  SizedBox(height: 6),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: _active,
                    activeThumbColor: DanColors.done,
                    title: Text(t('Cho phép đăng nhập'),
                        style: TextStyle(
                            fontSize: 13.5, fontWeight: FontWeight.w800)),
                    onChanged:
                        _isOwner ? null : (v) => setState(() => _active = v),
                  ),
                  SizedBox(height: 8),
                  _PermissionEditor(
                    catalog: widget.catalog,
                    selected: _selectedPerms,
                    locked: _isOwner,
                    onChanged: (next) => setState(() => _selectedPerms = next),
                    onReset: () => setState(
                        () => _selectedPerms = _initialPerms(null, _role)),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: DanColors.border),
            Padding(
              padding: EdgeInsets.all(14),
              child: Row(
                children: [
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
                                strokeWidth: 2, color: Colors.white),
                          )
                        : Text(_isEdit ? t('Lưu') : t('Tạo')),
                  ),
                ],
              ),
            ),
          ],
        ),
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
          _Avatar(
              name: _name.text.trim(),
              avatar: _avatar,
              baseUrl: widget.api.baseUrl,
              radius: 30),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t('Ảnh đại diện'),
                    style:
                        TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900)),
                SizedBox(height: 2),
                Text(
                  _avatar.isEmpty
                      ? t('Chưa có ảnh')
                      : t('Đã chọn ảnh đại diện'),
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

  Widget _field(
    String label,
    TextEditingController controller, {
    bool enabled = true,
    bool obscure = false,
    bool number = false,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
        SizedBox(height: 5),
        TextField(
          controller: controller,
          enabled: enabled,
          obscureText: obscure,
          keyboardType: number ? TextInputType.number : null,
          inputFormatters: number
              ? [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(4),
                ]
              : null,
          decoration: InputDecoration(isDense: true),
        ),
      ],
    );
  }

  Widget _roleField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(t('Vai trò'),
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
        SizedBox(height: 5),
        DropdownButtonFormField<String>(
          initialValue: _role,
          decoration: InputDecoration(isDense: true),
          items: [
            for (final role in _roleKeys)
              DropdownMenuItem(value: role, child: Text(_roleLabel(role))),
          ],
          onChanged: _isEdit && _s(widget.user?['role']) == 'owner'
              ? null
              : (v) {
                  if (v != null) _changeRole(v);
                },
        ),
      ],
    );
  }

  Widget _languageField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(t('Ngôn ngữ'),
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
        SizedBox(height: 5),
        DropdownButtonFormField<String>(
          initialValue: _lang,
          decoration: InputDecoration(isDense: true),
          items: [
            DropdownMenuItem(value: 'vi', child: Text(t('Tiếng Việt'))),
            DropdownMenuItem(value: 'en', child: Text('English')),
          ],
          onChanged: (v) => setState(() => _lang = v == 'en' ? 'en' : 'vi'),
        ),
      ],
    );
  }
}

class _RolePermissionDialog extends StatefulWidget {
  final ApiService api;
  final String role;
  final List<Map<String, dynamic>> catalog;
  final Set<String> initialPerms;
  _RolePermissionDialog({
    required this.api,
    required this.role,
    required this.catalog,
    required this.initialPerms,
  });

  @override
  State<_RolePermissionDialog> createState() => _RolePermissionDialogState();
}

class _RolePermissionDialogState extends State<_RolePermissionDialog> {
  late Set<String> _selected;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _selected = Set<String>.of(widget.initialPerms);
  }

  Future<void> _save() async {
    final pin = await settingsPin(context,
        t('Cập nhật quyền mặc định vai trò "${_roleLabel(widget.role)}".'));
    if (pin == null) return;
    setState(() => _saving = true);
    try {
      await widget.api.setRolePermissionsWithPin(
          widget.role, _selected.toList()..sort(), pin);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
        backgroundColor: DanColors.late,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(20, 16, 12, 12),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                      t('Phân quyền vai trò ${_roleLabel(widget.role)}'),
                      style:
                          TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
                ),
                IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: Icon(Icons.close)),
              ],
            ),
          ),
          Divider(height: 1, color: DanColors.border),
          Expanded(
            child: ListView(
              padding: EdgeInsets.all(20),
              children: [
                _PermissionEditor(
                  catalog: widget.catalog,
                  selected: _selected,
                  locked: false,
                  onChanged: (next) => setState(() => _selected = next),
                  onReset: () => setState(
                      () => _selected = Set<String>.of(widget.initialPerms)),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: DanColors.border),
          Padding(
            padding: EdgeInsets.all(14),
            child: Row(
              children: [
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
                              strokeWidth: 2, color: Colors.white),
                        )
                      : Text(t('Lưu quyền')),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PermissionEditor extends StatelessWidget {
  final List<Map<String, dynamic>> catalog;
  final Set<String> selected;
  final bool locked;
  final ValueChanged<Set<String>> onChanged;
  final VoidCallback onReset;
  _PermissionEditor({
    required this.catalog,
    required this.selected,
    required this.locked,
    required this.onChanged,
    required this.onReset,
  });

  @override
  Widget build(BuildContext context) {
    final allKeys =
        catalog.map((e) => _s(e['key'])).where((e) => e.isNotEmpty).toList();
    final grouped = _groupCatalog();
    return Container(
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Material(
        color: Colors.transparent,
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(14, 12, 10, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      locked
                          ? t('Phân quyền: Admin toàn quyền')
                          : t('Phân quyền chi tiết'),
                      style:
                          TextStyle(fontSize: 14, fontWeight: FontWeight.w900),
                    ),
                  ),
                  if (!locked) ...[
                    Flexible(
                      child: Wrap(
                        alignment: WrapAlignment.end,
                        children: [
                          TextButton(
                              onPressed: onReset,
                              child: Text(t('Theo vai trò'))),
                          TextButton(
                            onPressed: () => onChanged(allKeys.toSet()),
                            child: Text(t('Chọn tất cả')),
                          ),
                          TextButton(
                            onPressed: () => onChanged(<String>{}),
                            child: Text(t('Bỏ chọn')),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
            Divider(height: 1, color: DanColors.border),
            for (final entry in grouped.entries)
              ExpansionTile(
                initiallyExpanded:
                    entry.key == t('Bán hàng') || entry.key == t('Cài đặt'),
                tilePadding: EdgeInsets.symmetric(horizontal: 14),
                title: Text(
                  '${entry.key} (${entry.value.where((p) => selected.contains(_s(p['key']))).length}/${entry.value.length})',
                  style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w900),
                ),
                children: [
                  LayoutBuilder(
                    builder: (context, constraints) {
                      final itemWidth = constraints.maxWidth >= 560
                          ? (constraints.maxWidth - 8) / 2
                          : constraints.maxWidth;
                      return Wrap(
                        children: [
                          for (final perm in entry.value)
                            SizedBox(
                              width: itemWidth,
                              child: CheckboxListTile(
                                dense: true,
                                value: selected.contains(_s(perm['key'])),
                                onChanged: locked
                                    ? null
                                    : (checked) {
                                        final next = Set<String>.of(selected);
                                        if (checked == true) {
                                          next.add(_s(perm['key']));
                                        } else {
                                          next.remove(_s(perm['key']));
                                        }
                                        onChanged(next);
                                      },
                                activeColor: DanColors.brand,
                                title: Text(_permissionLabel(perm),
                                    style: TextStyle(
                                        fontSize: 12.5,
                                        fontWeight: FontWeight.w700)),
                                subtitle: Text(_s(perm['key']),
                                    style: TextStyle(
                                        fontSize: 10.5,
                                        color: DanColors.faint)),
                              ),
                            ),
                        ],
                      );
                    },
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Map<String, List<Map<String, dynamic>>> _groupCatalog() {
    final byKey = {for (final p in catalog) _s(p['key']): p};
    final used = <String>{};
    final out = <String, List<Map<String, dynamic>>>{};

    for (final entry in _permissionGroups.entries) {
      final list = <Map<String, dynamic>>[];
      if (entry.key == t('Báo cáo')) {
        for (final p in catalog) {
          final key = _s(p['key']);
          if (entry.value.contains(key) || key.startsWith('report.')) {
            list.add(p);
            used.add(key);
          }
        }
      } else {
        for (final key in entry.value) {
          final p = byKey[key];
          if (p != null) {
            list.add(p);
            used.add(key);
          }
        }
      }
      if (list.isNotEmpty) out[entry.key] = list;
    }

    final other = catalog.where((p) => !used.contains(_s(p['key']))).toList()
      ..sort((a, b) => _s(a['key']).compareTo(_s(b['key'])));
    if (other.isNotEmpty) out[t('Khác')] = other;
    return out;
  }

  String _permissionLabel(Map<String, dynamic> perm) {
    final key = _s(perm['key']);
    final labels = {
      'sell': t('Bán hàng, mở bàn, thêm món'),
      'pay': t('Thanh toán bill'),
      'discount': t('Giảm giá và voucher'),
      'refund': t('Hoàn tiền và đổi trả'),
      'void': t('Hủy bill / hủy món'),
      'void.made': t('Xóa món đã chế biến'),
      'table.move': t('Chuyển / gộp bàn'),
      'bill.split': t('Tách bill'),
      'order.view': t('Xem chi tiết đơn'),
      'order.confirm': t('Xác nhận món từ khách'),
      'menu.manage': t('Quản lý thực đơn'),
      'inventory.adjust': t('Điều chỉnh tồn kho'),
      'warehouse.manage': t('Quản lý kho'),
      'invoice': t('Xuất hóa đơn'),
      'online': t('Xử lý đơn online'),
      'kds': t('Màn hình bếp'),
      'reports': t('Trung tâm báo cáo'),
      'audit.view': t('Xem nhật ký hoạt động'),
      'settings.manage': t('Toàn quyền cài đặt'),
      'settings.users': t('Quản lý nhân viên'),
      'settings.perms': t('Quản lý quyền và vai trò'),
      'settings.branches': t('Chi nhánh & phân vùng'),
      'settings.warehouse': t('Kho & kênh bán'),
      'settings.tables': t('Sơ đồ bàn'),
      'settings.menu': t('Cấu hình menu'),
      'settings.operations': t('Ca, thanh toán, vận hành'),
      'settings.invoices': t('Hóa đơn'),
      'settings.einvoice': t('Hóa đơn điện tử'),
      'settings.print': t('Bill & tem nhãn'),
      'settings.printers': t('Máy in'),
      'settings.devices': t('Thiết bị khách'),
      'settings.connections': t('Kết nối hệ thống'),
      'settings.integrations': t('Liên kết dịch vụ'),
      'settings.sync': t('Đồng bộ'),
      'settings.notification_sound': t('Âm thanh thông báo'),
      'settings.loyalty': t('Tích điểm khách hàng'),
      'settings.promotions': t('Khuyến mại / voucher'),
    };
    if (labels.containsKey(key)) return labels[key]!;
    final raw = _s(perm['label']);
    return raw.isNotEmpty ? raw : key;
  }
}

class _Avatar extends StatelessWidget {
  final String name;
  final String avatar;
  final String baseUrl;
  final double radius;
  _Avatar({
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
        // Avatar-size decode keeps the staff list light.
        cacheWidth: (radius * 4).round(),
        filterQuality: FilterQuality.low,
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) => fallback,
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
      child: Text(
        label,
        style:
            TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: color),
      ),
    );
  }
}
