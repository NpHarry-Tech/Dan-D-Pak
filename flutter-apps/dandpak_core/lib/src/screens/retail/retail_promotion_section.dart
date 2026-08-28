part of 'retail_screen.dart';

// §SPLIT combo picker + voucher/promo label + line promo text. Tách
// behavior-preserving khỏi _RetailScreenState (field _comboSeq/getters ở lại lớp).
extension _RetailPromotionSection on _RetailScreenState {
  List<Sku> _comboEligibleSkus(RetailVoucher v) => comboEligibleSkus(v, _skus);
  List<String> _selectedComboIds() => selectedComboIds(_cart);
  Map<String, List<CartLine>> _comboGroups() => comboGroups(_cart);
  int _comboCount(List<CartLine> lines) => comboCount(lines);
  num _comboGrossPerCombo(List<CartLine> lines) => comboGrossPerCombo(lines);
  num _comboUnitPrice(RetailVoucher v, num gross) => comboUnitPrice(v, gross);

  RetailVoucher? _comboVoucherFor(String comboId) {
    final vid = comboId.split('#').first;
    for (final v in _comboVouchers) {
      if (v.id == vid) return v;
    }
    // Có thể ngoài giờ/không usable nhưng vẫn còn trong _activeVouchers.
    for (final v in _activeVouchers) {
      if (v.id == vid) return v;
    }
    return null;
  }

  // Mở dialog chọn thành phần combo (dùng cho cả THÊM mới lẫn SỬA nhóm sẵn có).
  Future<void> _openComboPicker(RetailVoucher v,
      {String? existingId,
      Map<Sku, int>? initial,
      int initialCount = 1}) async {
    if (_salesLocked) {
      _toast(t('Cần mở ca làm việc trước khi bán hàng.'), error: true);
      _openShiftDialog();
      return;
    }
    // Lấy ĐỦ SKU từ server — KHÔNG dựa _skus đang phân trang (chỉ ~40 món nạp),
    // vì SKU của combo có thể chưa được nạp → trước đây báo nhầm "chưa có sản
    // phẩm phù hợp" dù kho có sẵn.
    List<Sku> eligible;
    try {
      final res = await context
          .read<ApiService>()
          .getSkusPaginated(page: 1, limit: 2000, channel: 'retail');
      final all = (res['items'] as List? ?? [])
          .whereType<Map>()
          .map((e) => Sku.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      eligible = comboEligibleSkus(v, all);
    } catch (_) {
      eligible = _comboEligibleSkus(v); // mất mạng → dùng danh sách đã nạp
    }
    if (!mounted) return;
    if (eligible.isEmpty) {
      _toast(t('Combo chưa có sản phẩm phù hợp trong kho'), error: true);
      return;
    }
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => ComboPickerDialog(
        voucher: v,
        eligible: eligible,
        initial: initial,
        initialCount: initialCount,
      ),
    );
    if (result == null || !mounted) return;
    _applyCombo(v, result['perCombo'] as Map<Sku, int>, result['count'] as int,
        existingId: existingId);
  }

  // Ghi combo vào giỏ: mỗi thành phần thành 1 CartLine gắn cùng comboId. Sửa =
  // xóa nhóm cũ rồi ghi lại (giữ nguyên comboId). count = số combo.
  void _applyCombo(RetailVoucher v, Map<Sku, int> perCombo, int count,
      {String? existingId}) {
    final chosen = perCombo.entries.where((e) => e.value > 0).toList();
    if (chosen.isEmpty || count <= 0) {
      if (existingId != null) _removeCombo(existingId);
      return;
    }
    final comboId = existingId ?? '${v.id}#${_comboSeq++}';
    rebuild(() {
      if (existingId != null) _cart.removeWhere((c) => c.comboId == existingId);
      for (final e in chosen) {
        final lot = _defaultLot(e.key);
        _cart.add(CartLine(e.key, e.value * count,
            lotId: lot?.id,
            comboId: comboId,
            comboName: v.displayName,
            comboPer: e.value));
      }
    });
    _pushCustomerDisplay();
  }

