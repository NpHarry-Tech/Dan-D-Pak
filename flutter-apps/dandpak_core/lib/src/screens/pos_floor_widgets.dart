// GENERATED SPLIT of pos_screen.dart — sơ đồ bàn / chọn bàn / dòng khách.
// Cùng library (part of) nên mọi class/helper private dùng chung nguyên vẹn.
part of 'pos_screen.dart';

class _FloorMap extends StatelessWidget {
  _FloorMap({
    required this.tables,
    required this.zones,
    required this.selectedZoneId,
    required this.onSelectZone,
    required this.selectedTable,
    required this.loading,
    required this.onSelect,
    required this.onHoldToReset,
    required this.money,
    required this.isFree,
    required this.isPaying,
    required this.isCalling,
  });

  final List<TableModel> tables;
  final List<Zone> zones;
  // '' hoặc 'all' = xem TẤT CẢ (danh sách); còn lại = tên khu vực đang chọn.
  final String selectedZoneId;
  final ValueChanged<String> onSelectZone;
  final TableModel? selectedTable;
  final bool loading;
  final ValueChanged<TableModel> onSelect;

  /// Nhấn giữ 3 giây vào một bàn — mở hộp thoại dọn sạch bàn đó.
  final ValueChanged<TableModel> onHoldToReset;
  final String Function(num value) money;
  final bool Function(TableModel table) isFree;
  final bool Function(TableModel table) isPaying;
  final bool Function(TableModel table) isCalling;

  bool get _allMode => selectedZoneId.isEmpty || selectedZoneId == 'all';

  Widget _zoneRailButton(
      {required String label,
      required bool active,
      required VoidCallback onTap}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: active ? DanColors.brandDim : DanColors.surface,
        borderRadius: BorderRadius.circular(9),
        child: InkWell(
          borderRadius: BorderRadius.circular(9),
          onTap: onTap,
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(9),
              border: Border.all(
                  color: active ? DanColors.brand : DanColors.border),
            ),
            child: Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                    color: active ? DanColors.brand : DanColors.text)),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (loading && tables.isEmpty) {
      return Center(child: CircularProgressIndicator(color: DanColors.brand));
    }

    // Gom theo ĐỊNH DANH khu vực (zoneId) nhưng HIỂN THỊ theo tên (zoneName).
    final grouped = <String, List<TableModel>>{};
    final zoneNames = <String, String>{};
    for (final table in tables) {
      final key = table.zoneId;
      grouped.putIfAbsent(key, () => []).add(table);
      zoneNames[key] = table.zoneName.isEmpty ? t('Khu vực') : table.zoneName;
    }

    final total = tables.length;
    final open = tables.where((table) => !isFree(table)).length;
    final paying = tables.where(isPaying).length;
    final calling = tables.where(isCalling).length;

    // NỘI DUNG: "Tất cả" → mọi khu vực dạng DANH SÁCH; chọn khu vực → LAYOUT khu đó.
    final Widget content;
    if (grouped.isEmpty) {
      content = _EmptyBlock(
        title: t('Chưa có bàn'),
        sub: t('Vào Cài đặt để cấu hình sơ đồ bàn.'),
        minHeight: 300,
      );
    } else if (_allMode) {
      content = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final entry in grouped.entries)
            _ZoneSection(
              listMode: true,
              name: zoneNames[entry.key] ?? t('Khu vực'),
              tables: entry.value,
              selectedTable: selectedTable,
              onSelect: onSelect,
              onHoldToReset: onHoldToReset,
              money: money,
              isFree: isFree,
              isPaying: isPaying,
              isCalling: isCalling,
            ),
        ],
      );
    } else {
      final zoneTables = tables
          .where((tb) =>
              (tb.zoneName.isEmpty ? t('Khu vực') : tb.zoneName) ==
              selectedZoneId)
          .toList();
      content = zoneTables.isEmpty
          ? _EmptyBlock(
              title: t('Khu vực này chưa có bàn'),
              sub: t('Chọn "Tất cả" để xem toàn bộ, hoặc thêm bàn ở Cài đặt.'),
              minHeight: 300,
            )
          : _ZoneSection(
              listMode: false,
              name: selectedZoneId,
              tables: zoneTables,
              selectedTable: selectedTable,
              onSelect: onSelect,
              onHoldToReset: onHoldToReset,
              money: money,
              isFree: isFree,
              isPaying: isPaying,
              isCalling: isCalling,
            );
    }

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            constraints: BoxConstraints(minHeight: 64),
            padding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: DanColors.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: DanColors.border),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        t('Sơ đồ bàn'),
                        style: TextStyle(
                            fontSize: 14, fontWeight: FontWeight.w800),
                      ),
                      SizedBox(height: 2),
                      Text(
                        '$total ${t('bàn')} · ${math.max(0, total - open)} ${t('trống')}',
                        style: TextStyle(
                          color: DanColors.muted,
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  alignment: WrapAlignment.end,
                  children: [
                    _StatusPill(
                        label: '$open ${t('ĐANG DÙNG')}',
                        color: DanColors.doing),
                    _StatusPill(label: '$paying ${t('CHỜ THU')}', muted: true),
                    if (calling > 0)
                      _StatusPill(
                          label: '$calling ${t('ĐANG GỌI')}',
                          color: DanColors.late),
                  ],
                ),
              ],
            ),
          ),
          SizedBox(height: 12),
          // THANH KHU VỰC BÊN TRÁI + nội dung bên phải.
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 138,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _zoneRailButton(
                      label: t('Tất cả'),
                      active: _allMode,
                      onTap: () => onSelectZone('all'),
                    ),
                    for (final z in zones)
                      _zoneRailButton(
                        label: z.name,
                        active: !_allMode && selectedZoneId == z.id,
                        onTap: () => onSelectZone(z.id),
                      ),
                  ],
                ),
              ),
              SizedBox(width: 12),
              Expanded(child: content),
            ],
          ),
        ],
      ),
    );
  }
}

