// GENERATED SPLIT of retail_screen.dart — voucher ngoài + thẻ SKU/dòng giỏ (part of, cùng library).
part of 'retail_screen.dart';

class _ExternalVoucherDialog extends StatefulWidget {
  final List<RetailVoucher> vouchers;
  final RetailVoucher? selected;
  final num billTotal;

  _ExternalVoucherDialog({
    required this.vouchers,
    required this.selected,
    required this.billTotal,
  });

  @override
  State<_ExternalVoucherDialog> createState() => _ExternalVoucherDialogState();
}

class _ExternalVoucherDialogState extends State<_ExternalVoucherDialog> {
  late final TextEditingController _codeCtrl;
  String? _error;

  @override
  void initState() {
    super.initState();
    final v = widget.selected;
    _codeCtrl =
        TextEditingController(text: v?.code.isNotEmpty == true ? v!.code : '');
  }

  @override
  void dispose() {
    _codeCtrl.dispose();
    super.dispose();
  }

  RetailVoucher? _match() {
    final q = _codeCtrl.text.trim().toUpperCase();
    if (q.isEmpty) return null;
    for (final v in widget.vouchers) {
      if (v.code.toUpperCase() == q) return v;
    }
    return null;
  }

  void _apply() {
    final q = _codeCtrl.text.trim();
    if (q.isEmpty) {
      Navigator.of(context).pop('');
      return;
    }
    final v = _match();
    if (v == null) {
      setState(
          () => _error = t('Mã voucher không tồn tại hoặc chưa đủ điều kiện.'));
      return;
    }
    Navigator.of(context).pop(v.id);
  }

  @override
  Widget build(BuildContext context) {
    final match = _match();
    return Dialog(
      backgroundColor: DanColors.surface,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 620, maxHeight: 620),
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(20, 18, 14, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Text(t('Voucher ngoài'),
                        style: TextStyle(
                            fontSize: 19, fontWeight: FontWeight.w900)),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: Icon(Icons.close, color: DanColors.faint),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: DanColors.border),
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      t('Nhập mã voucher giấy, voucher công ty, đối tác hoặc UrBox. CTKM sản phẩm chọn bằng icon hộp quà trên từng dòng hàng.'),
                      style: TextStyle(fontSize: 12.5, color: DanColors.muted),
                    ),
                    SizedBox(height: 12),
                    TextField(
                      controller: _codeCtrl,
                      autofocus: true,
                      textCapitalization: TextCapitalization.characters,
                      decoration: InputDecoration(
                        labelText: t('Mã voucher'),
                        prefixIcon: Icon(Icons.local_activity_outlined),
                        errorText: _error,
                      ),
                      onChanged: (_) => setState(() => _error = null),
                      onSubmitted: (_) => _apply(),
                    ),
                    SizedBox(height: 12),
                    if (match != null)
                      _ExternalVoucherTile(
                        voucher: match,
                        billTotal: widget.billTotal,
                        selected: true,
                        onTap: _apply,
                      )
                    else if (widget.vouchers.isEmpty)
                      Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Center(
                          child: Text(
                              t('Không có voucher ngoài đang hoạt động'),
                              style: TextStyle(color: DanColors.faint)),
                        ),
                      )
                    else ...[
                      Text(t('Gợi ý voucher đang hoạt động'),
                          style: TextStyle(
                              fontSize: 12.5, fontWeight: FontWeight.w900)),
                      SizedBox(height: 8),
                      for (final v in widget.vouchers)
                        Padding(
                          padding: EdgeInsets.only(bottom: 8),
                          child: _ExternalVoucherTile(
                            voucher: v,
                            billTotal: widget.billTotal,
                            selected: widget.selected?.id == v.id,
                            onTap: () {
                              _codeCtrl.text =
                                  v.code.isNotEmpty ? v.code : v.name;
                              _apply();
                            },
                          ),
                        ),
                    ],
                  ],
                ),
              ),
            ),
            Divider(height: 1, color: DanColors.border),
            Padding(
              padding: EdgeInsets.all(14),
              child: Row(
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(''),
                    child: Text(t('Không dùng')),
                  ),
                  Spacer(),
                  FilledButton.icon(
                    onPressed: _apply,
                    icon: Icon(Icons.check, size: 18),
                    label: Text(t('Áp dụng')),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ExternalVoucherTile extends StatelessWidget {
  final RetailVoucher voucher;
  final num billTotal;
  final bool selected;
  final VoidCallback onTap;

  _ExternalVoucherTile({
    required this.voucher,
    required this.billTotal,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final amount =
        billTotal >= voucher.minTotal ? voucher.amountFor(billTotal) : 0;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(DanRadius.md),
      child: Container(
        padding: EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected
              ? DanColors.brand.withValues(alpha: .08)
              : DanColors.surface2,
          borderRadius: BorderRadius.circular(DanRadius.md),
          border:
              Border.all(color: selected ? DanColors.brand : DanColors.border),
        ),
        child: Row(
          children: [
            Icon(Icons.local_activity_outlined,
                color: selected ? DanColors.brand : DanColors.muted),
            SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(voucher.displayName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontWeight: FontWeight.w900)),
                  SizedBox(height: 2),
                  Text(
                    voucher.minTotal > 0
                        ? '${t('Tối thiểu')} ${Fmt.money(voucher.minTotal)}'
                        : t('Không yêu cầu bill tối thiểu'),
                    style: TextStyle(fontSize: 11.5, color: DanColors.muted),
                  ),
                ],
              ),
            ),
            SizedBox(width: 10),
            Text(amount > 0 ? '-${Fmt.money(amount)}' : voucher.valueLabel,
                style: TextStyle(
                    color: DanColors.done, fontWeight: FontWeight.w900)),
          ],
        ),
      ),
    );
  }
}

