import 'dart:io';

import 'api_client.dart';

class DanDpakDefaults {
  const DanDpakDefaults._();

  /// Máy chủ sản xuất (VPS). Tablet/điện thoại là thin-client KHÔNG
  /// chạy Node engine nội bộ, nên phải trỏ thẳng vào đây ngay từ lần cài đầu —
  /// nếu để mặc định localhost:3000 thì máy sẽ "connection refused" và hiện ra
  /// đúng triệu chứng "thiếu cơ sở dữ liệu". Có thể đổi trong màn Kết nối.
  static const prodBaseUrl = 'http://42.96.18.70:3000';

  /// Mặc định theo nền tảng: desktop chạy engine nội bộ → localhost; di động là
  /// thin-client → VPS. Người dùng vẫn ghi đè được và giá trị được lưu bền.
  static String get baseUrl {
    if (Platform.isAndroid || Platform.isIOS) return prodBaseUrl;
    return DanDpakApiClient.defaultBaseUrl;
  }

  static const branchId = 'br1';
  static const username = '';
}
