import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../widgets/dan_top_bar.dart';
import '../management/management_widgets.dart';

String _s(dynamic v) => v?.toString() ?? '';

const _statusLabels = {
  'queued': 'Chờ in',
  'printing': 'Đang in',
  'printed': 'Đã in',
  'failed': 'Lỗi',
};

Color _statusColor(String s) {
  switch (s) {
    case 'printed':
      return DanColors.done;
    case 'printing':
      return DanColors.brand;
    case 'failed':
      return DanColors.late;
    default:
      return DanColors.doing;
  }
}

const _typeLabels = {
  'kitchen_ticket': 'Phiếu bếp',
  'receipt': 'Hóa đơn / Tạm tính',
  'cup_label': 'Tem ly',
  'product_label': 'Tem sản phẩm',
  'runner': 'Phiếu chạy món',
  'test': 'In thử',
  'cash_drawer': 'Mở két tiền',
  'inventory_document': 'Phiếu kho',
  'purchase': 'Phiếu mua hàng',
  'refund': 'Hoàn / trả hàng',
};

String _deviceIcon(Map<String, dynamic> p) {
  final t = '${_s(p['id'])} ${_s(p['output'])} ${_s(p['label'])}'.toLowerCase();
  if (RegExp(r'bill|receipt|hóa|hoa').hasMatch(t)) return 'BILL';
  if (RegExp(r'label|tem').hasMatch(t)) return 'TEM';
  if (RegExp(r'runner|chạy').hasMatch(t)) return 'RUNNER';
  if (RegExp(r'bar').hasMatch(t)) return 'BAR';
  return 'BẾP';
}

String _target(Map<String, dynamic> p) {
  switch (_s(p['connection'])) {
    case 'lan':
      return '${_s(p['ip']).isEmpty ? 'chưa có IP' : _s(p['ip'])}:${_s(p['port']).isEmpty ? '9100' : _s(p['port'])}';
    case 'system':
      return _s(p['systemName']).isNotEmpty
          ? _s(p['systemName'])
          : (_s(p['name']).isNotEmpty ? _s(p['name']) : 'chưa chọn driver');
    default:
      return 'Trình duyệt';
  }
}

/// Native port of the web Máy in (printers.html): printer devices with test
/// print + cash drawer, and the print-job history with reprint.
class PrintersScreen extends StatefulWidget {
  const PrintersScreen({super.key});

  @override
  State<PrintersScreen> createState() => _PrintersScreenState();
}

class _PrintersScreenState extends State<PrintersScreen> {
  List<Map<String, dynamic>> _printers = [];
  List<Map<String, dynamic>> _jobs = [];
  bool _loading = true;
  String? _error;
  String _search = '';
  String _statusFilter = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final api = context.read<ApiService>();
      final results = await Future.wait([api.getPrinters(), api.getPrintJobs()]);
      if (!mounted) return;
      List<Map<String, dynamic>> mapList(dynamic v) => (v as List)
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      setState(() {
        _printers = mapList(results[0]);
        _jobs = mapList(results[1]);
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

  void _toast(String m, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(m), backgroundColor: error ? DanColors.late : DanColors.text));
  }

