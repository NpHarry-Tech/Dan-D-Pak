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
import '../../utils/translation.dart';

String _s(dynamic v) => _repairMojibake(v?.toString() ?? '');
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;

String _repairMojibake(String input) {
  if (input.isEmpty || !RegExp(r'[ÃÂÄÆâá]').hasMatch(input)) return input;
  final bytes = <int>[];
  for (final unit in input.runes) {
    final mapped = _windows1252Byte(unit);
    if (mapped == null) return input;
    bytes.add(mapped);
  }
  final repaired = utf8.decode(bytes, allowMalformed: true);
  return _mojibakeScore(repaired) < _mojibakeScore(input) ? repaired : input;
}

int? _windows1252Byte(int unit) {
  if (unit <= 0xFF) return unit;
  final map = <int, int>{
    0x20AC: 0x80,
    0x201A: 0x82,
    0x0192: 0x83,
    0x201E: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02C6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8A,
    0x2039: 0x8B,
    0x0152: 0x8C,
    0x017D: 0x8E,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201C: 0x93,
    0x201D: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02DC: 0x98,
    0x2122: 0x99,
    0x0161: 0x9A,
    0x203A: 0x9B,
    0x0153: 0x9C,
    0x017E: 0x9E,
    0x0178: 0x9F,
  };
  return map[unit];
}

int _mojibakeScore(String text) =>
    RegExp(r'[ÃÂÄÆâ]|á[º»]').allMatches(text).length;

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
  DatabaseScreen({super.key});

  @override
  State<DatabaseScreen> createState() => _DatabaseScreenState();
}

class _DatabaseScreenState extends State<DatabaseScreen> {
  int _tab = 0;

  static final _titles = [
    t('Cơ sở dữ liệu'),
    t('Nhật ký hoạt động'),
    t('Tài liệu'),
  ];

  static final _descriptions = [
    t('Theo dõi động cơ dữ liệu local, sao lưu cấu hình và thống kê hệ thống.'),
    t('Lịch sử thao tác hệ thống, lỗi phát sinh và truy vết theo thời gian.'),
    t('Kho tài liệu nội bộ dùng cho vận hành và đào tạo.'),
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
        title: t('Cơ sở dữ liệu & Tài liệu'),
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
                Divider(height: 1, color: DanColors.border),
                Expanded(child: _content()),
              ],
            );
          }
          return Row(
            children: [
              _nav(compact: false),
              VerticalDivider(width: 1, color: DanColors.border),
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
          padding: EdgeInsets.fromLTRB(22, 18, 22, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _titles[_tab],
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
              ),
              SizedBox(height: 5),
              Text(
                _descriptions[_tab],
                style: TextStyle(color: DanColors.muted, fontSize: 13),
              ),
            ],
          ),
        ),
        Divider(height: 1, color: DanColors.border),
        Expanded(
          child: _tab == 0
              ? _DatabaseTab()
              : _tab == 1
                  ? _AuditLogTab()
                  : DocumentsBody(),
        ),
      ],
    );
  }

  Widget _nav({required bool compact}) {
    final items = [
      _NavItem(0, t('Cơ sở dữ liệu'), Icons.storage_outlined),
      _NavItem(1, t('Nhật ký hoạt động'), Icons.history_rounded),
      _NavItem(2, t('Tài liệu'), Icons.folder_copy_outlined),
    ];

    if (compact) {
      return Container(
        height: 58,
        color: DanColors.surface,
        padding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: items.length,
          separatorBuilder: (_, __) => SizedBox(width: 8),
          itemBuilder: (context, index) =>
              _navButton(items[index], compact: true),
        ),
      );
    }

    return Container(
      width: 230,
      color: DanColors.surface,
      padding: EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final item in items) ...[
            _navButton(item, compact: false),
            SizedBox(height: 8),
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
            SizedBox(width: 9),
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

  _NavItem(this.index, this.label, this.icon);
}

class _DatabaseTab extends StatefulWidget {
  _DatabaseTab();

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

  void _toast(String message, {bool error = false}) =>
      appToast(context, message, isError: error);

