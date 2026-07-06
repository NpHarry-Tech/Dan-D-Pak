import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../widgets/dan_top_bar.dart';
import '../../widgets/manager_pin_dialog.dart';
import '../documents/documents_screen.dart';
import '../management/management_widgets.dart';

String _s(dynamic v) => v?.toString() ?? '';
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;

String _humanSize(num bytes) {
  if (bytes >= 1e9) return '${(bytes / 1e9).toStringAsFixed(2)} GB';
  if (bytes >= 1e6) return '${(bytes / 1e6).toStringAsFixed(1)} MB';
  if (bytes >= 1e3) return '${(bytes / 1e3).round()} KB';
  return '${bytes.round()} B';
}

String _two(int value) => value.toString().padLeft(2, '0');

String _dmy(DateTime d) => '${_two(d.day)}/${_two(d.month)}/${d.year}';

String _hm(DateTime d) => '${_two(d.hour)}:${_two(d.minute)}';

class DatabaseScreen extends StatefulWidget {
  const DatabaseScreen({super.key});

  @override
  State<DatabaseScreen> createState() => _DatabaseScreenState();
}

class _DatabaseScreenState extends State<DatabaseScreen> {
  int _tab = 0;

  static const _titles = [
    'Cơ sở dữ liệu',
    'Nhật ký hoạt động',
    'Tài liệu',
  ];