class _RetailTotals {
  final num subtotal;
  final num productDiscount;
  final num orderDiscount;
  final num customerDiscount;
  final num manualDiscount;
  final num vat;
  final num total;
  final RetailVoucher? orderVoucher;

  _RetailTotals({
    required this.subtotal,
    required this.productDiscount,
    required this.orderDiscount,
    required this.customerDiscount,
    required this.manualDiscount,
    required this.vat,
    required this.total,
    required this.orderVoucher,
  });
}

class _SkuCard extends StatelessWidget {
  final Sku sku;
  final String serverUrl;
  final String promoLabel;
  final VoidCallback onTap;

  _SkuCard({
    required this.sku,
    required this.serverUrl,
    required this.promoLabel,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final out = sku.stock <= 0;
    return InkWell(
      onTap: out ? null : onTap,
      borderRadius: BorderRadius.circular(DanRadius.md),
      child: Opacity(
        opacity: out ? .52 : 1,
        child: Container(
          decoration: BoxDecoration(
            color: DanColors.surface,
            border: Border.all(color: DanColors.border),
            borderRadius: BorderRadius.circular(DanRadius.md),
            boxShadow: [
              BoxShadow(
                  color: Colors.black.withValues(alpha: .025),
                  blurRadius: 6,
                  offset: Offset(0, 2)),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(height: 122, child: _image()),
                  Expanded(
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(9, 6, 9, 7),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          // Flexible: tên co lại nếu thiếu chỗ, không đẩy tràn card.
                          Flexible(
                            child: Text(sku.name,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w800,
                                    height: 1.18)),
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(Fmt.money(sku.price),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w900,
                                      color: DanColors.brand)),
                              Text(
                                  '${t('Tồn')}: ${Fmt.int0(sku.stock)} ${sku.unit}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                      fontSize: 10.5,
                                      color: out
                                          ? DanColors.late
                                          : DanColors.muted,
                                      fontWeight: FontWeight.w600)),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
              // Badge khuyến mãi chỉ hiện khi SKU thực sự có voucher.
              if (promoLabel.isNotEmpty)
                Positioned(
                  top: 7,
                  right: 7,
                  child: Container(
                    padding: EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: DanColors.doing,
                      borderRadius: BorderRadius.circular(99),
                      boxShadow: [
                        BoxShadow(
                            color: Colors.black.withValues(alpha: .12),
                            blurRadius: 8)
                      ],
                    ),
                    child: Text(promoLabel,
                        style: TextStyle(
                            fontSize: 9.5,
                            color: Colors.white,
                            fontWeight: FontWeight.w900)),
                  ),
                ),
              if (out)
                Positioned(
                  top: 7,
                  left: 7,
                  child: Container(
                    padding: EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: DanColors.late,
                      borderRadius: BorderRadius.circular(99),
                    ),
                    child: Text(t('Hết'),
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 9.5,
                            fontWeight: FontWeight.w900)),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _image() {
    if (sku.image.isEmpty) {
      return _placeholder();
    }
    final url = sku.image.startsWith('http')
        ? sku.image
        : '$serverUrl${sku.image.startsWith('/') ? '' : '/'}${sku.image}';
    return Container(
      color: Colors.white,
      child: Image.network(
        url,
        fit: BoxFit.contain,
        width: double.infinity,
        // Thumbnail-size decode + reuse frame across rebuilds → far lighter on
        // weak POS hardware when the catalogue has many SKUs.
        cacheWidth: 240,
        filterQuality: FilterQuality.low,
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) => _placeholder(),
      ),
    );
  }

  Widget _placeholder() {
    // SKU chưa có ảnh → ô xám nhạt + icon hộp hàng cho có chủ đích (trước đây
    // để trống trơn nên trông như thẻ bị lỗi/trắng).
    return Container(
      color: DanColors.surface2,
      alignment: Alignment.center,
      child:
          Icon(Icons.inventory_2_outlined, size: 34, color: DanColors.border),
    );
  }
}

class _CartRow extends StatelessWidget {
  final CartLine line;
  final List<StockLot> lots;
  final String promoText;
  final bool hasPromos;
  final bool promoApplied;
  final VoidCallback onPickPromo;
  final ValueChanged<String?> onLotChanged;
  final VoidCallback onInc;
  final VoidCallback onDec;
  final VoidCallback onRemove;

  _CartRow({
    required this.line,
    required this.lots,
    required this.promoText,
    required this.hasPromos,
    required this.promoApplied,
    required this.onPickPromo,
    required this.onLotChanged,
    required this.onInc,
    required this.onDec,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    final hasLots = lots.isNotEmpty;
    final selected =
        hasLots && lots.any((l) => l.id == line.lotId) ? line.lotId : '';
    return Container(
      padding: EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        children: [
          Row(
            children: [
              if (hasPromos) ...[
                InkWell(
                  onTap: onPickPromo,
                  borderRadius: BorderRadius.circular(8),
                  child: Container(
                    width: 28,
                    height: 28,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: promoApplied ? DanColors.doing : DanColors.surface,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                          color: promoApplied
                              ? DanColors.doing
                              : DanColors.border2),
                    ),
                    child: Icon(Icons.card_giftcard,
                        size: 15,
                        color: promoApplied ? Colors.white : DanColors.doing),
                  ),
                ),
                SizedBox(width: 8),
              ],
              Expanded(
                child: Text(line.sku.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style:
                        TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
              ),
              SizedBox(width: 8),
              Text(Fmt.money(line.lineTotal),
                  style: TextStyle(
                      color: DanColors.brand, fontWeight: FontWeight.w900)),
            ],
          ),
          SizedBox(height: 7),
          if (hasLots)
            DropdownButtonFormField<String>(
              initialValue: selected,
              isDense: true,
              // Nhãn lot dài (mã + HSD + tồn) — isExpanded để không tràn ngang.
              isExpanded: true,
              decoration: InputDecoration(
                labelText: 'Lot / HSD',
                isDense: true,
                contentPadding:
                    EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              ),
              items: [
                DropdownMenuItem(value: '', child: Text(t('FEFO tự động'))),
                for (final lot in lots)
                  DropdownMenuItem(
                      value: lot.id,
                      child: Text(lot.label,
                          maxLines: 1, overflow: TextOverflow.ellipsis)),
              ],
              onChanged: onLotChanged,
            )
          else
            Align(
              alignment: Alignment.centerLeft,
              child: Text(t('FEFO tự động'),
                  style: TextStyle(fontSize: 11, color: DanColors.faint)),
            ),
          if (promoText.isNotEmpty) ...[
            SizedBox(height: 6),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(promoText,
                  style: TextStyle(
                      color: DanColors.doing,
                      fontSize: 11,
                      fontWeight: FontWeight.w800)),
            ),
          ],
          SizedBox(height: 7),
          Row(
            children: [
              _QtyBtn(icon: Icons.remove, onTap: onDec),
              Container(
                width: 34,
                alignment: Alignment.center,
                child: Text('${line.qty}',
                    style:
                        TextStyle(fontSize: 14, fontWeight: FontWeight.w900)),
              ),
              _QtyBtn(icon: Icons.add, onTap: onInc),
              Spacer(),
              Text(Fmt.money(line.sku.price),
                  style: TextStyle(fontSize: 11.5, color: DanColors.faint)),
              IconButton(
                onPressed: onRemove,
                visualDensity: VisualDensity.compact,
                icon: Icon(Icons.close, size: 16, color: DanColors.faint),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _QtyBtn extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  _QtyBtn({required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(7),
      child: Container(
        width: 28,
        height: 28,
        decoration: BoxDecoration(
          color: DanColors.surface,
          borderRadius: BorderRadius.circular(7),
          border: Border.all(color: DanColors.border2),
        ),
        child: Icon(icon, size: 15, color: DanColors.text),
      ),
    );
  }
}

class _EmptyCart extends StatelessWidget {
  _EmptyCart();

  @override
  Widget build(BuildContext context) {
    // Cuộn được + ảnh giới hạn chiều cao: trên tablet màn ngắn, khối rỗng này
    // KHÔNG còn tràn xuống đè lên phần tổng tiền/thanh toán bên dưới.
    return SingleChildScrollView(
      padding: EdgeInsets.symmetric(vertical: 16),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ConstrainedBox(
              constraints: BoxConstraints(maxWidth: 132, maxHeight: 80),
              child: Image.asset(
                'assets/brand/DanOnLogo.png',
                fit: BoxFit.contain,
                errorBuilder: (_, __, ___) => Icon(Icons.shopping_bag_outlined,
                    size: 52, color: DanColors.faint),
              ),
            ),
            SizedBox(height: 14),
            Container(
              padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: DanColors.surface2,
                borderRadius: BorderRadius.circular(99),
                border: Border.all(color: DanColors.border2),
              ),
              child: Text(t('Quét/chạm sản phẩm để bắt đầu'),
                  style: TextStyle(
                      color: DanColors.muted,
                      fontSize: 12,
                      fontWeight: FontWeight.w800)),
            ),
            SizedBox(height: 8),
            Text(t('Giỏ hàng đang trống'),
                style: TextStyle(fontSize: 11, color: DanColors.faint)),
          ],
        ),
      ),
    );
  }
}

class _CountDot extends StatelessWidget {
  final String text;
  final bool active;
  _CountDot(this.text, this.active);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: active ? Colors.white24 : DanColors.surface3,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(text,
          style: TextStyle(
              color: active ? Colors.white : DanColors.muted,
              fontSize: 10,
              fontWeight: FontWeight.w900)),
    );
  }
}