  // Nút +/− trên dòng combo: cộng/trừ ĐỀU comboPer cho từng thành phần (= 1 combo).
  void _changeComboCount(String comboId, int delta) {
    final lines = _cart.where((c) => c.comboId == comboId).toList();
    if (lines.isEmpty) return;
    if (delta > 0) {
      for (final l in lines) {
        if (l.qty + delta * l.comboPer > _availableFor(l)) {
          _toast(t('Không đủ tồn cho ${l.sku.name}'), error: true);
          return;
        }
      }
    }
    rebuild(() {
      for (final l in lines) {
        l.qty += delta * l.comboPer;
      }
      if (lines.first.qty <= 0) _cart.removeWhere((c) => c.comboId == comboId);
    });
    _pushCustomerDisplay();
  }

  void _removeCombo(String comboId) {
    rebuild(() => _cart.removeWhere((c) => c.comboId == comboId));
    _pushCustomerDisplay();
  }

  void _editCombo(String comboId) {
    final lines = _cart.where((c) => c.comboId == comboId).toList();
    if (lines.isEmpty) return;
    final v = _comboVoucherFor(comboId);
    if (v == null) return;
    _openComboPicker(v,
        existingId: comboId,
        initial: {for (final l in lines) l.sku: l.comboPer},
        initialCount: _comboCount(lines));
  }

  String _promoLabelForSku(Sku sku) {
    // Khớp voucher gán đúng SKU hoặc t('Mọi sản phẩm') (all_sku); SKU cụ thể
    // ưu tiên hiển thị trước.
    final matches =
        _usableVouchers.where((v) => v.appliesToSku(sku.id)).toList();
    if (matches.isEmpty) return '';
    matches.sort((a, b) {
      final ad = a.amountFor(sku.price, qty: 1);
      final bd = b.amountFor(sku.price, qty: 1);
      if (bd != ad) return bd.compareTo(ad);
      if (a.isSku != b.isSku) return a.isSku ? -1 : 1;
      return 0;
    });
    return matches.first.valueLabel;
  }

  String? _lotNoOf(CartLine line) => _selectedLot(line)?.lotNo;

  List<RetailVoucher> _lineVoucherCandidates(CartLine line) {
    final lotNo = _lotNoOf(line);
    return _usableVouchers
        .where((v) =>
            (v.isSku || v.isAllSku) &&
            v.appliesToSku(line.sku.id, lotNo: lotNo))
        .toList();
  }

  RetailVoucher? _selectedLineVoucher(CartLine line) {
    final id = line.voucherId;
    if (id == null || id.isEmpty) return null;
    return _lineVoucherCandidates(line).where((v) => v.id == id).firstOrNull;
  }

  num _lineVoucherAmount(CartLine line, RetailVoucher v) {
    final base = line.lineTotal;
    if (base <= 0) return 0;
    if (v.type == 'buy_x_get_1') {
      final x = v.value.round().clamp(1, 1000000);
      final freeUnits = line.qty ~/ (x + 1);
      return (freeUnits * line.sku.price).clamp(0, base);
    }
    if (base < v.minTotal) return 0;
    return v.amountFor(base, qty: line.qty).clamp(0, base);
  }

  String _lineAppliedPromoText(CartLine line) {
    final v = _selectedLineVoucher(line);
    if (v == null) return '';
    final amount = _lineVoucherAmount(line, v);
    if (amount <= 0) return '';
    if (v.type == 'buy_x_get_1') {
      final x = v.value.round().clamp(1, 1000000);
      final freeUnits = line.qty ~/ (x + 1);
      return t('${v.displayName}: tặng $freeUnits ${line.sku.unit}');
    }
    return t('${v.displayName}: giảm ${Fmt.money(amount)}');
  }

