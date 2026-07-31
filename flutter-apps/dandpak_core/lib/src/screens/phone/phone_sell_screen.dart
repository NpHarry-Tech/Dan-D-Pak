import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/retail_models.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../services/black_box.dart';
import '../../services/system_log.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'phone_kit.dart';

/// LUỒNG BÁN LẺ BẢN ĐIỆN THOẠI: chọn hàng → giỏ → thanh toán → hoàn tất.
///
/// Toàn bộ dữ liệu là DỮ LIỆU THẬT của hệ thống, dùng đúng các endpoint mà bản
/// desktop/tablet đang chạy:
///   - `GET  /api/skus`            (getSkusPaginated)   danh sách hàng theo kênh retail
///   - `GET  /api/skus/barcode/:c` (getSkuByBarcode)    quét mã vạch
///   - `GET  /api/shifts/current`  (getCurrentShift)    chặn bán khi chưa mở ca
///   - `POST /api/retail/checkout` (retailCheckout)     chốt đơn + thu tiền
/// KHÔNG có dữ liệu mẫu nào trong file này.
///
/// Bố cục theo kỷ luật một tay: thao tác chính luôn ở [PhoneActionBar] ghim đáy,
/// bàn phím tiền nằm nửa dưới màn, mọi vùng chạm ≥ 44px.
class PhoneSellScreen extends StatefulWidget {
  const PhoneSellScreen({super.key});

  @override
  State<PhoneSellScreen> createState() => _PhoneSellScreenState();
}

enum _Step { sell, cart, pay, done }

class _PhoneSellScreenState extends State<PhoneSellScreen> {
  _Step _step = _Step.sell;

  final _searchCtrl = TextEditingController();
  Timer? _debounce;

  List<Sku> _skus = [];
  bool _loading = true;
  String? _error;
  bool _inStockOnly = false;
  String _sort = '';

  final List<CartLine> _cart = [];

  // Ca làm việc — chưa mở ca thì KHÔNG cho thanh toán (giống desktop).
  Map<String, dynamic>? _shift;
  bool _shiftChecked = false;

  String _method = 'cash';
  String _cashInput = '';
  bool _paying = false;

  Map<String, dynamic>? _receipt;

  /// Khóa chống gửi trùng — giữ NGUYÊN cho tới khi đơn chốt xong, để bấm lại
  /// vì mạng chậm không tạo hóa đơn thứ hai (server dùng client_request_id).
  String _requestId = _newRequestId();

  static String _newRequestId() =>
      'ph-${DateTime.now().microsecondsSinceEpoch}';

