# Dan D Pak Back Office

P3 native Flutter back-office shell for admin, reports, warehouse, contacts, purchase, expenses, invoices, and documents.

## Scope

- Token login with branch context.
- Read-only operational dashboards over the existing REST API.
- Module tabs: Dashboard, Reports, Inventory, Contacts, Purchase, Expenses, Invoices, Documents.
- Uses `x-auth-token` and `x-branch-id` on every authenticated request.
- Write actions are intentionally deferred until each module has PIN/permission UX.

## Run

```powershell
cd flutter-apps\dandpak_backoffice
flutter pub get
flutter run -d windows
```

Use the local server URL, for example `http://127.0.0.1:3000`.
