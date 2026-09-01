part of 'retail_screen.dart';

// GIỎ HÀNG — Sale mode view (tách khỏi retail_screen.dart để file chính chỉ còn
// orchestration/state/tab/navigation). Extension trên _RetailScreenState → truy cập
// private cùng library, BEHAVIOR-PRESERVING. setState -> rebuild() (helper public,
// tránh cảnh báo protected khi gọi trong extension). KHÔNG đổi hành vi bán hàng.
extension _RetailSaleCartView on _RetailScreenState {
  Widget _cartPanel() {
    // §2 gated: tab chạy canonical order → render + ghi qua server (giá server áp).
    // Đường legacy (giỏ-chia-sẻ) bên dưới GIỮ NGUYÊN khi không có session.
    if (_activeSession != null) return _canonicalCartPanel();
    final totals = _totals();
    return Container(
      color: DanColors.surface,
      child: Column(
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(16, 14, 12, 10),
            child: Row(
              children: [
                Icon(Icons.shopping_cart_outlined,
                    size: 18, color: DanColors.muted),
                SizedBox(width: 8),
                Text(t('Giỏ hàng'),
                    style:
                        TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                SizedBox(width: 8),
                Text('${_cartDisplay().length} ${t('mặt hàng')}',
                    style: TextStyle(fontSize: 12, color: DanColors.faint)),
                Spacer(),
                if (_cart.isNotEmpty)
                  IconButton(
                    onPressed: () {
                      rebuild(() {
                        _cart.clear();
                        _tab.manualDiscount = 0;
                        _tab.orderVoucherId = null;
                        _tab.note = '';
                        _tab.priceOverridePin = null;
                      });
                      _pushCustomerDisplay();
                    },
                    icon: Icon(Icons.delete_outline,
                        color: DanColors.late, size: 19),
                    tooltip: t('Xóa giỏ'),
                  ),
              ],
            ),
          ),
          Divider(height: 1, color: DanColors.border),
          Expanded(
            child: _cart.isEmpty
                ? _EmptyCart()
                : Builder(builder: (_) {
                    final entries = _cartDisplay();
                    return ListView.separated(
                      padding: EdgeInsets.all(12),
                      itemCount: entries.length,
                      separatorBuilder: (_, __) => SizedBox(height: 8),
                      itemBuilder: (_, i) {
                        final e = entries[i];
                        if (e.isCombo) {
                          return _comboRow(e.comboId!, e.comboLines);
                        }
                        final line = e.line!;
                        return _CartRow(
                          line: line,
                          lots: _lotsForSku(line.sku),
                          promoText: _linePromoHint(line),
                          hasPromos: _lineVoucherCandidates(line).isNotEmpty,
                          promoApplied: line.voucherId != null,
                          onPickPromo: () => _pickLineVoucher(line),
                          onLotChanged: (lotId) => _changeLot(line, lotId),
                          onInc: () => _changeQty(line, 1),
                          onDec: () => _changeQty(line, -1),
                          onEditPrice: () => _editLinePrice(line),
                          onEditNote: () => _editLineNote(line),
                          onRemove: () {
                            rebuild(() => _cart.remove(line));
                            _pushCustomerDisplay();
                          },
                        );
                      },
                    );
                  }),
          ),
          Divider(height: 1, color: DanColors.border),
          _cartFooter(totals),
        ],
      ),
    );
  }

  // Danh sách dòng hiển thị: hàng thường giữ nguyên, combo gom về 1 dòng (theo
  // thứ tự xuất hiện đầu tiên của nhóm).
  List<_CartDisplay> _cartDisplay() {
    final out = <_CartDisplay>[];
    final seen = <String>{};
    for (final line in _cart) {
      if (line.isCombo) {
        if (seen.add(line.comboId!)) {
          out.add(_CartDisplay.combo(line.comboId!,
              _cart.where((c) => c.comboId == line.comboId).toList()));
        }
      } else {
        out.add(_CartDisplay.single(line));
      }
    }
    return out;
  }

  Widget _stepBtn(IconData icon, VoidCallback onTap) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: EdgeInsets.all(5),
          decoration: BoxDecoration(
            color: DanColors.surface,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: DanColors.border),
          ),
          child: Icon(icon, size: 16),
        ),
      );

  // Dòng combo trong giỏ: tên + tổng tiền, dưới là thành phần "món ×SL", đơn giá
  // mỗi combo + stepper số combo + nút xóa. Chạm dòng → sửa thành phần.
  Widget _comboRow(String comboId, List<CartLine> lines) {
    final v = _comboVoucherFor(comboId);
    final count = _comboCount(lines);
    final gross = _comboGrossPerCombo(lines);
    final unit = v == null ? gross : _comboUnitPrice(v, gross);
    final lineTotal = unit * count;
    final name = lines.first.comboName ?? (v?.displayName ?? t('Combo'));
    final parts = lines.map((l) => '${l.sku.name} ×${l.qty}').join('   •   ');
    return InkWell(
      onTap: () => _editCombo(comboId),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: DanColors.brand.withValues(alpha: .06),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: DanColors.brand.withValues(alpha: .30)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.card_giftcard, size: 16, color: DanColors.brand),
                SizedBox(width: 6),
                Expanded(
                  child: Text(name,
                      style: TextStyle(
                          fontWeight: FontWeight.w800, fontSize: 13.5)),
                ),
                Text(Fmt.money(lineTotal),
                    style: TextStyle(fontWeight: FontWeight.w800)),
              ],
            ),
            SizedBox(height: 4),
            Text(parts,
                style: TextStyle(fontSize: 11.5, color: DanColors.muted)),
            SizedBox(height: 8),
            Row(
              children: [
                Text('${Fmt.money(unit)}/${t('combo')}',
                    style: TextStyle(fontSize: 12, color: DanColors.muted)),
                Spacer(),
                _stepBtn(Icons.remove, () => _changeComboCount(comboId, -1)),
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: 12),
                  child: Text('$count',
                      style:
                          TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                ),
                _stepBtn(Icons.add, () => _changeComboCount(comboId, 1)),
                SizedBox(width: 4),
                IconButton(
                  icon: Icon(Icons.close, size: 18, color: DanColors.late),
                  onPressed: () => _removeCombo(comboId),
                  tooltip: t('Xóa combo'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _linePromoHint(CartLine line) {
    final applied = _lineAppliedPromoText(line);
    if (applied.isNotEmpty) return applied;
    RetailVoucher? bestVoucher;
    num best = 0;
    for (final v in _lineVoucherCandidates(line)) {
      final amount = _lineVoucherAmount(line, v);
      if (amount > best) {
        best = amount;
        bestVoucher = v;
      }
    }
    if (bestVoucher == null) {
      final buyX = _lineVoucherCandidates(line)
          .where((v) => v.type == 'buy_x_get_1')
          .firstOrNull;
      return buyX == null ? '' : '${t('Có CTKM')}: ${buyX.displayName}';
    }
    if (bestVoucher.type == 'buy_x_get_1') {
      return '${t('Gợi ý')}: ${bestVoucher.displayName}';
    }
    return '${t('Gợi ý')}: ${bestVoucher.displayName} ${t('giảm')} ${Fmt.money(best)}';
  }

  Widget _cartFooter(_RetailTotals totals) {
    // `totals.total` là TRƯỚC giảm giá tay → net = trừ giảm tay, hiện + thu đúng.
    final net =
        (totals.total - totals.manualDiscount).clamp(0, double.infinity);
    return Padding(
      padding: EdgeInsets.all(16),
      child: Column(
        children: [
          _clickRow(
            t('Khách hàng'),
            _customer?.title.isNotEmpty == true
                ? _customer!.title
                : t('Bán cho người tiêu dùng'),
            _openCustomerPicker,
          ),
          _clickRow(
            'Voucher',
            totals.orderVoucher?.displayName ?? t('Thêm'),
            _pickOrderVoucher,
            accent: totals.orderVoucher != null,
          ),
          _clickRow(
            t('Giảm giá'),
            _tab.manualDiscount > 0
                ? '-${Fmt.money(_tab.manualDiscount)}'
                : t('Thêm'),
            _openManualDiscount,
            accent: _tab.manualDiscount > 0,
          ),
          _clickRow(
            '${t('Ghi chú')}:',
            _tab.note,
            _editNote,
            accent: _tab.note.isNotEmpty,
          ),
          SizedBox(height: 6),
          _totalRow(t('Tạm tính'), Fmt.money(totals.subtotal)),
          if (totals.comboDiscount > 0)
            _totalRow(t('Combo'), '-${Fmt.money(totals.comboDiscount)}',
                accent: DanColors.doing),
          if (totals.productDiscount > 0)
            _totalRow(t('Khuyến mãi sản phẩm'),
                '-${Fmt.money(totals.productDiscount)}',
                accent: DanColors.doing),
          if (totals.orderDiscount > 0)
            _totalRow(totals.orderVoucher?.name ?? 'Voucher',
                '-${Fmt.money(totals.orderDiscount)}',
                accent: DanColors.done),
          if (totals.customerDiscount > 0)
            _totalRow(t('Ưu đãi khách hàng'),
                '-${Fmt.money(totals.customerDiscount)}',
                accent: DanColors.done),
          if (totals.manualDiscount > 0)
            _totalRow(t('Giảm giá tay'), '-${Fmt.money(totals.manualDiscount)}',
                accent: DanColors.done),
          if (totals.vat > 0)
            _totalRow(t('Trong đó VAT'), Fmt.money(totals.vat)),
          Divider(height: 18, color: DanColors.border),
          _totalRow(t('TỔNG CỘNG'), Fmt.money(net), big: true),
          SizedBox(height: 12),
          Row(children: [
            SizedBox(
              width: 64,
              height: 50,
              child: OutlinedButton(
                onPressed: _cart.isEmpty || _salesLocked ? null : _printPreview,
                child: Text(t('In'),
                    style: TextStyle(fontWeight: FontWeight.w900)),
              ),
            ),
            SizedBox(width: 8),
            Expanded(
              child: SizedBox(
                width: double.infinity,
                height: 50,
                child: FilledButton.icon(
                  onPressed: _cart.isEmpty || _salesLocked ? null : _checkout,
                  icon: Icon(Icons.payments_outlined),
                  label: Text('${t('Thanh toán')}  ${Fmt.money(net)}',
                      style:
                          TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
                ),
              ),
            ),
          ]),
        ],
      ),
    );
  }
}
