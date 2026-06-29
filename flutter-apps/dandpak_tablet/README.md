# Dan D Pak — Tablet Client App (Flutter)

Đây là **Phase 2 (P2) Native Migration**: Ứng dụng tích hợp Gọi món (Touch Ordering), KDS (Kitchen Display System), và Quản lý kho (Inventory) dành cho máy tính bảng Android và iPad.

## Các tính năng chính đã tích hợp:
1. **Tìm máy chủ tự động (LAN Discovery)**: Tự động quét dải IP nội bộ trên cổng 3000 để tìm và kết nối tới máy chủ trung tâm.
2. **Đăng nhập bảo mật (Secure PIN pad)**: Giao diện nhập mã PIN riêng với khả năng chọn chi nhánh và lưu thông tin đăng nhập tự động.
3. **Màn hình KDS**: Bảng quản lý món chờ làm, lọc theo quầy bếp (Bếp chính, Bar, Salad, Pha chế), đồng hồ đo SLA đổi màu linh hoạt (xanh -> vàng -> đỏ) cập nhật realtime qua Socket.IO.
4. **Gọi món cảm ứng (Touch Ordering)**: Bản đồ khu vực/bàn, danh mục phân loại món ăn, grid món hình ảnh/emoji lớn, tùy chọn modifier (topping/ghi chú món), và cart thanh toán nhanh.
5. **Quản lý kho (Inventory)**: Xem tồn kho, cảnh báo định mức thấp, nhập/xuất nhanh có quản lý Lot/HSD/nhà cung cấp, và phiếu kiểm kho (stocktake) cân bằng kho kiểu KiotViet.

---

## Cài đặt và Chạy ứng dụng

### 1. Chuẩn bị Flutter SDK (nếu chưa có)
- Tải SDK tại: https://docs.flutter.dev/get-started/install/windows
- Giải nén và thêm đường dẫn `flutter\bin` vào biến môi trường **PATH** của Windows.
- Chạy thử lệnh sau trong terminal mới để kiểm tra:
  ```bat
  flutter --version
  flutter doctor
  ```

### 2. Khởi tạo môi trường nền tảng (Platform folder)
Vì mã nguồn được cấu trúc tối giản gọn nhẹ (chỉ chứa `lib/` và `pubspec.yaml`), bạn cần chạy lệnh sau để Flutter sinh thư mục platform cho Windows/Android:
```bat
cd flutter-apps\dandpak_tablet
flutter create . --platforms=windows,android --project-name dandpak_tablet
```
> [!IMPORTANT]
> Nếu lệnh trên ghi đè hoặc làm thay đổi các file trong thư mục `lib/` hoặc file `pubspec.yaml`, hãy khôi phục lại các file đó từ Git. Chỉ giữ lại các thư mục nền tảng mới được tạo ra (`android/`, `windows/`).

### 3. Cài đặt các gói phụ thuộc (Dependencies)
```bat
flutter pub get
```

### 4. Khởi động chạy thử (Debug Mode)
Chạy trên Windows Desktop:
```bat
flutter run -d windows
```
Chạy trên thiết bị Android hoặc máy ảo (đảm bảo thiết bị đã cắm cáp USB và bật USB Debugging):
```bat
flutter run -d android
```

---

## Biên dịch xuất bản (Release Mode)

Để cài đặt chính thức lên thiết bị thực tế, bạn cần build bản release để ứng dụng đạt hiệu năng cao nhất, mượt nhất và tiết kiệm RAM tối đa:

### Build bản Windows Desktop:
```bat
flutter build windows --release
```
*Kết quả nằm tại: `build\windows\x64\runner\Release\`*

### Build file cài đặt APK cho máy tính bảng Android:
```bat
flutter build apk --release
```
*Kết quả file `.apk` nằm tại: `build\app\outputs\flutter-apk\app-release.apk`*
