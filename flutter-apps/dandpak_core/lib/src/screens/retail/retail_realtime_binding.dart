part of 'retail_screen.dart';

// §SPLIT realtime/presence binding + customer display + local cart persist +
// remote cart apply. Tách behavior-preserving khỏi _RetailScreenState.
extension _RetailRealtimeBinding on _RetailScreenState {
  void _pushCustomerDisplay() {
    if (!mounted) return;
    try {
      final totals = _totals();
      context.read<CustomerDisplayController>().showRetailCart(
        items: [
          for (final c in _cart)
            CustomerLine(
              name: c.sku.name,
              options: _lineOptions(c),
              promoText: _lineAppliedPromoText(c),
              qty: c.qty,
              unitPrice: c.sku.price,
              lineTotal: c.lineTotal,
            ),
        ],
        subtotal: totals.subtotal,
        discount: totals.productDiscount +
            totals.comboDiscount +
            totals.orderDiscount +
            totals.customerDiscount +
            totals.manualDiscount,
        tax: totals.vat,
        // `total` là trước giảm tay → trừ giảm tay để màn khách hiện số cuối.
        total: (totals.total - totals.manualDiscount).clamp(0, double.infinity),
        discountLabel: t('Khuyến mãi / giảm giá'),
      );
    } catch (_) {}
    // Mọi thay đổi giỏ (thêm/sửa/xóa món, khách, voucher, giảm giá) đều đi qua đây
    // → đẩy giỏ lên server để máy khác thấy. Bỏ qua khi đang ÁP snapshot máy khác.
    if (!_applyingRemoteCart) _syncCart();
    _refreshPreview();
  }

  // Chữ ký giỏ để biết kết quả preview server còn khớp giỏ hiện tại không.
  String _cartSignature(RetailSaleTab tab) =>
      '${tab.cart.map((c) => '${c.sku.id}:${c.qty}:${c.lotId ?? ''}:${c.voucherId ?? ''}:${c.comboId ?? ''}:${c.priceOverride ?? ''}:${c.note ?? ''}').join('|')}'
      '#${tab.orderVoucherId ?? ''}#${tab.customer?.id ?? ''}#${tab.manualDiscount}';

  // Gọi engine server tính giảm giá (gồm combo) — debounce, chống kết quả cũ.
  void _refreshPreview() {
    final tab = _tab;
    final sig = _cartSignature(tab);
    if (tab.cart.isEmpty) {
      if (_preview != null)
        rebuild(() {
          _preview = null;
          _previewSig = sig;
        });
      return;
    }
    _previewDebouncer(() async {
      if (!mounted) return;
      try {
        final res = await context.read<ApiService>().retailDiscountPreview({
          'items': [
            for (final c in tab.cart)
              {
                'sku_id': c.sku.id,
                'qty': c.qty,
                'lot_id': c.lotId,
                'voucher_id': c.voucherId,
                if (c.priceOverride != null)
                  'price_override': c.priceOverride!.round(),
                if (c.note != null) 'note': c.note,
              }
          ],
          'order_voucher_id': tab.orderVoucherId,
          'customer': tab.customer?.toCheckoutCustomer(),
          // Combo Option B: chỉ áp combo ĐÃ chọn (rỗng = không áp) → tắt auto.
          'selected_combos': _selectedComboIds(),
          // Giảm tay áp RIÊNG lúc checkout (giữ hành vi cũ) → preview không gồm.
        });
        if (!mounted) return;
        // Chỉ nhận nếu giỏ CHƯA đổi kể từ lúc gọi.
        if (_cartSignature(_tab) != sig) return;
        rebuild(() {
          _preview = res;
          _previewSig = sig;
        });
      } catch (_) {
        // Lỗi mạng → giữ tính client (fallback), không chặn bán.
      }
    });
  }

  // Snapshot giỏ ĐANG mở — đủ để máy khác dựng lại dòng hàng mà không cần SKU đã tải.
  Map<String, dynamic> _cartSnapshot(RetailSaleTab tab) => {
        'lines': [
          for (final c in tab.cart)
            {
              'sku': c.sku.toJson(),
              'qty': c.qty,
              'lot_id': c.lotId,
              'voucher_id': c.voucherId,
              if (c.isCombo) 'combo_id': c.comboId,
              if (c.isCombo) 'combo_name': c.comboName,
              if (c.isCombo) 'combo_per': c.comboPer,
              if (c.priceOverride != null)
                'price_override': c.priceOverride!.round(),
              if (c.note != null) 'note': c.note,
            }
        ],
        'customer': tab.customer?.toCheckoutCustomer(),
        'order_voucher_id': tab.orderVoucherId,
        'manual_discount': tab.manualDiscount.round(),
        'note': tab.note,
        // GIỮ LẠI nguồn gốc và tên máy khi thu ngân sửa giỏ của khách. Bỏ đi là
        // tab đang mang tên "Kệ hạt điều" tự nhảy về "Hóa đơn 03" ngay khi nhân
        // viên bấm thêm một món — mất luôn manh mối khách đang đứng ở đâu.
        'origin': tab.origin,
        'device_name': tab.deviceName,
        // Thu ngân đã đụng vào giỏ = đã tiếp nhận → gỡ cờ đỏ đòi thanh toán.
        'pay_requested': false,
        'pay_method': tab.payMethod,
      };

