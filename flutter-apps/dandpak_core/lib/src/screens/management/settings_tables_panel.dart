// Panel "Cấu hình bàn" trong màn Cài đặt — bàn, khu vực và sơ đồ phòng bán.
import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../../widgets/side_sheet.dart';
import 'settings_tab.dart';
import 'settings_value_utils.dart';

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
    final pin = await settingsPin(context, 'Xóa bàn "${asText(table['code'])}".');
    if (pin == null) return;
    try {
      await widget.api.deleteTable(asText(table['id']), pin);
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
              asText(table['zone']).isEmpty ? t('Khác') : asText(table['zone']),
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
                child: Text('Bàn ${asText(table['code'])}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style:
                        TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
              ),
            ],
          ),
          SizedBox(height: 4),
          Text('${asText(table['seats'])} chỗ',
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
    _zone = TextEditingController(text: asText(t?['zone']));
    _code = TextEditingController(text: asText(t?['code']));
    _seats = TextEditingController(text: t != null ? asText(t['seats']) : '4');
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
        await widget.api.updateTable(asText(widget.table!['id']), body);
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
