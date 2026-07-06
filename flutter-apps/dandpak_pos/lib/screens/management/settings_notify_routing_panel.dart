import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;

import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/sound_player.dart';
import 'management_widgets.dart';
import 'settings_tab.dart';

String _s(dynamic v) => v?.toString() ?? '';
bool _b(dynamic v) => v == true || v == 1 || v == '1';

/// Notification categories that can be routed. [key, icon, label].
const _notifyCategories = <List<String>>[
  ['fnb_order', '', 'Đơn F&B tại bàn / POS'],
  ['online_order', '', 'Đơn hàng online'],
  ['inventory', '', 'Kho / Tồn thấp'],
  ['invoice', '', 'Hóa đơn & Thanh toán'],
];

/// Roles a notification can be routed to. [role, label].
const _notifyRoles = <List<String>>[
  ['cashier', 'Thu ngân'],
  ['kitchen', 'Bếp'],
  ['warehouse', 'Kho'],
  ['manager', 'Quản lý'],
  ['owner', 'Admin'],
];

/// Sensible defaults when nothing has been saved yet.
const _defaultRoleRouting = <String, List<String>>{
  'fnb_order': ['cashier', 'kitchen', 'manager', 'owner'],
  'online_order': ['cashier', 'manager', 'owner'],
  'inventory': ['warehouse', 'manager', 'owner'],
  'invoice': ['cashier', 'manager', 'owner'],
};

String _roleLabelOf(String role) {
  for (final r in _notifyRoles) {
    if (r[0] == role) return r[1];
  }
  return role.isEmpty ? '—' : role;
}

// Notification events (mirrors web DEFAULT_EVENTS): key, icon, label, default sound.
const _soundEvents = [
  ['online_order', '', 'Đơn hàng online mới', 'Doorbell'],
  ['table_order', '', 'Khách tự gọi món (iPad)', 'Information_Bell'],
  ['staff_call', '', 'Khách gọi nhân viên', 'Alarmed'],
  ['payment', '', 'Thanh toán thành công', 'Glass'],
  ['kds_new_order', '', 'Món mới lên màn hình bếp (KDS)', 'Beeper'],
];

class NotificationSettingsPanel extends StatefulWidget {
  final ApiService api;
  const NotificationSettingsPanel({super.key, required this.api});

  @override
  State<NotificationSettingsPanel> createState() =>
      _NotificationSettingsPanelState();
}

class _NotificationSettingsPanelState extends State<NotificationSettingsPanel> {
  // Shared States
  bool _loading = true;
  bool _saving = false;
  String? _error;

  // Sound States
  bool _soundEnabled = true;
  double _soundVolume = 1.0;
  final Map<String, Map<String, dynamic>> _soundEventsMap = {};
  List<Map<String, dynamic>> _soundsCatalog = [];

