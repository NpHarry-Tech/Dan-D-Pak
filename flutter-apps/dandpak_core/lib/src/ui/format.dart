import 'package:intl/intl.dart';

/// Shared number/money formatting that mirrors web `money()` / `moneyShort()`.
class Fmt {
  Fmt._();

  static final NumberFormat _decimal = NumberFormat.decimalPattern('vi-VN');

  /// "1.234.567đ" — Vietnamese grouped currency.
  static String money(num? value) {
    final v = value ?? 0;
    return '${_decimal.format(v.round())}đ';
  }

  /// Compact money for chart labels: 1.2M, 350K, 2B …
  static String moneyShort(num? value) {
    final v = (value ?? 0).toDouble();
    if (v >= 1e9) return '${(v / 1e9).toStringAsFixed(v >= 1e10 ? 0 : 1)}B';
    if (v >= 1e6) return '${(v / 1e6).toStringAsFixed(v >= 1e7 ? 0 : 1)}M';
    if (v >= 1e3) return '${(v / 1e3).round()}K';
    return v.round().toString();
  }

  /// Plain grouped integer ("1.234").
  static String int0(num? value) => _decimal.format((value ?? 0).round());

  static final DateFormat _hm = DateFormat('HH:mm');
  static final DateFormat _hms = DateFormat('HH:mm:ss');
  static final DateFormat _dmyHm = DateFormat('HH:mm dd/MM/yyyy');

  static String hm(DateTime t) => _hm.format(t);
  static String hms(DateTime t) => _hms.format(t);
  static String dmyHm(DateTime t) => _dmyHm.format(t);
}
