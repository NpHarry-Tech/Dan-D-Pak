import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/retail_models.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../widgets/online_only_gate.dart';
import '../../services/black_box.dart';
import '../../services/socket_service.dart';
import '../../services/system_log.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../../widgets/scan_button.dart' show kCameraScanSupported;
import '../../widgets/order_note_dialog.dart';
import '../../widgets/manager_pin_dialog.dart';
import '../scanner/barcode_scanner_screen.dart';
import '../management/management_widgets.dart';
import '../retail/temporary_transfer_confirm_button.dart';
import '../retail/combo_support.dart';
import '../../widgets/app_loading.dart';
import 'phone_customer_screen.dart';
import 'phone_kit.dart';
import 'phone_shift_screen.dart';

/// LUỒNG BÁN LẺ BẢN ĐIỆN THOẠI: chọn hàng → giỏ → thanh toán → hoàn tất.
///
/// Toàn bộ dữ liệu là DỮ LIỆU THẬT của hệ thống, dùng đúng các endpoint mà bản
/// desktop/tablet đang chạy:
///   - `GET  /api/skus`            (getSkusPaginated)   danh sách hàng theo kênh retail
///   - `GET  /api/skus/barcode/:c` (getSkuByBarcode)    quét mã vạch
///   - `GET  /api/shifts/current`  (getCurrentShift)    chặn bán khi chưa mở ca
///   - `GET  /api/customers`       (getCustomers)       chọn khách cho hóa đơn
///   - `POST /api/retail/checkout` (retailCheckout)     chốt đơn + thu tiền
/// KHÔNG có dữ liệu mẫu nào trong file này.
///
/// CA LÀM VIỆC mở/kết ngay tại đây (xem [PhoneShiftControlScreen]) — máy cầm
/// tay đứng một mình vẫn bán được, không phải chạy đi tìm máy desktop.
///
/// Bố cục theo kỷ luật một tay: thao tác chính luôn ở [PhoneActionBar] ghim đáy,
/// bàn phím tiền nằm nửa dưới màn, mọi vùng chạm ≥ 44px.
class PhoneSellScreen extends StatefulWidget {
  const PhoneSellScreen({super.key});

  @override
  State<PhoneSellScreen> createState() => _PhoneSellScreenState();
}

enum _Step { sell, cart, pay, done }

/// Một tab thanh toán, lấy từ Cài đặt vận hành của chi nhánh.
/// [kind]: 'cash' | 'qr' | 'pos' | 'voucher' — quyết định hiện bàn phím tiền,
/// mã QR hay bảng xác nhận.
class _PayMethod {
  final String key;
  final String label;
  final String kind;
  const _PayMethod(this.key, this.label, this.kind);

  IconData get icon => switch (kind) {
        'cash' => Icons.payments_outlined,
        'qr' => Icons.qr_code_2,
        'pos' => Icons.credit_card,
        'voucher' => Icons.confirmation_number_outlined,
        _ => Icons.account_balance_wallet_outlined,
      };

