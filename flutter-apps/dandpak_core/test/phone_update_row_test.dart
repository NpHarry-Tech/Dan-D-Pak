// MỤC CẬP NHẬT trong màn "Nhiều hơn" của bản điện thoại.
//
// Trước đây muốn lên bản mới phải gỡ app rồi tải file cài lại bằng tay. Mục này
// mang cơ chế "Cập nhật ngay" của bản desktop sang điện thoại.
//
// Điều quan trọng nhất phải chốt: KHÔNG mời cập nhật khi server không có bản nào
// mới hơn. Mời nhầm là người dùng tải hơn 100 MB rồi cài lại đúng bản đang chạy.
import 'package:dandpak_core/src/app_flavor.dart';
import 'package:dandpak_core/src/screens/phone/phone_update_row.dart';
import 'package:dandpak_core/src/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

const phoneSize = Size(393, 852);

class _FakeApi extends ApiService {
  /// Build mà server khai. Đặt bằng/thấp hơn bản đang chạy để giả lập "đã mới nhất".
  int buildTrenServer;
  String ghiChu;
  bool batBuoc;
  _FakeApi({this.buildTrenServer = 99, this.ghiChu = '', this.batBuoc = false});

  @override
  Future<dynamic> getJson(
    String path, {
    Duration timeout = const Duration(seconds: 30),
    String? errorMessage,
  }) async {
    if (path.startsWith('/api/app/version')) {
      return {
        'platform': 'android-phone',
        'buildNumber': buildTrenServer,
        'version': '2026.08.01.0$buildTrenServer',
        'notes': ghiChu,
        'mandatory': batBuoc,
        'url': '/api/app/download/android-phone',
        'available': true,
      };
    }
    return <String, dynamic>{};
  }
}

Future<void> _pump(WidgetTester tester, _FakeApi api) async {
  AppFlavor.current = const AppFlavor(
    appId: 'dandpak_phone',
    versionName: '2026.08.01.01',
    buildNumber: 22,
    layout: AppLayout.handset,
    enabledModuleKeys: {'admin'},
  );
  tester.view.physicalSize = phoneSize;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(MultiProvider(
    providers: [Provider<ApiService>.value(value: api)],
    child: const MaterialApp(
      home: Scaffold(body: SingleChildScrollView(child: PhoneUpdateRow())),
    ),
  ));
  // Dò bản mới là việc bất đồng bộ. Phải cho đồng hồ chạy QUA hạn giờ 3 giây của
  // lời gọi thông báo trong checkForUpdate — trong môi trường test không có kênh
  // thông báo thật nên nó chỉ nhả khi hết hạn giờ.
  await tester.pump();
  // LocalStore persists the origin-scoped manifest through real file I/O. Give
  // that microtask/I/O queue a chance to complete before advancing widget time.
  await tester.runAsync(() => Future<void>.delayed(
        const Duration(milliseconds: 100),
      ));
  await tester.pump(const Duration(seconds: 5));
  await tester.pump();
}

void main() {
  testWidgets('server co ban MOI HON -> moi cap nhat', (tester) async {
    await _pump(tester, _FakeApi(buildTrenServer: 30));
    expect(find.textContaining('Có bản mới'), findsOneWidget);
    expect(find.text('Cập nhật ngay'), findsOneWidget);
  });

  testWidgets('server CUNG build -> KHONG moi cap nhat', (tester) async {
    await _pump(tester, _FakeApi(buildTrenServer: 22));
    expect(find.text('Cập nhật ngay'), findsNothing,
        reason:
            'moi nham la nguoi dung tai hon 100 MB de cai lai ban dang chay');
    expect(find.text('Đang dùng bản mới nhất'), findsOneWidget);
  });

  testWidgets('server build THAP HON -> KHONG moi ha cap', (tester) async {
    await _pump(tester, _FakeApi(buildTrenServer: 10));
    expect(find.text('Cập nhật ngay'), findsNothing);
  });

  testWidgets('hien so hieu ban DANG CHAY de doi chieu', (tester) async {
    await _pump(tester, _FakeApi(buildTrenServer: 22));
    expect(find.textContaining('build 22'), findsOneWidget);
  });

  testWidgets('hien ghi chu cua ban moi truoc khi tai', (tester) async {
    await _pump(
        tester,
        _FakeApi(
            buildTrenServer: 30, ghiChu: 'Sua loi in bill tren may cam tay'));
    expect(find.text('Sua loi in bill tren may cam tay'), findsOneWidget);
  });

  testWidgets('ban BAT BUOC thi noi ro la bat buoc', (tester) async {
    await _pump(tester, _FakeApi(buildTrenServer: 30, batBuoc: true));
    expect(find.textContaining('bắt buộc'), findsOneWidget);
  });

  testWidgets('dung gon trong man 6 inch, khong tran khung', (tester) async {
    await _pump(
        tester, _FakeApi(buildTrenServer: 30, ghiChu: 'Ghi chu rat dai ' * 12));
    expect(tester.takeException(), isNull);
  });
}
