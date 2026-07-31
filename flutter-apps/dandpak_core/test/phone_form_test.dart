// Biểu mẫu bản ĐIỆN THOẠI — đây là các màn GHI dữ liệu nên phải chắc hai điều:
// (1) chặn dữ liệu sai TRƯỚC khi gọi server, (2) gửi lên ĐÚNG tên trường mà
// server đọc (đối chiếu server/services/expenses.js + customers.js).
import 'package:dandpak_core/src/providers/auth_provider.dart';
import 'package:dandpak_core/src/screens/phone/phone_form_screens.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

const phoneSize = Size(393, 852);

class _FakeApi extends ApiService {
  final List<(String, Map<String, dynamic>)> posts = [];
  bool failNext = false;

  @override
  Future<dynamic> getJson(
    String path, {
    Duration timeout = const Duration(seconds: 30),
    String? errorMessage,
  }) async {
    if (path.startsWith('/api/expenses/categories')) {
      return [
        {'id': 'cat_1', 'name': 'Điện nước'},
        {'id': 'cat_2', 'name': 'Mặt bằng'},
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
    if (failNext) throw Exception('Số tiền chi phải lớn hơn 0');
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

void main() {
  group('Chi phí', () {
    testWidgets('KHÔNG gửi lên server khi số tiền bằng 0', (tester) async {
      final api = await _pump(tester, const PhoneExpenseFormScreen());
      await tester.tap(find.text('Lưu'));
      await tester.pump();
      expect(api.posts, isEmpty,
          reason: 'ghi chi phí 0đ là rác dữ liệu, phải chặn ngay tại máy');
    });

    testWidgets('gửi ĐÚNG tên trường server đọc', (tester) async {
      final api = await _pump(tester, const PhoneExpenseFormScreen());

      await tester.enterText(find.byType(TextField).first, '4200000');
      await tester.pump();
      await tester.tap(find.text('Lưu'));
      await tester.pumpAndSettle();

      expect(api.posts.length, 1);
      final (path, body) = api.posts.single;
      expect(path, '/api/expenses');
      // createExpense() đọc đúng các khoá này.
      expect(body['amount'], 4200000);
      expect(body['source'], 'direct');
      expect(body.containsKey('note'), true);
    });

    testWidgets('chọn "Chi từ két" đổi nguồn chi gửi lên', (tester) async {
      final api = await _pump(tester, const PhoneExpenseFormScreen());
      await tester.enterText(find.byType(TextField).first, '150000');
      await tester.pump();

      await tester.tap(find.text('Chi trực tiếp'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Chi từ két').last);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Lưu'));
      await tester.pumpAndSettle();
      expect(api.posts.single.$2['source'], 'drawer',
          reason: 'chi từ két phải trừ vào tiền mặt của ca đang mở');
    });

    testWidgets('số tiền gõ có dấu chấm vẫn hiểu đúng', (tester) async {
      final api = await _pump(tester, const PhoneExpenseFormScreen());
      await tester.enterText(find.byType(TextField).first, '4.200.000');
      await tester.pump();
      await tester.tap(find.text('Lưu'));
      await tester.pumpAndSettle();
      expect(api.posts.single.$2['amount'], 4200000);
    });

    testWidgets('server báo lỗi thì Ở LẠI màn, không mất dữ liệu đã gõ',
        (tester) async {
      final api = await _pump(tester, const PhoneExpenseFormScreen());
      api.failNext = true;
      await tester.enterText(find.byType(TextField).first, '99000');
      await tester.pump();
      await tester.tap(find.text('Lưu'));
      await tester.pumpAndSettle();

      // Vẫn còn trên màn biểu mẫu và nút Lưu bấm lại được.
      expect(find.text('Lưu'), findsOneWidget);
      expect(find.text('99000'), findsOneWidget);
    });
  });

  group('Đối tác', () {
    testWidgets('thiếu tên thì KHÔNG gửi', (tester) async {
      final api = await _pump(
          tester, const PhonePartnerFormScreen(isCustomer: true));
      await tester.tap(find.text('Lưu'));
      await tester.pump();
      expect(api.posts, isEmpty,
          reason: 'upsertCustomer ném "Thiếu tên liên hệ" — chặn sớm ở máy');
    });

    testWidgets('khách hàng gửi partner_type=customer', (tester) async {
      final api = await _pump(
          tester, const PhonePartnerFormScreen(isCustomer: true));
      await tester.enterText(find.byType(TextField).first, 'Trần Vĩ Khang');
      await tester.pump();
      await tester.tap(find.text('Lưu'));
      await tester.pumpAndSettle();

      final (path, body) = api.posts.single;
      expect(path, '/api/partners');
      expect(body['name'], 'Trần Vĩ Khang');
      expect(body['partner_type'], 'customer');
    });

    testWidgets('nhà cung cấp gửi partner_type=supplier', (tester) async {
      final api = await _pump(
          tester, const PhonePartnerFormScreen(isCustomer: false));
      await tester.enterText(find.byType(TextField).first, 'Nutco Việt Nam');
      await tester.pump();
      await tester.tap(find.text('Lưu'));
      await tester.pumpAndSettle();
      expect(api.posts.single.$2['partner_type'], 'supplier',
          reason: 'sai giá trị này thì NCC hiện nhầm sang danh sách khách hàng');
    });
  });
}