  @override
  void initState() {
    super.initState();
    _load();
    _loadShift();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  ApiService get _api => context.read<ApiService>();

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await _api.getSkusPaginated(
        page: 1,
        limit: 60,
        q: _searchCtrl.text.trim(),
        inStockOnly: _inStockOnly,
        sort: _sort,
      );
      final raw = (res['items'] ?? res['skus'] ?? res['data']) as List? ?? [];
      if (!mounted) return;
      setState(() {
        _skus = raw
            .whereType<Map>()
            .map((e) => Sku.fromJson(Map<String, dynamic>.from(e)))
            .toList();
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _loadShift() async {
    try {
      final s = await _api.getCurrentShift();
      if (!mounted) return;
      setState(() {
        _shift = s;
        _shiftChecked = true;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _shiftChecked = true);
    }
  }

  bool get _shiftOpen {
    final s = _shift;
    if (s == null) return false;
    final status = '${s['status'] ?? ''}';
    if (status.isNotEmpty) return status == 'open';
    return '${s['id'] ?? ''}'.isNotEmpty && s['closed_at'] == null;
  }

  void _onSearch(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 320), _load);
  }

  // ── Giỏ hàng ─────────────────────────────────────────────────────────────
  void _add(Sku s) {
    if (s.stock <= 0) return;
    setState(() {
      final i = _cart.indexWhere((l) => l.sku.id == s.id);
      if (i >= 0) {
        // Không cho vượt tồn khả dụng — server cũng chặn, nhưng chặn sớm ở đây
        // để thu ngân biết ngay thay vì lỗi lúc chốt đơn.
        _cart[i].qty = (_cart[i].qty + 1).clamp(1, s.stock.toInt());
      } else {
        _cart.add(CartLine(s, 1));
      }
    });
  }

  void _bump(CartLine l, int d) {
    setState(() {
      final next = l.qty + d;
      if (next <= 0) {
        _cart.remove(l);
      } else {
        l.qty = next.clamp(1, l.sku.stock.toInt() <= 0 ? 1 : l.sku.stock.toInt());
      }
    });
  }

  num get _subtotal =>
      _cart.fold<num>(0, (a, l) => a + l.sku.price * l.qty);

  int get _cartCount => _cart.fold<int>(0, (a, l) => a + l.qty);

  num get _cash => num.tryParse(_cashInput) ?? 0;
  num get _change => _cash - _subtotal;

  // ── Thanh toán THẬT ──────────────────────────────────────────────────────
  Future<void> _confirm() async {
    if (_cart.isEmpty || _paying) return;
    if (!_shiftOpen) {
      appToast(context, t('Chưa mở ca — không thể thu tiền.'), isError: true);
      return;
    }
    if (_method == 'cash' && _change < 0) return;

    setState(() => _paying = true);
    try {
      final receipt = await SystemLog.runFlow('checkout', () async {
        return _api.retailCheckout({
          'items': [
            for (final l in _cart)
              {'sku_id': l.sku.id, 'qty': l.qty, 'lot_id': l.lotId},
          ],
          'payments': [
            PaymentLine(method: _method, amount: _subtotal).toJson(),
          ],
          // Cùng khóa chống trùng với bản desktop — bấm lại do mạng chậm KHÔNG
          // tạo hóa đơn thứ hai.
          'client_request_id': _requestId,
        });
      });
      if (!mounted) return;

      final orderId = '${receipt['id'] ?? receipt['order_id'] ?? ''}';
      final billNo = '${receipt['bill_no'] ?? receipt['number'] ?? ''}';
      setState(() {
        _receipt = Map<String, dynamic>.from(receipt);
        _paying = false;
        _step = _Step.done;
      });

      // In bill chạy nền — KHÔNG chặn màn hình. Máy in chậm/mất kết nối không
      // được giữ thu ngân lại khi tiền đã nhận đủ.
      if (receipt['idempotent_replay'] != true &&
          receipt['fully_settled'] != false) {
        unawaited(_api
            .forcePrintReceiptJob(orderId: orderId, billNo: billNo)
            .then((err) {
          if (err != null && err.isNotEmpty && mounted) {
            appToast(context, t('Đã thu tiền, nhưng chưa in được: $err'),
                isError: true);
          }
        }).catchError((Object e) {
          // TIỀN ĐÃ THU XONG rồi mới tới lượt in. Nên bất kỳ trục trặc nào ở
          // nhánh in — kể cả việc HIỂN THỊ thông báo lỗi in thất bại — cũng
          // tuyệt đối không được ném ngược ra làm hỏng màn bán hàng. Ghi hộp
          // đen để còn truy được, rồi thôi.
          BlackBox.add('print', 'nhanh in nen loi sau thanh toan: $e');
        }));
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _paying = false);
      appToast(context, e.toString().replaceFirst('Exception: ', ''),
          isError: true);
    }
  }

  void _startNewSale() {
    setState(() {
      _cart.clear();
      _cashInput = '';
      _method = 'cash';
      _receipt = null;
      _requestId = _newRequestId();
      _step = _Step.sell;
    });
    _loadShift();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: switch (_step) {
          _Step.sell => _buildSell(),
          _Step.cart => _buildCart(),
          _Step.pay => _buildPay(),
          _Step.done => _buildDone(),
        },
      ),
    );
  }

