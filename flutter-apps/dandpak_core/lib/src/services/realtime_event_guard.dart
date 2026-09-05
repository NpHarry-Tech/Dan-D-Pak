class RealtimeEventGuard {
  RealtimeEventGuard({this.capacity = 1024});

  final int capacity;
  final Set<String> _seen = {};
  final List<String> _order = [];
  final Map<String, int> _versions = {};
  String? lastEventId;

  bool accept(dynamic payload) {
    if (payload is! Map || payload['_rt'] is! Map) return true;
    final metadata = payload['_rt'] as Map;
    final eventId = metadata['event_id']?.toString() ?? '';
    final branch = metadata['branch_id']?.toString() ?? '';
    final entity = metadata['entity']?.toString() ?? '';
    final version = int.tryParse(metadata['version']?.toString() ?? '');
    if (eventId.isEmpty) return true;
    if (_seen.contains(eventId)) return false;

    final versionKey = '$branch|$entity';
    final previous = _versions[versionKey];
    if (entity.isNotEmpty &&
        version != null &&
        previous != null &&
        version <= previous) {
      _remember(eventId);
      return false;
    }
    if (entity.isNotEmpty && version != null) _versions[versionKey] = version;
    _remember(eventId);
    lastEventId = eventId;
    return true;
  }

  void reset() {
    _seen.clear();
    _order.clear();
    _versions.clear();
    lastEventId = null;
  }

  void _remember(String eventId) {
    _seen.add(eventId);
    _order.add(eventId);
    while (_order.length > capacity) _seen.remove(_order.removeAt(0));
  }
}
