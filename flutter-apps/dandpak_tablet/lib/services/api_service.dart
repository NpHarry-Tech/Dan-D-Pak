import 'package:dandpak_core/dandpak_core.dart';

import '../models/tablet_models.dart';

class ApiService extends DanDpakApiClient {
  ApiService({required String baseUrl, String? token, String? branchId})
      : super(baseUrl: baseUrl, token: token, branchId: branchId);

  static const _shortTimeout = Duration(seconds: 5);

  static Map<String, dynamic> _jsonMap(dynamic value) {
    return value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  }

  static Future<List<Branch>> fetchBranches(String baseUrl) async {
    final api = DanDpakApiClient(baseUrl: baseUrl);
    final data = api.listFrom(await api.getJson(
      '/api/branches',
      timeout: _shortTimeout,
      errorMessage: 'Failed to load branches',
    ));
    return data.map((e) => Branch.fromJson(_jsonMap(e))).toList();
  }

  static Future<Map<String, dynamic>> login(
    String baseUrl,
    String username,
    String pin,
    String branchId,
  ) async {
    final api = DanDpakApiClient(baseUrl: baseUrl);
    final data = api.mapFrom(await api.postJson(
      '/api/login',
      body: {
        'username': username,
        'pin': pin,
        'branch_id': branchId,
      },
      errorMessage: 'Login failed',
    ));
    if (data['token'] == null) {
      throw Exception(data['error'] ?? data['message'] ?? 'Login failed');
    }
    return data;
  }

  Future<List<dynamic>> fetchKdsItems() async {
    return listFrom(await getJson('/api/kds/all', errorMessage: 'Failed to load KDS items'));
  }

  Future<void> updateKdsItemStatus(String itemId, String status) async {
    await postJson(
      '/api/orders/items/$itemId/status',
      body: {'status': status},
      errorMessage: 'Failed to update item status',
    );
  }

  Future<List<Zone>> fetchZones() async {
    final data = listFrom(await getJson('/api/zones', errorMessage: 'Failed to load zones'));
    return data.map((e) => Zone.fromJson(_jsonMap(e))).toList();
  }

  Future<List<TableModel>> fetchTables() async {
    final data = listFrom(await getJson('/api/tables', errorMessage: 'Failed to load tables'));
    return data.map((e) => TableModel.fromJson(_jsonMap(e))).toList();
  }

  Future<List<MenuItem>> fetchMenu() async {
    final decoded = await getJson('/api/menu', errorMessage: 'Failed to load menu');
    final data = decoded is List
        ? decoded
        : (decoded is Map && decoded['items'] is List ? decoded['items'] as List : <dynamic>[]);

    final catNames = <String, String>{};
    if (decoded is Map && decoded['categories'] is List) {
      for (final category in decoded['categories'] as List) {
        final map = _jsonMap(category);
        if (map['id'] != null) {
          catNames[map['id'].toString()] = (map['name'] ?? '').toString();
        }
      }
    }

    return data.map((item) {
      final map = _jsonMap(item);
      final categoryId = map['category_id']?.toString();
      final hasCategory = (map['category'] ?? '').toString().isNotEmpty;
      if (!hasCategory && categoryId != null) {
        map['category'] = catNames[categoryId] ?? categoryId;
      }
      return MenuItem.fromJson(map);
    }).toList();
  }

  Future<Map<String, dynamic>> createOrder({
    required String? tableId,
    required String? orderType,
    required List<Map<String, dynamic>> items,
  }) async {
    return mapFrom(await postJson(
      '/api/orders',
      body: {
        'table_id': tableId,
        'channel': orderType ?? 'dine_in',
        'source': 'staff_pos',
        'items': items,
      },
      errorMessage: 'Failed to create order',
    ));
  }

  Future<Map<String, dynamic>> checkoutOrder(
    String orderId,
    String method,
    int amountPaid,
  ) async {
    return mapFrom(await postJson(
      '/api/orders/$orderId/pay',
      body: {
        'lines': [
          {
            'method': method == 'bank' ? 'qrcode' : method,
            'amount': amountPaid,
          }
        ],
      },
      errorMessage: 'Failed to checkout order',
    ));
  }

  Future<List<Warehouse>> fetchWarehouses() async {
    final data = listFrom(await getJson('/api/warehouses', errorMessage: 'Failed to load warehouses'));
    return data.map((e) => Warehouse.fromJson(_jsonMap(e))).toList();
  }

  Future<List<InventoryItem>> fetchInventory(String warehouseId, bool isRetail) async {
    final path = isRetail ? '/api/skus' : '/api/inventory';
    final data = listFrom(await getJson(
      '$path?warehouse_id=$warehouseId',
      errorMessage: 'Failed to load inventory',
    ));
    return data.map((e) => InventoryItem.fromJson(_jsonMap(e))).toList();
  }

  Future<List<Lot>> fetchLots(String warehouseId) async {
    final data = listFrom(await getJson(
      '/api/warehouse/lots?warehouse_id=$warehouseId',
      errorMessage: 'Failed to load lots',
    ));
    return data.map((e) => Lot.fromJson(_jsonMap(e))).toList();
  }

  Future<List<dynamic>> fetchMovements() async {
    return listFrom(await getJson('/api/movements?limit=120', errorMessage: 'Failed to load movements'));
  }

  Future<Map<String, dynamic>> submitStocktake({
    required String warehouseId,
    required String name,
    required List<Map<String, dynamic>> lines,
  }) async {
    return mapFrom(await postJson(
      '/api/warehouse/stocktake',
      body: {
        'warehouse_id': warehouseId,
        'name': name,
        'mode': 'partial',
        'lines': lines,
      },
      errorMessage: 'Failed to submit stocktake',
    ));
  }

  Future<List<dynamic>> fetchStocktakeSessions() async {
    return listFrom(await getJson(
      '/api/warehouse/stocktakes',
      errorMessage: 'Failed to load stocktake sessions',
    ));
  }

  Future<void> receiveStock({
    required String warehouseId,
    required String stockType,
    required String itemId,
    required double qty,
    required String lotNo,
    required String? expiryDate,
    required double cost,
    required String supplier,
    String? uom,
  }) async {
    await postJson(
      '/api/warehouse/receive',
      body: {
        'warehouse_id': warehouseId,
        'stock_type': stockType,
        'item_id': itemId,
        'qty': qty,
        'lot_no': lotNo.isEmpty ? 'NOLOT' : lotNo,
        'expiry_date': expiryDate,
        'unit_cost': cost,
        'supplier': supplier,
        if (uom != null) 'uom': uom,
      },
      errorMessage: 'Failed to receive stock',
    );
  }

  Future<void> issueStock({
    required String warehouseId,
    required String stockType,
    required String itemId,
    required double qty,
    required String reason,
    String? uom,
  }) async {
    await postJson(
      '/api/warehouse/issue',
      body: {
        'warehouse_id': warehouseId,
        'stock_type': stockType,
        'item_id': itemId,
        'qty': qty,
        'reason': reason,
        if (uom != null) 'uom': uom,
      },
      errorMessage: 'Failed to issue stock',
    );
  }
}
