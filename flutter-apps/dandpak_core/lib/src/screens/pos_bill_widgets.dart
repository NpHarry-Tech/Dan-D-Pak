// GENERATED SPLIT of pos_screen.dart — khung bill (pane/row/footer/total).
// Cùng library (part of) nên mọi class/helper private dùng chung nguyên vẹn.
part of 'pos_screen.dart';

class _BillPane extends StatelessWidget {
  _BillPane({
    required this.pos,
    required this.money,
    required this.isFree,
    required this.isPaying,
    required this.isCalling,
    required this.onAddFood,
    required this.onAddRetail,
    required this.onMove,
    required this.onMerge,
    required this.onSplit,
    required this.onCustomer,
    required this.onDiscount,
    required this.onPrint,
    required this.onSendKitchen,
    required this.onCancelItem,
    required this.onPayment,
    required this.openingPayment,
  });

  final PosProvider pos;
  final String Function(num value) money;
  final bool Function(TableModel table) isFree;
  final bool Function(TableModel table) isPaying;
  final bool Function(TableModel table) isCalling;
  final VoidCallback onAddFood;
  final VoidCallback onAddRetail;
  final VoidCallback onMove;
  final VoidCallback onMerge;
  final VoidCallback onSplit;
  final VoidCallback onCustomer;
  final VoidCallback onDiscount;
  final VoidCallback onPrint;
  final VoidCallback onSendKitchen;
  final ValueChanged<CartItem> onCancelItem;
  final VoidCallback onPayment;
  final bool openingPayment;

  @override
  Widget build(BuildContext context) {
    final table = pos.selectedTable;
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: DanColors.border),
      ),
      child: table == null ? _BillEmpty() : _buildSelectedBill(context, table),
    );
  }

  Widget _buildSelectedBill(BuildContext context, TableModel table) {
    final hasItems = pos.cart.isNotEmpty;
    final hasSavedItems = pos.cart.any((item) => item.persisted);
    final hasPending = pos.cart.any((item) => item.status == 'pending_confirm');
    return Column(
      children: [
        Container(
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 13),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: DanColors.border)),
          ),
          child: Row(
            children: [
              Icon(Icons.chair_alt_outlined, size: 17, color: DanColors.late),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  t('Bàn ${table.code}'),
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                ),
              ),
              if (pos.activeBillNo != null) ...[
                _SmallStatus(
                    label: '#${pos.activeBillNo}', color: DanColors.muted),
                SizedBox(width: 6),
              ],
              _SmallStatus(
                label: isCalling(table)
                    ? t('Đang gọi')
                    : isFree(table)
                        ? t('Trống')
                        : isPaying(table)
                            ? t('Chờ thu')
                            : t('Đang dùng'),
                color: isCalling(table)
                    ? DanColors.late
                    : isPaying(table)
                        ? DanColors.paying
                        : isFree(table)
                            ? DanColors.muted
                            : DanColors.doing,
              ),
            ],
          ),
        ),
        Padding(
          padding: EdgeInsets.fromLTRB(12, 10, 12, 0),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final half = (constraints.maxWidth - 8) / 2;
              Widget halfButton(_BillOpButton child) =>
                  SizedBox(width: half, child: child);
              return Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  halfButton(_BillOpButton(
                    icon: Icons.add,
                    label: t('Thêm món FnB'),
                    onTap: onAddFood,
                  )),
                  halfButton(_BillOpButton(
                    icon: Icons.shopping_cart_outlined,
                    label: t('Thêm retail'),
                    onTap: onAddRetail,
                  )),
                  if (hasSavedItems) ...[
                    halfButton(_BillOpButton(
                      icon: Icons.subdirectory_arrow_right,
                      label: t('Chuyển bàn'),
                      onTap: onMove,
                    )),
                    halfButton(_BillOpButton(
                      icon: Icons.compare_arrows,
                      label: t('Gộp bàn'),
                      onTap: onMerge,
                    )),
                    SizedBox(
                      width: constraints.maxWidth,
                      child: _BillOpButton(
                        icon: Icons.content_cut,
                        label: t('Tách bill / thanh toán riêng'),
                        onTap: onSplit,
                      ),
                    ),
                  ],
                ],
              );
            },
          ),
        ),
        if (isCalling(table))
          Padding(
            padding: EdgeInsets.fromLTRB(12, 10, 12, 0),
            child: Container(
              padding: EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(
                color: DanColors.late.withValues(alpha: .10),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: DanColors.late.withValues(alpha: .4)),
              ),
              child: Row(
                children: [
                  Icon(Icons.notifications_active,
                      size: 16, color: DanColors.late),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      table.callReason.isEmpty
                          ? t('Bàn đang gọi nhân viên')
                          : t('Khách bàn ${table.code} đang gọi: ${table.callReason}'),
                      style: TextStyle(
                        color: DanColors.late,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  _ResolveCallButton(
                    onTap: () async {
                      final api = context.read<ApiService>();
                      final pos = context.read<PosProvider>();
                      final messenger = ScaffoldMessenger.of(context);
                      try {
                        await api.resolveStaffCall(table.id);
                        await pos.loadFloor();
                        messenger.showSnackBar(SnackBar(
                          content:
                              Text(t('Đã xác nhận xử lý yêu cầu gọi phục vụ')),
                          backgroundColor: DanColors.done,
                        ));
                      } catch (e) {
                        messenger.showSnackBar(SnackBar(
                          content: Text(
                              e.toString().replaceFirst('Exception: ', '')),
                          backgroundColor: DanColors.late,
                        ));
                      }
                    },
                  ),
                ],
              ),
            ),
          ),
        Expanded(
          child: !hasItems
              ? _BillEmpty(
                  title: t('Bàn chưa có order'),
                  sub: t(
                      'Thêm món FnB/retail hoặc chờ khách gọi món từ tablet.'),
                )
              : ListView.separated(
                  padding: EdgeInsets.all(12),
                  itemCount: pos.cart.length,
                  separatorBuilder: (_, __) => SizedBox(height: 7),
                  itemBuilder: (context, index) {
                    final item = pos.cart[index];
                    return _BillItemRow(
                      item: item,
                      money: money,
                      onCancel: () => onCancelItem(item),
                    );
                  },
                ),
        ),
        if (hasItems)
          _BillFooter(
            subtotal: pos.cartSubtotal,
            discount: pos.activeDiscount,
            total: pos.cartTotal,
            saving: pos.isSavingOrder || openingPayment,
            canPay: hasItems && !openingPayment && !hasPending,
            customer: pos.selectedCustomer,
            hasPending: hasPending,
            money: money,
            onCustomer: onCustomer,
            onDiscount: onDiscount,
            onPrint: onPrint,
            onSendKitchen: onSendKitchen,
            onPayment: onPayment,
          ),
      ],
    );
  }
}

