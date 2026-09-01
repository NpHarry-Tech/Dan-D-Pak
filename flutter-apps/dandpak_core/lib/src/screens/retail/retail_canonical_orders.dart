part of 'retail_screen.dart';

// §2 CANONICAL ORDERS wiring (gated). Tách khỏi _RetailScreenState nhưng dùng
// chung state (part). KHÔNG chạy gì khi _canonicalEnabled=false → đường bán lẻ
// hiện tại (giỏ-chia-sẻ) giữ nguyên hành vi Production.
//
// Khi bật: mỗi tab = 1 canonical order. Mutation đi qua session.applyCommand
// (structural), server (priceCart) định giá lại, client CHỈ render snapshot.
// Xung đột/lease/paid xử lý trong RetailOrderSession; ở đây chỉ nối vòng đời +
// chiếu canonical vào RetailSaleTab để UI hiện tại render được.
extension _RetailCanonicalOrders on _RetailScreenState {
  /// Projection render của tab đang mở (null nếu tab không chạy canonical).
  CanonicalRender? get _canonicalRender {
    final s = _activeSession;
    return s == null ? null : renderCanonical(s.snapshot);
  }

  /// Tab đang mở có đang read-only theo server không (lease mất / đã thanh toán).
  bool get _canonicalReadOnly => _activeSession?.readOnly ?? false;

  void _onCanonicalChanged() {
    if (!mounted) return;
    final s = _activeSession;
    if (s != null) _projectCanonicalToTab(_activeTabId, s);
    rebuild(() {});
  }

  /// Chiếu state canonical vào RetailSaleTab (nhãn dùng display_sequence server,
  /// cờ read-only, revision) để UI hiện tại nhận biết mà không cần model biết
  /// tới tầng service.
  void _projectCanonicalToTab(int tabId, RetailOrderSession s) {
    final idx = _tabs.indexWhere((t) => t.id == tabId);
    if (idx < 0) return;
    final t = _tabs[idx];
    t.orderId = s.orderId;
    t.serverSequence = s.displaySequence;
    t.canonicalRevision = s.revision;
    t.leaseToken = s.leaseToken;
    t.orderStatus = s.status;
    t.serverReadOnly = s.readOnly;
  }

  /// Bảo đảm tab đang mở có canonical session. Idempotent, an toàn gọi nhiều lần.
  Future<void> _ensureCanonicalSession() async {
    if (!_canonicalEnabled) return;
    if (_sessions.containsKey(_activeTabId)) return;
    final tabId = _activeTabId;
    try {
      final api = context.read<ApiService>();
      final auth = context.read<AuthProvider>();
      final s = await RetailOrderSession.create(api,
          device: _cartClientId,
          registerId: auth.selectedBranchId,
          sessionId: _cartClientId);
      if (!mounted) return;
      _sessions[tabId] = s;
      s.addListener(_onCanonicalChanged);
      _projectCanonicalToTab(tabId, s);
      rebuild(() {});
    } catch (e) {
      // Không mở được canonical KHÔNG được làm hỏng thao tác bán: báo nhẹ, giữ
      // tab ở đường legacy (session vắng mặt → mọi guard trả false).
      _toast(t('Chưa mở được hóa đơn đồng bộ, đang dùng chế độ cũ'),
          error: true);
    }
  }

  /// Guard mutation canonical. true = đã xử lý qua server (caller DỪNG, không chạy
  /// nhánh legacy). false = tab không chạy canonical → caller chạy legacy như cũ.
  Future<bool> _canonicalMutate(
      String command, Map<String, dynamic> payload) async {
    final s = _activeSession;
    if (s == null) return false;
    if (s.readOnly) {
      _toast(s.blockReason ?? t('Hóa đơn đang khóa chỉnh sửa'), error: true);
      return true; // đã "xử lý": chặn, không cho nhánh legacy sửa local
    }
    try {
      await s.applyCommand(command, payload);
    } on ApiException catch (e) {
      _toast(e.message, error: true);
    }
    return true;
  }

  /// Nhịp tim lease cho session đang mở (gọi trong _presenceTimer khi bật gate).
  void _canonicalHeartbeat() {
    if (!_canonicalEnabled) return;
    _activeSession?.heartbeat();
  }

