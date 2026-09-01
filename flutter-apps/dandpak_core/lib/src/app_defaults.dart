import 'api_client.dart';

class DanDpakDefaults {
  const DanDpakDefaults._();

  /// Máy chủ sản xuất (VPS). Mọi app đều là client; Store Edge là một service
  /// độc lập trên LAN chứ không phải process con do Flutter âm thầm sở hữu.
  static const prodBaseUrl = DanDpakApiClient.defaultBaseUrl;

  /// Build canary/Edge của một cửa hàng khai báo:
  /// `--dart-define=STORE_EDGE_URL=http://192.168.x.x:3000`.
  /// Không khai thì tất cả nền tảng dùng VPS, tránh desktop cài mới rơi vào
  /// localhost trong khi local engine không hề chạy. URL người dùng chọn vẫn
  /// được LocalStore lưu bền và thắng giá trị mặc định này.
  static const storeEdgeUrl = String.fromEnvironment('STORE_EDGE_URL');

  static String get baseUrl {
    final edge = storeEdgeUrl.trim();
    return edge.isEmpty ? prodBaseUrl : DanDpakApiClient.normalizeBaseUrl(edge);
  }

  static const branchId = 'sala';
  static const username = '';
}
