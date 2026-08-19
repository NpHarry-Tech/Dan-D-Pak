import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../management/settings_integrations_panel.dart';

/// Thiết lập kênh — KHÔNG dựng form riêng. Tái sử dụng đúng panel "Liên kết"
/// trong Cài đặt (IntegrationsPanel): cùng một cấu hình, cùng một DB. Các kênh
/// sàn/mạng xã hội (Shopee, TikTok, Lazada, Tiki, Facebook, Instagram, Zalo OA)
/// được khai trong _integrationDefs của panel đó nên hiện ở cả hai nơi.
class OnlineChannelsSection extends StatelessWidget {
  const OnlineChannelsSection({super.key});

  @override
  Widget build(BuildContext context) {
    return IntegrationsPanel(api: context.read<ApiService>());
  }
}
