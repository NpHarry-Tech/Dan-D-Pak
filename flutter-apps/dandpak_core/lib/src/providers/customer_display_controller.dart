import 'package:flutter/foundation.dart';

import '../models/pos_models.dart';
import '../screens/customer_display/customer_display_screen.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';
import 'pos_provider.dart';

/// Drives the customer-facing 2nd screen. It listens to [PosProvider] and maps
/// the live cart into an idle/order snapshot; the payment flow calls
/// [showPayment]/[markPaid] to take over with a QR then confirm. Ad images +
/// slideshow interval come from the `customer_display` app-setting.
class CustomerDisplayController extends ChangeNotifier {
  final ApiService api;
  PosProvider? _pos;
  CustomerDisplayData _data = const CustomerDisplayData();
  CustomerAdConfig _ads = const CustomerAdConfig();
  bool _enabled = false;
  bool _paymentOverride = false; // payment view ignores cart-driven updates
  bool _salesMirrorPaused = false;
  bool _retailMirrorActive = false;
  CustomerDisplayData? _retailSnapshot;
  String _storeName = 'Dan D Pak';

  CustomerDisplayController({required this.api}) {
    // Realtime "paid" for QR payments: when a bank/QR payment is confirmed
    // (SePay/Casso/payOS webhook → server emits payment:done) and we're showing
    // the payment QR, flip the customer screen to the paid confirmation.
    SocketService().addListener(_onSocket);
  }

  void _onSocket(String event, dynamic payload) {
    if (event == 'payment:done' && _paymentOverride && !_data.paid) {
      markPaid();
    }
  }

  CustomerDisplayData get data => _data;
  CustomerAdConfig get ads => _ads;
  bool get enabled => _enabled;

  void showIdle({bool pauseSalesMirrors = false}) {
    _paymentOverride = false;
    _salesMirrorPaused = pauseSalesMirrors;
    _retailMirrorActive = false;
    _retailSnapshot = null;
    _data = CustomerDisplayData(
      mode: CustomerDisplayMode.idle,
      storeName: _storeName,
    );
    notifyListeners();
  }

  void resumeSalesMirror() {
    if (!_salesMirrorPaused) return;
    _salesMirrorPaused = false;
    _rebuildFromPos();
  }

  void setStoreName(String name) {
    if (name.trim().isEmpty || name == _storeName) return;
    _storeName = name.trim();
    if (!_paymentOverride) _rebuildFromPos();
  }

  void attach(PosProvider pos) {
    if (identical(_pos, pos)) return;
    _pos?.removeListener(_onPos);
    _pos = pos;
    _pos!.addListener(_onPos);
    _onPos();
  }

  Future<void> loadConfig() async {
    try {
      final cd = await api.getCustomerDisplaySettings();
      final imgs = (cd['images'] is List)
          ? (cd['images'] as List)
              .map((e) => e.toString())
              .where((e) => e.isNotEmpty)
              .toList()
          : <String>[];
      _enabled = cd['enabled'] == true;
      _ads = CustomerAdConfig(
        images: imgs,
        secondsPerImage: (cd['secondsPerImage'] is num)
            ? (cd['secondsPerImage'] as num).toInt()
            : 20,
      );
      notifyListeners();
    } catch (_) {
      // Non-fatal: display just falls back to logo-only idle.
    }
  }

  void _onPos() {
    if (_paymentOverride || _retailMirrorActive || _salesMirrorPaused) return;
    _rebuildFromPos();
  }

  void _rebuildFromPos() {
    if (_salesMirrorPaused) return;
    final pos = _pos;
    if (pos == null) return;
    final cart = pos.cart;
    if (cart.isEmpty) {
      _data = CustomerDisplayData(
          mode: CustomerDisplayMode.idle, storeName: _storeName);
    } else {
      _data = CustomerDisplayData(
        mode: CustomerDisplayMode.order,
        storeName: _storeName,
        items: [
          for (final c in cart)
            CustomerLine(
              name: c.item.name,
              options: _optionsOf(c),
              qty: c.qty,
              unitPrice: c.item.price,
              lineTotal: c.totalPrice,
            ),
        ],
        subtotal: pos.cartSubtotal,
        discount: pos.activeDiscount,
        discountLabel: 'Giảm giá',
        total: pos.cartTotal,
      );
    }
    notifyListeners();
  }

  String _optionsOf(CartItem c) {
    final parts = <String>[
      for (final m in c.selectedModifiers)
        if (m.name.trim().isNotEmpty) m.name,
      if (c.notes.trim().isNotEmpty) c.notes,
    ];
    return parts.join(' · ');
  }

  // ── Payment flow (called from the payment dialog) ─────────────────────────

  /// Show the payment view with a QR. Pass either [qrData] (raw payload → we
  /// draw the QR) or [qrImageUrl] (a ready image data-url / http url).
  void showPayment({
    required String method,
    required num total,
    String qrData = '',
    String qrImageUrl = '',
  }) {
    _paymentOverride = true;
    _data = CustomerDisplayData(
      mode: CustomerDisplayMode.payment,
      storeName: _storeName,
      paymentMethod: method,
      qrData: qrData,
      qrImageUrl: qrImageUrl,
      total: total,
    );
    notifyListeners();
  }

  void showRetailCart({
    required List<CustomerLine> items,
    required num subtotal,
    required num discount,
    required num tax,
    required num total,
    String discountLabel = 'Khuyến mãi / giảm giá',
  }) {
    if (_paymentOverride || _salesMirrorPaused) return;
    _retailMirrorActive = items.isNotEmpty;
    _retailSnapshot = items.isEmpty
        ? CustomerDisplayData(
            mode: CustomerDisplayMode.idle,
            storeName: _storeName,
          )
        : CustomerDisplayData(
            mode: CustomerDisplayMode.order,
            storeName: _storeName,
            items: items,
            subtotal: subtotal,
            discount: discount,
            tax: tax,
            total: total,
            discountLabel: discountLabel,
          );
    _data = _retailSnapshot!;
    notifyListeners();
  }

  void clearRetailMirror() {
    _retailMirrorActive = false;
    _retailSnapshot = null;
    if (!_paymentOverride) _rebuildFromPos();
  }

  void markPaid() {
    _data = CustomerDisplayData(
      mode: CustomerDisplayMode.payment,
      storeName: _storeName,
      total: _data.total,
      paid: true,
    );
    notifyListeners();
  }

  /// Leave the payment view and resume mirroring the cart.
  void resume() {
    _paymentOverride = false;
    if (_retailMirrorActive && _retailSnapshot != null) {
      _data = _retailSnapshot!;
      notifyListeners();
      return;
    }
    _rebuildFromPos();
  }

  @override
  void dispose() {
    _pos?.removeListener(_onPos);
    SocketService().removeListener(_onSocket);
    super.dispose();
  }
}