  Future<void> _integrityCheck() async {
    setState(() => _busy = true);
    try {
      final result = await context.read<ApiService>().databaseIntegrityCheck();
      final ok = result['ok'] == true || _s(result['result']) == 'ok';
      _toast(ok ? t('CSDL toàn vẹn') : 'Kết quả: ${_s(result['result'])}');
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
      t('Xóa toàn bộ dữ liệu giao dịch như đơn, thanh toán, ca và phiếu. Giữ lại cấu hình. Cần PIN Admin.'),
    );
    if (pin == null) return;
    setState(() => _busy = true);
    try {
      await api.databaseResetTransactions(pin);
      _toast(t('Đã reset dữ liệu giao dịch'));
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
      return Center(child: CircularProgressIndicator());
    }
    if (_error != null && _status == null) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(
          t('Không tải được trạng thái CSDL ($_error)'),
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
        padding: EdgeInsets.all(18),
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              final wide = constraints.maxWidth >= 960;
              final cards = [
                KpiCard(
                  label: t('Dung lượng CSDL'),
                  value: _humanSize(dbSize),
                  valueColor: DanColors.brand,
                ),
                KpiCard(
                  label: t('Bảng cấu hình'),
                  value: '${config.length}',
                ),
                KpiCard(
                  label: t('Bảng giao dịch'),
                  value: '${txn.length}',
                ),
              ];
              if (!wide) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var i = 0; i < cards.length; i++) ...[
                      cards[i],
                      if (i < cards.length - 1) SizedBox(height: 12),
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
                      if (i < cards.length - 1) SizedBox(width: 12),
                    ],
                  ],
                ),
              );
            },
          ),
          SizedBox(height: 16),
          LayoutBuilder(
            builder: (context, constraints) {
              final columns = constraints.maxWidth >= 1480
                  ? 4
                  : constraints.maxWidth >= 1120
                      ? 3
                      : constraints.maxWidth >= 720
                          ? 2
                          : 1;
              final gap = 14.0;
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
                      title: t('Động cơ CSDL Local'),
                      description: t(
                          'Quản lý và kiểm tra sức khỏe cơ sở dữ liệu SQLite tại cửa hàng'),
                      child: Column(
                        children: [
                          _infoLine(t('Loại database'), _s(status['dbType'])),
                          _infoLine(t('Dung lượng file'), _humanSize(dbSize)),
                          _infoLine(
                              'SQLite Version', _s(status['sqliteVersion'])),
                          _infoLine('Journal Mode', _s(status['journalMode'])),
                          SizedBox(height: 10),
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              onPressed: _busy ? null : _integrityCheck,
                              icon: Icon(Icons.verified_user_outlined),
                              label: Text(t('Kiểm tra tính toàn vẹn')),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  // (Card "Sao lưu & Phục hồi cấu hình" JSON đã gỡ 2026-07-16:
                  //  cơ chế thời server free không có disk — dữ liệu thật giờ
                  //  sống bền trong SQLite + backup hằng ngày.)
                  SizedBox(
                    width: cardWidth,
                    child: _DbCard(
                      icon: Icons.cleaning_services_outlined,
                      title: t('Dọn dữ liệu giao dịch'),
                      description: t(
                          'Dọn đơn hàng chạy thử trước khi khai trương. Không tạo database phụ.'),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          OutlinedButton.icon(
                            onPressed: _busy ? null : _resetTransactions,
                            icon: Icon(Icons.cleaning_services),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: DanColors.late,
                              side: BorderSide(color: DanColors.late),
                            ),
                            label: Text(t('Dọn sạch giao dịch & reset bàn')),
                          ),
                          SizedBox(height: 12),
                          _notice(
                            t('Thao tác dọn sạch giao dịch sẽ xóa vĩnh viễn toàn bộ hóa đơn, ca làm và chi phí trong database chính.'),
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
                      title: t('Thống kê Cơ sở dữ liệu'),
                      description: t(
                          'Số lượng bảng ghi hiện tại trong hệ thống CSDL local'),
                      child: Column(
                        children: [
                          _infoLine(
                              t('Bảng cấu hình'), t('${config.length} bảng')),
                          _infoLine(t('Dòng cấu hình'),
                              t('${configRows.round()} hàng')),
                          _infoLine(
                              t('Bảng giao dịch'), t('${txn.length} bảng')),
                          _infoLine(t('Dòng giao dịch'),
                              t('${txnRows.round()} hàng')),
                          _infoLine(t('Tổng số hóa đơn'),
                              '${_n(txn['invoices']).round()}'),
                          _infoLine(t('Tổng số ca làm'),
                              '${_n(txn['shifts']).round()}'),
                          _infoLine(
                            t('Nhật ký hoạt động'),
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
          SizedBox(height: 16),
          Panel(
            title: t('Bảng cấu hình (giữ khi reset)'),
            child: _countGrid(config),
          ),
          SizedBox(height: 16),
          Panel(
            title: t('Bảng giao dịch'),
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
      padding: EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(color: DanColors.muted, fontSize: 12),
            ),
          ),
          SizedBox(width: 12),
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
      padding: EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: danger ? Color(0xFFFFF1F1) : DanColors.surface2,
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
      return Text('-', style: TextStyle(color: DanColors.faint));
    }
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final entry in counts.entries)
          Container(
            padding: EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: DanColors.surface2,
              borderRadius: BorderRadius.circular(7),
            ),
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '${entry.key}: ',
                    style: TextStyle(
                      fontSize: 11.5,
                      color: DanColors.muted,
                    ),
                  ),
                  TextSpan(
                    text: '${entry.value}',
                    style: TextStyle(
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

  _DbCard({
    required this.icon,
    required this.title,
    required this.description,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(minHeight: 286),
      padding: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.lg),
        boxShadow: [
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
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900),
                ),
              ),
            ],
          ),
          SizedBox(height: 8),
          Text(
            description,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: DanColors.muted,
              fontSize: 12,
              height: 1.35,
            ),
          ),
          SizedBox(height: 18),
          child,
        ],
      ),
    );
  }
}

class _AuditLogTab extends StatefulWidget {
  _AuditLogTab();

