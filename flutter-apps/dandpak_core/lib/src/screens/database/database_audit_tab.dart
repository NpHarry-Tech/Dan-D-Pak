// GENERATED SPLIT of database_screen.dart — tab nhật ký kiểm toán + dòng log (part of, cùng library).
part of 'database_screen.dart';

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

