import 'package:flutter_test/flutter_test.dart';
import 'package:dandpak_core/src/services/tenant_scope.dart';

const prod = 'https://api.dandpakpos.io.vn';
const review = 'https://api-review.dandpakpos.io.vn';

void main() {
  group('TenantScope.resolveServerUrl (§E precedence)', () {
    test('TEST4/5: fresh install → build default (review→api-review, prod→api)',
        () {
      expect(
          TenantScope.originOf(TenantScope.resolveServerUrl(
              savedForBuild: null,
              legacyUnscoped: null,
              buildDefaultUrl: review)),
          'https://api-review.dandpakpos.io.vn');
      expect(
          TenantScope.originOf(TenantScope.resolveServerUrl(
              savedForBuild: null,
              legacyUnscoped: null,
              buildDefaultUrl: prod)),
          'https://api.dandpakpos.io.vn');
    });

    test(
        'TEST6: review build + stale PRODUCTION legacy → KHÔNG bị đưa về production',
        () {
      final r = TenantScope.resolveServerUrl(
          savedForBuild: null, legacyUnscoped: prod, buildDefaultUrl: review);
      expect(TenantScope.originOf(r), 'https://api-review.dandpakpos.io.vn');
    });

    test('legacy CÙNG origin build default → migrate an toàn', () {
      final r = TenantScope.resolveServerUrl(
          savedForBuild: null, legacyUnscoped: prod, buildDefaultUrl: prod);
      expect(TenantScope.originOf(r), 'https://api.dandpakpos.io.vn');
    });

    test('savedForBuild (user đổi thủ công) thắng legacy', () {
      final r = TenantScope.resolveServerUrl(
          savedForBuild: review, legacyUnscoped: prod, buildDefaultUrl: review);
      expect(TenantScope.originOf(r), 'https://api-review.dandpakpos.io.vn');
    });

    test('host LAN/IP hạ tầng bị bỏ qua → build default', () {
      final r = TenantScope.resolveServerUrl(
          savedForBuild: 'http://127.0.0.1:3000',
          legacyUnscoped: 'http://42.96.18.70:3000',
          buildDefaultUrl: review);
      expect(TenantScope.originOf(r), 'https://api-review.dandpakpos.io.vn');
    });
  });

  group('TenantScope namespacing (§B/§C — TEST1/3 isolation)', () {
    test('tenantKey khác nhau theo origin → token/branch KHÔNG dùng chung', () {
      final aTok =
          TenantScope.tenantKey(TenantScope.originOf(prod), 'auth_token');
      final bTok =
          TenantScope.tenantKey(TenantScope.originOf(review), 'auth_token');
      expect(aTok == bTok, false);
      expect(aTok, 't::https://api.dandpakpos.io.vn::auth_token');
      expect(bTok, 't::https://api-review.dandpakpos.io.vn::auth_token');
    });

    test(
        'serverUrlKey khác nhau theo build → review/prod build không đè server_url',
        () {
      expect(TenantScope.serverUrlKey(prod) == TenantScope.serverUrlKey(review),
          false);
    });

    test('originChanged phát hiện đổi tenant', () {
      expect(TenantScope.originChanged(prod, review), true);
      expect(TenantScope.originChanged(prod, '$prod/'), false);
    });
  });
}
