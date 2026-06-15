# POS/ERP System - Local Store Server

Hệ thống demo chạy thật cho mô hình iPad self-order + POS/KDS + Retail + Warehouse:

iPad tự order -> Local Store Server -> KDS bếp/bar -> POS thanh toán -> trừ kho theo recipe/SKU -> Admin dashboard realtime.

## Chạy

```bash
npm install
npm start
```

Mở `http://localhost:3000`, hoặc vào thẳng các màn:

| URL | Thiết bị |
| --- | --- |
| `/ipad` | Customer iPad tự order |
| `/pos` | POS FnB |
| `/retail` | Retail POS + barcode |
| `/kds` | KDS bếp/bar/salad |
| `/warehouse` | Kho bếp + kho retail |
| `/admin` | Dashboard quản trị |

PIN demo: owner `1234`, manager `2222`, cashier `1111`, kitchen `3333`, warehouse `4444`.

## Kho mới

- Tách 2 kho mặc định: `Kho bếp / nguyên liệu & vật dụng` và `Kho hàng retail`.
- Kho bếp có `ingredient` để trừ recipe và `supply` cho vật dụng như tô, bát, đũa, muỗng.
- Retail dùng SKU/barcode riêng, không đi KDS.
- Nhập hàng có lot/batch, hạn sử dụng, nhà cung cấp, giá vốn.
- Xuất hàng, chuyển kho, kiểm kho tạo movement/audit rõ ràng.
- Hàng có hạn dùng được issue theo FEFO: lô hết hạn trước được trừ trước.
- Màn `/warehouse` hỗ trợ tạo item/SKU, nhập, xuất, kiểm kho, xem lot/HSD và lịch sử.
- Có thể chỉnh sửa thông tin hàng hóa/SKU: tên, barcode, đơn vị, nhóm, giá vốn/giá bán, tồn tối thiểu, loại nguyên liệu/vật dụng và cấu hình lot/HSD.
- Có thể chỉnh sửa hoặc xóa từng mặt hàng/SKU để setup lại danh mục kho theo ý bạn.

## Menu FnB mới

- Tạo/sửa món có ảnh, tên, giá, mô tả, station, SLA.
- Thêm nguyên liệu hiển thị cho khách và allergen/dị ứng.
- Gắn recipe trừ kho nguyên liệu khi thanh toán.
- Lịch bán: cả ngày, theo giờ mỗi ngày, theo ngày trong tuần, hoặc một ngày cụ thể.
- Có thể tắt tạm thời hoặc ẩn khỏi iPad/POS; quản trị hàng hóa/xóa hàng hóa nằm ở màn kho.

## Kiến trúc

```text
server/
  index.js              Express + Socket.IO + static web
  db.js                 SQLite schema/migration
  api.js                REST API
  seed.js               Demo branch/catalog/stock
  services/
    catalog.js          Menu metadata, schedule, recipe management
    orders.js           Order + KDS routing
    inventory.js        Warehouse, lot, movement, stocktake, FEFO
    payments.js         Multi-payment + inventory deduction
    retail.js           Retail checkout/refund
    reports.js          Dashboard KPI
web/
  ipad.html             Customer self-order
  admin.html            Dashboard + menu management
  warehouse.html        Professional stock workflow
  retail.html           Retail POS
```