  // ── Màn BÁN LẺ ───────────────────────────────────────────────────────────
  Widget _buildSell() {
    final auth = context.watch<AuthProvider>();
    return Column(
      children: [
        Container(
          color: DanColors.surface,
          child: Column(
            children: [
              PhoneHeader(
                title: t('Bán lẻ'),
                subtitle: _shiftChecked
                    ? (_shiftOpen
                        ? t('Ca đang mở · ${auth.currentUser?.name ?? ''}')
                        : t('Chưa mở ca — không thu tiền được'))
                    : t('Đang kiểm tra ca…'),
                subtitleColor: _shiftChecked && !_shiftOpen
                    ? DanColors.late
                    : (_shiftOpen ? const Color(0xFF047857) : null),
                actions: [
                  PhoneIconButton(
                      icon: Icons.refresh, onTap: () {
                    _load();
                    _loadShift();
                  }),
                ],
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Container(
                        height: 46,
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        decoration: BoxDecoration(
                          color: DanColors.surface2,
                          border: Border.all(color: DanColors.border),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.search,
                                size: 18, color: DanColors.faint),
                            const SizedBox(width: 9),
                            Expanded(
                              child: TextField(
                                controller: _searchCtrl,
                                onChanged: _onSearch,
                                onSubmitted: (_) => _load(),
                                textInputAction: TextInputAction.search,
                                decoration: InputDecoration(
                                  isDense: true,
                                  border: InputBorder.none,
                                  enabledBorder: InputBorder.none,
                                  focusedBorder: InputBorder.none,
                                  filled: false,
                                  contentPadding: EdgeInsets.zero,
                                  hintText: t('Tên, mã hàng hoặc mã vạch'),
                                  hintStyle: const TextStyle(
                                      fontSize: 13.5,
                                      fontWeight: FontWeight.w600,
                                      color: DanColors.faint),
                                ),
                                style: const TextStyle(
                                    fontSize: 13.5,
                                    fontWeight: FontWeight.w600),
                              ),
                            ),
                            if (_searchCtrl.text.isNotEmpty)
                              InkWell(
                                onTap: () {
                                  _searchCtrl.clear();
                                  _load();
                                },
                                child: const Icon(Icons.close,
                                    size: 17, color: DanColors.faint),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Row(
                  children: [
                    PhoneChip(
                      label: t('Còn hàng'),
                      active: _inStockOnly,
                      onTap: () {
                        setState(() => _inStockOnly = !_inStockOnly);
                        _load();
                      },
                    ),
                    const SizedBox(width: 8),
                    PhoneChip(
                      label: _sortLabel(),
                      active: _sort.isNotEmpty,
                      caret: true,
                      onTap: _pickSort,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        Expanded(child: _buildSkuGrid()),
        if (_cart.isNotEmpty)
          PhoneActionBar(
            child: PhoneCta(
              label: t('Giỏ hàng · $_cartCount món'),
              trailing: phoneMoney(_subtotal),
              onPressed: () => setState(() => _step = _Step.cart),
            ),
          ),
      ],
    );
  }

  String _sortLabel() => switch (_sort) {
        'price_asc' => t('Giá thấp → cao'),
        'price_desc' => t('Giá cao → thấp'),
        'name' => t('Tên A–Z'),
        _ => t('Sắp xếp'),
      };

  Future<void> _pickSort() async {
    const map = {
      'Mới nhất': '',
      'Giá thấp → cao': 'price_asc',
      'Giá cao → thấp': 'price_desc',
      'Tên A–Z': 'name',
    };
    await showPhoneSheet<void>(
      context: context,
      title: t('Sắp xếp'),
      builder: (ctx) => PhonePickList(
        options: map.keys.map(t).toList(),
        selected: map.entries
            .firstWhere((e) => e.value == _sort,
                orElse: () => const MapEntry('Mới nhất', ''))
            .key,
        onPick: (v) {
          Navigator.of(ctx).pop();
          setState(() => _sort = map[v] ?? '');
          _load();
        },
      ),
    );
  }

  Widget _buildSkuGrid() {
    if (_loading && _skus.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _skus.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: InlineMessage(t('Không tải được hàng hóa ($_error)'),
            error: true, onRetry: _load),
      );
    }
    if (_skus.isEmpty) {
      return PhoneEmpty(
          title: t('Không tìm thấy hàng hóa'),
          hint: t('Thử đổi từ khóa hoặc bỏ bộ lọc'));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: GridView.builder(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: .78,
        ),
        itemCount: _skus.length,
        itemBuilder: (_, i) => _SkuCard(
          sku: _skus[i],
          qtyInCart: _cart
              .where((l) => l.sku.id == _skus[i].id)
              .fold<int>(0, (a, l) => a + l.qty),
          onTap: () => _add(_skus[i]),
        ),
      ),
    );
  }

  // ── Màn GIỎ HÀNG ─────────────────────────────────────────────────────────
  Widget _buildCart() {
    return Column(
      children: [
        PhoneHeader(
          title: t('Giỏ hàng'),
          subtitle: t('${_cart.length} mặt hàng'),
          onBack: () => setState(() => _step = _Step.sell),
          actions: [
            if (_cart.isNotEmpty)
              PhoneIconButton(
                icon: Icons.delete_outline,
                color: DanColors.late,
                onTap: () => setState(_cart.clear),
              ),
          ],
        ),
        Expanded(
          child: _cart.isEmpty
              ? PhoneEmpty(
                  title: t('Giỏ hàng đang trống'),
                  hint: t('Chạm sản phẩm để thêm vào giỏ'),
                  icon: Icons.shopping_cart_outlined)
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                  children: [
                    for (final l in _cart)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _CartRowCard(
                          line: l,
                          onMinus: () => _bump(l, -1),
                          onPlus: () => _bump(l, 1),
                          onDelete: () => setState(() => _cart.remove(l)),
                        ),
                      ),
                    const SizedBox(height: 6),
                    PhoneKv(t('Tạm tính'), phoneMoney(_subtotal)),
                    Container(
                        height: 2,
                        color: DanColors.text,
                        margin: const EdgeInsets.symmetric(vertical: 10)),
                    PhoneKv(t('TỔNG CỘNG'), phoneMoney(_subtotal), big: true),
                  ],
                ),
        ),
        if (_cart.isNotEmpty)
          PhoneActionBar(
            child: PhoneCta(
              label: t('Thanh toán'),
              trailing: phoneMoney(_subtotal),
              onPressed: () => setState(() => _step = _Step.pay),
            ),
          ),
      ],
    );
  }

  // ── Màn THANH TOÁN ───────────────────────────────────────────────────────
  Widget _buildPay() {
    const methods = [
      ('cash', 'Tiền mặt', Icons.payments_outlined),
      ('bank_transfer', 'Chuyển khoản', Icons.account_balance_outlined),
      ('card', 'Thẻ', Icons.credit_card),
    ];
    final canPay = _shiftOpen && (_method != 'cash' || _change >= 0);

    return Column(
      children: [
        PhoneHeader(
          title: t('Thanh toán'),
          subtitle: t('${_cart.length} mặt hàng'),
          onBack: () => setState(() => _step = _Step.cart),
        ),
        Container(
          width: double.infinity,
          color: DanColors.surface,
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(t('KHÁCH CẦN TRẢ'),
                  style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      letterSpacing: .07 * 11,
                      color: DanColors.muted)),
              const SizedBox(height: 4),
              Text(phoneMoney(_subtotal),
                  style: const TextStyle(
                      fontSize: 34,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -.6,
                      fontFeatures: [FontFeature.tabularFigures()])),
            ],
          ),
        ),
        Container(
          decoration: const BoxDecoration(
            color: DanColors.surface,
            border: Border(
              top: BorderSide(color: DanColors.border),
              bottom: BorderSide(color: DanColors.border),
            ),
          ),
          child: Row(
            children: [
              for (final (k, label, icon) in methods)
                Expanded(
                  child: InkWell(
                    onTap: () => setState(() => _method = k),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 11),
                      decoration: BoxDecoration(
                        color: _method == k
                            ? const Color(0xFFE4F5F9)
                            : DanColors.surface,
                        border: Border(
                          top: BorderSide(
                              width: 2.5,
                              color: _method == k
                                  ? DanColors.brand
                                  : Colors.transparent),
                        ),
                      ),
                      child: Column(
                        children: [
                          Icon(icon,
                              size: 19,
                              color: _method == k
                                  ? DanColors.brandHover
                                  : DanColors.muted),
                          const SizedBox(height: 6),
                          Text(t(label),
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w800,
                                  height: 1.2,
                                  color: _method == k
                                      ? DanColors.brandHover
                                      : DanColors.muted)),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: _method == 'cash' ? _cashPad() : _nonCashPanel(),
        ),
        PhoneActionBar(
          child: Column(
            children: [
              PhoneCta(
                label: _method == 'cash'
                    ? t('Hoàn tất thanh toán')
                    : t('Xác nhận đã nhận tiền'),
                trailing: phoneMoney(_subtotal),
                busy: _paying,
                onPressed: canPay ? _confirm : null,
              ),
              if (!_shiftOpen)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(t('Chưa mở ca — mở ca ở bản desktop/tablet'),
                      style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: DanColors.late)),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _cashPad() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(t('KHÁCH ĐƯA'),
                      style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: DanColors.muted)),
                  const Spacer(),
                  InkWell(
                    onTap: () => setState(
                        () => _cashInput = _subtotal.round().toString()),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 4),
                      child: Text(t('Vừa đủ'),
                          style: const TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w800,
                              color: DanColors.brand)),
                    ),
                  ),
                ],
              ),
              Container(
                margin: const EdgeInsets.only(top: 4),
                padding: const EdgeInsets.only(bottom: 8),
                decoration: BoxDecoration(
                  border: Border(
                      bottom: BorderSide(
                          width: 2,
                          color: _cash > 0
                              ? DanColors.text
                              : DanColors.border2)),
                ),
                child: Text(_cash > 0 ? '${phoneInt(_cash)}đ' : '0đ',
                    style: TextStyle(
                        fontSize: 30,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -.5,
                        fontFeatures: const [FontFeature.tabularFigures()],
                        color:
                            _cash > 0 ? DanColors.text : DanColors.faint)),
              ),
              const SizedBox(height: 10),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: _change >= 0
                      ? const Color(0xFFE9FBF2)
                      : const Color(0xFFFFF1F1),
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Row(
                  children: [
                    Text(
                        _change >= 0
                            ? t('Tiền thừa trả khách')
                            : t('Còn thiếu'),
                        style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            color: _change >= 0
                                ? const Color(0xFF047857)
                                : const Color(0xFFD94A4A))),
                    const Spacer(),
                    Text(phoneMoney(_change.abs()),
                        style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            fontFeatures: const [
                              FontFeature.tabularFigures()
                            ],
                            color: _change >= 0
                                ? const Color(0xFF047857)
                                : const Color(0xFFD94A4A))),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final v in const [50000, 100000, 200000, 500000])
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: PhoneChip(
                          label: phoneInt(v),
                          onTap: () => setState(() =>
                              _cashInput = (_cash + v).round().toString()),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const Spacer(),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: PhoneNumPad(onKey: _cashKey),
        ),
        const SizedBox(height: 8),
      ],
    );
  }

  void _cashKey(String k) {
    setState(() {
      if (k == 'del') {
        _cashInput =
            _cashInput.isEmpty ? '' : _cashInput.substring(0, _cashInput.length - 1);
      } else {
        final next = _cashInput + k;
        // Chặn ở 10 chữ số — quá số này chắc chắn là bấm nhầm.
        if (next.length <= 10) _cashInput = next;
      }
    });
  }

  Widget _nonCashPanel() {
    return Padding(
      padding: const EdgeInsets.all(22),
      child: Column(
        children: [
          const Icon(Icons.qr_code_2, size: 120, color: DanColors.border2),
          const SizedBox(height: 14),
          Text(
              _method == 'bank_transfer'
                  ? t('Khách chuyển khoản rồi bấm xác nhận')
                  : t('Quẹt thẻ trên máy POS rồi bấm xác nhận'),
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 13, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Text(t('Số tiền: ${phoneMoney(_subtotal)}'),
              style: const TextStyle(
                  fontSize: 12, color: DanColors.muted)),
        ],
      ),
    );
  }

  // ── Màn HOÀN TẤT ─────────────────────────────────────────────────────────
  Widget _buildDone() {
    final r = _receipt ?? const {};
    final billNo = '${r['bill_no'] ?? r['number'] ?? ''}';
    final change = _method == 'cash' ? (_cash - _subtotal).clamp(0, 1 << 62) : 0;

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 34, 16, 16),
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: const BoxDecoration(
                    color: Color(0xFFE9FBF2), shape: BoxShape.circle),
                child: const Icon(Icons.check,
                    size: 30, color: Color(0xFF047857)),
              ),
              const SizedBox(height: 18),
              Text(t('Đã thu tiền'),
                  style: const TextStyle(
                      fontSize: 23, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text(
                  [
                    if (billNo.isNotEmpty) billNo,
                    context.read<AuthProvider>().currentUser?.name ?? '',
                  ].where((e) => e.isNotEmpty).join(' · '),
                  style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: DanColors.muted)),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: DanColors.surface2,
                  border: Border.all(color: DanColors.border),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  children: [
                    PhoneKv(t('Khách cần trả'), phoneMoney(_subtotal)),
                    if (_method == 'cash') ...[
                      PhoneKv(t('Khách đưa'), phoneMoney(_cash)),
                      PhoneKv(t('TIỀN THỪA'), phoneMoney(change),
                          big: true, valueColor: const Color(0xFF047857)),
                    ] else
                      PhoneKv(t('Hình thức'),
                          _method == 'card' ? t('Thẻ') : t('Chuyển khoản')),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              Text(
                  t('Bill được gửi tới máy in tự động. In lỗi KHÔNG tạo giao dịch thứ hai — vào Hóa đơn để in lại.'),
                  style: const TextStyle(
                      fontSize: 11.5, height: 1.55, color: DanColors.faint)),
            ],
          ),
        ),
        PhoneActionBar(
          child: PhoneCta(label: t('Bán tiếp'), onPressed: _startNewSale),
        ),
      ],
    );
  }
}

