// Biểu mẫu CHỨNG TỪ bản điện thoại — hàng hóa mới, phiếu nhập, phiếu chuyển.
//
// Đây là các đường GHI VÀO TỒN KHO nên rủi ro cao nhất: sai một trường là lệch
// sổ kho thật. Test khẳng định thân request khớp đúng thứ server đọc
// (server/services/inventory.js + purchase.js) và chặn được các phiếu vô lý
// trước khi chúng chạm vào kho.
import 'package:dandpak_core/src/providers/auth_provider.dart';
import 'package:dandpak_core/src/screens/phone/phone_doc_form_screens.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

const phoneSize = Size(393, 852);

class _FakeApi extends ApiService {
  final List<(String, Map<String, dynamic>)> posts = [];

  @override
  Future<dynamic> getJson(
    String path, {
    Duration timeout = const Duration(seconds: 30),
    String? errorMessage,
  }) async {
    if (path.startsWith('/api/skus')) {
      return {
        'items': [
          {
            'id': 's1',
            'name': 'Hạt điều rang muối 500g',
            'barcode': 'DDP-CAS-500',
            'sale_price': 165000,
            'stock': 64,
            'unit': 'gói',
          },
        ],
      };
    }
    if (path.startsWith('/api/partners')) {
      return {
        'partners': [
          {'id': 'ncc1', 'name': 'Nutco Việt Nam'},
        ],
      };
    }
    if (path.startsWith('/api/warehouses')) {
      return [
        {'id': 'wh1', 'name': 'Kho Thủ Đức'},
        {'id': 'wh2', 'name': 'Showroom Quận 7'},
      ];
    }
    return <dynamic>[];
  }

  @override
  Future<dynamic> postJson(
    String path, {
    Object? body,
    Duration timeout = const Duration(seconds: 30),
    String? errorMessage,
  }) async {
    posts.add((path, Map<String, dynamic>.from(body as Map)));
    return {'ok': true, 'id': 'new_1'};
  }
}

Widget _wrap(Widget child, _FakeApi api) => MultiProvider(
      providers: [
        Provider<ApiService>.value(value: api),
        ChangeNotifierProvider<AuthProvider>(
            create: (_) => AuthProvider(apiService: api)),
      ],
      child: MaterialApp(home: child),
    );

Future<_FakeApi> _pump(WidgetTester tester, Widget child) async {
  final api = _FakeApi();
  tester.view.physicalSize = phoneSize;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(_wrap(child, api));
  await tester.pump(const Duration(milliseconds: 400));
  return api;
}

/// Thêm một dòng hàng qua bảng chọn (nút + trên thanh tiêu đề).
Future<void> _addLine(WidgetTester tester) async {
  await tester.tap(find.byIcon(Icons.add));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Hạt điều rang muối 500g'));
  await tester.pumpAndSettle();
}

void main() {
  group('Hàng hóa mới', () {
    testWidgets('thiếu tên thì KHÔNG gửi', (tester) async {
      final api = await _pump(tester, const PhoneProductFormScreen());
      await tester.tap(find.text('Lưu hàng hóa'));
      await tester.pump();
      expect(api.posts, isEmpty,
          reason: 'createSku ném "Thiếu tên SKU" — chặn sớm ở máy');
    });

    testWidgets('gửi đúng route và trường server đọc', (tester) async {
      final api = await _pump(tester, const PhoneProductFormScreen());
      await tester.enterText(find.byType(TextField).at(0), 'Hạt óc chó 1kg');
      await tester.enterText(find.byType(TextField).at(2), '320000');
      await tester.pump();
      await tester.tap(find.text('Lưu hàng hóa'));
      await tester.pumpAndSettle();

      final (path, body) = api.posts.single;
      expect(path, '/api/skus');
      expect(body['name'], 'Hạt óc chó 1kg');
      expect(body['price'], 320000);
      // Giá nhập tay ở cửa hàng luôn là giá đã gồm VAT.
      expect(body['price_includes_vat'], 1);
      // Tồn đầu kỳ phải đi qua opening_stock để server tạo lô OPENING, KHÔNG
      // được set thẳng cột stock (sẽ lệch sổ lô).
      expect(body.containsKey('opening_stock'), true);
      expect(body.containsKey('stock'), false);
    });
  });

  group('Phiếu nhập', () {
    testWidgets('phiếu rỗng thì nút Lưu bị khoá', (tester) async {
      final api = await _pump(tester, const PhonePurchaseFormScreen());
      await tester.tap(find.text('Lưu phiếu nhập'));
      await tester.pump();
      expect(api.posts, isEmpty,
          reason: 'savePurchaseOrder ném "Cần ít nhất một dòng hàng"');
    });

    testWidgets('gửi dòng hàng đúng định dạng buildLines()', (tester) async {
      final api = await _pump(tester, const PhonePurchaseFormScreen());
      await _addLine(tester);
      await tester.tap(find.text('Lưu phiếu nhập'));
      await tester.pumpAndSettle();

      final (path, body) = api.posts.single;
      expect(path, '/api/purchase');
      final lines = body['lines'] as List;
      expect(lines.length, 1);
      final l = lines.single as Map;
      // buildLines() bỏ qua dòng thiếu item_id hoặc qty <= 0.
      expect(l['item_id'], 's1');
      expect(l['item_type'], 'sku');
      expect(l['qty'], 1);
      expect(l['unit_cost'], 165000);
      // TỔNG do server tự tính — gửi tổng từ máy chỉ tạo cơ hội lệch số.
      expect(body.containsKey('total'), false);
      expect(body.containsKey('subtotal'), false);
    });
  });

  group('Phiếu chuyển kho', () {
    testWidgets('thiếu kho thì KHÔNG gửi', (tester) async {
      final api = await _pump(tester, const PhoneTransferFormScreen());
      await _addLine(tester);
      await tester.tap(find.text('Xuất chuyển'));
      await tester.pump();
      expect(api.posts, isEmpty);
    });

    testWidgets('kho xuất trùng kho nhận thì KHÔNG gửi', (tester) async {
      final api = await _pump(tester, const PhoneTransferFormScreen());
      await _addLine(tester);

      for (final label in ['Chọn kho nguồn', 'Chọn kho đích']) {
        await tester.tap(find.text(label));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Kho Thủ Đức').last);
        await tester.pumpAndSettle();
      }

      await tester.tap(find.text('Xuất chuyển'));
      await tester.pump();
      expect(api.posts, isEmpty,
          reason: 'chuyển kho về chính nó là phiếu vô nghĩa');
    });

    testWidgets('phiếu hợp lệ gửi đúng from/to và dòng hàng', (tester) async {
      final api = await _pump(tester, const PhoneTransferFormScreen());
      await _addLine(tester);

      await tester.tap(find.text('Chọn kho nguồn'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Kho Thủ Đức').last);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Chọn kho đích'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Showroom Quận 7').last);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Xuất chuyển'));
      await tester.pumpAndSettle();

      final (path, body) = api.posts.single;
      expect(path, '/api/warehouse/transfer');
      expect(body['from_warehouse_id'], 'wh1');
      expect(body['to_warehouse_id'], 'wh2');
      final l = (body['lines'] as List).single as Map;
      expect(l['item_id'], 's1');
      expect(l['stock_type'], 'sku');
    });
  });
}
