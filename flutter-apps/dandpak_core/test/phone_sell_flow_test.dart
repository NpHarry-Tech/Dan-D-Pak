// Luồng bán lẻ BẢN ĐIỆN THOẠI phải chạy trọn trên khổ màn 6 inch mà không tràn
// khung, và phải dùng ĐÚNG dữ liệu server trả về (không có dữ liệu mẫu).
//
// Khổ test 393x852 = iPhone 15 / Galaxy S24 cỡ phổ thông. Đây là khổ NHỎ nhất
// nhóm máy mà bản phone nhắm tới; nhỏ hơn nữa (SE) thì các khối tiền sẽ phải
// rút gọn, và test này sẽ bắt được ngay khi có ai đổi bố cục.
import 'package:dandpak_core/src/models/retail_models.dart';
import 'package:dandpak_core/src/providers/auth_provider.dart';
import 'package:dandpak_core/src/screens/phone/phone_kit.dart';
import 'package:dandpak_core/src/screens/phone/phone_return_screen.dart';
import 'package:dandpak_core/src/screens/phone/phone_sell_screen.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

const phoneSize = Size(393, 852);

/// Giả lập server ở tầng HTTP — màn hình chạy THẬT, chỉ mạng là giả.
class _FakeApi extends ApiService {
  final List<Map<String, dynamic>> checkoutCalls = [];
  final List<Map<String, dynamic>> previewPrintCalls = [];
  final List<Map<String, dynamic>> returnCalls = [];
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
            'image': '/assets/product-images/cashews.png',
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
    if (path.startsWith('/api/customers')) {
      return [
        {
          'id': 'c1',
          'code': 'DC000001',
          'name': 'Nguyễn Minh Lâm',
          'phone': '0900000001',
          'perk_type': 'pct',
          'perk_value': 10,
        },
      ];
    }
    if (path == '/api/vouchers/active') {
      return [
        {
          'id': 'promo_s1',
          'name': 'Giảm hạt điều',
          'type': 'pct',
          'value': 10,
          'scope': 'sku',
          'sku_id': 's1',
          'active': true,
          'usable': true,
        }
      ];
    }
    if (path.startsWith('/api/shifts/current')) {
      // Server trả BỌC trong {'shift': …} — xem pos_api.getCurrentShift().
      // Trả thẳng object ca ở đây thì getCurrentShift() đọc body['shift'] ra
      // null và màn hình tưởng chưa mở ca; test từng sai đúng chỗ này.
      return shiftOpen
          ? {
              'shift': {'id': 'sh_1', 'status': 'open'}
            }
          : {};
    }
    if (path.contains('/detail')) {
      // ledgerDetail đã enrich: item_snapshot có id/qty/returned_qty/unit_price.
      return {
        'bill': {'bill_code': 'HD000129', 'einvoice_status': 'ISSUED'},
        'totals': {'gross': 200000, 'total': 200000, 'vat': 0},
        'buyer_snapshot': {'name': 'Nguyễn Minh Lâm'},
        'item_snapshot': [
          {
            'id': 'oi1',
            'name': 'Hạt điều rang muối 500g',
            'item_barcode': 'DDP-CAS-500',
            'qty': 2,
            'returned_qty': 0,
            'unit_price': 100000,
            'line_total': 200000,
            'vat_rate': 0,
          },
        ],
        'payment_history': [
          {'method': 'cash', 'amount': 200000}
        ],
        'returns': const [],
      };
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
    if (path == '/api/retail/receipt/preview/print') {
      previewPrintCalls.add(Map<String, dynamic>.from(body as Map));
    }
    if (path.endsWith('/return')) {
      returnCalls.add(Map<String, dynamic>.from(body as Map));
      return {'return_id': 'r_1'};
    }
    if (path == '/api/print/return-voucher') {
      return <String, dynamic>{};
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

  testWidgets('ảnh SKU tương đối dùng đúng URL server', (tester) async {
    final api = await _pump(tester);
    final image = tester.widget<Image>(find.byType(Image).first);
    expect((image.image as NetworkImage).url,
        '${api.baseUrl}/assets/product-images/cashews.png');
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

  testWidgets('nút In trên giỏ điện thoại gửi lệnh in tạm tính',
      (tester) async {
    final api = await _pump(tester);

    await tester.tap(find.text('Hạt điều rang muối 500g'));
    await tester.pump();
    await tester.tap(find.textContaining('Giỏ hàng · 1 món'));
    await tester.pumpAndSettle();

    expect(find.byTooltip('Chọn khuyến mãi'), findsOneWidget);
    await tester.tap(find.byTooltip('Chọn khuyến mãi'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Giảm hạt điều · 10%'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Ghi chú'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'ABC123456XYZ');
    await tester.tap(find.text('Lưu'));
    await tester.pumpAndSettle();
    expect(find.text('Ghi chú: ABC123456XYZ'), findsOneWidget);

    expect(find.text('In'), findsOneWidget);
    await tester.tap(find.text('In'));
    await tester.pumpAndSettle();

    expect(api.previewPrintCalls.length, 1);
    final item = (api.previewPrintCalls.single['items'] as List).single;
    expect(item['sku_id'], 's1');
    expect(item['voucher_id'], 'promo_s1');
    expect(api.previewPrintCalls.single['note'], 'ABC123456XYZ');
    expect(api.checkoutCalls, isEmpty);
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
    expect(
      tester.widget<Text>(find.byKey(const Key('cash-live-input'))).data,
      '1đ',
      reason: 'số vừa bấm phải luôn hiện, không được bấm mù',
    );

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

  // Ưu đãi khách phải trừ vào ĐÚNG số tiền gửi lên server. Màn hình hiện một
  // số mà checkout gửi số khác thì đơn thành "trả thiếu" và bill không đóng.
  testWidgets('chọn khách có ưu đãi thì thu ĐÚNG số đã giảm', (tester) async {
    final api = await _pump(tester);

    await tester.tap(find.text('Hạt điều rang muối 500g'));
    await tester.pump();

    await tester.tap(find.text('Bán cho người tiêu dùng'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Nguyễn Minh Lâm'));
    await tester.pumpAndSettle();

    await tester.tap(find.textContaining('Giỏ hàng · 1 món'));
    await tester.pumpAndSettle();
    // 165.000 − 10% = 148.500
    expect(find.text('148.500đ'), findsWidgets);

    await tester.tap(find.text('Thanh toán'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Vừa đủ'));
    await tester.pump();
    await tester.tap(find.text('Hoàn tất thanh toán'));
    await tester.pumpAndSettle();

    final sent = api.checkoutCalls.single;
    expect((sent['payments'] as List).single['amount'], 148500);
    expect(sent['customer_id'], 'c1');
    expect(tester.takeException(), isNull);
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
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

  // MULTI-TENDER: chia tiền nhiều phương thức phải gửi ĐÚNG mảng payments tổng
  // bằng khách cần trả. Mặc định (không chia) vẫn một dòng — đã có test riêng.
  testWidgets('chia tiền 2 phương thức gửi đúng mảng payments', (tester) async {
    final api = await _pump(tester);

    await tester.tap(find.text('Hạt điều rang muối 500g'));
    await tester.pump();
    await tester.tap(find.textContaining('Giỏ hàng · 1 món'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Thanh toán'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Chia nhiều phương thức'));
    await tester.pumpAndSettle();

    // Sheet chia: 2 ô (Tiền mặt, Thẻ) — mặc định macDinh khi không có cài đặt.
    final fields = find.byType(TextFormField);
    expect(fields, findsNWidgets(2));
    await tester.enterText(fields.at(0), '100000'); // tiền mặt
    await tester.enterText(fields.at(1), '65000'); // thẻ
    await tester.pump();

    await tester.tap(find.text('Xong'));
    await tester.pumpAndSettle();
    expect(find.text('ĐÃ CHIA TIỀN'), findsOneWidget);

    await tester.tap(find.text('Hoàn tất thanh toán'));
    await tester.pumpAndSettle();

    final payments =
        (api.checkoutCalls.single['payments'] as List).cast<Map>();
    expect(payments.length, 2, reason: 'phải gửi 2 dòng tender');
    expect(payments.fold<num>(0, (a, m) => a + (m['amount'] as num)), 165000,
        reason: 'tổng chia phải bằng khách cần trả');
    expect(payments.map((m) => m['method']).toSet(), {'cash', 'visa'});

    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
  });

  // RETURN: màn Trả hàng phone dựng dòng từ ledgerDetail, chặn qty ≤ còn được
  // trả, và gửi retailReturn đúng body (order_item_id/qty/disposition).
  testWidgets('màn Trả hàng phone gửi đúng body retailReturn', (tester) async {
    final api = _FakeApi();
    tester.view.physicalSize = phoneSize;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(_wrap(
        const PhoneReturnScreen(order: {
          'order_id': 'o_1',
          'bill_code': 'HD000129',
          'status': 'paid',
          'channel': 'retail',
        }),
        api));
    await tester.pumpAndSettle();

    // Dòng hàng hiện "Đã bán 2 · Còn 2".
    expect(find.textContaining('Đã bán 2'), findsOneWidget);
    expect(find.textContaining('Còn 2'), findsOneWidget);

    // Trả 1 món.
    await tester.tap(find.byIcon(Icons.add));
    await tester.pump();
    expect(find.text('Trả hàng · 100.000đ'), findsOneWidget);

    await tester.tap(find.text('Trả hàng · 100.000đ'));
    await tester.pumpAndSettle();

    final body = api.returnCalls.single;
    final item = (body['items'] as List).single as Map;
    expect(item['order_item_id'], 'oi1');
    expect(item['qty'], 1);
    expect(item['disposition'], 'restock');
    expect(body['refund_method'], 'original');
  });
}
