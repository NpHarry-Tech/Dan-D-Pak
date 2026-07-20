// GENERATED SPLIT of self_order_menu_screen.dart — panel giỏ/chi tiết + thẻ món (part of, cùng library).
part of 'self_order_menu_screen.dart';

class _CartPanel extends StatelessWidget {
  final SelfOrderLang lang;
  final List<SoCartItem> cart;
  final List<Map<String, dynamic>> sentItems;
  final Widget Function() sentItemsSection;
  final int total;
  final bool sending;
  final VoidCallback onClear;
  final void Function(int index, int qty) onQtyChange;
  final VoidCallback? onSend;
  final VoidCallback? onCheckout;

  const _CartPanel({
    required this.lang,
    required this.cart,
    required this.sentItems,
    required this.sentItemsSection,
    required this.total,
    required this.sending,
    required this.onClear,
    required this.onQtyChange,
    required this.onSend,
    required this.onCheckout,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: Color(0xFFF3F5F7),
            border: Border(bottom: BorderSide(color: Color(0xFFE7EAEE))),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(lang.cartTitle,
                  style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1A2230))),
              if (cart.isNotEmpty)
                GestureDetector(
                  onTap: onClear,
                  child: Text(lang.clearCartBtn,
                      style: TextStyle(
                          color: Color(0xFFFF6B6B),
                          fontWeight: FontWeight.bold,
                          fontSize: 13)),
                ),
            ],
          ),
        ),
        if (sentItems.isNotEmpty) sentItemsSection(),
        Expanded(
          child: cart.isEmpty
              ? Center(
                  child: Text(lang.cartEmpty,
                      style: TextStyle(color: Color(0xFF9AA3B2), fontSize: 14)),
                )
              : ListView.separated(
                  padding: EdgeInsets.all(14),
                  itemCount: cart.length,
                  separatorBuilder: (_, __) =>
                      Divider(color: Color(0xFFE7EAEE), height: 16),
                  itemBuilder: (_, i) => _CartRow(
                    item: cart[i],
                    onQtyChange: (q) => onQtyChange(i, q),
                  ),
                ),
        ),
        Container(
          padding: EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: Color(0xFFF3F5F7),
            border: Border(top: BorderSide(color: Color(0xFFE7EAEE))),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(lang.totalLabel,
                      style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF677084))),
                  Text(t('đ$total'),
                      style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                          color: Color(0xFF0891B2))),
                ],
              ),
              SizedBox(height: 14),
              FilledButton(
                onPressed: onSend,
                style: FilledButton.styleFrom(
                  backgroundColor: Color(0xFF0891B2),
                  padding: EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
                child: sending
                    ? SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : Text(lang.sendKitchenBtn,
                        style: TextStyle(
                            fontSize: 15, fontWeight: FontWeight.bold)),
              ),
              SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: onCheckout,
                style: OutlinedButton.styleFrom(
                  foregroundColor: Color(0xFF16A34A),
                  padding: EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
                icon: Icon(Icons.payments_outlined, size: 18),
                label: Text(lang.checkoutBtn,
                    style:
                        TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ItemDetailPanel extends StatelessWidget {
  final SoMenuItem item;
  final SelfOrderLang lang;
  final double width;
  final String categoryLabel;
  final VoidCallback onClose;
  final VoidCallback onAdd;

  _ItemDetailPanel({
    required this.item,
    required this.lang,
    required this.width,
    required this.categoryLabel,
    required this.onClose,
    required this.onAdd,
  });

  String get _itemCode {
    final values = [item.code, item.barcode]
        .whereType<String>()
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();
    return values.isEmpty ? '' : values.first;
  }

  String _joinList(List<dynamic> values) => values
      .map((e) {
        if (e is Map) return (e['name'] ?? e['label'] ?? '').toString().trim();
        return e.toString().trim();
      })
      .where((e) => e.isNotEmpty)
      .toList()
      .join(', ');

  List<(String, String)> get _rows {
    final rows = <(String, String)>[];
    void add(String label, String value) {
      final v = value.trim();
      if (v.isNotEmpty) rows.add((label, v));
    }

    add(lang.categoryLabel, categoryLabel);
    add(lang.descriptionLabel, item.description ?? '');
    add(lang.codeLabel, _itemCode);
    add(lang.ingredientsLabel, _joinList(item.ingredients));
    add(lang.allergensLabel, _joinList(item.allergens));
    if (item.slaMinutes > 0) {
      add(lang.prepTimeLabel, '${item.slaMinutes} ${lang.minutesSuffix}');
    }
    return rows;
  }

  @override
  Widget build(BuildContext context) {
    final optionRows = <(String, String)>[];
    void addOption(String label, String value) {
      final v = value.trim();
      if (v.isNotEmpty) optionRows.add((label, v));
    }

    addOption(lang.optionsLabel, _joinList(item.modifiers));
    addOption(lang.addonsLabel, _joinList(item.addons));

    return Container(
      width: width,
      margin: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Color(0xFFE7EAEE)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.14),
            blurRadius: 22,
            offset: Offset(0, 10),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            height: 250,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: _itemImage()),
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(18, 16, 14, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Text(
                                item.name,
                                maxLines: 3,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 21,
                                  fontWeight: FontWeight.w900,
                                  color: Color(0xFF1A2230),
                                ),
                              ),
                            ),
                            IconButton(
                              onPressed: onClose,
                              icon: Icon(Icons.close),
                              color: Color(0xFF677084),
                              tooltip: lang.backBtn,
                            ),
                          ],
                        ),
                        SizedBox(height: 6),
                        Text(
                          t('đ${item.price}'),
                          style: TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF0891B2),
                          ),
                        ),
                        SizedBox(height: 12),
                        Expanded(
                          child: optionRows.isEmpty
                              ? Text(
                                  lang.itemInfoTitle,
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w800,
                                    color: Color(0xFF9AA3B2),
                                  ),
                                )
                              : SingleChildScrollView(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      for (final row in optionRows)
                                        _infoRow(row.$1, row.$2),
                                    ],
                                  ),
                                ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: Color(0xFFE7EAEE)),
          Expanded(
            child: _rows.isEmpty
                ? Center(
                    child: Text(
                      lang.itemInfoTitle,
                      style: TextStyle(
                        color: Color(0xFF9AA3B2),
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  )
                : SingleChildScrollView(
                    padding: EdgeInsets.fromLTRB(18, 16, 18, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (final row in _rows) _infoRow(row.$1, row.$2),
                      ],
                    ),
                  ),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(18, 0, 18, 18),
            child: FilledButton.icon(
              onPressed: onAdd,
              icon: Icon(Icons.add_shopping_cart, size: 18),
              label: Text(
                lang.addToCartBtn,
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900),
              ),
              style: FilledButton.styleFrom(
                backgroundColor: Color(0xFF0891B2),
                padding: EdgeInsets.symmetric(vertical: 15),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _itemImage() {
    final image = item.image;
    if (image != null && image.startsWith('http')) {
      return Image.network(
        image,
        fit: BoxFit.cover,
        cacheWidth: 760,
        filterQuality: FilterQuality.low,
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) => _emojiBox(item.emoji),
      );
    }
    return _emojiBox(item.emoji);
  }

  Widget _infoRow(String label, String value) => Padding(
        padding: EdgeInsets.only(bottom: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w900,
                color: Color(0xFF9AA3B2),
              ),
            ),
            SizedBox(height: 3),
            Text(
              value,
              style: TextStyle(
                fontSize: 14,
                height: 1.35,
                fontWeight: FontWeight.w700,
                color: Color(0xFF1A2230),
              ),
            ),
          ],
        ),
      );

  Widget _emojiBox(String? emoji) => Container(
        color: Color(0xFFF3F5F7),
        alignment: Alignment.center,
        child: Text(emoji ?? '🍽️', style: TextStyle(fontSize: 56)),
      );
}