class _ZoneSection extends StatelessWidget {
  _ZoneSection({
    required this.name,
    required this.tables,
    required this.selectedTable,
    required this.onSelect,
    required this.onHoldToReset,
    required this.money,
    required this.isFree,
    required this.isPaying,
    required this.isCalling,
    this.listMode = false,
  });

  // listMode = xem "Tất cả": mọi bàn xếp dạng LƯỚI DANH SÁCH (bỏ vị trí đã setup).
  // false = xem một khu vực: bàn đặt đúng LAYOUT đã dựng ở Cài đặt.
  final bool listMode;
  final String name;
  final List<TableModel> tables;
  final TableModel? selectedTable;
  final ValueChanged<TableModel> onSelect;
  final ValueChanged<TableModel> onHoldToReset;
  final String Function(num value) money;
  final bool Function(TableModel table) isFree;
  final bool Function(TableModel table) isPaying;
  final bool Function(TableModel table) isCalling;

  @override
  Widget build(BuildContext context) {
    final open = tables.where((table) => !isFree(table)).length;
    return Padding(
      padding: EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    name.toUpperCase(),
                    style: TextStyle(
                      color: DanColors.muted,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      letterSpacing: .8,
                    ),
                  ),
                ),
                Text(
                  '${tables.length} ${t('bàn')} · $open ${t('đang dùng')}',
                  style: TextStyle(
                    color: DanColors.faint,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
          LayoutBuilder(
            builder: (context, constraints) {
              final gap = 9.0;
              Widget card(TableModel table) => _TableCard(
                    table: table,
                    selected: selectedTable?.id == table.id,
                    onTap: () => onSelect(table),
                    onHoldToReset: () => onHoldToReset(table),
                    money: money,
                    isFree: isFree(table),
                    isPaying: isPaying(table),
                    isCalling: isCalling(table),
                  );

              // BÀN ĐÃ XẾP VỊ TRÍ → đặt đúng ô lưới (như đã dựng ở Cài đặt) nhưng
              // KHÔNG kẻ lưới. Bàn chưa xếp → xếp lần lượt bên dưới (Wrap).
              // listMode ("Tất cả"): coi MỌI bàn là chưa xếp → ra danh sách lưới.
              final placed = listMode
                  ? <TableModel>[]
                  : tables.where((tb) => tb.posX >= 0).toList();
              final loose = listMode
                  ? tables
                  : tables.where((tb) => tb.posX < 0).toList();

              Widget looseWrap() {
                if (loose.isEmpty) return const SizedBox.shrink();
                final minTileWidth = constraints.maxWidth < 1180 ? 88.0 : 104.0;
                final columns = math.max(
                    1,
                    ((constraints.maxWidth + gap) / (minTileWidth + gap))
                        .floor());
                final tileWidth =
                    (constraints.maxWidth - (columns - 1) * gap) / columns;
                return Wrap(
                  spacing: gap,
                  runSpacing: gap,
                  children: loose
                      .map((table) => SizedBox(
                          width: tileWidth,
                          height: constraints.maxWidth < 1180 ? 82 : 90,
                          child: card(table)))
                      .toList(),
                );
              }

              if (placed.isEmpty) {
                return SizedBox(width: double.infinity, child: looseWrap());
              }
              // KHỚP HỆT trình thiết kế (floor_plan_editor): CÙNG lưới kFloorCols
              // cột, ô VUÔNG (cao = rộng), thẻ bàn rộng kTableCells ô — nhờ vậy
              // KHOẢNG CÁCH & VỊ TRÍ bàn ở POS giống y lúc thiết kế (chỉ khác: POS
              // KHÔNG vẽ lưới "+"). Trước đây POS tự tính số cột động + ô chữ nhật
              // (rowH=cell*0.9) nên bàn dãn ra khác hẳn Cài đặt. Ô có bề rộng TỐI
              // THIỂU để màn nhỏ không bóp chữ → tràn thì CUỘN NGANG.
              var maxY = 0.0;
              for (final tb in placed) {
                if (tb.posY > maxY) maxY = tb.posY;
              }
              // VỪA CẢ HAI CHIỀU, không cắt bàn (Gate-7): ô vuông, chọn cạnh nhỏ
              // hơn giữa rộng/cột và cao/hàng; nhỏ quá thì CUỘN. Trước đây chỉ theo
              // bề rộng nên màn rộng làm ô cao vống → hàng bàn dưới tràn ra bị cắt.
              final cellW = floorCellSize(
                maxWidth: constraints.maxWidth,
                maxHeight: constraints.maxHeight,
                rows: (maxY + 1).ceil(),
              );
              final cellH = cellW; // ô VUÔNG như editor
              final canvasW = kFloorCols * cellW;
              final stack = SizedBox(
                width: canvasW,
                height: (maxY + 1) * cellH,
                child: Stack(
                  children: [
                    for (final tb in placed)
                      Positioned(
                        left: tb.posX * cellW,
                        top: tb.posY * cellH,
                        width: cellW * kTableCells - gap,
                        height: cellH - gap,
                        child: card(tb),
                      ),
                  ],
                ),
              );
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  canvasW > constraints.maxWidth + 1
                      ? SingleChildScrollView(
                          scrollDirection: Axis.horizontal, child: stack)
                      // Vừa khung → CĂN GIỮA ngang (không dồn trái để trống bên phải).
                      : Align(alignment: Alignment.topCenter, child: stack),
                  if (loose.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    looseWrap(),
                  ],
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _TableCard extends StatefulWidget {
  _TableCard({
    required this.table,
    required this.selected,
    required this.onTap,
    required this.onHoldToReset,
    required this.money,
    required this.isFree,
    required this.isPaying,
    required this.isCalling,
  });

  final TableModel table;
  final bool selected;
  final VoidCallback onTap;

  /// Gọi khi thu ngân NHẤN GIỮ đủ lâu — mở hộp thoại dọn sạch bàn.
  final VoidCallback onHoldToReset;
  final String Function(num value) money;
  final bool isFree;
  final bool isPaying;
  final bool isCalling;

  @override
  State<_TableCard> createState() => _TableCardState();
}

/// Nhấn giữ 3 giây để dọn sạch bàn.
///
/// Vì sao phải giữ LÂU và có vòng tiến trình: đây là thao tác phá huỷ (huỷ hết
/// món, trả bàn về trống). Chạm nhầm trong lúc bưng bê là chuyện thường, nên
/// phải giữ đủ lâu và nhìn thấy rõ mình đang kích hoạt cái gì. Rung nhẹ lúc bắt
/// đầu giữ và rung mạnh hơn khi đủ giờ — giống cảm giác nhấn giữ trên iPhone.
class _TableCardState extends State<_TableCard>
    with SingleTickerProviderStateMixin {
  static const _holdDuration = Duration(seconds: 3);
  late final AnimationController _hold = AnimationController(
    vsync: this,
    duration: _holdDuration,
  )..addStatusListener((s) {
      if (s == AnimationStatus.completed) {
        HapticFeedback.heavyImpact(); // đủ giờ — báo bằng cú rung mạnh
        widget.onHoldToReset();
        _hold.reset();
      }
    });

  @override
  void dispose() {
    _hold.dispose();
    super.dispose();
  }

  void _startHold() {
    HapticFeedback.selectionClick(); // chạm nhẹ báo "đang tính giờ"
    _hold.forward(from: 0);
  }

  void _cancelHold() {
    if (_hold.isAnimating) _hold.reverse();
  }

  TableModel get table => widget.table;
  bool get selected => widget.selected;
  VoidCallback get onTap => widget.onTap;
  String Function(num value) get money => widget.money;
  bool get isFree => widget.isFree;
  bool get isPaying => widget.isPaying;
  bool get isCalling => widget.isCalling;

  // Trạng thái tiến độ MÓN của bàn đang có khách (đơn mở):
  // chưa gọi món → đang chờ bếp x/y → đã lên đủ → đã in tạm tính (sắp tính
  // tiền). Đã thanh toán thì server trả bàn về 'free' → hiện t("Trống").
  String _statusLabel() {
    if (isCalling) return t('Đang gọi');
    if (isFree) return t('Trống');
    if (isPaying) return t('Chờ thu ngân');
    if (table.prebillPrinted) return t('Đã in tạm tính');
    if (table.itemsCount == 0) return t('Chưa có món');
    if (table.itemsDone < table.itemsCount) {
      return '${t('Chưa đủ món')} ${table.itemsDone}/${table.itemsCount}';
    }
    return t('Đã đủ món');
  }

  Color _statusColor() {
    if (isCalling) return DanColors.late;
    if (isFree) return DanColors.faint;
    if (isPaying) return DanColors.paying;
    if (table.prebillPrinted) return DanColors.paying;
    if (table.itemsCount > 0 && table.itemsDone >= table.itemsCount) {
      return Color(0xFF16A34A); // đã đủ món — xanh lá
    }
    return DanColors.faint;
  }

  @override
  Widget build(BuildContext context) {
    // Vẽ lại theo tiến trình giữ để viền đỏ đậm dần — thu ngân thấy rõ mình đang
    // kích hoạt thao tác phá huỷ chứ không phải chạm nhầm.
    return AnimatedBuilder(
      animation: _hold,
      builder: (context, _) => _buildCard(context),
    );
  }

  Widget _buildCard(BuildContext context) {
    final busy = !isFree && !isPaying && !isCalling;
    final border = selected
        ? DanColors.brand
        : isCalling
            ? DanColors.late
            : isPaying
                ? DanColors.paying.withValues(alpha: .55)
                : busy
                    ? DanColors.doing.withValues(alpha: .48)
                    : DanColors.border;
    final bg = isPaying
        ? DanColors.paying.withValues(alpha: .06)
        : busy
            ? DanColors.doing.withValues(alpha: .05)
            : DanColors.surface;

    return InkWell(
      onTap: onTap,
      // Bắt trực tiếp sự kiện chạm thay vì onLongPress: cần biết CHÍNH XÁC lúc
      // nhả tay để dừng đồng hồ, và cần vẽ vòng tiến trình trong lúc giữ.
      onTapDown: (_) => _startHold(),
      onTapUp: (_) => _cancelHold(),
      onTapCancel: _cancelHold,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        foregroundDecoration: _hold.value > 0
            ? BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                    color: DanColors.late.withValues(alpha: _hold.value),
                    width: 2),
                color: DanColors.late.withValues(alpha: _hold.value * .12),
              )
            : null,
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: border, width: selected ? 2 : 1),
        ),
        child: Stack(
          children: [
            if (isCalling || isPaying)
              Positioned(
                top: 0,
                right: 0,
                child: Icon(
                    isCalling
                        ? Icons.notifications_active
                        : Icons.payments_outlined,
                    size: 13,
                    color: isCalling ? DanColors.late : DanColors.paying),
              ),
            Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    table.code,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontFamily: 'JetBrains Mono',
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  SizedBox(height: 5),
                  Text(
                    _statusLabel(),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: _statusColor(),
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if ((table.activeOrderTotal ?? 0) > 0) ...[
                    SizedBox(height: 2),
                    Text(
                      money(table.activeOrderTotal!),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: DanColors.brand,
                        fontFamily: 'JetBrains Mono',
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
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
}

class _NoCustomerSelection {
  _NoCustomerSelection();
}

String _mapText(Map<String, dynamic> map, String key) =>
    (map[key] ?? '').toString().trim();

class _PickTableRow extends StatelessWidget {
  _PickTableRow({
    required this.table,
    required this.money,
    required this.free,
    required this.showAmount,
    required this.onTap,
  });

  final TableModel table;
  final String Function(num value) money;
  final bool free;
  final bool showAmount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 11, vertical: 10),
        decoration: BoxDecoration(
          color: DanColors.surface2,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: DanColors.border),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(t('Bàn ${table.code}'),
                      style:
                          TextStyle(fontWeight: FontWeight.w900, fontSize: 13)),
                  SizedBox(height: 2),
                  Text(
                    '${table.zoneId.isEmpty ? t('Khu vực') : table.zoneId} · ${free ? t('Trống') : t('Đang có bill')}'
                    '${showAmount && (table.activeOrderTotal ?? 0) > 0 ? ' · ${money(table.activeOrderTotal!)}' : ''}',
                    style: TextStyle(color: DanColors.muted, fontSize: 12),
                  ),
                ],
              ),
            ),
            FilledButton(
              onPressed: onTap,
              style: FilledButton.styleFrom(
                minimumSize: Size(0, 32),
                padding: EdgeInsets.symmetric(horizontal: 12),
              ),
              child: Text(t('Chọn')),
            ),
          ],
        ),
      ),
    );
  }
}

