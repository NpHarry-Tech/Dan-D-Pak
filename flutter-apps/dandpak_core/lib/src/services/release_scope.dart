import '../api_client.dart';

/// Identity of server-dependent release state.
///
/// The full normalized origin is intentional: scheme and non-default port are
/// security boundaries just like the host. Review, production and custom
/// Store Edge servers must never share a release cache or download decision.
class ReleaseScope {
  const ReleaseScope({
    required this.serverOrigin,
    required this.environment,
    required this.platform,
  });

  factory ReleaseScope.forServer(String baseUrl, String platform) {
    final origin = normalizedServerOrigin(baseUrl);
    final host = Uri.parse(origin).host.toLowerCase();
    final environment = host == 'api.dandpakpos.io.vn'
        ? 'production'
        : host == 'api-review.dandpakpos.io.vn' || host.contains('review')
            ? 'review'
            : 'custom';
    return ReleaseScope(
      serverOrigin: origin,
      environment: environment,
      platform: platform.trim().toLowerCase(),
    );
  }

  final String serverOrigin;
  final String environment;
  final String platform;

  String get key => '$serverOrigin|$environment|$platform';
  String get storagePrefix => 'release::$key::';
  String storageKey(String field) => '$storagePrefix$field';

  static String normalizedServerOrigin(String baseUrl) {
    final normalized = DanDpakApiClient.normalizeBaseUrl(baseUrl);
    final uri = Uri.parse(normalized);
    final scheme = uri.scheme.toLowerCase();
    final host = uri.host.toLowerCase();
    final defaultPort = (scheme == 'https' && uri.port == 443) ||
        (scheme == 'http' && uri.port == 80);
    final port = uri.hasPort && !defaultPort ? ':${uri.port}' : '';
    return '$scheme://$host$port';
  }
}

class ReleaseDecision {
  const ReleaseDecision({
    required this.updateAvailable,
    required this.mandatoryGate,
  });

  final bool updateAvailable;
  final bool mandatoryGate;
}

ReleaseDecision evaluateRelease({
  required int currentBuild,
  required int serverBuild,
  required bool serverMandatory,
}) {
  final newer = serverBuild > currentBuild;
  return ReleaseDecision(
    updateAvailable: newer,
    mandatoryGate: newer && serverMandatory,
  );
}

bool isDownloadUrlSafeForScope(String rawUrl, ReleaseScope scope) {
  final value = rawUrl.trim();
  if (value.isEmpty) return false;
  final uri = Uri.tryParse(value);
  if (uri == null) return false;
  if (!uri.hasScheme) return value.startsWith('/') && !value.startsWith('//');
  if (!{'http', 'https'}.contains(uri.scheme.toLowerCase())) return false;
  return ReleaseScope.normalizedServerOrigin(value) == scope.serverOrigin;
}
