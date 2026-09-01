// NỐI MÁY IN ngay trong màn Máy in — không phải vào Cài đặt → Kết nối nữa.
//
// Người đi tìm cách nối máy in thì vào mục "Máy in", không ai nghĩ tới "Kết nối".
//
// Điều quan trọng nhất phải chốt: LƯU MỘT MÁY IN KHÔNG ĐƯỢC XOÁ CÁC MÁY KHÁC.
// Cấu hình in là một khối chung; ghi đè cả khối là mất sạch tuyến in mà cửa hàng
// đã khai, và bill sẽ không ra ở đâu cả.
import 'package:dandpak_core/src/screens/phone/phone_printer_setup.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

const phoneSize = Size(393, 852);

class _FakeApi extends ApiService {
  Map<String, dynamic>? daLuu;

  /// Cửa hàng đã có sẵn hai tuyến in.
  @override
  Future<dynamic> getJson(
    String path, {
    Duration timeout = const Duration(seconds: 30),
    String? errorMessage,
  }) async {
    if (path.startsWith('/api/settings/app')) {
      return {
        'print_config': {
          'bill': {'paper': 'K80'},
          'printers': [
            {'id': 'bep', 'name': 'BEP', 'output': 'kitchen_ticket'},
            {'id': 'quay', 'name': 'QUAY', 'output': 'receipt'},
          ],
        },
      };
    }
    return <String, dynamic>{};
  }

  @override
  Future<dynamic> postJson(
    String path, {
    Object? body,
    Duration timeout = const Duration(seconds: 30),
    String? errorMessage,
  }) async {
    daLuu = Map<String, dynamic>.from(body as Map);
    return {'ok': true};
  }
}

Future<_FakeApi> _pump(WidgetTester tester,
    {Map<String, dynamic>? printer}) async {
  final api = _FakeApi();
  tester.view.physicalSize = phoneSize;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(MultiProvider(
    providers: [Provider<ApiService>.value(value: api)],
    child: MaterialApp(
      home: Scaffold(body: PhonePrinterSetupSheet(printer: printer)),
    ),
  ));
  await tester.pump(const Duration(milliseconds: 300));
  return api;
}

List<Map> _tuyen(_FakeApi api) =>
    (((api.daLuu!['print_config'] as Map)['printers']) as List)
        .whereType<Map>()
        .toList();

Future<void> _nhapPin(WidgetTester tester) async {
  await tester.pumpAndSettle();
  await tester.enterText(
      find.byKey(const ValueKey('printer_admin_pin')), '1999');
  await tester.tap(find.text('Xác nhận'));
  await tester.pumpAndSettle();
}

void main() {
  // Bo cuc moi: [Kieu ket noi] (cham) - [May in cua may nay] (cham, chi khi
  // system) - [Ten hien thi] - [IP] [Cong] (chi khi LAN) - [Loai phieu] (cham).
  // Cac test dung che do SUA mot may in LAN co san cho tat de xac dinh.
  Map<String, dynamic> lanCoSan() => {
        'id': 'bep',
        'name': 'BEP',
        'label': 'BEP',
        'ip': '192.168.1.50',
        'port': 9100,
        'output': 'kitchen_ticket',
        'connection': 'lan',
      };

  testWidgets('may in LAN thieu ten thi KHONG luu', (tester) async {
    final api = await _pump(tester, printer: lanCoSan());
    await tester.enterText(find.byType(TextField).at(0), '');
    await tester.pump();
    await tester.tap(find.text('Lưu máy in'));
    await tester.pump();
    expect(api.daLuu, isNull);
  });

  testWidgets('may in LAN IP sai dinh dang thi KHONG luu', (tester) async {
    final api = await _pump(tester, printer: lanCoSan());
    await tester.enterText(find.byType(TextField).at(1), '192.168.1');
    await tester.pump();
    await tester.tap(find.text('Lưu máy in'));
    await tester.pump();
    expect(api.daLuu, isNull,
        reason: 'IP sai thi job xep hang roi het gio, thu ngan chi thay '
            '"khong in duoc" — phai chan tu day');
  });

  testWidgets('SUA may in LAN thi ghi de dung tuyen do, khong de ra tuyen moi',
      (tester) async {
    final api = await _pump(tester, printer: lanCoSan());
    await tester.enterText(find.byType(TextField).at(1), '192.168.1.51');
    await tester.pump();
    await tester.tap(find.text('Lưu máy in'));
    await _nhapPin(tester);

    final ds = _tuyen(api);
    expect(ds.length, 2, reason: 'sua thi khong duoc de ra tuyen thu ba');
    expect(ds.firstWhere((e) => e['id'] == 'bep')['ip'], '192.168.1.51');
    expect(ds.firstWhere((e) => e['id'] == 'bep')['paper'], 'K57');
    expect(ds.firstWhere((e) => e['id'] == 'bep')['widthMm'], 57);
    expect(ds.any((e) => e['id'] == 'quay'), true,
        reason: 'tuyen kia phai con');
  });

  testWidgets('XOA may in chi bo dung tuyen do', (tester) async {
    final api = await _pump(tester, printer: lanCoSan());
    await tester.tap(find.text('Xoá máy in này'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Xoá máy in'));
    await _nhapPin(tester);

    final ds = _tuyen(api);
    expect(ds.any((e) => e['id'] == 'bep'), false, reason: 'phai xoa duoc');
    expect(ds.any((e) => e['id'] == 'quay'), true,
        reason: 'xoa mot may in KHONG duoc keo theo may in khac');
  });

  testWidgets('giu nguyen phan cau hinh khac cua print_config', (tester) async {
    final api = await _pump(tester, printer: lanCoSan());
    await tester.enterText(find.byType(TextField).at(1), '10.0.0.5');
    await tester.pump();
    await tester.tap(find.text('Lưu máy in'));
    await _nhapPin(tester);
    final cfg = api.daLuu!['print_config'] as Map;
    expect((cfg['bill'] as Map)['paper'], 'K80',
        reason: 'kho giay bill khong lien quan gi toi viec sua may in');
  });

  testWidgets('THEM MOI mac dinh la may in cua may nay, KHONG hoi IP',
      (tester) async {
    await _pump(tester);
    // Day chinh la loi da bao: ban dau bat nhap IP nen may in gan lien va may in
    // cam USB deu khong noi duoc.
    expect(find.text('Địa chỉ IP'), findsNothing,
        reason: 'may in gan lien khong co IP — khong duoc hoi');
    expect(find.textContaining('Máy in của máy này'), findsWidgets);
  });
}
