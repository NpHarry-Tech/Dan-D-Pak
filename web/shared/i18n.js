// Centralized lightweight i18n module for all web screens.
// Keep UI strings in one place and translate dynamic DOM updates after render.

export const LANG_KEY = 'preferred_lang';
export const SUPPORTED_LANGS = ['vi', 'en'];

export const normalizeLang = (lang) => lang === 'en' ? 'en' : 'vi';
export const getLang = () => normalizeLang(localStorage.getItem(LANG_KEY) || 'vi');
export const setLocalLang = (lang) => {
  const clean = normalizeLang(lang);
  localStorage.setItem(LANG_KEY, clean);
  if (typeof document !== 'undefined') document.documentElement.lang = clean;
  return clean;
};

const BASE_TRANSLATIONS = {
  // Navigation
  "Quản lý": "Admin Dashboard",
  "Thu ngân": "POS Cashier",
  "Self-Order": "iPad Self-Order",
  "Nhà bếp": "Kitchen KDS",
  "Thủ kho": "Warehouse",
  "Bảng điều khiển": "Dashboard",
  "Cài đặt": "Settings",

  // Login Page
  "Đăng nhập nhân viên": "Staff Login",
  "← Chọn lại": "← Change User",
  "Đăng nhập hệ thống": "System Login",
  "Mã PIN demo — Chủ quán:1234 · Quản lý:2222 · Thu ngân:1111 · Bếp:3333 · Kho:4444": "Demo PIN - Owner:1234 · Manager:2222 · Cashier:1111 · Kitchen:3333 · Warehouse:4444",

  // POS Cashier Screen
  "bàn mở": "open tables",
  "Món khách vừa gọi": "Customer Call / Cart",
  "Khách không xuất hóa đơn": "No invoice customer",
  "Chọn khách": "Select Customer",
  "Thêm món FnB": "Add F&B Item",
  "Thêm retail": "Add Retail SKU",
  "Chuyển bàn": "Move Table",
  "Gộp bàn": "Merge Tables",
  "Tách bill / thanh toán riêng": "Split Bill / Pay Separately",
  "Tạm tính:": "Subtotal:",
  "Tạm tính": "Subtotal",
  "Giảm giá:": "Discount:",
  "Giảm giá": "Discount",
  "Tổng cộng:": "Total:",
  "Tổng cộng": "Total",
  "In tạm tính": "Print Receipt",
  "Thanh toán": "Checkout",
  "Gửi món vô bếp": "Send to Kitchen",
  "Mở / kết ca": "Open/Close Shift",
  "Nhập lý do hủy món:": "Reason for cancellation:",
  "Nhân viên hủy": "Cancelled by staff",
  "Nhân viên xóa nháp": "Draft deleted by staff",
  "Bàn chưa có order.": "No orders on this table.",
  "Khách order từ iPad sẽ hiện ở đây.": "Customer orders from iPad will show here.",
  "Chọn một bàn để xem bill": "Select a table to view bill",
  "Chờ bếp": "Kitchen cooking",
  "Chờ xác nhận": "Pending confirm",
  "Đang làm": "Preparing",
  "Sẵn sàng": "Ready",
  "Đã phục vụ": "Served",
  "Món đã hủy": "Cancelled",

  // Shift Modal
  "Mở ca làm việc": "Open Shift",
  "Kết ca làm việc": "Close Shift",
  "Nhân viên ca": "Shift Employee",
  "Mã PIN xác nhận": "Confirm PIN",
  "Tiền mặt ban đầu": "Opening Cash",
  "Tiền mặt thực tế trong két": "Actual Cash in Drawer",
  "Chênh lệch": "Cash Variance",
  "Đóng ca": "Close Shift",
  "Hủy bỏ": "Cancel",
  "Mở ca": "Open Shift",
  "Tiền mặt dự kiến": "Expected Cash",
  "Tổng thu": "Total Revenue",
  "Rút tiền két (nếu có)": "Cash Withdrawal (if any)",
  "Lý do rút tiền": "Withdrawal Reason",

  // Popups & Toast
  "Đã gửi món vào bếp!": "Sent items to kitchen!",
  "Đã xóa món nháp": "Draft item deleted",
  "Đã hủy món": "Item cancelled",
  "Vui lòng nhập lý do": "Please enter a reason",
  "Mã PIN không đúng": "Incorrect PIN code",
  "Chuyển bàn thành công!": "Table moved successfully!",
  "Gộp bàn thành công!": "Tables merged successfully!",
  "Xóa bàn thành công!": "Table deleted successfully!",
  "Thêm bàn thành công!": "Table added successfully!",
  "Thêm khu vực thành công!": "Zone added successfully!",

  // Admin Dashboard
  "Tổng quan hôm nay": "Today's Overview",
  "Doanh thu thuần": "Net Revenue",
  "Số đơn hàng": "Orders count",
  "Giá trị đơn trung bình": "Average Order Value",
  "Số khách hàng mới": "New Customers",
  "Biểu đồ doanh thu": "Revenue Chart",
  "Doanh số theo nguồn": "Sales by Channel",
  "Món ăn bán chạy": "Top Selling Items",
  "Sản phẩm bán lẻ chạy": "Top Selling Retail",
  "Cảnh báo hết hạn / tồn kho": "Expiry & Low Stock Alerts",
  "Nhật ký hoạt động hệ thống": "System Activity Log",
  "Xem chi tiết": "View Details",
  "Cấu hình": "Settings",

  // Settings Panel Tabs & Fields
  "Nhân viên": "Staff Members",
  "Phân quyền": "Default Roles Permissions",
  "Đồng bộ": "Cloud Sync",
  "Tích hợp": "Integrations",
  "Vận hành": "Operations Config",
  "Hóa đơn": "Receipt Template",
  "Hóa đơn điện tử": "e-Invoice MISA",
  "In ấn": "Printer Profiles",
  "Thiết bị": "Registered Devices",
  "Thực đơn FnB": "F&B Menu",
  "Menu quyển": "Dine-in Book Menu",
  "Cấu hình bàn & Sơ đồ": "Tables & Layout",
  "Máy in": "Hard Printers",
  "Lịch sử hoạt động": "Audit Log",
  "Thêm nhân viên": "Add Staff",
  "Sửa nhân viên": "Edit Staff",
  "Tên hiển thị": "Display Name",
  "Tên đăng nhập": "Username",
  "Mã PIN (4 chữ số)": "PIN Code (4 digits)",
  "Vai trò / chức danh": "Role / Position",
  "Trạng thái": "Status",
  "Đang hoạt động": "Active",
  "Tắt tài khoản": "Deactivated",
  "Ngôn ngữ": "Language",
  "Tiếng Việt": "Vietnamese",
  "Tiếng Anh": "English",
  "Quyền riêng của nhân viên": "Custom permissions for employee",
  "Vai trò chỉ là chức danh và bộ quyền mặc định. Tick/untick ở đây để cấp quyền riêng cho đúng người này.": "Roles are only templates. Toggle checkboxes to grant specific permissions to this account.",
  "Chọn tất cả": "Select All",
  "Bỏ tất cả": "Clear All",
  "Lấy theo vai trò": "Reset to Role",
  "Chủ quán luôn toàn quyền.": "Owner has full access.",
  "Bỏ sửa": "Cancel",
  "Làm mới": "Reset",
  "Lưu": "Save",
  "Tạo nhân viên": "Create Staff",
  "Danh sách nhân viên": "Staff List",
  "Sửa": "Edit",
  "Xóa": "Delete",
  "Đóng": "Close",
  "Chưa có nhân viên": "No staff found",
  "Chủ quán": "Owner",
  "Quản lý": "Manager",
  "Bếp": "Kitchen",
  "Thủ kho": "Warehouse Keeper",

  // Table Configuration Tab
  "Khu vực": "Zones",
  "Thêm khu vực": "Add Zone",
  "Thêm bàn": "Add Table",
  "Tên khu vực": "Zone Name",
  "Mã bàn": "Table Code",
  "Số ghế": "Seats",
  "Lưu lại": "Save Layout",
  "Kéo thả bàn để đổi vị trí sơ đồ": "Drag & drop tables to change layout",
  "Tạo hàng loạt bàn": "Bulk Create Tables",
  "Tiền tố mã": "Code Prefix",
  "Từ số": "From No.",
  "Đến số": "To No.",
  "Số ghế mặc định": "Default Seats",
  "Tạo bàn": "Generate Tables",

  // Kitchen KDS
  "Nhà Bếp & Pha Chế": "Kitchen & Bar Display",
  "Chờ chế biến": "Pending",
  "Đang chế biến": "Cooking",
  "Đã xong": "Ready",
  "Xác nhận": "Confirm",

  // iPad Self-order
  "Thực đơn": "Menu",
  "Gọi phục vụ": "Call Staff",
  "Giỏ hàng": "Cart",
  "Lịch sử": "History",
  "Xem giỏ hàng": "View Cart",
  "Giỏ hàng trống": "Cart is Empty",
  "Thanh toán ngay": "Request Checkout",
  "Đã gửi yêu cầu gọi món!": "Order requested successfully!",
  "Đã gửi yêu cầu gọi phục vụ!": "Staff call request sent!",
  "Bàn đang trống": "Table is free",
  "Vui lòng chọn món ăn": "Please select some items",
  "Gọi món": "Confirm Order",
  "Thêm": "Add",
  "Tùy chọn": "Options",
  "Chú thích cho bếp": "Note for kitchen",
  "Tổng tiền": "Total Price",
  "Thành tiền": "Subtotal",
  "Số lượng": "Quantity",
  "Món ăn": "Item",
  "Lịch sử gọi món": "Order History",
  "Yêu cầu thanh toán": "Request Bill",
  "Hóa đơn tạm tính": "Receipt Preview",

  // Warehouse Screen
  "Quản lý kho hàng & Vật liệu": "Inventory & Warehouse Management",
  "Nhập kho": "Receive Goods",
  "Xuất kho": "Issue Goods",
  "Chuyển kho": "Transfer stock",
  "Kiểm kho": "Stocktake Session",
  "Xem tồn kho": "Inventory List",
  "Lịch sử thẻ kho": "Stock Cards",
  "Nguyên liệu kho": "Ingredients",
  "Mặt hàng bán lẻ": "Retail Products",
  "Supplier / Nhà cung cấp": "Supplier",
  "Mã vạch / Barcode": "Barcode",
  "Đơn vị tính": "Unit",
  "Tồn tối thiểu": "Min Stock",
  "Giá vốn": "Cost Price",
  "Giá bán": "Selling Price",
  "Tạo mặt hàng": "Create Item",

  // Customer profile
  "Khách hàng mới": "New Customer",
  "Sửa khách hàng": "Edit Customer",
  "Tên khách / công ty": "Customer / Company Name",
  "Số điện thoại": "Phone",
  "Ngày sinh": "Birthday",
  "Mã số thuế": "Tax Code",
  "Tên công ty": "Company Name",
  "Địa chỉ": "Address",
  "Sở thích": "Preferences",
  "Dị ứng": "Allergies",
  "Ưu đãi mặc định": "Default Perk",
  "Giá trị ưu đãi": "Perk Value",
  "Món / sản phẩm hay mua": "Frequent Items",
  "Ghi chú": "Notes",
  "Lưu khách hàng": "Save Customer",
  "Hay mua": "Usually buys",
  "Chưa đủ lịch sử mua để tự kết luận.": "Not enough purchase history to infer yet.",
};

