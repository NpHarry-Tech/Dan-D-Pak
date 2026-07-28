// Panel "Chi nhánh" trong màn Cài đặt — thiết lập chi nhánh, kho và phân vùng bán.
import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../../widgets/address_fields.dart';
import '../../widgets/side_sheet.dart';
import 'settings_tab.dart';
import 'settings_value_utils.dart';

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
                        Text('${asText(b['name'])}  ·  ${asText(b['code'])}',
                            style: TextStyle(
                                fontSize: 14, fontWeight: FontWeight.w800)),
                        if (asText(b['address']).isNotEmpty)
                          Text(asText(b['address']),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  fontSize: 11.5, color: DanColors.faint)),
                      ],
                    ),
                  ),
                  _Pill(asFlag(b['active']) ? t('Đang mở') : t('Đã đóng'),
                      asFlag(b['active']) ? DanColors.done : DanColors.muted),
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
    _name = TextEditingController(text: asText(b?['name']));
    _code = TextEditingController(text: asText(b?['code']));
    _address = TextEditingController(text: asText(b?['address']));
    _addressDetail = TextEditingController(text: asText(b?['address_detail']));
    _addressWard = TextEditingController(text: asText(b?['address_ward']));
    _addressProvince = TextEditingController(text: asText(b?['address_province']));
    _wardCode = TextEditingController(text: asText(b?['ward_code']));
    _provinceCode = TextEditingController(text: asText(b?['province_code']));
    _active = b == null ? true : asFlag(b['active']);
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
        await widget.api.updateBranch(asText(widget.branch!['id']), body);
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

// Nhãn trạng thái nhỏ của thẻ chi nhánh (Đang mở / Đã đóng).
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
