part of '../api_service.dart';

extension ApiServiceWarehouseApi on ApiService {
  // ── Warehouse (Kho) ────────────────────────────────────────────────────
  Future<List<dynamic>> getWarehouses() async {
    return listFrom(await getJson('/api/warehouses',
        errorMessage: 'Không tải được danh sách kho'));
  }

  Future<Map<String, dynamic>> createWarehouse(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/warehouses',
        body: body, errorMessage: 'Không tạo được kho'));
  }

  Future<Map<String, dynamic>> updateWarehouse(
      String id, Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/warehouses/$id/update',
        body: body, errorMessage: 'Không cập nhật được kho'));
  }

  Future<List<dynamic>> getInventory({String? warehouseId}) async {
    final q = warehouseId != null && warehouseId.isNotEmpty
        ? '?warehouse_id=${Uri.encodeComponent(warehouseId)}'
        : '';
    return listFrom(await getJson('/api/inventory$q',
        errorMessage: 'Không tải được tồn kho'));
  }

  Future<List<dynamic>> getWarehouseSkus(String warehouseId) async {
    return listFrom(await getJson(
        '/api/skus?warehouse_id=${Uri.encodeComponent(warehouseId)}',
        errorMessage: 'Không tải được tồn kho'));
  }

  Future<List<dynamic>> getLots({String? warehouseId}) async {
    final q = warehouseId != null && warehouseId.isNotEmpty
        ? '?warehouse_id=${Uri.encodeComponent(warehouseId)}'
        : '';
    return listFrom(await getJson('/api/warehouse/lots$q',
        errorMessage: 'Không tải được lô hàng'));
  }

  Future<List<dynamic>> getMovements(
      {int limit = 80, String? warehouseId}) async {
    final q = <String>['limit=$limit'];
    if (warehouseId != null && warehouseId.isNotEmpty) {
      q.add('warehouse_id=${Uri.encodeComponent(warehouseId)}');
    }
    return listFrom(await getJson('/api/movements?${q.join('&')}',
        errorMessage: 'Không tải được lịch sử kho'));
  }

  Future<List<dynamic>> getWarehouseDocuments(
      {String? warehouseId, String? type}) async {
    final qs = <String>[];
    if (warehouseId != null && warehouseId.isNotEmpty) {
      qs.add('warehouse_id=${Uri.encodeComponent(warehouseId)}');
    }
    if (type != null && type.isNotEmpty) {
      qs.add('type=${Uri.encodeComponent(type)}');
    }
    return listFrom(await getJson(
        '/api/warehouse/documents${qs.isEmpty ? '' : '?${qs.join('&')}'}',
        errorMessage: 'Không tải được phiếu kho'));
  }

  Future<void> receiveStock(Map<String, dynamic> body) async {
    await postJson('/api/warehouse/receive',
        body: body, errorMessage: 'Nhập kho thất bại');
  }

  Future<void> issueStock(Map<String, dynamic> body) async {
    await postJson('/api/warehouse/issue',
        body: body, errorMessage: 'Xuất kho thất bại');
  }

  Future<Map<String, dynamic>> createInventoryItem(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/inventory',
        body: body, errorMessage: 'Không tạo được mặt hàng'));
  }

  // ── Thiết lập giá (PriceBook) ──────────────────────────────────────────
  /// [bookId] ≠ 'default' → mỗi dòng kèm `book_price` (null = dùng giá chung).
  Future<List<dynamic>> getPriceBook({String? warehouseId, String? bookId}) async {
    final qs = <String>[
      if (warehouseId != null && warehouseId.isNotEmpty)
        'warehouse_id=${Uri.encodeComponent(warehouseId)}',
      if (bookId != null && bookId.isNotEmpty && bookId != 'default')
        'book_id=${Uri.encodeComponent(bookId)}',
    ];
    final q = qs.isEmpty ? '' : '?${qs.join('&')}';
    return listFrom(await getJson('/api/warehouse/price-book$q',
        errorMessage: 'Không tải được bảng giá'));
  }

  /// Danh sách bảng giá — 'default' (Bảng giá chung) luôn đứng đầu.
  Future<List<dynamic>> getPriceBooks() async {
    return listFrom(await getJson('/api/warehouse/price-books',
        errorMessage: 'Không tải được danh sách bảng giá'));
  }

  /// Tạo/sửa bảng giá: {id?, name, status} (cấu hình ở Cài đặt → Kho & kênh bán).
  Future<Map<String, dynamic>> savePriceBook(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/warehouse/price-books',
        body: body, errorMessage: 'Không lưu được bảng giá'));
  }

  Future<void> deletePriceBook(String id) async {
    await postJson('/api/warehouse/price-books/$id/delete',
        errorMessage: 'Không xóa được bảng giá');
  }

  /// Đặt giá 1 SKU trong 1 bảng giá; price null = xóa giá riêng (về giá chung).
  Future<Map<String, dynamic>> setPriceBookEntry({
    required String bookId,
    required String skuId,
    num? price,
  }) async {
    return mapFrom(await postJson('/api/warehouse/price-book/entry',
        body: {'book_id': bookId, 'sku_id': skuId, 'price': price},
        errorMessage: 'Không lưu được giá'));
  }

  Future<Map<String, dynamic>> updateSku(
      String id, Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/skus/$id/update',
        body: body, errorMessage: 'Không cập nhật được sản phẩm'));
  }

  /// In tem mã sản phẩm ra máy in tem (Cài đặt máy in loại "Tem nhãn").
  Future<Map<String, dynamic>> printProductLabel(String skuId,
      {int copies = 1}) async {
    return mapFrom(await postJson('/api/print/product-label',
        body: {'sku_id': skuId, 'copies': copies},
        errorMessage: 'Không in được tem mã'));
  }

  // ── Kiểm kho theo phiếu (Phiếu tạm → Cân bằng kho | Hủy) ───────────────
  Future<List<dynamic>> getStocktakes(
      {String status = '', String q = '', String? warehouseId}) async {
    final qs = <String>[];
    if (status.isNotEmpty) qs.add('status=$status');
    if (q.isNotEmpty) qs.add('q=${Uri.encodeComponent(q)}');
    if (warehouseId != null && warehouseId.isNotEmpty) {
      qs.add('warehouse_id=${Uri.encodeComponent(warehouseId)}');
    }
    return listFrom(await getJson(
        '/api/warehouse/stocktakes${qs.isEmpty ? '' : '?${qs.join('&')}'}',
        errorMessage: 'Không tải được phiếu kiểm kho'));
  }

  Future<Map<String, dynamic>> getStocktake(String id) async {
    return mapFrom(await getJson('/api/warehouse/stocktakes/$id',
        errorMessage: 'Không tải được phiếu kiểm kho'));
  }

  Future<Map<String, dynamic>> saveStocktake(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/warehouse/stocktakes',
        body: body, errorMessage: 'Không lưu được phiếu kiểm kho'));
  }

  Future<Map<String, dynamic>> approveStocktake(String id) async {
    return mapFrom(await postJson('/api/warehouse/stocktakes/$id/approve',
        errorMessage: 'Không cân bằng được kho'));
  }

  Future<Map<String, dynamic>> cancelStocktake(String id) async {
    return mapFrom(await postJson('/api/warehouse/stocktakes/$id/cancel',
        errorMessage: 'Không hủy được phiếu kiểm kho'));
  }

  // ── Chuyển hàng (nhiều dòng, 1 phiếu) + Xuất dùng nội bộ ───────────────
  Future<Map<String, dynamic>> transferStock(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/warehouse/transfer',
        body: body, errorMessage: 'Chuyển kho thất bại'));
  }

  Future<Map<String, dynamic>> issueInternalUse(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/warehouse/internal-use',
        body: body, errorMessage: 'Xuất dùng nội bộ thất bại'));
  }

  Future<Map<String, dynamic>> getWarehouseDocument(String id) async {
    return mapFrom(await getJson('/api/warehouse/documents/$id',
        errorMessage: 'Không tải được phiếu kho'));
  }
}
