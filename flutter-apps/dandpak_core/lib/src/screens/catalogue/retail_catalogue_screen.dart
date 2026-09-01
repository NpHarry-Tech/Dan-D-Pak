import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../models/retail_models.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';
import '../../widgets/book_page_view.dart';
import '../../widgets/customer_picker_dialog.dart';

/// MÀN KHÁCH CATALOGUE BÁN LẺ — tablet đặt ngoài quầy, khách tự lật xem và chọn.
///
/// Khác self-order F&B ở chỗ: bên kia khách ngồi tại BÀN nên đơn gắn số bàn.
/// Bán lẻ không có bàn — thứ thay cho số bàn là CHÍNH CÁI MÁY. Mỗi máy có tên
/// riêng ("Kệ hạt điều"), tên đó hiện lên POS thay nhãn "Hóa đơn 01" để thu ngân
/// biết chạy tới đâu.
///
/// Màn này KHÔNG tự tạo đơn và KHÔNG thu tiền. Nó chỉ ghi giỏ hàng lên server;
/// nhân viên vẫn xác nhận và thu tiền như mọi giỏ khác. Khách bấm thanh toán thì
/// tab bên POS chuyển ĐỎ — đó là tín hiệu duy nhất, cố ý không chuông không
/// popup vì cửa hàng đã có nhân viên đứng quầy.
class RetailCatalogueScreen extends StatefulWidget {
  const RetailCatalogueScreen({super.key});

  @override
  State<RetailCatalogueScreen> createState() => _RetailCatalogueScreenState();
}

class _RetailCatalogueScreenState extends State<RetailCatalogueScreen> {
  Map<String, dynamic> _book = const {};
  Map<String, dynamic> _config = const {};
  String _deviceName = '';
  bool _loading = true;
  String? _error;

  /// Hàng hoá tra theo mã — chấm điểm trên trang catalogue chỉ mang `sku_id`.
  final Map<String, Sku> _skus = {};

  final List<CartLine> _cart = [];
  RetailCustomer? _customer;

  /// Bấm logo 3 lần liên tiếp mới hỏi mật khẩu thoát. Đếm tự đặt lại sau 2 giây
  /// để khách chạm linh tinh không vô tình mở được cửa thoát.
  int _logoTaps = 0;
  Timer? _logoReset;

  Timer? _heartbeat;
  bool _syncing = false;

  /// Sản phẩm khách vừa chạm trên trang catalogue — hiện ở cột phải.
  Sku? _chon;
  // Panel sản phẩm/giỏ trượt từ phải (kiểu self-order menu quyển). Mở khi khách
  // chạm hàng hoặc bấm nút giỏ nổi; đóng lại là màn book full-screen.
  bool _panelGio = false;

  /// DANH MỤC của quyển: [{name, page}] — server dựng theo đúng thứ tự trang.
  List<Map<String, dynamic>> _danhMuc = const [];

  /// Trang đang mở, để tô đậm đúng mục trên thanh danh mục.
  int _trang = 0;

  final _dieuKhienQuyen = BookPageController();

