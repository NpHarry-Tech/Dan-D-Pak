part of 'warehouse_screen.dart';

class _WhPill extends StatelessWidget {
  final String label;
  final String icon;
  final bool active;
  final VoidCallback onTap;
  _WhPill(
      {required this.label,
      required this.icon,
      required this.active,
      required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(DanRadius.sm),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(
          color: active ? DanColors.brand : DanColors.surface2,
          borderRadius: BorderRadius.circular(DanRadius.sm),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(icon, style: TextStyle(fontSize: 15)),
            SizedBox(width: 7),
            Text(label,
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: active ? Colors.white : DanColors.text)),
          ],
        ),
      ),
    );
  }
}

/// Product thumbnail with emoji fallback (retail KiotViet-style list).
class _SkuThumb extends StatelessWidget {
  final String baseUrl;
  final String image;
  final String emoji;
  final double size;
  _SkuThumb({
    required this.baseUrl,
    required this.image,
    required this.emoji,
    this.size = 40,
  });

  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
          color: DanColors.surface2,
          borderRadius: BorderRadius.circular(DanRadius.sm)),
      alignment: Alignment.center,
      child: Text(emoji.isEmpty ? '📦' : emoji,
          style: TextStyle(fontSize: size * .5)),
    );
    if (image.trim().isEmpty) return placeholder;
    return ClipRRect(
      borderRadius: BorderRadius.circular(DanRadius.sm),
      child: Image.network(
        _assetUrl(baseUrl, image),
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => placeholder,
        loadingBuilder: (ctx, child, prog) =>
            prog == null ? child : placeholder,
      ),
    );
  }
}

// (_RowIcon +/- đã bỏ: bảng Tồn kho giờ bấm dòng mở panel chi tiết,
//  Nhập hàng/In tem nằm trong panel.)
