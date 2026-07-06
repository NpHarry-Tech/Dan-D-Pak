import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../models/management_models.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/open_file.dart';
import 'management_widgets.dart';

/// Management → Báo cáo tab. Port of the web Report Center:
/// grouped report picker, period / date-range filters, summary cards,
/// section tables and export (PDF / Excel / In HTML).
class ReportsTab extends StatefulWidget {
  final ApiService api;
  const ReportsTab({super.key, required this.api});

  @override
  State<ReportsTab> createState() => _ReportsTabState();
}

class _ReportsTabState extends State<ReportsTab> {
  static const _periodKeys = ['day', 'week', 'month', 'quarter', 'year'];
  static const _periodLabels = ['Ngày', 'Tuần', 'Tháng', 'Quý', 'Năm'];
  static final _ymd = DateFormat('yyyy-MM-dd');

  ReportCatalog? _catalog;
  String? _selectedKey;
  int _periodIndex = 0;
  DateTime? _from;
  DateTime? _to;
  bool _allBranches = false;
  List<String> _selectedBranchIds = [];

  ReportData? _report;
  String? _catalogError;
  String? _reportError;
  bool _loadingCatalog = true;
  bool _loadingReport = false;
  bool _exporting = false;

  @override
  void initState() {
    super.initState();
    _loadCatalog();
  }

