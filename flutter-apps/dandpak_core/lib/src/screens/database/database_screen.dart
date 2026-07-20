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

part 'database_audit_tab.dart';
part 'database_system_log.dart';

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