class _BillEmpty extends StatelessWidget {
  _BillEmpty({
    this.title = 'Chọn một bàn để xem bill',
    this.sub = 'Bàn đang trống sẽ hiện thao tác thêm món sau khi chọn',
  });

  final String title;
  final String sub;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: BoxConstraints(minHeight: 260),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Image.asset(
              'assets/brand/DanOnLogo.png',
              width: 110,
              fit: BoxFit.contain,
              errorBuilder: (_, __, ___) => SizedBox(width: 110, height: 62),
            ),
            SizedBox(height: 20),
            Container(
              padding: EdgeInsets.symmetric(horizontal: 14, vertical: 9),
              decoration: BoxDecoration(
                color: DanColors.surface2,
                borderRadius: BorderRadius.circular(99),
                border: Border.all(
                    color: DanColors.border2, style: BorderStyle.solid),
              ),
              child: Text(
                title,
                style: TextStyle(
                  color: DanColors.muted,
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            SizedBox(height: 12),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 18),
              child: Text(
                sub,
                textAlign: TextAlign.center,
                style: TextStyle(color: DanColors.faint, fontSize: 12),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BillItemRow extends StatelessWidget {
  _BillItemRow({
    required this.item,
    required this.money,
    required this.onCancel,
  });

  final CartItem item;
  final String Function(num value) money;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final meta = [
      if (item.selectedModifiers.isNotEmpty)
        item.selectedModifiers.map((m) => '+${m.name}').join(', '),
      if (item.notes.isNotEmpty) item.notes,
    ].join(' · ');
    return Container(
      padding: EdgeInsets.fromLTRB(11, 9, 7, 9),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: DanColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${item.qty}× ${item.item.name}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w800),
                      ),
                    ),
                    SizedBox(width: 8),
                    Text(
                      money(item.totalPrice),
                      style: TextStyle(
                        color: DanColors.muted,
                        fontFamily: 'JetBrains Mono',
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
                SizedBox(height: 5),
                Wrap(
                  spacing: 5,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    _ItemStatusChip(status: item.status),
                    if (meta.isNotEmpty)
                      Text(meta,
                          style:
                              TextStyle(color: DanColors.muted, fontSize: 11)),
                  ],
                ),
              ],
            ),
          ),
          SizedBox(width: 6),
          IconButton(
            onPressed: onCancel,
            tooltip: item.persisted ? t('Hủy món') : t('Xóa món nháp'),
            icon: Icon(Icons.close, size: 18),
            color: DanColors.faint,
            constraints: BoxConstraints.tightFor(width: 32, height: 32),
            padding: EdgeInsets.zero,
          ),
        ],
      ),
    );
  }
}