  // Đẩy snapshot tab đang mở lên server (debounce) → server phát 'retail:cart'.
  void _syncCart() {
    final tab = _tab;
    final slot = tab.id;
    // Ghi xuống đĩa TRƯỚC khi chạm mạng: mất Wi-Fi/app crash vẫn mở lại đúng
    // giỏ, sau khi online snapshot sẽ được gửi lại lên server bằng cùng slot.
    unawaited(_persistLocalCarts());
    _cartSyncDebouncer(() {
      if (!mounted) return;
      unawaited(_saveCartRemote(tab, slot));
    });
  }

  Future<void> _saveCartRemote(RetailSaleTab tab, int slot) async {
    try {
      final saved = await context.read<ApiService>().saveRetailCart(
          slot, _cartSnapshot(tab),
          device: _cartClientId, expectedVersion: tab.version);
      if (!mounted) return;
      tab.version = (saved['version'] as num?)?.toInt() ?? tab.version;
      _applyPresence(saved);
    } catch (_) {
      // Snapshot cũ không được ghi đè. Nạp lại bản server để người dùng nhìn
      // thấy thay đổi của thiết bị kia trước khi tiếp tục.
      try {
        final rows = await context.read<ApiService>().getRetailCarts();
        for (final row in rows) {
          if (row is Map && (row['slot'] as num?)?.toInt() == slot) {
            _applyRemoteCart(Map<String, dynamic>.from(row));
            break;
          }
        }
      } catch (_) {}
    }
  }

  void _heartbeatPresence() {
    if (!mounted) return;
    unawaited(_touchPresence());
  }

  Future<void> _touchPresence() async {
    try {
      final result = await context
          .read<ApiService>()
          .touchRetailCartPresence(_activeTabId, device: _cartClientId);
      _applyPresence(result);
    } catch (_) {}
  }

  void _leavePresence(int slot) {
    if (!mounted) return;
    context
        .read<ApiService>()
        .leaveRetailCartPresence(slot, device: _cartClientId)
        .catchError((_) {});
  }

  void _applyPresence(dynamic payload) {
    if (!mounted || payload is! Map) return;
    final slot = (payload['slot'] as num?)?.toInt() ?? 0;
    final devices = (payload['active_devices'] as List? ?? const [])
        .whereType<Map>()
        .map((d) => '${d['device'] ?? ''}')
        .where((d) => d.isNotEmpty)
        .toList();
    RetailSaleTab? tab;
    for (final candidate in _tabs) {
      if (candidate.id == slot) {
        tab = candidate;
        break;
      }
    }
    if (tab != null) rebuild(() => tab!.activeDevices = devices);
  }

  String _localCartKey() {
    final branch = context.read<AuthProvider>().selectedBranchId;
    return 'retail_offline_carts_v1_$branch';
  }

  Future<void> _persistLocalCarts() async {
    if (!mounted) return;
    final rows = [
      for (final tab in _tabs)
        if (tab.cart.isNotEmpty ||
            tab.customer != null ||
            tab.orderVoucherId != null)
          {'slot': tab.id, 'device': _cartClientId, ..._cartSnapshot(tab)},
    ];
    if (rows.isEmpty) {
      await LocalStore.instance.remove(_localCartKey());
    } else {
      await LocalStore.instance.setString(_localCartKey(), jsonEncode(rows));
    }
  }

  Future<void> _restoreLocalCarts() async {
    if (_localCartsRestored || !mounted) return;
    _localCartsRestored = true;
    final raw = await LocalStore.instance.getString(_localCartKey());
    if (raw == null || raw.isEmpty || !mounted) return;
    try {
      final rows = jsonDecode(raw);
      if (rows is! List) return;
      for (final row in rows) {
        if (row is Map) {
          final payload = Map<String, dynamic>.from(row)
            ..['device'] = 'offline-cache';
          _applyRemoteCart(payload);
        }
      }
    } catch (_) {
      // Cache hỏng không được chặn mở quầy; server vẫn là nguồn phục hồi kế tiếp.
    }
  }