  @override
  State<_AuditLogTab> createState() => _AuditLogTabState();
}

/// Một dòng trong danh sách gộp: hoặc audit_log (vệt thao tác người dùng)
/// hoặc system_logs (log kỹ thuật crash/api/socket/printer/payment…).
class _LogEntry {
  final bool isSystem;
  final Map<String, dynamic> data;
  final DateTime? ts;
  _LogEntry(this.isSystem, this.data, this.ts);
}

class _AuditLogTabState extends State<_AuditLogTab> {
  static final _pageSize = 50;

  // Bộ lọc loại log — mỗi chip ánh xạ sang nguồn audit/system_logs và nhóm sự kiện.
  // filter server-side (levels / sources / event_types).
  static final _filters = <(String, String)>[
    ('all', t('Tất cả')),
    ('user', t('Hoạt động người dùng')),
    ('system', t('Hệ thống')),
    ('warn', t('Cảnh báo')),
    ('error', t('Lỗi')),
    ('crash', t('Crash nghiêm trọng')),
    ('api', 'API'),
    ('socket', 'Socket'),
    ('payment', t('Thanh toán')),
    ('printer', t('Máy in')),
    ('sync', t('Đồng bộ')),
    ('update', t('Cập nhật app')),
  ];

  final _search = TextEditingController();
  final List<_LogEntry> _rows = [];

  String _filter = 'all';
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMoreAudit = false;
  bool _hasMoreSys = false;
  String? _auditCursor;
  String? _sysCursor;
  String? _error;
  String _granularity = '';
  DateTime _anchor = DateTime.now();
  Timer? _timer;

