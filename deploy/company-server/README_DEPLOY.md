# Hướng Dẫn Triển Khai Hệ Thống Dan D Pak POS/ERP — Máy Chủ Công Ty

> **Tài liệu này dành cho đội kỹ thuật.** Đọc kỹ từ đầu đến cuối trước khi thao tác.

---

## Tổng Quan Kiến Trúc

```
[Thiết bị khách: iPad / PC / Browser]
          │  HTTP / WebSocket
          ▼
    ┌─────────────┐
    │   Caddy :80 │  ← Reverse proxy (HTTP, không cần TLS nội bộ)
    └──────┬──────┘
           │
    ┌──────▼──────────────────────────────────┐
    │   Node.js App  :3000                    │
    │   • Express REST API   /api/*           │
    │   • Socket.IO realtime /socket.io/*     │
    │   • Static web files   /                │
    └──────┬──────────────────────────────────┘
           │
    ┌──────▼──────┐
    │  SQLite WAL │  ← Cơ sở dữ liệu chính (file /app/server-data/store.db)
    └─────────────┘
```

**Stack:**
- **Runtime**: Node.js 22 (ESM)
- **Database chính**: SQLite với WAL mode (nhanh, không cần cài gì thêm)
- **Realtime**: Socket.IO 4
- **Reverse Proxy**: Caddy 2
- **Đóng gói**: Docker Compose

---

## 1. Yêu Cầu Máy Chủ

| Yêu cầu | Tối thiểu | Khuyến nghị |
|---|---|---|
| OS | Linux (Ubuntu 20.04+, Debian 11+) | Ubuntu 22.04 LTS |
| CPU | 1 core | 2 core |
| RAM | 512 MB | 1–2 GB |
| Disk | 10 GB | 20 GB SSD |
| Docker | 20.10+ | 24.x+ |
| Docker Compose | v2.0+ | v2.20+ |
| Cổng mở | 80, 443 | 80 (HTTP trong mạng LAN) |

> **Lưu ý**: Hệ thống hoạt động hoàn toàn trong mạng nội bộ (LAN). Không cần kết nối Internet trừ khi dùng VietQR API / payOS.

---

## 2. Triển Khai Lần Đầu (5 bước)

### Bước 1 — Clone hoặc copy source code lên máy chủ

```bash
# Nếu dùng Git (khuyến nghị):
git clone <repository-url> /opt/dan-d-pak
cd /opt/dan-d-pak

# Hoặc nếu nhận file ZIP:
unzip dan-d-pak.zip -d /opt/dan-d-pak
cd /opt/dan-d-pak
```

### Bước 2 — Tạo file `.env` từ mẫu

```bash
cd deploy/company-server
cp .env.example .env
nano .env   # hoặc: vim .env
```

**Chỉnh các giá trị bắt buộc:**

```dotenv
# Địa chỉ IP tĩnh hoặc hostname của máy chủ trong mạng nội bộ
APP_DOMAIN=192.168.1.100
APP_URL=http://192.168.1.100
API_BASE_URL=http://192.168.1.100
CORS_ORIGIN=http://192.168.1.100

# Mật khẩu PostgreSQL (thay thế bắt buộc, không để mặc định)
POSTGRES_PASSWORD=Mat_Khau_Manh_2024!

# Secret keys — generate bằng: openssl rand -hex 32
JWT_SECRET=<random-64-char-hex>
SESSION_SECRET=<random-64-char-hex>
```

### Bước 3 — Khởi chạy hệ thống

```bash
# Từ thư mục deploy/company-server:
docker compose up -d --build
```

Lần đầu sẽ mất **2–5 phút** để tải Node image và build. Lần sau chỉ ~30 giây.

### Bước 4 — Kiểm tra hoạt động

```bash
# Xem log realtime:
docker compose logs -f app

# Hoặc chạy health check script:
chmod +x scripts/healthcheck.sh && ./scripts/healthcheck.sh
```

Kết quả thành công:
```
✓ App healthy: {"ok":true,"service":"dan-d-pak-pos-erp",...}
```

### Bước 5 — Truy cập hệ thống

| Màn hình | URL |
|---|---|
| Trang chủ / Chọn màn hình | `http://192.168.1.100/` |
| Bán hàng POS | `http://192.168.1.100/pos` |
| iPad tự gọi món | `http://192.168.1.100/ipad` |
| Màn hình bếp KDS | `http://192.168.1.100/kds` |
| Quản lý Admin | `http://192.168.1.100/admin` |
| Cài đặt hệ thống | `http://192.168.1.100/settings` |
| Health check | `http://192.168.1.100/health` |

**Đăng nhập mặc định:**
- Username: `admin`
- PIN: `1234`
- ⚠️ **Đổi PIN ngay sau lần đăng nhập đầu tiên!**

---

## 3. Sao Lưu & Khôi Phục Dữ Liệu

### 3.1. Backup thủ công

```bash
# Từ deploy/company-server/:
chmod +x scripts/backup-db.sh
./scripts/backup-db.sh
```

