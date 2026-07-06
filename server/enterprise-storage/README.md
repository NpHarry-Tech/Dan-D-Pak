# Enterprise Storage — DanDPak

Thư mục này chứa **bản sao lưu tự động** của toàn bộ cấu hình hệ thống.
Dữ liệu chính được lưu trong SQLite (`store.db`), thư mục này là backup file dạng JSON
để dễ đọc, dễ audit, dễ khôi phục khi cần.

---

## Cấu trúc thư mục

```
enterprise-storage/
├── system/                    ← Cấu hình toàn hệ thống (tất cả chi nhánh)
│   ├── company_info.json      ← Thông tin doanh nghiệp
│   ├── modules_config.json    ← Bật/tắt module theo gói dịch vụ
│   └── global_policies.json   ← Chính sách toàn hệ thống
│
├── branches/                  ← Cài đặt riêng từng chi nhánh
│   └── {branch_id}/
│       ├── ui_layout.json     ← Bố cục giao diện chi nhánh
│       ├── table_config.json  ← Cấu hình sơ đồ bàn
│       ├── print_config.json  ← Cấu hình máy in, hóa đơn, tem nhãn
│       ├── payment_config.json ← Phương thức thanh toán
│       └── shift_config.json  ← Cấu hình ca làm việc
│
└── users/                     ← Preferences cá nhân từng nhân viên
    └── {user_id}/
        ├── ui_state.json      ← Trạng thái UI (tab đang mở, bộ lọc...)
        ├── lang.json          ← Ngôn ngữ ưa dùng (vi/en)
        ├── shortcuts.json     ← Phím tắt tùy chỉnh
        └── notifications.json ← Tùy chọn thông báo
```

---

## Phân quyền ghi

| Scope    | Ai được ghi                    | Mô tả                       |
|----------|--------------------------------|-----------------------------|
| system   | Owner                          | Cấu hình toàn doanh nghiệp  |
| branch   | Owner, Manager (`settings.manage`) | Cài đặt theo chi nhánh |
| user     | Chính người dùng đó            | Preferences cá nhân         |

---

## API Endpoints

```
GET  /storage/system              → Xem toàn bộ system config (owner)
GET  /storage/system/:key         → Đọc một key
PUT  /storage/system/:key         → Ghi một key (owner)

GET  /storage/branch              → Xem toàn bộ branch config
GET  /storage/branch/:key         → Đọc một key theo chi nhánh hiện tại
PUT  /storage/branch/:key         → Ghi một key (manager+)

GET  /storage/user/preferences           → Xem toàn bộ preferences của mình
GET  /storage/user/preferences/:key      → Đọc một key
PUT  /storage/user/preferences/:key      → Ghi một key
POST /storage/user/preferences           → Ghi nhiều keys cùng lúc
```

---

## Frontend (web/js/core/storage.js)

```js
import { StorageManager } from '/js/core/storage.js';

// Đọc/ghi system config
StorageManager.system.get('company_info');
await StorageManager.system.save('company_info', { name: 'Dan D Pak' });

// Đọc/ghi branch config
StorageManager.branch.get('br1', 'ui_layout');
await StorageManager.branch.save('br1', 'ui_layout', { sidebarOpen: true });

// Đọc/ghi user preferences
StorageManager.user.get('usr_123', 'lang', 'vi');
await StorageManager.user.save('usr_123', 'lang', 'en');
```

---

## Lưu ý

- File `.json` trong thư mục này là **read-only backup** — không sửa trực tiếp.
- Mọi thay đổi phải qua API để đảm bảo sync với SQLite.
- File được ghi tự động mỗi khi có thay đổi qua API.
- Thư mục `users/` có thể chứa thông tin nhạy cảm — không commit lên git.
