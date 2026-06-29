// lib/screens/kds_module/widgets/ticket_card.dart
import 'dart:async';
import 'package:flutter/material.dart';

class TicketCard extends StatefulWidget {
  final Map<String, dynamic> item;
  final Future<void> Function(String itemId, String status) onStatusChanged;

  const TicketCard({
    super.key,
    required this.item,
    required this.onStatusChanged,
  });

  @override
  State<TicketCard> createState() => _TicketCardState();
}

class _TicketCardState extends State<TicketCard> {
  Timer? _timer;
  late DateTime _createdAt;

  @override
  void initState() {
    super.initState();
    _parseCreatedAt();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  void _parseCreatedAt() {
    try {
      _createdAt = DateTime.parse(widget.item['created_at'].toString()).toLocal();
    } catch (_) {
      _createdAt = DateTime.now();
    }
  }

  @override
  void didUpdateWidget(TicketCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.item['created_at'] != oldWidget.item['created_at']) {
      _parseCreatedAt();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  int get _elapsedSeconds {
    return DateTime.now().difference(_createdAt).inSeconds;
  }

  String get _elapsedText {
    final s = _elapsedSeconds;
    final mm = (s ~/ 60).toString().padLeft(2, '0');
    final ss = (s % 60).toString().padLeft(2, '0');
    return '$mm:$ss';
  }

  Color get _slaColor {
    final minutes = _elapsedSeconds / 60;
    if (minutes < 5) return const Color(0xFF49D17F); // Green
    if (minutes < 10) return const Color(0xFFE0A93B); // Yellow
    return const Color(0xFFE5584B); // Red
  }

  (String, String)? get _nextAction {
    final status = widget.item['status']?.toString() ?? 'new';
    switch (status) {
      case 'new':
        return ('accepted', 'Nhận');
      case 'accepted':
        return ('preparing', 'Bắt đầu');
      case 'preparing':
        return ('ready', 'Xong món');
      case 'ready':
        return ('served', 'Phục vụ');
      default:
        return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = widget.item['status']?.toString() ?? 'new';
    final action = _nextAction;
    final cancelled = status == 'cancelled';
    final mods = widget.item['mods'] is List ? widget.item['mods'] as List : [];
    widget.item['notes'] = (widget.item['note'] ?? widget.item['notes'])?.toString() ?? '';
    
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF1E2630),
        borderRadius: BorderRadius.circular(12),
        border: Border(
          left: BorderSide(
            color: cancelled ? Colors.grey : _slaColor,
            width: 6,
          ),
        ),
        boxShadow: const [
          BoxShadow(color: Colors.black26, blurRadius: 4, offset: Offset(0, 2)),
        ],
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Bàn ${widget.item['table_code'] ?? widget.item['table_id'] ?? '—'}',
                style: const TextStyle(fontWeight: FontWeight.extrabold, fontSize: 16, color: Colors.white),
              ),
              if (!cancelled)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: _slaColor.withOpacity(0.18),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    _elapsedText,
                    style: TextStyle(
                      color: _slaColor,
                      fontWeight: FontWeight.w800,
                      fontSize: 13,
                      fontFamily: 'monospace',
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            '${widget.item['qty'] ?? 1}× ${widget.item['name'] ?? ''}',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          if (mods.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              mods.map((m) => m is Map ? (m['name'] ?? '') : m.toString()).join(', '),
              style: const TextStyle(color: Colors.white70, fontSize: 13, fontStyle: FontStyle.italic),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          if (widget.item['notes']?.toString().isNotEmpty ?? false) ...[
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: Colors.redAccent.withOpacity(0.1),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                'Ghi chú: ${widget.item['notes']}',
                style: const TextStyle(color: Color(0xFFFF8A8A), fontSize: 12, fontWeight: FontWeight.w600),
              ),
            ),
          ],
          const Spacer(),
          Row(
            children: [
              _StatusPill(status: status),
              const Spacer(),
              if (cancelled)
                TextButton(
                  onPressed: () => widget.onStatusChanged(widget.item['id'].toString(), 'served'),
                  child: const Text('Ẩn', style: TextStyle(color: Colors.white54)),
                )
              else if (action != null)
                FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF2F7D6B),
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  onPressed: () => widget.onStatusChanged(widget.item['id'].toString(), action.$1),
                  child: Text(action.$2, style: const TextStyle(fontWeight: FontWeight.bold)),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  final String status;
  const _StatusPill({required this.status});

  @override
  Widget build(BuildContext context) {
    final Map<String, (String, Color)> map = {
      'new': ('Mới', const Color(0xFF4C8DFF)),
      'accepted': ('Đã nhận', const Color(0xFF49D17F)),
      'preparing': ('Đang làm', const Color(0xFFE0A93B)),
      'ready': ('Xong', const Color(0xFF2F7D6B)),
      'cancelled': ('Đã hủy', Colors.grey),
    };
    final detail = map[status] ?? (status, Colors.white54);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: detail.$2.withOpacity(0.18),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        detail.$1,
        style: TextStyle(color: detail.$2, fontSize: 12, fontWeight: FontWeight.bold),
      ),
    );
  }
}
