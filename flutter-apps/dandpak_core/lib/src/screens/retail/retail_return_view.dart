part of 'retail_screen.dart';

// TRẢ HÀNG — Return mode view (§1). Tách hẳn khỏi Sale cart view: extension riêng,
// KHÔNG rải if(isReturn) trong Sale. Dispatch bằng 1 switch ở call-site _cartPanel().
// Preload item bill gốc (ảnh/tên/SKU/giá snapshot/đã bán/đã trả/còn trả), +/- SL
// giới hạn 0..remaining, KHÓA thêm SKU (panel này không có ô search/thêm), nút
// "Trả hàng xxxđ" → hoàn theo tender + manager approval + in Phiếu trả. Bill gốc
// giữ nguyên (backend returns.js). setState -> rebuild().
extension _RetailReturnView on _RetailScreenState {
  List<Map<String, dynamic>> get _returnLines => _tab.returnLines;
  int get _returnTotal => _returnLines.fold(0,
      (s, l) => s + ((l['qty'] as int? ?? 0) * (l['unit_price'] as int? ?? 0)));

  Widget _returnCartPanel() {
    return Container(
      color: DanColors.surface,
      child: Column(
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(16, 14, 12, 10),
            child: Row(children: [
              Icon(Icons.assignment_return_outlined,
                  size: 18, color: DanColors.late),
              SizedBox(width: 8),
              Text(t('Trả hàng'),
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
              SizedBox(width: 8),
              Text('${t('Bill')} ${_tab.returnOfOrderId ?? ''}',
                  style: TextStyle(fontSize: 11.5, color: DanColors.faint),
                  overflow: TextOverflow.ellipsis),
            ]),
          ),
          Divider(height: 1, color: DanColors.border),
          Expanded(
            child: ListView.separated(
              padding: EdgeInsets.all(12),
              itemCount: _returnLines.length,
              separatorBuilder: (_, __) => SizedBox(height: 8),
              itemBuilder: (_, i) => _returnRow(_returnLines[i]),
            ),
          ),
          Divider(height: 1, color: DanColors.border),
          _returnCartFooter(),
        ],
      ),
    );
  }

  Widget _returnRow(Map<String, dynamic> l) {
    final sold = l['sold'] as int? ?? 0;
    final returned = l['returned'] as int? ?? 0;
    final remaining = sold - returned;
    final qty = l['qty'] as int? ?? 0;
    final img = '${l['image'] ?? ''}';
    final hasSku = '${l['sku_id'] ?? ''}'.isNotEmpty;
    return Container(
      padding: EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: img.isNotEmpty
                  ? Image.network(img,
                      width: 40,
                      height: 40,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => _imgPlaceholder())
                  : _imgPlaceholder(),
            ),
            SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${l['name'] ?? ''}',
                      style: TextStyle(
                          fontWeight: FontWeight.w800, fontSize: 13.5),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis),
                  SizedBox(height: 2),
                  Text(
                      '${l['code'] ?? l['sku_id'] ?? ''} · ${Fmt.money(l['unit_price'] as int? ?? 0)}',
                      style: TextStyle(fontSize: 11, color: DanColors.faint)),
                  Text(
                      '${t('Đã bán')} $sold · ${t('Đã trả')} $returned · ${t('Còn')} $remaining',
                      style: TextStyle(fontSize: 11, color: DanColors.faint)),
                ],
              ),
            ),
          ]),
          SizedBox(height: 8),
          Row(children: [
            _stepBtn(Icons.remove, () {
              if (qty > 0) rebuild(() => l['qty'] = qty - 1);
            }),
            Container(
                width: 40,
                alignment: Alignment.center,
                child: Text('$qty',
                    style:
                        TextStyle(fontWeight: FontWeight.w900, fontSize: 15))),
            _stepBtn(Icons.add, () {
              if (qty < remaining) rebuild(() => l['qty'] = qty + 1);
            }),
            Spacer(),
            if (hasSku)
              ToggleButtons(
                isSelected: [
                  l['disposition'] != 'damaged',
                  l['disposition'] == 'damaged'
                ],
                onPressed: (idx) => rebuild(
                    () => l['disposition'] = idx == 0 ? 'restock' : 'damaged'),
                borderRadius: BorderRadius.circular(8),
                constraints: BoxConstraints(minHeight: 30, minWidth: 68),
                children: [Text(t('Nhập kho')), Text(t('Hàng hỏng'))],
              ),
          ]),
        ],
      ),
    );
  }

  Widget _imgPlaceholder() => Container(
      width: 40,
      height: 40,
      color: DanColors.surface,
      child: Icon(Icons.image_outlined, size: 18, color: DanColors.faint));

  Widget _returnCartFooter() {
    return Padding(
      padding: EdgeInsets.all(16),
      child: Column(children: [
        Row(children: [
          Text('${t('Hoàn qua')}: ',
              style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
          DropdownButton<String>(
            value: _tab.payMethod.isEmpty ? 'original' : _tab.payMethod,
            onChanged: (v) => rebuild(() => _tab.payMethod = v ?? 'original'),
            items: [
              DropdownMenuItem(
                  value: 'original', child: Text(t('Theo phương thức gốc'))),
              DropdownMenuItem(value: 'cash', child: Text(t('Tiền mặt'))),
              DropdownMenuItem(value: 'bank', child: Text(t('Chuyển khoản'))),
              DropdownMenuItem(value: 'card', child: Text(t('Thẻ'))),
            ],
          ),
        ]),
        Divider(height: 18, color: DanColors.border),
        _totalRow(t('TIỀN HOÀN'), Fmt.money(_returnTotal), big: true),
        SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          height: 50,
          child: FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: DanColors.late),
            onPressed:
                (_returnTotal <= 0 || _salesLocked) ? null : _submitReturn,
            icon: Icon(Icons.assignment_return_outlined),
            label: Text('${t('Trả hàng')}  ${Fmt.money(_returnTotal)}',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
          ),
        ),
      ]),
    );
  }

  Future<void> _submitReturn() async {
    // ONLINE-ONLY: trả hàng ghi tiền/kho — chặn khi mất kết nối máy chủ.
    if (!ensureOnlineForMutation(context, action: t('Trả hàng'))) return;
    final orderId = _tab.returnOfOrderId;
    if (orderId == null) return;
    final items = _returnLines
        .where((l) => (l['qty'] as int? ?? 0) > 0)
        .map((l) => {
              'order_item_id': l['order_item_id'],
              'qty': l['qty'],
              'disposition': l['disposition'],
            })
        .toList();
    if (items.isEmpty) {
      appToast(context, t('Chọn ít nhất một món để trả'), isError: true);
      return;
    }
    final api = context.read<ApiService>();
    final method = _tab.payMethod.isEmpty ? 'original' : _tab.payMethod;
    Future<Map<String, dynamic>> doReturn(String? token) =>
        api.retailReturn(orderId, {
          'items': items,
          'reason': t('Trả hàng'),
          'refund_method': method,
          if (token != null && token.isNotEmpty) 'approval_token': token,
        });
    try {
      Map<String, dynamic> res;
      try {
        res = await doReturn(null);
      } catch (e) {
        final msg = e.toString();
        // Thiếu quyền refund → cần Quản lý/Admin duyệt (one-shot token).
        if (msg.contains('uỷ quyền') || msg.contains('Trả hàng, ho')) {
          if (!mounted) return;
          final pin = await requestManagerPin(
              context, t('Cần Quản lý/Admin duyệt trả hàng.'));
          if (pin == null || pin.isEmpty) return;
          final g = await api.grantApproval(
              action: 'return',
              targetId: orderId,
              requiredPerm: 'refund',
              pin: pin);
          res = await doReturn('${g['token'] ?? ''}');
        } else {
          rethrow;
        }
      }
      // In Phiếu trả hàng (không chặn UX nếu máy in lỗi).
      final rid = '${res['return_id'] ?? ''}';
      if (rid.isNotEmpty) {
        try {
          await api.printReturnVoucher(rid);
        } catch (_) {/* máy in lỗi — return vẫn thành công */}
      }
      if (!mounted) return;
      appToast(context, t('Đã trả hàng — bill gốc vẫn được giữ.'));
      _closeReturnTab();
    } catch (e) {
      if (mounted) {
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    }
  }

  void _closeReturnTab() {
    final tab = _tab;
    rebuild(() {
      final idx = _tabs.indexOf(tab);
      if (_tabs.length == 1) {
        // Tab cuối: thay bằng tab bán mới trống.
        _nextTabId++;
        _tabs[0] = RetailSaleTab(id: _nextTabId);
        _activeTabId = _nextTabId;
      } else {
        _tabs.remove(tab);
        _activeTabId = _tabs[(idx - 1).clamp(0, _tabs.length - 1)].id;
      }
    });
    _reloadLight();
  }
}
