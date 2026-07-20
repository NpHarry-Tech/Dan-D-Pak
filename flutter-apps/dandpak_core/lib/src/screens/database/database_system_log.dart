// GENERATED SPLIT of database_screen.dart — dòng nhật ký hệ thống + dialog chi tiết (part of, cùng library).
part of 'database_screen.dart';

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