  // Áp snapshot giỏ do MÁY KHÁC gửi tới (tự bỏ qua event của chính mình).
  void _applyRemoteCart(dynamic payload) {
    if (payload is! Map) return;
    if ((payload['device'] ?? '').toString() == _cartClientId) return;
    final slot = (payload['slot'] as num?)?.toInt() ?? 0;
    if (slot < 1) return;
    // Slot đang mở CheckoutDialog: KHÓA sync xa. Thu ngân đang thanh toán chính
    // slot này; để event 'cleared'/thay giỏ từ máy khác hay snapshot cũ ghi đè
    // vào đây sẽ xoá mất giỏ đang bán giữa chừng (mất đơn). Máy này sẽ tự đẩy
    // trạng thái đúng sau khi chốt bill.
    if (_checkoutSlot == slot) return;
    _applyingRemoteCart = true;
    try {
      RetailSaleTab? tab;
      for (final tb in _tabs) {
        if (tb.id == slot) {
          tab = tb;
          break;
        }
      }
      final cleared = payload['cleared'] == true;
      if (cleared) {
        if (tab == null) return;
        final target = tab;
        rebuild(() {
          target.cart.clear();
          target.customer = null;
          target.orderVoucherId = null;
          target.manualDiscount = 0;
          target.note = '';
          // Giỏ đã giải phóng thì ô này trở lại là ô trống của quầy — không giữ
          // tên máy catalogue cũ, nếu không tab trống vẫn mang tên một cái máy.
          target.origin = 'staff';
          target.deviceName = '';
          target.payRequested = false;
          target.payMethod = '';
        });
      } else {
        if (tab == null) {
          tab = RetailSaleTab(id: slot);
          _tabs.add(tab);
          if (slot > _nextTabId) _nextTabId = slot;
        }
        final target = tab;
        final lines = <CartLine>[];
        for (final raw in (payload['lines'] as List? ?? const [])) {
          if (raw is! Map) continue;
          final skuMap = raw['sku'];
          if (skuMap is! Map) continue;
          final sku = Sku.fromJson(Map<String, dynamic>.from(skuMap));
          final lot = raw['lot_id']?.toString();
          final vou = raw['voucher_id']?.toString();
          final cid = raw['combo_id']?.toString();
          lines.add(CartLine(
            sku,
            (raw['qty'] as num?)?.toInt() ?? 1,
            lotId: (lot == null || lot.isEmpty) ? null : lot,
            voucherId: (vou == null || vou.isEmpty) ? null : vou,
            comboId: (cid == null || cid.isEmpty) ? null : cid,
            comboName: raw['combo_name']?.toString(),
            comboPer: (raw['combo_per'] as num?)?.toInt() ?? 0,
            priceOverride: (raw['price_override'] as num?),
            note: raw['note']?.toString(),
          ));
        }
        final custMap = payload['customer'];
        final ovId = payload['order_voucher_id']?.toString();
        rebuild(() {
          target.cart
            ..clear()
            ..addAll(lines);
          target.customer = custMap is Map
              ? RetailCustomer.fromJson(Map<String, dynamic>.from(custMap))
              : null;
          target.orderVoucherId = (ovId == null || ovId.isEmpty) ? null : ovId;
          target.manualDiscount =
              (payload['manual_discount'] as num?)?.toDouble() ?? 0;
          target.note = '${payload['note'] ?? ''}';
          // Giỏ do KHÁCH tự chọn trên máy catalogue ngoài quầy: tab đổi nhãn
          // sang TÊN MÁY và tô đỏ khi khách đã bấm thanh toán, để thu ngân biết
          // ngay phải chạy tới đâu. Giỏ nhân viên giữ nguyên hành vi cũ.
          target.origin = '${payload['origin'] ?? 'staff'}';
          target.deviceName = '${payload['device_name'] ?? ''}';
          target.payRequested = payload['pay_requested'] == true;
          target.payMethod = '${payload['pay_method'] ?? ''}';
          target.version =
              (payload['version'] as num?)?.toInt() ?? target.version;
          target.activeDevices =
              (payload['active_devices'] as List? ?? const [])
                  .whereType<Map>()
                  .map((d) => '${d['device'] ?? ''}')
                  .where((d) => d.isNotEmpty)
                  .toList();
        });
      }
      if (slot == _activeTabId) _pushCustomerDisplay();
    } finally {
      _applyingRemoteCart = false;
      unawaited(_persistLocalCarts());
    }
  }
}
