import 'package:dandpak_core/src/utils/business_datetime.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('UTC boundary converts to Vietnam business day', () {
    expect(BusinessDateTime.dateTimeSeconds('2026-08-25T16:59:59.000Z'),
        '25/08/2026 23:59:59');
    expect(BusinessDateTime.dateTimeSeconds('2026-08-25T17:00:00.000Z'),
        '26/08/2026 00:00:00');
  });

  test('canonical date, minute, second and time formats', () {
    const iso = '2026-08-25T16:59:59.000Z';
    expect(BusinessDateTime.date(iso), '25/08/2026');
    expect(BusinessDateTime.dateTime(iso), '25/08/2026 23:59');
    expect(BusinessDateTime.time(iso), '23:59');
    expect(BusinessDateTime.timeSeconds(iso), '23:59:59');
    expect(BusinessDateTime.date('2026-08-25'), '25/08/2026');
  });

  test('null and invalid values fail gracefully', () {
    expect(BusinessDateTime.dateTime(null), '');
    expect(BusinessDateTime.dateTime('not-a-date'), '');
    expect(BusinessDateTime.reportValue('datetime', 'legacy'), 'legacy');
  });

  test('Vietnam wall-clock converts back to canonical UTC independent of host',
      () {
    expect(
      BusinessDateTime.toApiUtc(DateTime(2026, 8, 26, 0, 0)),
      '2026-08-25T17:00:00.000Z',
    );
  });
}
