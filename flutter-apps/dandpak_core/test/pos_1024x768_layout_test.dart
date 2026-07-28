// Máy POS của cửa hàng chạy 1024x768. Đây là khổ màn NHỎ NHẤT phải chạy được,
// nên mọi màn chính phải dựng ở đúng kích thước đó mà không tràn khung.
//
// Flutter báo tràn bằng exception "A RenderFlex overflowed by N pixels" ngay khi
// dựng; `tester.takeException()` bắt được. Trước đây không có test nào canh khổ
// này nên lỗi chỉ lộ ra khi thu ngân dùng thật.
import 'package:dandpak_core/src/providers/auth_provider.dart';
import 'package:dandpak_core/src/screens/contacts/contacts_screen.dart';
import 'package:dandpak_core/src/screens/database/database_screen.dart';
import 'package:dandpak_core/src/screens/expenses/expenses_screen.dart';
import 'package:dandpak_core/src/screens/invoices/invoices_screen.dart';
import 'package:dandpak_core/src/screens/printers/printers_screen.dart';
import 'package:dandpak_core/src/screens/purchase/purchase_screen.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

const posSize = Size(1024, 768);

/// Giả lập server ở tầng HTTP (xem ghi chú trong settings_permissions_smoke_test).
class _FakeApi extends ApiService {
  @override
  Future<dynamic> getJson(
    String path, {
    Duration timeout = const Duration(seconds: 30),
    String? errorMessage,
  }) async {
    if (path.startsWith('/api/contacts')) {
      return List.generate(
          12,
          (i) => {
                'id': 'c_$i',
                'code': 'DC${i.toString().padLeft(6, '0')}',
                'name': 'Khách hàng số $i',
                'phone': '09${i.toString().padLeft(8, '0')}',
                'kind': 'customer',
                'debt': 0,
              });
    }
    return <dynamic>[];
  }
}

Widget _wrap(Widget child) {
  final api = _FakeApi();
  return MultiProvider(
    providers: [
      Provider<ApiService>.value(value: api),
      ChangeNotifierProvider<AuthProvider>(
          create: (_) => AuthProvider(apiService: api)),
    ],
    child: MaterialApp(home: Scaffold(body: child)),
  );
}

Future<void> _pumpAtPosSize(WidgetTester tester, Widget child) async {
  tester.view.physicalSize = posSize;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(_wrap(child));
  await tester.pump(const Duration(milliseconds: 400));
}

void main() {
  testWidgets('màn Khách hàng dựng gọn trong 1024x768, không tràn khung',
      (tester) async {
    await _pumpAtPosSize(tester, ContactsScreen());
    expect(tester.takeException(), isNull);
  });

  testWidgets('ở 1024x768 cột lọc thu vào nút "Bộ lọc" để nhường chỗ cho bảng',
      (tester) async {
    await _pumpAtPosSize(tester, ContactsScreen());
    // Dưới 1100px: cột lọc KHÔNG hiện thẳng, thay bằng nút mở side-sheet.
    expect(find.byIcon(Icons.filter_list), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  // Quét các màn chính còn lại ở đúng khổ máy POS. Mục tiêu là bắt tràn khung,
  // nên chỉ cần dựng được và không ném exception.
  //
  // KHÔNG có trong danh sách: các màn mở Socket.IO ngay trong initState (Kênh
  // online, POS, Retail, KDS, Quản lý). Chúng để lại timer kết nối lại mà test
  // binding không cho phép ("A Timer is still pending"), nên không dựng thẳng
  // trong widget test được — cần một SocketService giả, việc đó tách riêng.
  final screens = <String, Widget Function()>{
    'Chi phí': () => ExpensesScreen(),
    'Hóa đơn': () => InvoicesScreen(),
    'Mua hàng': () => PurchaseScreen(),
    'Cơ sở dữ liệu': () => DatabaseScreen(),
    'Máy in': () => PrintersScreen(),
  };
  screens.forEach((name, build) {
    testWidgets('màn $name dựng gọn trong 1024x768, không tràn khung',
        (tester) async {
      await _pumpAtPosSize(tester, build());
      expect(tester.takeException(), isNull);
    });
  });

  testWidgets('màn hình rộng vẫn giữ cột lọc hiện thẳng như cũ',
      (tester) async {
    tester.view.physicalSize = const Size(1600, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(_wrap(ContactsScreen()));
    await tester.pump(const Duration(milliseconds: 400));
    // Từ 1100px trở lên: cột lọc nằm luôn trên màn, không cần nút.
    expect(find.byIcon(Icons.filter_list), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