  Future<void> _loadCatalog() async {
    setState(() {
      _loadingCatalog = true;
      _catalogError = null;
    });
    try {
      final raw = await widget.api.getReportsCatalog();
      final cat = ReportCatalog.fromJson(raw);
      if (!mounted) return;
      setState(() {
        _catalog = cat;
        _loadingCatalog = false;
        if (cat.reports.isNotEmpty) {
          _selectedKey = cat.reports.first.key;
        }
        if (cat.branches.length > 1) {
          final defaultId = cat.defaultBranchId.isNotEmpty
              ? cat.defaultBranchId
              : cat.branches.first.id;
          _selectedBranchIds = [defaultId];
        } else if (cat.branches.length == 1) {
          _selectedBranchIds = [cat.branches.first.id];
        }
      });
      if (_selectedKey != null) _loadReport();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _catalogError = e.toString().replaceFirst('Exception: ', '');
        _loadingCatalog = false;
      });
    }
  }

  Future<void> _loadReport() async {
    final key = _selectedKey;
    if (key == null) return;
    setState(() {
      _loadingReport = true;
      _reportError = null;
    });
    try {
      final raw = await widget.api.getReportPreview(
        key,
        period: _periodKeys[_periodIndex],
        from: _from != null ? _ymd.format(_from!) : null,
        to: _to != null ? _ymd.format(_to!) : null,
        branchIds: _branchParam,
      );
      if (!mounted) return;
      setState(() {
        _report = ReportData.fromJson(raw);
        _loadingReport = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _reportError = e.toString().replaceFirst('Exception: ', '');
        _loadingReport = false;
      });
    }
  }

  void _select(String key) {
    if (key == _selectedKey) return;
    setState(() => _selectedKey = key);
    _loadReport();
  }

  Future<void> _pickDate(bool isFrom) async {
    final initial = (isFrom ? _from : _to) ?? DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (picked == null) return;
    setState(() {
      if (isFrom) {
        _from = picked;
      } else {
        _to = picked;
      }
    });
    _loadReport();
  }

  Future<void> _export(String format, String ext) async {
    final key = _selectedKey;
    if (key == null || _exporting) return;
    setState(() => _exporting = true);
    try {
      final bytes = await widget.api.exportReport(
        key,
        format,
        period: _periodKeys[_periodIndex],
        from: _from != null ? _ymd.format(_from!) : null,
        to: _to != null ? _ymd.format(_to!) : null,
        branchIds: _branchParam,
      );
      await openBytes(bytes, 'baocao_$key.$ext');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(
              'Không xuất được: ${e.toString().replaceFirst('Exception: ', '')}'),
          backgroundColor: DanColors.late,
        ));
      }
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  String get _branchParam {
    final catalog = _catalog;
    if (catalog == null || catalog.branches.length <= 1) return '';
    if (_allBranches) return 'all';
    final valid = catalog.branches.map((b) => b.id).toSet();
    final ids = _selectedBranchIds.where(valid.contains).toList();
    if (ids.isEmpty) return catalog.defaultBranchId;
    return ids.join(',');
  }

  String get _branchLabel {
    final catalog = _catalog;
    if (catalog == null || catalog.branches.length <= 1) return '';
    if (_allBranches) return 'Tất cả chi nhánh';
    final selected = catalog.branches
        .where((b) => _selectedBranchIds.contains(b.id))
        .toList();
    if (selected.length == 1) return selected.first.name;
    if (selected.isEmpty) return 'Chọn chi nhánh';
    return '${selected.length} chi nhánh';
  }

  Future<void> _pickBranches() async {
    final catalog = _catalog;
    if (catalog == null || catalog.branches.length <= 1) return;
    var all = _allBranches;
    var ids = [..._selectedBranchIds];
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: const Text('Chọn chi nhánh'),
          content: SizedBox(
            width: 420,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CheckboxListTile(
                    value: all,
                    onChanged: (v) => setLocal(() {
                      all = v == true;
                      if (all) ids = catalog.branches.map((b) => b.id).toList();
                    }),
                    title: const Text('Tất cả chi nhánh'),
                    controlAffinity: ListTileControlAffinity.leading,
                  ),
                  const Divider(height: 1),
                  for (final b in catalog.branches)
                    CheckboxListTile(
                      value: all || ids.contains(b.id),
                      onChanged: all
                          ? null
                          : (v) => setLocal(() {
                                if (v == true) {
                                  ids = {...ids, b.id}.toList();
                                } else {
                                  ids.remove(b.id);
                                }
                              }),
                      title: Text(b.name),
                      subtitle: b.code.isNotEmpty ? Text(b.code) : null,
                      controlAffinity: ListTileControlAffinity.leading,
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Hủy'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Áp dụng'),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;
    setState(() {
      _allBranches = all;
      _selectedBranchIds = all
          ? catalog.branches.map((b) => b.id).toList()
          : ids.isEmpty
              ? [catalog.defaultBranchId]
              : ids;
    });
    _loadReport();
  }

  @override
  Widget build(BuildContext context) {
    if (_loadingCatalog) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_catalogError != null) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage('Không tải được danh mục báo cáo ($_catalogError)',
            error: true, onRetry: _loadCatalog),
      );
    }
    final catalog = _catalog!;
    if (catalog.reports.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(40),
          child: Text('Tài khoản này chưa có quyền xem báo cáo nào.',
              style: TextStyle(color: DanColors.muted)),
        ),
      );
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 860;
        if (wide) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(width: 280, child: _picker(catalog)),
              const VerticalDivider(width: 1, color: DanColors.border),
              Expanded(child: _previewPane()),
            ],
          );
        }
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: _dropdownPicker(catalog),
            ),
            Expanded(child: _previewPane()),
          ],
        );
      },
    );
  }

  // ── Pickers ─────────────────────────────────────────────────────────
  Widget _picker(ReportCatalog catalog) {
    return Container(
      color: DanColors.surface,
      child: ListView(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 10),
        children: [
          for (final g in catalog.groups) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 12, 8, 6),
              child: Text(
                g.label.toUpperCase(),
                style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: DanColors.faint,
                    letterSpacing: .3),
              ),
            ),
            for (final r in catalog.reports.where((r) => r.group == g.key))
              _ReportTile(
                info: r,
                active: r.key == _selectedKey,
                onTap: () => _select(r.key),
              ),
          ],
        ],
      ),
    );
  }

  Widget _dropdownPicker(ReportCatalog catalog) {
    return DropdownButtonFormField<String>(
      initialValue: _selectedKey,
      isExpanded: true,
      decoration: const InputDecoration(labelText: 'Báo cáo'),
      items: [
        for (final r in catalog.reports)
          DropdownMenuItem(
            value: r.key,
            child: Text(r.label, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: (v) {
        if (v != null) _select(v);
      },
    );
  }

  // ── Preview ─────────────────────────────────────────────────────────
  Widget _previewPane() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _toolbar(),
        const Divider(height: 1, color: DanColors.border),
        Expanded(child: _previewBody()),
      ],
    );
  }

  Widget _toolbar() {
    String dateText(DateTime? d) => d == null ? '—' : _ymd.format(d);
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Wrap(
        spacing: 10,
        runSpacing: 10,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          SegmentedTabs(
            labels: _periodLabels,
            selected: _periodIndex,
            onChanged: (i) {
              setState(() {
                _periodIndex = i;
                _from = null;
                _to = null;
              });
              _loadReport();
            },
          ),
          OutlinedButton.icon(
            onPressed: () => _pickDate(true),
            icon: const Icon(Icons.calendar_today, size: 14),
            label: Text('Từ: ${dateText(_from)}'),
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 36)),
          ),
          OutlinedButton.icon(
            onPressed: () => _pickDate(false),
            icon: const Icon(Icons.event, size: 14),
            label: Text('Đến: ${dateText(_to)}'),
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 36)),
          ),
          if ((_catalog?.branches.length ?? 0) > 1)
            OutlinedButton.icon(
              onPressed: _pickBranches,
              icon: const Icon(Icons.account_tree_outlined, size: 15),
              label: Text(_branchLabel),
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 36)),
            ),
          if (_from != null || _to != null)
            TextButton(
              onPressed: () {
                setState(() {
                  _from = null;
                  _to = null;
                });
                _loadReport();
              },
              child: const Text('Xóa lọc ngày'),
            ),
          const SizedBox(width: 8),
          _exportBtn('In', Icons.print_outlined, 'html', 'html'),
          _exportBtn('PDF', Icons.picture_as_pdf, 'pdf', 'pdf'),
          _exportBtn('Excel', Icons.table_chart, 'xlsx', 'xlsx'),
          _exportBtn(
              'Google Sheet', Icons.cloud_upload_outlined, 'gsheet', 'xlsx'),
        ],
      ),
    );
  }

  Widget _exportBtn(String label, IconData icon, String format, String ext) {
    return FilledButton.icon(
      onPressed: _exporting ? null : () => _export(format, ext),
      icon: Icon(icon, size: 15),
      label: Text(label),
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 36),
        backgroundColor: DanColors.surface2,
        foregroundColor: DanColors.text,
      ),
    );
  }

  Widget _previewBody() {
    if (_loadingReport && _report == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_reportError != null && _report == null) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage('Không tải được báo cáo ($_reportError)',
            error: true, onRetry: _loadReport),
      );
    }
    final r = _report;
    if (r == null) {
      return const Center(
          child: Text('Chọn một báo cáo',
              style: TextStyle(color: DanColors.faint)));
    }
    return Stack(
      children: [
        ListView(
          padding: const EdgeInsets.all(18),
          children: [
            Text(r.title,
                style:
                    const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
            const SizedBox(height: 4),
            Text(
              'Kỳ báo cáo: ${r.rangeLabel}${r.generatedAt.isNotEmpty ? ' · Xuất lúc: ${r.generatedAt}' : ''}',
              style: const TextStyle(fontSize: 12, color: DanColors.muted),
            ),
            const SizedBox(height: 16),
            if (r.summary.isNotEmpty) _summaryGrid(r.summary),
            const SizedBox(height: 8),
            for (final s in r.sections) ...[
              const SizedBox(height: 12),
              _section(s),
            ],
          ],
        ),
        if (_loadingReport)
          const Positioned(
            top: 8,
            right: 8,
            child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2)),
          ),
      ],
    );
  }

  Widget _summaryGrid(List<ReportSummaryStat> summary) {
    return LayoutBuilder(builder: (context, c) {
      final cols = c.maxWidth >= 900
          ? 4
          : c.maxWidth >= 600
              ? 3
              : 2;
      const gap = 10.0;
      final w = (c.maxWidth - gap * (cols - 1)) / cols;
      return Wrap(
        spacing: gap,
        runSpacing: gap,
        children: [
          for (final s in summary)
            SizedBox(
              width: w,
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: DanColors.surface,
                  border: Border.all(color: DanColors.border),
                  borderRadius: BorderRadius.circular(DanRadius.md),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(s.label,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 11.5, color: DanColors.muted)),
                    const SizedBox(height: 6),
                    Text(s.value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 17, fontWeight: FontWeight.w900)),
                  ],
                ),
              ),
            ),
        ],
      );
    });
  }

  Widget _section(ReportSection s) {
    return Panel(
      title: s.title,
      trailing: Text('${s.rows.length} dòng',
          style: const TextStyle(fontSize: 11.5, color: DanColors.faint)),
      child: s.rows.isEmpty
          ? const Padding(
              padding: EdgeInsets.symmetric(vertical: 14),
              child: Text('Không có dữ liệu',
                  style: TextStyle(color: DanColors.faint)),
            )
          : SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                headingRowHeight: 38,
                dataRowMinHeight: 36,
                dataRowMaxHeight: 56,
                headingTextStyle: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: DanColors.muted),
                dataTextStyle:
                    const TextStyle(fontSize: 12.5, color: DanColors.text),
                columns: [
                  for (final c in s.columns)
                    DataColumn(label: Text(c.label), numeric: c.right),
                ],
                rows: [
                  for (final row in s.rows)
                    DataRow(
                      cells: [
                        for (final c in s.columns)
                          DataCell(ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 280),
                            child: Text(
                              (row[c.key] ?? '').toString(),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          )),
                      ],
                    ),
                ],
              ),
            ),
    );
  }
}

class _ReportTile extends StatelessWidget {
  final ReportInfo info;
  final bool active;
  final VoidCallback onTap;

  const _ReportTile(
      {required this.info, required this.active, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(DanRadius.sm),
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 2),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
        decoration: BoxDecoration(
          color: active ? DanColors.brandDim : Colors.transparent,
          borderRadius: BorderRadius.circular(DanRadius.sm),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              info.label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: active ? DanColors.brand : DanColors.text,
              ),
            ),
            if (info.description.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(
                info.description,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontSize: 11, color: DanColors.faint, height: 1.3),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
