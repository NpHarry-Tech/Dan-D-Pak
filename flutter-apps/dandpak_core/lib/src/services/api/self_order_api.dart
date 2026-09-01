part of '../api_service.dart';

extension ApiServiceSelfOrderApi on ApiService {
  Future<Map<String, dynamic>> selfOrderCheckin(String phone) async {
    return mapFrom(await postJson(
      '/api/self-order/checkin',
      body: {'phone': phone},
      errorMessage: 'Check-in failed',
    ));
  }

  /// Lấy đơn theo ID (dùng cho màn thanh toán — poll trạng thái).
  Future<Map<String, dynamic>> getOrderById(String orderId) async {
    return mapFrom(await getJson('/api/orders/$orderId',
        errorMessage: 'Failed to load order'));
  }

  /// Sinh mã QR chuyển khoản theo đúng hóa đơn.
  Future<Map<String, dynamic>> paymentQr(String orderId) async {
    return mapFrom(await postJson('/api/orders/$orderId/payment-qr',
        body: const {}, errorMessage: 'Failed to build payment QR'));
  }

  /// Tra cứu MST doanh nghiệp (route công khai cho màn khách).
  Future<Map<String, dynamic>> taxLookup(String mst) async {
    return mapFrom(await getJson('/api/public/tax-lookup/$mst',
        errorMessage: 'Tax lookup failed'));
  }

  Future<Map<String, dynamic>> customerInvoice(
    String orderId, {
    required bool issue,
    Map<String, dynamic>? customer,
  }) async {
    return mapFrom(await postJson(
      '/api/orders/$orderId/customer-invoice',
      body: {
        'decision': issue ? 'issue' : 'decline',
        if (customer != null) 'customer': customer,
      },
      errorMessage: 'Failed to submit invoice request',
    ));
  }

  /// Tạo đơn mới (dùng cho self-order kiosk).
  Future<Map<String, dynamic>> createOrder({
    required String? tableId,
    required String? orderType,
    required List<Map<String, dynamic>> items,
    Map<String, dynamic>? customer,
    String source = 'staff_pos',
  }) async {
    return mapFrom(await postJson(
      '/api/orders',
      body: {
        'table_id': tableId,
        'channel': orderType ?? 'dine_in',
        'source': source,
        'items': items,
        if (customer != null) 'customer': customer,
      },
      errorMessage: 'Failed to create order',
    ));
  }

  /// /api/zones riêng — mỗi bàn trong /api/tables mang tên khu ở cột `zone`,
  /// nên suy ra danh sách khu từ chính danh sách bàn (giữ thứ tự xuất hiện).
  Future<List<SoZone>> fetchSoZones() async {
    final data = listFrom(
        await getJson('/api/tables', errorMessage: 'Failed to load zones'));
    final seen = <String>{};
    final zones = <SoZone>[];
    for (final e in data.whereType<Map>()) {
      final z = (e['zone_id'] ?? e['zone'] ?? '').toString();
      if (z.isEmpty || !seen.add(z)) continue;
      zones.add(SoZone(id: z, name: z));
    }
    return zones;
  }

  Future<List<SoTableModel>> fetchSoTables() async {
    final data = listFrom(
        await getJson('/api/tables', errorMessage: 'Failed to load tables'));
    return data
        .whereType<Map>()
        .map((e) => SoTableModel.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  Future<List<SoMenuItem>> fetchMenuRaw({String lang = 'vi'}) async {
    // self_order=1 → server trả MENU KHÁCH (ẩn thêm món self_order_hidden), khác F&B POS.
    final langQ = lang == 'vi' ? '' : '&lang=${Uri.encodeQueryComponent(lang)}';
    final path = '/api/menu?self_order=1$langQ';
    final decoded = await getJson(path, errorMessage: 'Failed to load menu');
    final List<dynamic> data = decoded is List
        ? decoded
        : (decoded is Map && decoded['items'] is List
            ? decoded['items'] as List
            : <dynamic>[]);

    final catNames = <String, String>{};
    if (decoded is Map && decoded['categories'] is List) {
      for (final category in decoded['categories'] as List) {
        if (category is Map && category['id'] != null) {
          catNames[category['id'].toString()] =
              (category['name'] ?? '').toString();
        }
      }
    }

    int intVal(dynamic v) {
      if (v is int) return v;
      if (v is num) return v.toInt();
      return int.tryParse(v?.toString() ?? '') ?? 0;
    }

    return data.whereType<Map>().map((item) {
      final categoryId = item['category_id']?.toString();
      final hasCategory = (item['category'] ?? '').toString().isNotEmpty;
      final category = hasCategory
          ? item['category'].toString()
          : (categoryId != null ? (catNames[categoryId] ?? categoryId) : null);

      // Giữ NGUYÊN đường dẫn thô — ghép baseUrl là việc của tầng hiển thị
      // (_soImageUrl trong self_order_menu_widgets.dart), giống mọi nơi khác
      // trong app (menu_tab, retail, book_menu…). Từng ghép ở đây rồi ghép
      // LẦN NỮA ở tầng hiển thị là 2 cách làm khác nhau cho cùng 1 việc —
      // và bản ghép ở đây chỉ xử lý path có dấu "/" đầu, thiếu trường hợp path
      // không có dấu "/" đầu (đúng lỗi ảnh món self-order từng không hiện).
      return SoMenuItem(
        id: (item['id'] ?? '').toString(),
        name: (item['name'] ?? '').toString(),
        price: intVal(item['price']),
        code: item['code']?.toString(),
        barcode: item['barcode']?.toString(),
        category: category,
        categoryId: categoryId,
        image: item['image']?.toString(),
        emoji: item['emoji']?.toString(),
        description: item['description']?.toString(),
        slaMinutes: intVal(item['sla_minutes']),
        ingredients:
            item['ingredients'] is List ? item['ingredients'] as List : [],
        allergens: item['allergens'] is List ? item['allergens'] as List : [],
        modifiers: item['modifiers'] is List ? item['modifiers'] as List : [],
        addons: item['addons'] is List ? item['addons'] as List : [],
        optionGroups: (item['option_groups'] is List)
            ? (item['option_groups'] as List)
                .whereType<Map>()
                .map(
                    (e) => SoOptionGroup.fromJson(Map<String, dynamic>.from(e)))
                .where((g) => g.options.isNotEmpty)
                .toList()
            : const <SoOptionGroup>[],
      );
    }).toList();
  }
}
