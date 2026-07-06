import 'package:flutter/foundation.dart';

/// Debug-only log. In release builds this is a no-op, so hot paths (one line
/// per realtime socket event, per API refresh, …) never pay for console IO on
/// the UI isolate of a weak POS terminal.
void dlog(String message) {
  if (kDebugMode) debugPrint(message);
}
