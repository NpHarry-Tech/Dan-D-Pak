import 'package:flutter/material.dart';

enum ThumbnailKind { logo, photo }

/// Fixed, centered thumbnail contract for mixed portrait/landscape/square media.
/// Logos are never cropped; photos fill the tile deliberately.
class AspectSafeThumbnail extends StatelessWidget {
  const AspectSafeThumbnail({
    super.key,
    required this.width,
    required this.height,
    required this.fallback,
    this.image,
    this.kind = ThumbnailKind.logo,
    this.borderRadius = 4,
  });

  final ImageProvider? image;
  final double width;
  final double height;
  final Widget fallback;
  final ThumbnailKind kind;
  final double borderRadius;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: width,
        height: height,
        child: Center(
          child: image == null
              ? fallback
              : ClipRRect(
                  borderRadius: BorderRadius.circular(borderRadius),
                  child: Image(
                    image: image!,
                    width: width,
                    height: height,
                    alignment: Alignment.center,
                    fit: kind == ThumbnailKind.logo
                        ? BoxFit.contain
                        : BoxFit.cover,
                    errorBuilder: (_, __, ___) => Center(child: fallback),
                  ),
                ),
        ),
      );
}