  bool get _hasMore => _hasMoreAudit || _hasMoreSys;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(Duration(seconds: 5), (timer) {
      if (mounted &&
          !_loading &&
          !_loadingMore &&
          _search.text.isEmpty &&
          _granularity.isEmpty) {
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

  /// (levels, sources, eventTypes) gửi cho /api/system-logs theo chip đang chọn.
  (String, String, String) _sysQuery() {
    switch (_filter) {
      case 'warn':
        return ('warn', '', '');
      case 'error':
        return ('error,fatal', '', '');
      case 'crash':
        return ('', '', 'crash,uncaught_exception');
      case 'api':
        return (
          '',
          '',
          'api_error,api_timeout,api_offline,slow_request,backend_exception'
        );
      case 'socket':
        return ('', 'socket', '');
      case 'payment':
        return ('', '', 'payment_failed,card_terminal_error');
      case 'printer':
        return ('', 'printer', '');
      case 'sync':
        return (
          '',
          '',
          'sync_failed,socket_disconnect,socket_reconnect,network_offline,network_online'
        );
      case 'update':
        return ('', 'updater', '');
      default:
        return ('', '', '');
    }
  }

  Future<void> _load({bool append = false, bool silent = false}) async {
    if (append && (!_hasMore || _loadingMore)) return;
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

    final search = _search.text.trim();
    final from =
        range.from == null ? '' : range.from!.toUtc().toIso8601String();
    final to = range.to == null ? '' : range.to!.toUtc().toIso8601String();
    // 'user' = chỉ vệt thao tác; các chip kỹ thuật = chỉ system_logs;
    // 'all' = gộp cả hai. Nguồn nào lỗi (VD server cũ chưa có /system-logs)
    // thì bỏ qua nguồn đó, KHÔNG sập cả màn.
    final includeAudit = _filter == 'all' || _filter == 'user';
    final includeSys = _filter != 'user';
    final sys = _sysQuery();

    try {
      final results = await Future.wait<List<dynamic>>([
        if (includeAudit && (!append || _hasMoreAudit))
          api
              .getAuditLogs(
                limit: _pageSize,
                before: append ? _auditCursor ?? '' : '',
                search: search,
                from: from,
                to: to,
              )
              .catchError((_) => <dynamic>[])
        else
          Future.value(<dynamic>[]),
        if (includeSys && (!append || _hasMoreSys))
          api
              .getSystemLogs(
                limit: _pageSize,
                before: append ? _sysCursor ?? '' : '',
                levels: sys.$1,
                sources: sys.$2,
                eventTypes: sys.$3,
                q: search,
                from: from,
                to: to,
              )
              .catchError((_) => <dynamic>[])
        else
          Future.value(<dynamic>[]),
      ]);

      final auditRows = results[0]
          .map((item) => item is Map
              ? Map<String, dynamic>.from(item)
              : <String, dynamic>{'detail': item})
          .toList();
      final sysRows = results[1]
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();

      final next = <_LogEntry>[
        for (final r in auditRows)
          _LogEntry(false, r, DateTime.tryParse(_s(r['created_at']))),
        for (final r in sysRows)
          _LogEntry(true, r, DateTime.tryParse(_s(r['timestamp']))),
      ];

      if (!mounted) return;
      setState(() {
        if (append) {
          _rows.addAll(next);
        } else {
          _rows
            ..clear()
            ..addAll(next);
        }
        // Gộp 2 nguồn → sắp theo thời gian giảm dần cho một dòng chảy duy nhất.
        _rows.sort((a, b) {
          final ta = a.ts?.millisecondsSinceEpoch ?? 0;
          final tb = b.ts?.millisecondsSinceEpoch ?? 0;
          return tb.compareTo(ta);
        });
        // Paging/refresh can overlap at an identical timestamp. IDs are stable,
        // so remove only repeated renderings of the same stored row.
        final seen = <String>{};
        _rows.removeWhere((row) {
          final id = _s(row.data['id']);
          if (id.isEmpty) return false;
          return !seen.add('${row.isSystem}:$id');
        });
        if (auditRows.isNotEmpty) {
          _auditCursor = _s(auditRows.last['created_at']);
        }
        if (sysRows.isNotEmpty) _sysCursor = _s(sysRows.last['timestamp']);
        _hasMoreAudit = includeAudit && auditRows.length >= _pageSize;
        _hasMoreSys = includeSys && sysRows.length >= _pageSize;
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
      _filter = 'all';
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
        return _AuditRange(day, day.add(Duration(days: 1)));
      case 'week':
        final monday = day.subtract(Duration(days: day.weekday - 1));
        return _AuditRange(monday, monday.add(Duration(days: 7)));
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
    return _AuditRange(null, null);
  }

  String _periodLabel() {
    final range = _range();
    if (range.from == null || range.to == null) return t('Tất cả lịch sử');
    final from = range.from!;
    final to = range.to!.subtract(Duration(days: 1));
    switch (_granularity) {
      case 'day':
        return _dmy(from);
      case 'week':
        return '${_dmy(from)} - ${_dmy(to)}';
      case 'month':
        return t('Tháng ${from.month}/${from.year}');
      case 'quarter':
        return t('Quý ${((from.month - 1) ~/ 3) + 1}/${from.year}');
      case 'year':
        return t('Năm ${from.year}');
    }
    return t('Tất cả lịch sử');
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: EdgeInsets.all(18),
        children: [
          Text(
            t('Nhật ký hoạt động hệ thống được lưu trong SQLite local tối đa 3 năm. Các dòng lỗi có thể mở ra để xem nguyên nhân chi tiết.'),
            style: TextStyle(color: DanColors.muted, fontSize: 13),
          ),
          SizedBox(height: 14),
          _filterBar(),
          SizedBox(height: 16),
          if (_loading && _rows.isEmpty)
            SizedBox(
              height: 260,
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_error != null && _rows.isEmpty)
            InlineMessage(
              t('Không tải được nhật ký hoạt động ($_error)'),
              error: true,
              onRetry: _load,
            )
          else
            Panel(
              padding: EdgeInsets.fromLTRB(16, 8, 16, 10),
              child: Column(
                children: [
                  if (_error != null) ...[
                    InlineMessage(
                      t('Không tải thêm được nhật ký ($_error)'),
                      error: true,
                      onRetry: () => _load(append: true),
                    ),
                    SizedBox(height: 10),
                  ],
                  if (_rows.isEmpty)
                    SizedBox(
                      height: 220,
                      child: Center(
                        child: Text(
                          t('Không có nhật ký trong bộ lọc này'),
                          style: TextStyle(color: DanColors.faint),
                        ),
                      ),
                    )
                  else
                    for (var i = 0; i < _rows.length; i++) ...[
                      if (_rows[i].isSystem)
                        _SystemLogRow(
                          entry: _rows[i].data,
                          api: context.read<ApiService>(),
                        )
                      else
                        _AuditLogRow(
                          entry: _rows[i].data,
                          api: context.read<ApiService>(),
                        ),
                      if (i < _rows.length - 1)
                        Divider(height: 1, color: DanColors.border),
                    ],
                  if (_hasMore) ...[
                    Divider(height: 20, color: DanColors.border),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed:
                            _loadingMore ? null : () => _load(append: true),
                        icon: _loadingMore
                            ? SizedBox(
                                width: 16,
                                height: 16,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              )
                            : Icon(Icons.expand_more),
                        label: Text(t('Xem thêm')),
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Hàng chip lọc loại log (người dùng / hệ thống / lỗi / crash…).
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final (key, label) in _filters)
                ChoiceChip(
                  label: Text(label),
                  selected: _filter == key,
                  labelStyle: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: _filter == key ? Colors.white : DanColors.muted,
                  ),
                  selectedColor: DanColors.brand,
                  backgroundColor: DanColors.surface2,
                  side: BorderSide(
                      color:
                          _filter == key ? DanColors.brand : DanColors.border2),
                  showCheckmark: false,
                  onSelected: (_) {
                    if (_filter == key) return;
                    setState(() => _filter = key);
                    _load();
                  },
                ),
            ],
          ),
          SizedBox(height: 12),
          _filterControls(),
        ],
      ),
    );
  }

  Widget _filterControls() {
    return LayoutBuilder(builder: (context, constraints) {
      final controlHeight = 48.0;
      final actionWidth = 98.0;
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
              decoration: InputDecoration(labelText: t('Thời gian')),
              items: [
                DropdownMenuItem(value: '', child: Text(t('Tất cả lịch sử'))),
                DropdownMenuItem(value: 'day', child: Text(t('Theo ngày'))),
                DropdownMenuItem(value: 'week', child: Text(t('Theo tuần'))),
                DropdownMenuItem(value: 'month', child: Text(t('Theo tháng'))),
                DropdownMenuItem(value: 'quarter', child: Text(t('Theo quý'))),
                DropdownMenuItem(value: 'year', child: Text(t('Theo năm'))),
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
                decoration: InputDecoration(
                  isDense: true,
                  labelText: t('Tìm kiếm'),
                  hintText: t('Tìm theo hành động, nhân viên, nội dung...'),
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
              icon: Icon(Icons.filter_alt_outlined, size: 18),
              style: FilledButton.styleFrom(
                padding: EdgeInsets.symmetric(horizontal: 12),
                textStyle: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w800,
                ),
              ),
              label: Text(t('Lọc')),
            ),
          ),
          SizedBox(
            width: actionWidth,
            height: controlHeight,
            child: OutlinedButton.icon(
              onPressed: _loading ? null : _resetFilters,
              icon: Icon(Icons.restart_alt, size: 18),
              style: OutlinedButton.styleFrom(
                padding: EdgeInsets.symmetric(horizontal: 12),
                textStyle: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w800,
                ),
              ),
              label: Text('Reset'),
            ),
          ),
        ],
      );
    });
  }

