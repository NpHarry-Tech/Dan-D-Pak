import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../management/settings_integrations_panel.dart';
import 'marketplace_connect_panel.dart';

/// Thiết lập kênh = ĐÚNG MỘT màn "Liên kết" dùng chung (IntegrationsPanel), y hệt
/// Cài đặt → Liên kết. Sàn Shopee/Lazada nằm TRONG danh sách này; khi chọn sẽ hiện
/// nút kết nối "1 chạm" (không nhập Partner ID/Key) ngay trong khung detail — không
/// dựng UI kết nối riêng để tránh trùng đường kết nối.
class OnlineChannelsSection extends StatelessWidget {
  const OnlineChannelsSection({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    // IntegrationsPanel tải /settings/integrations trước khi dựng phần kết nối
    // sàn. Reviewer Shopee không được cấp quyền settings rộng chỉ để vượt qua
    // bước tải đó; panel chuyên biệt bên dưới chỉ gọi /marketplace/* và không
    // hiển thị credential hay cấu hình của các tích hợp khác.
    if (!auth.hasPermission('settings.integrations')) {
      return const MarketplaceConnectPanel(provider: 'shopee');
    }
    return IntegrationsPanel(api: context.read<ApiService>());
  }
}
