import 'translation_map.dart';

const supportedAppLangs = ['vi', 'en'];

// Global translation helper
String t(String key) {
  return L10n.translate(key);
}

String foldSearch(Object? value) {
  var s = (value ?? '').toString().toLowerCase();
  const from =
      'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
  const to =
      'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';
  for (var i = 0; i < from.length; i++) {
    s = s.replaceAll(from[i], to[i]);
  }
  return s.trim();
}

bool searchMatches(Object? value, String foldedQuery) =>
    foldedQuery.isEmpty || foldSearch(value).contains(foldedQuery);

const _fallbackPhrases = <MapEntry<String, String>>[
  MapEntry('Không tải được', 'Could not load'),
  MapEntry('Không tải thêm được', 'Could not load more'),
  MapEntry('Không lưu được', 'Could not save'),
  MapEntry('Không mở được', 'Could not open'),
  MapEntry('Không gửi được', 'Could not send'),
  MapEntry('Không in được', 'Could not print'),
  MapEntry('Không chuyển được', 'Could not move'),
  MapEntry('Không gộp được', 'Could not merge'),
  MapEntry('Không tách được', 'Could not split'),
  MapEntry('Không hủy được', 'Could not cancel'),
  MapEntry('Không tìm thấy', 'Could not find'),
  MapEntry('Đã thanh toán, nhưng chưa in được', 'Paid, but could not print'),
  MapEntry('Đã chuyển bàn', 'Moved table'),
  MapEntry('Đã gộp bàn', 'Merged table'),
  MapEntry('Đã hủy món', 'Canceled item'),
  MapEntry('Đã gửi', 'Sent'),
  MapEntry('Đã tạo nhóm', 'Created group'),
  MapEntry('Cập nhật nhân viên', 'Update employee'),
  MapEntry('Cập nhật tài khoản', 'Update account'),
  MapEntry('Cập nhật danh mục', 'Update category'),
  MapEntry('Cập nhật món', 'Update item'),
  MapEntry('Cập nhật bàn', 'Update table'),
  MapEntry('Cập nhật kho', 'Update warehouse'),
  MapEntry(
      'Cập nhật quyền mặc định vai trò', 'Update default permissions for role'),
  MapEntry('Tạo tài khoản', 'Create account'),
  MapEntry('Tạo danh mục', 'Create category'),
  MapEntry('Tạo món mới', 'Create new item'),
  MapEntry('Tạo món', 'Create item'),
  MapEntry('Tạo bàn', 'Create table'),
  MapEntry('Tạo kho', 'Create warehouse'),
  MapEntry('Tách bill bàn', 'Split bill for table'),
  MapEntry('Chuyển bàn', 'Move table'),
  MapEntry('Gộp bàn', 'Merge table'),
  MapEntry('Chuyển tới', 'Send to'),
  MapEntry('Chuyển đến', 'Move to'),
  MapEntry('Khách bàn', 'Table guest'),
  MapEntry('đang gọi', 'is calling'),
  MapEntry('đang dùng', 'in use'),
  MapEntry('đăng nhập vào hệ thống', 'logged in to the system'),
  MapEntry('đăng xuất khỏi hệ thống', 'logged out of the system'),
  MapEntry('vừa kết nối vào hệ thống', 'connected to the system'),
  MapEntry('lệnh in lại hóa đơn', 'receipt reprint jobs'),
  MapEntry('chi nhánh', 'branches'),
  MapEntry('dòng', 'rows'),
  MapEntry('bảng', 'tables'),
  MapEntry('hàng', 'rows'),
  MapEntry('ngày', 'days'),
  MapEntry('giấy', 'seconds'),
  MapEntry('trễ', 'late'),
  MapEntry('món', 'items'),
  MapEntry('bàn', 'tables'),
  MapEntry('chỗ', 'seats'),
  MapEntry('Từ:', 'From:'),
  MapEntry('Đến:', 'To:'),
  MapEntry('Từ', 'From'),
  MapEntry('Đến', 'To'),
  MapEntry('Tháng', 'Month'),
  MapEntry('Quý', 'Quarter'),
  MapEntry('Năm', 'Year'),
  MapEntry('lúc', 'at'),
  MapEntry('giảm', 'discount'),
  MapEntry('Tối thiểu', 'Minimum'),
  MapEntry('Tồn', 'Stock'),
  MapEntry('Số lượng', 'Quantity'),
  MapEntry('Hiện tại', 'Current'),
  MapEntry('Server lỗi', 'Server error'),
  MapEntry('Thiết bị & POS đang hoạt động', 'Active devices & POS'),
  MapEntry('người có ghi đè', 'users with overrides'),
  MapEntry('ghi đè', 'overrides'),
  MapEntry('Âm:', 'Sound:'),
  MapEntry('Bàn', 'Table'),
  MapEntry('HĐ', 'Invoice'),
  MapEntry('Lỗi', 'Error'),
];

class L10n {
  static String currentLocale = 'vi';

  static String clean(String lang) => lang == 'en' ? 'en' : 'vi';

  static void setLocale(String lang) {
    currentLocale = clean(lang);
  }

  static String translate(String key) {
    if (currentLocale == 'vi') {
      return key;
    }
    // Check in the generated translation map
    final translated = viToEnMap[key];
    if (translated != null && translated.isNotEmpty) {
      return translated;
    }
    var fallback = key;
    for (final phrase in _fallbackPhrases) {
      fallback = fallback.replaceAll(phrase.key, phrase.value);
    }
    return fallback == key ? key : fallback;
  }
}
