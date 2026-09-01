// Step 2 multi-device — client canonical order controller. Chứng minh money
// integrity phía client: adopt canonical (không merge đoán), conflict→reload,
// lease-lost/paid→read-only, reconnect không replay local.
import 'package:dandpak_core/src/api_client.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:dandpak_core/src/services/retail_canonical.dart';
import 'package:dandpak_core/src/services/retail_order_session.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeApi extends ApiService {
  Object? commandResponse; // Map = success, ApiException = throw
  Map<String, dynamic> canonical = {};

  @override
  Future<dynamic> postJson(String path,
      {Object? body,
      Duration timeout = const Duration(seconds: 30),
      String? errorMessage}) async {
    if (path == '/api/retail/orders') {
      return {
        'order_id': 'ord_1', 'display_sequence': 14, 'revision': 0,
        'lease_token': 'lt', 'status': 'open', 'snapshot': {'lines': []},
      };
    }
    if (path.contains('/command') || path.contains('/lease/heartbeat')) {
      final r = commandResponse;
      if (r is ApiException) throw r;
      if (r is Map) return r;
      return {'order_id': 'ord_1', 'revision': 1, 'status': 'open', 'snapshot': {'lines': []}};
    }
    return {'ok': true};
  }

  @override
  Future<dynamic> getJson(String path,
      {Duration timeout = const Duration(seconds: 30), String? errorMessage}) async {
    if (path.contains('/retail/orders/')) return canonical;
    return {};
  }
}

RetailOrderSession _session(_FakeApi api,
        {int revision = 1, Map<String, dynamic>? snapshot}) =>
    RetailOrderSession(api,
        device: 'A', orderId: 'ord_1', displaySequence: 14,
        revision: revision, leaseToken: 'lt', snapshot: snapshot);

