import 'package:intl/intl.dart';

import 'translation.dart';

/// Canonical user-facing clock for Dan-D Pak.
///
/// API/DB timestamps remain UTC ISO-8601. Vietnam has used UTC+07:00 without
/// daylight-saving time since 1975, so converting from UTC explicitly keeps
/// Phone/Tablet/Desktop identical even when the device timezone is wrong.
///
/// Display order stays dd/MM/yyyy for vi/en; Chinese UI uses the 年/月/日 order
/// readers there expect (L10n.currentLocale == 'zh').
class BusinessDateTime {
  BusinessDateTime._();

  static const vietnamOffset = Duration(hours: 7);
  static final _date = DateFormat('dd/MM/yyyy');
  static final _dateZh = DateFormat('yyyy年MM月dd日');
  static final _dateTime = DateFormat('dd/MM/yyyy HH:mm');
  static final _dateTimeZh = DateFormat('yyyy年MM月dd日 HH:mm');
  static final _dateTimeSeconds = DateFormat('dd/MM/yyyy HH:mm:ss');
  static final _dateTimeSecondsZh = DateFormat('yyyy年MM月dd日 HH:mm:ss');
  static final _time = DateFormat('HH:mm');
  static final _timeSeconds = DateFormat('HH:mm:ss');
  static bool get _zh => L10n.currentLocale == 'zh';

  static DateTime? parseApi(dynamic value) {
    if (value == null) return null;
    final raw = value.toString().trim();
    if (raw.isEmpty) return null;
    final parsed = DateTime.tryParse(raw);
    if (parsed == null) return null;
    return parsed.toUtc().add(vietnamOffset);
  }

  static DateTime now() => DateTime.now().toUtc().add(vietnamOffset);

  /// Converts a Vietnam wall-clock value selected in the UI back to canonical
  /// UTC for API persistence, independent of the device timezone.
  static String toApiUtc(DateTime businessWallClock) {
    final wallAsUtc = DateTime.utc(
      businessWallClock.year,
      businessWallClock.month,
      businessWallClock.day,
      businessWallClock.hour,
      businessWallClock.minute,
      businessWallClock.second,
      businessWallClock.millisecond,
      businessWallClock.microsecond,
    );
    return wallAsUtc.subtract(vietnamOffset).toIso8601String();
  }

  static String date(dynamic value, {String fallback = ''}) {
    final raw = value?.toString().trim() ?? '';
    final dateOnly = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(raw);
    if (dateOnly != null) {
      return _zh
          ? '${dateOnly.group(1)}年${dateOnly.group(2)}月${dateOnly.group(3)}日'
          : '${dateOnly.group(3)}/${dateOnly.group(2)}/${dateOnly.group(1)}';
    }
    final parsed = parseApi(value);
    if (parsed == null) return fallback;
    return _zh ? _dateZh.format(parsed) : _date.format(parsed);
  }

  static String dateTime(dynamic value, {String fallback = ''}) {
    final parsed = parseApi(value);
    if (parsed == null) return fallback;
    return _zh ? _dateTimeZh.format(parsed) : _dateTime.format(parsed);
  }

  static String dateTimeSeconds(dynamic value, {String fallback = ''}) {
    final parsed = parseApi(value);
    if (parsed == null) return fallback;
    return _zh
        ? _dateTimeSecondsZh.format(parsed)
        : _dateTimeSeconds.format(parsed);
  }

  static String time(dynamic value, {String fallback = ''}) {
    final parsed = parseApi(value);
    return parsed == null ? fallback : _time.format(parsed);
  }

  static String timeSeconds(dynamic value, {String fallback = ''}) {
    final parsed = parseApi(value);
    return parsed == null ? fallback : _timeSeconds.format(parsed);
  }

  static String reportValue(String format, dynamic value) {
    if (format == 'date') return date(value, fallback: value?.toString() ?? '');
    if (format == 'datetime') {
      return dateTimeSeconds(value, fallback: value?.toString() ?? '');
    }
    if (format == 'time')
      return timeSeconds(value, fallback: value?.toString() ?? '');
    return value?.toString() ?? '';
  }
}
