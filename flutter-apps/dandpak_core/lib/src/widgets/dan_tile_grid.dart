import 'package:flutter/widgets.dart';

/// QUY TẮC LƯỚI CHUNG CỦA TOÀN APP — dùng cho MỌI lưới thẻ/ô.
///
///  • Mỗi ô có kích thước **CỐ ĐỊNH** (`tileWidth` × `tileHeight`). KHÔNG co giãn,
///    KHÔNG phóng to/thu nhỏ để lấp đầy hàng.
///  • Số cột tự suy ra theo bề rộng còn trống. Thêm/xóa một ô thì các ô sau tự
///    **DỊCH TRÁI và LÙI LÊN** (reflow) — không giãn ô ra cho vừa chỗ trống.
///  • Chỗ thừa cuối hàng để **TRỐNG**, giữ nhịp ô đều nhau ở mọi màn hình
///    (khác `GridView.count`: chia đều bề rộng nên ô "nở/co" theo cửa sổ).
///  • Màn rất hẹp (tablet mini): ô tự thu về đúng bề rộng khả dụng để KHÔNG tràn
///    ra ngoài — đây là chống tràn, không phải co giãn lấp đầy.
///
/// Thay cho `GridView.count`/`SliverGridDelegateWithFixedCrossAxisCount` ở các
/// lưới thẻ. Dùng CHUNG để mọi lưới trong app cùng một nhịp, không mỗi nơi một kiểu.
class DanTileGrid extends StatelessWidget {
  final double tileWidth;
  final double tileHeight;
  final double spacing;
  final double runSpacing;
  final WrapAlignment alignment;
  final List<Widget> children;

  const DanTileGrid({
    super.key,
    required this.tileWidth,
    required this.tileHeight,
    required this.children,
    this.spacing = 12,
    this.runSpacing = 12,
    this.alignment = WrapAlignment.start,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        // Chỉ THU khi ô rộng hơn chỗ khả dụng (chống tràn ở màn siêu nhỏ).
        final w = constraints.maxWidth.isFinite && tileWidth > constraints.maxWidth
            ? constraints.maxWidth
            : tileWidth;
        return Wrap(
          spacing: spacing,
          runSpacing: runSpacing,
          alignment: alignment,
          children: [
            for (final child in children)
              SizedBox(width: w, height: tileHeight, child: child),
          ],
        );
      },
    );
  }
}
