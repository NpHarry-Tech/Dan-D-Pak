// CATALOGUE KHÁCH CHỈ CHẠY TRÊN TABLET.
//
// Đây là màn KHÁCH toàn màn hình, thoát bằng bấm logo 3 lần + mật khẩu. Trên
// máy POS để bàn mà mở nhầm thì thu ngân tự khoá mình sau lớp mật khẩu đó ngay
// giữa lúc đang bán hàng; trên điện thoại nhân viên thì vô nghĩa vì máy không
// đặt ngoài quầy cho khách cầm.
//
// Ba app khai bộ lọc theo ba cách khác nhau nên rất dễ lệch:
//   tablet  : liệt kê cho phép  -> phải CÓ 'catalogue'
//   phone   : liệt kê cho phép  -> phải KHÔNG có
//   desktop : enabledModuleKeys = null (hiện tất cả) -> phải CẤM đích danh
// Test khoá cả ba, đặc biệt là desktop — chỗ dễ quên nhất vì nó "hiện tất cả".
import 'package:dandpak_core/src/app_flavor.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  AppFlavor tablet() => const AppFlavor(
        appId: 'dandpak_tablet',
        versionName: 'test',
        buildNumber: 1,
        layout: AppLayout.tablet,
        enabledModuleKeys: {'retail', 'catalogue', 'pos'},
      );

  AppFlavor phone() => const AppFlavor(
        appId: 'dandpak_phone',
        versionName: 'test',
        buildNumber: 1,
        layout: AppLayout.handset,
        enabledModuleKeys: {'retail', 'admin'},
      );

  AppFlavor desktop() => const AppFlavor(
        appId: 'dandpak_desktop',
        versionName: 'test',
        buildNumber: 1,
        layout: AppLayout.station,
        enabledModuleKeys: null,
        disabledModuleKeys: {'catalogue'},
      );

  test('tablet MO duoc catalogue', () {
    expect(tablet().showsModule('catalogue'), isTrue);
  });

  test('phone KHONG thay catalogue', () {
    expect(phone().showsModule('catalogue'), isFalse);
  });

  test('desktop hien tat ca module NHUNG van cam catalogue', () {
    final d = desktop();
    // Module bat ky khac van hien — day la y nghia cua enabledModuleKeys = null.
    expect(d.showsModule('retail'), isTrue);
    expect(d.showsModule('warehouse'), isTrue);
    expect(d.showsModule('mot-module-moi-nao-do'), isTrue);
    // Rieng catalogue thi khong.
    expect(d.showsModule('catalogue'), isFalse);
  });

  test('danh sach CAM thang danh sach CHO PHEP khi hai ben mau thuan', () {
    // Chot quy tac uu tien: cam la cam, du co ai lo them vao danh sach cho phep.
    const mauThuan = AppFlavor(
      appId: 'test',
      versionName: 'test',
      buildNumber: 1,
      enabledModuleKeys: {'catalogue'},
      disabledModuleKeys: {'catalogue'},
    );
    expect(mauThuan.showsModule('catalogue'), isFalse);
  });

  test('khong khai disabledModuleKeys thi khong doi hanh vi cu', () {
    const cu = AppFlavor(
      appId: 'test',
      versionName: 'test',
      buildNumber: 1,
      enabledModuleKeys: null,
    );
    expect(cu.showsModule('catalogue'), isTrue);
    expect(cu.showsModule('retail'), isTrue);
  });
}
