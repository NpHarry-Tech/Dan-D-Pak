# Protected Zones

Last updated: 2026-07-13

The protected client surface is now Flutter native app code.

## Client Zones

- `flutter-apps/dandpak_desktop/lib/screens/`: desktop POS, admin, warehouse, KDS, reports, settings.
- `flutter-apps/dandpak_tablet/lib/screens/`: tablet POS/self-order flows.
- `flutter-apps/dandpak_phone/lib/screens/`: phone companion flows.
- `flutter-apps/*/lib/services/`: API, realtime, local storage, hardware and OS integration.
- `flutter-apps/*/assets/brand/`: bundled logos/payment/channel images.

## Server Zones

- `server/modules/*/routes.js`: route ownership by domain.
- `server/services/*`: business rules and integration logic.
- `server/db.js` and `server/db/*`: schema, database helpers, backup helpers.
- `server/permanent-storage/`: runtime business data snapshots; keep gitignored.

Sensitive data must stay server-side. Flutter apps may cache session/config needed for operation, but they are not the source of truth.