// POS Cashier "Thêm món FnB": bấm chọn nhiều món LIÊN TIẾP RẤT NHANH từng gọi
// PosProvider.submitOrder() riêng — bug thật (2026-09-08): mỗi lần gọi bắn
// NGAY một request network độc lập, và response CŨ (ít món hơn) về SAU một
// response MỚI (nhiều món hơn) sẽ THAY THẾ TOÀN BỘ giỏ hàng, xoá mất món vừa
// thêm. Test này mô phỏng ĐÚNG hành vi server thật (mỗi request server nhận
// được CHÈN THÊM item của CHÍNH request đó, không biết request song song
// khác) và xác nhận: không mất món, không gửi trùng món lên server.
import 'package:dandpak_core/src/models/pos_models.dart';
import 'package:dandpak_core/src/providers/pos_provider.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeApi extends ApiService {
  final List<Map<String, dynamic>> orderCalls = [];
  final List<Map<String, dynamic>> _committed = [];
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
    orderCalls.add(payload);
    // Độ trễ mạng GIẢ LẬP — đủ để nhiều lệnh gọi submitOrder() chồng lên nhau
    // nếu client không tự khoá tuần tự (đúng kịch bản bấm nhanh thật).
    await Future.delayed(const Duration(milliseconds: 30));
    final items = (payload['items'] as List).cast<Map>();
    for (final it in items) {
      _committed.add({
        'id': 'oi_${_seq++}',
        'menu_item_id': it['menu_item_id'],
        'qty': it['qty'],
        'unit_price': 10000,
        'note': it['note'] ?? '',
        'mods': it['mods'] ?? [],
        'status': 'pending_confirm',
      });
    }
    return {'id': 'order1', 'items': List<Map>.from(_committed)};
  }
}

MenuItem _item(String id, String name) => MenuItem(
      id: id,
      code: id,
      name: name,
      price: 10000,
      categoryId: '',
      imageUrl: '',
      modifiers: [],
    );

void main() {
  test(
      'submitOrder() không mất và không gửi trùng món khi chọn nhiều món rất nhanh',
      () async {
    final api = _FakeApi();
    final pos = PosProvider(apiService: api);
    await pos.selectTable(TableModel(
      id: 't1',
      code: 'A01',
      name: 'A01',
      zoneId: 'z1',
      status: 'free',
      activeOrderId: null,
    ));

    // Bấm 3 món liên tiếp CỰC NHANH — addToCart() rồi submitOrder() ngay,
    // không đợi lần trước xong (đúng luồng thật của _MenuPickCard.onTap).
    pos.addToCart(_item('m1', 'Trà đào'), [], '');
    final f1 = pos.submitOrder();
    pos.addToCart(_item('m2', 'Mì hoành thánh'), [], '');
    final f2 = pos.submitOrder();
    pos.addToCart(_item('m3', 'Cơm cá hồi'), [], '');
    final f3 = pos.submitOrder();

    await Future.wait([f1, f2, f3]);

    expect(pos.cart.length, 3,
        reason: 'không được rớt món nào khi thêm dồn dập');
    expect(pos.cart.map((c) => c.item.name).toSet(),
        {'Trà đào', 'Mì hoành thánh', 'Cơm cá hồi'});
    expect(pos.cart.every((c) => c.persisted), isTrue,
        reason: 'mọi món phải được server xác nhận (có orderItemId)');

    final totalSentItems = api.orderCalls
        .fold<int>(0, (s, call) => s + (call['items'] as List).length);
    expect(totalSentItems, 3,
        reason:
            'tổng số item gửi lên qua mọi lần gọi phải đúng bằng 3 — không được gửi trùng món của lần trước');
  });
}
