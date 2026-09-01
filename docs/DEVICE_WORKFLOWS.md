# Device Workflows

Last updated: 2026-07-13

Device screens are native Flutter screens, not static HTML pages.

| Device area | Current app/source | Backend APIs |
| --- | --- | --- |
| Desktop POS/Admin/Warehouse/KDS | `flutter-apps/dandpak_desktop/lib/screens/` | `/api/*`, Socket.IO |
| Tablet self-order/POS | `flutter-apps/dandpak_tablet/lib/screens/` | `/api/menu`, `/api/tables`, `/api/orders`, `/api/device/ipad/*` |
| Phone companion | `flutter-apps/dandpak_phone/lib/screens/` | Same backend contract as tablet/desktop, phone-optimized UI |
| Shared API/realtime client | `flutter-apps/dandpak_core/lib/` and app `lib/services/` | HTTP + Socket.IO |

The historical `/device/ipad/*` API names are kept for compatibility, but the customer order UI is native Flutter.