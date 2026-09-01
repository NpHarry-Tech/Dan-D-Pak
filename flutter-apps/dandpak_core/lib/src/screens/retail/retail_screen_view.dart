part of 'retail_screen.dart';

// §SPLIT view builders (tabBar/shiftWarning/productArea/comboBar/empty/rows)
// tách behavior-preserving khỏi _RetailScreenState. KHÔNG đổi logic.
extension _RetailScreenView on _RetailScreenState {
  Widget _tabBar() {
    return Container(
      height: 60,
      padding: EdgeInsets.symmetric(horizontal: 14, vertical: 9),
      color: DanColors.surface2,
      child: Row(
        children: [
          Expanded(
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _tabs.length,
              separatorBuilder: (_, __) => SizedBox(width: 8),
              itemBuilder: (_, i) {
                final tab = _tabs[i];
                final active = tab.id == _activeTabId;
                return InkWell(
                  onTap: () => _openSharedTab(tab),
                  borderRadius: BorderRadius.circular(DanRadius.sm),
                  child: Container(
                    padding: EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(
                      // ĐỎ = khách ở máy catalogue đã bấm thanh toán và đang
                      // đứng chờ. Đây là tín hiệu DUY NHẤT — không chuông, không
                      // popup: cửa hàng có nhân viên đứng quầy, thêm tiếng ồn
                      // giữa ca đông khách chỉ gây rối.
                      color: tab.payRequested
                          ? DanColors.late
                          : (active ? DanColors.brand : DanColors.surface),
                      borderRadius: BorderRadius.circular(DanRadius.sm),
                      border: Border.all(
                          color: tab.payRequested
                              ? DanColors.late
                              : (active ? DanColors.brand : DanColors.border2),
                          width: tab.payRequested ? 2 : 1),
                    ),
                    child: Row(
                      children: [
                        Icon(
                            tab.fromCatalogue
                                ? Icons.tablet_android_outlined
                                : Icons.receipt_long_outlined,
                            size: 15,
                            color: (active || tab.payRequested)
                                ? Colors.white
                                : DanColors.muted),
                        SizedBox(width: 7),
                        Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(tab.title,
                                style: TextStyle(
                                    color: (active || tab.payRequested)
                                        ? Colors.white
                                        : DanColors.text,
                                    fontWeight: FontWeight.w900,
                                    fontSize: 12.5)),
                            // Tên khách hiện NHỎ dưới tên máy, chỉ khi khách đã
                            // tự nhập thông tin. Chưa nhập thì mặc định vẫn là
                            // bán cho người tiêu dùng — không bịa tên vào đây.
                            if (tab.subtitle.isNotEmpty)
                              Text(tab.subtitle,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                      color: (active || tab.payRequested)
                                          ? Colors.white70
                                          : DanColors.muted,
                                      fontWeight: FontWeight.w600,
                                      fontSize: 10)),
                          ],
                        ),
                        if (tab.cart.isNotEmpty) ...[
                          SizedBox(width: 6),
                          _CountDot(
                              '${tab.cart.length}', active || tab.payRequested),
                        ],
                        if (tab.activeDevices
                            .any((device) => device != _cartClientId)) ...[
                          SizedBox(width: 5),
                          Tooltip(
                            message: t('Có thiết bị khác đang mở giỏ này'),
                            child: Container(
                              width: 9,
                              height: 9,
                              decoration: BoxDecoration(
                                color: DanColors.late,
                                shape: BoxShape.circle,
                                boxShadow: [
                                  BoxShadow(
                                      color:
                                          DanColors.late.withValues(alpha: .55),
                                      blurRadius: 6,
                                      spreadRadius: 2),
                                ],
                              ),
                            ),
                          ),
                        ],
                        SizedBox(width: 5),
                        InkWell(
                          onTap: () => _closeTab(tab),
                          borderRadius: BorderRadius.circular(99),
                          child: Icon(Icons.close,
                              size: 15,
                              color: (active || tab.payRequested)
                                  ? Colors.white70
                                  : DanColors.faint),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          SizedBox(width: 8),
          IconButton.outlined(
            onPressed: _addTab,
            icon: Icon(Icons.add),
            tooltip: t('Thêm hóa đơn'),
          ),
        ],
      ),
    );
  }

  Widget _shiftWarning() {
    return Material(
      color: DanColors.late.withValues(alpha: .08),
      child: InkWell(
        onTap: _openShiftDialog,
        child: Container(
          width: double.infinity,
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 9),
          child: Row(
            children: [
              Icon(Icons.lock_clock_outlined, color: DanColors.late, size: 18),
              SizedBox(width: 8),
              Text(t('Cần mở ca làm việc trước khi bán retail.'),
                  style: TextStyle(
                      color: DanColors.late, fontWeight: FontWeight.w800)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _productArea() {
    final list = _filteredSkus;
    final serverUrl = context.read<AuthProvider>().serverUrl;
    final narrow = MediaQuery.sizeOf(context).width < 560;
    return Column(
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(14, 12, 14, 10),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _searchCtrl,
                  focusNode: _barcodeFocus,
                  decoration: InputDecoration(
                    hintText:
                        t('Tìm sản phẩm hoặc quét/nhập mã vạch rồi Enter...'),
                    // Tablet/điện thoại: bấm để mở camera quét; desktop: chỉ là
                    // icon gợi ý (máy quét USB gõ thẳng vào ô).
                    prefixIcon: ScanIconButton(
                      title: t('Quét sản phẩm'),
                      onCode: (code) {
                        _searchCtrl.text = code;
                        _submitSearch(code);
                      },
                    ),
                    isDense: true,
                  ),
                  onChanged: (v) {
                    rebuild(() => _search = v);
                    _skuDebouncer(() {
                      _loadSkusNextPage(isRefresh: true);
                    });
                  },
                  onSubmitted: _submitSearch,
                ),
              ),
              SizedBox(width: 8),
              narrow
                  ? IconButton.filled(
                      onPressed: () => _submitSearch(_searchCtrl.text),
                      icon: Icon(Icons.add, size: 18),
                      tooltip: t('Thêm'),
                    )
                  : FilledButton.icon(
                      onPressed: () => _submitSearch(_searchCtrl.text),
                      icon: Icon(Icons.add, size: 18),
                      label: Text(t('Thêm')),
                    ),
              SizedBox(width: 8),
              _FilterButton(
                active:
                    _inStockOnly || _sortBy.isNotEmpty || _category.isNotEmpty,
                onPressed: _openFilterSheet,
              ),
            ],
          ),
        ),
        Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, 7),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text(
                '${list.length} ${t('SP')} (${t('hiện')} ${_skus.length})',
                style: TextStyle(fontSize: 11.5, color: DanColors.muted)),
          ),
        ),
        if (_comboVouchers.isNotEmpty) _comboBar(),
        Expanded(
          child: _loading && _skus.isEmpty
              ? AppLoadingView(message: t('Đang tải sản phẩm…'))
              : _error != null && _skus.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.wifi_off_rounded,
                              size: 40, color: DanColors.late),
                          SizedBox(height: 10),
                          Text(t('Không tải được sản phẩm (mạng?)'),
                              style: TextStyle(
                                  color: DanColors.muted,
                                  fontWeight: FontWeight.w600)),
                          SizedBox(height: 12),
                          OutlinedButton.icon(
                            onPressed: () => _loadSkusNextPage(isRefresh: true),
                            icon: Icon(Icons.refresh, size: 18),
                            label: Text(t('Thử lại')),
                          ),
                        ],
                      ),
                    )
                  : list.isEmpty
                      ? _khongCoSanPham()
                      : GridView.builder(
                          controller: _skuScrollCtrl,
                          padding: EdgeInsets.fromLTRB(14, 0, 14, 14),
                          gridDelegate:
                              SliverGridDelegateWithMaxCrossAxisExtent(
                            maxCrossAxisExtent: narrow ? 132 : 160,
                            mainAxisExtent: narrow ? 192 : 206,
                            crossAxisSpacing: 10,
                            mainAxisSpacing: 10,
                          ),
                          itemCount: list.length + (_loadingSkus ? 1 : 0),
                          itemBuilder: (_, i) {
                            if (i >= list.length) {
                              return Center(child: AppSpinner());
                            }
                            return _SkuCard(
                              sku: list[i],
                              serverUrl: serverUrl,
                              promoLabel: _promoLabelForSku(list[i]),
                              onTap: () => _addToCart(list[i]),
                            );
                          },
                        ),
        ),
      ],
    );
  }

  // Dải combo trên đầu lưới hàng: mỗi combo là 1 nút, bấm → chọn thành phần.
  Widget _comboBar() {
    return Container(
      height: 44,
      margin: EdgeInsets.fromLTRB(14, 0, 14, 8),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _comboVouchers.length,
        separatorBuilder: (_, __) => SizedBox(width: 8),
        itemBuilder: (_, i) {
          final v = _comboVouchers[i];
          return ActionChip(
            avatar: Icon(Icons.card_giftcard, size: 18, color: DanColors.brand),
            label: Text(
              '${v.displayName} · ${t('chọn')} ${v.comboQty}',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
            ),
            backgroundColor: DanColors.brand.withValues(alpha: 0.10),
            side: BorderSide(color: DanColors.brand.withValues(alpha: 0.35)),
            onPressed: () => _openComboPicker(v),
          );
        },
      ),
    );
  }

  /// KHÔNG CÓ SẢN PHẨM — nói rõ vì sao khi server biết lý do.
  ///
  /// Cửa hàng nối kho với kênh bán lẻ rồi mà màn này trống trơn thì họ không có
  /// cách nào tự đoán ra hàng đang nằm ở kho khác. Server trả kèm `empty_reason`
  /// chỉ đúng kho và đúng chỗ cần sửa; chép thẳng ra đây.
  Widget _khongCoSanPham() {
    if (_lyDoTrong.isEmpty) {
      return Center(
          child: Text(t('Không có sản phẩm'),
              style: TextStyle(color: DanColors.faint)));
    }
    return Center(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.warehouse_outlined, size: 42, color: DanColors.faint),
            SizedBox(height: 12),
            Text(t('Không có sản phẩm'),
                style: TextStyle(fontWeight: FontWeight.w900)),
            SizedBox(height: 8),
            Text(_lyDoTrong,
                textAlign: TextAlign.center,
                style: TextStyle(
                    fontSize: 12.5, color: DanColors.muted, height: 1.5)),
          ],
        ),
      ),
    );
  }

  Widget _clickRow(String label, String value, VoidCallback onTap,
      {bool accent = false}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(DanRadius.sm),
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Expanded(
              child: Text(label,
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: DanColors.muted)),
            ),
            SizedBox(width: 12),
            Expanded(
              flex: 2,
              child: Align(
                alignment: Alignment.centerRight,
                child: Text(value,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.right,
                    style: TextStyle(
                        fontSize: 12.5,
                        color: accent ? DanColors.done : DanColors.text,
                        fontWeight: FontWeight.w900)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _totalRow(String label, String value,
      {bool big = false, Color? accent}) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          // Nhãn lấy đúng bề rộng cần (Flexible-loose) nên t("TỔNG CỘNG") không bị
          // cắt "…"; số tiền chiếm phần còn lại và canh phải.
          Flexible(
            child: Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: big ? 15 : 12.5,
                    fontWeight: big ? FontWeight.w900 : FontWeight.w700,
                    color: big ? DanColors.text : DanColors.muted)),
          ),
          SizedBox(width: 12),
          Expanded(
            child: Align(
              alignment: Alignment.centerRight,
              child: Text(value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.right,
                  style: TextStyle(
                      fontSize: big ? 20 : 13,
                      fontWeight: FontWeight.w900,
                      color:
                          big ? DanColors.brand : (accent ?? DanColors.text))),
            ),
          ),
        ],
      ),
    );
  }
}