  /// Read-only DO LEASE (không phải đã thanh toán) → cho phép tiếp quản quyền sửa.
  bool get _canTakeover {
    final s = _activeSession;
    return s != null && s.readOnly && s.status != 'paid' && s.status != 'void';
  }

  Future<void> _canonicalTakeover() async {
    final s = _activeSession;
    if (s == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t('Tiếp quản quyền sửa?')),
        content: Text(t(
            'Hóa đơn đang được mở/sửa ở thiết bị khác. Tiếp quản sẽ thu quyền sửa về máy này; thiết bị kia chuyển sang chỉ xem. Tiếp tục?')),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: Text(t('Hủy'))),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: Text(t('Tiếp quản'))),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final took = await s.takeover();
    if (!mounted) return;
    _toast(
        took
            ? t('Đã tiếp quản quyền sửa hóa đơn')
            : (s.blockReason ?? t('Không tiếp quản được quyền sửa')),
        error: !took);
  }

  /// Chuyển tiếp event realtime của branch tới các session để reconcile canonical
  /// (order.paid → read-only + đóng; lease.revoked; order.changed → reload).
  void _canonicalOnSocket(String event, Map payload) {
    if (_sessions.isEmpty) return;
    for (final entry in _sessions.entries) {
      entry.value.onServerEvent(event, payload);
    }
  }

  /// Nhả toàn bộ lease khi rời màn (dispose) — không chặn dispose nếu lỗi.
  void _releaseAllSessions() {
    for (final s in _sessions.values) {
      s.removeListener(_onCanonicalChanged);
      s.release();
    }
  }

  // ── WRITE helpers (đi qua hợp đồng command; server định giá lại) ────────────
  Future<void> _canonicalAdd(Sku sku) async {
    if (_salesLocked) {
      _toast(t('Cần mở ca làm việc trước khi bán hàng.'), error: true);
      _openShiftDialog();
      return;
    }
    await _canonicalMutate('ADD_LINE',
        addLinePayload(skuId: sku.id, qty: 1, lotId: _defaultLot(sku)?.id));
  }

  Future<void> _canonicalChangeQty(CanonicalLine line, int delta) async {
    final id = line.lineId;
    if (id == null) return;
    await _canonicalMutate(
        'CHANGE_QTY', changeQtyPayload(lineId: id, qty: line.qty + delta));
  }

  Future<void> _canonicalRemove(CanonicalLine line) async {
    final id = line.lineId;
    if (id == null) return;
    await _canonicalMutate('REMOVE_LINE', removeLinePayload(lineId: id));
  }

  Future<void> _canonicalPickCustomer() async {
    final picked = await showDialog<Object?>(
      context: context,
      builder: (_) => CustomerPickerDialog(
          api: context.read<ApiService>(),
          customers: _customers,
          selected: _customer),
    );
    if (picked == null || !mounted) return; // null = hủy, không đổi
    final cust =
        picked is RetailCustomer ? picked : null; // non-customer = về khách lẻ
    await _canonicalMutate('SET_CUSTOMER',
        setCustomerPayload(customer: cust?.toCheckoutCustomer()));
    await _reloadCustomers();
  }

  Future<void> _canonicalPickVoucher() async {
    final r = _canonicalRender;
    final rows = _usableVouchers
        .where((v) => v.isOrder && v.code.trim().isNotEmpty)
        .toList();
    final selected = await showDialog<String?>(
      context: context,
      builder: (_) => _ExternalVoucherDialog(
          vouchers: rows, selected: null, billTotal: r?.subtotal ?? 0),
    );
    if (selected == null || !mounted) return; // null = hủy
    if (selected.isEmpty) {
      await _canonicalMutate('REMOVE_PROMOTION', removePromotionPayload());
    } else {
      await _canonicalMutate(
          'APPLY_PROMOTION', applyPromotionPayload(voucherId: selected));
    }
  }

  Future<void> _canonicalManualDiscount() async {
    final r = _canonicalRender;
    final base = r?.subtotal ?? 0;
    final result = await showDialog<num>(
      context: context,
      builder: (_) => ManualDiscountDialog(baseTotal: base, current: 0),
    );
    if (result == null || !mounted) return;
    await _canonicalMutate('SET_MANUAL_DISCOUNT',
        setManualDiscountPayload(amount: result.clamp(0, double.infinity)));
  }

  Future<void> _canonicalNote() async {
    final value = await editOrderNote(context, _tab.note);
    if (value == null || !mounted) return;
    await _canonicalMutate('SET_NOTE', setNotePayload(note: value));
  }

  // ── CHECKOUT canonical: server acquire lock + markDraftPaid (một finalizer) ──
  // Dựng CartLine từ snapshot server để CheckoutDialog hiển thị; server ĐỊNH GIÁ
  // LẠI (Retail.checkout) nên số tiền vẫn server-authoritative. Gửi kèm order_id
  // (mdOrderId) + device để checkout lock + PAID terminal + phát order.paid.
  Sku _skuForCanonical(CanonicalLine line) {
    for (final s in _skus) {
      if (s.id == line.skuId) return s;
    }
    // SKU không nằm trong trang đã tải (máy khác thêm) → dựng tối thiểu để hiển
    // thị; server vẫn phân giải giá/tồn thật khi checkout.
    return Sku(
      id: line.skuId,
      barcode: '',
      name: line.name,
      emoji: '',
      image: '',
      price: line.unitPrice,
      vatRate: 0,
      stock: 0,
      unit: line.unit,
      category: '',
      warehouseId: '',
      trackLot: false,
      expiryRequired: false,
    );
  }

  List<CartLine> _cartLinesFromCanonical(CanonicalRender r) => [
        for (final line in r.lines)
          CartLine(_skuForCanonical(line), line.qty,
              lotId: line.lotId, priceOverride: line.priceOverride),
      ];

  Future<void> _canonicalCheckout() async {
    final s = _activeSession;
    final r = _canonicalRender;
    if (s == null || r == null || r.isEmpty) return;
    if (_salesLocked) {
      _toast(t('Cần mở ca làm việc trước khi bán hàng.'), error: true);
      _openShiftDialog();
      return;
    }
    // Breakdown hiển thị: giữ subtotal - Σgiảm = total (server tính lại số thật).
    final other = (r.discount - r.lineDiscount - r.orderDiscount)
        .clamp(0, double.infinity);
    final receipt = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => CheckoutDialog(
        api: context.read<ApiService>(),
        cart: _cartLinesFromCanonical(r),
        operationsConfig: _operationsConfig,
        invoiceLabel: s.label,
        customer: _customer,
        voucher: null,
        subtotal: r.subtotal,
        productDiscount: r.lineDiscount,
        orderDiscount: r.orderDiscount,
        customerDiscount: other,
        manualDiscount: 0,
        total: r.total,
        itemCount: r.itemCount,
        channelLabel: 'Retail',
        initialNote: _tab.note,
        mdOrderId: s.orderId,
        mdDeviceId: _cartClientId,
      ),
    );
    if (!mounted) return;
    if (receipt != null) {
      // Đã PAID: session sẽ read-only (order.paid qua socket). Đóng tab canonical
      // đã thanh toán + mở tab mới cho lượt kế (server cấp order_id/seq mới).
      await _closeCanonicalTabAfterPaid();
    }
  }

  Future<void> _closeCanonicalTabAfterPaid() async {
    final paidTabId = _activeTabId;
    final s = _sessions.remove(paidTabId);
    if (s != null) {
      s.removeListener(_onCanonicalChanged);
      // Không cần release (đã paid = terminal); dọn listener là đủ.
    }
    if (_tabs.length > 1) {
      rebuild(() {
        _tabs.removeWhere((t) => t.id == paidTabId);
        if (!_tabs.any((t) => t.id == _activeTabId))
          _activeTabId = _tabs.first.id;
      });
      await _ensureCanonicalSession();
    } else {
      // Tab cuối: thay bằng canonical order mới để tiếp tục bán.
      rebuild(() => _tabs[0] = RetailSaleTab(id: _tabs[0].id));
      await _ensureCanonicalSession();
    }
    _pushCustomerDisplay();
  }

  // ── RENDER: panel giỏ canonical (thay _cartPanel khi có session) ────────────
  Widget _canonicalCartPanel() {
    final r = _canonicalRender ??
        const CanonicalRender(
            lines: [],
            subtotal: 0,
            discount: 0,
            lineDiscount: 0,
            orderDiscount: 0,
            total: 0);
    final s = _activeSession;
    final ro = _canonicalReadOnly;
    return Container(
      color: DanColors.surface,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 12, 10),
            child: Row(
              children: [
                const Icon(Icons.shopping_cart_outlined,
                    size: 18, color: DanColors.muted),
                const SizedBox(width: 8),
                Text(s?.label ?? t('Giỏ hàng'),
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w900)),
                const SizedBox(width: 8),
                Text('${r.itemCount} ${t('mặt hàng')}',
                    style:
                        const TextStyle(fontSize: 12, color: DanColors.faint)),
                if (ro) ...[
                  const SizedBox(width: 8),
                  Icon(Icons.lock_outline, size: 15, color: DanColors.late),
                ],
                const Spacer(),
                if (_canTakeover)
                  TextButton.icon(
                    onPressed: _canonicalTakeover,
                    icon: const Icon(Icons.lock_open, size: 16),
                    label: Text(t('Tiếp quản')),
                  ),
              ],
            ),
          ),
          const Divider(height: 1, color: DanColors.border),
          Expanded(
            child: r.isEmpty
                ? _EmptyCart()
                : ListView.separated(
                    padding: const EdgeInsets.all(12),
                    itemCount: r.lines.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) => _canonicalRow(r.lines[i], ro),
                  ),
          ),
          const Divider(height: 1, color: DanColors.border),
          _canonicalFooter(r, ro),
        ],
      ),
    );
  }

  Widget _canonicalRow(CanonicalLine line, bool ro) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(line.name,
                    style: const TextStyle(
                        fontWeight: FontWeight.w800, fontSize: 13.5)),
              ),
              Text(Fmt.money(line.lineTotal),
                  style: const TextStyle(fontWeight: FontWeight.w800)),
            ],
          ),
          if (line.hasPromo && line.promoLabel.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(line.promoLabel,
                  style:
                      const TextStyle(fontSize: 11.5, color: DanColors.doing)),
            ),
          const SizedBox(height: 8),
          Row(
            children: [
              Text('${Fmt.money(line.unitPrice)} × ${line.qty}',
                  style: const TextStyle(fontSize: 12, color: DanColors.muted)),
              const Spacer(),
              _stepBtn(Icons.remove,
                  ro ? () {} : () => _canonicalChangeQty(line, -1)),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text('${line.qty}',
                    style: const TextStyle(
                        fontWeight: FontWeight.w800, fontSize: 15)),
              ),
              _stepBtn(
                  Icons.add, ro ? () {} : () => _canonicalChangeQty(line, 1)),
              const SizedBox(width: 4),
              IconButton(
                icon: const Icon(Icons.close, size: 18, color: DanColors.late),
                onPressed: ro ? null : () => _canonicalRemove(line),
                tooltip: t('Xóa dòng'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _canonicalFooter(CanonicalRender r, bool ro) {
    final net = r.total;
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          _clickRow(
            t('Khách hàng'),
            _customer?.title.isNotEmpty == true
                ? _customer!.title
                : t('Bán cho người tiêu dùng'),
            ro ? () {} : _canonicalPickCustomer,
          ),
          _clickRow('Voucher', t('Thêm'), ro ? () {} : _canonicalPickVoucher),
          _clickRow(
              t('Giảm giá'), t('Thêm'), ro ? () {} : _canonicalManualDiscount),
          _clickRow('${t('Ghi chú')}:', _tab.note, ro ? () {} : _canonicalNote,
              accent: _tab.note.isNotEmpty),
          const SizedBox(height: 6),
          _totalRow(t('Tạm tính'), Fmt.money(r.subtotal)),
          if (r.discount > 0)
            _totalRow(t('Giảm giá'), '-${Fmt.money(r.discount)}',
                accent: DanColors.done),
          Divider(height: 18, color: DanColors.border),
          _totalRow(t('TỔNG CỘNG'), Fmt.money(net), big: true),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: FilledButton.icon(
              onPressed:
                  (r.isEmpty || _salesLocked || ro) ? null : _canonicalCheckout,
              icon: const Icon(Icons.payments_outlined),
              label: Text('${t('Thanh toán')}  ${Fmt.money(net)}',
                  style: const TextStyle(
                      fontSize: 15, fontWeight: FontWeight.w900)),
            ),
          ),
        ],
      ),
    );
  }
}
