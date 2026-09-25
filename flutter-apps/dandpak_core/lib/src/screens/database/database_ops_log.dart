// Hai MỤC TÁCH RIÊNG trong Nhật ký (không gộp chung): lệnh in gần đây (print_jobs)
// và phiên đồng bộ (sync_logs). Gom footprint về màn Nhật ký thay vì rải ở Cài đặt;
// không có dữ liệu thì bảng trống, không hiện linh tinh. (part of cùng library.)
part of 'database_screen.dart';

String _printStatusLabel(String s) {
  switch (s) {
    case 'printed':
    case 'done':
      return t('Đã in');
    case 'queued':
      return t('Chờ in');
    case 'printing':
      return t('Đang in');
    case 'cancelled':
      return t('Đã huỷ');
    case 'failed':
      return t('Lỗi in');
    case 'expired':
      return t('Hết hạn');
    default:
      return s.isEmpty ? '—' : s;
  }
}

Color _opsStatusColor(String s) {
  switch (s) {
    case 'failed':
    case 'expired':
      return DanColors.late;
    case 'cancelled':
    case 'queued':
      return DanColors.muted;
    default:
      return DanColors.brand;
  }
}

// ── Job in gần đây ──────────────────────────────────────────────────────────
class _PrintJobsTab extends StatefulWidget {
  _PrintJobsTab();
  @override
  State<_PrintJobsTab> createState() => _PrintJobsTabState();
}

class _PrintJobsTabState extends State<_PrintJobsTab> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(Duration(seconds: 10), (_) {
      if (mounted && !_loading) _load(silent: true);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent && mounted) setState(() => _loading = true);
    try {
      final rows = await context.read<ApiService>().getPrintJobs();
      if (!mounted) return;
      setState(() {
        _rows = rows
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
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

  @override
  Widget build(BuildContext context) {
    if (_loading && _rows.isEmpty) {
      return Center(child: CircularProgressIndicator());
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: EdgeInsets.all(18),
        children: [
          if (_error != null)
            InlineMessage(t('Không tải được lệnh in ($_error)'),
                error: true, onRetry: _load)
          else if (_rows.isEmpty)
            SizedBox(
                height: 220,
                child: Center(
                    child: Text(t('Chưa có lệnh in nào'),
                        style: TextStyle(color: DanColors.faint))))
          else
            Panel(
              padding: EdgeInsets.fromLTRB(14, 6, 14, 8),
              child: Column(children: [
                for (var i = 0; i < _rows.length; i++) ...[
                  _row(_rows[i]),
                  if (i < _rows.length - 1)
                    Divider(height: 1, color: DanColors.border),
                ],
              ]),
            ),
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> j) {
    final status = _s(j['status']);
    final created = BusinessDateTime.parseApi(j['created_at']);
    final title = _s(j['title']).isNotEmpty ? _s(j['title']) : _s(j['type']);
    final printer = _s(j['printer']);
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 10, horizontal: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title.isEmpty ? '—' : title,
                    style:
                        TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                SizedBox(height: 3),
                Text(
                  '${printer.isEmpty ? '' : '$printer · '}${created == null ? '' : '${_dmy(created)} ${_hm(created)}'}',
                  style: TextStyle(color: DanColors.faint, fontSize: 11.5),
                ),
              ],
            ),
          ),
          _chip(_printStatusLabel(status), _opsStatusColor(status)),
        ],
      ),
    );
  }
}

// ── Phiên đồng bộ ───────────────────────────────────────────────────────────
class _SyncSessionsTab extends StatefulWidget {
  _SyncSessionsTab();
  @override
  State<_SyncSessionsTab> createState() => _SyncSessionsTabState();
}

class _SyncSessionsTabState extends State<_SyncSessionsTab> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() => _loading = true);
    try {
      final rows =
          await context.read<ApiService>().getHaravanSyncSessions(limit: 80);
      if (!mounted) return;
      setState(() {
        _rows = rows
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
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

  @override
  Widget build(BuildContext context) {
    if (_loading && _rows.isEmpty) {
      return Center(child: CircularProgressIndicator());
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: EdgeInsets.all(18),
        children: [
          if (_error != null)
            InlineMessage(t('Không tải được phiên đồng bộ ($_error)'),
                error: true, onRetry: _load)
          else if (_rows.isEmpty)
            SizedBox(
                height: 220,
                child: Center(
                    child: Text(t('Chưa có phiên đồng bộ'),
                        style: TextStyle(color: DanColors.faint))))
          else
            Panel(
              padding: EdgeInsets.fromLTRB(14, 6, 14, 8),
              child: Column(children: [
                for (var i = 0; i < _rows.length; i++) ...[
                  _row(_rows[i]),
                  if (i < _rows.length - 1)
                    Divider(height: 1, color: DanColors.border),
                ],
              ]),
            ),
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> s) {
    final started = BusinessDateTime.parseApi(s['started_at']);
    final failed = _n(s['failed']).toInt();
    final success = _n(s['success']).toInt();
    final pending = _n(s['pending']).toInt();
    final total = _n(s['total']).toInt();
    final shop = _s(s['shop_domain']);
    final dir = _s(s['direction']);
    final statusColor = failed > 0
        ? DanColors.late
        : pending > 0
            ? DanColors.muted
            : DanColors.brand;
    final statusText = failed > 0
        ? '$failed ${t('lỗi')}'
        : pending > 0
            ? '$pending ${t('đang chờ')}'
            : t('Hoàn tất');
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 10, horizontal: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                    '${shop.isEmpty ? t('Đồng bộ') : shop}${dir.isEmpty ? '' : ' · $dir'}',
                    style:
                        TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                SizedBox(height: 3),
                Text(
                  '${started == null ? '' : '${_dmy(started)} ${_hm(started)} · '}$success/$total ${t('bản ghi')}',
                  style: TextStyle(color: DanColors.faint, fontSize: 11.5),
                ),
              ],
            ),
          ),
          _chip(statusText, statusColor),
        ],
      ),
    );
  }
}
