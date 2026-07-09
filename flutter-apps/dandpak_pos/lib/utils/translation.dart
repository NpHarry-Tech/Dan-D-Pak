import 'translation_map.dart';

// Global translation helper
String t(String key) {
  return L10n.translate(key);
}

class L10n {
  // Set default to 'en' for user testing
  static String currentLocale = 'en';

  static String translate(String key) {
    if (currentLocale == 'vi') {
      return key;
    }
    // Check in the generated translation map
    final translated = viToEnMap[key];
    if (translated != null && translated.isNotEmpty) {
      return translated;
    }
    return key;
  }
}