class _SkuCard extends StatelessWidget {
  final Sku sku;
  final int qtyInCart;
  final VoidCallback onTap;

  const _SkuCard(
      {required this.sku, required this.qtyInCart, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final out = sku.stock <= 0;
    return Opacity(
      opacity: out ? .55 : 1,
      child: Material(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          onTap: out ? null : onTap,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            decoration: BoxDecoration(
              border: Border.all(
                  color: qtyInCart > 0 ? DanColors.brand : DanColors.border),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  height: 84,
                  decoration: const BoxDecoration(
                    color: DanColors.surface2,
                    border:
                        Border(bottom: BorderSide(color: DanColors.border)),
                    borderRadius:
                        BorderRadius.vertical(top: Radius.circular(9)),
                  ),
                  child: Stack(
                    children: [
                      Center(
                        child: sku.image.isNotEmpty
                            ? ClipRRect(
                                borderRadius: const BorderRadius.vertical(
                                    top: Radius.circular(9)),
                                child: Image.network(sku.image,
                                    fit: BoxFit.cover,
                                    width: double.infinity,
                                    height: 84,
                                    errorBuilder: (_, __, ___) => const Icon(
                                        Icons.inventory_2_outlined,
                                        size: 30,
                                        color: Color(0xFFC6CEDA))),
                              )
                            : const Icon(Icons.inventory_2_outlined,
                                size: 30, color: Color(0xFFC6CEDA)),
                      ),
                      if (out)
                        Positioned(
                          top: 6,
                          left: 6,
                          child: PhoneBadge(t('Hết hàng'), tone: PhoneTone.bad),
                        ),
                      if (qtyInCart > 0)
                        Positioned(
                          top: 6,
                          left: 6,
                          child: Container(
                            constraints: const BoxConstraints(minWidth: 20),
                            height: 20,
                            padding: const EdgeInsets.symmetric(horizontal: 5),
                            decoration: BoxDecoration(
                                color: DanColors.brand,
                                borderRadius: BorderRadius.circular(99)),
                            alignment: Alignment.center,
                            child: Text('$qtyInCart',
                                style: const TextStyle(
                                    fontSize: 10.5,
                                    fontWeight: FontWeight.w800,
                                    color: Colors.white)),
                          ),
                        ),
                    ],
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(10, 9, 10, 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(sku.name,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w700,
                                  height: 1.3)),
                        ),
                        Text(phoneMoney(sku.price),
                            style: const TextStyle(
                                fontSize: 14.5,
                                fontWeight: FontWeight.w800,
                                color: DanColors.brand,
                                fontFeatures: [
                                  FontFeature.tabularFigures()
                                ])),
                        const SizedBox(height: 2),
                        Text(
                            '${t('Tồn')} ${phoneInt(sku.stock)} ${sku.unit}',
                            style: TextStyle(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w700,
                                color:
                                    out ? DanColors.late : DanColors.muted)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CartRowCard extends StatelessWidget {
  final CartLine line;
  final VoidCallback onMinus;
  final VoidCallback onPlus;
  final VoidCallback onDelete;

  const _CartRowCard(
      {required this.line,
      required this.onMinus,
      required this.onPlus,
      required this.onDelete});

  @override
  Widget build(BuildContext context) {
    final s = line.sku;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(s.name,
                        style: const TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w800,
                            height: 1.3)),
                    const SizedBox(height: 3),
                    Text('${phoneMoney(s.price)}/${s.unit}',
                        style: const TextStyle(
                            fontSize: 10.5, color: DanColors.faint)),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Text(phoneMoney(s.price * line.qty),
                  style: const TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w800,
                      color: DanColors.brand,
                      fontFeatures: [FontFeature.tabularFigures()])),
            ],
          ),
          Container(
            margin: const EdgeInsets.only(top: 10),
            padding: const EdgeInsets.only(top: 10),
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: DanColors.border)),
            ),
            child: Row(
              children: [
                _StepBtn(icon: Icons.remove, onTap: onMinus),
                SizedBox(
                  width: 52,
                  child: Text('${line.qty}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                          fontFeatures: [FontFeature.tabularFigures()])),
                ),
                _StepBtn(icon: Icons.add, onTap: onPlus),
                Expanded(
                  child: Text(
                      '${t('Tồn')} ${phoneInt(s.stock)}',
                      textAlign: TextAlign.right,
                      style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: DanColors.faint)),
                ),
                PhoneIconButton(
                    icon: Icons.delete_outline,
                    color: DanColors.faint,
                    onTap: onDelete),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StepBtn extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  const _StepBtn({required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: DanColors.surface,
      borderRadius: BorderRadius.circular(9),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(9),
        child: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            border: Border.all(color: DanColors.border2),
            borderRadius: BorderRadius.circular(9),
          ),
          child: Icon(icon, size: 18, color: DanColors.text),
        ),
      ),
    );
  }
}
