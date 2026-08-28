import '../api_client.dart';

/// Client-side TENANT ISOLATION (§A–§F, §11/§12).
///
/// Server/base URL = TENANT IDENTITY phía client. Khác NORMALIZED ORIGIN (host)
/// = khác tenant → state nhạy cảm (token, branch, cache) KHÔNG được dùng chung.
/// Các hàm ở đây THUẦN (không I/O) để dễ test và tránh sai sót namespace.
class TenantScope {
  // Host "cục bộ/hạ tầng" — KHÔNG coi là một tenant server thật; luôn rơi về build
  // default (LAN edge dùng dart-define STORE_EDGE_URL, không phải URL đã lưu).
  static const _localLikeHosts = {'127.0.0.1', 'localhost', '42.96.18.70'};

  /// Full normalized origin (scheme + lowercase host + non-default port).
  static String originOf(String url) {
    final n = DanDpakApiClient.normalizeBaseUrl(url);
    final uri = Uri.tryParse(n);
    if (uri == null || uri.scheme.isEmpty || uri.host.isEmpty) return '';
    final scheme = uri.scheme.toLowerCase();
    final host = uri.host.toLowerCase();
    final defaultPort = (scheme == 'https' && uri.port == 443) ||
        (scheme == 'http' && uri.port == 80);
    final port = uri.hasPort && !defaultPort ? ':${uri.port}' : '';
    return '$scheme://$host$port';
  }

  static String hostOf(String url) =>
      (Uri.tryParse(DanDpakApiClient.normalizeBaseUrl(url))?.host ?? '')
          .toLowerCase();

  static bool isLocalLike(String hostOrUrl) {
    final h =
        hostOrUrl.contains('/') ? hostOf(hostOrUrl) : hostOrUrl.toLowerCase();
    return _localLikeHosts.contains(h);
  }

  /// Khoá lưu server_url THEO BUILD (review build vs production build không đè
  /// nhau) — review build (STORE_EDGE_URL=api-review) KHÔNG đọc nhầm server_url mà
  /// production build đã lưu trong cùng file prefs (§E).
  static String serverUrlKey(String buildDefaultUrl) =>
      'server_url@${originOf(buildDefaultUrl)}';

  /// Khoá state tenant-scoped theo origin HIỆN TẠI (auth_token, branch_id, cache…).
  static String tenantKey(String origin, String key) => 't::$origin::$key';

  static bool originChanged(String a, String b) => originOf(a) != originOf(b);

  /// Chọn server url lúc khởi động, theo thứ tự ưu tiên chống contamination:
  ///   1. server_url đã lưu THEO BUILD này (user từng đổi thủ công cho build này);
  ///   2. server_url legacy (không namespace) NHƯNG CÙNG origin với build default
  ///      → migrate an toàn (cùng tenant);
  ///   3. build default (STORE_EDGE_URL nếu review, else production) — KHÔNG mượn
  ///      origin của build khác.
  /// Host cục bộ/IP hạ tầng bị bỏ qua (rơi về build default).
  static String resolveServerUrl({
    required String? savedForBuild,
    required String? legacyUnscoped,
    required String buildDefaultUrl,
  }) {
    final def = DanDpakApiClient.normalizeBaseUrl(buildDefaultUrl);
    final defOrigin = originOf(def);

    String? pick(String? raw) {
      if (raw == null || raw.trim().isEmpty) return null;
      final n = DanDpakApiClient.normalizeBaseUrl(raw);
      final h = hostOf(n);
      if (h.isEmpty || _localLikeHosts.contains(h)) return null;
      return n;
    }

    final saved = pick(savedForBuild);
    if (saved != null) return saved;
    final legacy = pick(legacyUnscoped);
    if (legacy != null && originOf(legacy) == defOrigin) return legacy;
    return def;
  }
}