  /// Dùng khi chưa đọc được cài đặt (mất mạng lúc mở màn). Ba phương thức này
  /// luôn tồn tại trong cấu hình mặc định của server.
  static const List<_PayMethod> macDinh = [
    _PayMethod('cash', 'Tiền mặt', 'cash'),
    _PayMethod('bank', 'Chuyển khoản', 'qr'),
    _PayMethod('visa', 'Thẻ', 'pos'),
  ];
}

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

  /// Khách gắn vào hóa đơn. `null` = bán cho người tiêu dùng (không gắn khách).
  RetailCustomer? _customer;

  /// Voucher toàn đơn; CTKM sản phẩm được chọn riêng trên từng dòng.
  RetailVoucher? _voucher;
  String _note = '';
  // PIN Quản lý đã xác thực cho việc chỉnh giá dòng — gửi kèm lúc thanh toán,
  // reset khi xong đơn / xoá giỏ. Giống bản tablet.
  String? _priceOverridePin;
  List<RetailVoucher> _vouchers = [];

  // Ca làm việc — chưa mở ca thì KHÔNG cho thanh toán (giống desktop).
  Map<String, dynamic>? _shift;
  bool _shiftChecked = false;

  /// Các phương thức thanh toán ĐANG BẬT của chi nhánh (Cài đặt → Vận hành).
  /// Trước đây ba tab ghi cứng trong màn — chi nhánh tắt "Thẻ" trong cài đặt
  /// thì điện thoại vẫn hiện, bấm vào là server chặn.
  List<_PayMethod> _payMethods = _PayMethod.macDinh;
  String _method = 'cash';
  String _cashInput = '';

  /// CHIA TIỀN nhiều phương thức (multi-tender). RỖNG = một phương thức như cũ
  /// (hành vi mặc định KHÔNG đổi). Chỉ dùng cho tender KHÔNG-QR; tổng luôn ĐÚNG
  /// bằng `_total` vì sheet chia enforce. Server nhận thẳng mảng này qua
  /// `payments`/`lines` (services/payments.js) — cùng cơ chế desktop mixed-tender.
  final List<PaymentLine> _splitLines = [];
  bool _paying = false;
  bool _printingPreview = false;

  // ── QR chuyển khoản ──────────────────────────────────────────────────────
  Map<String, dynamic>? _qrData;
  bool _qrLoading = false;
  String? _qrError;

  /// Đơn NHÁP tạo trên server ngay khi chọn QR, để webhook ngân hàng có đơn mà
  /// khớp nội dung chuyển khoản rồi TỰ ĐÓNG BILL — giống hệt bản desktop.
  String? _draftOrderId;
  bool _creatingDraft = false;

  /// Bill đã được đóng bởi webhook / máy khác trong lúc màn này còn mở.
  bool _settledExternally = false;

  /// Đã chờ đủ lâu mà webhook chưa đóng bill → mới cho bấm xác nhận tay.
  bool _graceElapsed = false;
  Timer? _graceTimer;
  Timer? _pollTimer;
  bool _polling = false;

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
    _loadVouchers();
    _loadPayMethods();
    // Bill có thể bị đóng bởi webhook SePay/Casso/payOS hoặc máy khác trong lúc
    // màn này còn mở. Đăng ký ngay từ đầu (không đợi có đơn nháp) vì đơn nháp
    // chỉ sinh ra khi chọn QR.
    SocketService().addListener(_onSocketEvent);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _graceTimer?.cancel();
    _pollTimer?.cancel();
    SocketService().removeListener(_onSocketEvent);
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

  /// Voucher/CTKM đang chạy. Hỏng thì thôi — KHÔNG chặn bán hàng.
  Future<void> _loadVouchers() async {
    try {
      final rows = await _api.getActiveVouchers();
      if (!mounted) return;
      setState(() {
        _vouchers = rows
            .whereType<Map>()
            .map((e) => RetailVoucher.fromJson(Map<String, dynamic>.from(e)))
            .toList();
      });
    } catch (_) {}
  }

  Future<void> _loadPayMethods() async {
    try {
      final cfg = await _api.getOperationsConfig();
      final pay = cfg['payment'];
      final raw = pay is Map ? pay['methods'] : null;
      if (raw is! List) return;
      final ds = <_PayMethod>[];
      for (final m in raw.whereType<Map>()) {
        if (m['enabled'] == false) continue;
        final key = '${m['key'] ?? ''}';
        if (key.isEmpty) continue;
        ds.add(_PayMethod(key, '${m['label'] ?? key}', '${m['kind'] ?? ''}'));
      }
      if (!mounted || ds.isEmpty) return;
      setState(() {
        _payMethods = ds;
        if (!ds.any((m) => m.key == _method)) _method = ds.first.key;
      });
    } catch (_) {}
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
    // KHÔNG chặn cứng theo tồn hiển thị (có thể CŨ khi vừa nhập/sửa kho ở máy
    // khác). Server chặn vượt tồn khi thanh toán. Chỉ cảnh báo nếu tồn ≤ 0.
    if (s.stock <= 0) {
      appToast(context, t('${s.name}: tồn hiển thị 0 — kiểm tra lại'));
    }
    setState(() {
      final i = _cart.indexWhere((l) => l.sku.id == s.id);
      if (i >= 0) {
        _cart[i].qty = _cart[i].qty + 1;
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
        l.qty = next;
      }
    });
  }

  // ── COMBO (Phương án B) — dùng chung logic với retail_screen qua combo_support ──
  int _comboSeq = 0;

  List<RetailVoucher> get _comboVouchers => _vouchers
      .where(
          (v) => v.usableForCustomer(_customer) && v.isCombo && v.comboQty > 0)
      .toList();

  RetailVoucher? _comboVoucherFor(String comboId) {
    final vid = comboId.split('#').first;
    for (final v in _vouchers) {
      if (v.id == vid) return v;
    }
    return null;
  }

  num get _comboDiscount => comboDiscountTotal(_cart, _comboVoucherFor);
  List<String> _selectedComboIds() => selectedComboIds(_cart);

  // Payload 1 dòng gửi lên server — dùng chung cho checkout / nháp / xem in.
  // Kèm giá chỉnh tay (price_override) + ghi chú riêng của dòng (#4e).
  Map<String, dynamic> _itemPayload(CartLine l) => {
        'sku_id': l.sku.id,
        'qty': l.qty,
        'lot_id': l.lotId,
        'voucher_id': l.voucherId,
        if (l.priceOverride != null) 'price_override': l.priceOverride!.round(),
        if ((l.note ?? '').isNotEmpty) 'note': l.note,
      };

  Future<void> _openComboPicker(RetailVoucher v,
      {String? existingId,
      Map<Sku, int>? initial,
      int initialCount = 1}) async {
    // Lấy ĐỦ SKU từ server — không dựa _skus đang phân trang (SKU combo có thể
    // chưa nạp → trước đây báo nhầm "chưa có sản phẩm phù hợp").
    List<Sku> eligible;
    try {
      final res =
          await _api.getSkusPaginated(page: 1, limit: 2000, channel: 'retail');
      final all = (res['items'] as List? ?? [])
          .whereType<Map>()
          .map((e) => Sku.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      eligible = comboEligibleSkus(v, all);
    } catch (_) {
      eligible = comboEligibleSkus(v, _skus);
    }
    if (!mounted) return;
    if (eligible.isEmpty) {
      appToast(context, t('Combo chưa có sản phẩm phù hợp trong kho'));
      return;
    }
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => ComboPickerDialog(
          voucher: v,
          eligible: eligible,
          initial: initial,
          initialCount: initialCount),
    );
    if (result == null || !mounted) return;
    _applyCombo(v, result['perCombo'] as Map<Sku, int>, result['count'] as int,
        existingId: existingId);
  }

  void _applyCombo(RetailVoucher v, Map<Sku, int> perCombo, int count,
      {String? existingId}) {
    final chosen = perCombo.entries.where((e) => e.value > 0).toList();
    if (chosen.isEmpty || count <= 0) {
      if (existingId != null) _removeCombo(existingId);
      return;
    }
    final comboId = existingId ?? '${v.id}#${_comboSeq++}';
    setState(() {
      if (existingId != null) _cart.removeWhere((c) => c.comboId == existingId);
      for (final e in chosen) {
        _cart.add(CartLine(e.key, e.value * count,
            comboId: comboId, comboName: v.displayName, comboPer: e.value));
      }
    });
  }

  void _changeComboCount(String comboId, int delta) {
    final lines = _cart.where((c) => c.comboId == comboId).toList();
    if (lines.isEmpty) return;
    if (delta > 0) {
      for (final l in lines) {
        final cap = l.sku.stock.toInt();
        if (cap > 0 && l.qty + delta * l.comboPer > cap) {
          appToast(context, t('Không đủ tồn cho ${l.sku.name}'));
          return;
        }
      }
    }
    setState(() {
      for (final l in lines) {
        l.qty += delta * l.comboPer;
      }
      if (lines.first.qty <= 0) _cart.removeWhere((c) => c.comboId == comboId);
    });
  }

  void _removeCombo(String comboId) =>
      setState(() => _cart.removeWhere((c) => c.comboId == comboId));

  void _editCombo(String comboId) {
    final lines = _cart.where((c) => c.comboId == comboId).toList();
    if (lines.isEmpty) return;
    final v = _comboVoucherFor(comboId);
    if (v == null) return;
    _openComboPicker(v,
        existingId: comboId,
        initial: {for (final l in lines) l.sku: l.comboPer},
        initialCount: comboCount(lines));
  }

  // Dòng hiển thị giỏ: hàng thường giữ nguyên, combo gom về 1 dòng (theo thứ tự
  // xuất hiện đầu tiên). Record để khỏi thêm class riêng.
  List<({CartLine? line, String? comboId, List<CartLine> lines})>
      _cartDisplay() {
    final out = <({CartLine? line, String? comboId, List<CartLine> lines})>[];
    final seen = <String>{};
    for (final l in _cart) {
      if (l.isCombo) {
        if (seen.add(l.comboId!)) {
          out.add((
            line: null,
            comboId: l.comboId,
            lines: _cart.where((c) => c.comboId == l.comboId).toList()
          ));
        }
      } else {
        out.add((line: l, comboId: null, lines: const []));
      }
    }
    return out;
  }

  Widget _comboStep(IconData icon, VoidCallback onTap) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: DanColors.brand.withValues(alpha: .10),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: DanColors.brand.withValues(alpha: .35)),
          ),
          child: Icon(icon, size: 16, color: DanColors.brand),
        ),
      );

  // Dòng combo trong giỏ (phone): tên + tổng, thành phần "món ×SL", đơn giá/combo
  // + stepper số combo + nút xóa. Chạm → sửa thành phần.
  Widget _comboCard(String comboId, List<CartLine> lines) {
    final v = _comboVoucherFor(comboId);
    final count = comboCount(lines);
    final gross = comboGrossPerCombo(lines);
    final unit = v == null ? gross : comboUnitPrice(v, gross);
    final name = lines.first.comboName ?? (v?.displayName ?? t('Combo'));
    final parts = lines.map((l) => '${l.sku.name} ×${l.qty}').join('   •   ');
    return InkWell(
      onTap: () => _editCombo(comboId),
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: DanColors.brand.withValues(alpha: .06),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: DanColors.brand.withValues(alpha: .30)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(Icons.card_giftcard, size: 18, color: DanColors.brand),
              const SizedBox(width: 6),
              Expanded(
                  child: Text(name,
                      style: const TextStyle(
                          fontWeight: FontWeight.w800, fontSize: 13.5))),
              Text(phoneMoney(unit * count),
                  style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      color: DanColors.brand,
                      fontFeatures: [FontFeature.tabularFigures()])),
            ]),
            const SizedBox(height: 4),
            Text(parts,
                style: const TextStyle(fontSize: 11.5, color: DanColors.muted)),
            const SizedBox(height: 8),
            Row(children: [
              Text('${phoneMoney(unit)}/${t('combo')}',
                  style:
                      const TextStyle(fontSize: 11.5, color: DanColors.muted)),
              const Spacer(),
              _comboStep(Icons.remove, () => _changeComboCount(comboId, -1)),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text('$count',
                    style: const TextStyle(
                        fontWeight: FontWeight.w800, fontSize: 16)),
              ),
              _comboStep(Icons.add, () => _changeComboCount(comboId, 1)),
              const SizedBox(width: 2),
              IconButton(
                visualDensity: VisualDensity.compact,
                icon: Icon(Icons.close, size: 18, color: DanColors.late),
                onPressed: () => _removeCombo(comboId),
              ),
            ]),
          ],
        ),
      ),
    );
  }

  // Dùng lineTotal (giá đã chỉnh tay nếu có) để tổng khớp server — server lấy
  // giá override làm giá gốc của dòng.
  num get _subtotal => _cart.fold<num>(0, (a, l) => a + l.lineTotal);
  num get _productDiscount => _cart.fold<num>(0, (sum, line) {
        if (line.isCombo) return sum; // combo tính riêng, không chồng CTKM
        final voucher = _lineVoucher(line);
        return sum + (voucher == null ? 0 : _lineVoucherAmount(line, voucher));
      });

  /// Voucher đơn hàng. Đúng thứ tự của desktop và của server
  /// (`buildDiscountPlan`): voucher đơn TRƯỚC, ưu đãi khách SAU.
  num get _orderDiscount {
    final v = _voucher;
    final eligible = _cart.where((line) {
      if (line.isCombo) return false; // combo đã giảm riêng, không cộng thêm
      final selected = _lineVoucher(line);
      return selected == null || _lineVoucherAmount(line, selected) <= 0;
    }).fold<num>(0, (sum, line) => sum + line.lineTotal);
    final afterProduct = _subtotal - _productDiscount - _comboDiscount;
    if (v == null || afterProduct < v.minTotal) return 0;
    return v.amountFor(eligible);
  }

  num get _afterVoucher =>
      (_subtotal - _productDiscount - _comboDiscount - _orderDiscount)
          .clamp(0, _subtotal);

  /// Ưu đãi của khách được gắn. Tính Y HỆT desktop (`RetailCustomer.perkAmount`
  /// trên phần còn lại của đơn) — nếu bày ra số khác thì server tính một đằng,
  /// màn hình hiện một nẻo và tiền thu vào sẽ lệch.
  num get _customerDiscount => _customer?.perkAmount(_afterVoucher) ?? 0;

  // Giảm giá tay (tiền/%) — cho khách mua sỉ/ưu đãi riêng, KHÔNG phải CTKM.
  num _manualDiscount = 0;

  num get _total =>
      (_afterVoucher - _customerDiscount - _manualDiscount).clamp(0, _subtotal);

  Future<void> _openManualDiscount() async {
    final baseTotal = (_afterVoucher - _customerDiscount).clamp(0, _subtotal);
    final result = await showDialog<num>(
      context: context,
      builder: (_) =>
          ManualDiscountDialog(baseTotal: baseTotal, current: _manualDiscount),
    );
    if (result == null || !mounted) return;
    setState(() => _manualDiscount = result.clamp(0, double.infinity));
  }

  /// VAT ĐÃ NẰM TRONG giá bán (giá niêm yết là giá cuối). Phân bổ phần giảm giá
  /// theo tỉ trọng từng dòng rồi mới tách thuế — cùng công thức với desktop
  /// (`retail_screen.dart: _totals`), nếu không hai bên sẽ ra hai số thuế.
  num get _vat {
    final sub = _subtotal;
    final total = _total;
    if (sub <= 0 || total <= 0) return 0;
    final lines = _cart.where((l) => l.lineTotal > 0).toList();
    num allocated = 0;
    num vat = 0;
    for (var i = 0; i < lines.length; i++) {
      final l = lines[i];
      final gross = i == lines.length - 1
          ? total - allocated
          : (l.lineTotal * total / sub).round();
      allocated += gross;
      if (l.sku.vatRate > 0) {
        vat += gross - (gross / (1 + l.sku.vatRate / 100)).round();
      }
    }
    return vat;
  }

  /// Thuế suất để ghi nhãn "Trong đó VAT 10%". Nhiều mức khác nhau thì không
  /// ghi con số nào cả — ghi bừa một mức là nói sai với người đọc bill.
  String get _vatLabel {
    final rates =
        _cart.where((l) => l.sku.vatRate > 0).map((l) => l.sku.vatRate).toSet();
    if (rates.length != 1) return t('Trong đó VAT');
    final r = rates.first;
    final s = r == r.roundToDouble() ? r.round().toString() : '$r';
    return '${t('Trong đó VAT')} $s%';
  }

  int get _cartCount => _cart.fold<int>(0, (a, l) => a + l.qty);

  num get _cash => num.tryParse(_cashInput) ?? 0;
  num get _change => _cash - _total;

  // ── Thanh toán THẬT ──────────────────────────────────────────────────────
  Future<void> _confirm() async {
    if (_cart.isEmpty || _paying) return;
    // ONLINE-ONLY: mất kết nối máy chủ ⇒ KHÔNG thu tiền/chốt bill local, KHÔNG
    // queue thanh toán. Server là nguồn dữ liệu duy nhất.
    if (!ensureOnlineForMutation(context, action: t('Thanh toán'))) return;
    if (!_shiftOpen) {
      appToast(context, t('Chưa mở ca — không thể thu tiền.'), isError: true);
      // Đưa thẳng tới màn mở ca thay vì để thu ngân tự đi tìm.
      await _moManCa();
      return;
    }
    // Chặn tiền mặt THIẾU chỉ khi KHÔNG chia tiền; khi chia, tổng đã enforce
    // bằng _total ở sheet nên không xét _change (khách không "đưa dư" để thối).
    if (!_splitActive && _method == 'cash' && _change < 0) return;

    if (_isQr) _stopWaitingForBank();
    setState(() => _paying = true);
    try {
      final draft = _draftOrderId;
      final receipt = await SystemLog.runFlow('checkout', () async {
        // Đã có đơn NHÁP thật trên server (tạo lúc chọn QR) thì phải THU TIỀN
        // cho đơn đó, không gọi retailCheckout nữa — gọi lại là server báo
        // "Checkout trước với mã này chưa hoàn tất" và thu ngân đứng hình.
        if (draft != null && draft.isNotEmpty) {
          return _api.payOrder(draft, {
            'lines': _paymentPayload(),
            // CHỈ gửi voucher + khách; server tự tính lại phần giảm giá. Gửi
            // luôn số tiền đã giảm là bị trừ hai lần.
            'voucher_id': _voucher?.id,
            'selected_combos': _selectedComboIds(),
            'manual_discount': _manualDiscount.round(),
            'customer': _customer?.toCheckoutCustomer(),
            'idempotency_key': _requestId,
            if ('${_qrData?['payment_intent_id'] ?? ''}'.isNotEmpty)
              'payment_intent_id': _qrData!['payment_intent_id'],
          });
        }
        return _api.retailCheckout({
          'items': [
            for (final l in _cart) _itemPayload(l),
          ],
          'payments': _paymentPayload(),
          if ((_priceOverridePin ?? '').isNotEmpty)
            'security_pin': _priceOverridePin,
          // Gắn khách để server áp ĐÚNG ưu đãi đã tính ở đây và ghi lịch sử
          // mua hàng/điểm cho khách.
          'customer': _customer?.toCheckoutCustomer(),
          'customer_id': _customer?.id,
          'voucher_id': _voucher?.id,
          'selected_combos': _selectedComboIds(),
          'manual_discount': _manualDiscount.round(),
          // Cùng khóa chống trùng với bản desktop — bấm lại do mạng chậm KHÔNG
          // tạo hóa đơn thứ hai. Đơn nháp (tạo khi chọn QR) dùng CHUNG khóa
          // này, nên chốt đơn ở đây là đóng đúng đơn nháp đó chứ không đẻ đơn
          // thứ hai.
          'client_request_id': _requestId,
          'note': _note,
        });
      });
      if (!mounted) return;

      final orderId = '${receipt['id'] ?? receipt['order_id'] ?? ''}';
      final billNo = '${receipt['bill_no'] ?? receipt['number'] ?? ''}';
      _stopWaitingForBank();
      setState(() {
        _receipt = Map<String, dynamic>.from(receipt);
        _paying = false;
        _step = _Step.done;
      });

      // Server đã biết CHÍNH XÁC vì sao không in được (không tuyến nào nhận máy
      // in của máy này, máy chưa báo máy in nào…) và gửi kèm trong hóa đơn.
      // Hiện thẳng câu đó — đừng đi tìm lệnh in không tồn tại rồi báo một câu
      // chung chung khiến mỗi lần lỗi lại phải mò lại từ đầu.
      final loiIn = '${receipt['print_error'] ?? ''}'.trim();
      if (loiIn.isNotEmpty) {
        appToast(context, t('Đã thu tiền. KHÔNG in được: $loiIn'),
            isError: true);
      }
      // In bill chạy nền — KHÔNG chặn màn hình. Máy in chậm/mất kết nối không
      // được giữ thu ngân lại khi tiền đã nhận đủ.
      else if (receipt['idempotent_replay'] != true &&
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

  // ── Chuyển khoản QR ──────────────────────────────────────────────────────
  /// Phương thức đang chọn có phải loại quét QR chuyển khoản không.
  bool get _isQr =>
      _payMethods
          .firstWhere((m) => m.key == _method,
              orElse: () => const _PayMethod('', '', ''))
          .kind ==
      'qr';

  /// Đổi phương thức. Chọn QR thì tạo đơn nháp + dựng QR ngay, để khách quét
  /// được luôn thay vì phải bấm thêm một nút nữa.
  void _pickMethod(String key) {
    if (_method == key) return;
    setState(() {
      _method = key;
      _qrData = null;
      _qrError = null;
      // Đổi phương thức = bỏ ý định chia tiền trước đó (tránh gửi mảng chia cũ
      // không còn khớp, và QR không hỗ trợ chia).
      _splitLines.clear();
    });
    if (_isQr) {
      unawaited(_ensureDraft().then((_) => _refreshQr()));
    } else {
      _stopWaitingForBank();
    }
  }

  bool get _splitActive => _splitLines.isNotEmpty;
  num get _splitSum => _splitLines.fold<num>(0, (a, l) => a + l.amount);

  /// Mảng payment gửi server: chia tiền nếu đang bật, ngược lại một dòng như cũ.
  List<Map<String, dynamic>> _paymentPayload() => _splitActive
      ? _splitLines.map((l) => l.toJson()).toList()
      : [PaymentLine(method: _method, amount: _total).toJson()];

  /// Sheet CHIA TIỀN: nhập số tiền cho từng phương thức (không-QR), tổng phải
  /// ĐÚNG bằng khách cần trả. Xong → set `_splitLines`; server tự đối chiếu.
  Future<void> _openSplitSheet() async {
    // Chỉ các phương thức không-QR mới chia được (QR cần đối soát webhook riêng).
    final methods =
        _payMethods.where((m) => m.kind != 'qr').toList(growable: false);
    if (methods.isEmpty) return;
    final amounts = <String, num>{
      for (final m in methods) m.key: 0,
    };
    // Nạp lại giá trị đang chia (nếu mở để sửa).
    for (final l in _splitLines) {
      if (amounts.containsKey(l.method)) amounts[l.method] = l.amount;
    }
    final total = _total;
    final result = await showModalBottomSheet<List<PaymentLine>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: DanColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (ctx) => StatefulBuilder(builder: (ctx, setSheet) {
        num sum() => amounts.values.fold<num>(0, (a, b) => a + b);
        final remaining = total - sum();
        return Padding(
          padding: EdgeInsets.only(
              left: 16,
              right: 16,
              top: 14,
              bottom: 16 + MediaQuery.of(ctx).viewInsets.bottom),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(t('Chia tiền nhiều phương thức'),
                  style: const TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w900)),
              const SizedBox(height: 2),
              Text('${t('Khách cần trả')}: ${phoneMoney(total)}',
                  style:
                      const TextStyle(fontSize: 12.5, color: DanColors.muted)),
              const SizedBox(height: 12),
              for (final m in methods)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(
                    children: [
                      Icon(m.icon, size: 18, color: DanColors.muted),
                      const SizedBox(width: 8),
                      SizedBox(
                          width: 92,
                          child: Text(t(m.label),
                              style: const TextStyle(
                                  fontSize: 13, fontWeight: FontWeight.w700))),
                      Expanded(
                        child: TextFormField(
                          initialValue: amounts[m.key] == 0
                              ? ''
                              : '${amounts[m.key]!.round()}',
                          keyboardType: TextInputType.number,
                          textAlign: TextAlign.right,
                          decoration: InputDecoration(
                            isDense: true,
                            hintText: '0',
                            suffixText: 'đ',
                            border: const OutlineInputBorder(),
                          ),
                          onChanged: (v) => setSheet(() => amounts[m.key] =
                              num.tryParse(v.replaceAll(',', '')) ?? 0),
                        ),
                      ),
                      const SizedBox(width: 6),
                      // "Phần còn lại" — gán nốt số chưa phân bổ vào dòng này.
                      TextButton(
                        onPressed: () => setSheet(() {
                          final other = sum() - (amounts[m.key] ?? 0);
                          final rest = total - other;
                          amounts[m.key] = rest < 0 ? 0 : rest;
                        }),
                        child: Text(t('Còn lại')),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 4),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(t('Chưa phân bổ'),
                      style: const TextStyle(
                          fontSize: 12.5, color: DanColors.muted)),
                  Text(phoneMoney(remaining),
                      style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w900,
                          color: remaining == 0
                              ? const Color(0xFF047857)
                              : DanColors.late)),
                ],
              ),
              const SizedBox(height: 12),
              PhoneCta(
                label: t('Xong'),
                // Tổng phải khớp CHÍNH XÁC và có ít nhất 2 dòng có tiền mới là
                // "chia"; một dòng thì quay về chế độ một phương thức.
                onPressed: (remaining == 0 &&
                        amounts.values.where((v) => v > 0).length >= 2)
                    ? () => Navigator.of(ctx).pop([
                          for (final e in amounts.entries)
                            if (e.value > 0)
                              PaymentLine(method: e.key, amount: e.value),
                        ])
                    : null,
              ),
              if (_splitActive) ...[
                const SizedBox(height: 8),
                PhoneSecondaryButton(
                  label: t('Bỏ chia tiền'),
                  icon: Icons.close,
                  onPressed: () => Navigator.of(ctx).pop(<PaymentLine>[]),
                ),
              ],
            ],
          ),
        );
      }),
    );
    if (result == null) return;
    setState(() {
      _splitLines
        ..clear()
        ..addAll(result);
    });
  }

  /// Tạo đơn NHÁP thật trên server để webhook ngân hàng có đơn mà khớp nội dung
  /// chuyển khoản và TỰ ĐÓNG BILL. Lỗi thì thôi — thu ngân vẫn xác nhận tay
  /// được, chỉ mất phần tự động.
  Future<void> _ensureDraft() async {
    if (_draftOrderId != null || _creatingDraft || _cart.isEmpty) return;
    _creatingDraft = true;
    try {
      final order = await _api.createRetailDraft({
        'items': [
          for (final l in _cart) _itemPayload(l),
        ],
        'voucher_id': _voucher?.id,
        'selected_combos': _selectedComboIds(),
        'manual_discount': _manualDiscount.round(),
        'customer': _customer?.toCheckoutCustomer(),
        'customer_id': _customer?.id,
        'client_request_id': _requestId,
        'note': _note,
        if ((_priceOverridePin ?? '').isNotEmpty)
          'security_pin': _priceOverridePin,
      });
      if (!mounted) return;
      setState(() {
        _draftOrderId = '${order['id'] ?? order['order_id'] ?? ''}';
        if (_draftOrderId!.isEmpty) _draftOrderId = null;
      });
      _startWaitingForBank();
    } catch (_) {
      // Không chặn bán hàng: mất tự động đóng bill, còn xác nhận tay vẫn chạy.
    } finally {
      _creatingDraft = false;
    }
  }

  /// Nội dung chuyển khoản LẤY TỪ SERVER, không tự ghép.
  String get _qrReference => '${_qrData?['reference'] ?? ''}';

  Future<void> _refreshQr() async {
    if (!_isQr || _total <= 0) return;
    await _ensureDraft();
    setState(() {
      _qrLoading = true;
      _qrError = null;
    });
    try {
      final id = _draftOrderId;
      // Có đơn thật → hỏi QR THEO ĐƠN. Server tự tính nội dung chuyển khoản
      // bằng đúng hàm mà webhook dùng để khớp, nên tiền về là tự đóng bill.
      //
      // Bản trước tự ghép mã ở client rồi gửi lên: chỉ khớp khi cửa hàng để
      // "Tiền tố nội dung CK" trùng đúng mấy chữ đầu của số bill, và KHÔNG BAO
      // GIỜ khớp khi đơn nháp chưa kịp tạo (lúc đó mã là DANBILL<thời gian>,
      // một mã không đơn nào mang) — đúng cảm giác "lúc được lúc không".
      if (id == null || id.isEmpty) {
        throw Exception('Khong tao duoc don de cap ma chuyen khoan.');
      }
      final data = await _api.orderPaymentQr(id, method: _method);
      if (!mounted) return;
      setState(() {
        _qrData = data;
        _qrLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _qrError = e.toString().replaceFirst('Exception: ', '');
        _qrLoading = false;
      });
    }
  }

  /// Chờ ngân hàng báo về. Hai đường: realtime (`payment:done`) là chính, hỏi
  /// lại đơn mỗi 3 giây là dự phòng khi mạng chập chờn.
  void _startWaitingForBank() {
    _graceTimer?.cancel();
    _graceElapsed = false;
    // 25 giây: đủ để webhook về. Trong lúc đó KHÔNG hiện nút xác nhận tay —
    // bấm tay quá sớm làm bill đóng trước, webhook tới sau báo "đã thanh toán"
    // và người dùng tưởng hệ thống lỗi.
    _graceTimer = Timer(const Duration(seconds: 25), () {
      if (mounted) setState(() => _graceElapsed = true);
    });
    _pollTimer?.cancel();
    unawaited(_pollOrderPaid());
    _pollTimer =
        Timer.periodic(const Duration(seconds: 3), (_) => _pollOrderPaid());
  }

  void _stopWaitingForBank() {
    _graceTimer?.cancel();
    _pollTimer?.cancel();
    _graceElapsed = false;
  }

  Future<void> _pollOrderPaid() async {
    final id = _draftOrderId;
    if (!mounted || id == null || _polling || _settledExternally || _paying) {
      return;
    }
    _polling = true;
    try {
      final order = await _api.getOrderById(id);
      if (!mounted || '${order['status'] ?? ''}' != 'paid') return;
      _onSettledExternally(order);
    } catch (_) {
      // Realtime vẫn là đường chính; hỏi lại chỉ là dự phòng.
    } finally {
      _polling = false;
    }
  }

  /// Rời màn thanh toán về giỏ. Đơn nháp phải BỎ ĐI, nếu không thu ngân sửa giỏ
  /// rồi quay lại là thu tiền cho đơn nháp mang danh sách hàng CŨ.
  ///
  /// Server từ chối huỷ đơn đã có tiền về (`voidDraftOrder`) — gặp trường hợp đó
  /// thì GIỮ NGUYÊN đơn nháp và ở lại màn thanh toán, vì rất có thể khách vừa
  /// chuyển khoản xong.
  /// Vào màn thanh toán. Phương thức mặc định của cửa hàng là chuyển khoản thì
  /// dựng QR ngay, đừng bắt thu ngân bấm lại đúng cái tab đang chọn sẵn.
  void _vaoManThanhToan() {
    setState(() => _step = _Step.pay);
    if (_isQr && _qrData == null) {
      unawaited(_ensureDraft().then((_) => _refreshQr()));
    }
  }

  Future<void> _inTamTinh() async {
    if (_cart.isEmpty || _printingPreview) return;
    setState(() => _printingPreview = true);
    try {
      await _api.printRetailPreview({
        'items': [
          for (final line in _cart) _itemPayload(line),
        ],
        'voucher_id': _voucher?.id,
        'selected_combos': _selectedComboIds(),
        'manual_discount': _manualDiscount.round(),
        'customer': _customer?.toCheckoutCustomer(),
        'customer_id': _customer?.id,
        'note': _note,
        if ((_priceOverridePin ?? '').isNotEmpty)
          'security_pin': _priceOverridePin,
      });
      if (mounted) appToast(context, t('Đã gửi lệnh in tạm tính.'));
    } catch (e) {
      if (mounted) {
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    } finally {
      if (mounted) setState(() => _printingPreview = false);
    }
  }

  Future<void> _editNote() async {
    final value = await editOrderNote(context, _note);
    if (value == null || !mounted) return;
    setState(() => _note = value);
  }

  // Chạm đơn giá 1 dòng → PIN Quản lý → chỉnh giá bán dòng đó (server xác thực
  // PIN lúc thanh toán). Combo có giá riêng nên không chỉnh từng dòng.
  Future<void> _editLinePrice(CartLine line) async {
    if (line.isCombo) return;
    final pin = _priceOverridePin ??
        await requestManagerPin(
          context,
          t('Chỉnh giá bán "${line.sku.name}" — cần PIN Quản lý/Admin.'),
          label: t('PIN Quản lý / Admin'),
        );
    if (pin == null || !mounted) return;
    final result = await showDialog<num>(
      context: context,
      builder: (_) =>
          LinePriceDialog(sku: line.sku, current: line.priceOverride),
    );
    if (result == null || !mounted) return;
    setState(() {
      _priceOverridePin = pin;
      line.priceOverride =
          (result < 0 || result == line.sku.price) ? null : result;
    });
  }

  // Ghi chú RIÊNG cho 1 dòng hàng (in dưới dòng đó trên bill).
  Future<void> _editLineNote(CartLine line) async {
    final value = await editOrderNote(context, line.note ?? '');
    if (value == null || !mounted) return;
    setState(() => line.note = value.trim().isEmpty ? null : value.trim());
  }

  Future<void> _roiManThanhToan() async {
    final id = _draftOrderId;
    if (id == null || id.isEmpty) {
      _stopWaitingForBank();
      setState(() => _step = _Step.cart);
      return;
    }
    try {
      await _api.voidRetailDraft(id);
    } catch (e) {
      if (!mounted) return;
      appToast(context,
          t('Đơn này có thể đã nhận được tiền — kiểm tra rồi hãy sửa giỏ hàng.'),
          isError: true);
      return;
    }
    if (!mounted) return;
    _stopWaitingForBank();
    setState(() {
      _draftOrderId = null;
      _qrData = null;
      _qrError = null;
      _step = _Step.cart;
    });
  }

  void _onSocketEvent(String event, dynamic payload) {
    if (!mounted || _settledExternally || _paying) return;
    if (event != 'payment:done') return;
    final id = _draftOrderId;
    if (id == null || id.isEmpty) return;
    final map = payload is Map ? payload : null;
    if ('${map?['order_id'] ?? ''}' != id) return;
    _onSettledExternally(map?['receipt'] is Map
        ? Map<String, dynamic>.from(map!['receipt'] as Map)
        : {'total': _total.round()});
  }

  /// Bill đã được đóng bởi ngân hàng/máy khác — nhảy thẳng sang màn hoàn tất,
  /// KHÔNG thu tiền lần nữa.
  void _onSettledExternally(Map<String, dynamic> receipt) {
    _settledExternally = true;
    _stopWaitingForBank();
    if (!mounted) return;
    setState(() {
      _receipt = receipt;
      _paying = false;
      _step = _Step.done;
    });
    appToast(context, t('Ngân hàng đã xác nhận — bill tự đóng'));
  }

  void _startNewSale() {
    _stopWaitingForBank();
    setState(() {
      _cart.clear();
      _manualDiscount = 0;
      _priceOverridePin = null;
      _cashInput = '';
      _splitLines.clear();
      _method = _payMethods.first.key;
      _receipt = null;
      _voucher = null;
      _qrData = null;
      _qrError = null;
      _draftOrderId = null;
      _settledExternally = false;
      // Khách của hóa đơn CŨ không được dính sang đơn mới — đơn sau sẽ ăn nhầm
      // ưu đãi và ghi nhầm lịch sử mua hàng.
      _customer = null;
      _note = '';
      _requestId = _newRequestId();
      _step = _Step.sell;
    });
    _loadShift();
  }

  // ── Quét mã ──────────────────────────────────────────────────────────────
  /// Quét xong là THÊM THẲNG VÀO GIỎ, không đổ mã vào ô tìm rồi bắt bấm tiếp —
  /// thu ngân đang cầm hàng, mỗi thao tác thừa là một lần đặt hàng xuống.
  /// Không tra ra mã thì mới rơi về tìm kiếm để họ tự chọn.
  Future<void> _quetMa() async {
    final ma = await scanBarcode(context, title: t('Quét mã hàng'));
    if (ma == null || ma.trim().isEmpty || !mounted) return;
    final code = ma.trim();
    try {
      final row = await _api.getSkuByBarcode(code);
      if (!mounted) return;
      if (row == null) {
        _timTheoMa(code, t('Không có mã $code — tìm theo từ khóa'));
        return;
      }
      final sku = Sku.fromJson(Map<String, dynamic>.from(row));
      if (sku.stock <= 0) {
        appToast(context, t('${sku.name} đã hết hàng'), isError: true);
        return;
      }
      _add(sku);
      appToast(context, '${t('Đã thêm')} ${sku.name}');
    } catch (e) {
      if (!mounted) return;
      _timTheoMa(code, e.toString().replaceFirst('Exception: ', ''));
    }
  }

  void _timTheoMa(String code, String thongBao) {
    _searchCtrl.text = code;
    appToast(context, thongBao, isError: true);
    _load();
  }

  // ── Ca làm việc ──────────────────────────────────────────────────────────
  Future<void> _moManCa() async {
    await moManCa(context);
    if (!mounted) return;
    await _loadShift();
  }

  // ── Khách hàng ───────────────────────────────────────────────────────────
  Future<void> _chonKhach() async {
    final pick = await phoneChonKhachHang(context, dangChon: _customer);
    if (pick == null || !mounted) return;
    setState(() => _customer = pick.customer);
  }

  String get _nhanKhach => _customer?.title ?? t('Bán cho người tiêu dùng');

  // ── Voucher / CTKM ───────────────────────────────────────────────────────
  /// Voucher đơn hàng dùng được LÚC NÀY cho đơn NÀY: còn hiệu lực theo lịch
  /// (giờ/ngày/sinh nhật khách) và đơn đã đủ mức tối thiểu.
  List<RetailVoucher> get _vouchersDungDuoc => _vouchers
      .where((v) => v.usableForCustomer(_customer))
      .where((v) => v.isOrder)
      .where((v) => _subtotal >= v.minTotal)
      .toList();

  Future<void> _chonVoucher() async {
    final ds = _vouchersDungDuoc;
    if (ds.isEmpty) {
      appToast(
          context,
          _vouchers.isEmpty
              ? t('Chưa có chương trình khuyến mại nào đang chạy')
              : t('Đơn này chưa đủ điều kiện của khuyến mại nào'));
      return;
    }
    final khong = t('Không dùng khuyến mại');
    await showPhoneSheet<void>(
      context: context,
      title: t('Voucher / CTKM'),
      builder: (c) => PhonePickList(
        options: [khong, for (final v in ds) _nhanVoucher(v)],
        selected: _voucher == null ? khong : _nhanVoucher(_voucher!),
        onPick: (v) {
          Navigator.of(c).pop();
          setState(() {
            _voucher =
                v == khong ? null : ds.firstWhere((e) => _nhanVoucher(e) == v);
            // Số tiền đổi thì QR cũ không còn đúng nữa.
            _qrData = null;
          });
          if (_isQr) unawaited(_refreshQr());
        },
      ),
    );
  }

  String _nhanVoucher(RetailVoucher v) =>
      '${v.displayName} · ${t('giảm')} ${v.valueLabel}';

  List<RetailVoucher> _lineVouchers(CartLine line) => _vouchers
      .where((v) => v.usableForCustomer(_customer))
      .where((v) => (v.isSku || v.isAllSku) && v.appliesToSku(line.sku.id))
      .toList();

  RetailVoucher? _lineVoucher(CartLine line) {
    for (final voucher in _lineVouchers(line)) {
      if (voucher.id == line.voucherId) return voucher;
    }
    return null;
  }

  num _lineVoucherAmount(CartLine line, RetailVoucher voucher) {
    final base = line.lineTotal;
    if (voucher.type == 'buy_x_get_1') {
      final x = voucher.value.round().clamp(1, 1000000);
      return (line.qty ~/ (x + 1) * line.sku.price).clamp(0, base);
    }
    if (base < voucher.minTotal) return 0;
    return voucher.amountFor(base, qty: line.qty).clamp(0, base);
  }

  Future<void> _chonCtkmDong(CartLine line) async {
    final vouchers = _lineVouchers(line);
    if (vouchers.isEmpty) return;
    final none = t('Không áp dụng CTKM');
    await showPhoneSheet<void>(
        context: context,
        title: t('Khuyến mãi sản phẩm'),
        builder: (ctx) => PhonePickList(
              options: [
                none,
                for (final v in vouchers) '${v.displayName} · ${v.valueLabel}'
              ],
              selected: _lineVoucher(line) == null
                  ? none
                  : '${_lineVoucher(line)!.displayName} · ${_lineVoucher(line)!.valueLabel}',
              onPick: (value) {
                Navigator.of(ctx).pop();
                setState(() => line.voucherId = value == none
                    ? null
                    : vouchers
                        .firstWhere((v) => value.startsWith(v.displayName))
                        .id);
              },
            ));
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
        // ONLINE-ONLY: mất kết nối máy chủ → banner CHỈ ĐỌC (thao tác tiền/hàng
        // bị chặn ở handler). Tự ẩn khi online.
        const ServerConnectionBanner(),
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
                  // Ca nằm NGAY TRONG màn bán — chưa mở thì chạm để mở, đang mở
                  // thì chạm để xem/kết ca.
                  PhoneIconButton(
                      icon: Icons.point_of_sale_outlined, onTap: _moManCa),
                  PhoneIconButton(
                      icon: Icons.refresh,
                      onTap: () {
                        _load();
                        _loadShift();
                      }),
                ],
              ),
              if (_shiftChecked && !_shiftOpen)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                  child: InkWell(
                    onTap: _moManCa,
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFF1F1),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.lock_outline,
                              size: 18, color: Color(0xFFD94A4A)),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                                t('Chưa mở ca — chạm để mở ca và bắt đầu bán.'),
                                style: const TextStyle(
                                    fontSize: 12.5,
                                    height: 1.4,
                                    fontWeight: FontWeight.w800,
                                    color: Color(0xFFD94A4A))),
                          ),
                          const Icon(Icons.chevron_right,
                              size: 18, color: Color(0xFFD94A4A)),
                        ],
                      ),
                    ),
                  ),
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
                            // Máy POS cầm tay KHÔNG có máy quét rời — camera là
                            // đường quét duy nhất, nên chỗ dễ chạm nhất trong ô
                            // tìm phải là nút quét, không phải cái kính lúp
                            // trang trí (bàn phím đã có sẵn ngay dưới rồi).
                            _NutQuet(onTap: _quetMa),
                            const SizedBox(width: 5),
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
                    const SizedBox(width: 8),
                    // Chọn khách NGAY Ở MÀN BÁN, không phải tới bước thanh toán
                    // mới nhớ ra — ưu đãi của khách phải thấy trước khi chốt.
                    Flexible(
                      child: PhoneChip(
                        label: _nhanKhach,
                        active: _customer != null,
                        caret: true,
                        onTap: _chonKhach,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (_comboVouchers.isNotEmpty) _comboBar(),
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

  // Dải combo trên đầu lưới hàng: mỗi combo là 1 nút, bấm → chọn thành phần.
  Widget _comboBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: SizedBox(
        height: 40,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: _comboVouchers.length,
          separatorBuilder: (_, __) => const SizedBox(width: 8),
          itemBuilder: (_, i) {
            final v = _comboVouchers[i];
            return ActionChip(
              avatar:
                  Icon(Icons.card_giftcard, size: 18, color: DanColors.brand),
              label: Text('${v.displayName} · ${t('chọn')} ${v.comboQty}',
                  style: const TextStyle(
                      fontWeight: FontWeight.w700, fontSize: 12.5)),
              backgroundColor: DanColors.brand.withValues(alpha: .10),
              side: BorderSide(color: DanColors.brand.withValues(alpha: .35)),
              onPressed: () => _openComboPicker(v),
            );
          },
        ),
      ),
    );
  }

  Widget _buildSkuGrid() {
    if (_loading && _skus.isEmpty) {
      return const AppLoadingView(message: 'Đang tải sản phẩm…');
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
          imageUrl: _skus[i].image.startsWith('http')
              ? _skus[i].image
              : _api.uri(_skus[i].image).toString(),
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
          subtitle: t('${_cartDisplay().length} mặt hàng'),
          onBack: () => setState(() => _step = _Step.sell),
          actions: [
            if (_cart.isNotEmpty)
              PhoneIconButton(
                icon: Icons.delete_outline,
                color: DanColors.late,
                onTap: () => setState(() {
                  _cart.clear();
                  _note = '';
                  _manualDiscount = 0;
                  _priceOverridePin = null;
                }),
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
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _KhachRow(
                        label: _nhanKhach,
                        sub: _customer == null
                            ? t('Không gắn khách vào hóa đơn')
                            : [
                                if (_customer!.code.isNotEmpty) _customer!.code,
                                if (_customer!.phone.isNotEmpty)
                                  _customer!.phone,
                                if (_customer!.perkLabel.isNotEmpty)
                                  _customer!.perkLabel,
                              ].join(' · '),
                        onTap: _chonKhach,
                      ),
                    ),
                    for (final e in _cartDisplay())
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: e.comboId != null
                            ? _comboCard(e.comboId!, e.lines)
                            : _CartRowCard(
                                line: e.line!,
                                hasPromotion: _lineVouchers(e.line!).isNotEmpty,
                                promotionSelected: e.line!.voucherId != null,
                                onPromotion: () => _chonCtkmDong(e.line!),
                                onMinus: () => _bump(e.line!, -1),
                                onPlus: () => _bump(e.line!, 1),
                                onDelete: () =>
                                    setState(() => _cart.remove(e.line!)),
                                onEditPrice: () => _editLinePrice(e.line!),
                                onEditNote: () => _editLineNote(e.line!),
                              ),
                      ),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _KhachRow(
                        icon: Icons.card_giftcard,
                        label: t('Voucher / CTKM'),
                        sub: _voucher == null
                            ? (_vouchersDungDuoc.isEmpty
                                ? t('Không có chương trình nào áp được')
                                : '${_vouchersDungDuoc.length} ${t('chương trình áp được')}')
                            : _nhanVoucher(_voucher!),
                        action: _voucher == null ? t('Thêm') : t('Đổi'),
                        onTap: _chonVoucher,
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _KhachRow(
                        icon: Icons.local_offer_outlined,
                        label: t('Giảm giá'),
                        sub: _manualDiscount > 0
                            ? '-${phoneMoney(_manualDiscount)}'
                            : t('Giảm theo tiền hoặc %'),
                        action: _manualDiscount > 0 ? t('Đổi') : t('Thêm'),
                        onTap: _openManualDiscount,
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _KhachRow(
                        icon: Icons.notes_outlined,
                        label: t('Ghi chú'),
                        sub: _note.isEmpty
                            ? t('Chạm để nhập ghi chú')
                            : '${t('Ghi chú')}: $_note',
                        onTap: _editNote,
                      ),
                    ),
                    const SizedBox(height: 4),
                    PhoneKv(t('Tạm tính'), phoneMoney(_subtotal)),
                    if (_productDiscount > 0)
                      PhoneKv(t('Khuyến mại sản phẩm'),
                          '-${phoneMoney(_productDiscount)}',
                          valueColor: const Color(0xFF047857)),
                    if (_orderDiscount > 0)
                      PhoneKv(
                          '${t('Khuyến mại')} · ${_voucher?.displayName ?? ''}',
                          '-${phoneMoney(_orderDiscount)}',
                          valueColor: const Color(0xFF047857)),
                    if (_customerDiscount > 0)
                      PhoneKv(
                          '${t('Ưu đãi khách')} · ${_customer?.perkLabel ?? ''}',
                          '-${phoneMoney(_customerDiscount)}',
                          valueColor: const Color(0xFF047857)),
                    // VAT nằm TRONG giá, nên đây là dòng "trong đó", không cộng
                    // thêm vào tổng.
                    if (_vat > 0) PhoneKv(_vatLabel, phoneMoney(_vat)),
                    Container(
                        height: 2,
                        color: DanColors.text,
                        margin: const EdgeInsets.symmetric(vertical: 10)),
                    PhoneKv(t('TỔNG CỘNG'), phoneMoney(_total), big: true),
                  ],
                ),
        ),
        if (_cart.isNotEmpty)
          PhoneActionBar(
            child: Row(
              children: [
                SizedBox(
                  width: 64,
                  height: 52,
                  child: OutlinedButton(
                    onPressed: _printingPreview ? null : _inTamTinh,
                    child: _printingPreview
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(t('In')),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: PhoneCta(
                    label: t('Thanh toán'),
                    trailing: phoneMoney(_total),
                    onPressed: _vaoManThanhToan,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  // ── Màn THANH TOÁN ───────────────────────────────────────────────────────
  Widget _buildPay() {
    final methods = _payMethods;
    final laTienMat = _method == 'cash';
    final canPay = _shiftOpen &&
        (_splitActive ? _splitSum == _total : (!laTienMat || _change >= 0));

    return Column(
      children: [
        PhoneHeader(
          title: t('Thanh toán'),
          subtitle: t('${_cart.length} mặt hàng'),
          onBack: _paying ? null : _roiManThanhToan,
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
              Text(phoneMoney(_total),
                  style: const TextStyle(
                      fontSize: 34,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -.6,
                      fontFeatures: [FontFeature.tabularFigures()])),
              const SizedBox(height: 8),
              PhoneKv(t('Tổng tiền hàng'), phoneMoney(_subtotal)),
              if (_orderDiscount > 0)
                PhoneKv(t('Khuyến mại'), '-${phoneMoney(_orderDiscount)}',
                    valueColor: const Color(0xFF047857)),
              if (_customerDiscount > 0)
                PhoneKv('${t('Ưu đãi')} · $_nhanKhach',
                    '-${phoneMoney(_customerDiscount)}',
                    valueColor: const Color(0xFF047857)),
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
              for (final m in methods)
                Expanded(
                  child: InkWell(
                    onTap: () => _pickMethod(m.key),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 11),
                      decoration: BoxDecoration(
                        color: _method == m.key
                            ? const Color(0xFFE4F5F9)
                            : DanColors.surface,
                        border: Border(
                          top: BorderSide(
                              width: 2.5,
                              color: _method == m.key
                                  ? DanColors.brand
                                  : Colors.transparent),
                        ),
                      ),
                      child: Column(
                        children: [
                          Icon(m.icon,
                              size: 19,
                              color: _method == m.key
                                  ? DanColors.brandHover
                                  : DanColors.muted),
                          const SizedBox(height: 6),
                          Text(t(m.label),
                              textAlign: TextAlign.center,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w800,
                                  height: 1.2,
                                  color: _method == m.key
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
          child: _splitActive
              ? _splitSummaryPanel()
              : (laTienMat
                  ? _cashPad()
                  : (_isQr ? _qrPanel() : _nonCashPanel())),
        ),
        PhoneActionBar(
          child: Column(
            children: [
              // Chia tiền chỉ cho tender không-QR và khi chưa có đơn nháp QR.
              if (!_isQr && _draftOrderId == null) ...[
                PhoneSecondaryButton(
                  label: _splitActive
                      ? '${t('Sửa chia tiền')} (${_splitLines.length})'
                      : t('Chia nhiều phương thức'),
                  icon: Icons.call_split,
                  onPressed: _paying ? null : _openSplitSheet,
                ),
                const SizedBox(height: 8),
              ],
              PhoneCta(
                label: (_splitActive || laTienMat)
                    ? t('Hoàn tất thanh toán')
                    : (_isQr
                        ? t('Khách đã chuyển — xác nhận')
                        : t('Xác nhận đã nhận tiền')),
                trailing: phoneMoney(_total),
                busy: _paying,
                // Đang trong thời gian chờ ngân hàng tự báo về thì KHÔNG cho
                // bấm tay: bấm sớm làm bill đóng trước, webhook tới sau báo "đã
                // thanh toán" và người dùng tưởng hệ thống lỗi.
                onPressed: canPay &&
                        !(_isQr && !_graceElapsed && _draftOrderId != null)
                    ? _confirm
                    : null,
              ),
              if (!_shiftOpen) ...[
                const SizedBox(height: 8),
                PhoneSecondaryButton(
                  label: t('Chưa mở ca — mở ca ngay'),
                  icon: Icons.lock_open_outlined,
                  onPressed: _moManCa,
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  /// Tóm tắt các dòng chia tiền (thay panel phương thức khi đang chia).
  Widget _splitSummaryPanel() {
    String labelFor(String key) => _payMethods
        .firstWhere((m) => m.key == key, orElse: () => _PayMethod(key, key, ''))
        .label;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t('ĐÃ CHIA TIỀN'),
              style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  color: DanColors.muted)),
          const SizedBox(height: 10),
          for (final l in _splitLines)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(t(labelFor(l.method)),
                      style: const TextStyle(
                          fontSize: 14, fontWeight: FontWeight.w700)),
                  Text(phoneMoney(l.amount),
                      style: const TextStyle(
                          fontSize: 15, fontWeight: FontWeight.w900)),
                ],
              ),
            ),
          const Divider(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(t('Tổng đã chia'),
                  style: const TextStyle(fontSize: 13, color: DanColors.muted)),
              Text(phoneMoney(_splitSum),
                  style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                      color: _splitSum == _total
                          ? const Color(0xFF047857)
                          : DanColors.late)),
            ],
          ),
          const SizedBox(height: 6),
          Text(
              t('Nhấn "Sửa chia tiền" để điều chỉnh, hoặc "Hoàn tất thanh toán" để chốt.'),
              style: const TextStyle(fontSize: 11.5, color: DanColors.faint)),
        ],
      ),
    );
  }

  Widget _cashPad() {
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
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
                          () => _cashInput = _total.round().toString()),
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
                          color: _cash > 0 ? DanColors.text : DanColors.faint)),
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
        ),
        Container(
          margin: const EdgeInsets.fromLTRB(10, 0, 10, 6),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: DanColors.surface2,
            borderRadius: BorderRadius.circular(9),
            border: Border.all(color: DanColors.border),
          ),
          child: Row(
            children: [
              Text(t('Khách đưa'),
                  style: const TextStyle(
                      fontSize: 12, fontWeight: FontWeight.w700)),
              const Spacer(),
              Text(phoneMoney(_cash),
                  key: const Key('cash-live-input'),
                  style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                      fontFeatures: [FontFeature.tabularFigures()])),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  '${_change >= 0 ? t('Thối') : t('Thiếu')}: ${phoneMoney(_change.abs())}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.right,
                  style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: _change >= 0
                          ? const Color(0xFF047857)
                          : const Color(0xFFD94A4A)),
                ),
              ),
            ],
          ),
        ),
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
        _cashInput = _cashInput.isEmpty
            ? ''
            : _cashInput.substring(0, _cashInput.length - 1);
      } else {
        final next = _cashInput + k;
        // Chặn ở 10 chữ số — quá số này chắc chắn là bấm nhầm.
        if (next.length <= 10) _cashInput = next;
      }
    });
  }

  /// KHỐI QR — GIỮA MÀN, CHỈ MÃ VÀ SỐ TIỀN.
  ///
  /// Khách đang cầm điện thoại chờ quét: mã phải to, nằm giữa, không có gì
  /// khác chen vào. Số tài khoản / tên ngân hàng đã nằm trong chính mã QR nên
  /// bày thêm ra chỉ làm rối. Duy nhất giữ lại NỘI DUNG CHUYỂN KHOẢN, vì đó là
  /// thứ ngân hàng dùng để khớp và tự đóng bill.
  Widget _qrPanel() {
    final img = '${_qrData?['imageUrl'] ?? ''}';
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
      child: Column(
        children: [
          Container(
            width: 248,
            height: 248,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: DanColors.border),
              borderRadius: BorderRadius.circular(12),
            ),
            child: _qrLoading && img.isEmpty
                ? const CircularProgressIndicator()
                : (img.isEmpty
                    ? const Icon(Icons.qr_code_2,
                        size: 92, color: DanColors.border2)
                    : Padding(
                        padding: const EdgeInsets.all(8),
                        child: Image.network(img,
                            fit: BoxFit.contain,
                            errorBuilder: (_, __, ___) => const Icon(
                                Icons.qr_code_2,
                                size: 92,
                                color: DanColors.border2)),
                      )),
          ),
          const SizedBox(height: 14),
          Text(phoneMoney(_total),
              style: const TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -.4,
                  fontFeatures: [FontFeature.tabularFigures()])),
          const SizedBox(height: 4),
          Text(t('Quét mã để chuyển khoản'),
              style: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: DanColors.muted)),
          if (_qrError != null) ...[
            const SizedBox(height: 12),
            Text(_qrError!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontSize: 12,
                    height: 1.5,
                    fontWeight: FontWeight.w700,
                    color: Color(0xFFD94A4A))),
            const SizedBox(height: 10),
            PhoneSecondaryButton(
                label: t('Tạo lại mã'),
                icon: Icons.refresh,
                onPressed: _qrLoading ? null : _refreshQr),
          ] else if (_draftOrderId != null && _qrReference.isNotEmpty) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              decoration: BoxDecoration(
                  color: const Color(0xFFFFF6E4),
                  borderRadius: BorderRadius.circular(99)),
              child: Text(
                  '${t('Nội dung')} $_qrReference · ${t('bill tự đóng khi ngân hàng xác nhận')}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFFB4740A))),
            ),
            const SizedBox(height: 10),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2)),
                const SizedBox(width: 8),
                Text(t('Luôn chờ ngân hàng xác nhận...'),
                    style: const TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                        color: DanColors.brand)),
              ],
            ),
          ] else if (_qrData != null) ...[
            // Không có đơn thật trên server → ngân hàng KHÔNG có gì để khớp.
            // Nói thẳng, thay vì để thu ngân đứng chờ một thứ không bao giờ tới.
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              decoration: BoxDecoration(
                  color: const Color(0xFFFFF1F1),
                  borderRadius: BorderRadius.circular(99)),
              child: Text(
                  t(
                      'Chưa tạo được đơn — bill KHÔNG tự đóng, phải bấm xác nhận'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFFD94A4A))),
            ),
          ],
          const SizedBox(height: 12),
          TemporaryTransferConfirmButton(
            onPressed: _paying ? null : _confirm,
          ),
        ],
      ),
    );
  }

  Widget _nonCashPanel() {
    final m = _payMethods.firstWhere((e) => e.key == _method,
        orElse: () => const _PayMethod('', '', ''));
    return Padding(
      padding: const EdgeInsets.all(22),
      child: Column(
        children: [
          Icon(m.icon, size: 110, color: DanColors.border2),
          const SizedBox(height: 14),
          Text(
              switch (m.kind) {
                'pos' => t('Quẹt thẻ trên máy POS rồi bấm xác nhận'),
                'voucher' => t('Nhận voucher của khách rồi bấm xác nhận'),
                _ => t('Khách trả bằng ${m.label} rồi bấm xác nhận'),
              },
              textAlign: TextAlign.center,
              style:
                  const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Text(t('Số tiền: ${phoneMoney(_total)}'),
              style: const TextStyle(fontSize: 12, color: DanColors.muted)),
        ],
      ),
    );
  }

  // ── Màn HOÀN TẤT ─────────────────────────────────────────────────────────
  Widget _buildDone() {
    final r = _receipt ?? const {};
    final billNo = '${r['bill_no'] ?? r['number'] ?? ''}';
    final change = _method == 'cash' ? (_cash - _total).clamp(0, 1 << 62) : 0;

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
                child:
                    const Icon(Icons.check, size: 30, color: Color(0xFF047857)),
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
                    if (_customer != null)
                      PhoneKv(t('Khách hàng'), _customer!.title),
                    PhoneKv(t('Khách cần trả'), phoneMoney(_total)),
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
              Text(t('Bill được gửi tới máy in tự động. In lỗi KHÔNG tạo giao dịch thứ hai — vào Hóa đơn để in lại.'),
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
  final String imageUrl;
  final int qtyInCart;
  final VoidCallback onTap;

  const _SkuCard({
    required this.sku,
    required this.imageUrl,
    required this.qtyInCart,
    required this.onTap,
  });

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
                    border: Border(bottom: BorderSide(color: DanColors.border)),
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
                                child: Image.network(imageUrl,
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
                                fontFeatures: [FontFeature.tabularFigures()])),
                        const SizedBox(height: 2),
                        Text('${t('Tồn')} ${phoneInt(sku.stock)} ${sku.unit}',
                            style: TextStyle(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w700,
                                color: out ? DanColors.late : DanColors.muted)),
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
  final bool hasPromotion;
  final bool promotionSelected;
  final VoidCallback onPromotion;
  final VoidCallback onEditPrice;
  final VoidCallback onEditNote;

  const _CartRowCard(
      {required this.line,
      required this.onMinus,
      required this.onPlus,
      required this.onDelete,
      required this.hasPromotion,
      required this.promotionSelected,
      required this.onPromotion,
      required this.onEditPrice,
      required this.onEditNote});

  @override
  Widget build(BuildContext context) {
    final s = line.sku;
    final doiGia = line.hasPriceOverride;
    final donGia = line.effectivePrice;
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
                    Row(children: [
                      Expanded(
                          child: Text(s.name,
                              style: const TextStyle(
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w800,
                                  height: 1.3))),
                      if (hasPromotion)
                        IconButton(
                          tooltip: t('Chọn khuyến mãi'),
                          visualDensity: VisualDensity.compact,
                          onPressed: onPromotion,
                          icon: Icon(Icons.card_giftcard,
                              size: 21,
                              color: promotionSelected
                                  ? DanColors.brand
                                  : DanColors.muted),
                        ),
                    ]),
                    const SizedBox(height: 3),
                    // Chạm vào đơn giá để sửa (cần PIN Quản lý). Có sửa thì hiện
                    // giá gốc gạch ngang + giá mới, đúng như bản tablet.
                    InkWell(
                      onTap: onEditPrice,
                      borderRadius: BorderRadius.circular(4),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                          if (doiGia) ...[
                            Text('${phoneMoney(s.price)}',
                                style: const TextStyle(
                                    fontSize: 10.5,
                                    color: DanColors.faint,
                                    decoration: TextDecoration.lineThrough)),
                            const SizedBox(width: 4),
                            Text('${phoneMoney(donGia)}/${s.unit}',
                                style: const TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w800,
                                    color: DanColors.brand)),
                          ] else
                            Text('${phoneMoney(s.price)}/${s.unit}',
                                style: const TextStyle(
                                    fontSize: 10.5, color: DanColors.faint)),
                          const SizedBox(width: 4),
                          Icon(Icons.edit,
                              size: 12,
                              color: DanColors.brand.withValues(alpha: .55)),
                        ]),
                      ),
                    ),
                    if ((line.note ?? '').isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text('${t('Ghi chú')}: ${line.note}',
                            style: const TextStyle(
                                fontSize: 10.5,
                                color: DanColors.muted,
                                fontStyle: FontStyle.italic)),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Text(phoneMoney(line.lineTotal),
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
                  child: Text('${t('Tồn')} ${phoneInt(s.stock)}',
                      textAlign: TextAlign.right,
                      style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: DanColors.faint)),
                ),
                PhoneIconButton(
                    icon: Icons.sticky_note_2_outlined,
                    color: (line.note ?? '').isNotEmpty
                        ? DanColors.brand
                        : DanColors.faint,
                    onTap: onEditNote),
                const SizedBox(width: 2),
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