File backup được lưu vào `deploy/company-server/backups/store_YYYYMMDD_HHMMSS.db`

### 3.2. Lên lịch backup tự động (cron)

```bash
# Thêm vào crontab của user chạy Docker (crontab -e):
# Backup lúc 3:00 sáng mỗi ngày
0 3 * * * cd /opt/dan-d-pak/deploy/company-server && ./scripts/backup-db.sh >> /var/log/dandpak-backup.log 2>&1
```

### 3.3. Restore từ backup

```bash
chmod +x scripts/restore-db.sh
./scripts/restore-db.sh backups/store_20260623_030000.db
```

---

## 4. Cập Nhật Hệ Thống (Update)

```bash
cd /opt/dan-d-pak

# 1. Pull code mới (hoặc copy file mới)
git pull

# 2. Backup DB trước khi update (an toàn)
cd deploy/company-server && ./scripts/backup-db.sh && cd ../..

# 3. Rebuild và restart
cd deploy/company-server
docker compose up -d --build

# 4. Kiểm tra log
docker compose logs -f app
```

> ✅ Database schema tự động migration khi server khởi động — không cần chạy lệnh migration thủ công.

---

## 5. Quản Trị Hằng Ngày

```bash
# Xem log realtime
docker compose logs -f app

# Xem tất cả containers
docker compose ps

# Restart app (không mất data)
docker compose restart app

# Restart toàn bộ stack
./scripts/restart.sh

# Dừng hệ thống (data vẫn giữ nguyên)
docker compose down

# Xem dung lượng sử dụng
docker system df
```

---

## 6. Cấu Trúc Volume Dữ Liệu

Docker Volumes đảm bảo data không mất khi restart/update:

| Volume | Nội dung | Vị trí trong container |
|---|---|---|
| `app_sqlite` | SQLite database chính (`store.db`) | `/app/server-data/` |
| `app_storage` | File uploads, tài liệu | `/app/storage/` |
| `postgres_data` | PostgreSQL (backup sidecar) | `/var/lib/postgresql/data/` |
| `db_backups` | Dump PostgreSQL | `/backups/` |
| `caddy_data` | TLS certificates (nếu dùng HTTPS) | `/data/` |

---

## 7. Thiết Lập Sau Khi Cài

Sau khi hệ thống chạy, đăng nhập vào **Admin → Cài đặt** để:

1. **Đổi PIN admin** (bắt buộc)
2. **Cài đặt in ấn** → Nhập IP máy in nhiệt
3. **Cài đặt thanh toán** → Cấu hình VietQR / payOS (nếu có)
4. **Thêm nhân viên** → Tạo tài khoản cho từng ca
5. **Cài đặt chi nhánh** → Kiểm tra tên, địa chỉ chi nhánh
6. **Cài đặt ca làm việc** → Bật/tắt yêu cầu mở ca

---

## 8. Mạng LAN — Kết Nối Nhiều Thiết Bị

Tất cả thiết bị (iPad, PC, máy in LAN) phải cùng subnet với máy chủ:

```
Máy chủ: 192.168.1.100
iPad 1:  192.168.1.10  → truy cập http://192.168.1.100/ipad
iPad 2:  192.168.1.11  → truy cập http://192.168.1.100/ipad
PC POS:  192.168.1.20  → truy cập http://192.168.1.100/pos
Bếp KDS: 192.168.1.30 → truy cập http://192.168.1.100/kds
```

**Máy in nhiệt LAN (ESC/POS):** Nhập IP máy in vào Admin → Cài đặt → In ấn → Máy in.

---

## 9. Xử Lý Sự Cố Thường Gặp

### ❌ Container `app` không khởi động được
```bash
docker compose logs app
# Thường do: thiếu .env, sai DATABASE_URL, hoặc port 3000 bị chiếm
```

### ❌ Không truy cập được từ iPad/PC khác
- Kiểm tra firewall máy chủ: `ufw status` (Ubuntu) — mở port 80
- Kiểm tra IP trong `.env` đúng với IP tĩnh của máy chủ
- Thử ping từ iPad đến máy chủ

### ❌ Database bị lock / WAL quá lớn
```bash
# Vào container và chạy checkpoint:
docker compose exec app node -e "
import('./server/db.js').then(({db}) => {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  console.log('Checkpoint OK');
});"
```

### ❌ Máy in không in được
- Kiểm tra IP máy in trong Admin → Cài đặt → In ấn
- Ping từ máy chủ đến IP máy in: `docker compose exec app ping -c 3 <ip-may-in>`
- Kiểm tra máy in bật và kết nối cùng mạng LAN

---

## 10. Thông Tin Liên Hệ

Khi cần hỗ trợ kỹ thuật:
- Gửi kèm: output của `docker compose logs app` (50 dòng cuối)
- Gửi kèm: kết quả `curl http://localhost/health`
- Gửi kèm: nội dung file `.env` (ẩn mật khẩu)
