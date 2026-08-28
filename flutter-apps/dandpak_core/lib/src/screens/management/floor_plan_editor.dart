// TRÌNH DỰNG SƠ ĐỒ BÀN (chỉ DESKTOP, quyền Quản lý/Admin).
//
// Lưới = các dấu "+" ở giao điểm (chỉ để THAM CHIẾU 4 góc ô), KHÔNG phải ô chia
// sẵn. Bàn KÉO TỰ DO đặt bất kỳ đâu; bật "Hít góc" thì thả ra tự khớp về dấu "+"
// gần nhất, tắt thì để lệch tuỳ ý. KÉO KHÔNG hỏi mật khẩu — chỉ khi bấm "Lưu"
// (nút ở header, cạnh "Thêm bàn") mới nhập PIN một lần cho toàn bộ thay đổi.
import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../floor_layout.dart'; // kFloorCols, kTableCells — DÙNG CHUNG với POS
import 'settings_value_utils.dart';

class FloorPlanEditor extends StatefulWidget {
  final ApiService api;
  // PIN chỉ dùng cho tạo/xoá khu vực và khi LƯU sơ đồ (không dùng khi kéo).
  final Future<String?> Function() askPin;
  final VoidCallback? onDirtyChanged; // báo panel bật/tắt nút Lưu
  const FloorPlanEditor(
      {super.key,
      required this.api,
      required this.askPin,
      this.onDirtyChanged});

  @override
  FloorPlanEditorState createState() => FloorPlanEditorState();
}

class FloorPlanEditorState extends State<FloorPlanEditor> {
  List<Map<String, dynamic>> _zones = [];
  List<Map<String, dynamic>> _tables = [];
  bool _loading = true;
  String? _error;
  String _activeZone = ''; // '' = Tất cả
  bool _autoFit = true;
  final Set<String> _dirty = {}; // id bàn đã đổi vị trí, chờ lưu
  final GlobalKey _canvasKey = GlobalKey();

  bool get hasChanges => _dirty.isNotEmpty;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await widget.api.getFloorPlan();
      if (!mounted) return;
      setState(() {
        _zones = (data['zones'] as List? ?? [])
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _tables = (data['tables'] as List? ?? [])
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _dirty.clear();
        _loading = false;
      });
      widget.onDirtyChanged?.call();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  void _toast(String m, {bool error = false}) =>
      appToast(context, m, isError: error);

  double _dx(Map<String, dynamic> t) => (t['pos_x'] as num?)?.toDouble() ?? -1;
  double _dy(Map<String, dynamic> t) => (t['pos_y'] as num?)?.toDouble() ?? -1;

  // Nạp lại từ server (huỷ thay đổi chưa lưu) — dùng khi cần bỏ dở.
  Future<void> reload() => _load();

  /// LƯU toàn bộ vị trí đã đổi trong MỘT lần (một PIN). Panel gọi khi bấm "Lưu".
  Future<bool> saveChanges(String pin) async {
    if (_dirty.isEmpty) return true;
    final positions = _tables
        .where((t) => _dirty.contains(asText(t['id'])))
        .map((t) => <String, dynamic>{
              'id': t['id'],
              'pos_x': _dx(t),
              'pos_y': _dy(t),
              if (asText(t['zone_id']).isNotEmpty) 'zone_id': t['zone_id'],
            })
        .toList();
    try {
      await widget.api.saveTablePositions(positions, pin);
      if (!mounted) return true;
      setState(() => _dirty.clear());
      widget.onDirtyChanged?.call();
      _toast(t('Đã lưu sơ đồ bàn'));
      return true;
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
      return false;
    }
  }

  List<Map<String, dynamic>> get _placed => _tables.where((t) {
        if (_dx(t) < 0) return false;
        if (_activeZone.isEmpty) return true;
        return asText(t['zone_id']) == _activeZone;
      }).toList();

  List<Map<String, dynamic>> get _unplaced => _tables.where((t) {
        if (_dx(t) >= 0) return false;
        if (_activeZone.isEmpty) return true;
        final z = asText(t['zone_id']);
        return z.isEmpty || z == _activeZone;
      }).toList();