void main() {
  test('nhãn dùng display_sequence SERVER, không tabs.length+1', () async {
    final s = await RetailOrderSession.create(_FakeApi(), device: 'A');
    expect(s.displaySequence, 14);
    expect(s.label, 'Hóa đơn 14');
  });

  test('applyCommand ADOPT canonical revision+snapshot (không merge đoán)', () async {
    final api = _FakeApi()
      ..commandResponse = {'revision': 5, 'status': 'open', 'snapshot': {'lines': [{'x': 1}]}};
    final s = _session(api, revision: 0);
    expect(await s.applyCommand('ADD_LINE', {'sku_id': 's'}), true);
    expect(s.revision, 5);
    expect((s.snapshot['lines'] as List).length, 1);
  });

  test('ORDER_VERSION_CONFLICT → reload canonical, vẫn editable', () async {
    final api = _FakeApi()
      ..commandResponse = ApiException('c', statusCode: 409, code: 'ORDER_VERSION_CONFLICT')
      ..canonical = {'revision': 7, 'status': 'open', 'snapshot': {'lines': []}};
    final s = _session(api, revision: 3);
    expect(await s.applyCommand('CHANGE_QTY', {'line_id': 'l', 'qty': 2}), false);
    expect(s.revision, 7);
    expect(s.readOnly, false);
  });

  test('EDIT_LEASE_LOST → read-only + reload', () async {
    final api = _FakeApi()
      ..commandResponse = ApiException('lost', statusCode: 409, code: 'EDIT_LEASE_LOST')
      ..canonical = {'revision': 2, 'status': 'open', 'snapshot': {}};
    final s = _session(api);
    await s.applyCommand('SET_NOTE', {'note': 'x'});
    expect(s.readOnly, true);
    expect(s.blockReason, contains('tiếp quản'));
  });

  test('ORDER_FINALIZED → read-only, status paid', () async {
    final api = _FakeApi()
      ..commandResponse = ApiException('paid', statusCode: 409, code: 'ORDER_FINALIZED');
    final s = _session(api);
    await s.applyCommand('SET_NOTE', {'note': 'x'});
    expect(s.readOnly, true);
    expect(s.status, 'paid');
  });

  test('order.paid event → read-only; order KHÁC không ảnh hưởng', () async {
    final s1 = _session(_FakeApi());
    await s1.onServerEvent('order.paid', {'order_id': 'ord_1'});
    expect(s1.readOnly, true);
    final s2 = _session(_FakeApi());
    await s2.onServerEvent('order.paid', {'order_id': 'ord_OTHER'});
    expect(s2.readOnly, false);
  });

  test('reconnect → reload canonical, KHÔNG giữ stale local', () async {
    final api = _FakeApi()
      ..canonical = {'revision': 9, 'status': 'open', 'snapshot': {'lines': [{'y': 1}]}};
    final s = _session(api, revision: 2, snapshot: {'lines': [{'stale': 1}]});
    await s.onReconnect();
    expect(s.revision, 9);
    expect(s.snapshot['lines'], [{'y': 1}]);
  });

  test('order.lease.revoked cho device mình → read-only', () async {
    final api = _FakeApi()..canonical = {'revision': 1, 'status': 'open', 'snapshot': {}};
    final s = _session(api);
    await s.onServerEvent('order.lease.revoked', {'order_id': 'ord_1', 'revoked_device': 'A'});
    expect(s.readOnly, true);
  });

  test('pricing getters đọc canonical (server-authoritative) từ snapshot', () async {
    final api = _FakeApi()
      ..commandResponse = {
        'revision': 1, 'status': 'open',
        'snapshot': {
          'pricing': {'subtotal': 2000, 'discount': 300, 'total': 1700},
          'priced_lines': [
            {'name': 'Hạt điều', 'qty': 2, 'unit_price': 1000, 'line_total': 1700}
          ],
        },
      };
    final s = _session(api, revision: 0);
    await s.applyCommand('ADD_LINE', {'sku_id': 's1', 'qty': 2});
    expect(s.subtotal, 2000);
    expect(s.discount, 300);
    expect(s.total, 1700);
    expect(s.pricedLines.length, 1);
    expect(s.pricedLines[0]['name'], 'Hạt điều');
  });

  test('heartbeat mất lease → read-only', () async {
    final api = _FakeApi()
      ..commandResponse = ApiException('lost', statusCode: 409, code: 'EDIT_LEASE_LOST')
      ..canonical = {'revision': 1, 'status': 'open', 'snapshot': {}};
    final s = _session(api);
    await s.heartbeat();
    expect(s.readOnly, true);
  });

  // §2 vòng canonical END-TO-END (client): ADD_LINE structural → server trả
  // priced_lines (có line_id) → renderCanonical hiện SỐ SERVER; client không tính
  // lại. Đây là loop mà màn Retail dựa vào khi bật gate canonicalOrders.
  test('ADD_LINE → renderCanonical hiện total SERVER + line_id để CHANGE_QTY', () async {
    final api = _FakeApi()
      ..commandResponse = {
        'revision': 2, 'status': 'open',
        'snapshot': {
          'priced_lines': [
            {
              'line_id': 'ln_1_abc', 'sku_id': 's1', 'name': 'Hạt điều',
              'unit': 'gói', 'qty': 2, 'unit_price': 1000, 'orig_price': 1000,
              'lot_id': null, 'price_override': null,
              'promo': {'label': 'CTKM', 'amount': 300}, 'line_total': 1700,
            },
          ],
          'pricing': {
            'subtotal': 2000, 'discount': 300, 'lineDiscount': 300,
            'orderDiscount': 0, 'total': 1700,
          },
        },
      };
    final s = _session(api, revision: 0);
    // Payload structural KHÔNG mang giá client (server tự áp).
    final ok = await s.applyCommand('ADD_LINE', addLinePayload(skuId: 's1', qty: 2));
    expect(ok, true);

    final r = renderCanonical(s.snapshot);
    expect(r.total, 1700, reason: 'total lấy từ server pricing');
    expect(r.subtotal, 2000);
    expect(r.itemCount, 2);
    final line = r.lines.single;
    expect(line.lineId, 'ln_1_abc', reason: 'line_id để CHANGE_QTY/REMOVE đúng dòng');
    expect(line.lineTotal, 1700);
    expect(line.promoLabel, 'CTKM');

    // Từ dòng render, dựng payload CHANGE_QTY qua đúng line_id.
    final chg = changeQtyPayload(lineId: line.lineId!, qty: line.qty + 1);
    expect(chg['line_id'], 'ln_1_abc');
    expect(chg['qty'], 3);
  });

  test('takeover: lease-lost → tiếp quản → hết read-only, sửa lại được', () async {
    final api = _FakeApi()
      ..commandResponse = ApiException('lost', statusCode: 409, code: 'EDIT_LEASE_LOST')
      ..canonical = {'revision': 3, 'status': 'open', 'snapshot': {'priced_lines': []}};
    final s = _session(api, revision: 1);
    // Mất lease khi ghi → read-only.
    await s.applyCommand('ADD_LINE', {'sku_id': 's'});
    expect(s.readOnly, true);
    // Tiếp quản: server cấp lease mới + canonical status open → hết read-only.
    final took = await s.takeover();
    expect(took, true);
    expect(s.readOnly, false);
    expect(s.revision, 3, reason: 'đã reload canonical sau tiếp quản');
  });

  test('takeover thất bại (đơn đã paid) → vẫn read-only', () async {
    final api = _FakeApi();
    final s = _session(api);
    s.readOnly = true;
    s.status = 'paid';
    // Server từ chối takeover đơn đã kết thúc.
    api.canonical = {'revision': 9, 'status': 'paid', 'snapshot': {}};
    // takeover gọi API (fake trả ok) rồi reload → status paid → read-only lại.
    final took = await s.takeover();
    expect(took, false);
    expect(s.readOnly, true);
  });

  test('order.paid (socket) → session read-only, render vẫn đọc được để in', () async {
    final api = _FakeApi();
    final s = _session(api, revision: 1, snapshot: {
      'priced_lines': [
        {'line_id': 'l1', 'sku_id': 's1', 'name': 'X', 'unit': '', 'qty': 1,
         'unit_price': 5000, 'orig_price': 5000, 'line_total': 5000, 'promo': null},
      ],
      'pricing': {'subtotal': 5000, 'discount': 0, 'total': 5000},
    });
    await s.onServerEvent('order.paid', {'order_id': 'ord_1'});
    expect(s.readOnly, true);
    final r = renderCanonical(s.snapshot);
    expect(r.total, 5000, reason: 'đã paid vẫn render được để in/đối soát');
  });
}
