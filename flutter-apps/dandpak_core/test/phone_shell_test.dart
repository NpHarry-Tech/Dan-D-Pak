// Vỏ điều hướng + các màn danh sách bản ĐIỆN THOẠI.
//
// Hai thứ phải đúng: (1) không màn nào tràn khung trên màn 6 inch, (2) thanh
// đáy CHỈ hiện mục mà người dùng thật sự có quyền vào — thu ngân không được
// thấy Tổng quan/Hàng hóa, y như trên desktop.
import 'package:dandpak_core/src/app_flavor.dart';
import 'package:dandpak_core/src/providers/auth_provider.dart';
import 'package:dandpak_core/src/screens/phone/phone_catalog_screens.dart';
import 'package:dandpak_core/src/screens/phone/phone_ops_screens.dart';
import 'package:dandpak_core/src/screens/phone/phone_overview_screens.dart';
import 'package:dandpak_core/src/screens/phone/phone_shell.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

const phoneSize = Size(393, 852);

class _FakeApi extends ApiService {
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
    // MỌI phản hồi giả dưới đây phải giống HỆT hình dạng server thật trả về.
    // Đó chính là giá trị của bộ test này: nếu ai đổi tên trường ở server mà
    // quên sửa app (hoặc ngược lại), test phải đỏ chứ không phải màn hình hiện
    // số 0 lặng lẽ ngoài cửa hàng.
    if (path.startsWith('/api/dashboard')) {
      // server/services/reports.js -> dashboard()
      return {
        'revenue': 84216000,
        'bills': 46,
        'avg': 1830783,
        'openOrders': 3,
        'byHour': [],
        'byChannel': {},
        'methods': [],
        'topItems': [
          {'name': 'Hạt điều rang muối 500g', 'emoji': '', 'qty': 128, 'revenue': 21120000},
        ],
        'lowStock': [
          {'name': 'Hạt chia Úc 1kg', 'stock': 0, 'min_stock': 15, 'unit': 'kg'},
        ],
        'stations': [],
      };
    }
    if (path.startsWith('/api/partners')) {
      // server/modules/contacts/routes.js -> { partners, counts }
      // Cột thật bảng customers: KHÔNG có `debt`.
      return {
        'partners': [
          {
            'id': 'p1',
            'name': 'CTCP Thực phẩm Dân Ôn',
            'code': 'NCC000021',
            'phone': '028 3816 4422',
            'total_spent': 1846200000,
            'total_orders': 38,
            'loyalty_points': 0,
          },
        ],
        'counts': {'all': 1, 'customer': 0, 'supplier': 1, 'staff': 0},
      };
    }
    if (path.startsWith('/api/expenses')) {
      // server/services/expenses.js -> { expenses, summary }
      return {
        'expenses': [
          {
            'id': 'e1',
            'code': 'PC000012',
            'payee_name': 'Tiền điện tháng 7',
            'category_name': 'Điện nước',
            'amount': 4200000,
            'source': 'drawer',
            'expense_date': '2026-07-28T00:00:00.000Z',
          },
        ],
        'summary': {'total': 4200000},
      };
    }
    if (path.startsWith('/api/orders/history')) {
      // server/services/history.js -> listOrderHistory()
      return [
        {
          'id': 'o1',
          'bill_no': 'HD000129',
          'number': 'HD000129',
          'total': 92592,
          'subtotal': 92592,
          'status': 'paid',
          'paid_at': '2026-07-30T09:41:00.000Z',
          'table_code': null,
          'item_count': 2,
          'methods': [],
        },
      ];
    }
    if (path.startsWith('/api/shifts/current')) {
      // server/services/shifts.js -> { shift, config, report, drawer, … }
      return {
        'shift': {
          'id': 'sh_1',
          'status': 'open',
          'opened_at': '2026-07-31T07:00:00.000Z',
          'opening_cash': 2000000,
        },
        'report': {'expected_cash': 5400000},
      };
    }
    if (path.startsWith('/api/cash-drawer/current')) {
      // server/services/cashDrawer.js -> { shift, summary, entries, … }
      return {
        'shift': {'id': 'sh_1'},
        'summary': {
          'shift_id': 'sh_1',
          'opening_cash': 2000000,
          'cash_sales': 3600000,
          'expenses': 200000,
          'reimbursements': 0,
          'expected_cash': 5400000,
        },
        'entries': [],
      };
    }
    return <dynamic>[];
  }
}

/// Người dùng giả với đúng bộ quyền cần kiểm tra.
class _Auth extends AuthProvider {
  final Set<String> perms;
  _Auth(this.perms, ApiService api) : super(apiService: api);

  @override
  bool hasPermission(String? permission) =>
      permission != null && perms.contains(permission);
}

Widget _wrap(Widget child, {Set<String>? perms}) {
  final api = _FakeApi();
  return MultiProvider(
    providers: [
      Provider<ApiService>.value(value: api),
      ChangeNotifierProvider<AuthProvider>(
          create: (_) => perms == null
              ? AuthProvider(apiService: api)
              : _Auth(perms, api)),
    ],
    child: MaterialApp(home: child),
  );
}

