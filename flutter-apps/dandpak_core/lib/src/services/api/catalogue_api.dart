part of '../api_service.dart';

/// CATALOGUE BÁN LẺ — máy tablet đặt ngoài quầy cho KHÁCH tự xem và chọn hàng.
///
/// Các route `/api/catalogue/*` MỞ (không cần phiên nhân viên) vì máy này nằm
/// ngoài quầy, giống các route iPad self-order. Đổi lại, server không bao giờ
/// trả về giỏ của máy khác, thông tin khách hay doanh thu qua nhóm route này —
/// máy chỉ ĐỌC catalogue và GHI vào ô giỏ của chính nó.
///
/// Ô giỏ do SERVER cấp theo `x-device-id`, client không tự chọn: máy ai cũng
/// chạm được mà tự khai số ô thì ghi đè được giỏ thu ngân đang thu tiền dở.
extension ApiServiceCatalogueApi on ApiService {
  /// Máy báo danh và nhận ô giỏ của nó. Gọi lúc mở màn khách và lặp theo nhịp
  /// để màn Cài đặt biết máy nào đang bật.
  Future<Map<String, dynamic>> catalogueRegister({String name = ''}) async {
    return mapFrom(await postJson('/api/catalogue/register',
        body: {if (name.isNotEmpty) 'name': name},
        errorMessage: 'Không đăng ký được thiết bị catalogue'));
  }

  Future<Map<String, dynamic>> catalogueConfig() async {
    return mapFrom(await getJson('/api/catalogue/config',
        errorMessage: 'Không tải được cấu hình catalogue'));
  }

  /// Quyển catalogue đang phát cho màn khách (ảnh từng trang + chấm điểm → SKU).
  Future<Map<String, dynamic>> catalogueBook() async {
    return mapFrom(await getJson('/api/catalogue/book',
        errorMessage: 'Không tải được catalogue'));
  }

  /// Đẩy giỏ của khách lên server → POS thấy ngay qua realtime `retail:cart`.
  Future<Map<String, dynamic>> catalogueSaveCart(
      Map<String, dynamic> snapshot) async {
    return mapFrom(await postJson('/api/catalogue/cart',
        body: {'snapshot': snapshot},
        errorMessage: 'Không đồng bộ được giỏ hàng'));
  }

  /// Khách bấm Thanh toán → tab bên POS chuyển đỏ. KHÔNG tạo đơn, không thu tiền:
  /// nhân viên vẫn phải xác nhận như mọi giỏ khác.
  Future<Map<String, dynamic>> catalogueRequestPayment(String method) async {
    return mapFrom(await postJson('/api/catalogue/request-payment',
        body: {'method': method},
        errorMessage: 'Không gửi được yêu cầu thanh toán'));
  }

  /// Khách bấm "Chuyển khoản" → server dựng đơn nháp mở từ giỏ, bật cờ đỏ báo
  /// POS, và trả về {order_id, qr} để hiện QR động tự đối soát (như self-order).
  Future<Map<String, dynamic>> catalogueCheckout(
      String method, String clientRequestId) async {
    return mapFrom(await postJson('/api/catalogue/checkout',
        body: {'method': method, 'client_request_id': clientRequestId},
        errorMessage: 'Không tạo được đơn thanh toán'));
  }

  /// Poll trạng thái đơn (màn khách) — trả {found, status, paid}.
  Future<Map<String, dynamic>> catalogueOrderStatus(String orderId) async {
    return mapFrom(await getJson('/api/catalogue/order-status/$orderId',
        errorMessage: 'Không đọc được trạng thái đơn'));
  }

  /// Thoát màn khách (bấm logo 3 lần rồi nhập mật khẩu).
  Future<bool> catalogueExit(String pin) async {
    try {
      await postJson('/api/catalogue/exit',
          body: {'pin': pin}, errorMessage: 'Mật khẩu không đúng');
      return true;
    } catch (_) {
      return false;
    }
  }

  // ── Cài đặt (quản lý) ─────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getCatalogueSettings() async {
    return mapFrom(await getJson('/api/settings/catalogue',
        errorMessage: 'Không tải được cấu hình catalogue'));
  }

  Future<Map<String, dynamic>> saveCatalogueSettings(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/settings/catalogue',
        body: body, errorMessage: 'Không lưu được cấu hình catalogue'));
  }

  Future<List<Map<String, dynamic>>> getCatalogueDevices() async {
    final res = await getJson('/api/settings/catalogue/devices',
        errorMessage: 'Không tải được danh sách thiết bị');
    final raw = res is Map ? res['devices'] : null;
    return (raw as List? ?? const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  Future<void> renameCatalogueDevice(String device, String name) async {
    await postJson('/api/settings/catalogue/devices/rename',
        body: {'device': device, 'name': name},
        errorMessage: 'Không đổi được tên thiết bị');
  }

  /// Ảnh QR TĨNH dùng tạm khi chưa đấu nối cổng thanh toán theo pháp nhân.
  Future<String> uploadCatalogueQr({
    required String originalName,
    required String mimeType,
    required String base64Data,
  }) async {
    final res = await postJson('/api/settings/catalogue/qr-upload',
        body: {
          'original_name': originalName,
          'mime_type': mimeType,
          'data': base64Data,
        },
        timeout: const Duration(seconds: 40),
        errorMessage: 'Không tải được ảnh QR lên');
    return '${mapFrom(res)['url'] ?? ''}';
  }

  /// THÊM MỘT TRANG catalogue — mỗi lần một tấm ảnh.
  ///
  /// Cố ý không có "thêm cả thư mục": cửa hàng thiết kế dần từng trang và muốn
  /// thấy ngay trang vừa thêm; thêm từng tấm cũng cho phép chèn bổ sung hoặc
  /// thay một trang hỏng mà không phải dựng lại cả quyển.
  Future<Map<String, dynamic>> addCataloguePage({
    required String originalName,
    required String mimeType,
    required String base64Data,
    String bookId = '',
    String kind = 'retail',
    String label = '',
  }) async {
    return mapFrom(await postJson('/api/settings/book-menu/page',
        body: {
          'original_name': originalName,
          'mime_type': mimeType,
          'data': base64Data,
          'kind': kind,
          if (bookId.isNotEmpty) 'book_id': bookId,
          if (label.isNotEmpty) 'label': label,
        },
        timeout: const Duration(seconds: 60),
        errorMessage: 'Không thêm được trang catalogue'));
  }

  Future<Map<String, dynamic>> removeCataloguePage({
    required String bookId,
    required String pageId,
  }) async {
    return mapFrom(await postJson('/api/settings/book-menu/page/remove',
        body: {'book_id': bookId, 'page_id': pageId},
        errorMessage: 'Không xoá được trang catalogue'));
  }
}
