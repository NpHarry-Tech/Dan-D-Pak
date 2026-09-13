import 'translation_map.dart';
import 'translation_map_zh.dart';
export 'search.dart';

const supportedAppLangs = ['vi', 'en', 'zh'];

// Global translation helper
String t(String key) {
  return L10n.translate(key);
}

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

const _fallbackPhrasesZh = <MapEntry<String, String>>[
  MapEntry('Không tải được', '无法加载'),
  MapEntry('Không tải thêm được', '无法加载更多'),
  MapEntry('Không lưu được', '无法保存'),
  MapEntry('Không mở được', '无法打开'),
  MapEntry('Không gửi được', '无法发送'),
  MapEntry('Không in được', '无法打印'),
  MapEntry('Không chuyển được', '无法转移'),
  MapEntry('Không gộp được', '无法合并'),
  MapEntry('Không tách được', '无法拆分'),
  MapEntry('Không hủy được', '无法取消'),
  MapEntry('Không tìm thấy', '未找到'),
  MapEntry('Đã thanh toán, nhưng chưa in được', '已付款，但打印失败'),
  MapEntry('Đã chuyển bàn', '已换桌'),
  MapEntry('Đã gộp bàn', '已合并桌台'),
  MapEntry('Đã hủy món', '已取消菜品'),
  MapEntry('Đã gửi', '已发送'),
  MapEntry('Đã tạo nhóm', '已创建分组'),
  MapEntry('Cập nhật nhân viên', '更新员工'),
  MapEntry('Cập nhật tài khoản', '更新账户'),
  MapEntry('Cập nhật danh mục', '更新分类'),
  MapEntry('Cập nhật món', '更新菜品'),
  MapEntry('Cập nhật bàn', '更新桌台'),
  MapEntry('Cập nhật kho', '更新仓库'),
  MapEntry('Cập nhật quyền mặc định vai trò', '更新角色默认权限'),
  MapEntry('Tạo tài khoản', '创建账户'),
  MapEntry('Tạo danh mục', '创建分类'),
  MapEntry('Tạo món mới', '创建新菜品'),
  MapEntry('Tạo món', '创建菜品'),
  MapEntry('Tạo bàn', '创建桌台'),
  MapEntry('Tạo kho', '创建仓库'),
  MapEntry('Tách bill bàn', '拆分桌台账单'),
  MapEntry('Chuyển bàn', '换桌'),
  MapEntry('Gộp bàn', '合并桌台'),
  MapEntry('Chuyển tới', '转到'),
  MapEntry('Chuyển đến', '移动到'),
  MapEntry('Khách bàn', '桌台顾客'),
  MapEntry('đang gọi', '来电中'),
  MapEntry('đang dùng', '使用中'),
  MapEntry('đăng nhập vào hệ thống', '登录系统'),
  MapEntry('đăng xuất khỏi hệ thống', '退出系统'),
  MapEntry('vừa kết nối vào hệ thống', '已连接到系统'),
  MapEntry('lệnh in lại hóa đơn', '账单重打任务'),
  MapEntry('chi nhánh', '分店'),
  MapEntry('dòng', '行'),
  MapEntry('bảng', '桌'),
  MapEntry('hàng', '行'),
  MapEntry('ngày', '天'),
  MapEntry('giấy', '秒'),
  MapEntry('trễ', '延迟'),
  MapEntry('món', '项'),
  MapEntry('bàn', '桌'),
  MapEntry('chỗ', '位'),
  MapEntry('Từ:', '从：'),
  MapEntry('Đến:', '到：'),
  MapEntry('Từ', '从'),
  MapEntry('Đến', '到'),
  MapEntry('Tháng', '月'),
  MapEntry('Quý', '季度'),
  MapEntry('Năm', '年'),
  MapEntry('lúc', '于'),
  MapEntry('giảm', '折扣'),
  MapEntry('Tối thiểu', '最低'),
  MapEntry('Tồn', '库存'),
  MapEntry('Số lượng', '数量'),
  MapEntry('Hiện tại', '当前'),
  MapEntry('Server lỗi', '服务器错误'),
  MapEntry('Thiết bị & POS đang hoạt động', '设备和POS运行中'),
  MapEntry('người có ghi đè', '有覆盖设置的用户'),
  MapEntry('ghi đè', '覆盖'),
  MapEntry('Âm:', '声音：'),
  MapEntry('Bàn', '桌台'),
  MapEntry('HĐ', '发票'),
  MapEntry('Lỗi', '错误'),
];

class L10n {
  static String currentLocale = 'vi';

  static String clean(String lang) =>
      lang == 'en' ? 'en' : (lang == 'zh' ? 'zh' : 'vi');

  static void setLocale(String lang) {
    currentLocale = clean(lang);
  }

  static String translate(String key) {
    if (currentLocale == 'vi') {
      return key;
    }
    final map = currentLocale == 'zh' ? viToZhMap : viToEnMap;
    final translated = map[key];
    if (translated != null && translated.isNotEmpty) {
      return translated;
    }
    final phrases = currentLocale == 'zh' ? _fallbackPhrasesZh : _fallbackPhrases;
    var fallback = key;
    for (final phrase in phrases) {
      fallback = fallback.replaceAll(phrase.key, phrase.value);
    }
    return fallback == key ? key : fallback;
  }
}
