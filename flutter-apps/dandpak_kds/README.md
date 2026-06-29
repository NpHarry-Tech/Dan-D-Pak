# Dan D Pak KDS

Native Flutter kitchen display app for the Dan D Pak backend.

## Backend Contract

- `POST /api/login`
- `GET /api/kds/all`
- `POST /api/orders/items/:id/status`
- Socket.IO auth: `{ token, device: 'kds', branch }`

## Run

```bat
cd flutter-apps\dandpak_kds
flutter pub get
flutter run -d windows
```

Enter the backend base URL, username, PIN, and branch ID. Production systems must
use real staff accounts with the `kds` permission.

## Build

```bat
flutter build windows --release
flutter build apk --release
```

## Notes

- This app keeps state minimal for low-memory POS/KDS machines.
- The login form does not ship with a default PIN.
- Session persistence can be added after the production account/device policy is
  finalized.
