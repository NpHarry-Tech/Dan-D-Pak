# Deployment

Last updated: 2026-07-13

Deploy the Node/Express backend as the private company server and build Flutter native app shells separately.

## Backend

- Source: `server/`
- Entry: `server/index.js`
- API: `/api/*`
- Realtime: Socket.IO
- Runtime data: `server/permanent-storage/`, database file or configured database adapter

## Flutter Apps

- Desktop: `flutter-apps/dandpak_desktop`
- Tablet: `flutter-apps/dandpak_tablet`
- Phone: `flutter-apps/dandpak_phone`

Run `flutter pub get` inside the app being built, then build for the app's supported platforms.