import 'package:flutter/material.dart';

import '../../ui/app_theme.dart';

// ── Ép kiểu an toàn từ JSON ───────────────────────────────────────────────
String oStr(dynamic v) => v?.toString() ?? '';
num oNum(dynamic v) => v is num ? v : num.tryParse(oStr(v)) ?? 0;
Map<String, dynamic> oMap(dynamic v) =>
    v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
List<Map<String, dynamic>> oList(dynamic v) => v is List
    ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
    : <Map<String, dynamic>>[];

// ── Metadata kênh bán ─────────────────────────────────────────────────────
class ProviderMeta {
  final String name;
  final Color color;
  final IconData icon;
  const ProviderMeta(this.name, this.color, this.icon);
}

const Map<String, ProviderMeta> kProviderMeta = {
  'haravan': ProviderMeta('Haravan', Color(0xFF2E7D32), Icons.public),
  'website': ProviderMeta('Website', Color(0xFF0891B2), Icons.language),
  'shopee': ProviderMeta('Shopee', Color(0xFFEE4D2D), Icons.storefront),
  'tiktokshop': ProviderMeta('TikTok Shop', Color(0xFF111111), Icons.music_note),
  'lazada': ProviderMeta('Lazada', Color(0xFF0F146D), Icons.shopping_bag),
  'tiki': ProviderMeta('Tiki', Color(0xFF1A94FF), Icons.local_mall),
  'grabfood': ProviderMeta('GrabFood', Color(0xFF00B14F), Icons.fastfood),
  'shopeefood': ProviderMeta('ShopeeFood', Color(0xFFEE4D2D), Icons.fastfood),
  'facebook': ProviderMeta('Facebook', Color(0xFF1877F2), Icons.facebook),
  'instagram': ProviderMeta('Instagram', Color(0xFFC13584), Icons.camera_alt),
  'zalooa': ProviderMeta('Zalo OA', Color(0xFF0068FF), Icons.chat),
};

ProviderMeta providerMeta(String key) =>
    kProviderMeta[key.toLowerCase()] ??
    ProviderMeta(key.isEmpty ? 'Kênh khác' : key, DanColors.muted, Icons.public);

// ── Trạng thái workflow đơn online ────────────────────────────────────────
class WorkflowMeta {
  final String label;
  final Color color;
  const WorkflowMeta(this.label, this.color);
}

const Map<String, WorkflowMeta> kWorkflowMeta = {
  'pending': WorkflowMeta('Chờ xử lý', Color(0xFFB45309)),
  'processed': WorkflowMeta('Đã xác nhận', Color(0xFF0891B2)),
  'preparing': WorkflowMeta('Đang chuẩn bị', Color(0xFF7C3AED)),
  'ready_to_ship': WorkflowMeta('Chờ lấy hàng', Color(0xFF2563EB)),
  'shipping': WorkflowMeta('Đang giao', Color(0xFF2563EB)),
  'delivered': WorkflowMeta('Đã giao', Color(0xFF047857)),
  'cancelled': WorkflowMeta('Đã hủy', Color(0xFFB91C1C)),
  'return_refund': WorkflowMeta('Trả hàng/Hoàn tiền', Color(0xFFB91C1C)),
};

WorkflowMeta workflowMeta(String key) =>
    kWorkflowMeta[key] ?? WorkflowMeta(key.isEmpty ? '—' : key, DanColors.muted);

/// Các tab đơn hàng theo KiotViet. Mỗi tab ánh xạ tới một bucket của summary.
class OnlineOrderTab {
  final String key; // status gửi lên API ('' = tất cả)
  final String label;
  final List<String> countBuckets; // bucket(s) cộng vào badge
  const OnlineOrderTab(this.key, this.label, this.countBuckets);
}

const List<OnlineOrderTab> kOrderTabs = [
  OnlineOrderTab('pending', 'Chờ xử lý', ['pending']),
  OnlineOrderTab('processed', 'Đã xử lý', ['processed', 'preparing', 'ready_to_ship']),
  OnlineOrderTab('shipping', 'Đang giao', ['shipping']),
  OnlineOrderTab('delivered', 'Đã giao', ['delivered']),
  OnlineOrderTab('cancelled', 'Đơn hủy', ['cancelled']),
  OnlineOrderTab('return_refund', 'Trả hàng/Hoàn tiền', ['return_refund']),
  OnlineOrderTab('product_attention', 'Cần xử lý hàng hóa', ['product_attention']),
];

// ── Widget dùng chung ─────────────────────────────────────────────────────
class OnlinePill extends StatelessWidget {
  final String label;
  final Color color;
  const OnlinePill(this.label, this.color, {super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(label,
          style: TextStyle(
              fontSize: 11, fontWeight: FontWeight.w800, color: color)),
    );
  }
}

class ProviderBadge extends StatelessWidget {
  final String provider;
  final String shop;
  const ProviderBadge(this.provider, {this.shop = '', super.key});

  @override
  Widget build(BuildContext context) {
    final m = providerMeta(provider);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(m.icon, size: 15, color: m.color),
        const SizedBox(width: 5),
        Text(shop.isNotEmpty ? shop : m.name,
            style: TextStyle(
                fontSize: 12.5, fontWeight: FontWeight.w700, color: m.color)),
      ],
    );
  }
}

/// Khối trạng thái rỗng thống nhất cho các mục.
class OnlineEmpty extends StatelessWidget {
  final IconData icon;
  final String message;
  const OnlineEmpty(this.message, {this.icon = Icons.inbox_outlined, super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 46, color: DanColors.surface3),
          const SizedBox(height: 10),
          Text(message,
              style: const TextStyle(color: DanColors.faint, fontSize: 13)),
        ],
      ),
    );
  }
}
