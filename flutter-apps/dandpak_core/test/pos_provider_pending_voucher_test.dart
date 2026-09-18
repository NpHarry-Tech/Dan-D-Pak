// CTKM sản phẩm cho dòng retail thêm qua "Thêm retail" TRƯỚC ĐÂY chỉ chọn
// được SAU KHI dòng đã gửi bếp/lưu (có orderItemId thật) — PosProvider.
// lineVouchers khoá theo orderItemId nên setLineVoucher() im lặng bỏ qua khi
// dòng còn "Mới". Giờ chọn được NGAY (giữ tạm ở CartItem.pendingVoucherId),
// PosProvider tự chuyển vào lineVouchers đúng lúc dòng có orderItemId thật.
import 'package:dandpak_core/src/models/pos_models.dart';
import 'package:dandpak_core/src/providers/pos_provider.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeApi extends ApiService {
  int _seq = 0;

  @override
  Future<dynamic> getJson(
    String path, {
    Duration timeout = const Duration(seconds: 10),
    String? errorMessage,
  }) async {
    if (path.startsWith('/api/tables')) return [];
    return <String, dynamic>{};
  }

  @override
  Future<dynamic> postJson(
    String path, {
    Object? body,
    Duration timeout = const Duration(seconds: 10),
    String? errorMessage,
  }) async {
    if (path != '/api/orders') return <String, dynamic>{};
    final payload = Map<String, dynamic>.from(body as Map);
    final items = (payload['items'] as List).cast<Map>();
    final committed = [
      for (final it in items)
        {
          'id': 'oi_${_seq++}',
          'sku_id': it['sku_id'],
          'qty': it['qty'],
          'unit_price': 220000,
          'note': it['note'] ?? '',
          'mods': it['mods'] ?? [],
          'status': 'pending_confirm',
        },
    ];
    return {'id': 'order1', 'items': committed};
  }
}

MenuItem _retailItem(String id, String name) => MenuItem(
      id: id,
      code: id,
      name: name,
      price: 220000,
      categoryId: '',
      imageUrl: '',
      modifiers: [],
      isRetail: true,
    );

void main() {
  test(
      'CTKM chọn TRƯỚC khi persisted lưu tạm ở pendingVoucherId rồi tự chuyển vào lineVouchers khi dòng có orderItemId thật',
      () async {
    final api = _FakeApi();
    final pos = PosProvider(apiService: api);
    await pos.selectTable(TableModel(
      id: 't1',
      code: 'A07',
      name: 'A07',
      zoneId: 'z1',
      status: 'free',
      activeOrderId: null,
    ));

    pos.addToCart(_retailItem('sku1', 'Andi - Điều Muối Caramel 908Gr'), [], '');
    final item = pos.cart.single;
    expect(item.persisted, isFalse, reason: 'vừa thêm — còn "Mới", chưa gửi');

    // Chọn CTKM khi dòng còn "Mới" — trước đây setLineVoucher() im lặng
    // no-op ở đây (item.orderItemId.isEmpty → return), lựa chọn bị mất.
    pos.setLineVoucher(item, 'v1');
    expect(item.pendingVoucherId, 'v1');
    expect(pos.voucherIdFor(item), 'v1',
        reason: 'phải đọc được lựa chọn dù chưa persisted');
    expect(pos.lineVouchers.isEmpty, isTrue,
        reason: 'chưa migrate vì chưa có orderItemId thật để khoá map');

    await pos.submitOrder();

    expect(item.persisted, isTrue);
    expect(item.pendingVoucherId, isNull,
        reason: 'đã chuyển sang lineVouchers, xoá bản tạm');
    expect(pos.lineVouchers[item.orderItemId], 'v1');
    expect(pos.voucherIdFor(item), 'v1',
        reason: 'đọc qua nhánh persisted vẫn phải ra đúng giá trị cũ');
  });

  test('bỏ chọn CTKM (voucherId null) xoá đúng lựa chọn ở cả hai nhánh', () async {
    final api = _FakeApi();
    final pos = PosProvider(apiService: api);
    await pos.selectTable(TableModel(
      id: 't1',
      code: 'A07',
      name: 'A07',
      zoneId: 'z1',
      status: 'free',
      activeOrderId: null,
    ));
    pos.addToCart(_retailItem('sku1', 'Andi'), [], '');
    final item = pos.cart.single;

    pos.setLineVoucher(item, 'v1');
    pos.setLineVoucher(item, null);
    expect(pos.voucherIdFor(item), isNull);

    await pos.submitOrder();
    pos.setLineVoucher(item, 'v2');
    pos.setLineVoucher(item, null);
    expect(pos.voucherIdFor(item), isNull);
    expect(pos.lineVouchers.containsKey(item.orderItemId), isFalse);
  });
}