  static const _descriptions = [
    'Theo dõi động cơ dữ liệu local, sao lưu cấu hình và thống kê hệ thống.',
    'Lịch sử thao tác hệ thống, lỗi phát sinh và truy vết theo thời gian.',
    'Kho tài liệu nội bộ dùng cho vận hành và đào tạo.',
  ];

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentUser;
    final branch = auth.selectedBranch;

    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: DanModuleTopBar(
        brandName: branch.name.isNotEmpty ? branch.name : branch.id,
        title: 'Cơ sở dữ liệu & Tài liệu',
        subtitle: '',
        titleIcon: Icons.storage_outlined,
        userName: user?.name ?? '-',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < 860;
          if (compact) {
            return Column(
              children: [
                _nav(compact: true),
                const Divider(height: 1, color: DanColors.border),
                Expanded(child: _content()),
              ],
            );
          }
          return Row(
            children: [
              _nav(compact: false),
              const VerticalDivider(width: 1, color: DanColors.border),
              Expanded(child: _content()),
            ],
          );
        },
      ),
    );
  }

  Widget _content() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(22, 18, 22, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _titles[_tab],
                style:
                    const TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 5),
              Text(
                _descriptions[_tab],
                style: const TextStyle(color: DanColors.muted, fontSize: 13),
              ),
            ],
          ),
        ),
        const Divider(height: 1, color: DanColors.border),
        Expanded(
          child: _tab == 0
              ? const _DatabaseTab()
              : _tab == 1
                  ? const _AuditLogTab()
                  : const DocumentsBody(),
        ),
      ],
    );
  }

  Widget _nav({required bool compact}) {
    const items = [
      _NavItem(0, 'Cơ sở dữ liệu', Icons.storage_outlined),
      _NavItem(1, 'Nhật ký hoạt động', Icons.history_rounded),
      _NavItem(2, 'Tài liệu', Icons.folder_copy_outlined),
    ];

    if (compact) {
      return Container(
        height: 58,
        color: DanColors.surface,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: items.length,
          separatorBuilder: (_, __) => const SizedBox(width: 8),
          itemBuilder: (context, index) =>
              _navButton(items[index], compact: true),
        ),
      );
    }

    return Container(
      width: 230,
      color: DanColors.surface,
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final item in items) ...[
            _navButton(item, compact: false),
            const SizedBox(height: 8),
          ],
        ],
      ),
    );
  }

  Widget _navButton(_NavItem item, {required bool compact}) {
    final active = _tab == item.index;
    return InkWell(
      borderRadius: BorderRadius.circular(DanRadius.sm),
      onTap: () => setState(() => _tab = item.index),
      child: Container(
        width: compact ? 178 : null,
        padding: EdgeInsets.symmetric(
          horizontal: compact ? 12 : 14,
          vertical: compact ? 8 : 12,
        ),
        decoration: BoxDecoration(
          color: active ? DanColors.brandDim : Colors.transparent,
          borderRadius: BorderRadius.circular(DanRadius.sm),
        ),
        child: Row(
          mainAxisSize: compact ? MainAxisSize.min : MainAxisSize.max,
          children: [
            Icon(
              item.icon,
              size: 18,
              color: active ? DanColors.brand : DanColors.muted,
            ),
            const SizedBox(width: 9),
            Expanded(
              child: Text(
                item.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w800,
                  color: active ? DanColors.brand : DanColors.muted,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NavItem {
  final int index;
  final String label;
  final IconData icon;

  const _NavItem(this.index, this.label, this.icon);
}

class _DatabaseTab extends StatefulWidget {
  const _DatabaseTab();

  @override
  State<_DatabaseTab> createState() => _DatabaseTabState();
}

class _DatabaseTabState extends State<_DatabaseTab> {
  Map<String, dynamic>? _status;
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final status = await context.read<ApiService>().getDatabaseStatus();
      if (!mounted) return;
      setState(() {
        _status = status;
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

  void _toast(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? DanColors.late : DanColors.text,
      ),
    );
  }

  Future<void> _integrityCheck() async {
    setState(() => _busy = true);
    try {
      final result = await context.read<ApiService>().databaseIntegrityCheck();
      final ok = result['ok'] == true || _s(result['result']) == 'ok';
      _toast(ok ? 'CSDL toàn vẹn' : 'Kết quả: ${_s(result['result'])}');
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resetTransactions() async {
    final api = context.read<ApiService>();
    final pin = await requestManagerPin(
      context,
      'Xóa toàn bộ dữ liệu giao dịch như đơn, thanh toán, ca và phiếu. Giữ lại cấu hình. Cần PIN Admin.',
    );
    if (pin == null) return;
    setState(() => _busy = true);
    try {
      await api.databaseResetTransactions(pin);
      _toast('Đã reset dữ liệu giao dịch');
      await _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cloneStaging() async {
    final api = context.read<ApiService>();
    final pin = await requestManagerPin(
      context,
      'Tạo bản sao CSDL sang môi trường staging. Cần PIN Admin.',
    );
    if (pin == null) return;
    setState(() => _busy = true);
    try {
      await api.databaseCloneToStaging(pin);
      _toast('Đã clone sang staging');
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _exportConfig() async {
    final api = context.read<ApiService>();
    setState(() => _busy = true);
    try {
      final data = await api.exportConfig();
      final jsonText = const JsonEncoder.withIndent('  ').convert(data);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Xuất cấu hình'),
          content: SizedBox(
            width: 680,
            height: 360,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: DanColors.surface2,
                borderRadius: BorderRadius.circular(DanRadius.sm),
                border: Border.all(color: DanColors.border),
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(12),
                child: SelectableText(
                  jsonText,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12,
                    height: 1.35,
                  ),
                ),
              ),
            ),
          ),
          actions: [
            TextButton.icon(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: jsonText));
                Navigator.of(dialogContext).pop();
                _toast('Đã copy JSON cấu hình');
              },
              icon: const Icon(Icons.copy_all_outlined),
              label: const Text('Copy'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Đóng'),
            ),
          ],
        ),
      );
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _importConfig() async {
    final api = context.read<ApiService>();
    final controller = TextEditingController();
    final raw = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Phục hồi cấu hình'),
        content: SizedBox(
          width: 640,
          child: TextField(
            controller: controller,
            minLines: 10,
            maxLines: 14,
            decoration: const InputDecoration(
              hintText: 'Dán nội dung JSON cấu hình đã xuất...',
            ),
            style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Hủy'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(controller.text.trim()),
            child: const Text('Phục hồi'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (!mounted || raw == null || raw.isEmpty) return;

    setState(() => _busy = true);
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) {
        throw const FormatException('File cấu hình phải là JSON object');
      }
      await api.importConfig(Map<String, dynamic>.from(decoded));
      _toast('Đã phục hồi cấu hình');
      await _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _status == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _status == null) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage(
          'Không tải được trạng thái CSDL ($_error)',
          error: true,
          onRetry: _load,
        ),
      );
    }

    final status = _status ?? {};
    final dbSize = _n(status['dbSize'] ?? status['size']);
    final config = _map(status['configCounts']);
    final txn = _map(status['transactionCounts']);
    final configRows =
        config.values.fold<num>(0, (sum, value) => sum + _n(value));
    final txnRows = txn.values.fold<num>(0, (sum, value) => sum + _n(value));

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              final wide = constraints.maxWidth >= 960;
              final cards = [
                KpiCard(
                  label: 'Dung lượng CSDL',
                  value: _humanSize(dbSize),
                  valueColor: DanColors.brand,
                ),
                KpiCard(
                  label: 'Bảng cấu hình',
                  value: '${config.length}',
                ),
                KpiCard(
                  label: 'Bảng giao dịch',
                  value: '${txn.length}',
                ),
              ];
              if (!wide) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var i = 0; i < cards.length; i++) ...[
                      cards[i],
                      if (i < cards.length - 1) const SizedBox(height: 12),
                    ],
                  ],
                );
              }
              return IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var i = 0; i < cards.length; i++) ...[
                      Expanded(child: cards[i]),
                      if (i < cards.length - 1) const SizedBox(width: 12),
                    ],
                  ],
                ),
              );
            },
          ),
          const SizedBox(height: 16),
          LayoutBuilder(
            builder: (context, constraints) {
              final columns = constraints.maxWidth >= 1480
                  ? 4
                  : constraints.maxWidth >= 1120
                      ? 3
                      : constraints.maxWidth >= 720
                          ? 2
                          : 1;
              const gap = 14.0;
              final cardWidth =
                  (constraints.maxWidth - (gap * (columns - 1))) / columns;
              return Wrap(
                spacing: gap,
                runSpacing: gap,
                children: [
                  SizedBox(
                    width: cardWidth,
                    child: _DbCard(
                      icon: Icons.storage_outlined,
                      title: 'Động cơ CSDL Local',
                      description:
                          'Quản lý và kiểm tra sức khỏe cơ sở dữ liệu SQLite tại cửa hàng',
                      child: Column(
                        children: [
                          _infoLine('Loại database', _s(status['dbType'])),
                          _infoLine('Dung lượng file', _humanSize(dbSize)),
                          _infoLine(
                              'SQLite Version', _s(status['sqliteVersion'])),
                          _infoLine('Journal Mode', _s(status['journalMode'])),
                          const SizedBox(height: 10),
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              onPressed: _busy ? null : _integrityCheck,
                              icon: const Icon(Icons.verified_user_outlined),
                              label: const Text('Kiểm tra tính toàn vẹn'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  SizedBox(
                    width: cardWidth,
                    child: _DbCard(
                      icon: Icons.cloud_upload_outlined,
                      title: 'Sao lưu & Phục hồi cấu hình',
                      description:
                          'Sao lưu/phục hồi danh mục, nhân sự, menu, cài đặt. Không bao gồm dữ liệu giao dịch đơn hàng',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          FilledButton.icon(
                            onPressed: _busy ? null : _exportConfig,
                            icon: const Icon(Icons.file_download_outlined),
                            label: const Text('Tải xuống cấu hình (.json)'),
                          ),
                          const SizedBox(height: 10),
                          OutlinedButton.icon(
                            onPressed: _busy ? null : _importConfig,
                            icon: const Icon(Icons.file_upload_outlined),
                            label: const Text('Phục hồi từ JSON'),
                          ),
                        ],
                      ),
                    ),
                  ),
                  SizedBox(
                    width: cardWidth,
                    child: _DbCard(
                      icon: Icons.science_outlined,
                      title: 'Môi trường Staging & Reset giao dịch',
                      description:
                          'Tạo môi trường thử nghiệm hoặc dọn dẹp các đơn hàng chạy thử trước khi khai trương',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          OutlinedButton.icon(
                            onPressed: _busy ? null : _cloneStaging,
                            icon: const Icon(Icons.call_split_outlined),
                            label: const Text('Nhân bản sang Staging'),
                          ),
                          const SizedBox(height: 10),
                          OutlinedButton.icon(
                            onPressed: _busy ? null : _resetTransactions,
                            icon: const Icon(Icons.cleaning_services),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: DanColors.late,
                              side: const BorderSide(color: DanColors.late),
                            ),
                            label: const Text('Dọn sạch giao dịch & Reset bàn'),
                          ),
                          const SizedBox(height: 12),
                          _notice(
                            'Thao tác dọn sạch giao dịch sẽ xóa vĩnh viễn toàn bộ hóa đơn, ca làm và chi phí tại local.',
                            danger: true,
                          ),
                        ],
                      ),
                    ),
                  ),
                  SizedBox(
                    width: cardWidth,
                    child: _DbCard(
                      icon: Icons.bar_chart_outlined,
                      title: 'Thống kê Cơ sở dữ liệu',
                      description:
                          'Số lượng bảng ghi hiện tại trong hệ thống CSDL local',
                      child: Column(
                        children: [
                          _infoLine('Bảng cấu hình', '${config.length} bảng'),
                          _infoLine(
                              'Dòng cấu hình', '${configRows.round()} hàng'),
                          _infoLine('Bảng giao dịch', '${txn.length} bảng'),
                          _infoLine(
                              'Dòng giao dịch', '${txnRows.round()} hàng'),
                          _infoLine('Tổng số hóa đơn',
                              '${_n(txn['invoices']).round()}'),
                          _infoLine(
                              'Tổng số ca làm', '${_n(txn['shifts']).round()}'),
                          _infoLine(
                            'Nhật ký hoạt động',
                            '${_n(txn['audit_log']).round()}',
                            valueColor: DanColors.brand,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: 16),
          Panel(
            title: 'Bảng cấu hình (giữ khi reset)',
            child: _countGrid(config),
          ),
          const SizedBox(height: 16),
          Panel(
            title: 'Bảng giao dịch',
            child: _countGrid(txn),
          ),
        ],
      ),
    );
  }

  Map<String, dynamic> _map(dynamic value) {
    if (value is Map) return Map<String, dynamic>.from(value);
    return <String, dynamic>{};
  }

  Widget _infoLine(String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(color: DanColors.muted, fontSize: 12),
            ),
          ),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value.isEmpty ? '-' : value,
              textAlign: TextAlign.right,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: valueColor ?? DanColors.text,
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _notice(String text, {bool danger = false}) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: danger ? const Color(0xFFFFF1F1) : DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.sm),
        border: Border.all(color: danger ? DanColors.late : DanColors.border),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: danger ? DanColors.late : DanColors.muted,
          fontSize: 11.5,
          height: 1.35,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _countGrid(Map<String, dynamic> counts) {
    if (counts.isEmpty) {
      return const Text('-', style: TextStyle(color: DanColors.faint));
    }
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final entry in counts.entries)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: DanColors.surface2,
              borderRadius: BorderRadius.circular(7),
            ),
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '${entry.key}: ',
                    style: const TextStyle(
                      fontSize: 11.5,
                      color: DanColors.muted,
                    ),
                  ),
                  TextSpan(
                    text: '${entry.value}',
                    style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _DbCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String description;
  final Widget child;

  const _DbCard({
    required this.icon,
    required this.title,
    required this.description,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 286),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.lg),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A102840),
            blurRadius: 2,
            offset: Offset(0, 1),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: DanColors.surface2,
                  borderRadius: BorderRadius.circular(DanRadius.sm),
                ),
                child: Icon(icon, size: 18, color: DanColors.muted),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 15, fontWeight: FontWeight.w900),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            description,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: DanColors.muted,
              fontSize: 12,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 18),
          child,
        ],
      ),
    );
  }
}