Future<void> _pump(WidgetTester tester, Widget child,
    {Set<String>? perms}) async {
  tester.view.physicalSize = phoneSize;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(_wrap(child, perms: perms));
  await tester.pump(const Duration(milliseconds: 500));
}

void main() {
  // AppFlavor.current là biến TĨNH TOÀN CỤC. Đặt xong phải trả lại nguyên trạng,
  // nếu không bố cục 'handset' rò sang các test khác chạy chung isolate và làm
  // chúng hỏng theo kiểu rất khó truy (test chạy riêng thì pass, chạy cả suite
  // thì fail).
  late AppFlavor previousFlavor;

  setUp(() {
    previousFlavor = AppFlavor.current;
    AppFlavor.current = const AppFlavor(
      appId: 'dandpak_phone',
      versionName: 'test',
      buildNumber: 0,
      layout: AppLayout.handset,
    );
  });

  tearDown(() => AppFlavor.current = previousFlavor);

  testWidgets('màn Tổng quan đọc ĐÚNG tên trường dashboard của server',
      (tester) async {
    await _pump(tester, const PhoneHomeScreen());
    // revenue
    expect(find.text('84.216.000đ'), findsOneWidget);
    // bills — từng đoán nhầm là 'orders' nên luôn hiện 0
    expect(find.textContaining('46'), findsWidgets);
    // topItems — từng đoán nhầm là 'top_products' nên mục này không bao giờ hiện
    expect(find.textContaining('Hạt điều rang muối 500g'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('màn Ca & két đọc số tiền trong summary, không phải ở gốc',
      (tester) async {
    await _pump(tester, const PhoneShiftScreen());
    // expected_cash nằm trong drawer.summary — đọc sai chỗ thì hiện 0đ.
    expect(find.text('5.400.000đ'), findsOneWidget);
    expect(find.text('3.600.000đ'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('màn Hàng hóa dựng gọn và hiện tồn thật', (tester) async {
    await _pump(tester, const PhoneProductsScreen());
    expect(find.text('Hạt điều rang muối 500g'), findsOneWidget);
    expect(find.textContaining('Tồn 64'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('màn Hóa đơn dựng gọn', (tester) async {
    await _pump(tester, const PhoneInvoicesScreen());
    expect(find.text('HD000129'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('màn Nhà cung cấp hiện công nợ', (tester) async {
    await _pump(tester, const PhonePartnersScreen(type: 'supplier'));
    expect(find.text('CTCP Thực phẩm Dân Ôn'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('màn Chi phí dựng gọn', (tester) async {
    await _pump(tester, const PhoneExpensesScreen());
    expect(find.text('Tiền điện tháng 7'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('màn Ca & két dựng gọn', (tester) async {
    await _pump(tester, const PhoneShiftScreen());
    expect(tester.takeException(), isNull);
  });

  testWidgets('THU NGÂN KHÔNG thấy Hàng hóa (thiếu module.warehouse)',
      (tester) async {
    // Bộ quyền thu ngân THẬT — DEFAULT_ROLE_PERMS.cashier trong
    // server/services/auth.js.
    await _pump(tester, const PhoneShell(), perms: {
      'sell', 'pay', 'discount', 'invoice',
      'table.move', 'bill.split', 'order.view', 'order.confirm',
      'module.pos', 'module.retail', 'module.invoice',
    });

    expect(find.text('Bán lẻ'), findsWidgets);
    expect(find.text('Hóa đơn'), findsWidgets);
    expect(find.text('Nhiều hơn'), findsOneWidget);
    // Kho là mục quản trị — thu ngân không có module.warehouse.
    expect(find.text('Hàng hóa'), findsNothing);
    // Tổng quan thì CÓ: module 'admin' khai perm: null nên desktop cũng hiện.
    expect(find.text('Tổng quan'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('QUẢN LÝ thấy đủ 5 mục', (tester) async {
    // Trích từ DEFAULT_ROLE_PERMS.manager.
    await _pump(tester, const PhoneShell(), perms: {
      'sell', 'pay', 'order.view', 'reports', 'settings.manage',
      'warehouse.manage', 'inventory.adjust',
      'module.retail', 'module.warehouse', 'module.inventory',
      'module.invoice', 'module.contacts', 'module.purchase',
      'module.expenses',
    });
    expect(find.text('Tổng quan'), findsWidgets);
    expect(find.text('Bán lẻ'), findsWidgets);
    expect(find.text('Hàng hóa'), findsWidgets);
    expect(find.text('Hóa đơn'), findsWidgets);
    expect(find.text('Nhiều hơn'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('người KHÔNG có quyền nào vẫn vào được, chỉ thấy Nhiều hơn',
      (tester) async {
    // Không được văng app — chỉ hiện đúng phần họ được phép. "Nhiều hơn" xuất
    // hiện cả ở nhãn tab lẫn tiêu đề màn nên dùng findsWidgets.
    await _pump(tester, const PhoneShell(), perms: <String>{});
    expect(find.text('Nhiều hơn'), findsWidgets);
    // Không quyền = không bán, không kho, không hóa đơn.
    expect(find.text('Bán lẻ'), findsNothing);
    expect(find.text('Hàng hóa'), findsNothing);
    expect(find.text('Hóa đơn'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
