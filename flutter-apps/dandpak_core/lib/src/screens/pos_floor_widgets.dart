// GENERATED SPLIT of pos_screen.dart — sơ đồ bàn / chọn bàn / dòng khách.
// Cùng library (part of) nên mọi class/helper private dùng chung nguyên vẹn.
part of 'pos_screen.dart';

class _FloorMap extends StatelessWidget {
  _FloorMap({
    required this.tables,
    required this.selectedTable,
    required this.loading,
    required this.onSelect,
    required this.money,
    required this.isFree,
    required this.isPaying,
    required this.isCalling,
  });

  final List<TableModel> tables;
  final TableModel? selectedTable;
  final bool loading;
  final ValueChanged<TableModel> onSelect;
  final String Function(num value) money;
  final bool Function(TableModel table) isFree;
  final bool Function(TableModel table) isPaying;
  final bool Function(TableModel table) isCalling;

  @override
  Widget build(BuildContext context) {
    if (loading && tables.isEmpty) {
      return Center(child: CircularProgressIndicator(color: DanColors.brand));
    }

    final grouped = <String, List<TableModel>>{};
    for (final table in tables) {
      grouped.putIfAbsent(
          table.zoneId.isEmpty ? t('Khu vực') : table.zoneId, () => []);
      grouped[table.zoneId.isEmpty ? t('Khu vực') : table.zoneId]!.add(table);
    }

    final total = tables.length;
    final open = tables.where((table) => !isFree(table)).length;
    final paying = tables.where(isPaying).length;
    final calling = tables.where(isCalling).length;

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
          if (grouped.isEmpty)
            _EmptyBlock(
              title: t('Chưa có bàn'),
              sub: t('Vào Cài đặt để cấu hình sơ đồ bàn.'),
              minHeight: 300,
            )
          else
            ...grouped.entries.map(
              (entry) => _ZoneSection(
                name: entry.key,
                tables: entry.value,
                selectedTable: selectedTable,
                onSelect: onSelect,
                money: money,
                isFree: isFree,
                isPaying: isPaying,
                isCalling: isCalling,
              ),
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
    required this.money,
    required this.isFree,
    required this.isPaying,
    required this.isCalling,
  });

  final String name;
  final List<TableModel> tables;
  final TableModel? selectedTable;
  final ValueChanged<TableModel> onSelect;
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
              final minTileWidth = constraints.maxWidth < 1180 ? 88.0 : 104.0;
              final columns = math.max(
                1,
                ((constraints.maxWidth + gap) / (minTileWidth + gap)).floor(),
              );
              final tileWidth =
                  (constraints.maxWidth - (columns - 1) * gap) / columns;

              return SizedBox(
                width: double.infinity,
                child: Wrap(
                  spacing: gap,
                  runSpacing: gap,
                  alignment: WrapAlignment.start,
                  runAlignment: WrapAlignment.start,
                  children: tables.map((table) {
                    return SizedBox(
                      width: tileWidth,
                      height: constraints.maxWidth < 1180 ? 82 : 90,
                      child: _TableCard(
                        table: table,
                        selected: selectedTable?.id == table.id,
                        onTap: () => onSelect(table),
                        money: money,
                        isFree: isFree(table),
                        isPaying: isPaying(table),
                        isCalling: isCalling(table),
                      ),
                    );
                  }).toList(),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _TableCard extends StatelessWidget {
  _TableCard({
    required this.table,
    required this.selected,
    required this.onTap,
    required this.money,
    required this.isFree,
    required this.isPaying,
    required this.isCalling,
  });

  final TableModel table;
  final bool selected;
  final VoidCallback onTap;
  final String Function(num value) money;
  final bool isFree;
  final bool isPaying;
  final bool isCalling;

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
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
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