  Future<void> _test(Map<String, dynamic> p) async {
    try {
      await context.read<ApiService>().testPrinter(_s(p['id']));
      _toast('Đã gửi lệnh in thử tới ${_s(p['label']).isEmpty ? _s(p['name']) : _s(p['label'])}');
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  Future<void> _openDrawer() async {
    try {
      await context.read<ApiService>().openCashDrawer();
      _toast('Đã gửi lệnh mở két tiền');
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  Future<void> _reprint(Map<String, dynamic> j) async {
    try {
      await context.read<ApiService>().reprintJob(_s(j['id']));
      _toast('Đã in lại');
      _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  String _printerName(String id) {
    for (final p in _printers) {
      if (_s(p['id']) == id) {
        return _s(p['label']).isNotEmpty ? _s(p['label']) : _s(p['name']);
      }
    }
    return id.isEmpty ? '-' : id;
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
        title: 'Máy in',
        subtitle: '',
        titleIcon: Icons.print_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
        actions: [
          DanTopBarButton(
            onPressed: _openDrawer,
            icon: Icons.point_of_sale,
            label: 'Mở két',
          ),
        ],
      ),
      body: _loading && _printers.isEmpty && _jobs.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : _error != null && _printers.isEmpty
              ? Padding(
                  padding: const EdgeInsets.all(40),
                  child: InlineMessage('Không tải được máy in ($_error)',
                      error: true, onRetry: _load),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(18),
                    children: [
                      Panel(
                        title: 'Thiết bị máy in (${_printers.length})',
                        child: _printers.isEmpty
                            ? const Padding(
                                padding: EdgeInsets.symmetric(vertical: 14),
                                child: Text('Chưa cấu hình máy in nào',
                                    style: TextStyle(color: DanColors.faint)))
                            : Wrap(
                                spacing: 12,
                                runSpacing: 12,
                                children: [
                                  for (final p in _printers)
                                    _PrinterCard(
                                        printer: p, onTest: () => _test(p)),
                                ],
                              ),
                      ),
                      const SizedBox(height: 16),
                      _jobsPanel(),
                    ],
                  ),
                ),
    );
  }

  Widget _jobsPanel() {
    final q = _search.trim().toLowerCase();
    final jobs = _jobs.where((j) {
      if (_statusFilter.isNotEmpty && _s(j['status']) != _statusFilter) {
        return false;
      }
      if (q.isEmpty) return true;
      return [_typeLabels[_s(j['type'])], _s(j['type']), _printerName(_s(j['printer_id'])), j['ref'], j['title']]
          .any((v) => _s(v).toLowerCase().contains(q));
    }).toList();

    return Panel(
      title: 'Lịch sử lệnh in',
      trailing: SizedBox(
        width: 180,
        child: DropdownButtonFormField<String>(
          initialValue: _statusFilter,
          isExpanded: true,
          decoration: const InputDecoration(isDense: true),
          items: const [
            DropdownMenuItem(value: '', child: Text('Tất cả trạng thái')),
            DropdownMenuItem(value: 'queued', child: Text('Chờ in')),
            DropdownMenuItem(value: 'printing', child: Text('Đang in')),
            DropdownMenuItem(value: 'printed', child: Text('Đã in')),
            DropdownMenuItem(value: 'failed', child: Text('Lỗi')),
          ],
          onChanged: (v) => setState(() => _statusFilter = v ?? ''),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            decoration: const InputDecoration(
                hintText: 'Tìm theo loại, máy in, mã…',
                prefixIcon: Icon(Icons.search),
                isDense: true),
            onChanged: (v) => setState(() => _search = v),
          ),
          const SizedBox(height: 8),
          if (jobs.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 14),
              child: Text('Chưa có lệnh in nào',
                  style: TextStyle(color: DanColors.faint)),
            )
          else
            for (final j in jobs.take(80)) _jobRow(j),
        ],
      ),
    );
  }

  Widget _jobRow(Map<String, dynamic> j) {
    final status = _s(j['status']);
    final c = _statusColor(status);
    final created = DateTime.tryParse(_s(j['created_at']));
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_typeLabels[_s(j['type'])] ?? _s(j['type']),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w700)),
                Text(
                  '${_printerName(_s(j['printer_id']))}${created != null ? ' · ${Fmt.dmyHm(created)}' : ''}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11, color: DanColors.faint),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
                color: c.withValues(alpha: .13),
                borderRadius: BorderRadius.circular(99)),
            child: Text(_statusLabels[status] ?? status,
                style: TextStyle(
                    fontSize: 10.5, fontWeight: FontWeight.w800, color: c)),
          ),
          TextButton(
            onPressed: () => _reprint(j),
            style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact),
            child: const Text('In lại', style: TextStyle(fontSize: 12)),
          ),
        ],
      ),
    );
  }
}

class _PrinterCard extends StatelessWidget {
  final Map<String, dynamic> printer;
  final VoidCallback onTest;
  const _PrinterCard({required this.printer, required this.onTest});

  @override
  Widget build(BuildContext context) {
    final p = printer;
    final active = _s(p['active']) != 'false' && p['active'] != false;
    return Container(
      width: 220,
      padding: const EdgeInsets.all(14),
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
              Text(_deviceIcon(p), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: DanColors.muted)),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                    _s(p['label']).isNotEmpty ? _s(p['label']) : _s(p['name']),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 13.5, fontWeight: FontWeight.w800)),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(_target(p),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  fontFamily: 'JetBrains Mono',
                  fontSize: 11,
                  color: DanColors.muted)),
          const SizedBox(height: 4),
          Row(
            children: [
              Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(
                    color: active ? DanColors.done : DanColors.faint,
                    shape: BoxShape.circle),
              ),
              const SizedBox(width: 5),
              Text(active ? 'Sẵn sàng' : 'Tắt',
                  style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: active ? const Color(0xFF047857) : DanColors.faint)),
              const Spacer(),
              OutlinedButton(
                onPressed: onTest,
                style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 30),
                    padding: const EdgeInsets.symmetric(horizontal: 10)),
                child: const Text('In thử', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