  _RetailTotals _totals() {
    final subtotal = _cart.fold<num>(0, (s, c) => s + c.lineTotal);
    // ƯU TIÊN engine server (gồm combo, mua-X-tặng-1 tự động) khi còn khớp giỏ.
    if (_preview != null && _previewSig == _cartSignature(_tab)) {
      final p = _preview!;
      num pn(String k) => (p[k] as num?) ?? 0;
      final srvSubtotal = pn('subtotal') > 0 ? pn('subtotal') : subtotal;
      final lineDiscount = pn('lineDiscount');
      final orderDiscount = pn('orderDiscount');
      final discount = pn('discount');
      final total = pn('total') > 0
          ? pn('total')
          : (srvSubtotal - discount).clamp(0, double.infinity);
      num combo = 0;
      for (final pr in (p['appliedSkuPromos'] as List? ?? const [])) {
        if (pr is Map && pr['type'] == 'combo') {
          combo += (pr['amount'] as num?) ?? 0;
        }
      }
      final customerDiscount =
          (discount - lineDiscount - orderDiscount).clamp(0, double.infinity);
      num vat = 0;
      if (srvSubtotal > 0 && total > 0) {
        final priced = _cart.where((l) => l.lineTotal > 0).toList();
        num allocated = 0;
        for (var i = 0; i < priced.length; i++) {
          final line = priced[i];
          final gross = i == priced.length - 1
              ? total - allocated
              : (line.lineTotal * total / srvSubtotal).round();
          allocated += gross;
          if (line.sku.vatRate > 0) {
            vat += gross - (gross / (1 + line.sku.vatRate / 100)).round();
          }
        }
      }
      return _RetailTotals(
        subtotal: srvSubtotal,
        productDiscount: (lineDiscount - combo).clamp(0, double.infinity),
        orderDiscount: orderDiscount,
        customerDiscount: customerDiscount,
        // Giảm giá tay áp lúc checkout (server tính riêng) → `total` ở đây là số
        // TRƯỚC giảm tay; footer/màn khách tự trừ để hiện số cuối.
        manualDiscount: _tab.manualDiscount,
        comboDiscount: combo,
        vat: vat,
        total: total,
        orderVoucher: _voucherById(_tab.orderVoucherId),
      );
    }
    // Combo (Option B) khi MẤT preview server: tự tính để không thu lố khách.
    // Combo KHÔNG chồng CTKM sản phẩm/voucher đơn (giống engine server).
    num comboDiscount = 0;
    for (final entry in _comboGroups().entries) {
      final v = _comboVoucherFor(entry.key);
      if (v == null) continue;
      final count = _comboCount(entry.value);
      final gross = _comboGrossPerCombo(entry.value);
      comboDiscount += (gross - _comboUnitPrice(v, gross)) * count;
    }
    num productDiscount = 0;
    num orderEligibleSubtotal = 0;
    for (final line in _cart) {
      if (line.isCombo) continue; // combo tính riêng bên trên
      final v = _selectedLineVoucher(line);
      final lineDiscount = v == null ? 0 : _lineVoucherAmount(line, v);
      productDiscount += lineDiscount;
      if (lineDiscount <= 0) orderEligibleSubtotal += line.lineTotal;
    }
    final afterProduct =
        (subtotal - productDiscount - comboDiscount).clamp(0, double.infinity);
    final orderVoucher = _voucherById(_tab.orderVoucherId);
    final orderDiscount =
        orderVoucher != null && afterProduct >= orderVoucher.minTotal
            ? orderVoucher.amountFor(orderEligibleSubtotal)
            : 0;
    final eligibleAfterVoucher =
        (orderEligibleSubtotal - orderDiscount).clamp(0, double.infinity);
    final customerDiscount = _customer?.perkAmount(eligibleAfterVoucher) ?? 0;
    final afterCustomer = (afterProduct - orderDiscount - customerDiscount)
        .clamp(0, double.infinity);
    final manualDiscount = _tab.manualDiscount;
    final total = afterCustomer.clamp(0, double.infinity);
    num allocated = 0;
    num vat = 0;
    if (subtotal > 0 && total > 0) {
      final pricedLines = _cart.where((line) => line.lineTotal > 0).toList();
      for (var index = 0; index < pricedLines.length; index++) {
        final line = pricedLines[index];
        final discountedGross = index == pricedLines.length - 1
            ? total - allocated
            : (line.lineTotal * total / subtotal).round();
        allocated += discountedGross;
        if (line.sku.vatRate > 0) {
          vat += discountedGross -
              (discountedGross / (1 + line.sku.vatRate / 100)).round();
        }
      }
    }
    return _RetailTotals(
      subtotal: subtotal,
      productDiscount: productDiscount,
      orderDiscount: orderDiscount,
      customerDiscount: customerDiscount,
      manualDiscount: manualDiscount,
      comboDiscount: comboDiscount,
      vat: vat,
      total: total,
      orderVoucher: orderVoucher,
    );
  }
}
