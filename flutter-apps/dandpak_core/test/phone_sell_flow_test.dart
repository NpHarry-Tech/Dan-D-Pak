// Luồng bán lẻ BẢN ĐIỆN THOẠI phải chạy trọn trên khổ màn 6 inch mà không tràn
// khung, và phải dùng ĐÚNG dữ liệu server trả về (không có dữ liệu mẫu).
//
// Khổ test 393x852 = iPhone 15 / Galaxy S24 cỡ phổ thông. Đây là khổ NHỎ nhất
// nhóm máy mà bản phone nhắm tới; nhỏ hơn nữa (SE) thì các khối tiền sẽ phải
// rút gọn, và test này sẽ bắt được ngay khi có ai đổi bố cục.
import 'package:dandpak_core/src/models/retail_models.dart';
import 'package:dandpak_core/src/providers/auth_provider.dart';
import 'package:dandpak_core/src/screens/phone/phone_kit.dart';
import 'package:dandpak_core/src/screens/phone/phone_sell_screen.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

const phoneSize = Size(393, 852);

/// Giả lập server ở tầng HTTP — màn hình chạy THẬT, chỉ mạng là giả.
class _FakeApi extends ApiService {
  final List<Map<String, dynamic>> checkoutCalls = [];
  bool shiftOpen;

  _FakeApi({this.shiftOpen = true});

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
          {
            'id': 's2',
            'name': 'Hạt chia Úc 1kg',
            'barcode': 'DDP-CHI-1K',
            'sale_price': 240000,
            'stock': 0, // hết hàng — phải chặn thêm vào giỏ
            'unit': 'kg',
          },
        ],
      };
    }
    if (path.startsWith('/api/shifts/current')) {
      // Server trả BỌC trong {'shift': …} — xem pos_api.getCurrentShift().
      // Trả thẳng object ca ở đây thì getCurrentShift() đọc body['shift'] ra
      // null và màn hình tưởng chưa mở ca; test từng sai đúng chỗ này.
      return shiftOpen ? {'shift': {'id': 'sh_1', 'status': 'open'}} : {};
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
    if (path == '/api/retail/checkout') {
      checkoutCalls.add(Map<String, dynamic>.from(body as Map));
      return {'id': 'o_1', 'bill_no': 'HD000129', 'fully_settled': true};
    }
    return <String, dynamic>{};
  }
}

Widget _wrap(Widget child, _FakeApi api) {
  return MultiProvider(
    providers: [
      Provider<ApiService>.value(value: api),
      ChangeNotifierProvider<AuthProvider>(
          create: (_) => AuthProvider(apiService: api)),
    ],
    child: MaterialApp(home: child),
  );
}

Future<_FakeApi> _pump(WidgetTester tester, {bool shiftOpen = true}) async {
  final api = _FakeApi(shiftOpen: shiftOpen);
  tester.view.physicalSize = phoneSize;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(_wrap(const PhoneSellScreen(), api));
  await tester.pump(const Duration(milliseconds: 500));
  return api;
}

