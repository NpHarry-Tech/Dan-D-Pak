# UI/UX Source Map

Last updated: 2026-07-13

The active UI source is Flutter native.

## App Shells

- Desktop: `flutter-apps/dandpak_desktop/lib/`
- Tablet: `flutter-apps/dandpak_tablet/lib/`
- Phone: `flutter-apps/dandpak_phone/lib/`
- Shared app client package: `flutter-apps/dandpak_core/lib/`

## Main UI Areas

- POS: `lib/screens/pos_screen.dart`, `lib/screens/retail/`
- Warehouse: `lib/screens/warehouse/warehouse_screen.dart`, `warehouse_filters.dart`, `warehouse_stock_table.dart`, `stock_move_dialog.dart`
- Tax/customer lookup: `lib/widgets/tax_lookup.dart`
- Self-order: `lib/screens/self_order/`
- Management/settings/reports: `lib/screens/management/`
- Shared widgets: `lib/widgets/`
- Assets: `assets/brand/`, `assets/fonts/`, `assets/data/`

Keep UI logic in screen/widget files and keep backend contracts in `lib/services/api/` parts when an API group grows.