// Widget dùng chung cho danh bạ (avatar) — tách khỏi contacts_screen.dart để
// dùng lại ở contacts_partner_form.dart (part of, cùng library).
part of 'contacts_screen.dart';

class _ContactAvatar extends StatelessWidget {
  final String name;
  final String avatar;
  final String baseUrl;
  final double radius;

  _ContactAvatar({
    required this.name,
    required this.avatar,
    required this.baseUrl,
    this.radius = 20,
  });

  @override
  Widget build(BuildContext context) {
    final fallback = CircleAvatar(
      radius: radius,
      backgroundColor: DanColors.brandDim,
      child: Text(
        (name.isNotEmpty ? name[0] : '?').toUpperCase(),
        style: TextStyle(
          color: DanColors.brand,
          fontWeight: FontWeight.w900,
          fontSize: radius * .72,
        ),
      ),
    );
    if (avatar.trim().isEmpty) return fallback;

    return ClipOval(
      child: Image.network(
        _assetUrl(baseUrl, avatar),
        width: radius * 2,
        height: radius * 2,
        fit: BoxFit.cover,
        // Avatar-size decode: contact lists can be long.
        cacheWidth: (radius * 4).round(),
        filterQuality: FilterQuality.low,
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) => fallback,
      ),
    );
  }
}
