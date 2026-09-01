// Màn MÁY IN bản điện thoại.
//
// Hai lỗi đã sửa ở server ngày 2026-07-30 rất dễ bị làm hỏng lại từ phía app,
// nên khoá bằng test:
//   1. Trạng thái phải lấy từ `state`/`statusText`/`online` do server soi.
//      Cờ `active` chỉ là ô "Đang sử dụng" trong Cài đặt — máy POS tắt app vẫn
//      `active: true`, đọc nhầm là màn hình lại báo "Sẵn sàng" như lỗi cũ.
//   2. Máy in KHÔNG sẵn sàng thì không được bấm In thử, vì lệnh sẽ nằm chờ tới
//      lúc mở máy in mới ra giấy và người dùng tưởng đã in xong.
import 'package:dandpak_core/src/providers/auth_provider.dart';
import 'package:dandpak_core/src/screens/phone/phone_printers_screen.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

const phoneSize = Size(393, 852);

class _FakeApi extends ApiService {
  final List<String> posts = [];
  bool liveAsked = false;

  @override
  Future<dynamic> getJson(
    String path, {
    Duration timeout = const Duration(seconds: 30),
    String? errorMessage,
  }) async {
    if (path.startsWith('/api/print/printers')) {
      if (path.contains('live=1')) liveAsked = true;
      // Đúng hình dạng listPrinters() trả về sau bản sửa 2026-07-30.
      return [
        {
          'id': 'pos80c',
          'label': 'in bill',
          'connection': 'system',
          'target': 'POS-80C',
          'active': true,
          'online': true,
          'state': 'ok',
          'status': 'ready',
          'statusText': 'Đã kết nối · POS-QUAY-1',
          'owner_device_id': 'dev_pos1',
          'owner_device_name': 'POS-QUAY-1',
          'attached_to_me': true,
        },
        {
          'id': 'ap250',
          'label': 'in bill 2',
          'connection': 'system',
          'target': 'AP-250 Printer',
          // active vẫn TRUE dù máy POS kia đã tắt app — đây chính là cái bẫy.
          'active': true,
          'online': false,
          'state': 'bad',
          'status': 'offline',
          'statusText': 'Máy POS chưa mở app · không thấy "AP-250 Printer"',
          'owner_device_id': '',
          'owner_device_name': '',
          'attached_to_me': false,
        },
      ];
    }
    if (path.startsWith('/api/print/jobs')) {
      return [
        {
          'id': 'pj_1',
          'type': 'receipt',
          'printer': 'pos80c',
          'status': 'printed',
          'attempts': 1,
          'created_at': '2026-07-31T09:41:00.000Z',
        },
        {
          'id': 'pj_2',
          'type': 'kitchen_ticket',
          'printer': 'ap250',
          'status': 'failed',
          'attempts': 3,
          'error': 'Không kết nối được máy in LAN 192.168.1.50:9100',
          'created_at': '2026-07-31T09:12:00.000Z',
        },
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
    posts.add(path);
    return <String, dynamic>{'ok': true};
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

Future<_FakeApi> _pump(WidgetTester tester) async {
  final api = _FakeApi();
  tester.view.physicalSize = phoneSize;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(_wrap(const PhonePrintersScreen(), api));
  await tester.pump(const Duration(milliseconds: 500));
  return api;
}

void main() {
  testWidgets('màn Máy in dựng gọn trên màn 6 inch', (tester) async {
    await _pump(tester);
    expect(find.text('in bill'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('LUÔN hỏi trạng thái thật (live=1)', (tester) async {
    final api = await _pump(tester);
    expect(api.liveAsked, true,
        reason: 'thiếu live=1 thì server trả "ready" vô điều kiện');
  });

  testWidgets('hiện NGUYÊN VĂN lý do của server, không tự chế', (tester) async {
    await _pump(tester);
    expect(find.textContaining('Đã kết nối'), findsOneWidget);
    expect(find.textContaining('Máy POS chưa mở app'), findsOneWidget);
  });

  testWidgets('máy in KHÔNG sẵn sàng thì nút In thử bị khoá', (tester) async {
    await _pump(tester);
    final buttons = tester
        .widgetList<OutlinedButton>(find.byType(OutlinedButton))
        .toList();
    expect(buttons.length, 2);
    // Máy in của máy này: bấm được. Máy in ở máy POS đã tắt app: khoá.
    expect(buttons[0].onPressed, isNotNull);
    expect(buttons[1].onPressed, isNull,
        reason:
            'cho bấm thì lệnh nằm chờ, người dùng tưởng đã in — đúng lỗi cũ');
  });

  testWidgets('đánh dấu rõ máy in nào cắm vào MÁY NÀY', (tester) async {
    await _pump(tester);
    expect(find.text('Máy này'), findsOneWidget,
        reason: 'không phân biệt được thì lại thao tác nhầm máy in máy khác');
  });

  testWidgets('bấm In thử gọi đúng endpoint của máy in đó', (tester) async {
    final api = await _pump(tester);
    await tester.tap(find.text('In thử').first);
    await tester.pumpAndSettle();
    expect(api.posts, contains('/api/print/printers/pos80c/test'));
  });

  testWidgets('lịch sử hiện trạng thái và cho xem lý do lỗi', (tester) async {
    await _pump(tester);
    expect(find.text('Hóa đơn / Tạm tính'), findsOneWidget);
    expect(find.text('Đã in'), findsOneWidget);
    expect(find.text('Lỗi'), findsOneWidget);

    await tester.tap(find.text('Phiếu bếp'));
    await tester.pumpAndSettle();
    // Lý do lỗi phải hiện nguyên văn — đó là thứ nói được vì sao không ra giấy.
    expect(find.textContaining('Không kết nối được máy in LAN'), findsOneWidget);
  });

  testWidgets('in lại từ chi tiết lệnh in gọi đúng endpoint', (tester) async {
    final api = await _pump(tester);
    await tester.tap(find.text('Phiếu bếp'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('In lại'));
    await tester.pumpAndSettle();
    expect(api.posts, contains('/api/print/jobs/pj_2/reprint'));
  });

  testWidgets('mở két gọi đúng endpoint', (tester) async {
    final api = await _pump(tester);
    await tester.tap(find.text('Mở két tiền'));
    await tester.pumpAndSettle();
    expect(api.posts, contains('/api/print/cash-drawer/open'));
  });
}