class _AuditLogTab extends StatefulWidget {
  const _AuditLogTab();

  @override
  State<_AuditLogTab> createState() => _AuditLogTabState();
}

class _AuditLogTabState extends State<_AuditLogTab> {
  static const _pageSize = 50;

  final _search = TextEditingController();
  final List<Map<String, dynamic>> _rows = [];

  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  String? _cursor;
  String? _error;
  String _granularity = '';
  DateTime _anchor = DateTime.now();
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 5), (timer) {
      if (mounted && !_loading && !_loadingMore && _search.text.isEmpty && _granularity.isEmpty) {
        _load(silent: true);
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({bool append = false, bool silent = false}) async {
    if (append && (!_hasMore || _loadingMore || _cursor == null)) return;
    final api = context.read<ApiService>();
    final range = _range();
    if (!silent) {
      setState(() {
        if (append) {
          _loadingMore = true;
        } else {
          _loading = true;
          _error = null;
        }
      });
    }

    try {
      final data = await api.getAuditLogs(
        limit: _pageSize,
        before: append ? _cursor ?? '' : '',
        search: _search.text.trim(),
        from: range.from == null ? '' : range.from!.toUtc().toIso8601String(),
        to: range.to == null ? '' : range.to!.toUtc().toIso8601String(),
      );
      final nextRows = data
          .map((item) =>
              item is Map ? Map<String, dynamic>.from(item) : {'detail': item})
          .toList();
      if (!mounted) return;
      setState(() {
        if (append) {
          _rows.addAll(nextRows);
        } else {
          _rows
            ..clear()
            ..addAll(nextRows);
        }
        _cursor = nextRows.isEmpty ? _cursor : _s(nextRows.last['created_at']);
        _hasMore = nextRows.length >= _pageSize;
        if (!silent) {
          _loading = false;
          _loadingMore = false;
          _error = null;
        }
      });
    } catch (e) {
      if (!silent) {
        if (!mounted) return;
        setState(() {
          _error = e.toString().replaceFirst('Exception: ', '');
          _loading = false;
          _loadingMore = false;
        });
      }
    }
  }

  void _resetFilters() {
    setState(() {
      _search.clear();
      _granularity = '';
      _anchor = DateTime.now();
    });
    _load();
  }

  void _shiftPeriod(int delta) {
    setState(() {
      switch (_granularity) {
        case 'day':
          _anchor = _anchor.add(Duration(days: delta));
        case 'week':
          _anchor = _anchor.add(Duration(days: 7 * delta));
        case 'month':
          _anchor = DateTime(_anchor.year, _anchor.month + delta, 1);
        case 'quarter':
          _anchor = DateTime(_anchor.year, _anchor.month + (delta * 3), 1);
        case 'year':
          _anchor = DateTime(_anchor.year + delta, 1, 1);
      }
    });
    _load();
  }

  Future<void> _pickAnchor() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _anchor,
      firstDate: DateTime(2020),
      lastDate: DateTime(DateTime.now().year + 1, 12, 31),
    );
    if (picked == null || !mounted) return;
    setState(() => _anchor = picked);
    _load();
  }

  _AuditRange _range() {
    final day = DateTime(_anchor.year, _anchor.month, _anchor.day);
    switch (_granularity) {
      case 'day':
        return _AuditRange(day, day.add(const Duration(days: 1)));
      case 'week':
        final monday = day.subtract(Duration(days: day.weekday - 1));
        return _AuditRange(monday, monday.add(const Duration(days: 7)));
      case 'month':
        final start = DateTime(day.year, day.month, 1);
        return _AuditRange(start, DateTime(day.year, day.month + 1, 1));
      case 'quarter':
        final quarterStartMonth = ((day.month - 1) ~/ 3) * 3 + 1;
        final start = DateTime(day.year, quarterStartMonth, 1);
        return _AuditRange(start, DateTime(day.year, quarterStartMonth + 3, 1));
      case 'year':
        final start = DateTime(day.year, 1, 1);
        return _AuditRange(start, DateTime(day.year + 1, 1, 1));
    }
    return const _AuditRange(null, null);
  }

  String _periodLabel() {
    final range = _range();
    if (range.from == null || range.to == null) return 'Tất cả lịch sử';
    final from = range.from!;
    final to = range.to!.subtract(const Duration(days: 1));
    switch (_granularity) {
      case 'day':
        return _dmy(from);
      case 'week':
        return '${_dmy(from)} - ${_dmy(to)}';
      case 'month':
        return 'Tháng ${from.month}/${from.year}';
      case 'quarter':
        return 'Quý ${((from.month - 1) ~/ 3) + 1}/${from.year}';
      case 'year':
        return 'Năm ${from.year}';
    }
    return 'Tất cả lịch sử';
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          const Text(
            'Nhật ký hoạt động hệ thống được lưu trong SQLite local tối đa 3 năm. Các dòng lỗi có thể mở ra để xem nguyên nhân chi tiết.',
            style: TextStyle(color: DanColors.muted, fontSize: 13),
          ),
          const SizedBox(height: 14),
          _filterBar(),
          const SizedBox(height: 16),
          if (_loading && _rows.isEmpty)
            const SizedBox(
              height: 260,
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_error != null && _rows.isEmpty)
            InlineMessage(
              'Không tải được nhật ký hoạt động ($_error)',
              error: true,
              onRetry: _load,
            )
          else
            Panel(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
              child: Column(
                children: [
                  if (_error != null) ...[
                    InlineMessage(
                      'Không tải thêm được nhật ký ($_error)',
                      error: true,
                      onRetry: () => _load(append: true),
                    ),
                    const SizedBox(height: 10),
                  ],
                  if (_rows.isEmpty)
                    const SizedBox(
                      height: 220,
                      child: Center(
                        child: Text(
                          'Không có nhật ký trong bộ lọc này',
                          style: TextStyle(color: DanColors.faint),
                        ),
                      ),
                    )
                  else
                    for (var i = 0; i < _rows.length; i++) ...[
                      _AuditLogRow(
                        entry: _rows[i],
                        api: context.read<ApiService>(),
                      ),
                      if (i < _rows.length - 1)
                        const Divider(height: 1, color: DanColors.border),
                    ],
                  if (_hasMore) ...[
                    const Divider(height: 20, color: DanColors.border),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed:
                            _loadingMore ? null : () => _load(append: true),
                        icon: _loadingMore
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.expand_more),
                        label: const Text('Xem thêm'),
                      ),
                    ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _filterBar() {
    return Panel(
      child: LayoutBuilder(
        builder: (context, constraints) {
          const controlHeight = 48.0;
          const actionWidth = 98.0;
          final searchWidth = constraints.maxWidth >= 1180
              ? constraints.maxWidth - 720
              : constraints.maxWidth >= 760
                  ? 360.0
                  : constraints.maxWidth;
          return Wrap(
            spacing: 10,
            runSpacing: 10,
            crossAxisAlignment: WrapCrossAlignment.end,
            children: [
              SizedBox(
                width: 170,
                child: DropdownButtonFormField<String>(
                  initialValue: _granularity,
                  decoration: const InputDecoration(labelText: 'Thời gian'),
                  items: const [
                    DropdownMenuItem(value: '', child: Text('Tất cả lịch sử')),
                    DropdownMenuItem(value: 'day', child: Text('Theo ngày')),
                    DropdownMenuItem(value: 'week', child: Text('Theo tuần')),
                    DropdownMenuItem(value: 'month', child: Text('Theo tháng')),
                    DropdownMenuItem(value: 'quarter', child: Text('Theo quý')),
                    DropdownMenuItem(value: 'year', child: Text('Theo năm')),
                  ],
                  onChanged: (value) {
                    setState(() {
                      _granularity = value ?? '';
                      _anchor = DateTime.now();
                    });
                    _load();
                  },
                ),
              ),
              if (_granularity.isNotEmpty)
                SizedBox(width: 330, child: _periodControl()),
              SizedBox(
                width: searchWidth,
                height: controlHeight,
                child: Center(
                  child: TextField(
                    controller: _search,
                    onSubmitted: (_) => _load(),
                    decoration: const InputDecoration(
                      isDense: true,
                      labelText: 'Tìm kiếm',
                      hintText: 'Tìm theo hành động, nhân viên, nội dung...',
                      prefixIcon: Icon(Icons.search),
                      prefixIconConstraints:
                          BoxConstraints(minWidth: 42, minHeight: 42),
                      contentPadding:
                          EdgeInsets.symmetric(horizontal: 12, vertical: 13),
                    ),
                  ),
                ),
              ),
              SizedBox(
                width: actionWidth,
                height: controlHeight,
                child: FilledButton.icon(
                  onPressed: _loading ? null : _load,
                  icon: const Icon(Icons.filter_alt_outlined, size: 18),
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    textStyle: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  label: const Text('Lọc'),
                ),
              ),
              SizedBox(
                width: actionWidth,
                height: controlHeight,
                child: OutlinedButton.icon(
                  onPressed: _loading ? null : _resetFilters,
                  icon: const Icon(Icons.restart_alt, size: 18),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    textStyle: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  label: const Text('Reset'),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _periodControl() {
    return Container(
      height: 48,
      padding: const EdgeInsets.symmetric(horizontal: 4),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.sm),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Kỳ trước',
            onPressed: () => _shiftPeriod(-1),
            icon: const Icon(Icons.chevron_left),
          ),
          Expanded(
            child: Text(
              _periodLabel(),
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style:
                  const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800),
            ),
          ),
          IconButton(
            tooltip: 'Chọn ngày',
            onPressed: _pickAnchor,
            icon: const Icon(Icons.calendar_month_outlined),
          ),
          IconButton(
            tooltip: 'Kỳ sau',
            onPressed: () => _shiftPeriod(1),
            icon: const Icon(Icons.chevron_right),
          ),
        ],
      ),
    );
  }
}

class _AuditRange {
  final DateTime? from;
  final DateTime? to;

  const _AuditRange(this.from, this.to);
}

class _AuditLogRow extends StatefulWidget {
  final Map<String, dynamic> entry;
  final ApiService api;

  const _AuditLogRow({
    required this.entry,
    required this.api,
  });

  @override
  State<_AuditLogRow> createState() => _AuditLogRowState();
}

class _AuditLogRowState extends State<_AuditLogRow> {
  bool _expanded = false;
  bool _decrypting = false;
  String? _decrypted;

  Future<void> _decrypt() async {
    final id = _s(widget.entry['id']);
    if (id.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Nhật ký này chưa có id để giải mã'),
          backgroundColor: DanColors.late,
        ),
      );
      return;
    }
    setState(() => _decrypting = true);
    try {
      final result = await widget.api.decryptAuditLog(id);
      if (!mounted) return;
      setState(() {
        _decrypted = _s(result['decrypted']);
        _decrypting = false;
        _expanded = true;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _decrypting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final action = _s(widget.entry['action']);
    final createdAt =
        DateTime.tryParse(_s(widget.entry['created_at']))?.toLocal();
    final actor = _s(widget.entry['actor']);
    final rawDetail = _decrypted ?? _s(widget.entry['detail']);
    final encrypted =
        _isEncrypted(widget.entry['detail']) && _decrypted == null;
    final detail = _detailMap(rawDetail);
    final summary = _summaryFor(action, detail, actor);
    final isError = _isErrorAction(action);
    final expandable = isError || encrypted || detail.isNotEmpty;

    return InkWell(
      onTap: expandable ? () => setState(() => _expanded = !_expanded) : null,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 8),
        padding: const EdgeInsets.fromLTRB(10, 10, 10, 12),
        decoration: BoxDecoration(
          color: isError ? const Color(0xFFFFE9E9) : Colors.transparent,
          borderRadius: BorderRadius.circular(DanRadius.sm),
          border: isError
              ? const Border(left: BorderSide(color: Colors.red, width: 3))
              : null,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 76,
              child: Text(
                createdAt == null ? '-' : _hm(createdAt),
                style: const TextStyle(
                  color: DanColors.faint,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 8,
                    runSpacing: 5,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (isError) _badge('Lỗi', DanColors.late),
                      if (encrypted) _badge('Mã hóa', DanColors.muted),
                      Text(
                        summary.title,
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      if (actor.isNotEmpty && actor != 'system')
                        _badge(actor.toUpperCase(), DanColors.muted),
                    ],
                  ),
                  if (summary.meta.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      summary.meta,
                      style: TextStyle(
                        color: isError ? DanColors.late : DanColors.faint,
                        fontSize: 11.5,
                        fontWeight: isError ? FontWeight.w700 : FontWeight.w500,
                      ),
                    ),
                  ],
                  if (createdAt != null) ...[
                    const SizedBox(height: 3),
                    Text(
                      '${_dmy(createdAt)} lúc ${_hm(createdAt)}',
                      style:
                          const TextStyle(color: DanColors.faint, fontSize: 11),
                    ),
                  ],
                  if (expandable) ...[
                    const SizedBox(height: 7),
                    Text(
                      _expanded ? 'Thu gọn' : 'Bấm để xem chi tiết',
                      style: TextStyle(
                        color: isError ? DanColors.late : DanColors.brand,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                  if (_expanded) ...[
                    const SizedBox(height: 10),
                    _detailBox(detail, encrypted),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _detailBox(Map<String, dynamic> detail, bool encrypted) {
    if (encrypted) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: _detailDecoration(),
        child: Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            onPressed: _decrypting ? null : _decrypt,
            icon: _decrypting
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.lock_open_outlined),
            label: const Text('Giải mã chi tiết'),
          ),
        ),
      );
    }

    if (detail.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: _detailDecoration(),
        child: const Text(
          'Không có chi tiết bổ sung',
          style: TextStyle(color: DanColors.faint, fontSize: 12),
        ),
      );
    }

    final rows = <Widget>[];
    void add(String label, dynamic value) {
      final text = _stringify(value);
      if (text.isEmpty) return;
      rows.add(_detailLine(label, text));
    }

    add('Nguyên nhân', detail['message'] ?? detail['error']);
    add('Mã lỗi', detail['code']);
    add(
        'Vị trí',
        [_s(detail['method']), _s(detail['path'])]
            .where((part) => part.isNotEmpty)
            .join(' '));
    add('Mã trạng thái', detail['status']);
    add('Chi tiết', detail['details'] ?? detail['detail'] ?? detail['raw']);

    final shownKeys = {
      'message',
      'error',
      'code',
      'method',
      'path',
      'status',
      'details',
      'detail',
      'raw',
      'stack',
    };
    for (final entry in detail.entries) {
      if (!shownKeys.contains(entry.key)) add(entry.key, entry.value);
    }

    final stackText = _stringify(detail['stack']);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: _detailDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (rows.isEmpty)
            const Text(
              'Không có chi tiết bổ sung',
              style: TextStyle(color: DanColors.faint, fontSize: 12),
            )
          else
            ...rows,
          if (stackText.isNotEmpty) ...[
            const SizedBox(height: 10),
            const Text(
              'Ngăn xếp kỹ thuật (debug)',
              style: TextStyle(
                color: DanColors.muted,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFE9EDF2),
                borderRadius: BorderRadius.circular(DanRadius.sm),
              ),
              child: SelectableText(
                stackText,
                style: const TextStyle(
                  color: DanColors.muted,
                  fontFamily: 'monospace',
                  fontSize: 11,
                  height: 1.35,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  BoxDecoration _detailDecoration() {
    return BoxDecoration(
      color: DanColors.surface2,
      borderRadius: BorderRadius.circular(DanRadius.sm),
      border: Border.all(color: DanColors.border),
    );
  }

  Widget _detailLine(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 112,
            child: Text(
              label,
              style: const TextStyle(
                color: DanColors.muted,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          Expanded(
            child: SelectableText(
              value,
              style: const TextStyle(
                color: DanColors.text,
                fontSize: 12,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _badge(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

bool _isEncrypted(dynamic value) => _s(value).startsWith('__ENC__:');

bool _isErrorAction(String action) {
  return action == 'system.error' || action.endsWith('.error');
}

Map<String, dynamic> _detailMap(dynamic value) {
  if (value is Map) return Map<String, dynamic>.from(value);
  final text = _s(value).trim();
  if (text.isEmpty || text.startsWith('__ENC__:')) return <String, dynamic>{};
  try {
    final decoded = jsonDecode(text);
    if (decoded is Map) return Map<String, dynamic>.from(decoded);
    return {'raw': decoded};
  } catch (_) {
    return {'raw': text};
  }
}

String _stringify(dynamic value) {
  if (value == null) return '';
  if (value is String) return value.trim();
  if (value is num || value is bool) return value.toString();
  try {
    return const JsonEncoder.withIndent('  ').convert(value);
  } catch (_) {
    return value.toString();
  }
}

_AuditSummary _summaryFor(
  String action,
  Map<String, dynamic> detail,
  String actor,
) {
  final message = _stringify(detail['message'] ?? detail['error']);
  final code = _stringify(detail['code']);
  final target = _stringify(detail['target'] ?? detail['path']);

  if (action == 'system.error') {
    return _AuditSummary(
      'Hệ thống gặp lỗi khi xử lý một thao tác.',
      message.isNotEmpty ? message : code,
    );
  }
  if (action.endsWith('.error')) {
    return _AuditSummary(
      'Thao tác phát sinh lỗi.',
      message.isNotEmpty ? message : code,
    );
  }

  final who = actor.isEmpty || actor == 'system' ? 'Hệ thống' : actor;
  switch (action) {
    case 'auth.login':
      return _AuditSummary('$who đã đăng nhập vào hệ thống.', target);
    case 'auth.logout':
      return _AuditSummary('$who đã đăng xuất khỏi hệ thống.', target);
    case 'device.connect':
      return _AuditSummary('$who vừa kết nối vào hệ thống.', target);
    case 'db.reset_transactions':
      return const _AuditSummary(
        'Đã dọn sạch dữ liệu giao dịch và reset bàn.',
        'Thao tác quản trị cơ sở dữ liệu',
      );
    case 'db.clone_to_staging':
      return const _AuditSummary(
        'Đã nhân bản cơ sở dữ liệu sang staging.',
        'Thao tác quản trị cơ sở dữ liệu',
      );
    case 'config.export':
      return const _AuditSummary('Đã xuất cấu hình hệ thống.', '');
    case 'config.import':
      return const _AuditSummary('Đã phục hồi cấu hình hệ thống.', '');
    case 'payment.done':
      return _AuditSummary('Đã ghi nhận thanh toán.', target);
    case 'retail.refund':
      return _AuditSummary('Đã xử lý đổi trả bán lẻ.', target);
    case 'invoice.cancel':
      return _AuditSummary('Đã hủy hóa đơn.', target);
    case 'print.job':
      return _AuditSummary('Đã tạo lệnh in.', target);
    case 'dms.upload':
      return _AuditSummary('Đã tải tài liệu lên hệ thống.', target);
    case 'dms.update':
      return _AuditSummary('Đã cập nhật tài liệu.', target);
    case 'dms.delete':
      return _AuditSummary('Đã xóa tài liệu.', target);
  }

  if (action.startsWith('menu.')) {
    return _AuditSummary('Đã cập nhật thực đơn.', target);
  }
  if (action.startsWith('sku.') || action.startsWith('inventory.')) {
    return _AuditSummary('Đã cập nhật hàng hóa/kho.', target);
  }
  if (action.startsWith('voucher.')) {
    return _AuditSummary('Đã cập nhật voucher.', target);
  }
  if (action.startsWith('user.') || action.startsWith('permission.')) {
    return _AuditSummary('Đã cập nhật nhân sự/phân quyền.', target);
  }

  return _AuditSummary(action.isEmpty ? 'Hoạt động hệ thống' : action, message);
}

class _AuditSummary {
  final String title;
  final String meta;

  const _AuditSummary(this.title, this.meta);
}
