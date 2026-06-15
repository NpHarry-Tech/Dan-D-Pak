# POS/ERP Module Roadmap

Mục tiêu của tài liệu này là biến hệ thống hiện tại thành ERP dạng module. Odoo được dùng như nguồn tham khảo về cách tổ chức ứng dụng, phân hệ, quyền truy cập, dependency và developer/studio workflow. Không sao chép mã nguồn, giao diện hay nội dung thương mại của Odoo.

## Nguyên tắc kiến trúc

1. Mỗi module có `key`, `label`, `group`, `perm`, `depends`, `status`, `href`.
2. Module chỉ hiển thị khi user có permission tương ứng.
3. Gõ URL trực tiếp vẫn phải bị chặn ở frontend bằng `requireModuleAccess()` và ở backend bằng permission guard cho API ghi/sửa/xóa.
4. Dữ liệu nền vẫn sync realtime/cloud bình thường; người không có quyền chỉ không thấy UI/module.
5. Module active có màn hình thật. Module planned được khai báo sẵn để quản trị thấy roadmap nhưng chưa mở thao tác.
6. Permission theo vai trò là mặc định; permission theo user là quyền hiệu lực cuối cùng.

## Nhóm module

### Tính năng thiết yếu

- Liên hệ
- Import/export dữ liệu
- Search, filter, group
- Activity/audit
- Reporting dashboard
- Rich text/editor và attachment

### Bán hàng

- CRM
- Báo giá và đơn bán
- POS FnB
- Retail POS
- Self-order iPad
- KDS
- Online channels
- Subscription
- Rental/membership
- eCommerce

### Chuỗi cung ứng

- Inventory
- Warehouse/location
- Lot/serial/expiry
- Purchase
- Barcode
- Manufacturing/MRP
- Shipping/delivery
- Replenishment
- Stock valuation

### Tài chính

- Accounting
- Invoicing/e-invoice
- Vendor bills
- Expenses
- Payment providers
- Bank/cash reconciliation
- Tax/localization
- Financial reports

### Năng suất

- Project/task
- Calendar/appointment
- Discuss/chatter
- Documents
- Knowledge
- Todo
- Spreadsheet/dashboard

### Studio

- Dynamic model metadata
- Dynamic fields/widgets
- List/form/kanban/calendar/pivot views
- Automation rules
- Approval rules
- PDF report builder
- Export/import customization bundle

### Cài đặt & nền tảng

- Apps/modules dashboard
- Users and per-user permissions
- Role permission matrix
- Company/branch/multi-company
- Email/IoT/cloud sync/settings
- Print/bill/label settings

### Developer & database

- Debug mode
- Technical model registry
- API explorer
- Backup/restore/duplicate database
- Migration/upgrade checklist
- Tutorials and internal docs

## Source code layout target

```text
server/
  api.js                         # HTTP routing only
  db.js                          # schema and migrations
  services/
    modules.js                   # module registry and dependencies
    auth.js                      # auth, role perms, user perms
    catalog.js                   # FnB menu/domain
    inventory.js                 # stock, warehouse, lots
    retail.js                    # retail checkout/refund
    orders.js                    # FnB orders/tables/KDS
    payments.js                  # payment and receipt
    invoices.js                  # e-invoice
    printing.js                  # print jobs
    sync.js                      # cloud/offline sync queue
    reports.js                   # dashboards/audit
web/
  shared/
    modules.js                   # client module catalog for navigation
    client.js                    # auth, api, topbar, guards
    app.css                      # design system
  *.html                         # module screens
docs/
  ERP_MODULE_ROADMAP.md          # this file
```

## Implementation phases

### Phase 1 - Module shell

- Module registry backend.
- Module catalog frontend.
- Permission-gated topbar and launcher.
- Module tab in Settings.
- Per-user permission matrix.

### Phase 2 - Core ERP data model

- Contacts and partner addresses.
- Product master shared by FnB, retail, purchase, inventory.
- Generic document model for RFQ/PO/SO/invoice/stock document.
- Activity/chatter layer.

### Phase 3 - Sales and supply chain

- CRM pipeline.
- Sales quotation/order.
- Purchase RFQ/PO.
- Reordering rules.
- Delivery/picking operations.
- Barcode workflow.

### Phase 4 - Finance

- Chart of accounts.
- Journals and journal entries.
- Tax/fiscal position.
- Vendor bill and customer invoice flow.
- Payment reconciliation.

### Phase 5 - Studio/developer/database

- Metadata tables for custom models/fields/views.
- Dynamic CRUD renderer.
- Automation engine.
- Backup/restore/duplicate DB.
- Developer debug menu and API explorer.