  void _markMoved(int idx, double gx, double gy) {
    final maxX = (kFloorCols - kTableCells).toDouble();
    var nx = gx.clamp(0.0, maxX);
    var ny = gy.clamp(0.0, 200.0);
    // Kéo vào tab khu vực cụ thể → gán luôn khu vực đó.
    final zoneId =
        _activeZone.isNotEmpty ? _activeZone : asText(_tables[idx]['zone_id']);
    setState(() {
      _tables[idx]['pos_x'] = nx;
      _tables[idx]['pos_y'] = ny;
      if (zoneId.isNotEmpty) _tables[idx]['zone_id'] = zoneId;
      _dirty.add(asText(_tables[idx]['id']));
    });
    widget.onDirtyChanged?.call();
  }

  void _snap(int idx) {
    if (!_autoFit) return;
    final t = _tables[idx];
    setState(() {
      _tables[idx]['pos_x'] = _dx(t).roundToDouble(); // hít về dấu "+" gần nhất
      _tables[idx]['pos_y'] = _dy(t).roundToDouble();
    });
  }

  // Bỏ bàn khỏi sơ đồ → về khay (chưa xếp).
  void _unplace(int idx) {
    setState(() {
      _tables[idx]['pos_x'] = -1.0;
      _tables[idx]['pos_y'] = -1.0;
      _dirty.add(asText(_tables[idx]['id']));
    });
    widget.onDirtyChanged?.call();
  }