  @override
  void initState() {
    super.initState();
    // KHOÁ MÀN HÌNH NGANG. Catalogue là quyển sách để khách lật — trang sách
    // nằm ngang thì ảnh sản phẩm to hơn hẳn, và cột thông tin 1/3 bên phải vẫn
    // đủ rộng để đọc tên/giá. Máy đặt cố định ngoài quầy nên khoá luôn cho khỏi
    // xoay lung tung giữa lúc khách đang xem.
    SystemChrome.setPreferredOrientations(const [
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
    _load();
    // Báo danh đều đặn: server coi máy im lặng là đã tắt, và màn Cài đặt cần
    // biết máy nào đang bật để quản lý đặt tên cho đúng cái máy.
    _heartbeat =
        Timer.periodic(const Duration(seconds: 30), (_) => _register());
    // Quản lý đổi cổng thanh toán (tắt SePay, bật QR tĩnh...) thì màn khách phải
    // đổi mã theo NGAY — nếu không khách vẫn quét mã của cổng vừa bị tắt.
    SocketService().addListener(_onSocketEvent);
  }

  void _onSocketEvent(String event, dynamic _) {
    if (!mounted) return;
    if (event == 'payment:config' || event == 'book-menu:updated') _load();
  }

  @override
  void dispose() {
    // Trả lại quyền xoay cho phần còn lại của app — nếu không, thoát màn khách
    // xong cả app kẹt ở chiều dọc.
    SystemChrome.setPreferredOrientations(DeviceOrientation.values);
    SocketService().removeListener(_onSocketEvent);
    _dieuKhienQuyen.dispose();
    _logoReset?.cancel();
    _heartbeat?.cancel();
    super.dispose();
  }

  ApiService get _api => context.read<ApiService>();

  Future<void> _register() async {
    try {
      final r = await _api.catalogueRegister();
      if (!mounted) return;
      final ten = '${r['name'] ?? ''}';
      if (ten.isNotEmpty && ten != _deviceName) {
        setState(() => _deviceName = ten);
      }
    } catch (_) {
      // Mất mạng giữa ca là chuyện thường — nhịp sau báo lại, không làm phiền khách.
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final reg = await _api.catalogueRegister();
      final book = await _api.catalogueBook();
      final cfg = await _api.catalogueConfig();

      // Nạp hàng hoá để tra tên/giá cho chấm điểm. Hỏi đúng KÊNH 'retail' —
      // tức là đúng cái kho đã nối với mục bán lẻ ở Cài đặt → Kho & kênh bán,
      // và đúng bảng giá của kênh đó. Catalogue CỐ Ý không có cấu hình kho
      // riêng: khách chọn trên tablet rồi ra quầy trả tiền, hai bên mà lấy hàng
      // từ hai kho khác nhau thì khách chọn được thứ POS không bán được, hoặc
      // đọc một giá rồi bị thu một giá khác.
      final res = await _api.getSkusPaginated(
          page: 1, limit: 500, q: '', channel: 'retail', inStockOnly: false);
      final lyDoTrong = '${(res['empty_reason'] as Map?)?['message'] ?? ''}';
      final items = (res['items'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => Sku.fromJson(Map<String, dynamic>.from(e)));

      if (!mounted) return;
      setState(() {
        _deviceName = '${reg['name'] ?? ''}';
        _book = Map<String, dynamic>.from((book['book'] as Map?) ?? const {});
        _danhMuc = (book['categories'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _trang = 0;
        _config = Map<String, dynamic>.from((reg['config'] as Map?) ?? cfg);
        _skus
          ..clear()
          ..addEntries(items.map((s) => MapEntry(s.id, s)));
        _loading = false;
        if (book['enabled'] != true) {
          _error = t('Catalogue bán lẻ chưa được bật trong Cài đặt');
        } else if (_skus.isEmpty && lyDoTrong.isNotEmpty) {
          // Quyển có trang nhưng không tra được mặt hàng nào thì mọi nút "xem
          // chi tiết" đều câm. Nói thẳng lý do cho người dựng máy, đừng để họ
          // đứng nhìn một quyển sách bấm vào không ra gì.
          _error = lyDoTrong;
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  // ── Giỏ hàng ──────────────────────────────────────────────────────────────

  int get _cartCount => _cart.fold(0, (s, l) => s + l.qty);
  num get _cartTotal => _cart.fold<num>(0, (s, l) => s + l.sku.price * l.qty);

  /// Khách chạm chấm điểm trên trang → CHỌN sản phẩm, hiện ở cột phải.
  ///
  /// Cố ý KHÔNG thêm thẳng vào giỏ: khách cần xem tên, giá, còn hàng không rồi
  /// mới quyết. Thêm ngay khi chạm thì chạm nhầm là có hàng lạ trong giỏ mà
  /// khách không biết gỡ ở đâu.
  void _chonSku(String skuId) {
    final sku = _skus[skuId];
    if (sku == null) {
      _toast(t('Sản phẩm này chưa có trong danh mục bán lẻ'));
      return;
    }
    setState(() => _chon = sku);
  }

  void _addSku(String skuId) {
    final sku = _skus[skuId];
    if (sku == null) {
      _toast(t('Sản phẩm này chưa có trong danh mục bán lẻ'));
      return;
    }
    setState(() {
      final i = _cart.indexWhere((l) => l.sku.id == sku.id && l.lotId == null);
      if (i >= 0) {
        _cart[i] = CartLine(sku, _cart[i].qty + 1);
      } else {
        _cart.add(CartLine(sku, 1));
      }
    });
    _pushCart();
  }

  void _setQty(int index, int qty) {
    setState(() {
      if (qty <= 0) {
        _cart.removeAt(index);
      } else {
        _cart[index] = CartLine(_cart[index].sku, qty);
      }
    });
    _pushCart();
  }

  /// Đẩy giỏ lên server → POS thấy ngay. Ô giỏ do SERVER cấp theo định danh máy,
  /// client không tự chọn (xem chú thích ở modules/catalogue/routes.js).
  Future<void> _pushCart() async {
    if (_syncing) return;
    _syncing = true;
    try {
      await _api.catalogueSaveCart({
        'lines': [
          for (final l in _cart)
            {'sku': l.sku.toJson(), 'qty': l.qty, 'lot_id': null}
        ],
        'customer': _customer?.toCheckoutCustomer(),
      });
    } catch (_) {
      // Giỏ vẫn nằm trên máy; lần thao tác sau đẩy lại.
    } finally {
      _syncing = false;
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: DanColors.text,
      duration: const Duration(seconds: 2),
    ));
  }

  // ── Thoát màn khách ───────────────────────────────────────────────────────

  void _onLogoTap() {
    _logoReset?.cancel();
    _logoTaps++;
    if (_logoTaps >= 3) {
      _logoTaps = 0;
      _askExit();
      return;
    }
    _logoReset = Timer(const Duration(seconds: 2), () => _logoTaps = 0);
  }

  Future<void> _askExit() async {
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(t('Thoát màn hình khách')),
        content: TextField(
          controller: ctrl,
          obscureText: true,
          autofocus: true,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(labelText: t('Mật khẩu nhân viên')),
          onSubmitted: (_) => Navigator.of(c).pop(true),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(c).pop(false),
              child: Text(t('Hủy'))),
          FilledButton(
              onPressed: () => Navigator.of(c).pop(true),
              child: Text(t('Thoát'))),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final pass = await _api.catalogueExit(ctrl.text.trim());
    if (!mounted) return;
    if (pass) {
      Navigator.of(context).maybePop();
    } else {
      _toast(t('Mật khẩu không đúng'));
    }
  }

  // ── Giao diện ─────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final serverUrl = context.read<AuthProvider>().serverUrl;
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        child: Column(
          children: [
            _topBar(),
            if (!_loading && _error == null && _danhMuc.isNotEmpty)
              _thanhDanhMuc(),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? _errorView()
                      // BỐ CỤC DỌC 2/3 – 1/3.
                      //
                      // Trái: trang catalogue để khách vuốt lật như quyển sách
                      // thật — phần này cần chỗ rộng nhất vì ảnh sản phẩm là
                      // thứ khách nhìn để chọn.
                      //
                      // Phải: tên, giá, tồn và nút thêm vào giỏ. Tách hẳn sang
                      // một cột đứng yên thay vì hiện đè lên trang: khách vừa
                      // đọc thông tin vừa lật tiếp được, và nút "Thêm vào giỏ"
                      // luôn ở đúng một chỗ nên không phải đi tìm.
                      // GIAO DIỆN MENU QUYỂN self-order: book FULL-SCREEN, xem
                      // dọc + lật trang; chạm hàng hoặc bấm nút giỏ nổi thì panel
                      // sản phẩm/giỏ trượt từ phải (tái dùng _cotSanPham nguyên
                      // vẹn — panel nằm CÙNG cây widget nên rebuild theo setState).
                      : Stack(
                          children: [
                            Positioned.fill(
                              child: BookPageView(
                                book: _book,
                                serverUrl: serverUrl,
                                // Chấm điểm của quyển BÁN LẺ trỏ tới hàng hoá,
                                // không phải món F&B.
                                targetKey: 'sku_id',
                                onHotspotTap: _chonSku,
                                showHotspots: true,
                                controller: _dieuKhienQuyen,
                                onPageChanged: (p) => setState(() {
                                  _trang = p;
                                  _chon = null;
                                }),
                                bottomCenter: _nutXemChiTiet,
                              ),
                            ),
                            // Nút giỏ nổi góc phải dưới (như self-order) khi panel
                            // đang đóng.
                            if (_chon == null && !_panelGio)
                              Positioned(
                                right: 18,
                                bottom: 18,
                                child: FilledButton.icon(
                                  onPressed: () =>
                                      setState(() => _panelGio = true),
                                  icon: Badge(
                                    label: Text('$_cartCount'),
                                    isLabelVisible: _cartCount > 0,
                                    child: const Icon(
                                        Icons.shopping_cart_outlined),
                                  ),
                                  label: Text(
                                      '${t('Giỏ hàng')} · ${Fmt.money(_cartTotal)}'),
                                  style: FilledButton.styleFrom(
                                    backgroundColor: DanColors.brand,
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 18, vertical: 14),
                                    shape: RoundedRectangleBorder(
                                        borderRadius:
                                            BorderRadius.circular(999)),
                                  ),
                                ),
                              ),
                            // Panel sản phẩm/giỏ trượt từ phải.
                            if (_chon != null || _panelGio)
                              Positioned(
                                top: 0,
                                bottom: 0,
                                right: 0,
                                width: (MediaQuery.of(context).size.width * .42)
                                    .clamp(300.0, 420.0),
                                child: Material(
                                  elevation: 12,
                                  color: DanColors.surface,
                                  child: Column(
                                    children: [
                                      Align(
                                        alignment: Alignment.centerLeft,
                                        child: IconButton(
                                          icon: const Icon(Icons.close),
                                          tooltip: t('Đóng'),
                                          onPressed: () => setState(() {
                                            _chon = null;
                                            _panelGio = false;
                                          }),
                                        ),
                                      ),
                                      Expanded(child: _cotSanPham()),
                                    ],
                                  ),
                                ),
                              ),
                          ],
                        ),
            ),
          ],
        ),
      ),
    );
  }

  /// NÚT "XEM CHI TIẾT SẢN PHẨM" ở đáy giữa tấm hình.
  ///
  /// Thay cho việc chạm chỗ nào cũng lật/mở: khách vuốt để lật, bấm đúng nút
  /// này mới mở thông tin sang cột phải. Trang chưa gắn hàng hoá nào thì không
  /// vẽ nút — hiện một nút bấm vào không ra gì còn tệ hơn là không có nút.
  Widget? _nutXemChiTiet(int page) {
    final sku = _skuCuaTrang(page);
    if (sku == null) return null;
    return FilledButton.icon(
      onPressed: () => setState(() => _chon = sku),
      icon: const Icon(Icons.info_outline, size: 17),
      label: Text(t('Xem chi tiết sản phẩm'),
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
      style: FilledButton.styleFrom(
        backgroundColor: Colors.black.withValues(alpha: .62),
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      ),
    );
  }

  /// Hàng hoá gắn với một trang — lấy chấm điểm ĐẦU TIÊN của trang đó. Quản lý
  /// gắn nhiều chấm trên một trang thì cái đầu là cái họ đặt trước, cũng là
  /// mặt hàng chính của trang.
  Sku? _skuCuaTrang(int page) {
    for (final h in (_book['hotspots'] as List? ?? const [])) {
      if (h is! Map) continue;
      if ((h['page'] as num?)?.toInt() != page) continue;
      if (h['enabled'] == false) continue;
      final sku = _skus['${h['sku_id'] ?? ''}'];
      if (sku != null) return sku;
    }
    return null;
  }

  /// THANH DANH MỤC — chia quyển thành từng mục để khách khỏi lật hết.
  ///
  /// Mục nào cũng gắn với TRANG ĐẦU của nó; bấm là mở thẳng tới đó, không chạy
  /// hiệu ứng lật qua hai chục trang. Mục đang xem được tô đậm để khách biết
  /// mình đang ở đâu trong quyển.
  Widget _thanhDanhMuc() {
    // Mục "đang xem" = mục cuối cùng có trang đầu <= trang hiện tại. Lật tay
    // sang trang giữa mục thì thanh vẫn phải sáng đúng mục đó.
    int dangXem = -1;
    for (var i = 0; i < _danhMuc.length; i++) {
      final p = (_danhMuc[i]['page'] as num?)?.toInt() ?? 0;
      if (p <= _trang) dangXem = i;
    }
    return Container(
      height: 52,
      color: DanColors.surface,
      child: Column(
        children: [
          Expanded(
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              itemCount: _danhMuc.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, i) {
                final m = _danhMuc[i];
                final chon = i == dangXem;
                return ChoiceChip(
                  selected: chon,
                  showCheckmark: false,
                  label: Text('${m['name'] ?? ''}',
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: chon ? Colors.white : DanColors.text)),
                  selectedColor: DanColors.brand,
                  backgroundColor: DanColors.surface2,
                  onSelected: (_) => _dieuKhienQuyen
                      .moTrang((m['page'] as num?)?.toInt() ?? 0),
                );
              },
            ),
          ),
          const Divider(height: 1, color: DanColors.border),
        ],
      ),
    );
  }

  Widget _errorView() => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.menu_book_outlined,
                  size: 48, color: DanColors.faint),
              const SizedBox(height: 12),
              Text(_error ?? '',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: DanColors.muted)),
              const SizedBox(height: 16),
              FilledButton(onPressed: _load, child: Text(t('Thử lại'))),
            ],
          ),
        ),
      );

  Widget _topBar() {
    final welcome = '${_config['welcomeText'] ?? ''}';
    return Container(
      height: 62,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      color: DanColors.surface,
      child: Row(
        children: [
          // Logo = cửa thoát. Bấm 3 lần rồi nhập mật khẩu — khách chạm bình
          // thường sẽ không bao giờ mở được.
          InkWell(
            onTap: _onLogoTap,
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.all(6),
              child: Image.asset('assets/brand/DanOnLogo.png',
                  height: 34,
                  errorBuilder: (_, __, ___) => const Icon(Icons.storefront,
                      size: 30, color: DanColors.brand)),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // TÊN MÁY hiện cho cả khách lẫn nhân viên nhìn thấy — khách đọc
                // để báo "tôi đứng ở Kệ hạt điều", nhân viên đối chiếu với tab.
                Text(_deviceName.isEmpty ? t('Catalogue') : _deviceName,
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w900)),
                if (welcome.isNotEmpty)
                  Text(welcome,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 11.5, color: DanColors.muted)),
              ],
            ),
          ),
          // Khách mặc định là "Bán cho người tiêu dùng"; bấm vào đây để nhập
          // thông tin nếu cần hoá đơn. Tên nhập xong hiện nhỏ dưới tên máy ở POS.
          TextButton.icon(
            onPressed: _openCustomerForm,
            icon: const Icon(Icons.person_outline, size: 18),
            label: Text(
                _customer?.name.trim().isNotEmpty == true
                    ? _customer!.name
                    : t('Bán cho người tiêu dùng'),
                style: const TextStyle(fontSize: 12.5)),
          ),
        ],
      ),
    );
  }

  /// CỘT PHẢI — thông tin sản phẩm đang chọn + nút thêm vào giỏ.
  ///
  /// Dữ liệu lấy từ CHÍNH danh mục bán lẻ (`/api/skus`, kênh retail) mà POS đang
  /// dùng, nên giá và tồn luôn khớp với quầy — không có nguồn giá thứ hai để
  /// lệch nhau. Nút thêm vào giỏ gắn thẳng vào mã hàng trong kho.
  Widget _cotSanPham() {
    final sku = _chon;
    final base =
        context.read<AuthProvider>().serverUrl.replaceFirst(RegExp(r'/$'), '');
    return Container(
      color: DanColors.surface,
      child: Column(
        children: [
          Expanded(
            child: sku == null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.touch_app_outlined,
                              size: 44, color: DanColors.faint),
                          const SizedBox(height: 12),
                          Text(t('Vuốt để lật trang. Bấm "Xem chi tiết sản phẩm" ở đáy trang để xem thông tin.'),
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                  color: DanColors.muted, height: 1.5)),
                        ],
                      ),
                    ),
                  )
                : ListView(
                    padding: const EdgeInsets.fromLTRB(16, 18, 16, 12),
                    children: [
                      if (sku.image.isNotEmpty)
                        ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: Image.network(
                            sku.image.startsWith('http')
                                ? sku.image
                                : '$base${sku.image}',
                            height: 200,
                            fit: BoxFit.contain,
                            errorBuilder: (_, __, ___) => const SizedBox(),
                          ),
                        ),
                      const SizedBox(height: 14),
                      Text(sku.name,
                          style: const TextStyle(
                              fontSize: 19,
                              fontWeight: FontWeight.w900,
                              height: 1.3)),
                      const SizedBox(height: 10),
                      Text(Fmt.money(sku.price),
                          style: const TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.w900,
                              color: DanColors.brand)),
                      const SizedBox(height: 14),
                      // Giới thiệu sản phẩm — thứ khách đọc để quyết định. Đặt
                      // TRÊN các dòng thông số vì nó là phần đáng đọc nhất.
                      if (sku.description.isNotEmpty) ...[
                        Text(sku.description,
                            style: const TextStyle(
                                fontSize: 13,
                                height: 1.55,
                                color: DanColors.text)),
                        const SizedBox(height: 14),
                      ],
                      if (sku.category.isNotEmpty)
                        _dongTin(t('Nhóm hàng'), sku.category),
                      if (sku.unit.isNotEmpty) _dongTin(t('Đơn vị'), sku.unit),
                      // Nói thật về tồn kho. Khách chọn xong ra quầy mới biết
                      // hết hàng là trải nghiệm tệ hơn hẳn việc biết ngay ở đây.
                      _dongTin(t('Tình trạng'),
                          sku.stock > 0 ? t('Còn hàng') : t('Tạm hết hàng')),
                    ],
                  ),
          ),
          if (sku != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: sku.stock > 0 ? () => _addSku(sku.id) : null,
                  icon: const Icon(Icons.add_shopping_cart),
                  label: Text(
                      sku.stock > 0 ? t('Thêm vào giỏ') : t('Tạm hết hàng')),
                  style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 52),
                      textStyle: const TextStyle(
                          fontSize: 15, fontWeight: FontWeight.w900)),
                ),
              ),
            ),
          const Divider(height: 1, color: DanColors.border),
          // GIỎ HÀNG + THANH TOÁN luôn nằm ở đáy cột phải, cùng một chỗ suốt
          // phiên. Khách thêm xong món đầu tiên là thấy ngay nút thanh toán,
          // không phải đi tìm — giống hệt cách self-order F&B đang làm.
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            child: Column(
              children: [
                SizedBox(width: double.infinity, child: _cartButton()),
                if (_cart.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _openCheckout,
                      icon: const Icon(Icons.point_of_sale),
                      label:
                          Text('${t('Thanh toán')} · ${Fmt.money(_cartTotal)}'),
                      style: FilledButton.styleFrom(
                        backgroundColor: DanColors.done,
                        minimumSize: const Size(0, 54),
                        textStyle: const TextStyle(
                            fontSize: 15.5, fontWeight: FontWeight.w900),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _dongTin(String nhan, String giaTri) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 92,
              child: Text(nhan,
                  style:
                      const TextStyle(fontSize: 12.5, color: DanColors.muted)),
            ),
            Expanded(
              child: Text(giaTri,
                  style: const TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      );

  Widget _cartButton() => FilledButton.icon(
        onPressed: _openCart,
        icon: Badge(
          label: Text('$_cartCount'),
          isLabelVisible: _cartCount > 0,
          child: const Icon(Icons.shopping_cart_outlined),
        ),
        label: Text('${t('Giỏ hàng')} · ${Fmt.money(_cartTotal)}'),
        style: FilledButton.styleFrom(
          backgroundColor: DanColors.brand,
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        ),
      );

  // ── Giỏ hàng chi tiết ─────────────────────────────────────────────────────

  void _openCart() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: DanColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (_) => StatefulBuilder(
        builder: (c, setSheet) => DraggableScrollableSheet(
          expand: false,
          initialChildSize: .7,
          maxChildSize: .92,
          builder: (_, scroll) => Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(t('Giỏ hàng'),
                          style: const TextStyle(
                              fontSize: 17, fontWeight: FontWeight.w900)),
                    ),
                    IconButton(
                        onPressed: () => Navigator.of(c).pop(),
                        icon: const Icon(Icons.close)),
                  ],
                ),
              ),
              Expanded(
                child: _cart.isEmpty
                    ? Center(
                        child: Text(t('Chưa chọn sản phẩm nào'),
                            style: const TextStyle(color: DanColors.faint)))
                    : ListView.separated(
                        controller: scroll,
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        itemCount: _cart.length,
                        separatorBuilder: (_, __) =>
                            const Divider(height: 1, color: DanColors.border),
                        itemBuilder: (_, i) {
                          final l = _cart[i];
                          return ListTile(
                            title: Text(l.sku.name,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w700)),
                            subtitle: Text(Fmt.money(l.sku.price)),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                IconButton(
                                  onPressed: () {
                                    _setQty(i, l.qty - 1);
                                    setSheet(() {});
                                  },
                                  icon: const Icon(Icons.remove_circle_outline),
                                ),
                                Text('${l.qty}',
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w900)),
                                IconButton(
                                  onPressed: () {
                                    _setQty(i, l.qty + 1);
                                    setSheet(() {});
                                  },
                                  icon: const Icon(Icons.add_circle_outline),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
              ),
              Container(
                padding: const EdgeInsets.fromLTRB(18, 12, 18, 20),
                decoration: const BoxDecoration(
                  border: Border(top: BorderSide(color: DanColors.border)),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(t('Tổng cộng'),
                              style: const TextStyle(
                                  fontSize: 12, color: DanColors.muted)),
                          Text(Fmt.money(_cartTotal),
                              style: const TextStyle(
                                  fontSize: 20, fontWeight: FontWeight.w900)),
                        ],
                      ),
                    ),
                    FilledButton(
                      onPressed: _cart.isEmpty
                          ? null
                          : () {
                              Navigator.of(c).pop();
                              _openCheckout();
                            },
                      style: FilledButton.styleFrom(
                          minimumSize: const Size(150, 48)),
                      child: Text(t('Thanh toán')),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Thông tin khách ───────────────────────────────────────────────────────

  /// CHỌN KHÁCH — dùng đúng hộp thoại của quầy bán lẻ.
  ///
  /// Bản trước tự dựng ba ô tên/SĐT/MST: khách đã có hồ sơ trong hệ thống vẫn
  /// bị gõ tay lại, mất điểm tích luỹ và ưu đãi, mà quầy còn phải dọn hồ sơ
  /// trùng về sau. Giờ dùng chung CustomerPickerDialog — tìm khách cũ hoặc thêm
  /// mới bằng đúng biểu mẫu quầy đang dùng, không có đường thứ hai.
  Future<void> _openCustomerForm() async {
    final picked = await showDialog<Object?>(
      context: context,
      builder: (_) => CustomerPickerDialog(
        api: _api,
        // Máy khách không giữ sẵn danh sách khách trong bộ nhớ — hộp thoại tự
        // hỏi server khi gõ, nên để trống là đúng.
        customers: const [],
        selected: _customer,
      ),
    );
    if (picked == null || !mounted) return;
    setState(() => _customer = picked is RetailCustomer ? picked : null);
    await _pushCart();
    if (mounted && _customer != null) {
      _toast(t('Đã gửi thông tin tới quầy'));
    }
  }

  // ── Thanh toán ────────────────────────────────────────────────────────────

  List<String> get _methods =>
      (_config['methods'] as List? ?? const ['qr', 'cash'])
          .map((e) => '$e')
          .toList();

  String _methodLabel(String m) => switch (m) {
        'qr' => t('Chuyển khoản / QR'),
        'cash' => t('Tiền mặt tại quầy'),
        'card' => t('Thẻ tại quầy'),
        _ => m,
      };

  Future<void> _openCheckout() async {
    final chon = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(t('Chọn hình thức thanh toán')),
        content: SizedBox(
          width: 400,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final m in _methods)
                ListTile(
                  leading: Icon(m == 'qr'
                      ? Icons.qr_code_2
                      : m == 'card'
                          ? Icons.credit_card
                          : Icons.payments_outlined),
                  title: Text(_methodLabel(m)),
                  onTap: () => Navigator.of(c).pop(m),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(c).pop(),
              child: Text(t('Quay lại'))),
        ],
      ),
    );
    if (chon == null || !mounted) return;

    // Chuyển khoản: server dựng đơn nháp mở + QR động tự đối soát (đã bật cờ đỏ
    // báo POS bên trong /catalogue/checkout), rồi poll tới khi tiền về.
    if (chon == 'qr') {
      await _thanhToanChuyenKhoan();
      return;
    }

    // Tiền mặt/thẻ: báo POS đỏ TRƯỚC rồi mời khách chờ nhân viên tới thu.
    try {
      await _api.catalogueRequestPayment(chon);
    } catch (e) {
      if (!mounted) return;
      _toast(e.toString().replaceFirst('Exception: ', ''));
      return;
    }
    if (!mounted) return;
    _showWaitStaff();
  }

  /// CHUYỂN KHOẢN QR ĐỘNG — tự đối soát (bê nguyên cơ chế POS/self-order).
  ///
  /// Server dựng đơn nháp mở từ giỏ + sinh QR theo bill; webhook SePay/payOS tự
  /// khớp tiền và đóng bill. Máy khách chỉ hiện QR và poll trạng thái, tiền về
  /// là cảm ơn + xoá giỏ. Nhân viên vẫn thấy tab đỏ ở POS để đối soát.
  Future<void> _thanhToanChuyenKhoan() async {
    final reqId = 'cat_${DateTime.now().microsecondsSinceEpoch}';
    Map<String, dynamic> res;
    try {
      res = await _api.catalogueCheckout('qr', reqId);
    } catch (e) {
      if (!mounted) return;
      _toast(e.toString().replaceFirst('Exception: ', ''));
      return;
    }
    if (!mounted) return;

    final orderId = '${res['order_id'] ?? ''}';
    final qr = res['qr'] is Map
        ? (res['qr'] as Map).map((k, v) => MapEntry('$k', v))
        : <String, dynamic>{};
    final base =
        context.read<AuthProvider>().serverUrl.replaceFirst(RegExp(r'/$'), '');
    final img = '${qr['imageUrl'] ?? ''}';
    final bankLine =
        '${qr['bankName'] ?? ''} · ${qr['bankAccountMasked'] ?? qr['bankAccount'] ?? ''}';
    final holder = '${qr['userBankName'] ?? ''}';

    var paid = false;
    BuildContext? dialogCtx;
    Timer? poll;
    if (orderId.isNotEmpty) {
      poll = Timer.periodic(const Duration(seconds: 3), (tmr) async {
        try {
          final st = await _api.catalogueOrderStatus(orderId);
          if (st['paid'] == true) {
            paid = true;
            tmr.cancel();
            final dc = dialogCtx;
            if (dc != null && Navigator.of(dc).canPop()) Navigator.of(dc).pop();
          }
        } catch (_) {
          // Mạng chập chờn — lần poll sau thử lại.
        }
      });
    }

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (c) {
        dialogCtx = c;
        return AlertDialog(
          title: Text(t('Quét mã để chuyển khoản')),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(Fmt.money(_cartTotal),
                    style: const TextStyle(
                        fontSize: 26, fontWeight: FontWeight.w900)),
                const SizedBox(height: 12),
                if (img.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 24),
                    child: Text(
                        t('Không tạo được mã QR — mời thanh toán tại quầy.'),
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: DanColors.late)),
                  )
                else
                  Image.network(
                    img.startsWith('http') ? img : '$base$img',
                    height: 300,
                    fit: BoxFit.contain,
                    errorBuilder: (_, __, ___) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 24),
                      child: Text(
                          t('Không tải được mã QR — mời thanh toán tại quầy.'),
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: DanColors.late)),
                    ),
                  ),
                const SizedBox(height: 10),
                Text('$bankLine\n$holder',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        fontSize: 12.5, color: DanColors.muted, height: 1.4)),
                const SizedBox(height: 10),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2)),
                    const SizedBox(width: 8),
                    Text(t('Đang chờ xác nhận chuyển khoản...'),
                        style: const TextStyle(
                            fontSize: 12.5, color: DanColors.muted)),
                  ],
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.of(c).pop(), child: Text(t('Đóng'))),
          ],
        );
      },
    );
    poll?.cancel();
    if (paid && mounted) _camOnVaXoaGio();
  }

  /// Thanh toán thành công: cảm ơn + xoá giỏ (đẩy giỏ rỗng để POS hết cờ đỏ).
  void _camOnVaXoaGio() {
    setState(() {
      _cart.clear();
      _chon = null;
    });
    _pushCart();
    showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(t('Cảm ơn quý khách!')),
        content: Text(t('Thanh toán thành công. Hẹn gặp lại quý khách.'),
            style: const TextStyle(height: 1.5)),
        actions: [
          FilledButton(
              onPressed: () => Navigator.of(c).pop(), child: Text(t('Đóng'))),
        ],
      ),
    );
  }

  void _showWaitStaff() {
    showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(t('Mời quý khách chờ trong giây lát')),
        content: Text(
            t('Nhân viên sẽ tới hỗ trợ thanh toán. Tổng cộng: ${Fmt.money(_cartTotal)}'),
            style: const TextStyle(height: 1.5)),
        actions: [
          FilledButton(
              onPressed: () => Navigator.of(c).pop(),
              child: Text(t('Đã hiểu'))),
        ],
      ),
    );
  }
}
