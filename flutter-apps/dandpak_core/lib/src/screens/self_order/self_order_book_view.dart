// GENERATED SPLIT of self_order_menu_screen.dart — xem menu dạng sách (part of, cùng library).
part of 'self_order_menu_screen.dart';

class _BookMenuOrderView extends StatefulWidget {
  final Map<String, dynamic> book;
  final String serverUrl;
  final SelfOrderLang lang;
  final int cartCount;
  final int cartTotal;
  final ValueChanged<String> onHotspotTap;
  final VoidCallback onOpenCart;

  const _BookMenuOrderView({
    required this.book,
    required this.serverUrl,
    required this.lang,
    required this.cartCount,
    required this.cartTotal,
    required this.onHotspotTap,
    required this.onOpenCart,
  });

  @override
  State<_BookMenuOrderView> createState() => _BookMenuOrderViewState();
}

class _BookMenuOrderViewState extends State<_BookMenuOrderView>
    with SingleTickerProviderStateMixin {
  int _page = 0;
  double _drag = 0;
  bool _fromRight = true;

  List<Map<String, dynamic>> get _pages => (widget.book['pages'] as List)
      .whereType<Map>()
      .map((e) => Map<String, dynamic>.from(e))
      .toList();

  List<Map<String, dynamic>> get _hotspots =>
      (widget.book['hotspots'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .where((h) => h['enabled'] != false)
          .toList();

  void _startDrag(DragStartDetails d, double width) {
    _fromRight = d.localPosition.dx > width / 2;
    setState(() => _drag = 0.01);
  }

  void _updateDrag(DragUpdateDetails d, double width) {
    final delta = _fromRight ? -d.delta.dx : d.delta.dx;
    setState(() => _drag = (_drag + delta / width).clamp(0, 1));
  }

  void _endDrag() {
    final next = _fromRight ? _page + 1 : _page - 1;
    setState(() {
      if (_drag > .35 && next >= 0 && next < _pages.length) _page = next;
      _drag = 0;
    });
  }

  String _src(Map<String, dynamic> page) {
    final src = (page['src'] ?? '').toString();
    if (src.startsWith('http://') || src.startsWith('https://')) return src;
    final base = widget.serverUrl.replaceFirst(RegExp(r'/$'), '');
    return '$base$src';
  }

  @override
  Widget build(BuildContext context) {
    final nextPage = _fromRight ? _page + 1 : _page - 1;
    final hasNext = nextPage >= 0 && nextPage < _pages.length;
    return Stack(
      children: [
        Positioned.fill(
          child: LayoutBuilder(
            builder: (context, box) {
              final width = box.maxWidth;
              final height = box.maxHeight;
              final pageWidth = math.min(width - 24, height * .72);
              final pageHeight = math.min(height - 20, pageWidth * 1.5);
              return GestureDetector(
                onPanStart: (d) => _startDrag(d, pageWidth),
                onPanUpdate: (d) => _updateDrag(d, pageWidth),
                onPanEnd: (_) => _endDrag(),
                child: Center(
                  child: SizedBox(
                    width: pageWidth,
                    height: pageHeight,
                    child: Stack(
                      children: [
                        if (hasNext)
                          Opacity(
                            opacity: _drag.clamp(.08, 1),
                            child: _BookPageImage(src: _src(_pages[nextPage])),
                          ),
                        Transform(
                          alignment: _fromRight
                              ? Alignment.centerRight
                              : Alignment.centerLeft,
                          transform: Matrix4.identity()
                            ..setEntry(3, 2, 0.001)
                            ..rotateY(
                                (_fromRight ? -1 : 1) * _drag * math.pi * .72),
                          child: _BookPageImage(src: _src(_pages[_page])),
                        ),
                        for (final h in _hotspots)
                          if ((h['page'] as num?)?.toInt() == _page)
                            Positioned(
                              left: pageWidth * ((h['x'] as num? ?? 50) / 100) -
                                  22,
                              top: pageHeight * ((h['y'] as num? ?? 50) / 100) -
                                  22,
                              child: Material(
                                color: Color(0xFF0891B2).withValues(alpha: .88),
                                shape: CircleBorder(),
                                child: InkWell(
                                  customBorder: CircleBorder(),
                                  onTap: () => widget.onHotspotTap(
                                      (h['menu_item_id'] ?? '').toString()),
                                  child: SizedBox(
                                    width: 44,
                                    height: 44,
                                    child: Icon(Icons.add_shopping_cart,
                                        color: Colors.white, size: 20),
                                  ),
                                ),
                              ),
                            ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        Positioned(
          right: 18,
          bottom: 18,
          child: FilledButton.icon(
            onPressed: widget.onOpenCart,
            icon: Badge(
              label: Text('${widget.cartCount}'),
              isLabelVisible: widget.cartCount > 0,
              child: Icon(Icons.shopping_cart_outlined),
            ),
            label:
                Text('${widget.lang.cartTitle} · ${t('đ${widget.cartTotal}')}'),
            style: FilledButton.styleFrom(
              backgroundColor: Color(0xFF0891B2),
              padding: EdgeInsets.symmetric(horizontal: 18, vertical: 14),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _BookPageImage extends StatelessWidget {
  final String src;
  const _BookPageImage({required this.src});

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .12),
            blurRadius: 20,
            offset: Offset(0, 8),
          )
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Image.network(src, fit: BoxFit.contain),
      ),
    );
  }
}

