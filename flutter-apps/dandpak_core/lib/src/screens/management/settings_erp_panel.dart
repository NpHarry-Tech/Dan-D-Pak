import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import 'settings_tab.dart';

/// ERP Control Center — Microsoft Dynamics 365 Business Central (mission #27).
///
/// Cấu hình kết nối (OAuth), kiểm tra, xem hàng đợi outbox và đối soát. Đồng bộ
/// bán hàng POS → BC chạy nền qua outbox (BC down thì POS vẫn bán). Mặc định TẮT.
///
/// NHÚNG trong mục "Liên kết" (IntegrationsPanel) — không có scaffold/header
/// riêng, dùng chung khung của Liên kết.
class ErpConfigView extends StatefulWidget {
  final ApiService api;
  ErpConfigView({super.key, required this.api});

  @override
  State<ErpConfigView> createState() => _ErpConfigViewState();
}

class _ErpConfigViewState extends State<ErpConfigView> {
  bool _loading = true;
  String? _error;
  bool _saving = false;
  bool _testing = false;
  String? _testMsg;
  bool _testOk = false;

  Map<String, dynamic> _status = {};
  List<dynamic> _queue = [];

  final _tenant = TextEditingController();
  final _clientId = TextEditingController();
  final _secret = TextEditingController();
  final _company = TextEditingController();
  final _environment = TextEditingController();
  final _customerNo = TextEditingController();
  final _location = TextEditingController();
  final _salesEndpoint = TextEditingController();
  bool _enabled = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in [
      _tenant,
      _clientId,
      _secret,
      _company,
      _environment,
      _customerNo,
      _location,
      _salesEndpoint
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
      final cfg = await widget.api.getErpConfig();
      final st = await widget.api.erpStatus();
      final q = await widget.api.erpQueue();
      if (!mounted) return;
      setState(() {
        _status = st;
        _queue = (q['rows'] as List?) ?? [];
        _enabled = cfg['enabled'] == true;
        _tenant.text = '${cfg['tenantId'] ?? ''}';
        _clientId.text = '${cfg['clientId'] ?? ''}';
        _secret.text = (cfg['hasSecret'] == true) ? '********' : '';
        _company.text = '${cfg['companyId'] ?? ''}';
        _environment.text = '${cfg['environment'] ?? 'production'}';
        _customerNo.text = '${cfg['defaultCustomerNo'] ?? ''}';
        _location.text = '${cfg['defaultLocationCode'] ?? ''}';
        _salesEndpoint.text = '${cfg['salesEndpoint'] ?? 'salesInvoices'}';
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

  Map<String, dynamic> _formBody() => {
        'enabled': _enabled,
        'tenantId': _tenant.text.trim(),
        'clientId': _clientId.text.trim(),
        'clientSecret':
            _secret.text.trim(), // '********' → server giữ secret cũ
        'companyId': _company.text.trim(),
        'environment': _environment.text.trim(),
        'defaultCustomerNo': _customerNo.text.trim(),
        'defaultLocationCode': _location.text.trim(),
        'salesEndpoint': _salesEndpoint.text.trim(),
      };

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await widget.api.saveErpConfig(_formBody());
      await _load();
      _snack(t('Đã lưu cấu hình Business Central'), ok: true);
    } catch (e) {
      _snack(e.toString().replaceFirst('Exception: ', ''), ok: false);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _test() async {
    setState(() {
      _testing = true;
      _testMsg = null;
    });
    try {
      // Lưu trước rồi mới test (dùng đúng cấu hình đang nhập).
      await widget.api.saveErpConfig(_formBody());
      final r = await widget.api.testErpConnection();
      setState(() {
        _testOk = r['ok'] == true;
        _testMsg = r['ok'] == true
            ? t('Kết nối OK — Company: ${r['company'] ?? '?'}')
            : '${r['error'] ?? t('Không kết nối được')} (${r['error_class'] ?? ''})';
      });
    } catch (e) {
      setState(() {
        _testOk = false;
        _testMsg = e.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) setState(() => _testing = false);
    }
  }

  Future<void> _processNow() async {
    try {
      final r = await widget.api.erpProcessNow();
      final s = (r['stats'] as Map?) ?? {};
      _snack(
          t('Đã đẩy: ${s['synced'] ?? 0} đồng bộ, ${s['retried'] ?? 0} thử lại, ${s['dead'] ?? 0} lỗi'),
          ok: true);
      await _load();
    } catch (e) {
      _snack(e.toString().replaceFirst('Exception: ', ''), ok: false);
    }
  }

  void _snack(String msg, {required bool ok}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: ok ? DanColors.text : DanColors.late,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return settingsState(
      loading: _loading,
      error: _error,
      onRetry: _load,
      child: SingleChildScrollView(
        padding: EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _statusCard(),
            SizedBox(height: 16),
            _configCard(),
            SizedBox(height: 16),
            _queueCard(),
          ],
        ),
      ),
    );
  }

  Widget _statusCard() {
    final counts = (_status['counts'] as Map?) ?? {};
    Widget chip(String label, dynamic n, Color c) => Container(
          padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
              color: c.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10)),
          child: Text('$label: ${n ?? 0}',
              style: TextStyle(fontWeight: FontWeight.w700, color: c)),
        );
    return Container(
      padding: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(Icons.account_tree_outlined, color: DanColors.brand),
          SizedBox(width: 8),
          Text(t('Microsoft Dynamics 365 Business Central'),
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          Spacer(),
          Text(_enabled ? t('ĐANG BẬT') : t('ĐANG TẮT'),
              style: TextStyle(
                  fontWeight: FontWeight.w800,
                  color: _enabled ? DanColors.brand : DanColors.faint)),
        ]),
        SizedBox(height: 12),
        Wrap(spacing: 10, runSpacing: 10, children: [
          chip(t('Chờ'), counts['pending'], DanColors.late),
          chip(t('Đang gửi'), counts['processing'], DanColors.brand),
          chip(t('Đã đồng bộ'), counts['synced'], Colors.green),
          chip(t('Lỗi (dead)'), counts['dead'], Colors.red),
        ]),
        SizedBox(height: 12),
        Wrap(spacing: 10, children: [
          OutlinedButton.icon(
              onPressed: _processNow,
              icon: Icon(Icons.sync, size: 18),
              label: Text(t('Đẩy hàng đợi ngay'))),
        ]),
      ]),
    );
  }

  Widget _field(String label, TextEditingController c,
          {bool obscure = false, String? hint}) =>
      Padding(
        padding: EdgeInsets.only(bottom: 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label,
              style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: DanColors.muted)),
          SizedBox(height: 4),
          TextField(
              controller: c,
              obscureText: obscure,
              decoration: InputDecoration(isDense: true, hintText: hint)),
        ]),
      );

  Widget _configCard() {
    return Container(
      padding: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          dense: true,
          value: _enabled,
          activeThumbColor: DanColors.brand,
          title: Text(t('Bật đồng bộ sang Business Central'),
              style: TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text(
              t('Tắt = không gửi gì. Bật = mỗi hoá đơn được xếp hàng đẩy sang BC (BC lỗi thì POS vẫn bán).'),
              style: TextStyle(fontSize: 11.5, color: DanColors.muted)),
          onChanged: (v) => setState(() => _enabled = v),
        ),
        Divider(height: 20),
        _field(t('Tenant ID (Azure AD)'), _tenant, hint: 'xxxxxxxx-xxxx-...'),
        _field(t('Client ID (App registration)'), _clientId),
        _field(t('Client Secret'), _secret,
            obscure: true, hint: '******** (để trống = giữ nguyên)'),
        _field(t('Company ID / Name (BC)'), _company),
        _field(t('Environment (production/sandbox)'), _environment),
        _field(t('Số khách lẻ mặc định (BC)'), _customerNo),
        _field(t('Mã kho mặc định (Location Code)'), _location),
        _field(t('Endpoint bán hàng'), _salesEndpoint,
            hint: 'salesInvoices hoặc tên custom "DDP Integration Inbox"'),
        if (_testMsg != null)
          Container(
            margin: EdgeInsets.only(bottom: 10),
            padding: EdgeInsets.all(10),
            decoration: BoxDecoration(
              color:
                  (_testOk ? Colors.green : Colors.red).withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(children: [
              Icon(_testOk ? Icons.check_circle : Icons.error,
                  color: _testOk ? Colors.green : Colors.red, size: 18),
              SizedBox(width: 8),
              Expanded(
                  child: Text(_testMsg!, style: TextStyle(fontSize: 12.5))),
            ]),
          ),
        Wrap(spacing: 10, runSpacing: 10, children: [
          FilledButton.icon(
            onPressed: _saving ? null : _save,
            icon: _saving
                ? SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white))
                : Icon(Icons.save, size: 18),
            label: Text(t('Lưu cấu hình')),
            style: FilledButton.styleFrom(backgroundColor: DanColors.brand),
          ),
          OutlinedButton.icon(
            onPressed: _testing ? null : _test,
            icon: _testing
                ? SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(Icons.wifi_tethering, size: 18),
            label: Text(t('Kiểm tra kết nối')),
          ),
        ]),
      ]),
    );
  }

  Widget _queueCard() {
    return Container(
      padding: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(t('Hàng đợi gần đây'),
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
        SizedBox(height: 10),
        if (_queue.isEmpty)
          Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Text(t('Chưa có sự kiện nào'),
                textAlign: TextAlign.center,
                style: TextStyle(color: DanColors.faint)),
          )
        else
          for (final r in _queue.take(30)) _queueRow(r as Map),
      ]),
    );
  }

  Widget _queueRow(Map r) {
    final status = '${r['status'] ?? ''}';
    Color c = DanColors.faint;
    if (status == 'synced')
      c = Colors.green;
    else if (status == 'dead')
      c = Colors.red;
    else if (status == 'pending')
      c = DanColors.late;
    else if (status == 'processing') c = DanColors.brand;
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 6),
      child: Row(children: [
        Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: c, shape: BoxShape.circle)),
        SizedBox(width: 10),
        Expanded(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${r['external_id'] ?? ''}',
                style: TextStyle(fontWeight: FontWeight.w600, fontSize: 12.5)),
            if ((r['last_error'] ?? '').toString().isNotEmpty)
              Text('${r['error_class'] ?? ''}: ${r['last_error']}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 11, color: Colors.red)),
            if ((r['nav_document_no'] ?? '').toString().isNotEmpty)
              Text('BC: ${r['nav_document_no']}',
                  style: TextStyle(fontSize: 11, color: Colors.green)),
          ]),
        ),
        Text(status.toUpperCase(),
            style:
                TextStyle(fontWeight: FontWeight.w700, color: c, fontSize: 11)),
        if (status == 'dead') ...[
          SizedBox(width: 8),
          TextButton(
            onPressed: () async {
              try {
                await widget.api.erpRetry('${r['id']}');
                await _load();
              } catch (e) {
                _snack(e.toString(), ok: false);
              }
            },
            child: Text(t('In lại')),
          ),
        ],
      ]),
    );
  }
}
