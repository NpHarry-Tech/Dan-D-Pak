// KDS ticket model — mirrors GET /api/kds/:station (Orders.getStationTickets).

class KdsTicket {
  final String id; // order_item id
  final String orderId;
  final String station;
  final String name;
  final String emoji;
  final int qty;
  final String status; // new | accepted | preparing | ready | served | cancelled
  final int slaMinutes;
  final String note;
  final List<String> mods;
  final String tableCode;
  final DateTime? createdAt;

  const KdsTicket({
    required this.id,
    required this.orderId,
    required this.station,
    required this.name,
    required this.emoji,
    required this.qty,
    required this.status,
    required this.slaMinutes,
    required this.note,
    required this.mods,
    required this.tableCode,
    required this.createdAt,
  });

  bool get isCancelled => status == 'cancelled';
  bool get isReady => status == 'ready';

  /// A ticket is "active" (counts toward station load) if it's neither served
  /// nor cancelled.
  bool get isActive => status != 'served' && status != 'cancelled';

  double elapsedMinutes(DateTime now) {
    if (createdAt == null) return 0;
    return now.difference(createdAt!).inMilliseconds / 60000.0;
  }

  bool isLate(DateTime now) =>
      !isCancelled && !isReady && elapsedMinutes(now) > slaMinutes;

  factory KdsTicket.fromJson(Map<String, dynamic> j) {
    String s(dynamic v) => v?.toString() ?? '';
    final modsRaw = j['mods'];
    final mods = <String>[];
    if (modsRaw is List) {
      for (final m in modsRaw) {
        if (m is Map && m['name'] != null) {
          mods.add(m['name'].toString());
        } else if (m != null) {
          mods.add(m.toString());
        }
      }
    }
    return KdsTicket(
      id: s(j['id']),
      orderId: s(j['order_id']),
      station: s(j['station']).isEmpty ? 'kitchen' : s(j['station']),
      name: s(j['name']),
      emoji: s(j['emoji']),
      qty: (j['qty'] is num) ? (j['qty'] as num).toInt() : int.tryParse(s(j['qty'])) ?? 1,
      status: s(j['status']).isEmpty ? 'new' : s(j['status']),
      slaMinutes: (j['sla_minutes'] is num)
          ? (j['sla_minutes'] as num).toInt()
          : int.tryParse(s(j['sla_minutes'])) ?? 10,
      note: s(j['note']),
      mods: mods,
      tableCode: s(j['table_path']).isNotEmpty ? s(j['table_path']) : s(j['table_code']),
      createdAt: DateTime.tryParse(s(j['created_at']))?.toLocal(),
    );
  }
}
