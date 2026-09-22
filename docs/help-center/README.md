# Dan D Pak POS Help Center

Website hướng dẫn độc lập, hỗ trợ Tiếng Việt, English và 中文. Nội dung được viết theo chức năng thật trong source Dan D Pak POS; cấu trúc trình bày tham khảo kiểu trung tâm trợ giúp theo tình huống/từng bước, không sao chép nội dung KiotViet.

## Cấu trúc

- `index.html`: shell của help center.
- `content.js`: nội dung và URL của toàn bộ bài viết ở ba ngôn ngữ.
- `content-operations.js`: nội dung Báo cáo, Quản lý, Hóa đơn, Kế toán, Cài đặt, Xử lý lỗi và vùng giữ chỗ Mobile.
- `content-detail.js`: lớp hướng dẫn vận hành chi tiết, ngoại lệ và kiểm soát bổ sung cho toàn bộ 27 bài.
- `app.js`: router, đổi ngôn ngữ, menu, tìm kiếm và placeholder ảnh.
- `styles.css`: giao diện responsive desktop/mobile.
- `assets/screenshots/`: đặt ảnh đã xử lý theo đúng tên trong `SCREENSHOT_CHECKLIST.md`.
- `assets/error-catalog.csv`: danh mục mã/thông báo lỗi sinh tự động từ source.
- `tools/generate-error-catalog.mjs`: cập nhật CSV lỗi sau mỗi bản phát hành.
- `serve.mjs`: preview cục bộ với clean URL.

## Preview cục bộ

Từ thư mục repository:

```powershell
node docs/help-center/serve.mjs
```

Mở `http://127.0.0.1:4173/vi/`. Server preview chỉ đọc file trong help-center và tự fallback mọi URL bài viết về `index.html`.

## Quy ước URL production

Ví dụ:

- `https://help.dandpakpos.io.vn/vi/kho/nhap-hang/`
- `https://help.dandpakpos.io.vn/vi/fnb/xac-nhan-don-tablet-byod/`
- `https://help.dandpakpos.io.vn/en/fnb/confirm-tablet-byod-orders/`
- `https://help.dandpakpos.io.vn/zh/payment/checkout-and-invoice/`

Ngôn ngữ nằm trong URL để link có thể chia sẻ, bookmark và lập chỉ mục độc lập. Khi đổi ngôn ngữ, trang giữ nguyên bài viết và chuyển sang URL tương ứng.

## Mapping khi deploy

Publish cả thư mục này làm document root, đồng thời map asset như sau:

```caddyfile
help.dandpakpos.io.vn {
    root * /srv/dandpak-help

    handle_path /assets/help/* {
        root * /srv/dandpak-help
        file_server
    }

    try_files {path} /index.html
    file_server
}
```

Vì HTML gọi `/assets/help/styles.css`, `/assets/help/content.js`, `/assets/help/app.js` và `/assets/help/screenshots/*`, cấu hình triển khai phải map prefix `/assets/help/` về document root. Một phương án đơn giản khác là copy các file đó sang thư mục vật lý `/assets/help/` trong artefact deploy.

## Thêm ảnh

1. Chụp theo `SCREENSHOT_CHECKLIST.md`.
2. Biên tập/cắt, che dữ liệu nhạy cảm và giữ định dạng PNG đúng với nội dung file.
3. Đặt đúng tên vào `assets/screenshots/`.
4. Reload trang. Placeholder tự được thay bằng ảnh, không cần sửa `content.js`.

## Thêm bài viết

Thêm một object vào mảng `articles` trong `content.js`, gồm `id`, `group`, `order`, `paths`, `title`, `summary`, `minutes` và `sections`. `paths`, tiêu đề và toàn bộ nội dung bắt buộc có đủ `vi`, `en`, `zh`.