  Widget _periodControl() {
    return Container(
      height: 48,
      padding: EdgeInsets.symmetric(horizontal: 4),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.sm),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: t('Kỳ trước'),
            onPressed: () => _shiftPeriod(-1),
            icon: Icon(Icons.chevron_left),
          ),
          Expanded(
            child: Text(
              _periodLabel(),
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800),
            ),
          ),
          IconButton(
            tooltip: t('Chọn ngày'),
            onPressed: _pickAnchor,
            icon: Icon(Icons.calendar_month_outlined),
          ),
          IconButton(
            tooltip: t('Kỳ sau'),
            onPressed: () => _shiftPeriod(1),
            icon: Icon(Icons.chevron_right),
          ),
        ],
      ),
    );
  }
}

class _AuditRange {
  final DateTime? from;
  final DateTime? to;

  _AuditRange(this.from, this.to);
}

class _AuditLogRow extends StatefulWidget {
  final Map<String, dynamic> entry;
  final ApiService api;

  _AuditLogRow({
    required this.entry,
    required this.api,
  });

  @override
  State<_AuditLogRow> createState() => _AuditLogRowState();
}

class _AuditLogRowState extends State<_AuditLogRow> {
  bool _decrypting = false;
  String? _decrypted;

  Future<void> _decrypt() async {
    final id = _s(widget.entry['id']);
    if (id.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(t('Nhật ký này chưa có id để giải mã')),
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
      });
      Navigator.of(context).pop();
      await _openDetail();
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
    final canOpen = isError || encrypted || detail.isNotEmpty;