const EXTRA_TRANSLATIONS = {
  // Common actions and states
  "Lưu thay đổi": "Save Changes",
  "Lưu lại": "Save",
  "Lưu": "Save",
  "Tạo mới": "Create New",
  "Tạo": "Create",
  "Cập nhật": "Update",
  "Xác nhận": "Confirm",
  "Xác nhận nhân viên": "Staff Confirmation",
  "Xác nhận đã hủy": "Confirm Cancelled",
  "Hủy": "Cancel",
  "Đóng": "Close",
  "Xong": "Done",
  "Quay lại": "Back",
  "Làm mới": "Refresh",
  "Tải lại": "Reload",
  "Tìm kiếm": "Search",
  "Tìm theo tên": "Search by name",
  "Chọn": "Select",
  "Bỏ chọn": "Deselect",
  "Chọn tất cả": "Select All",
  "Bỏ tất cả": "Clear All",
  "Không tìm thấy": "Not found",
  "Không có dữ liệu": "No data",
  "Chưa có dữ liệu": "No data yet",
  "Đang tải": "Loading",
  "Đang lưu": "Saving",
  "Đã lưu": "Saved",
  "Đã xóa": "Deleted",
  "Xóa": "Delete",
  "Sửa": "Edit",
  "Chỉnh sửa": "Edit",
  "Chi tiết": "Details",
  "Trạng thái": "Status",
  "Đang hoạt động": "Active",
  "Tắt tài khoản": "Deactivated",
  "Trống": "Available",
  "Đang dùng": "Occupied",
  "Đang gọi": "Calling",
  "Đang thanh toán": "Paying",
  "Sẵn sàng": "Ready",
  "Đã nhận": "Accepted",
  "Đang làm": "Preparing",
  "Đã giao": "Served",
  "Đã phục vụ": "Served",
  "Hoàn tất": "Completed",
  "Hoàn hàng": "Refund",
  "Đổi trả": "Return",
  "Tất cả": "All",
  "Tất cả kênh": "All channels",
  "Tại bàn": "Dine-in",
  "Bán lẻ": "Retail",
  "Mang đi": "Takeaway",
  "Tiền mặt": "Cash",
  "Thẻ": "Card",
  "Cà thẻ": "Card",
  "Chuyển khoản": "Bank Transfer",
  "Chuyển khoản/QR": "Bank Transfer/QR",
  "Quẹt thẻ": "Card Payment",
  "Thu ngân": "Cashier",
  "Quản lý": "Manager",
  "Chủ quán": "Owner",
  "Bếp": "Kitchen",
  "Thủ kho": "Warehouse Keeper",
  "Mật khẩu": "Password",
  "Ngôn ngữ": "Language",
  "Tiếng Việt": "Vietnamese",
  "Tiếng Anh": "English",
  "Không có quyền truy cập": "No Access",
  "Về màn hình ứng dụng": "Back to App Launcher",
  "Đăng xuất": "Logout",
  "Nhấp đúp để quay lại Launcher": "Double-click to return to Launcher",
  "Cơ sở: Dan D Pak Sala · Trực tiếp": "Location: Dan D Pak Sala · Live",

  // Launcher and navigation
  "Tính năng thiết yếu": "Essentials",
  "Bán hàng": "Sales",
  "Chuỗi cung ứng": "Supply Chain",
  "Tài chính": "Finance",
  "Năng suất": "Productivity",
  "Cài đặt & nền tảng": "Settings & Platform",
  "Kênh online": "Online Channels",
  "Tồn kho": "Inventory",
  "In ấn": "Printing",
  "Mở thiết bị →": "Open Device →",
  "Mở module →": "Open Module →",
  "Đang nằm trong roadmap": "On the roadmap",
  "Roadmap theo kiến trúc ERP": "ERP Architecture Roadmap",
  "Tài khoản này chưa được cấp module nào.": "This account has not been granted any modules.",
  "Đang tải ứng dụng...": "Loading apps...",
  "Khách tự chọn món, topping, ghi chú, gửi bếp, gọi nhân viên, yêu cầu thanh toán.": "Guests choose items, toppings, notes, send to kitchen, call staff, and request checkout.",
  "Sơ đồ bàn, mở bill, theo dõi món, discount, thanh toán nhiều phương thức, in receipt.": "Table map, open bills, track items, discounts, multi-method payments, and receipt printing.",
  "Quét mã vạch / chạm SKU, chọn lot/date trong giỏ, voucher và thanh toán retail.": "Scan barcodes or tap SKUs, choose lot/date in cart, apply vouchers, and checkout retail.",
  "Màn hình station nhận món realtime, food timing/SLA, Accept → Preparing → Ready.": "Station screen receives items in realtime with timing/SLA and Accept → Preparing → Ready flow.",
  "Nhập hàng, kiểm kho (chênh lệch), lịch sử xuất/nhập, cảnh báo tồn dưới mức tối thiểu.": "Receive goods, stocktake variance, stock history, and low-stock alerts.",
  "Nhận đơn GrabFood/ShopeeFood/Website qua webhook, điều phối fulfillment, simulator đẩy đơn thử.": "Receive GrabFood/ShopeeFood/Website orders via webhook, manage fulfillment, and simulate test orders.",
  "Máy in ảo bếp/bar/bill — tự in phiếu khi gửi món & receipt khi thanh toán, in lại.": "Virtual kitchen/bar/bill printers with auto ticket/receipt printing and reprint.",
  "Doanh thu realtime, biểu đồ, top món, tồn kho, thực đơn, hóa đơn MISA, cloud sync/offline.": "Realtime revenue, charts, top items, stock, menu, MISA invoices, and cloud/offline sync.",
  "Cảnh báo kho": "Stock Alerts",
  "Doanh thu ca hôm nay": "Today's Shift Revenue",
  "Bill trung bình": "Average Bill",
  "Đơn đang mở": "Open Orders",
  "Doanh thu theo giờ": "Hourly Revenue",
  "Phương thức thanh toán": "Payment Methods",
  "Doanh thu theo kênh": "Revenue by Channel",
  "Top món bán chạy hôm nay": "Top Selling Items Today",
  "Tải các station": "Station Load",
  "Món": "Item",
  "SL": "Qty",
  "Doanh thu": "Revenue",
  "Chưa bán món nào": "No items sold yet",
  "Chưa có ca được mở hôm nay, tạm tính theo ngày lịch từ": "No shift has been opened today; estimating by calendar day from",
  "Doanh thu được tính từ lúc": "Revenue is calculated from",
  "mở ca đầu ngày": "the first shift opening of the day",
  "hiện tại": "now",
  "đến": "to",
  "Mẹo: mở các tab cạnh nhau → order ở iPad sẽ hiện ngay ở KDS, POS và Quản lý nhờ WebSocket.": "Tip: open tabs side by side → iPad orders appear instantly in KDS, POS, and Admin via WebSocket.",
  "Muốn xem trong khung iPad mô phỏng? Mở": "Want to view inside the iPad simulator? Open",
  "Trang nhân viên (POS/Retail/Kho/Quản lý/Online) yêu cầu đăng nhập PIN": "Staff screens (POS/Retail/Warehouse/Admin/Online) require PIN login",

  // POS / order flow
  "Sơ đồ bàn": "Table Map",
  "Món khách vừa gọi": "Customer Order",
  "Chọn một bàn để xem bill": "Select a table to view the bill",
  "Bàn chưa có order.": "This table has no order.",
  "Khách order từ iPad sẽ hiện ở đây.": "Guest orders from iPad will appear here.",
  "Khách không xuất hóa đơn": "No invoice customer",
  "Đổi khách": "Change Customer",
  "Chọn khách": "Select Customer",
  "Chọn khuyến mãi": "Select Promotion",
  "Thêm món FnB": "Add F&B Item",
  "Thêm retail": "Add Retail",
  "Chuyển bàn": "Move Table",
  "Gộp bàn": "Merge Tables",
  "Tách bill / thanh toán riêng": "Split Bill / Separate Payment",
  "Gửi món vô bếp": "Send to Kitchen",
  "In tạm tính": "Print Preview",
  "Thanh toán": "Checkout",
  "Tạm tính": "Subtotal",
  "Giảm giá": "Discount",
  "Tổng cộng": "Grand Total",
  "Tiền thối": "Change",
  "Thành tiền": "Amount",
  "Số lượng": "Quantity",
  "Mặt hàng": "Item",
  "Món ăn": "Food Item",
  "Món đã hủy": "Cancelled Item",
  "MÓN ĐÃ HỦY": "CANCELLED ITEM",
  "Sửa món": "Edit Item",
  "Thêm món mới": "Add New Item",
  "Tạo món": "Create Item",
  "Đã lưu món": "Item saved",
  "Đã tạo món mới": "New item created",
  "Đã lưu trữ món (đã có order)": "Item archived (has existing orders)",
  "Đã bật món": "Item enabled",
  "Đã tắt món": "Item disabled",
  "Ẩn": "Hidden",
  "Hiện": "Show",
  "Ngoài lịch": "Out of schedule",
  "Bật/tắt tạm thời": "Temporarily enable/disable",
  "Ảnh món": "Item Image",
  "Tên món": "Item Name",
  "Giá": "Price",
  "SLA phút": "SLA Minutes",
  "Nhóm": "Category",
  "Mô tả món": "Item Description",
  "Nguyên liệu hiển thị cho khách": "Guest-facing Ingredients",
  "Allergen / dị ứng": "Allergens",
  "Ngày bán riêng": "Specific Sale Date",
  "Dán URL ảnh:": "Paste image URL:",
  "Ăn kèm": "Side Item",
  "giá": "price",
  "Nhập lý do hủy món:": "Enter cancellation reason:",
  "Nhân viên hủy": "Cancelled by staff",
  "Nhân viên xóa nháp": "Draft deleted by staff",
  "Đã gửi món vào bếp!": "Sent to kitchen!",
  "Đã xóa món nháp": "Draft item deleted",
  "Đã hủy món": "Item cancelled",
  "Chưa có bill để thanh toán": "No bill to checkout",
  "Chưa thanh toán": "Unpaid",
  "Đã thanh toán": "Paid",
  "ĐÃ HỦY / HOÀN": "VOID / REFUNDED",
  "Đã hoàn": "Refunded",
  "Lịch sử bán hàng": "Sales History",
  "Tìm mã đơn / bàn / mã HĐ…": "Search order / table / invoice...",
  "Chọn một đơn để xem chi tiết": "Select an order to view details",
  "Không có đơn nào.": "No orders found.",
  "In lại hóa đơn": "Reprint Invoice",
  "Tra cứu HĐĐT": "Lookup E-Invoice",
  "Đổi trả / Hoàn hàng": "Return / Refund",
  "Lý do đổi trả / hoàn hàng": "Return / refund reason",
  "Khách trả hàng": "Customer returned goods",
  "Xác nhận hoàn": "Confirm Refund",
  "Đang hoàn…": "Refunding...",
  "Lịch sử / Đổi trả": "History / Returns",
  "Xem lại đơn cũ, in lại hóa đơn": "Review old orders and reprint invoices",

  // iPad self-order
  "Đang tải iPad…": "Loading iPad...",
  "Lỗi iPad:": "iPad Error:",
  "Bàn đã thanh toán xong. Cảm ơn quý khách!": "Table has been paid. Thank you!",
  "Bàn": "Table",
  "Tự chọn món · chờ nhân viên xác nhận": "Self-order · waiting for staff confirmation",
  "Gọi nhân viên": "Call Staff",
  "Yêu cầu thanh toán": "Request Checkout",
  "Chưa có món trong nhóm này": "No items in this group",
  "Giỏ hàng": "Cart",
  "Chạm vào món để thêm": "Tap an item to add",
  "Gửi yêu cầu →": "Send Request →",
  "Vuốt để lật menu": "Swipe to flip the menu",
  "Vuốt trái/phải để lật trang": "Swipe left/right to flip pages",
  "món trong giỏ": "items in cart",
  "Hết món": "Sold Out",
  "Chọn Món": "Choose Item",
  "Chọn món": "Choose Item",
  "Nguyên liệu:": "Ingredients:",
  "Chạm để xem chi tiết và tùy chọn món.": "Tap to view details and options.",
  "Chờ nhân viên xác nhận": "Waiting for staff confirmation",
  "Bếp đang chuẩn bị món của bạn": "The kitchen is preparing your order",
  "Món đã sẵn sàng — mời quý khách dùng bữa": "Your items are ready. Please enjoy.",
  "Đơn của bàn": "Table Order",
  "Tổng đã gọi": "Ordered Total",
  "Chờ xác nhận": "Pending Confirmation",
  "Chờ bếp": "Waiting for Kitchen",
  "Đã phục vụ": "Served",
  "Chọn bàn": "Select Table",
  "Thiết bị này sẽ gắn cố định với bàn đã chọn": "This device will be assigned to the selected table",
  "Đang tải bàn…": "Loading tables...",
  "Nhập mật khẩu thiết bị để quay lại màn hình chọn bàn.": "Enter the device password to return to table selection.",
  "Mở chọn bàn": "Open Table Selection",
  "Nguyên liệu": "Ingredients",
  "Dị ứng / allergen": "Allergies / allergens",
  "Ghi chú món": "Item Note",
  "VD: ít cay, không hành, tách sốt…": "Ex: less spicy, no onion, sauce separate...",
  "Tạm hết": "Sold Out",
  "chọn nhiều": "multi-select",
  "Tặng kèm": "Included",
  "Mua thêm": "Add-on",
  "Món ăn kèm": "Side Items",
  "Đã thêm": "Added",
  "Đã gửi yêu cầu! Nhân viên sẽ xác nhận lại với bàn": "Request sent! Staff will confirm with table",
  "Gọi món thêm": "Order more",
  "Thêm nước/đá": "Add water/ice",
  "Hỗ trợ": "Assistance",
  "Lý do gọi nhân viên:": "Reason for calling staff:",
  "Đã gọi nhân viên": "Staff called",
  "Thanh toán bàn": "Checkout Table",
  "Tổng cần thanh toán:": "Amount due:",
  "QR tự thanh toán": "Self-payment QR",
  "Tự in hóa đơn sau khi xác nhận": "Invoice prints automatically after confirmation",
  "Gọi thu ngân ra bàn": "Call cashier to table",
  "Gọi nhân viên cầm máy POS": "Call staff with POS terminal",
  "Chưa cấu hình ngân hàng trong Setting": "Bank settings are not configured",
  "Nội dung chuyển khoản": "Transfer Reference",
  "Thanh toán tiền mặt": "Cash Payment",
  "Thanh toán bằng thẻ": "Card Payment",
  "Hệ thống sẽ báo thu ngân tới bàn": "The system will notify the cashier to come to table",
  "để nhận tiền hoặc cà thẻ.": "to collect cash or process the card.",
  "Tôi đã chuyển khoản": "I have transferred",
  "Gọi thu ngân": "Call Cashier",
  "Đã thanh toán QR. Nhân viên sẽ đưa hóa đơn cho quý khách.": "QR payment completed. Staff will bring your invoice.",
  "Đã báo thu ngân tới thanh toán": "Cashier has been notified for payment",
  "Món này đã hết. Vui lòng chọn món khác hoặc bấm nút gọi nhân viên để được hỗ trợ.": "This item is sold out. Please choose another item or call staff for help.",

  // KDS
  "Salad/Lạnh": "Salad/Cold",
  "trễ": "late",
  "Không có món nào đang chờ": "No items are waiting",
  "ở station này": "at this station",
  "Order mới sẽ hiện ở đây realtime": "New orders will appear here in realtime",
  "Nhận món": "Accept",
  "Bắt đầu làm": "Start Preparing",
  "Xong ✓": "Done ✓",

  // Online channels
  "Nhận đơn online": "Online Orders",
  "Nhận đơn": "Receive Order",
  "Giả lập kênh online": "Online Channel Simulator",
  "Tên khách (tuỳ chọn)": "Customer name (optional)",
  "Khách không cần dụng cụ ăn uống nhựa": "Customer does not need plastic cutlery",
  "Thêm món để tạo đơn": "Add items to create an order",
  "Gửi đơn online": "Send Online Order",
  "Chưa có đơn online": "No online orders yet",
  "Chưa có đơn online. Dùng Simulator bên phải để tạo thử.": "No online orders yet. Use the simulator on the right to create a test order.",
  "Dùng Simulator bên phải để tạo thử.": "Use the simulator on the right to create a test order.",
  "Đã copy mã đơn": "Order code copied",
  "Chọn một đơn online để xem chi tiết": "Select an online order to view details",
  "Đơn hàng được làm xong đúng giờ": "Order was completed on time",
  "Tiếp tục phát huy bạn nhé!": "Keep up the good work!",
  "Mã đặt hàng": "Order Code",
  "Khách hàng mới": "New Customer",
  "Không cần dụng cụ ăn uống nhựa": "No plastic cutlery needed",
  "Combo ăn kèm": "Side Combo",
  "Tổng (tạm tính)": "Total (estimated)",
  "Bao gồm thuế GTGT theo cấu hình": "Includes VAT according to settings",
  "Báo cáo sự cố": "Incident Report",
  "Voucher / khuyến mãi": "Voucher / promotion",
  "Khuyến mãi": "Promotion",
  "Miễn phí 100%": "100% free",
  "Chưa bật kênh online nào trong Setting.": "No online channel is enabled in Settings.",
  "Đã đẩy đơn online vào hệ thống": "Online order pushed into the system",
  "Chưa có kênh online được kết nối trong Setting": "No online channel is connected in Settings",

  // Printing and invoices
  "Máy in ảo": "Virtual Printer",
  "phiếu bếp/bar tự in khi gửi món & receipt khi thanh toán": "kitchen/bar tickets auto-print when items are sent and receipts print at checkout",
  "tự in phiếu khi gửi món & receipt khi thanh toán": "auto ticket printing when items are sent and receipt printing at checkout",
  "Tự động in": "Auto-print",
  "Máy in Bếp": "Kitchen Printer",
  "Máy in Bar": "Bar Printer",
  "Máy in Bill": "Bill Printer",
  "Máy in Tem": "Label Printer",
  "Phiếu chạy món": "Runner Ticket",
  "Chưa có phiếu": "No tickets yet",
  "Chưa có tem": "No labels yet",
  "In lại": "Reprint",
  "Đã in lại": "Reprinted",
  "HÓA ĐƠN": "INVOICE",
  "PHIẾU TẠM TÍNH": "PREVIEW BILL",
  "TỔNG": "TOTAL",
  "TỔNG THANH TOÁN": "TOTAL PAYMENT",
  "Cảm ơn quý khách": "Thank you",
  "Cảm ơn quý khách!": "Thank you!",
  "CHẠY MÓN · BÀN": "RUNNER · TABLE",
  "CHẠY MÓN": "RUNNER",
  "phần": "part",
  "Quét QR tra cứu hóa đơn": "Scan QR to look up invoice",
  "HÓA ĐƠN BÁN HÀNG": "SALES INVOICE",
  "Khởi tạo từ máy tính tiền": "Created from cash register",
  "Ký hiệu HĐ": "Invoice Series",
  "Số HĐ (Thuế)": "Tax Invoice No.",
  "Số Bill (Nội bộ)": "Internal Bill No.",
  "Ngày lập": "Created Date",
  "Giờ lập": "Created Time",
  "Quầy / Bàn": "Counter / Table",
  "MST khách": "Customer Tax ID",
  "Cộng tiền hàng": "Goods Total",
  "Thuế GTGT": "VAT",
  "Bằng chữ": "In words",
  "Hình thức TT": "Payment Method",
  "MÃ CỦA CƠ QUAN THUẾ": "TAX AUTHORITY CODE",
  "Tra cứu tại": "Lookup at",
  "HÓA ĐƠN ĐIỆN TỬ KHỞI TẠO TỪ MÁY TÍNH TIỀN": "E-INVOICE CREATED FROM CASH REGISTER",
  "CẢM ƠN QUÝ KHÁCH": "THANK YOU",
  "HẸN GẶP LẠI TẠI BCM": "SEE YOU AGAIN AT BCM",
  "Trình duyệt chặn cửa sổ in": "Browser blocked the print window",

  // Admin settings and print designer
  "Settings quản lý": "Admin Settings",
  "Staff Members, phân quyền, đồng bộ, hóa đơn và cấu hình in được gom ở đây.": "Staff members, permissions, sync, invoices, and printing settings are managed here.",
  "Nhân sự & Default Roles Permissions": "Staff & Default Role Permissions",
  "Liên kết": "Links",
  "Kết nối": "Connections",
  "Checkout & ca": "Checkout & Shifts",
  "Settings HĐĐT": "E-Invoice Settings",
  "Registered Devices khách": "Registered Guest Devices",
  "Danh mục in": "Print Catalog",
  "Quyển đang chỉnh": "Editing Book",
  "Tên quyển": "Book Name",
  "Save menu quyển": "Save Book Menu",
  "Tạo quyển mới": "Create New Book",
  "Delete quyển": "Delete Book",
  "Import từ PubHTML5": "Import from PubHTML5",
  "Import và dùng quyển này": "Import and Use This Book",
  "Add trang bằng URL ảnh": "Add Page by Image URL",
  "Add trang": "Add Page",
  "Chấm tương tác": "Interactive Hotspots",
  "Add nút": "Add Button",
  "Delete nút": "Delete Button",
  "Món được mở khi bấm nút": "Item Opened by Button",
  "Nhãn nội bộ": "Internal Label",
  "Màu nút Chọn Món": "Choose Item Button Color",
  "Góc": "Angle",
  "Mẫu trực quan": "Visual Template",
  "Thuộc tính": "Properties",
  "Chọn một phần tử": "Select an element",
  "Lưu mẫu in": "Save Print Template",
  "Khôi phục mẫu mặc định": "Restore Default Template",
  "Mẫu Bill": "Bill Template",
  "Tem nhãn": "Labels",
  "Khổ in": "Paper Size",
  "Công cụ": "Tools",
  "Bảng món": "Item Table",
  "Ảnh/logo": "Image/Logo",
  "Mã QR": "QR Code",
  "Logo lên đầu": "Logo to Top",
  "Biến dữ liệu": "Data Variables",
  "Kiểu ảnh / logo": "Image / Logo Style",
  "Xám mượt": "Smooth Gray",
  "Chấm điểm": "Dithered",
  "Đen trắng tương phản": "High-contrast B/W",
  "Màu gốc": "Original Color",
  "Đổi ảnh khác": "Change Image",
  "Ngưỡng đen/trắng": "B/W Threshold",
  "Độ tương phản": "Contrast",
  "Nhân đôi": "Duplicate",
  "Trái": "Left",
  "Giữa": "Center",
  "Phải": "Right",
  "Đang chỉnh": "Editing",
  "Đã lưu bản nháp": "Draft saved",
  "Chưa lưu được": "Could not save",
  "Đang đồng bộ cloud": "Cloud syncing",
  "Mất internet — lưu local": "No internet — saving locally",
  "Ngắt internet (giả lập)": "Disconnect internet (simulate)",
  "Khôi phục internet": "Restore internet",
  "Tất cả kết nối đang tắt.": "All connections are disabled.",
  "Các cấu hình đã được lưu.": "Settings have been saved.",

  // Tables and layout
  "Layout Sơ Đồ Bàn": "Table Map Layout",
  "Thêm bàn mới": "Add New Table",
  "Khu vực / Zone": "Area / Zone",
  "Nhập tên khu vực mới": "Enter new area name",
  "Mã số bàn": "Table Code",
  "Số lượng ghế": "Seats",
  "Tạo bàn hàng loạt": "Bulk Create Tables",
  "Mã bắt đầu (Tiền tố)": "Starting Code (Prefix)",
  "Bắt đầu từ số": "Start From Number",
  "Số lượng bàn": "Number of Tables",
  "Thêm số 0 phía trước": "Pad with leading zeros",
  "Tạo tự động": "Generate Automatically",
  "Chưa có bàn nào được cấu hình": "No tables have been configured",
  "Sửa thông tin bàn": "Edit Table Information",
  "Đã cập nhật bàn thành công": "Table updated successfully",
  "Đã thêm bàn thành công!": "Table added successfully!",
  "Đã thêm khu vực thành công!": "Area added successfully!",
  "Không có bàn phù hợp": "No matching tables",

  // Warehouse / retail
  "Kho": "Warehouse",
  "Kho bếp": "Kitchen Warehouse",
  "Kho bán lẻ": "Retail Warehouse",
  "Sản phẩm": "Products",
  "Sản phẩm bán lẻ": "Retail Products",
  "Nguyên liệu": "Ingredients",
  "Vật dụng": "Supplies",
  "Nhập hàng": "Receive Stock",
  "Xuất hàng": "Issue Stock",
  "Nhập kho": "Receive Stock",
  "Xuất kho": "Issue Stock",
  "Chuyển kho": "Transfer Stock",
  "Kiểm kho": "Stocktake",
  "Lịch sử thẻ kho": "Stock Cards",
  "Tồn tối thiểu": "Minimum Stock",
  "Còn": "Remaining",
  "Hết hàng": "Out of Stock",
  "Điều chỉnh": "Adjust",
  "Lô hàng": "Lot",
  "Ngày nhập": "Received Date",
  "Ngày sản xuất": "MFG Date",
  "Hạn sử dụng": "Expiry Date",
  "Nhà cung cấp": "Supplier",
  "Mã vạch": "Barcode",
  "Đơn vị": "Unit",
  "Giá vốn": "Cost Price",
  "Giá bán": "Selling Price",
  "Tạo mặt hàng": "Create Item",
  "Cập nhật sản phẩm bán lẻ": "Update Retail Product",
  "Xóa sản phẩm bán lẻ": "Delete Retail Product",
  "Nhập kho bán lẻ": "Receive Retail Stock",
  "Xuất kho bán lẻ": "Issue Retail Stock",
  "Tạo nguyên liệu / vật dụng kho": "Create Warehouse Ingredient / Supply",
  "Cập nhật mặt hàng kho": "Update Warehouse Item",
  "Xóa mặt hàng kho": "Delete Warehouse Item",
  "Nhập kho bếp": "Receive Kitchen Stock",
  "Xuất kho bếp": "Issue Kitchen Stock",
  "Chốt kiểm kho": "Approve Stocktake",
  "Nhập dữ liệu BCM": "Import BCM Data",

  // Customer profile
  "Khách": "Customer",
  "Khách hàng": "Customers",
  "Khách hàng mới": "New Customer",
  "Sửa khách hàng": "Edit Customer",
  "Tên khách / công ty": "Customer / Company Name",
  "Tên khách": "Customer Name",
  "Số điện thoại": "Phone",
  "Ngày sinh": "Birthday",
  "Mã số thuế": "Tax Code",
  "Tên công ty": "Company Name",
  "Địa chỉ": "Address",
  "Sở thích": "Preferences",
  "Dị ứng": "Allergies",
  "hải sản": "seafood",
  "đậu phộng": "peanuts",
  "đậu nành": "soy",
  "sữa": "milk",
  "trứng": "egg",
  "mè": "sesame",
  "Ưu đãi mặc định": "Default Perk",
  "Giá trị ưu đãi": "Perk Value",
  "Món / sản phẩm hay mua": "Frequent Items",
  "Hay mua": "Usually Buys",
  "Chưa đủ lịch sử mua để tự kết luận.": "Not enough purchase history to infer yet.",
  "Ghi chú": "Notes",
  "Ghi chú cho bếp": "Kitchen Note",
  "Lưu khách hàng": "Save Customer",

  // Shifts
  "Ca làm việc": "Shift",
  "Ca sáng": "Morning Shift",
  "Ca tối": "Evening Shift",
  "Mở / kết ca làm việc": "Open / Close Shift",
  "Báo cáo ca hiện tại": "Current Shift Report",
  "Tiền đầu ca": "Opening Cash",
  "Số bill": "Bills",
  "Tiền mặt thu": "Cash Collected",
  "Tổng doanh thu ca": "Shift Revenue",
  "Tiền mặt dự kiến trong két": "Expected Cash in Drawer",
  "Ca đang mở": "Shift Open",
  "Mở ca làm việc": "Open Shift",
  "Hôm nay": "Today",
  "mở lúc": "opened at",
  "Loại ca": "Shift Type",
  "Kiểm đếm tiền mặt": "Cash Count",
  "cuối ca": "closing",
  "đầu ca": "opening",
  "Tổng kiểm đếm": "Counted Total",
  "Kết ca": "Close Shift",
  "Mở ca": "Open Shift",
  "Đã mở ca": "Shift opened",
  "Kết ca hiện tại? Hệ thống sẽ chốt báo cáo ca.": "Close the current shift? The system will finalize the shift report.",
  "Đã kết ca · doanh thu": "Shift closed · revenue",

  // Validation and toasts
  "Vui lòng nhập": "Please enter",
  "Cần nhập": "Please enter",
  "Cần chọn": "Please select",
  "Vui lòng chọn món ăn": "Please select items",
  "Vui lòng nhập lý do": "Please enter a reason",
  "Mã PIN không đúng": "Incorrect PIN",
  "Sai tài khoản hoặc mã PIN": "Incorrect account or PIN",
  "Chưa có món": "No items yet",
  "Không có món": "No items",
  "Chưa có khách hàng": "No customers yet",
  "Chưa có trang": "No pages yet",
  "Chưa có nút": "No buttons yet",
  "Đã lưu menu quyển": "Book menu saved",
  "Đã import menu mới": "New menu imported",
  "Đang import menu": "Importing menu",
  "Đã lưu thông tin nhân viên": "Staff information saved"
};

