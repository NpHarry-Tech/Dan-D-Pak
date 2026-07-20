// GENERATED SPLIT of pos_screen.dart — widget chung nhỏ (status/pill/chip/card).
// Cùng library (part of) nên mọi class/helper private dùng chung nguyên vẹn.
part of 'pos_screen.dart';

class _SmallStatus extends StatelessWidget {
  _SmallStatus({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color == DanColors.muted ? DanColors.muted : color,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  _StatusPill({required this.label, this.color, this.muted = false});

  final String label;
  final Color? color;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final activeColor = muted ? DanColors.muted : color ?? DanColors.brand;
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: muted ? DanColors.surface3 : activeColor.withValues(alpha: .14),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: activeColor,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _PickerChip extends StatelessWidget {
  _PickerChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(right: 8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: selected ? DanColors.brand : DanColors.surface2,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: selected ? DanColors.brand : DanColors.border2,
            ),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              color: selected ? Colors.white : DanColors.text,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ),
    );
  }
}

class _MenuPickCard extends StatelessWidget {
  _MenuPickCard({
    required this.item,
    required this.price,
    required this.onTap,
  });

  final MenuItem item;
  final String price;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Ảnh món lưu ở server dạng đường dẫn tương đối (/uploads/menu/...). Trên
    // tablet/điện thoại (app không cùng origin với server) phải GHÉP địa chỉ
    // máy chủ mới tải được — nếu không ảnh sẽ t("mất") dù server đã lưu.
    final raw = item.imageUrl;
    final resolvedUrl = (raw.isEmpty ||
            raw.startsWith('http') ||
            raw.startsWith('data:'))
        ? raw
        : '${context.read<AuthProvider>().serverUrl}${raw.startsWith('/') ? '' : '/'}$raw';
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: DanColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: DanColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Center(
                // Món chưa có ảnh: ô trống phẳng, không icon placeholder.
                child: resolvedUrl.isEmpty
                    ? SizedBox.shrink()
                    : Image.network(
                        resolvedUrl,
                        fit: BoxFit.contain,
                        // Decode at thumbnail size (not full-res) so a big menu
                        // doesn't exhaust RAM/CPU on weak POS hardware.
                        cacheWidth: 240,
                        filterQuality: FilterQuality.low,
                        gaplessPlayback: true,
                        errorBuilder: (_, __, ___) => SizedBox.shrink(),
                      ),
              ),
            ),
            SizedBox(height: 8),
            Text(
              item.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
            ),
            SizedBox(height: 3),
            Text(
              price,
              style: TextStyle(
                color: DanColors.brand,
                fontFamily: 'JetBrains Mono',
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyBlock extends StatelessWidget {
  _EmptyBlock({
    required this.title,
    required this.sub,
    required this.minHeight,
  });

  final String title;
  final String sub;
  final double minHeight;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(minHeight: minHeight),
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: DanColors.border),
      ),
      alignment: Alignment.center,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(title, style: TextStyle(fontWeight: FontWeight.w800)),
          SizedBox(height: 5),
          Text(sub, style: TextStyle(color: DanColors.faint)),
        ],
      ),
    );
  }
}

class _ResolveCallButton extends StatelessWidget {
  final VoidCallback onTap;
  _ResolveCallButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: onTap,
      style: TextButton.styleFrom(
        visualDensity: VisualDensity.compact,
        foregroundColor: Colors.white,
        backgroundColor: DanColors.late,
        padding: EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      ),
      child: Text(t('Đã xử lý'),
          style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
    );
  }
}