/// Nút quét mã nằm TRONG ô tìm, thay chỗ của icon kính lúp cũ.
///
/// Vùng chạm 40x40 (không phải cỡ icon 18px) — ngón tay đeo găng hoặc ướt vẫn
/// bấm trúng, đúng kỷ luật vùng chạm lớn của bản điện thoại.
class _NutQuet extends StatelessWidget {
  final VoidCallback onTap;
  const _NutQuet({required this.onTap});

  @override
  Widget build(BuildContext context) {
    // Máy không có camera (chạy thử trên desktop) thì giữ icon cũ, khỏi dựng
    // một cái nút bấm vào không có gì xảy ra.
    if (!kCameraScanSupported) {
      return const Icon(Icons.search, size: 18, color: DanColors.faint);
    }
    return InkResponse(
      onTap: onTap,
      radius: 22,
      child: const SizedBox(
        width: 40,
        height: 40,
        child: Icon(Icons.qr_code_scanner, size: 21, color: DanColors.brand),
      ),
    );
  }
}

/// Dòng bấm được trong giỏ (khách hàng, voucher) — nhãn + phụ đề + nút đổi.
class _KhachRow extends StatelessWidget {
  final String label;
  final String sub;
  final VoidCallback onTap;
  final IconData icon;
  final String? action;

  const _KhachRow(
      {required this.label,
      required this.sub,
      required this.onTap,
      this.icon = Icons.person_outline,
      this.action});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: DanColors.surface,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            border: Border.all(color: DanColors.border),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            children: [
              Icon(icon, size: 19, color: DanColors.muted),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 13.5, fontWeight: FontWeight.w800)),
                    if (sub.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(sub,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 11, color: DanColors.muted)),
                      ),
                  ],
                ),
              ),
              Text(action ?? t('Đổi'),
                  style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: DanColors.brand)),
              const SizedBox(width: 4),
              const Icon(Icons.chevron_right, size: 17, color: DanColors.faint),
            ],
          ),
        ),
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