class _FavCard extends StatelessWidget {
  final SoMenuItem item;
  final ValueChanged<SoMenuItem> onTap;
  _FavCard({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => onTap(item),
      child: Container(
        width: 210,
        margin: EdgeInsets.only(right: 10),
        padding: EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Color(0xFFFFC24D)),
        ),
        child: Row(children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: Color(0xFFF3F5F7),
              borderRadius: BorderRadius.circular(10),
            ),
            clipBehavior: Clip.antiAlias,
            child: item.image != null && item.image!.startsWith('http')
                ? Image.network(item.image!,
                    fit: BoxFit.cover,
                    // Decode cỡ thumbnail — menu dài không được nuốt RAM tablet.
                    cacheWidth: 112,
                    filterQuality: FilterQuality.low,
                    gaplessPlayback: true,
                    errorBuilder: (_, __, ___) =>
                        Center(child: Text(item.emoji ?? '🍽️')))
                : Center(
                    child: Text(item.emoji ?? '🍽️',
                        style: TextStyle(fontSize: 26))),
          ),
          SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                        color: Color(0xFF1A2230))),
                SizedBox(height: 3),
                Text(t('đ${item.price}'),
                    style: TextStyle(
                        color: Color(0xFF0891B2),
                        fontWeight: FontWeight.w800,
                        fontSize: 13)),
              ],
            ),
          ),
          Icon(Icons.add_circle_rounded, color: Color(0xFF0891B2), size: 26),
        ]),
      ),
    );
  }
}