  // Routing States
  final Map<String, Set<String>> _routingRoles = {};
  final Map<String, Map<String, bool>> _routingOverrides = {};
  List<Map<String, dynamic>> _users = [];
  String _userQuery = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<List<Map<String, dynamic>>> _loadCatalog() async {
    try {
      final raw = await rootBundle
          .loadString('assets/web/assets/sounds/notifications/catalog.json');
      final json = jsonDecode(raw);
      final sounds = (json is Map && json['sounds'] is List)
          ? (json['sounds'] as List)
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
          : <Map<String, dynamic>>[];
      if (sounds.isNotEmpty) return sounds;
    } catch (_) {}
    return [
      for (final e in _soundEvents)
        {'id': e[3], 'name': e[3], 'category': 'classic'},
    ];
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() => _loading = true);
    try {
      final results = await Future.wait([
        widget.api.getAppSettings(),
        widget.api.getUsers(),
        _loadCatalog(),
      ]);

      final s = results[0] as Map<String, dynamic>;
      final usersRaw = results[1] as List<dynamic>;
      final catalog = results[2] as List<Map<String, dynamic>>;

      // 1. Process Sound config
      final soundCfg = s['notification_sound_config'];
      final soundMap = soundCfg is Map ? Map<String, dynamic>.from(soundCfg) : <String, dynamic>{};
      final evRaw = soundMap['events'] is Map ? Map<String, dynamic>.from(soundMap['events']) : <String, dynamic>{};
      final catalogIds = catalog.map((c) => _s(c['id'])).toSet();

      _soundsCatalog = catalog;
      _soundEnabled = soundMap['enabled'] == null ? true : _b(soundMap['enabled']);
      _soundVolume = (soundMap['volume'] is num) ? (soundMap['volume'] as num).toDouble().clamp(0.0, 1.0) : 1.0;

      _soundEventsMap.clear();
      for (final e in _soundEvents) {
        final key = e[0];
        final saved = evRaw[key] is Map ? Map<String, dynamic>.from(evRaw[key]) : <String, dynamic>{};
        var sound = _s(saved['sound']).isNotEmpty ? _s(saved['sound']) : e[3];
        if (!catalogIds.contains(sound)) {
          sound = catalogIds.contains(e[3]) ? e[3] : (catalog.isNotEmpty ? _s(catalog.first['id']) : e[3]);
        }
        _soundEventsMap[key] = {
          'enabled': saved['enabled'] == null ? true : _b(saved['enabled']),
          'sound': sound,
        };
      }

      // 2. Process Routing config
      final routingCfg = s['notification_routing_config'];
      final routingMap = routingCfg is Map ? Map<String, dynamic>.from(routingCfg) : <String, dynamic>{};
      final rolesRaw = routingMap['roles'] is Map ? Map<String, dynamic>.from(routingMap['roles']) : <String, dynamic>{};

      _routingRoles.clear();
      for (final c in _notifyCategories) {
        final key = c[0];
        final saved = rolesRaw[key];
        if (saved is List) {
          _routingRoles[key] = saved.map(_s).where((e) => e.isNotEmpty).toSet();
        } else {
          _routingRoles[key] = {..._defaultRoleRouting[key]!};
        }
      }

      final ovRaw = routingMap['overrides'] is Map ? Map<String, dynamic>.from(routingMap['overrides']) : <String, dynamic>{};
      _routingOverrides.clear();
      ovRaw.forEach((uid, val) {
        if (val is! Map) return;
        final cleaned = <String, bool>{};
        for (final c in _notifyCategories) {
          final raw = val[c[0]];
          if (raw is bool) cleaned[c[0]] = raw;
          if (raw == 1 || raw == '1') cleaned[c[0]] = true;
          if (raw == 0 || raw == '0') cleaned[c[0]] = false;
        }
        if (cleaned.isNotEmpty) _routingOverrides[_s(uid)] = cleaned;
      });

      _users = usersRaw
          .whereType<Map>()
          .map((u) => Map<String, dynamic>.from(u))
          .toList();

      if (!mounted) return;
      setState(() {
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
    // 1. Prepare Sound config
    final soundCfg = <String, dynamic>{
      'enabled': _soundEnabled,
      'volume': double.parse(_soundVolume.toStringAsFixed(2)),
      'events': _soundEventsMap,
    };

    // 2. Prepare Routing config
    final rolesOut = <String, List<String>>{};
    for (final c in _notifyCategories) {
      rolesOut[c[0]] = (_routingRoles[c[0]] ?? <String>{}).toList()..sort();
    }
    final ovOut = <String, Map<String, bool>>{};
    _routingOverrides.forEach((uid, m) {
      if (m.isNotEmpty) ovOut[uid] = m;
    });
    final routingCfg = {'roles': rolesOut, 'overrides': ovOut};

    setState(() => _saving = true);
    try {
      await widget.api.saveAppSettings({
        'notification_sound_config': soundCfg,
        'notification_routing_config': routingCfg,
      });
      await SocketService().reloadSoundConfig();
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Đã lưu cấu hình thông báo'),
          backgroundColor: DanColors.text));
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late));
    }
  }

  String _soundName(String id) {
    for (final c in _soundsCatalog) {
      if (_s(c['id']) == id) return _s(c['name']);
    }
    return id;
  }

  bool _roleHas(String cat, String role) => (_routingRoles[cat] ?? {}).contains(role);

  void _toggleRole(String cat, String role, bool on) {
    setState(() {
      final set = _routingRoles.putIfAbsent(cat, () => <String>{});
      if (on) {
        set.add(role);
      } else {
        set.remove(role);
      }
    });
  }

  String _ovState(String uid, String cat) {
    final m = _routingOverrides[uid];
    if (m == null || !m.containsKey(cat)) return 'inherit';
    return m[cat]! ? 'on' : 'off';
  }

  void _setOv(String uid, String cat, String state) {
    setState(() {
      if (state == 'inherit') {
        final m = _routingOverrides[uid];
        if (m != null) {
          m.remove(cat);
          if (m.isEmpty) _routingOverrides.remove(uid);
        }
      } else {
        final m = _routingOverrides.putIfAbsent(uid, () => <String, bool>{});
        m[cat] = state == 'on';
      }
    });
  }

  bool _effective(String uid, String role, String cat) {
    final m = _routingOverrides[uid];
    if (m != null && m.containsKey(cat)) return m[cat]!;
    return _roleHas(cat, role);
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: 'Cấu hình thông báo',
      onRefresh: _load,
      child: settingsState(
        loading: _loading,
        error: _error,
        onRetry: _load,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(18),
                children: [
                  Panel(
                    title: 'Thông báo đơn hàng & sự kiện',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          value: _soundEnabled,
                          activeThumbColor: DanColors.brand,
                          title: const Text('Bật âm thanh thông báo',
                              style: TextStyle(
                                  fontSize: 14, fontWeight: FontWeight.w700)),
                          subtitle: const Text(
                              'Phát âm khi có order mới, gọi nhân viên, thanh toán…',
                              style: TextStyle(fontSize: 12, color: DanColors.muted)),
                          onChanged: (v) => setState(() => _soundEnabled = v),
                        ),
                        const Divider(height: 20, color: DanColors.border),
                        Row(
                          children: [
                            const Icon(Icons.volume_up_outlined,
                                size: 20, color: DanColors.muted),
                            Expanded(
                              child: Slider(
                                value: _soundVolume,
                                onChanged: _soundEnabled
                                    ? (v) => setState(() => _soundVolume = v)
                                    : null,
                              ),
                            ),
                            SizedBox(
                              width: 44,
                              child: Text('${(_soundVolume * 100).round()}%',
                                  textAlign: TextAlign.right,
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w800, fontSize: 13)),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  Panel(
                    title: 'Âm riêng cho từng sự kiện',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (var i = 0; i < _soundEvents.length; i++) ...[
                          if (i > 0) const Divider(height: 20, color: DanColors.border),
                          _eventRow(_soundEvents[i]),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),
                  _intro(),
                  const SizedBox(height: 16),
                  Panel(
                    title: 'Định tuyến theo vai trò',
                    child: _roleMatrix(),
                  ),
                  const SizedBox(height: 16),
                  Panel(
                    title: 'Ghi đè theo nhân viên',
                    trailing: Text('${_routingOverrides.length} người có ghi đè',
                        style: const TextStyle(
                            fontSize: 11.5,
                            color: DanColors.faint,
                            fontWeight: FontWeight.w700)),
                    child: _overrideList(),
                  ),
                  const SizedBox(height: 24),
                ],
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
                    label: const Text('Lưu thay đổi'),
                    style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _eventRow(List<String> ev) {
    final key = ev[0];
    final e = _soundEventsMap[key] ?? {'enabled': true, 'sound': ev[3]};
    final on = _b(e['enabled']) && _soundEnabled;
    final sound = _s(e['sound']);
    final validSound =
        _soundsCatalog.any((c) => _s(c['id']) == sound) ? sound : null;
    return Row(
      children: [
        Text(ev[1], style: const TextStyle(fontSize: 22)),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(ev[2],
                  style: const TextStyle(
                      fontSize: 13.5, fontWeight: FontWeight.w700)),
              Text('Âm: ${_soundName(sound)}',
                  style: const TextStyle(fontSize: 11.5, color: DanColors.faint)),
            ],
          ),
        ),
        IconButton(
          tooltip: 'Nghe thử',
          onPressed: sound.isEmpty
              ? null
              : () => playNotificationSound(widget.api.baseUrl, sound,
                  volume: _soundVolume),
          icon: const Icon(Icons.play_circle_outline, color: DanColors.brand),
          splashRadius: 20,
        ),
        SizedBox(
          width: 180,
          child: DropdownButtonFormField<String>(
            initialValue: validSound,
            isExpanded: true,
            decoration: const InputDecoration(isDense: true),
            items: [
              for (final c in _soundsCatalog)
                DropdownMenuItem(
                    value: _s(c['id']),
                    child: Text(_s(c['name']), overflow: TextOverflow.ellipsis)),
            ],
            onChanged: on
                ? (v) {
                    if (v != null) {
                      setState(() => _soundEventsMap[key] = {..._soundEventsMap[key]!, 'sound': v});
                      playNotificationSound(widget.api.baseUrl, v,
                          volume: _soundVolume);
                    }
                  }
                : null,
          ),
        ),
        const SizedBox(width: 8),
        Switch(
          value: _b(e['enabled']),
          activeThumbColor: DanColors.done,
          onChanged: _soundEnabled
              ? (v) => setState(
                  () => _soundEventsMap[key] = {..._soundEventsMap[key]!, 'enabled': v})
              : null,
        ),
      ],
    );
  }

  Widget _intro() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DanColors.brandDim,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: const Text(
        'Chọn vai trò / nhân viên sẽ nhận từng loại thông báo. Vì mỗi thiết bị '
        'đăng nhập bằng một vai trò, cấu hình theo vai trò cũng chính là theo '
        'thiết bị. Có thể ghi đè riêng cho từng nhân viên bên dưới.',
        style: TextStyle(
            fontSize: 12.5, color: DanColors.muted, height: 1.45),
      ),
    );
  }

  Widget _roleMatrix() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Table(
          border: const TableBorder(
            horizontalInside: BorderSide(color: DanColors.border),
          ),
          columnWidths: const {0: FlexColumnWidth()},
          defaultColumnWidth: const FixedColumnWidth(62),
          defaultVerticalAlignment: TableCellVerticalAlignment.middle,
          children: [
            TableRow(
              children: [
                const _MatrixHeaderCell(label: 'Loại thông báo', left: true),
                for (final r in _notifyRoles)
                  _MatrixHeaderCell(label: r[1]),
              ],
            ),
            for (final c in _notifyCategories)
              TableRow(
                children: [
                  _MatrixLabelCell(icon: c[1], label: c[2]),
                  for (final r in _notifyRoles)
                    _MatrixCheckCell(
                      value: _roleHas(c[0], r[0]),
                      onChanged: (v) => _toggleRole(c[0], r[0], v),
                    ),
                ],
              ),
          ],
        ),
      ],
    );
  }

  Widget _overrideList() {
    final q = _userQuery.trim().toLowerCase();
    final filtered = _users.where((u) {
      if (q.isEmpty) return true;
      final name = _s(u['name']).toLowerCase();
      final uname = _s(u['username']).toLowerCase();
      return name.contains(q) || uname.contains(q);
    }).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          onChanged: (v) => setState(() => _userQuery = v),
          decoration: const InputDecoration(
            isDense: true,
            hintText: 'Tìm nhân viên...',
            prefixIcon: Icon(Icons.search, size: 20, color: DanColors.faint),
          ),
        ),
        const SizedBox(height: 6),
        if (filtered.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 18),
            child: Text('Không có nhân viên phù hợp.',
                textAlign: TextAlign.center,
                style: TextStyle(color: DanColors.muted)),
          )
        else
          for (final u in filtered) _userOverrideTile(u),
      ],
    );
  }

  Widget _userOverrideTile(Map<String, dynamic> u) {
    final uid = _s(u['id']).isNotEmpty ? _s(u['id']) : _s(u['username']);
    final role = _s(u['role']);
    final name = _s(u['name']).isNotEmpty ? _s(u['name']) : _s(u['username']);
    final ovCount = _routingOverrides[uid]?.length ?? 0;

    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        tilePadding: const EdgeInsets.symmetric(horizontal: 6),
        childrenPadding: const EdgeInsets.fromLTRB(6, 0, 6, 10),
        leading: CircleAvatar(
          radius: 16,
          backgroundColor: DanColors.brandDim,
          child: Text(
            (name.isNotEmpty ? name[0] : '?').toUpperCase(),
            style: const TextStyle(
                color: DanColors.brand, fontWeight: FontWeight.w800),
          ),
        ),
        title: Text(name,
            style: const TextStyle(
                fontWeight: FontWeight.w800, fontSize: 13.5)),
        subtitle: Text(
          ovCount > 0 ? '${_roleLabelOf(role)} · $ovCount ghi đè'
              : _roleLabelOf(role),
          style: TextStyle(
              fontSize: 11.5,
              color: ovCount > 0 ? DanColors.brand : DanColors.muted,
              fontWeight: FontWeight.w600),
        ),
        children: [
          for (final c in _notifyCategories)
            _overrideRow(uid, role, c),
        ],
      ),
    );
  }

  Widget _overrideRow(String uid, String role, List<String> c) {
    final cat = c[0];
    final state = _ovState(uid, cat);
    final effective = _effective(uid, role, cat);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Text(c[1], style: const TextStyle(fontSize: 16)),
          const SizedBox(width: 8),
          Expanded(
            child: Text(c[2],
                style: const TextStyle(
                    fontSize: 12.5, fontWeight: FontWeight.w600)),
          ),
          Container(
            margin: const EdgeInsets.only(right: 10),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: effective
                  ? DanColors.done.withValues(alpha: .14)
                  : DanColors.surface3,
              borderRadius: BorderRadius.circular(99),
            ),
            child: Text(
              effective ? 'Nhận' : 'Không',
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
                color: effective
                    ? const Color(0xFF047857)
                    : DanColors.faint,
              ),
            ),
          ),
          SizedBox(
            width: 132,
            child: DropdownButtonFormField<String>(
              initialValue: state,
              isDense: true,
              decoration: const InputDecoration(isDense: true),
              items: const [
                DropdownMenuItem(
                    value: 'inherit', child: Text('Theo vai trò')),
                DropdownMenuItem(value: 'on', child: Text('Luôn nhận')),
                DropdownMenuItem(value: 'off', child: Text('Không nhận')),
              ],
              onChanged: (v) => _setOv(uid, cat, v ?? 'inherit'),
            ),
          ),
        ],
      ),
    );
  }
}

class _MatrixHeaderCell extends StatelessWidget {
  final String label;
  final bool left;
  const _MatrixHeaderCell({required this.label, this.left = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
      child: Text(
        label,
        textAlign: left ? TextAlign.left : TextAlign.center,
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w900,
          color: DanColors.muted,
          height: 1.2,
        ),
      ),
    );
  }
}

class _MatrixLabelCell extends StatelessWidget {
  final String icon;
  final String label;
  const _MatrixLabelCell({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
      child: Row(
        children: [
          Text(icon, style: const TextStyle(fontSize: 16)),
          const SizedBox(width: 8),
          Expanded(
            child: Text(label,
                style: const TextStyle(
                    fontSize: 12.5, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }
}

class _MatrixCheckCell extends StatelessWidget {
  final bool value;
  final ValueChanged<bool> onChanged;
  const _MatrixCheckCell({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Checkbox(
        value: value,
        activeColor: DanColors.brand,
        visualDensity: VisualDensity.compact,
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        onChanged: (v) => onChanged(v ?? false),
      ),
    );
  }
}