  Future<void> _createZone() async {
    final ctrl = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(t('Tạo khu vực mới')),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration:
              InputDecoration(hintText: t('Tên khu vực (VD: Tầng trệt)')),
          onSubmitted: (v) => Navigator.pop(context, v.trim()),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context), child: Text(t('Hủy'))),
          FilledButton(
              onPressed: () => Navigator.pop(context, ctrl.text.trim()),
              child: Text(t('Tạo'))),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;
    final pin = await widget.askPin();
    if (pin == null) return;
    try {
      await widget.api.createZone(name, pin);
      _toast(t('Đã tạo khu vực'));
      await _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  Future<void> _deleteZone(Map<String, dynamic> zone) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(t('Xóa khu vực "${asText(zone['name'])}"?')),
        content: Text(t(
            'Bàn thuộc khu vực này sẽ về "chưa xếp" (không bị xóa). Tiếp tục?')),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(t('Hủy'))),
          FilledButton(
              style: FilledButton.styleFrom(backgroundColor: DanColors.late),
              onPressed: () => Navigator.pop(context, true),
              child: Text(t('Xóa'))),
        ],
      ),
    );
    if (ok != true) return;
    final pin = await widget.askPin();
    if (pin == null) return;
    try {
      await widget.api.deleteZone(asText(zone['id']), pin);
      if (_activeZone == asText(zone['id'])) _activeZone = '';
      _toast(t('Đã xóa khu vực'));
      await _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(t('Không tải được sơ đồ ($_error)'),
              style: const TextStyle(color: DanColors.late)),
          const SizedBox(height: 8),
          OutlinedButton(onPressed: _load, child: Text(t('Thử lại'))),
        ]),
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _zoneRail(),
        const VerticalDivider(width: 1, color: DanColors.border),
        // "Tất cả" = chỉ XEM danh sách mọi bàn (không kéo-thả). Sắp xếp vị trí chỉ
        // làm trong TỪNG khu vực cụ thể — chọn khu vực bên trái.
        Expanded(
            child: _activeZone.isEmpty ? _allTablesList() : _canvasAndTray()),
      ],
    );
  }

  Widget _zoneRail() {
    return SizedBox(
      width: 200,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(t('KHU VỰC'),
                style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    color: DanColors.muted,
                    fontSize: 12)),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              children: [
                _zoneTile(id: '', name: t('Tất cả')),
                for (final z in _zones)
                  _zoneTile(
                      id: asText(z['id']),
                      name: asText(z['name']),
                      onDelete: () => _deleteZone(z)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(8),
            child: OutlinedButton.icon(
              onPressed: _createZone,
              icon: const Icon(Icons.add, size: 18),
              label: Text(t('Tạo khu vực')),
            ),
          ),
        ],
      ),
    );
  }

  Widget _zoneTile(
      {required String id, required String name, VoidCallback? onDelete}) {
    final active = _activeZone == id;
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Material(
        color: active ? DanColors.brandDim : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () => setState(() => _activeZone = id),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            child: Row(children: [
              Expanded(
                child: Text(name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                        color: active ? DanColors.brand : DanColors.text)),
              ),
              if (onDelete != null)
                InkWell(
                  onTap: onDelete,
                  child:
                      const Icon(Icons.close, size: 15, color: DanColors.faint),
                ),
            ]),
          ),
        ),
      ),
    );
  }

  // Danh sách CHỈ-XEM cho tab "Tất cả": gom bàn theo khu vực, không kéo-thả.
  Widget _allTablesList() {
    final byZone = <String, List<Map<String, dynamic>>>{};
    for (final tb in _tables) {
      (byZone[asText(tb['zone_id'])] ??= []).add(tb);
    }
    final sections = <Widget>[];
    void addSection(String title, List<Map<String, dynamic>> list) {
      if (list.isEmpty) return;
      sections.add(Padding(
        padding: const EdgeInsets.fromLTRB(2, 14, 2, 8),
        child: Text('$title  (${list.length})',
            style: const TextStyle(
                fontWeight: FontWeight.w800,
                color: DanColors.muted,
                fontSize: 12.5)),
      ));
      sections.add(Wrap(spacing: 8, runSpacing: 8, children: [
        for (final tb in list)
          _TableChip(
              code: asText(tb['code']),
              seats: (tb['seats'] as num?)?.toInt() ?? 4),
      ]));
    }

    for (final z in _zones) {
      addSection(asText(z['name']), byZone[asText(z['id'])] ?? const []);
    }
    addSection(t('Chưa gán khu vực'), byZone[''] ?? const []);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
          child: Row(children: [
            const Icon(Icons.list_alt, size: 18, color: DanColors.muted),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                t('Danh sách tất cả bàn (chỉ xem). Chọn một khu vực bên trái để kéo-thả sắp xếp.'),
                style: const TextStyle(color: DanColors.muted, fontSize: 12.5),
              ),
            ),
          ]),
        ),
        const Divider(height: 1, color: DanColors.border),
        Expanded(
          child: sections.isEmpty
              ? Center(
                  child: Text(t('Chưa có bàn nào'),
                      style: const TextStyle(color: DanColors.faint)))
              : ListView(
                  padding: const EdgeInsets.fromLTRB(14, 4, 14, 14),
                  children: sections),
        ),
      ],
    );
  }

  Widget _canvasAndTray() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
          child: Row(children: [
            const Icon(Icons.open_with, size: 18, color: DanColors.muted),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                t('Kéo bàn tự do đặt bất kỳ đâu. Dấu "+" là điểm góc để tham chiếu. Lưới chỉ hiện ở Cài đặt; POS/Tablet chỉ xem.'),
                style: const TextStyle(color: DanColors.muted, fontSize: 12.5),
              ),
            ),
            Row(mainAxisSize: MainAxisSize.min, children: [
              Text(t('Hít góc'),
                  style: const TextStyle(
                      fontSize: 12.5, fontWeight: FontWeight.w700)),
              Switch(
                  value: _autoFit,
                  onChanged: (v) => setState(() => _autoFit = v)),
            ]),
          ]),
        ),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: LayoutBuilder(builder: (context, c) {
              final cellW = c.maxWidth / kFloorCols;
              final cellH = cellW; // ô vuông
              final tableW = cellW * kTableCells;
              final tableH = cellH * 1.0;

              return DragTarget<String>(
                // Thả bàn từ khay vào bất kỳ điểm nào của canvas.
                onAcceptWithDetails: (d) {
                  final box = _canvasKey.currentContext?.findRenderObject()
                      as RenderBox?;
                  if (box == null) return;
                  final local = box.globalToLocal(d.offset);
                  final idx =
                      _tables.indexWhere((t) => asText(t['id']) == d.data);
                  if (idx < 0) return;
                  _markMoved(idx, local.dx / cellW, local.dy / cellH);
                  _snap(idx);
                },
                builder: (context, cand, rej) {
                  return Container(
                    key: _canvasKey,
                    decoration: BoxDecoration(
                      color: DanColors.surface2,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                          color: cand.isNotEmpty
                              ? DanColors.brand
                              : DanColors.border),
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: Stack(
                        children: [
                          // Nền lưới: các dấu "+" ở giao điểm.
                          Positioned.fill(
                            child: CustomPaint(
                              painter:
                                  _PlusGridPainter(cellW: cellW, cellH: cellH),
                            ),
                          ),
                          for (final tb in _placed)
                            _positionedTable(tb, cellW, cellH, tableW, tableH),
                        ],
                      ),
                    ),
                  );
                },
              );
            }),
          ),
        ),
        _tray(),
      ],
    );
  }

  Widget _positionedTable(Map<String, dynamic> tb, double cellW, double cellH,
      double tableW, double tableH) {
    final idx = _tables.indexWhere((t) => asText(t['id']) == asText(tb['id']));
    return Positioned(
      left: _dx(tb) * cellW,
      top: _dy(tb) * cellH,
      width: tableW,
      height: tableH,
      child: GestureDetector(
        // KÉO TỰ DO — không hỏi PIN, chỉ cập nhật vị trí cục bộ + đánh dấu cần lưu.
        onPanUpdate: (d) {
          if (idx < 0) return;
          _markMoved(
              idx, _dx(tb) + d.delta.dx / cellW, _dy(tb) + d.delta.dy / cellH);
        },
        onPanEnd: (_) {
          if (idx >= 0) _snap(idx);
        },
        onDoubleTap: () {
          if (idx >= 0) _unplace(idx); // nhấp đúp → bỏ khỏi sơ đồ
        },
        child: Tooltip(
          message: t('Kéo để di chuyển · Nhấp đúp để bỏ khỏi sơ đồ'),
          child: _TableChip(
              code: asText(tb['code']),
              seats: (tb['seats'] as num?)?.toInt() ?? 4),
        ),
      ),
    );
  }

  Widget _tray() {
    final items = _unplaced;
    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: DanColors.border)),
        color: DanColors.surface,
      ),
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${t('Bàn chưa xếp vị trí')} (${items.length})',
              style:
                  const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
          const SizedBox(height: 8),
          if (items.isEmpty)
            Text(t('Tất cả bàn đã lên sơ đồ. Kéo thả bàn để đổi chỗ.'),
                style: const TextStyle(color: DanColors.faint, fontSize: 12))
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final tb in items)
                  Draggable<String>(
                    data: asText(tb['id']),
                    feedback: Material(
                        color: Colors.transparent,
                        child: SizedBox(
                            width: 70,
                            height: 54,
                            child: _TableChip(
                                code: asText(tb['code']),
                                seats: (tb['seats'] as num?)?.toInt() ?? 4))),
                    childWhenDragging: Opacity(
                        opacity: .3,
                        child: SizedBox(
                            width: 70,
                            height: 54,
                            child: _TableChip(
                                code: asText(tb['code']),
                                seats: (tb['seats'] as num?)?.toInt() ?? 4))),
                    child: SizedBox(
                        width: 70,
                        height: 54,
                        child: _TableChip(
                            code: asText(tb['code']),
                            seats: (tb['seats'] as num?)?.toInt() ?? 4)),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

// Vẽ dấu "+" nhỏ ở mỗi GIAO ĐIỂM lưới — chỉ để tham chiếu góc ô, không kẻ ô kín.
class _PlusGridPainter extends CustomPainter {
  final double cellW;
  final double cellH;
  _PlusGridPainter({required this.cellW, required this.cellH});

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = const Color(0xFFCBD3DD)
      ..strokeWidth = 1;
    const arm = 4.0; // nửa chiều dài dấu +
    for (double y = 0; y <= size.height + 0.5; y += cellH) {
      for (double x = 0; x <= size.width + 0.5; x += cellW) {
        canvas.drawLine(Offset(x - arm, y), Offset(x + arm, y), p);
        canvas.drawLine(Offset(x, y - arm), Offset(x, y + arm), p);
      }
    }
  }

  @override
  bool shouldRepaint(_PlusGridPainter old) =>
      old.cellW != cellW || old.cellH != cellH;
}

class _TableChip extends StatelessWidget {
  final String code;
  final int seats;
  const _TableChip({required this.code, required this.seats});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: DanColors.brand.withValues(alpha: .12),
        border: Border.all(color: DanColors.brand.withValues(alpha: .6)),
        borderRadius: BorderRadius.circular(8),
      ),
      alignment: Alignment.center,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(code,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  fontWeight: FontWeight.w900,
                  color: DanColors.brand,
                  fontSize: 13)),
          Text('$seats ${t('chỗ')}',
              style: const TextStyle(color: DanColors.faint, fontSize: 10)),
        ],
      ),
    );
  }
}
