# Dan D Pak POS

Native Flutter POS app for staff ordering, payment, table operations, shifts, and
printing workflows.

## Run

```bat
cd flutter-apps\dandpak_pos
flutter pub get
flutter run -d windows
```

## Build

```bat
flutter build windows --release
```

The release output is under:

```text
build\windows\x64\runner\Release\
```

## Backend

The app talks to the Dan D Pak Node backend through REST and Socket.IO. Shared
defaults/API/realtime code lives in `flutter-apps/dandpak_core`.

## Notes

- Login forms do not ship with a default PIN.
- In production, create real staff accounts and permissions before use.
- Hardware printing should use LAN, system, or hardware-agent routes.