    return InkWell(
      onTap: canOpen ? _openDetail : null,
      child: Container(
        margin: EdgeInsets.symmetric(vertical: 8),
        padding: EdgeInsets.fromLTRB(10, 10, 10, 12),
        decoration: BoxDecoration(
          color: isError ? Color(0xFFFFE9E9) : Colors.transparent,
          borderRadius: BorderRadius.circular(DanRadius.sm),
          border: isError
              ? Border(left: BorderSide(color: Colors.red, width: 3))
              : null,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 76,
              child: Text(
                createdAt == null ? '-' : _hm(createdAt),
                style: TextStyle(
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
                      if (isError) _badge(t('Lỗi'), DanColors.late),
                      if (encrypted) _badge(t('Mã hóa'), DanColors.muted),
                      Text(
                        summary.title,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      if (actor.isNotEmpty && actor != 'system')
                        _badge(actor.toUpperCase(), DanColors.muted),
                    ],
                  ),
                  if (summary.meta.isNotEmpty) ...[
                    SizedBox(height: 4),
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
                    SizedBox(height: 3),
                    Text(
                      t('${_dmy(createdAt)} lúc ${_hm(createdAt)}'),
                      style: TextStyle(color: DanColors.faint, fontSize: 11),
                    ),
                  ],
                  if (canOpen) ...[
                    SizedBox(height: 7),
                    Text(
                      t('Bấm để xem chi tiết'),
                      style: TextStyle(
                        color: isError ? DanColors.late : DanColors.brand,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openDetail() async {
    final rawDetail = _decrypted ?? _s(widget.entry['detail']);
    final encrypted =
        _isEncrypted(widget.entry['detail']) && _decrypted == null;
    final detail = _detailMap(rawDetail);
    final summary = _summaryFor(
      _s(widget.entry['action']),
      detail,
      _s(widget.entry['actor']),
    );
    await showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(
          summary.title,
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
        ),
        content: SizedBox(
          width: dialogWidth(context, 720),
          child: SingleChildScrollView(child: _detailBox(detail, encrypted)),
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(t('Đóng')),
          ),
        ],
      ),
    );
  }

  Widget _detailBox(Map<String, dynamic> detail, bool encrypted) {
    if (encrypted) {
      return Container(
        width: double.infinity,
        padding: EdgeInsets.all(12),
        decoration: _detailDecoration(),
        child: Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            onPressed: _decrypting ? null : _decrypt,
            icon: _decrypting
                ? SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Icon(Icons.lock_open_outlined),
            label: Text(t('Giải mã chi tiết')),
          ),
        ),
      );
    }

    if (detail.isEmpty) {
      return Container(
        width: double.infinity,
        padding: EdgeInsets.all(12),
        decoration: _detailDecoration(),
        child: Text(
          t('Không có chi tiết bổ sung'),
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

    add(t('Nguyên nhân'), detail['message'] ?? detail['error']);
    add(t('Mã lỗi'), detail['code']);
    add(
      t('Vị trí'),
      [_s(detail['method']), _s(detail['path'])]
          .where((part) => part.isNotEmpty)
          .join(' '),
    );
    add(t('Mã trạng thái'), detail['status']);
    add(t('Chi tiết'), detail['details'] ?? detail['detail'] ?? detail['raw']);

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
      padding: EdgeInsets.all(12),
      decoration: _detailDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (rows.isEmpty)
            Text(
              t('Không có chi tiết bổ sung'),
              style: TextStyle(color: DanColors.faint, fontSize: 12),
            )
          else
            ...rows,
          if (stackText.isNotEmpty) ...[
            SizedBox(height: 10),
            Text(
              t('Ngăn xếp kỹ thuật (debug)'),
              style: TextStyle(
                color: DanColors.muted,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
            SizedBox(height: 6),
            Container(
              padding: EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Color(0xFFE9EDF2),
                borderRadius: BorderRadius.circular(DanRadius.sm),
              ),
              child: SelectableText(
                stackText,
                style: TextStyle(
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
      padding: EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 112,
            child: Text(
              label,
              style: TextStyle(
                color: DanColors.muted,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          Expanded(
            child: SelectableText(
              value,
              style: TextStyle(
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
      padding: EdgeInsets.symmetric(horizontal: 7, vertical: 3),
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
    return JsonEncoder.withIndent('  ').convert(value);
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
      t('Hệ thống gặp lỗi khi xử lý một thao tác.'),
      message.isNotEmpty ? message : code,
    );
  }
  if (action.endsWith('.error')) {
    return _AuditSummary(
      t('Thao tác phát sinh lỗi.'),
      message.isNotEmpty ? message : code,
    );
  }

  final who = actor.isEmpty || actor == 'system' ? t('Hệ thống') : actor;
  switch (action) {
    case 'auth.login':
      return _AuditSummary(t('$who đã đăng nhập vào hệ thống.'), target);
    case 'auth.logout':
      return _AuditSummary(t('$who đã đăng xuất khỏi hệ thống.'), target);
    case 'device.connect':
      return _AuditSummary(t('$who vừa kết nối vào hệ thống.'), target);
    case 'db.reset_transactions':
      return _AuditSummary(
        t('Đã dọn sạch dữ liệu giao dịch và reset bàn.'),
        t('Thao tác quản trị cơ sở dữ liệu'),
      );
    case 'config.export':
      return _AuditSummary(t('Đã xuất cấu hình hệ thống.'), '');
    case 'config.import':
      return _AuditSummary(t('Đã phục hồi cấu hình hệ thống.'), '');
    case 'payment.done':
      return _AuditSummary(t('Đã ghi nhận thanh toán.'), target);
    case 'retail.refund':
      return _AuditSummary(t('Đã xử lý đổi trả bán lẻ.'), target);
    case 'invoice.cancel':
      return _AuditSummary(t('Đã hủy hóa đơn.'), target);
    case 'print.job':
      return _AuditSummary(t('Đã tạo lệnh in.'), target);
    case 'dms.upload':
      return _AuditSummary(t('Đã tải tài liệu lên hệ thống.'), target);
    case 'dms.update':
      return _AuditSummary(t('Đã cập nhật tài liệu.'), target);
    case 'dms.delete':
      return _AuditSummary(t('Đã xóa tài liệu.'), target);
  }

  if (action.startsWith('menu.')) {
    return _AuditSummary(t('Đã cập nhật thực đơn.'), target);
  }
  if (action.startsWith('sku.') || action.startsWith('inventory.')) {
    return _AuditSummary(t('Đã cập nhật hàng hóa/kho.'), target);
  }
  if (action.startsWith('voucher.')) {
    return _AuditSummary(t('Đã cập nhật voucher.'), target);
  }
  if (action.startsWith('user.') || action.startsWith('permission.')) {
    return _AuditSummary(t('Đã cập nhật nhân sự/phân quyền.'), target);
  }

  return _AuditSummary(
    action.isEmpty ? t('Hoạt động hệ thống') : action,
    message,
  );
}

class _AuditSummary {
  final String title;
  final String meta;

  _AuditSummary(this.title, this.meta);
}

// ── Nhật ký HỆ THỐNG (system_logs): dòng + modal chi tiết ───────────────────

Color _levelColor(String level) {
  switch (level) {
    case 'debug':
      return DanColors.faint;
    case 'info':
      return DanColors.brand;
    case 'warn':
      return Color(0xFFD97706);
    case 'fatal':
      return Color(0xFF7F1D1D);
    default:
      return DanColors.late; // error
  }
}

String _sourceLabel(String source) {
  final map = {
    'flutter_app': 'APP',
    'backend': 'API',
    'socket': 'SOCKET',
    'printer': 'PRINTER',
    'payment': 'PAYMENT',
    'updater': 'UPDATE',
    'misa': 'MISA',
    'database': 'DB',
    'sync': 'SYNC',
  };
  return map[source] ?? source.toUpperCase();
}

Widget _logBadge(String text, Color color, {bool filled = false}) {
  return Container(
    padding: EdgeInsets.symmetric(horizontal: 7, vertical: 3),
    decoration: BoxDecoration(
      color: filled ? color : color.withValues(alpha: .12),
      borderRadius: BorderRadius.circular(999),
    ),
    child: Text(
      text,
      style: TextStyle(
        color: filled ? Colors.white : color,
        fontSize: 10,
        fontWeight: FontWeight.w900,
      ),
    ),
  );
}

class _SystemLogRow extends StatefulWidget {
  final Map<String, dynamic> entry;
  final ApiService api;

  _SystemLogRow({required this.entry, required this.api});

  @override
  State<_SystemLogRow> createState() => _SystemLogRowState();
}

class _SystemLogRowState extends State<_SystemLogRow> {
  late bool _resolved = _n(widget.entry['is_resolved']) == 1;

  @override
  Widget build(BuildContext context) {
    final e = widget.entry;
    final level = _s(e['level']);
    final color = _levelColor(level);
    final ts = DateTime.tryParse(_s(e['timestamp']))?.toLocal();
    final title = _s(e['title']);
    final message = _s(e['message']);
    final isSevere = level == 'error' || level == 'fatal';
    final who = [
      if (_s(e['username']).isNotEmpty) _s(e['username']),
      if (_s(e['device_name']).isNotEmpty) _s(e['device_name']),
      if (_s(e['branch_name']).isNotEmpty)
        _s(e['branch_name'])
      else if (_s(e['branch_id']).isNotEmpty)
        _s(e['branch_id']),
    ].join(' · ');

    return InkWell(
      onTap: _openDetail,
      child: Container(
        margin: EdgeInsets.symmetric(vertical: 8),
        padding: EdgeInsets.fromLTRB(10, 10, 10, 12),
        decoration: BoxDecoration(
          color:
              isSevere && !_resolved ? Color(0xFFFFE9E9) : Colors.transparent,
          borderRadius: BorderRadius.circular(DanRadius.sm),
          border: isSevere && !_resolved
              ? Border(left: BorderSide(color: color, width: 3))
              : null,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 76,
              child: Text(
                ts == null ? '-' : _hm(ts),
                style: TextStyle(
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
                      _logBadge(level.toUpperCase(), color, filled: isSevere),
                      _logBadge(_sourceLabel(_s(e['source'])), DanColors.muted),
                      if (_resolved)
                        _logBadge(t('ĐÃ XỬ LÝ'), Color(0xFF16A34A)),
                      Text(
                        title,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                  if (message.isNotEmpty) ...[
                    SizedBox(height: 4),
                    Text(
                      message,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: isSevere ? color : DanColors.muted,
                        fontSize: 11.5,
                        fontWeight:
                            isSevere ? FontWeight.w700 : FontWeight.w500,
                      ),
                    ),
                  ],
                  SizedBox(height: 3),
                  Text(
                    [
                      if (ts != null) '${_dmy(ts)} lúc ${_hm(ts)}',
                      if (who.isNotEmpty) who,
                    ].join(' - '),
                    style: TextStyle(color: DanColors.faint, fontSize: 11),
                  ),
                  SizedBox(height: 7),
                  Text(
                    t('Bấm để xem chi tiết'),
                    style: TextStyle(
                      color: isSevere ? color : DanColors.brand,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openDetail() async {
    final resolvedNow = await showDialog<bool>(
      context: context,
      builder: (_) => _SystemLogDetailDialog(
        entry: widget.entry,
        api: widget.api,
        resolved: _resolved,
      ),
    );
    if (resolvedNow == true && mounted) {
      setState(() {
        widget.entry['is_resolved'] = 1;
        _resolved = true;
      });
    }
  }
}

class _SystemLogDetailDialog extends StatefulWidget {
  final Map<String, dynamic> entry;
  final ApiService api;
  final bool resolved;

  _SystemLogDetailDialog({
    required this.entry,
    required this.api,
    required this.resolved,
  });

  @override
  State<_SystemLogDetailDialog> createState() => _SystemLogDetailDialogState();
}

class _SystemLogDetailDialogState extends State<_SystemLogDetailDialog> {
  late bool _resolved = widget.resolved;
  bool _resolving = false;

  // Các field hiển thị theo thứ tự spec — bỏ field rỗng cho gọn.
  static final _fieldLabels = <(String, String)>[
    ('event_type', t('Loại sự kiện')),
    ('source', t('Nguồn')),
    ('level', t('Mức độ')),
    ('timestamp', t('Thời điểm')),
    ('device_id', t('Mã thiết bị')),
    ('device_name', t('Tên thiết bị')),
    ('user_id', t('Mã người dùng')),
    ('username', t('Người dùng')),
    ('branch_id', t('Chi nhánh')),
    ('branch_name', t('Tên chi nhánh')),
    ('app_version', t('Phiên bản app')),
    ('build_number', t('Số build')),
    ('platform', t('Nền tảng')),
    ('os_version', t('Hệ điều hành')),
    ('screen', t('Màn hình')),
    ('action', t('Thao tác')),
    ('endpoint', 'Endpoint'),
    ('method', 'Method'),
    ('status_code', t('Mã trạng thái')),
    ('duration_ms', t('Thời gian (ms)')),
    ('request_id', 'Request ID'),
    ('correlation_id', 'Correlation ID'),
    ('order_id', t('Mã đơn')),
    ('table_id', t('Mã bàn')),
    ('payment_id', t('Mã thanh toán')),
    ('exception_type', t('Loại exception')),
    ('resolved_by', t('Người xử lý')),
    ('resolved_at', t('Xử lý lúc')),
  ];

  @override
  Widget build(BuildContext context) {
    final e = widget.entry;
    final level = _s(e['level']);
    final color = _levelColor(level);
    final stack = _s(e['stack_trace']);
    final extra = _s(e['extra_json']);
    final message = _s(e['message']);

    return AlertDialog(
      title: Row(
        children: [
          _logBadge(level.toUpperCase(), color,
              filled: level == 'error' || level == 'fatal'),
          SizedBox(width: 8),
          _logBadge(_sourceLabel(_s(e['source'])), DanColors.muted),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              _s(e['title']),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
            ),
          ),
        ],
      ),
      content: SizedBox(
        width: dialogWidth(context, 720),
        height: 440,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (message.isNotEmpty) ...[
                SelectableText(
                  message,
                  style: TextStyle(fontSize: 13, height: 1.4),
                ),
                SizedBox(height: 12),
              ],
              for (final (key, label) in _fieldLabels)
                if (_s(e[key]).isNotEmpty) _line(label, _s(e[key])),
              if (extra.isNotEmpty) ...[
                SizedBox(height: 10),
                _monoBox(t('Dữ liệu bổ sung (extra_json)'), _prettyJson(extra)),
              ],
              if (stack.isNotEmpty) ...[
                SizedBox(height: 10),
                _monoBox('Stack trace', stack),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton.icon(
          onPressed: _copyJson,
          icon: Icon(Icons.copy_all_outlined, size: 18),
          label: Text('Copy JSON'),
        ),
        if (!_resolved)
          OutlinedButton.icon(
            onPressed: _resolving ? null : _markResolved,
            icon: _resolving
                ? SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(Icons.task_alt, size: 18),
            label: Text(t('Đánh dấu đã xử lý')),
          )
        else
          _logBadge(t('ĐÃ XỬ LÝ'), Color(0xFF16A34A)),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_resolved),
          child: Text(t('Đóng')),
        ),
      ],
    );
  }

  Widget _line(String label, String value) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 150,
            child: Text(
              label,
              style: TextStyle(
                color: DanColors.muted,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          Expanded(
            child: SelectableText(
              value,
              style: TextStyle(fontSize: 12, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }

  Widget _monoBox(String label, String text) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          label,
          style: TextStyle(
            color: DanColors.muted,
            fontSize: 12,
            fontWeight: FontWeight.w800,
          ),
        ),
        SizedBox(height: 6),
        Container(
          padding: EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: Color(0xFFE9EDF2),
            borderRadius: BorderRadius.circular(DanRadius.sm),
          ),
          child: SelectableText(
            text,
            style: TextStyle(
              color: DanColors.muted,
              fontFamily: 'monospace',
              fontSize: 11,
              height: 1.35,
            ),
          ),
        ),
      ],
    );
  }

  String _prettyJson(String raw) {
    try {
      return JsonEncoder.withIndent('  ').convert(jsonDecode(raw));
    } catch (_) {
      return raw;
    }
  }

  void _copyJson() {
    final jsonText = JsonEncoder.withIndent('  ').convert(widget.entry);
    Clipboard.setData(ClipboardData(text: jsonText));
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(content: Text(t('Đã copy JSON của dòng nhật ký'))),
    );
  }

  Future<void> _markResolved() async {
    setState(() => _resolving = true);
    try {
      final res = await widget.api.resolveSystemLog(_s(widget.entry['id']));
      if (!mounted) return;
      setState(() {
        widget.entry['is_resolved'] = 1;
        widget.entry['resolved_at'] = DateTime.now().toIso8601String();
        if (_s(res['resolved']).isNotEmpty) {
          widget.entry['resolved_count'] = res['resolved'];
        }
        _resolved = true;
        _resolving = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _resolving = false);
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
        backgroundColor: DanColors.late,
      ));
    }
  }
}