void main() {
  group('định dạng tiền', () {
    test('ngăn cách hàng nghìn kiểu Việt Nam', () {
      expect(phoneMoney(165000), '165.000đ');
      expect(phoneMoney(1420000000), '1.420.000.000đ');
      expect(phoneMoney(0), '0đ');
      expect(phoneMoney(999), '999đ');
      expect(phoneInt(64), '64');
      expect(phoneInt(1284), '1.284');
    });

    test('làm tròn về số nguyên đồng, không để lẻ xu trên bill', () {
      expect(phoneMoney(165000.4), '165.000đ');
      expect(phoneMoney(165000.6), '165.001đ');
    });
  });

  testWidgets('màn bán lẻ dựng gọn trên màn 6 inch, không tràn khung',
      (tester) async {
    await _pump(tester);
    expect(tester.takeException(), isNull);
    expect(find.text('Hạt điều rang muối 500g'), findsOneWidget);
  });

  testWidgets('hàng hết tồn KHÔNG thêm được vào giỏ', (tester) async {
    await _pump(tester);

    await tester.tap(find.text('Hạt chia Úc 1kg'));
    await tester.pump();

    // Không có thanh hành động = giỏ vẫn rỗng.
    expect(find.textContaining('Giỏ hàng ·'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('thêm hàng → giỏ → thanh toán tiền mặt gửi ĐÚNG dữ liệu server',
      (tester) async {
    final api = await _pump(tester);

    await tester.tap(find.text('Hạt điều rang muối 500g'));
    await tester.pump();
    expect(find.textContaining('Giỏ hàng · 1 món'), findsOneWidget);
    expect(find.textContaining('165.000đ'), findsWidgets);

    await tester.tap(find.textContaining('Giỏ hàng · 1 món'));
    await tester.pumpAndSettle();
    expect(find.text('TỔNG CỘNG'), findsOneWidget);

    await tester.tap(find.text('Thanh toán'));
    await tester.pumpAndSettle();
    expect(find.text('KHÁCH CẦN TRẢ'), findsOneWidget);

    // "Vừa đủ" điền đúng số tiền phải thu.
    await tester.tap(find.text('Vừa đủ'));
    await tester.pump();
    expect(find.text('Tiền thừa trả khách'), findsOneWidget);

    await tester.tap(find.text('Hoàn tất thanh toán'));
    await tester.pumpAndSettle();

    expect(api.checkoutCalls.length, 1, reason: 'phải gọi checkout đúng 1 lần');
    final sent = api.checkoutCalls.single;
    expect((sent['items'] as List).single['sku_id'], 's1');
    expect((sent['items'] as List).single['qty'], 1);
    expect((sent['payments'] as List).single['method'], 'cash');
    expect((sent['payments'] as List).single['amount'], 165000);
    expect('${sent['client_request_id']}'.isNotEmpty, true,
        reason: 'phải có khóa chống gửi trùng');

    expect(find.text('Đã thu tiền'), findsOneWidget);
    expect(find.text('HD000129'), findsOneWidget);
    expect(tester.takeException(), isNull);

    // Lệnh in chạy NỀN (forcePrintReceiptJob chờ 500ms rồi mới tìm job). Chờ nó
    // xong để test không kết thúc lúc còn timer treo — đồng thời khẳng định
    // đúng thiết kế: màn hình đã sang "Đã thu tiền" TRƯỚC khi in xong, thu ngân
    // không phải đứng chờ máy in.
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
  });

  testWidgets('khách đưa THIẾU tiền thì không cho hoàn tất', (tester) async {
    final api = await _pump(tester);

    await tester.tap(find.text('Hạt điều rang muối 500g'));
    await tester.pump();
    await tester.tap(find.textContaining('Giỏ hàng · 1 món'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Thanh toán'));
    await tester.pumpAndSettle();

    // Bấm '1' → khách đưa 1đ, thiếu so với 165.000đ.
    await tester.tap(find.text('1'));
    await tester.pump();
    expect(find.text('Còn thiếu'), findsOneWidget);

    await tester.tap(find.text('Hoàn tất thanh toán'));
    await tester.pumpAndSettle();
    expect(api.checkoutCalls, isEmpty,
        reason: 'thiếu tiền mà vẫn gửi checkout là mất tiền thật');
  });

  testWidgets('CHƯA MỞ CA thì không thu tiền được', (tester) async {
    final api = await _pump(tester, shiftOpen: false);
    expect(find.textContaining('Chưa mở ca'), findsWidgets);

    await tester.tap(find.text('Hạt điều rang muối 500g'));
    await tester.pump();
    await tester.tap(find.textContaining('Giỏ hàng · 1 món'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Thanh toán'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Vừa đủ'));
    await tester.pump();

    await tester.tap(find.text('Hoàn tất thanh toán'));
    await tester.pumpAndSettle();
    expect(api.checkoutCalls, isEmpty,
        reason: 'bán khi chưa mở ca thì tiền không vào ca nào để đối chiếu');
  });

  testWidgets('tăng/giảm số lượng trong giỏ đổi đúng thành tiền',
      (tester) async {
    await _pump(tester);
    await tester.tap(find.text('Hạt điều rang muối 500g'));
    await tester.pump();
    await tester.tap(find.textContaining('Giỏ hàng · 1 món'));
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.add));
    await tester.pump();
    expect(find.text('330.000đ'), findsWidgets, reason: '165.000 × 2');

    await tester.tap(find.byIcon(Icons.remove));
    await tester.pump();
    expect(find.text('165.000đ'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  test('CartLine tính thành tiền từ giá SKU thật', () {
    const sku = Sku(
      id: 's1',
      barcode: 'X',
      name: 'X',
      emoji: '',
      image: '',
      price: 165000,
      vatRate: 8,
      stock: 64,
      unit: 'gói',
      category: '',
      warehouseId: '',
      trackLot: false,
      expiryRequired: false,
    );
    expect(CartLine(sku, 3).lineTotal, 495000);
  });
}
