import 'dart:io';

import 'package:media_kit/media_kit.dart';

/// Reused single audio player for notification-sound previews.
Player? _player;

/// Plays a notification sound (.ogg) inside the app via libmpv (media_kit),
/// which bundles its own Ogg/Vorbis decoder. Windows Media Foundation cannot
/// decode Ogg, so before this the preview had to open the OS browser — that is
/// kept only as a last-resort fallback if the audio engine is unavailable.
///
/// The file is streamed from the bundled local backend that already serves the
/// same assets (the URL the browser used to open).
Future<void> playNotificationSound(String baseUrl, String soundId,
    {double volume = 1.0}) async {
  if (soundId.isEmpty) return;
  // soundId comes from server-side config; keep it to a strict filename
  // charset so it can never smuggle a path/URL into the fallback that hands
  // the string to the OS shell handler.
  if (!RegExp(r'^[A-Za-z0-9 _-]+$').hasMatch(soundId)) return;
  final root = baseUrl.replaceFirst(RegExp(r'/$'), '');
  final url = '$root/assets/sounds/notifications/$soundId.ogg';

  try {
    final player = _player ??= Player();
    await player.setVolume((volume.clamp(0.0, 1.0) * 100).toDouble());
    await player.open(Media(url)); // opens + plays
    return;
  } catch (_) {
    // Audio engine unavailable (e.g. native libs missing) → fall back to the
    // OS default handler so the user can still hear the sound.
    await _openExternally(url);
  }
}

Future<void> _openExternally(String url) async {
  try {
    if (Platform.isWindows) {
      await Process.start(
        'explorer.exe',
        [url],
        mode: ProcessStartMode.detached,
      );
    } else if (Platform.isMacOS) {
      await Process.start('open', [url], mode: ProcessStartMode.detached);
    } else {
      await Process.start('xdg-open', [url], mode: ProcessStartMode.detached);
    }
  } catch (_) {
    // Ignore preview failures.
  }
}
