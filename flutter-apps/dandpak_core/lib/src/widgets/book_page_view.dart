import 'dart:math' as math;

import 'package:flutter/material.dart';

/// XEM MENU/CATALOGUE DẠNG SÁCH — kéo để lật trang, chạm chấm điểm để thêm hàng.
///
/// Dùng CHUNG cho hai màn khách:
///   • self-order F&B  — chấm điểm trỏ tới MÓN (menu_items)
///   • catalogue bán lẻ — chấm điểm trỏ tới HÀNG HOÁ (skus)
///
/// Hai màn đó khác nhau ở nguồn hàng và nơi giỏ đổ về, nhưng phần lật trang thì
/// giống hệt. Tách ra đây để một lần sửa lỗi lật trang là cả hai cùng hưởng —
/// trước đây logic này nằm trong `part of self_order_menu_screen.dart` nên màn
/// bán lẻ muốn dùng thì phải chép lại, rồi hai bản sẽ trôi khác nhau dần.
/// Điều khiển quyển từ bên ngoài — hiện chỉ để NHẢY TỚI MỘT TRANG.
///
/// Thanh danh mục nằm ngoài widget quyển (nó thuộc về khung màn khách), nên
/// phải có đường ra lệnh "mở trang 7". Dùng bộ điều khiển thay vì truyền số
/// trang vào thẳng: bấm lại đúng cái mục đang xem vẫn phải quay về trang đầu
/// của mục, mà truyền số trang thì lần bấm thứ hai không có gì đổi nên không
/// kích hoạt được.
class BookPageController extends ChangeNotifier {
  int? _muon;
  int? get trangMuon => _muon;

  void moTrang(int page) {
    _muon = page;
    notifyListeners();
  }

  void daMo() => _muon = null;
}

class BookPageView extends StatefulWidget {
  /// Quyển sách: { pages: [{src, label}], hotspots: [{page,x,y,...}] }.
  final Map<String, dynamic> book;

  /// Gốc URL để ghép với đường dẫn ảnh tương đối do server trả về.
  final String serverUrl;

  /// Khoá trong chấm điểm chứa mã hàng cần thêm ('sku_id' hoặc 'menu_item_id').
  final String targetKey;

  final ValueChanged<String> onHotspotTap;

  /// Nút nổi góc dưới (giỏ hàng). Để null thì không hiện gì.
  final Widget? floatingAction;

  /// Báo trang hiện tại đổi — màn bán lẻ dùng để biết trang này gắn hàng nào.
  final ValueChanged<int>? onPageChanged;

  /// Nút nhỏ ĐÁY GIỮA tấm hình (ví dụ "Xem chi tiết sản phẩm").
  ///
  /// Nhận số trang đang mở để bên gọi tự quyết hiện gì. Trả về null thì không
  /// vẽ gì — trang đó chưa gắn hàng hoá nào.
  final Widget? Function(int page)? bottomCenter;

  /// Ra lệnh mở một trang cụ thể (thanh danh mục dùng).
  final BookPageController? controller;

  /// Vẽ chấm điểm tròn trên trang. Màn bán lẻ TẮT: khách chỉ cần một nút "xem
  /// chi tiết" ở đáy, rắc chấm khắp ảnh làm che mất sản phẩm.
  final bool showHotspots;

  const BookPageView({
    super.key,
    required this.book,
    required this.serverUrl,
    required this.targetKey,
    required this.onHotspotTap,
    this.floatingAction,
    this.onPageChanged,
    this.bottomCenter,
    this.controller,
    this.showHotspots = true,
  });

  @override
  State<BookPageView> createState() => _BookPageViewState();
}

