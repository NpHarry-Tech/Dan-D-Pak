# ⚠️ dandpak_tablet đã NGỪNG phát triển (2026-07-07)

Bản tablet Android chính thức **KHÔNG còn là app riêng này nữa**. Theo yêu cầu:
tablet phải là **chính app desktop `dandpak_pos`** build cho Android (đầy đủ POS
FnB + Retail + Quản lý/Kho/… giống hệt desktop), chỉ **thêm màn iPad Self-order**
(WebView `/ipad`). Nhờ vậy mọi thiết bị chạy cùng một app, cùng nối server VPS
trung tâm → **realtime đồng bộ** qua Socket.IO.

➡️ Build tablet Android từ: **`flutter-apps/dandpak_pos`** (`flutter build apk --release`).
Màn tự gọi món: mở tile **"iPad Self-Order"** ở màn Launcher (chỉ hiện trên Android).

Thư mục này giữ lại để tham khảo, không dùng để build sản phẩm.
