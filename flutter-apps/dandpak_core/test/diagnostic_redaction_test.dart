import 'package:dandpak_core/src/services/system_log.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('client diagnostic redaction never preserves token fragments', () {
    const token = 'abc1234567890.secret987654321';
    final output = SystemLog.redactDiagnostic(
        'Authorization: Bearer $token apiKey=live-key password=hunter2 pin=1234');
    for (final secret in [
      token,
      'abc123',
      '654321',
      'live-key',
      'hunter2',
      '1234'
    ]) {
      expect(output, isNot(contains(secret)));
    }
    expect(output, contains('REDACTED'));
  });

  test('client diagnostic redaction removes private key blocks', () {
    final output = SystemLog.redactDiagnostic('''
-----BEGIN PRIVATE KEY-----
actual-private-material
-----END PRIVATE KEY-----
''');
    expect(output, contains('REDACTED_PRIVATE_KEY'));
    expect(output, isNot(contains('actual-private-material')));
  });
}