class _BookPageViewState extends State<BookPageView>
    with SingleTickerProviderStateMixin {
  int _page = 0;
  double _drag = 0;
  bool _fromRight = true;

  /// CHẠY NỐT CÚ LẬT SAU KHI THẢ TAY.
  ///
  /// Bản trước gán thẳng `_drag = 0` lúc thả: trang đang nghiêng dở biến về vị
  /// trí cũ trong một khung hình, nhìn như giật. Giờ cho nó chạy nốt tới 1 (lật
  /// qua) hoặc về 0 (trả lại), theo đường cong easeOut như trang giấy thật.
  late final AnimationController _anim = AnimationController(
    vsync: this,
    // 340ms: đủ chậm để mắt theo kịp tờ giấy quay, đủ nhanh để không cản người
    // đang lật liên tục. 260ms trước đó nhanh tới mức trông như trang nhảy cóc.
    duration: const Duration(milliseconds: 340),
  )..addListener(() {
      if (mounted) setState(() => _drag = _keo.value);
    });
  Animation<double> _keo = const AlwaysStoppedAnimation(0);

  /// Trang sẽ đứng ở đâu khi animation chạy xong (null = trả về chỗ cũ).
  int? _trangDich;

  @override
  void initState() {
    super.initState();
    widget.controller?.addListener(_theoLenh);
  }

  /// Nhảy thẳng tới trang được chỉ định — KHÔNG chạy hiệu ứng lật.
  ///
  /// Bấm danh mục là "mở tới mục này", không phải "lật từng trang tới đó". Chạy
  /// hiệu ứng lật qua hai chục trang thì vừa lâu vừa chóng mặt.
  void _theoLenh() {
    final muon = widget.controller?.trangMuon;
    if (muon == null || !mounted) return;
    widget.controller?.daMo();
    final n = _pages.length;
    if (n == 0) return;
    _anim.stop();
    setState(() {
      _page = muon.clamp(0, n - 1);
      _drag = 0;
      _trangDich = null;
      _daBietHuong = false;
    });
    widget.onPageChanged?.call(_page);
  }

  @override
  void dispose() {
    widget.controller?.removeListener(_theoLenh);
    _anim.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _pages =>
      (widget.book['pages'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();

  List<Map<String, dynamic>> get _hotspots =>
      (widget.book['hotspots'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .where((h) => h['enabled'] != false)
          .toList();

  @override
  void didUpdateWidget(covariant BookPageView old) {
    super.didUpdateWidget(old);
    if (old.controller != widget.controller) {
      old.controller?.removeListener(_theoLenh);
      widget.controller?.addListener(_theoLenh);
    }
    // Quản lý xoá bớt trang trong lúc khách đang xem → trang hiện tại có thể
    // vượt quá số trang còn lại. Không kẹp lại là màn khách văng lỗi index.
    final n = _pages.length;
    if (_page >= n) _page = n > 0 ? n - 1 : 0;
  }

  /// Chưa biết khách vuốt về phía nào cho tới khi ngón tay thật sự nhúc nhích.
  bool _daBietHuong = false;

  void _startDrag(DragStartDetails d, double width) {
    _anim.stop();
    _daBietHuong = false;
    setState(() => _drag = 0);
  }

  /// CHIỀU LẬT LẤY THEO HƯỚNG VUỐT, KHÔNG THEO CHỖ ĐẶT NGÓN TAY.
  ///
  /// Bản trước quyết định bằng `localPosition.dx > width/2` — chạm nửa trái thì
  /// mặc định là lật lui. Khách vuốt phải→trái nhưng bắt đầu ở nửa trái thì máy
  /// hiểu ngược, trang chạy sang hướng kia hoặc đứng im. Vuốt sang TRÁI là sang
  /// trang SAU, vuốt sang PHẢI là quay lại trang TRƯỚC — như mọi quyển sách.
  void _updateDrag(DragUpdateDetails d, double width) {
    if (!_daBietHuong) {
      if (d.delta.dx.abs() < 0.5) return;
      _daBietHuong = true;
      _fromRight = d.delta.dx < 0;
    }
    final delta = _fromRight ? -d.delta.dx : d.delta.dx;
    setState(() => _drag = (_drag + delta / width).clamp(0, 1));
  }

  void _endDrag(DragEndDetails d, double width) {
    if (!_daBietHuong) return;
    final next = _fromRight ? _page + 1 : _page - 1;
    final coTrang = next >= 0 && next < _pages.length;

    // Vuốt NHANH thì lật kể cả khi kéo chưa quá nửa — đó là cách người ta lật
    // sách thật. Chỉ xét ngưỡng quãng đường khi cú vuốt chậm rãi.
    final nhanh = d.velocity.pixelsPerSecond.dx.abs() > 320;
    final lat = coTrang && (_drag > .35 || (nhanh && _drag > .08));

    _trangDich = lat ? next : null;
    _keo = Tween<double>(begin: _drag, end: lat ? 1 : 0)
        .animate(CurvedAnimation(parent: _anim, curve: Curves.easeOutCubic));
    _anim
      ..reset()
      ..forward().whenComplete(() {
        if (!mounted) return;
        setState(() {
          if (_trangDich != null) {
            _page = _trangDich!;
            widget.onPageChanged?.call(_page);
          }
          _trangDich = null;
          // Trang mới đã nằm đúng chỗ → đưa độ nghiêng về 0 trong CÙNG một
          // khung hình với việc đổi số trang, nếu không sẽ loé một nhịp trang
          // cũ đã lật hẳn.
          _drag = 0;
        });
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
    final pages = _pages;
    if (pages.isEmpty) {
      return const Center(child: Text('Chưa có trang nào trong quyển này'));
    }
    final nextPage = _fromRight ? _page + 1 : _page - 1;
    final hasNext = nextPage >= 0 && nextPage < pages.length;
    return Stack(
      children: [
        Positioned.fill(
          child: LayoutBuilder(
            builder: (context, box) {
              // TRANG CHIẾM HẾT KHUNG CÒN LẠI.
              //
              // Bản trước ép trang theo dáng A4 dựng đứng (`height * .72`, tỉ lệ
              // 1.5). Trên tablet nằm ngang, khung chứa lùn và rộng nên trang co
              // lại thành một dải bé xíu giữa hai mảng trống. Giờ lấy đúng tỉ lệ
              // của quyển (server lưu pageWidth/pageHeight, ảnh import PubHTML5
              // mang tỉ lệ thật) rồi phóng to hết mức vừa khung.
              final width = box.maxWidth;
              final height = box.maxHeight;
              final wGoc = (widget.book['pageWidth'] as num?)?.toDouble() ?? 0;
              final hGoc = (widget.book['pageHeight'] as num?)?.toDouble() ?? 0;
              final tiLe = (wGoc > 0 && hGoc > 0) ? hGoc / wGoc : 1.5;
              // Chừa 8px mỗi bên cho bóng đổ, không hơn — khách muốn thấy ảnh
              // to chứ không phải thấy nền.
              final wKhung = math.max(1.0, width - 16);
              final hKhung = math.max(1.0, height - 16);
              final pageWidth = math.min(wKhung, hKhung / tiLe);
              final pageHeight = pageWidth * tiLe;
              return GestureDetector(
                onPanStart: (d) => _startDrag(d, pageWidth),
                onPanUpdate: (d) => _updateDrag(d, pageWidth),
                onPanEnd: (d) => _endDrag(d, pageWidth),
                child: Center(
                  child: SizedBox(
                    width: pageWidth,
                    height: pageHeight,
                    child: Stack(
                      children: [
                        if (hasNext)
                          Opacity(
                            opacity: _drag.clamp(.08, 1),
                            child: BookPageImage(src: _src(pages[nextPage])),
                          ),
                        // TRANG XOAY QUANH GÁY SÁCH, KHÔNG QUANH MÉP ĐANG CẦM.
                        //
                        // Bản trước neo ở mép người dùng đang kéo (kéo mép phải
                        // thì neo phải), nên trang bay ngược hướng vuốt: vuốt
                        // phải→trái mà tờ giấy chạy sang phải. Sách thật thì
                        // ngược lại — cầm mép phải, tờ giấy quay quanh GÁY nằm
                        // bên trái. Vậy lật tới phải neo centerLeft, lật lui
                        // neo centerRight.
                        Transform(
                          alignment: _fromRight
                              ? Alignment.centerLeft
                              : Alignment.centerRight,
                          transform: Matrix4.identity()
                            // Phối cảnh sâu hơn (0.0014 thay vì 0.001) để tờ
                            // giấy có chiều sâu thật khi nghiêng, thay vì trông
                            // như một hình chữ nhật bị bóp ngang.
                            ..setEntry(3, 2, 0.0014)
                            ..rotateY(
                                (_fromRight ? -1 : 1) * _drag * math.pi * .72),
                          child: Stack(
                            children: [
                              BookPageImage(src: _src(pages[_page])),
                              // Trang càng nghiêng càng tối dần ở mép đang lật —
                              // đây là thứ làm cú lật trông có khối. Thiếu nó
                              // thì trang chỉ hẹp lại chứ không giống giấy.
                              Positioned.fill(
                                child: IgnorePointer(
                                  child: DecoratedBox(
                                    decoration: BoxDecoration(
                                      gradient: LinearGradient(
                                        begin: _fromRight
                                            ? Alignment.centerLeft
                                            : Alignment.centerRight,
                                        end: _fromRight
                                            ? Alignment.centerRight
                                            : Alignment.centerLeft,
                                        colors: [
                                          Colors.black
                                              .withValues(alpha: .30 * _drag),
                                          Colors.black
                                              .withValues(alpha: .02 * _drag),
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        // NÚT NHỎ ĐÁY GIỮA TẤM HÌNH.
                        //
                        // Đặt trong khung trang chứ không phải giữa màn hình:
                        // trang không phủ kín khung thì nút phải bám theo mép
                        // dưới của ẢNH, nếu không nó lơ lửng ngoài tấm hình.
                        // Bọc IgnorePointer khi trang đang nghiêng để cú vuốt
                        // không bị nút nuốt mất.
                        if (widget.bottomCenter != null)
                          Positioned(
                            left: 0,
                            right: 0,
                            bottom: 12,
                            child: IgnorePointer(
                              ignoring: _drag > 0.02,
                              child: AnimatedOpacity(
                                duration: const Duration(milliseconds: 160),
                                opacity: _drag > 0.02 ? 0 : 1,
                                child: Center(
                                  child: widget.bottomCenter!(_page) ??
                                      const SizedBox.shrink(),
                                ),
                              ),
                            ),
                          ),
                        if (widget.showHotspots)
                          for (final h in _hotspots)
                            if ((h['page'] as num?)?.toInt() == _page)
                              Positioned(
                                left:
                                    pageWidth * ((h['x'] as num? ?? 50) / 100) -
                                        22,
                                top: pageHeight *
                                        ((h['y'] as num? ?? 50) / 100) -
                                    22,
                                child: Material(
                                  color: const Color(0xFF0891B2)
                                      .withValues(alpha: .88),
                                  shape: const CircleBorder(),
                                  child: InkWell(
                                    customBorder: const CircleBorder(),
                                    onTap: () => widget.onHotspotTap(
                                        (h[widget.targetKey] ?? '').toString()),
                                    child: const SizedBox(
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
        // Số trang: khách cần biết quyển còn dài bao nhiêu, nếu không họ lật vài
        // trang rồi tưởng đã hết.
        // Đặt ở GÓC TRÊN PHẢI: đáy giữa đã dành cho nút "xem chi tiết", hai thứ
        // chồng lên nhau thì khách bấm trúng cái không định bấm.
        Positioned(
          top: 12,
          right: 14,
          child: Align(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: .45),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text('${_page + 1} / ${pages.length}',
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w700)),
            ),
          ),
        ),
        if (widget.floatingAction != null)
          Positioned(right: 18, bottom: 18, child: widget.floatingAction!),
      ],
    );
  }
}

class BookPageImage extends StatelessWidget {
  final String src;
  const BookPageImage({super.key, required this.src});

  @override
  Widget build(BuildContext context) {
    // KHÔNG CÓ KHUNG TRẮNG QUANH ẢNH.
    //
    // Bản trước đặt nền trắng + bo góc rồi vẽ ảnh `contain` lên trên: ảnh không
    // đúng tỉ lệ khung là lòi ra hai vệt trắng hai bên, trông như tấm hình bị
    // dán lệch. Giờ khung trang đã lấy đúng tỉ lệ quyển nên ảnh phủ kín; chỉ
    // giữ lại bóng đổ mỏng để tờ giấy tách khỏi nền.
    return DecoratedBox(
      decoration: BoxDecoration(
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .18),
            blurRadius: 24,
            offset: const Offset(0, 10),
          )
        ],
      ),
      child: SizedBox.expand(
        child: Image.network(
          src,
          fit: BoxFit.cover,
          // Ảnh trang hỏng/mất mạng: hiện ô báo thay vì icon vỡ mặc định —
          // đây là màn KHÁCH nhìn, không được để lộ lỗi kỹ thuật.
          errorBuilder: (_, __, ___) => const Center(
            child: Icon(Icons.image_not_supported_outlined,
                size: 40, color: Colors.black26),
          ),
        ),
      ),
    );
  }
}
