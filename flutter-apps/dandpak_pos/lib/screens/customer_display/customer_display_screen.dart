import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../ui/app_theme.dart';

enum CustomerDisplayMode { idle, order, payment }

num _numOf(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;

class CustomerLine {
  final String name;
  final String options;
  final String promoText;
  final int qty;
  final num unitPrice;
  final num lineTotal;

  const CustomerLine({
    required this.name,
    this.options = '',
    this.promoText = '',
    required this.qty,
    required this.unitPrice,
    required this.lineTotal,
  });

  Map<String, dynamic> toJson() => {
        'name': name,
        'options': options,
        'promoText': promoText,
        'qty': qty,
        'unitPrice': unitPrice,
        'lineTotal': lineTotal,
      };

  factory CustomerLine.fromJson(Map<String, dynamic> j) => CustomerLine(
        name: (j['name'] ?? '').toString(),
        options: (j['options'] ?? '').toString(),
        promoText: (j['promoText'] ?? '').toString(),
        qty: (j['qty'] is num) ? (j['qty'] as num).toInt() : 1,
        unitPrice: _numOf(j['unitPrice']),
        lineTotal: _numOf(j['lineTotal']),
      );
}

class CustomerDisplayData {
  final CustomerDisplayMode mode;
  final String storeName;
  final List<CustomerLine> items;
  final num subtotal;
  final num discount;
  final num tax;
  final num total;
  final String discountLabel;
  final String paymentMethod;
  final String qrData;
  final String qrImageUrl;
  final bool paid;

  const CustomerDisplayData({
    this.mode = CustomerDisplayMode.idle,
    this.storeName = 'Dan D Pak',
    this.items = const [],
    this.subtotal = 0,
    this.discount = 0,
    this.tax = 0,
    this.total = 0,
    this.discountLabel = 'Khuyến mãi / giảm giá',
    this.paymentMethod = '',
    this.qrData = '',
    this.qrImageUrl = '',
    this.paid = false,
  });

  Map<String, dynamic> toJson() => {
        'mode': mode.name,
        'storeName': storeName,
        'items': items.map((e) => e.toJson()).toList(),
        'subtotal': subtotal,
        'discount': discount,
        'tax': tax,
        'total': total,
        'discountLabel': discountLabel,
        'paymentMethod': paymentMethod,
        'qrData': qrData,
        'qrImageUrl': qrImageUrl,
        'paid': paid,
      };

  factory CustomerDisplayData.fromJson(Map<String, dynamic> j) =>
      CustomerDisplayData(
        mode: CustomerDisplayMode.values.firstWhere(
          (m) => m.name == j['mode'],
          orElse: () => CustomerDisplayMode.idle,
        ),
        storeName: (j['storeName'] ?? 'Dan D Pak').toString(),
        items: (j['items'] is List)
            ? (j['items'] as List)
                .map((e) => CustomerLine.fromJson(Map<String, dynamic>.from(e)))
                .toList()
            : const [],
        subtotal: _numOf(j['subtotal']),
        discount: _numOf(j['discount']),
        tax: _numOf(j['tax']),
        total: _numOf(j['total']),
        discountLabel:
            (j['discountLabel'] ?? 'Khuyến mãi / giảm giá').toString(),
        paymentMethod: (j['paymentMethod'] ?? '').toString(),
        qrData: (j['qrData'] ?? '').toString(),
        qrImageUrl: (j['qrImageUrl'] ?? '').toString(),
        paid: j['paid'] == true,
      );
}

class CustomerAdConfig {
  final List<String> images;
  final int secondsPerImage;

  const CustomerAdConfig({this.images = const [], this.secondsPerImage = 20});

  Map<String, dynamic> toJson() =>
      {'images': images, 'secondsPerImage': secondsPerImage};

  factory CustomerAdConfig.fromJson(Map<String, dynamic> j) => CustomerAdConfig(
        images: (j['images'] is List)
            ? (j['images'] as List).map((e) => e.toString()).toList()
            : const [],
        secondsPerImage: (j['secondsPerImage'] is num)
            ? (j['secondsPerImage'] as num).toInt()
            : 20,
      );
}

class CustomerDisplayScreen extends StatefulWidget {
  final CustomerDisplayData data;
  final CustomerAdConfig ads;

  const CustomerDisplayScreen({
    super.key,
    required this.data,
    this.ads = const CustomerAdConfig(),
  });

  @override
  State<CustomerDisplayScreen> createState() => _CustomerDisplayScreenState();
}

class _CustomerDisplayScreenState extends State<CustomerDisplayScreen> {
  Timer? _adTimer;
  int _adIndex = 0;

  @override
  void initState() {
    super.initState();
    _restartAdTimer();
  }

  @override
  void didUpdateWidget(covariant CustomerDisplayScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_adSignature(oldWidget.ads) != _adSignature(widget.ads)) {
      _adIndex = 0;
      _restartAdTimer();
    }
  }

  String _adSignature(CustomerAdConfig ads) =>
      '${ads.secondsPerImage}:${ads.images.length}:${ads.images.map((e) => e.hashCode).join(',')}';

  void _restartAdTimer() {
    _adTimer?.cancel();
    if (widget.ads.images.length <= 1) return;
    final secs = widget.ads.secondsPerImage.clamp(5, 120);
    _adTimer = Timer.periodic(Duration(seconds: secs), (_) {
      if (mounted) {
        setState(() => _adIndex = (_adIndex + 1) % widget.ads.images.length);
      }
    });
  }

  @override
  void dispose() {
    _adTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.data;
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: switch (d.mode) {
        CustomerDisplayMode.idle => _idle(),
        CustomerDisplayMode.order => _order(d),
        CustomerDisplayMode.payment => _payment(d),
      },
    );
  }

  // Màn hình phụ chạy kiosk toàn màn hình: quảng cáo phủ 100%, không vẽ đè
  // thanh thương hiệu/footer nào — nội dung liên hệ/QR nằm trong chính ảnh ads.
  Widget _idle() => _adCanvas(fit: BoxFit.cover);

  Widget _order(CustomerDisplayData d) {
    return SafeArea(
      child: Row(
        children: [
          Expanded(
            flex: 5,
            child: _adCanvas(fit: BoxFit.cover),
          ),
          Expanded(
            flex: 6,
            child: Container(
              color: DanColors.bg,
              child: Column(
                children: [
                  _title('KIỂM TRA ĐƠN HÀNG'),
                  const _OrderHeaderRow(),
                  const Divider(height: 1, color: DanColors.border),
                  Expanded(
                    child: d.items.isEmpty
                        ? const Center(
                            child: Text('Đang chọn món...',
                                style: TextStyle(
                                    fontSize: 22, color: DanColors.muted)))
                        : ListView.separated(
                            padding: const EdgeInsets.symmetric(horizontal: 22),
                            itemCount: d.items.length,
                            separatorBuilder: (_, __) => const Divider(
                                height: 1, color: DanColors.border),
                            itemBuilder: (_, i) => _orderRow(d.items[i]),
                          ),
                  ),
                  _totals(d),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _payment(CustomerDisplayData d) {
    if (d.paid) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.check_circle, size: 140, color: DanColors.done),
            const SizedBox(height: 16),
            const Text('ĐÃ THANH TOÁN',
                style: TextStyle(fontSize: 34, fontWeight: FontWeight.w900)),
            const SizedBox(height: 8),
            Text('Cảm ơn quý khách • ${_money(d.total)}',
                style: const TextStyle(fontSize: 20, color: DanColors.muted)),
          ],
        ),
      );
    }
    return SafeArea(
      child: Row(
        children: [
          Expanded(
            flex: 5,
            child: _adCanvas(fit: BoxFit.cover),
          ),
          Expanded(
            flex: 6,
            child: Center(
              child: Container(
                width: 430,
                padding: const EdgeInsets.all(26),
                decoration: BoxDecoration(
                  color: DanColors.surface,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: DanColors.border),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: .08),
                      blurRadius: 24,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      d.paymentMethod.isEmpty
                          ? 'Quét mã để thanh toán'
                          : d.paymentMethod,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                          fontSize: 22, fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 18),
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: DanColors.border),
                      ),
                      child: _qr(d),
                    ),
                    const SizedBox(height: 18),
                    Text('SỐ TIỀN: ${_money(d.total)}',
                        style: const TextStyle(
                            fontSize: 26,
                            fontWeight: FontWeight.w900,
                            color: DanColors.brand)),
                    const SizedBox(height: 8),
                    const Text('Vui lòng kiểm tra đơn và thanh toán',
                        style: TextStyle(fontSize: 15, color: DanColors.muted)),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _adCanvas({BoxFit fit = BoxFit.contain}) {
    final imgs = widget.ads.images;
    if (imgs.isEmpty) return _adFallback();
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 450),
      child: SizedBox.expand(
        key: ValueKey('ad:$_adIndex:${imgs[_adIndex % imgs.length].hashCode}'),
        child: _adImage(imgs[_adIndex % imgs.length], fit: fit),
      ),
    );
  }

  Widget _adFallback() {
    return Container(
      color: DanColors.surface,
      alignment: Alignment.center,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Image.asset(
            'assets/web/assets/DanOnLogo.png',
            height: 180,
            fit: BoxFit.contain,
            errorBuilder: (_, __, ___) =>
                const Icon(Icons.storefront, size: 120, color: DanColors.faint),
          ),
          const SizedBox(height: 18),
          const Text('Chào mừng quý khách',
              style: TextStyle(fontSize: 26, fontWeight: FontWeight.w900)),
        ],
      ),
    );
  }

  Widget _adImage(String src, {required BoxFit fit}) {
    const decodeWidth = 1280;
    if (src.startsWith('data:image/')) {
      return Image.memory(
        _dataUrlBytes(src),
        fit: fit,
        cacheWidth: decodeWidth,
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) => const SizedBox.shrink(),
      );
    }
    return Image.network(
      src,
      fit: fit,
      cacheWidth: decodeWidth,
      gaplessPlayback: true,
      errorBuilder: (_, __, ___) => const SizedBox.shrink(),
    );
  }

  Widget _title(String text) {
    return Container(
      padding: const EdgeInsets.fromLTRB(22, 20, 22, 12),
      alignment: Alignment.centerLeft,
      child: Text(text,
          style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w900,
              color: DanColors.text)),
    );
  }

  Widget _orderRow(CustomerLine it) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 5,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(it.name,
                    style: const TextStyle(
                        fontSize: 18, fontWeight: FontWeight.w800)),
                if (it.options.isNotEmpty)
                  Text(it.options,
                      style: const TextStyle(
                          fontSize: 13.5, color: DanColors.muted)),
                if (it.promoText.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 3),
                    child: Text(it.promoText,
                        style: const TextStyle(
                            color: DanColors.doing,
                            fontSize: 13,
                            fontStyle: FontStyle.italic,
                            fontWeight: FontWeight.w700)),
                  ),
              ],
            ),
          ),
          Expanded(
            flex: 2,
            child: Text(_money(it.unitPrice),
                textAlign: TextAlign.right,
                style: const TextStyle(fontSize: 16)),
          ),
          Expanded(
            flex: 1,
            child: Text('${it.qty}',
                textAlign: TextAlign.center,
                style:
                    const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          ),
          Expanded(
            flex: 2,
            child: Text(_money(it.lineTotal),
                textAlign: TextAlign.right,
                style:
                    const TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
          ),
        ],
      ),
    );
  }

  Widget _totals(CustomerDisplayData d) {
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 22),
      decoration: const BoxDecoration(
        color: DanColors.surface,
        border: Border(top: BorderSide(color: DanColors.border)),
      ),
      child: Column(
        children: [
          _totalRow('Thành tiền', _money(d.subtotal)),
          _totalRow('VAT', d.tax > 0 ? _money(d.tax) : '0đ'),
          if (d.discount > 0)
            _totalRow(d.discountLabel, '- ${_money(d.discount)}'),
          const SizedBox(height: 8),
          Row(
            children: [
              const Expanded(
                child: Text('TỔNG CỘNG',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style:
                        TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
              ),
              const SizedBox(width: 14),
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerRight,
                  child: Text(_money(d.total),
                      style: const TextStyle(
                          fontSize: 30,
                          fontWeight: FontWeight.w900,
                          color: DanColors.brand)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _totalRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 16, color: DanColors.muted)),
          ),
          const SizedBox(width: 12),
          Text(value, style: const TextStyle(fontSize: 17)),
        ],
      ),
    );
  }

  Widget _qr(CustomerDisplayData d) {
    const double size = 300;
    if (d.qrImageUrl.startsWith('data:image/')) {
      return Image.memory(_dataUrlBytes(d.qrImageUrl),
          width: size, height: size, fit: BoxFit.contain);
    }
    if (d.qrImageUrl.startsWith('http')) {
      return Image.network(d.qrImageUrl,
          width: size, height: size, fit: BoxFit.contain);
    }
    return QrImageView(
      data: d.qrData.isEmpty ? ' ' : d.qrData,
      version: QrVersions.auto,
      size: size,
      padding: EdgeInsets.zero,
      backgroundColor: Colors.white,
    );
  }

  String _money(num v) {
    final negative = v < 0;
    final s = v.abs().round().toString();
    final b = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 == 0) b.write('.');
      b.write(s[i]);
    }
    return '${negative ? '-' : ''}$bđ';
  }
}

class _OrderHeaderRow extends StatelessWidget {
  const _OrderHeaderRow();

  @override
  Widget build(BuildContext context) {
    const style = TextStyle(
        fontSize: 13, fontWeight: FontWeight.w800, color: DanColors.muted);
    return Container(
      color: DanColors.surface,
      padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 10),
      child: const Row(
        children: [
          Expanded(flex: 5, child: Text('SẢN PHẨM', style: style)),
          Expanded(
              flex: 2,
              child: Text('ĐƠN GIÁ', textAlign: TextAlign.right, style: style)),
          Expanded(
              flex: 1,
              child: Text('SL', textAlign: TextAlign.center, style: style)),
          Expanded(
              flex: 2,
              child:
                  Text('THÀNH TIỀN', textAlign: TextAlign.right, style: style)),
        ],
      ),
    );
  }
}

Uint8List _dataUrlBytes(String dataUrl) {
  final comma = dataUrl.indexOf(',');
  return base64Decode(comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl);
}