export const TRANSLATIONS = Object.freeze({ ...BASE_TRANSLATIONS, ...EXTRA_TRANSLATIONS });

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
let sortedEntries = null;
let observer = null;
let isTranslating = false;

function entries() {
  if (!sortedEntries) {
    sortedEntries = Object.entries(TRANSLATIONS)
      .filter(([from, to]) => from && to && from !== to)
      .sort((a, b) => b[0].length - a[0].length);
  }
  return sortedEntries;
}

function applyPatterns(text) {
  return text
    .replace(/Customer vừa gửi (\d+) items?, đang chờ nhân viên xác nhận\.?/g, 'Customer sent $1 items and is waiting for staff confirmation.')
    .replace(/Customer vừa gửi (\d+) món, đang chờ nhân viên xác nhận\.?/g, 'Customer sent $1 items and is waiting for staff confirmation.')
    .replace(/Khách vừa gửi (\d+) món, đang chờ nhân viên xác nhận\.?/g, 'Customer sent $1 items and is waiting for staff confirmation.')
    .replace(/Staff Members đã xác nhận (\d+) items? và chuyển xuống bếp\/bar\.?/g, 'Staff confirmed $1 items and sent them to kitchen/bar.')
    .replace(/Staff Members đã xác nhận (\d+) món và chuyển xuống bếp\/bar\.?/g, 'Staff confirmed $1 items and sent them to kitchen/bar.')
    .replace(/Nhân viên đã xác nhận (\d+) món và chuyển xuống bếp\/bar\.?/g, 'Staff confirmed $1 items and sent them to kitchen/bar.')
    .replace(/Staff Members đã từ chối (\d+) items? khách gọi\.?/g, 'Staff rejected $1 customer-requested items.')
    .replace(/Staff Members đã từ chối (\d+) món khách gọi\.?/g, 'Staff rejected $1 customer-requested items.')
    .replace(/Nhân viên đã từ chối (\d+) món khách gọi\.?/g, 'Staff rejected $1 customer-requested items.')
    .replace(/Đã gửi (\d+) items? xuống bếp\/bar\.?/g, 'Sent $1 items to kitchen/bar.')
    .replace(/Đã gửi (\d+) món xuống bếp\/bar\.?/g, 'Sent $1 items to kitchen/bar.')
    .replace(/và\s+(\d+)\s+món khác(?![A-Za-zÀ-ỹ])/g, 'and $1 more items')
    .replace(/(\d+)\s+bàn mở/g, '$1 open tables')
    .replace(/(\d+)\s+bàn/g, '$1 tables')
    .replace(/(\d+)\s+món trong giỏ/g, '$1 items in cart')
    .replace(/(\d+)\s+món khác(?![A-Za-zÀ-ỹ])/g, '$1 more items')
    .replace(/(\d+)\s+món/g, '$1 items')
    .replace(/(\d+)\s+sản phẩm/g, '$1 products')
    .replace(/(\d+)\s+đơn/g, '$1 orders')
    .replace(/(\d+)\s+quyền/g, '$1 permissions')
    .replace(/(\d+)\s+ghế/g, '$1 seats')
    .replace(/(\d+)\s+kết quả/g, '$1 results')
    .replace(/(\d+)\s+phiếu/g, '$1 tickets')
    .replace(/(\d+)\s+tem/g, '$1 labels')
    .replace(/(\d+)\s+SP/g, '$1 SKUs')
    .replace(/Ca:\s*chưa mở/g, 'Shift: not open')
    .replace(/Ca:\s*/g, 'Shift: ')
    .replace(/SN\s+(\d{4}-\d{2}-\d{2})/g, 'Birthday $1')
    .replace(/Dị ứng:/g, 'Allergies:')
    .replace(/MST\s*khách/g, 'Customer Tax ID')
    .replace(/MST\s*:/g, 'Tax ID:')
    .replace(/ĐT\s*:/g, 'Phone:')
    .replace(/Bàn\s*:/g, 'Table:')
    .replace(/Tổng đã gọi\s*:/g, 'Ordered Total:')
    .replace(/(\d+) items khách gọi/g, '$1 customer-requested items')
    .replace(/\b1 customer-requested items\b/g, '1 customer-requested item')
    .replace(/\b1 open tables\b/g, '1 open table')
    .replace(/\b1 tables\b/g, '1 table')
    .replace(/\b1 items\b/g, '1 item')
    .replace(/\b1 products\b/g, '1 product')
    .replace(/\b1 orders\b/g, '1 order')
    .replace(/\b1 permissions\b/g, '1 permission')
    .replace(/\b1 seats\b/g, '1 seat')
    .replace(/\b1 results\b/g, '1 result')
    .replace(/\b1 tickets\b/g, '1 ticket')
    .replace(/\b1 labels\b/g, '1 label')
    .replace(/\b1 SKUs\b/g, '1 SKU')
    .replace(/(\d[\d.,]*)\s*đ/g, '$1 VND');
}

