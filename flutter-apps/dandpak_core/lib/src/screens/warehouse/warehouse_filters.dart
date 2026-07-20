part of 'warehouse_screen.dart';

String _s(dynamic v) => v?.toString() ?? '';
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;
bool _b(dynamic v) => v == true || v == 1 || v == '1';

/// Resolve a stored relative asset path ("/assets/product-images/kv_x.jpg")
/// against the local-engine base URL, mirroring the web app.
String _assetUrl(String baseUrl, String value) {
  final raw = value.trim();
  if (raw.isEmpty || raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  return '$baseUrl${raw.startsWith('/') ? '' : '/'}$raw';
}

/// KiotViet VAT display: null / empty → "KCT" (không chịu thuế), else "8%".
String _vatLabel(dynamic v) {
  if (v == null || _s(v).isEmpty) return 'KCT';
  final n = _n(v);
  return n == 0 ? '0%' : '${n % 1 == 0 ? n.toInt() : n}%';
}

List<List<String>> get _issueReasons => [
      ['manual_issue', t('Xuất dùng nội bộ')],
      ['waste', t('Hao hụt / hủy')],
      ['damaged', t('Hỏng vỡ')],
      ['sample', t('Dùng mẫu')],
    ];
