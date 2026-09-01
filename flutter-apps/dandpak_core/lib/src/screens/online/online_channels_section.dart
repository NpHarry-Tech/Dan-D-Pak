import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../management/settings_integrations_panel.dart';

/// Thiết lập kênh = ĐÚNG MỘT màn "Liên kết" dùng chung (IntegrationsPanel), y hệt
/// Cài đặt → Liên kết. Sàn Shopee/Lazada nằm TRONG danh sách này; khi chọn sẽ hiện
/// nút kết nối "1 chạm" (không nhập Partner ID/Key) ngay trong khung detail — không
/// dựng UI kết nối riêng để tránh trùng đường kết nối.
class OnlineChannelsSection extends StatelessWidget {
  const OnlineChannelsSection({super.key});

  @override
  Widget build(BuildContext context) {
    return IntegrationsPanel(api: context.read<ApiService>());
  }
}