class _CustomerRow extends StatelessWidget {
  _CustomerRow({
    required this.customer,
    required this.selected,
    required this.onTap,
  });

  final Map<String, dynamic> customer;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final name = _mapText(customer, 'name');
    final company = _mapText(customer, 'company');
    final phone = _mapText(customer, 'phone');
    final tax = _mapText(customer, 'tax_code');
    final title =
        name.isNotEmpty ? name : (company.isEmpty ? t('Khách hàng') : company);
    final sub = [
      if (phone.isNotEmpty) phone,
      if (tax.isNotEmpty) 'MST $tax',
      if (company.isNotEmpty && company != title) company,
    ].join(' · ');
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 11, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? DanColors.brandDim : DanColors.surface,
          borderRadius: BorderRadius.circular(10),
          border:
              Border.all(color: selected ? DanColors.brand : DanColors.border),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontWeight: FontWeight.w900, fontSize: 13.5)),
                  SizedBox(height: 3),
                  Text(sub.isEmpty ? '—' : sub,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: DanColors.muted, fontSize: 12)),
                ],
              ),
            ),
            OutlinedButton(
              onPressed: onTap,
              style: OutlinedButton.styleFrom(
                minimumSize: Size(0, 32),
                padding: EdgeInsets.symmetric(horizontal: 12),
              ),
              child: Text(t('Sửa')),
            ),
          ],
        ),
      ),
    );
  }
}