class _ItemStatusChip extends StatelessWidget {
  _ItemStatusChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final label = switch (status) {
      'pending_confirm' => t('Chờ xác nhận'),
      'new' => t('Chờ bếp'),
      'accepted' => t('Đã nhận'),
      'preparing' => t('Đang làm'),
      'ready' => t('Sẵn sàng'),
      'served' => t('Đã phục vụ'),
      _ => t('Mới'),
    };
    final color = switch (status) {
      'pending_confirm' => DanColors.doing,
      'new' => DanColors.newState,
      'accepted' || 'preparing' => DanColors.doing,
      'ready' => DanColors.done,
      'served' => DanColors.muted,
      _ => DanColors.brand,
    };
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .13),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10.5,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _BillFooter extends StatelessWidget {
  _BillFooter({
    required this.subtotal,
    required this.discount,
    required this.total,
    required this.saving,
    required this.canPay,
    required this.customer,
    required this.hasPending,
    required this.money,
    required this.onCustomer,
    required this.onDiscount,
    required this.onPrint,
    required this.onSendKitchen,
    required this.onPayment,
  });

  final double subtotal;
  final double discount;
  final double total;
  final bool saving;
  final bool canPay;
  final Map<String, dynamic>? customer;
  final bool hasPending;
  final String Function(num value) money;
  final VoidCallback onCustomer;
  final VoidCallback onDiscount;
  final VoidCallback onPrint;
  final VoidCallback onSendKitchen;
  final VoidCallback onPayment;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(16, 12, 16, 16),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: DanColors.border)),
      ),
      child: Column(
        children: [
          _CustomerLine(customer: customer, onTap: onCustomer),
          SizedBox(height: 8),
          _BillTotalLine(label: t('Tạm tính'), value: money(subtotal)),
          if (discount > 0)
            _BillTotalLine(label: t('Giảm giá'), value: '-${money(discount)}'),
          SizedBox(height: 5),
          Row(
            children: [
              Expanded(
                child: Text(
                  t('Tổng cộng'),
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                ),
              ),
              Text(
                money(total),
                style: TextStyle(
                  color: DanColors.brand,
                  fontFamily: 'JetBrains Mono',
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          SizedBox(height: 12),
          if (hasPending) ...[
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: saving ? null : onSendKitchen,
                icon: Icon(Icons.local_fire_department_outlined, size: 17),
                label: Text(t('Gửi món vào bếp')),
              ),
            ),
            SizedBox(height: 8),
          ],
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: saving ? null : onDiscount,
                  child: Text(t('% Giảm giá')),
                ),
              ),
              SizedBox(width: 8),
              Expanded(
                child: OutlinedButton(
                  onPressed: saving ? null : onPrint,
                  child: Text(t('In tạm tính')),
                ),
              ),
            ],
          ),
          SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: canPay ? onPayment : null,
              child: saving
                  ? SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : Text('${t('Thanh toán')} · ${money(total)}'),
            ),
          ),
        ],
      ),
    );
  }
}

class _CustomerLine extends StatelessWidget {
  _CustomerLine({required this.customer, required this.onTap});

  final Map<String, dynamic>? customer;
  final VoidCallback onTap;

  String _label() {
    final c = customer;
    if (c == null) return t('Khách không xuất hóa đơn');
    final name = (c['name'] ?? '').toString().trim();
    final company = (c['company'] ?? '').toString().trim();
    return name.isNotEmpty
        ? name
        : (company.isNotEmpty ? company : t('Khách hàng'));
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: DanColors.surface2,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: DanColors.border),
        ),
        child: Row(
          children: [
            Icon(Icons.person, size: 16, color: DanColors.paying),
            SizedBox(width: 7),
            Expanded(
              child: Text(
                _label(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
              ),
            ),
            SizedBox(width: 8),
            OutlinedButton(
              onPressed: onTap,
              style: OutlinedButton.styleFrom(
                minimumSize: Size(0, 34),
                padding: EdgeInsets.symmetric(horizontal: 10),
              ),
              child: Text(t('Chọn khách')),
            ),
          ],
        ),
      ),
    );
  }
}

class _BillTotalLine extends StatelessWidget {
  _BillTotalLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(color: DanColors.muted, fontSize: 12),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: DanColors.muted,
              fontFamily: 'JetBrains Mono',
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

class _BillOpButton extends StatelessWidget {
  _BillOpButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        height: 38,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: DanColors.surface2,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: DanColors.border2),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 16, color: DanColors.paying),
            SizedBox(width: 6),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