export function translateText(value) {
  if (getLang() !== 'en' || !value) return value;
  let out = String(value);
  for (const [from, to] of entries()) {
    if (out.includes(from)) out = out.replaceAll(from, to);
  }
  return applyPatterns(out);
}

export function t(key) {
  return getLang() === 'en' ? translateText(key) : key;
}

function shouldSkipElement(el) {
  return !el || SKIP_TAGS.has(el.tagName) || el.closest?.('[data-no-i18n]');
}

function translateElementAttrs(el) {
  for (const attr of ATTRS) {
    const val = el.getAttribute?.(attr);
    if (!val) continue;
    const next = translateText(val);
    if (next !== val) el.setAttribute(attr, next);
  }
}

function translateTextNode(node) {
  if (!node.nodeValue || shouldSkipElement(node.parentElement)) return;
  const next = translateText(node.nodeValue);
  if (next !== node.nodeValue) node.nodeValue = next;
}

export function applyDOMTranslations(root = document.body) {
  if (getLang() !== 'en' || !root || isTranslating) return;
  isTranslating = true;
  try {
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) {
      if (shouldSkipElement(root)) return;
      translateElementAttrs(root);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return shouldSkipElement(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
        return shouldSkipElement(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    let node = walker.currentNode;
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else if (node.nodeType === Node.ELEMENT_NODE) translateElementAttrs(node);
      node = walker.nextNode();
    }
  } finally {
    isTranslating = false;
  }
}

export function watchAndTranslate(root = document.body) {
  if (getLang() !== 'en' || typeof MutationObserver === 'undefined') return;
  applyDOMTranslations(root);
  if (observer) observer.disconnect();
  observer = new MutationObserver((mutations) => {
    if (isTranslating) return;
    observer.disconnect();
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') applyDOMTranslations(mutation.target);
      else mutation.addedNodes.forEach(node => applyDOMTranslations(node));
    }
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

export function initI18n() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = getLang();
  if (getLang() !== 'en') return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => watchAndTranslate(document), { once: true });
  else watchAndTranslate(document);
}