// ─── Menu card ────────────────────────────────────────────────────────────────

class _MenuCard extends StatelessWidget {
  final SoMenuItem item;
  final ValueChanged<SoMenuItem> onTap;
  _MenuCard({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: Color(0xFFE7EAEE)),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => onTap(item),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: item.image != null && item.image!.startsWith('http')
                  ? Image.network(item.image!,
                      fit: BoxFit.cover,
                      // Ô lưới ~190dp — decode đúng cỡ hiển thị, menu hàng
                      // trăm món không được nuốt RAM/CPU tablet.
                      cacheWidth: 380,
                      filterQuality: FilterQuality.low,
                      gaplessPlayback: true,
                      errorBuilder: (_, __, ___) => _emojiBox(item.emoji))
                  : _emojiBox(item.emoji),
            ),
            Padding(
              padding: EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF1A2230))),
                  SizedBox(height: 3),
                  Text(t('đ${item.price}'),
                      style: TextStyle(
                          fontSize: 13,
                          color: Color(0xFF0891B2),
                          fontWeight: FontWeight.w800)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _emojiBox(String? emoji) => Container(
      color: Color(0xFFF3F5F7),
      alignment: Alignment.center,
      child: Text(emoji ?? '🍽️', style: TextStyle(fontSize: 44)));
}

// ─── Cart row ─────────────────────────────────────────────────────────────────

class _CartRow extends StatelessWidget {
  final SoCartItem item;
  final ValueChanged<int> onQtyChange;
  _CartRow({required this.item, required this.onQtyChange});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(item.item.name,
                  style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1A2230),
                      fontSize: 13)),
              Text(t('đ${item.totalPrice}'),
                  style: TextStyle(
                      color: Color(0xFF0891B2),
                      fontWeight: FontWeight.bold,
                      fontSize: 12)),
            ],
          ),
        ),
        Row(children: [
          _QtyBtn(icon: Icons.remove, onTap: () => onQtyChange(item.qty - 1)),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 10),
            child: Text('${item.qty}',
                style: TextStyle(
                    fontWeight: FontWeight.bold, color: Color(0xFF1A2230))),
          ),
          _QtyBtn(icon: Icons.add, onTap: () => onQtyChange(item.qty + 1)),
        ]),
      ],
    );
  }
}

class _QtyBtn extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  _QtyBtn({required this.icon, required this.onTap});
  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
              color: Color(0xFFF3F5F7), borderRadius: BorderRadius.circular(6)),
          child: Icon(icon, size: 14, color: Color(0xFF677084)),
        ),
      );
}
