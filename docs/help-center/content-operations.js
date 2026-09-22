/* Operations, administration and troubleshooting guides. Loaded after content.js. */
(function () {
  'use strict';
  const data = window.HELP_CONTENT;
  if (!data) return;

  const L = (vi, en, zh) => ({ vi, en, zh });
  const p = (vi, en, zh) => ({ type: 'p', text: L(vi, en, zh) });
  const bullets = (vi, en, zh, checklist = false) => ({ type: 'bullets', items: L(vi, en, zh), checklist });
  const steps = (vi, en, zh) => ({ type: 'steps', items: L(vi, en, zh) });
  const callout = (kind, title, vi, en, zh) => ({ type: 'callout', kind, title, text: L(vi, en, zh) });
  const image = (file, vi, en, zh) => ({ type: 'image', file, caption: L(vi, en, zh) });
  const table = (headers, rows) => ({ type: 'table', headers, rows });
  const sec = (id, title, blocks) => ({ id, title, blocks });

  data.groups.push(
    { id: 'reports', icon: '▥', name: L('Báo cáo', 'Reports', '报表'), description: L('Doanh thu, kho, mua hàng, chi phí, công nợ, khách hàng và nhân viên.', 'Sales, inventory, purchasing, expenses, debt, customers and staff.', '销售、库存、采购、费用、往来、客户与员工报表。') },
    { id: 'management', icon: '⌂', name: L('Quản lý', 'Management', '管理'), description: L('Dashboard, thực đơn, nhân sự, chi nhánh, phân quyền và nhật ký.', 'Dashboard, menu, staff, branches, permissions and audit.', '仪表板、菜单、员工、门店、权限与审计。') },
    { id: 'invoices', icon: '▧', name: L('Hóa đơn', 'Invoices', '发票'), description: L('Tra cứu bill và quản lý toàn bộ vòng đời HĐĐT.', 'Find bills and manage the complete e-invoice lifecycle.', '查询账单并管理电子发票全生命周期。') },
    { id: 'accounting', icon: '₫', name: L('Kế toán', 'Accounting', '会计'), description: L('Thuế, tài khoản nhận tiền, ca, két và đối soát.', 'Tax, settlement accounts, shifts, cash drawer and reconciliation.', '税务、收款账户、班次、钱箱与对账。') },
    { id: 'settings', icon: '⚙', name: L('Cài đặt & thiết lập', 'Settings & setup', '设置与配置'), description: L('Thiết lập nền tảng, thiết bị, in ấn, kết nối và vận hành.', 'Configure the platform, devices, printing, integrations and operations.', '配置平台、设备、打印、集成与运营。') },
    { id: 'troubleshooting', icon: '!', name: L('Lỗi có thể gặp', 'Troubleshooting', '故障排除'), description: L('Chẩn đoán theo thiết bị, mã lỗi và quy trình khôi phục an toàn.', 'Diagnose by device, error code and safe recovery flow.', '按设备、错误码与安全恢复流程排查。') },
    { id: 'mobile', icon: '▯', name: L('Điện thoại — sắp ra mắt', 'Phone — coming soon', '手机端—即将推出'), description: L('Đã dành sẵn URL, cấu trúc và checklist ảnh cho bản điện thoại.', 'Reserved URLs, structure and screenshot checklist for the phone edition.', '已为手机端预留网址、结构与截图清单。') }
  );

  const reportRows = [
    ['sales_overview', L('Bán hàng', 'Sales', '销售'), L('Doanh thu, bill, mặt hàng, kênh và phương thức thanh toán.', 'Revenue, bills, items, channels and payment methods.', '营收、账单、商品、渠道与支付方式。')],
    ['sales_online', L('Bán hàng', 'Sales', '销售'), L('GrabFood, ShopeeFood, Website và trạng thái xử lý.', 'GrabFood, ShopeeFood, Website and fulfillment status.', 'GrabFood、ShopeeFood、网站及履约状态。')],
    ['purchase_orders', L('Mua hàng', 'Purchasing', '采购'), L('Đơn mua, đã nhận, đã trả và phải trả nhà cung cấp.', 'POs, received, returned and supplier payable.', '采购单、收货、退货及供应商应付。')],
    ['purchase_price_analysis', L('Mua hàng', 'Purchasing', '采购'), L('Biến động giá nhập, so sánh NCC và chi phí mua.', 'Purchase-price movement, supplier comparison and buying cost.', '进价波动、供应商比较与采购成本。')],
    ['expenses', L('Chi phí', 'Expenses', '费用'), L('Chi phí theo danh mục, nguồn tiền và kỳ.', 'Expenses by category, funding source and period.', '按类别、资金来源和期间统计费用。')],
    ['purchase', L('Kho', 'Inventory', '库存'), L('Phiếu nhập, NCC, lô, HSD và giá vốn.', 'Receipts, supplier, lot, expiry and cost.', '入库单、供应商、批次、效期与成本。')],
    ['issue', L('Kho', 'Inventory', '库存'), L('Xuất kho, bán hàng, recipe, chuyển kho và kiểm kho.', 'Issues, sales, recipes, transfers and stocktakes.', '出库、销售、配方、调拨与盘点。')],
    ['stock', L('Kho', 'Inventory', '库存'), L('Tồn hiện tại, định mức, giá trị và HSD.', 'On-hand, minimum level, value and expiry.', '现存、最低库存、库存价值与效期。')],
    ['low_stock', L('Kho', 'Inventory', '库存'), L('Hàng dưới định mức và gợi ý nhập.', 'Below-minimum items and replenishment suggestion.', '低于最低库存及补货建议。')],
    ['expiry_alert', L('Kho', 'Inventory', '库存'), L('Lô sắp hết hạn/đã hết hạn và giá trị rủi ro.', 'Expiring/expired lots and at-risk value.', '临期/过期批次与风险金额。')],
    ['stocktake', L('Kho', 'Inventory', '库存'), L('Phiên kiểm, chênh lệch và lý do điều chỉnh.', 'Counts, variances and adjustment reasons.', '盘点、差异与调整原因。')],
    ['cash_drawer', L('Tiền két', 'Cash drawer', '钱箱'), L('Thu, chi, hoàn chi và số dư theo ca/kỳ.', 'Cash in, out, reimbursement and balance by shift/period.', '按班次/期间统计收支、报销与余额。')],
    ['payables', L('Công nợ', 'Payables', '应付'), L('Ước tính phải trả theo phiếu nhập và NCC.', 'Estimated supplier payable from receipts.', '按入库单与供应商估算应付。')],
    ['receivables', L('Công nợ', 'Receivables', '应收'), L('Bill chưa thanh toán và thông tin khách.', 'Unpaid bills and customer details.', '未付款账单与客户信息。')],
    ['customers_status', L('Khách hàng', 'Customers', '客户'), L('Sinh nhật, sở thích, dị ứng, món hay mua và doanh số.', 'Birthday, preferences, allergies, favorites and sales.', '生日、偏好、过敏、常购商品与销售额。')],
    ['staff', L('Nhân viên', 'Staff', '员工'), L('Tài khoản, vai trò, ca và doanh thu theo ca.', 'Accounts, roles, shifts and shift revenue.', '账号、角色、班次与班次营收。')]
  ];

  const settingsRows = [
    [L('Nhân sự & Phân quyền', 'Staff & permissions', '员工与权限'), L('Tài khoản, vai trò, quyền theo nghiệp vụ.', 'Accounts, roles and task-level permissions.', '账号、角色与业务权限。'), L('Desktop, Tablet', 'Desktop, Tablet', '桌面端、平板端')],
    [L('Chi nhánh', 'Branches', '门店'), L('Chi nhánh, kho và phân vùng bán.', 'Branches, warehouses and sales regions.', '门店、仓库与销售区域。'), L('Desktop, Tablet, Mobile', 'Desktop, Tablet, Mobile', '桌面端、平板端、手机端')],
    [L('Cấu hình bàn', 'Table setup', '桌台设置'), L('Khu vực, bàn, sơ đồ và QR BYOD.', 'Zones, tables, floor plan and BYOD QR.', '区域、桌台、平面图与自带设备 (BYOD) 二维码。'), L('Desktop, Tablet, Mobile', 'Desktop, Tablet, Mobile', '桌面端、平板端、手机端')],
    [L('Thực đơn', 'Menu', '菜单'), L('Danh mục, món, recipe và lịch bán.', 'Categories, items, recipes and schedules.', '分类、菜品、配方与销售时段。'), L('Desktop, Tablet, Mobile', 'Desktop, Tablet, Mobile', '桌面端、平板端、手机端')],
    [L('Liên kết', 'Integrations', '集成'), L('MISA, ERP, thanh toán và sàn bán.', 'MISA, ERP, payment and marketplaces.', 'MISA、ERP、支付与平台。'), L('Desktop, Tablet, Mobile', 'Desktop, Tablet, Mobile', '桌面端、平板端、手机端')],
    [L('Cấu hình', 'Connections', '连接配置'), L('Thiết bị, máy in và cloud sync.', 'Devices, printers and cloud sync.', '设备、打印机与云同步。'), L('Desktop, Tablet', 'Desktop, Tablet', '桌面端、平板端')],
    [L('Kho & kênh bán', 'Warehouse & channels', '仓库与渠道'), L('Kho mặc định và liên kết kênh.', 'Default warehouses and channel mapping.', '默认仓库与渠道映射。'), L('Desktop, Tablet, Mobile', 'Desktop, Tablet, Mobile', '桌面端、平板端、手机端')],
    [L('Bill & Tem nhãn', 'Receipts & labels', '小票与标签'), L('Thiết kế mẫu in kéo-thả.', 'Drag-and-drop print template designer.', '拖放式打印模板设计。'), L('Desktop, Tablet', 'Desktop, Tablet', '桌面端、平板端')],
    [L('Thiết bị khách', 'Guest devices', '顾客设备'), L('Self-order và mật khẩu thiết bị.', 'Self-order devices and device password.', '自助点餐设备与设备密码。'), L('Desktop, Tablet, Mobile', 'Desktop, Tablet, Mobile', '桌面端、平板端、手机端')],
    [L('Hiển thị khách hàng', 'Customer display', '顾客显示'), L('Màn phụ desktop và banner BYOD.', 'Desktop second display and BYOD banner.', '桌面副屏与自带设备 (BYOD) 横幅。'), L('Desktop; banner: mọi thiết bị', 'Desktop; banner: all devices', '副屏：桌面端；横幅：所有设备')],
    [L('Tích điểm & Khuyến mại', 'Loyalty & promotions', '积分与促销'), L('Điểm, hạng, CTKM, voucher và lịch.', 'Points, tiers, promotions, vouchers and schedules.', '积分、等级、促销、优惠券与时段。'), L('Desktop, Tablet, Mobile', 'Desktop, Tablet, Mobile', '桌面端、平板端、手机端')],
    [L('Cấu hình thông báo', 'Notifications', '通知配置'), L('Âm thanh và định tuyến theo vai trò.', 'Sound and role-based routing.', '声音与按角色路由。'), L('Desktop, Tablet, Mobile', 'Desktop, Tablet, Mobile', '桌面端、平板端、手机端')]
  ];

  function errorFamily(codes, family, action) {
    return codes.map(code => [code, family, action]);
  }
  const codeRows = [
    ...errorFamily(['APP_ERROR', 'API_NOT_FOUND', 'DATA_CONFLICT', 'INTERNAL_ERROR', 'PERM_REQUIRED', 'MODULE_DISABLED'], L('Hệ thống & quyền', 'System & permission', '系统与权限'), L('Tải lại; kiểm tra quyền/module. INTERNAL_ERROR lặp lại thì gửi mã, thời điểm và ảnh cho kỹ thuật.', 'Reload and verify permission/module. For repeated INTERNAL_ERROR, send code, time and screenshot to support.', '刷新并检查权限/模块。INTERNAL_ERROR重复时将错误码、时间和截图发给技术支持。')),
    ...errorFamily(['APPROVAL_BAD_CONTEXT', 'APPROVAL_EXPIRED', 'APPROVAL_INVALID', 'APPROVAL_REPLAY', 'APPROVAL_SCOPE_MISMATCH', 'RETURN_APPROVAL_REQUIRED', 'TAKEOVER_APPROVAL_REQUIRED'], L('Phê duyệt/PIN', 'Approval/PIN', '审批/PIN'), L('Mở lại thao tác và xin PIN mới đúng người, đúng chi nhánh; không dùng lại lượt duyệt cũ.', 'Restart the action and request a fresh approval for the correct branch/user; never reuse an old approval.', '重新操作并为正确门店/用户获取新的审批；不要重复使用旧审批。')),
    ...errorFamily(['ORDER_NOT_FOUND', 'ORDER_ALREADY_PAID', 'ORDER_ALREADY_CHECKING_OUT', 'ORDER_FINALIZED', 'ORDER_VERSION_CONFLICT', 'CART_ALREADY_CHECKED_OUT', 'CART_VERSION_CONFLICT', 'EDIT_LEASE_LOST', 'PAID_NEEDS_REFUND'], L('Đơn/bill đa thiết bị', 'Multi-device order/bill', '多设备订单/账单'), L('Không thu lại. Tải trạng thái mới nhất; nếu đã thanh toán hãy dùng Trả hàng/Hoàn tiền.', 'Do not collect again. Reload latest state; use Return/Refund if already paid.', '不要重复收款。加载最新状态；已付款时使用退货/退款。')),
    ...errorFamily(['ALREADY_SETTLED', 'OFFLINE_PAYMENT_UNVERIFIABLE', 'PAYMENT_ACCOUNT_NOT_CONFIGURED', 'PAYMENT_INTENT_AMOUNT_CHANGED', 'PAYMENT_INTENT_FINALIZE_INCOMPLETE', 'PAYMENT_INTENT_NOT_ACTIVE', 'PAYMENT_INTENT_SCOPE_MISMATCH', 'PAYMENT_INTENT_TAKEOVER_REQUIRED', 'PAYMENT_REFERENCE_EXHAUSTED'], L('Thanh toán', 'Payment', '支付'), L('Đối chiếu giao dịch ngân hàng và bill trước; không tạo/thu thêm khi chưa xác định trạng thái.', 'Reconcile the bank transaction and bill first; do not create or collect another payment until status is known.', '先核对银行交易与账单；状态未确认前不要再次创建或收款。')),
    ...errorFamily(['BUYER_EQUALS_SELLER', 'CANCEL_PROVIDER_ERROR', 'EINVOICE_BLOCK', 'EMPTY_RESULT', 'INVALID_TEMPLATE_DATA', 'INVOICE_REPLACEMENT_REQUIRED', 'MISSING_EMAIL', 'MISSING_TEMPLATE_NO', 'MISSING_TRANSACTION_ID', 'PAYLOAD_ERROR', 'RETURNED_ORDER_INVOICE_HOLD', 'SHIFT_ALREADY_CLOSED', 'SPLIT_INVOICE_DISABLED', 'UNSUPPORTED_PROVIDER', 'WORKER_LEASE_EXPIRED', 'A01'], L('Hóa đơn điện tử/MISA', 'E-invoice/MISA', '电子发票/MISA'), L('Không xóa hoặc phát hành trùng. Kiểm tra người mua, mẫu số, trạng thái provider; lỗi sau phát hành chuyển kế toán xử lý thay thế/điều chỉnh.', 'Never delete or issue twice. Verify buyer, template and provider state; post-issue errors go to accounting for replacement/adjustment.', '不要删除或重复开票。检查购方、模板与服务商状态；开票后的错误由会计进行替换/调整。')),
    ...errorFamily(['BYOD_INVALID', 'CATALOGUE_SYNC_INVALID', 'EDGE_SYNC_BRANCH_FORBIDDEN', 'EDGE_SYNC_INVALID', 'OFFLINE_DECOMMISSIONED', 'STORE_OFFLINE', 'SYNC_TRANSPORT_NOT_CONFIGURED'], L('Tablet/BYOD/đồng bộ', 'Tablet/BYOD/sync', '平板/自带设备 (BYOD)/同步'), L('Kiểm tra đúng chi nhánh, QR còn hiệu lực và mạng tới server; online-only không dùng hàng đợi offline cũ.', 'Verify branch, active QR and server reachability; online-only mode must not use legacy offline queues.', '检查门店、有效二维码及服务器网络；仅在线模式不得使用旧离线队列。')),
    ...errorFamily(['HARAVAN_OWNER_REQUIRED', 'HARAVAN_WEBHOOK_SCOPE_MISSING', 'MARKETPLACE_REFRESH_IN_PROGRESS', 'ONLINE_ITEM_UNMAPPED', 'TIKTOK_NO_AUTHORIZED_SHOPS', 'TIKTOK_SHOP_DISCOVERY_FAILED'], L('Kênh bán/marketplace', 'Marketplace', '电商平台'), L('Kiểm tra quyền chủ shop, token/webhook, ánh xạ gian hàng–chi nhánh và liên kết SKU.', 'Verify shop-owner rights, token/webhook, shop-to-branch mapping and SKU mapping.', '检查店主权限、令牌/回调、店铺-门店映射与SKU关联。')),
    ...errorFamily(['IMAGE_SIGNATURE_MISMATCH', 'NO_TOKEN'], L('Tệp/xác thực', 'File/authentication', '文件/认证'), L('Không tải tiếp tệp sai định dạng; đăng nhập/kết nối lại để cấp token mới.', 'Reject mismatched files; sign in or reconnect to obtain a fresh token.', '拒绝格式不符的文件；重新登录或连接以获取新令牌。'))
  ];

  data.articles.push(
    {
      id: 'reports-center', group: 'reports', order: 1,
      paths: L('bao-cao/trung-tam-bao-cao', 'reports/report-center', 'reports/report-center'),
      title: L('Trung tâm báo cáo và 16 mẫu báo cáo', 'Report Center and all 16 reports', '报表中心与全部16种报表'),
      summary: L('Chọn kỳ, chi nhánh, xem trước và hiểu đúng phạm vi từng báo cáo.', 'Select period and branch, preview data and understand each report scope.', '选择期间与门店、预览数据并理解各报表范围。'), minutes: 12,
      sections: [
        sec('open', L('1. Mở và chọn phạm vi', '1. Open and choose scope', '1. 打开并选择范围'), [
          steps(['Vào **Quản lý → Báo cáo**.', 'Chọn nhóm và mẫu báo cáo; chỉ các báo cáo được phân quyền mới hiển thị.', 'Chọn Từ ngày–Đến ngày và một chi nhánh hoặc **Tất cả chi nhánh**.', 'Nhấn xem trước; đọc nhãn kỳ và chi nhánh phía trên kết quả trước khi dùng số liệu.'], ['Open **Management → Reports**.', 'Choose a group/report; only permitted reports appear.', 'Select From–To and one branch or **All branches**.', 'Preview and verify the period/branch label before using the figures.'], ['进入 **管理 → 报表**。', '选择分组与报表；仅显示有权限的报表。', '选择起止日期以及单个门店或 **全部门店**。', '预览后先核对结果上方的期间和门店标签。']),
          image('reports-01-center.png', 'Trung tâm báo cáo, bộ lọc kỳ và chi nhánh', 'Report Center with period and branch filters', '报表中心、期间与门店筛选')
        ]),
        sec('catalog', L('2. Danh mục báo cáo hiện có', '2. Available reports', '2. 可用报表'), [
          table(L(['Mã', 'Nhóm', 'Nội dung'], ['Key', 'Group', 'Contents'], ['代码', '分组', '内容']), reportRows)
        ]),
        sec('read', L('3. Cách đọc kết quả', '3. Read results correctly', '3. 正确阅读结果'), [
          bullets(['Ô tổng quan là chỉ số nhanh; bảng chi tiết là căn cứ kiểm tra từng dòng.', 'Khi chọn nhiều chi nhánh, xem bảng tổng hợp theo chi nhánh trước rồi mới cộng/so sánh.', 'Ngày nghiệp vụ dùng múi giờ Việt Nam; kỳ ngày chạy từ 00:00 đến 23:59:59 giờ Việt Nam.', 'Doanh thu bán hàng dựa trên bill đã thanh toán; bill mở/chưa thu nằm ở báo cáo phải thu, không cộng doanh thu.', 'Báo cáo kho phản ánh chứng từ đã hoàn tất; phiếu tạm chưa làm thay đổi tồn.'], ['Summary cards are quick indicators; detail tables are the audit basis.', 'For multiple branches, review the per-branch section before totals/comparisons.', 'Business dates use Vietnam time, 00:00–23:59:59.', 'Sales revenue uses paid bills; open/unpaid bills belong to receivables.', 'Inventory reports use completed documents; drafts do not change stock.'], ['汇总卡用于快速查看；明细表才是核查依据。', '多门店时先查看门店汇总再合计/比较。', '业务日期采用越南时间00:00–23:59:59。', '销售收入仅含已付款账单；未付款账单归入应收。', '库存报表仅统计已完成单据；草稿不影响库存。'], true),
          image('reports-02-preview.png', 'Kết quả xem trước với chỉ số tổng và bảng chi tiết', 'Preview with summary metrics and detail tables', '含汇总指标与明细表的预览')
        ])
      ]
    },
    {
      id: 'reports-export-reconcile', group: 'reports', order: 2,
      paths: L('bao-cao/xuat-va-doi-soat', 'reports/export-and-reconcile', 'reports/export-and-reconcile'),
      title: L('Xuất báo cáo và đối soát cuối ngày', 'Export reports and reconcile the day', '导出报表与日终对账'),
      summary: L('Quy trình khóa phạm vi, xuất Excel/PDF và đối chiếu doanh thu–tiền–kho.', 'Lock scope, export Excel/PDF and reconcile revenue, money and stock.', '锁定范围、导出Excel/PDF并核对营收、资金与库存。'), minutes: 9,
      sections: [
        sec('export', L('1. Xuất đúng phiên bản dữ liệu', '1. Export the correct data version', '1. 导出正确的数据版本'), [
          steps(['Chọn kỳ và chi nhánh, nhấn xem trước.', 'Kiểm tra tổng bill/doanh thu và thời điểm tạo.', 'Chọn **Excel** để lọc/đối chiếu từng dòng; chọn **PDF** để lưu bản đọc/in.', 'Đặt tên tệp gồm loại báo cáo, chi nhánh và kỳ; không chỉnh số rồi dùng như bản gốc.'], ['Choose period/branch and preview.', 'Verify bill/revenue totals and generated time.', 'Use **Excel** for row reconciliation; **PDF** for a readable/printable record.', 'Name the file with report, branch and period; never edit figures and present it as the original.'], ['选择期间/门店并预览。', '核对账单数、营收及生成时间。', '逐行核对用 **Excel**，阅读/打印存档用 **PDF**。', '文件名包含报表、门店与期间；不得修改数据后当作原始报表。']),
          image('reports-03-export.png', 'Nút xuất Excel/PDF và thời điểm tạo báo cáo', 'Excel/PDF export and generated time', 'Excel/PDF导出与生成时间')
        ]),
        sec('reconcile', L('2. Bộ đối soát cuối ngày', '2. End-of-day reconciliation set', '2. 日终对账组合'), [
          table(L(['Đối chiếu', 'Báo cáo nguồn', 'Phải khớp với'], ['Reconcile', 'Source report', 'Must match'], ['核对项目', '来源报表', '应匹配']), [
            [L('Doanh thu', 'Revenue', '营收'), 'sales_overview', L('Bill đã thanh toán trong lịch sử/Hóa đơn.', 'Paid bills in History/Invoices.', '历史/发票中的已付款账单。')],
            [L('Tiền mặt', 'Cash', '现金'), 'cash_drawer', L('Tiền đếm thực tế và biên bản kết ca.', 'Physical count and shift close record.', '实点现金与结班记录。')],
            [L('Chuyển khoản', 'Bank', '转账'), 'sales_overview', L('Giao dịch ngân hàng/provider đã xác nhận.', 'Confirmed bank/provider transactions.', '银行/服务商已确认交易。')],
            [L('Kho', 'Inventory', '库存'), 'issue / stock', L('Bill Retail, tiêu hao recipe F&B và chứng từ kho.', 'Retail bills, F&B recipe use and warehouse documents.', '零售账单、餐饮配方耗用与仓库单据。')],
            [L('HĐĐT', 'E-invoice', '电子发票'), L('Màn Hóa đơn', 'Invoices screen', '发票页面'), L('ISSUED/FAILED/REVIEW_REQUIRED và tổng bill.', 'ISSUED/FAILED/REVIEW_REQUIRED and bill totals.', 'ISSUED/FAILED/REVIEW_REQUIRED及账单总额。')]
          ]),
          callout('important', L('Không sửa chứng từ để ép khớp', 'Never force a match by editing records', '不要通过修改单据强行对平'), 'Tìm nguyên nhân theo bill/giao dịch/chứng từ và lập bút toán hoặc thao tác điều chỉnh đúng loại. Luôn ghi lý do và người duyệt.', 'Trace the bill, transaction or document and use the correct adjustment flow. Record the reason and approver.', '按账单、交易或单据追查原因，并使用正确调整流程；记录原因与审批人。')
        ])
      ]
    },
    {
      id: 'management-overview', group: 'management', order: 1,
      paths: L('quan-ly/dashboard-thuc-don', 'management/dashboard-and-menu', 'management/dashboard-and-menu'),
      title: L('Dashboard quản lý và quản lý thực đơn', 'Management dashboard and menu', '管理仪表板与菜单管理'),
      summary: L('Theo dõi vận hành, cập nhật danh mục/món, recipe, trạm và lịch bán có kiểm soát.', 'Monitor operations and safely maintain categories, items, recipes, stations and schedules.', '监控运营并安全维护分类、菜品、配方、制作台与销售时段。'), minutes: 10,
      sections: [
        sec('dashboard', L('1. Dashboard vận hành', '1. Operations dashboard', '1. 运营仪表板'), [
          bullets(['Xác nhận đúng chi nhánh trước khi đọc số.', 'Theo dõi doanh thu, bill mở, cảnh báo tồn và tình trạng vận hành.', 'Chỉ dùng dashboard để phát hiện; mở báo cáo/chi tiết để kết luận.', 'Dữ liệu bất thường: ghi kỳ, chi nhánh, mã bill và thời điểm trước khi tải lại.'], ['Verify branch before reading figures.', 'Monitor revenue, open bills, low-stock alerts and operating state.', 'Use the dashboard to detect; open reports/details before concluding.', 'For anomalies, record period, branch, bill ID and time before reloading.'], ['读取前确认门店。', '监控营收、未结账单、低库存预警与运营状态。', '仪表板用于发现问题；结论应以报表/明细为准。', '异常时先记录期间、门店、账单号与时间再刷新。'], true),
          image('management-01-dashboard.png', 'Dashboard quản lý theo chi nhánh', 'Branch management dashboard', '门店管理仪表板')
        ]),
        sec('menu', L('2. Danh mục, món và recipe', '2. Categories, items and recipes', '2. 分类、菜品与配方'), [
          steps(['Vào **Quản lý → Thực đơn**, chọn đúng chi nhánh.', 'Tạo danh mục và gán trạm chế biến mặc định nếu dùng KDS/in bếp.', 'Tạo món: tên, giá, VAT, ảnh, nhóm lựa chọn/topping, khung giờ.', 'Khai recipe trừ đúng mặt hàng kho bếp và định lượng.', 'Lưu bằng tài khoản có quyền; thao tác nhạy cảm có thể yêu cầu PIN Quản lý/Admin.', 'Bán thử một bill nhỏ, kiểm tra KDS/in bếp và chuyển động kho trước khi áp dụng đại trà.'], ['Open **Management → Menu** and select the correct branch.', 'Create categories and default production stations when using KDS/kitchen printing.', 'Create items with price, VAT, image, modifiers and schedule.', 'Map recipes to the correct kitchen stock and quantities.', 'Save with permission; sensitive changes may require Manager/Admin PIN.', 'Run a small test bill and verify KDS/printing/inventory before rollout.'], ['进入 **管理 → 菜单** 并选择正确门店。', '使用KDS/厨房打印时设置分类及默认制作台。', '创建菜品并设置价格、税率、图片、选项与销售时段。', '将配方映射到正确的厨房库存与用量。', '使用有权限账号保存；敏感修改可能需要经理/管理员PIN。', '正式启用前用小额测试单验证KDS、打印与库存。']),
          image('management-02-menu.png', 'Danh mục và danh sách món trong màn Quản lý', 'Categories and items in Management', '管理页面中的分类与菜品'),
          image('management-03-recipe.png', 'Recipe, trạm chế biến và lịch bán của món', 'Item recipe, station and selling schedule', '菜品配方、制作台与销售时段')
        ])
      ]
    },
    {
      id: 'management-users', group: 'management', order: 2,
      paths: L('quan-ly/nhan-su-phan-quyen-nhat-ky', 'management/staff-permissions-audit', 'management/staff-permissions-audit'),
      title: L('Nhân sự, phân quyền, chi nhánh và nhật ký', 'Staff, permissions, branches and audit', '员工、权限、门店与审计'),
      summary: L('Tạo tài khoản theo vai trò tối thiểu, giới hạn chi nhánh và truy vết thao tác.', 'Create least-privilege accounts, scope branches and trace actions.', '按最小权限创建账号、限制门店并追踪操作。'), minutes: 11,
      sections: [
        sec('staff', L('1. Tạo nhân viên và vai trò', '1. Create staff and roles', '1. 创建员工与角色'), [
          steps(['Vào **Cài đặt → Nhân sự & Phân quyền**.', 'Tạo nhân viên với tên đăng nhập duy nhất, PIN mạnh và trạng thái hoạt động.', 'Chọn vai trò gần nhất với công việc: Quản lý, Thu ngân, Bếp, Thủ kho hoặc vai trò tùy chỉnh.', 'Chỉ gán chi nhánh nhân viên thực sự làm việc.', 'Đăng nhập thử bằng tài khoản đó và kiểm tra màn hình/module được phép.'], ['Open **Settings → Staff & Permissions**.', 'Create a unique username, strong PIN and active status.', 'Choose the closest role: Manager, Cashier, Kitchen, Warehouse or custom.', 'Assign only branches the employee works in.', 'Test sign-in and verify visible modules/actions.'], ['进入 **设置 → 员工与权限**。', '创建唯一用户名、强PIN并设为启用。', '选择最接近的角色：经理、收银、厨房、仓管或自定义。', '仅分配员工实际工作的门店。', '测试登录并核对可见模块与操作。']),
          image('management-04-users.png', 'Danh sách nhân viên và vai trò', 'Staff list and roles', '员工列表与角色'),
          image('management-05-permissions.png', 'Ma trận quyền theo nhóm nghiệp vụ', 'Task permission matrix', '业务权限矩阵')
        ]),
        sec('control', L('2. Nguyên tắc kiểm soát', '2. Control principles', '2. 控制原则'), [
          bullets(['Không dùng chung tài khoản/PIN.', 'Quyền nhạy cảm tách riêng: hủy món đã làm, hoàn tiền, cân bằng kho, hủy HĐĐT, xem log kỹ thuật.', 'Admin cuối cùng không thể xóa; vai trò đang có người dùng phải chuyển người trước.', 'Khi nhân viên nghỉ: khóa tài khoản, không xóa lịch sử.', 'Dùng **Nhật ký hoạt động** để tra người, thời điểm, chi nhánh và đối tượng thay đổi.'], ['Never share accounts/PINs.', 'Separate sensitive rights: void made item, refund, stock balance, e-invoice cancel and technical logs.', 'The last Admin cannot be deleted; reassign users before deleting a role.', 'When staff leave, disable the account; retain history.', 'Use **Activity log** to trace actor, time, branch and changed object.'], ['不得共用账号/PIN。', '敏感权限单独分配：撤销已制作菜品、退款、库存平衡、电子发票作废、技术日志。', '最后一个管理员不可删除；删除角色前先转移用户。', '员工离职时停用账号并保留历史。', '使用 **活动日志** 查询操作人、时间、门店与变更对象。'], true),
          image('management-06-audit.png', 'Nhật ký hoạt động và bộ lọc', 'Activity log and filters', '活动日志与筛选')
        ])
      ]
    },
    {
      id: 'invoice-management', group: 'invoices', order: 1,
      paths: L('hoa-don/tra-cuu-va-trang-thai', 'invoices/search-and-status', 'invoices/search-and-status'),
      title: L('Tra cứu hóa đơn và hiểu trạng thái HĐĐT', 'Search invoices and understand e-invoice status', '查询发票并理解电子发票状态'),
      summary: L('Tìm bill, mở chi tiết, đọc trạng thái và chọn đúng hành động tiếp theo.', 'Find a bill, open details, interpret status and choose the correct next action.', '查找账单、打开明细、理解状态并选择正确后续操作。'), minutes: 9,
      sections: [
        sec('search', L('1. Tìm và mở hóa đơn', '1. Find and open an invoice', '1. 查找并打开发票'), [
          steps(['Vào **Hóa đơn**, chọn chi nhánh và kỳ.', 'Tìm bằng số bill, mã đơn, khách hàng, MST hoặc trạng thái.', 'Mở chi tiết và đối chiếu tổng, thanh toán, khách mua, dòng hàng và hoàn trả.', 'Dùng **Xem bill** cho chứng từ bán; **Xem hóa đơn (VAT)**/Tra cứu online/PDF chỉ khả dụng khi đã phát hành.'], ['Open **Invoices**, select branch and period.', 'Search by bill/order, customer, tax ID or status.', 'Open details and verify totals, payment, buyer, lines and returns.', 'Use **View bill** for the sales receipt; VAT view/online lookup/PDF requires issued status.'], ['进入 **发票** 并选择门店与期间。', '按账单号、订单号、客户、税号或状态搜索。', '打开明细并核对金额、支付、购方、明细行与退货。', '**查看账单** 用于销售凭证；VAT查看/在线查询/PDF仅在已开具后可用。']),
          image('invoice-01-list.png', 'Danh sách hóa đơn, chỉ số và bộ lọc', 'Invoice list, metrics and filters', '发票列表、指标与筛选'),
          image('invoice-02-detail.png', 'Chi tiết bill và trạng thái HĐĐT', 'Bill detail and e-invoice status', '账单明细与电子发票状态')
        ]),
        sec('status', L('2. Bảng trạng thái', '2. Status reference', '2. 状态说明'), [
          table(L(['Trạng thái', 'Ý nghĩa', 'Hành động'], ['Status', 'Meaning', 'Action'], ['状态', '含义', '操作']), [
            ['ISSUED', L('Đã phát hành thành công.', 'Successfully issued.', '已成功开具。'), L('Xem/gửi email/tải PDF; không phát hành lại.', 'View/email/download; do not reissue.', '查看/邮件/PDF；不要重复开票。')],
            ['FAILED', L('Nhà cung cấp hoặc dữ liệu trả lỗi.', 'Provider or payload failed.', '服务商或数据错误。'), L('Đọc lỗi, sửa cấu hình/dữ liệu rồi Thử lại với quyền.', 'Read error, correct data/config and retry with permission.', '读取错误，修正数据/配置后凭权限重试。')],
            ['REVIEW_REQUIRED', L('Cần kế toán xử lý thủ công.', 'Accounting review required.', '需要会计人工处理。'), L('Không thử liên tục; mở log kỹ thuật và xử lý thay thế/điều chỉnh.', 'Do not repeatedly retry; inspect logs and use replacement/adjustment.', '不要连续重试；查看日志并进行替换/调整。')],
            ['QUEUED_FOR_SHIFT_CLOSE', L('Chờ quy trình kết ca.', 'Queued for shift close.', '等待结班流程。'), L('Hoàn tất kiểm tra kết ca; không tạo bản khác.', 'Complete shift-close review; do not create another.', '完成结班检查；不要另建。')],
            ['QUEUED / SENDING / RETRYING / PROCESSING / CANCELLING', L('Đang xử lý.', 'Processing.', '处理中。'), L('Chờ và đồng bộ trạng thái; không bấm lặp.', 'Wait and sync status; do not tap repeatedly.', '等待并同步状态；不要重复点击。')],
            ['PENDING_PROVIDER / PENDING_EDGE_SYNC', L('Chờ nhà cung cấp/đồng bộ.', 'Waiting for provider/sync.', '等待服务商/同步。'), L('Kiểm tra mạng và Đồng bộ sau vài phút.', 'Check network and sync after a few minutes.', '检查网络，几分钟后同步。')],
            ['CANCELLED', L('Đã hủy theo quy trình.', 'Cancelled through the approved flow.', '已按流程作废。'), L('Giữ lịch sử; lập chứng từ thay thế nếu cần.', 'Keep history; create replacement if required.', '保留历史；必要时开具替代发票。')]
          ])
        ])
      ]
    },
    {
      id: 'invoice-operations', group: 'invoices', order: 2,
      paths: L('hoa-don/phat-hanh-dong-bo-huy', 'invoices/issue-sync-cancel', 'invoices/issue-sync-cancel'),
      title: L('Phát hành, gửi, đồng bộ và xử lý hóa đơn lỗi', 'Issue, send, sync and resolve failed invoices', '开具、发送、同步与处理失败发票'),
      summary: L('Vòng đời HĐĐT sau bán hàng với rào chắn chống phát hành trùng và sai pháp lý.', 'Post-sale e-invoice lifecycle with duplicate and compliance safeguards.', '售后电子发票全流程，防止重复开票与合规错误。'), minutes: 13,
      sections: [
        sec('issue', L('1. Trước và khi phát hành', '1. Before and during issuance', '1. 开票前与开票时'), [
          bullets(['Bill phải đã thanh toán và chưa có HĐĐT.', 'Chọn đúng loại người mua; MST doanh nghiệp 10/13 số, định danh cá nhân 12 số khi áp dụng.', 'MST người mua không được trùng MST người bán.', 'Kiểm tra mẫu số, ký hiệu, thuế suất, tên hàng, đơn vị, giảm giá và tổng.', 'Nhấn phát hành một lần; trạng thái đang xử lý không được phát hành thêm.'], ['Bill must be paid and have no existing e-invoice.', 'Choose buyer type; company tax ID is 10/13 digits, personal ID 12 when applicable.', 'Buyer tax ID must not equal seller tax ID.', 'Verify template, symbol, tax, item names, units, discounts and total.', 'Issue once; never create another while processing.'], ['账单必须已付款且尚无电子发票。', '选择正确购方类型；企业税号10/13位，适用时个人证件号12位。', '购方税号不得与销方相同。', '核对模板、字轨、税率、商品、单位、折扣与总额。', '只点击一次；处理中不得再次创建。'], true),
          image('invoice-03-issue.png', 'Xem lại dữ liệu trước khi phát hành', 'Review data before issuance', '开具前复核数据')
        ]),
        sec('after', L('2. Sau phát hành và khi có lỗi', '2. After issuance and on failure', '2. 开具后与失败处理'), [
          steps(['Nếu ISSUED: xem online, gửi email hoặc tải PDF.', 'Nếu trạng thái treo: dùng **Đồng bộ trạng thái** sau khi kiểm tra mạng; không phát hành mới.', 'Nếu FAILED: đọc mã và thông báo, sửa nguyên nhân; dùng **Thử lại** với PIN/quyền phù hợp.', 'Nếu REVIEW_REQUIRED hoặc thông tin sai sau phát hành: chuyển kế toán, mở nhật ký kỹ thuật; lập thay thế/điều chỉnh đúng quy định.', 'Chỉ hủy khi loại hóa đơn và trạng thái cho phép. Ghi lý do; không xóa bản ghi.'], ['If ISSUED: view online, email or download PDF.', 'If pending: use **Sync status** after checking network; do not issue another.', 'If FAILED: read code/message, correct the cause and **Retry** with proper authorization.', 'For REVIEW_REQUIRED or post-issue errors: send to accounting, inspect technical logs and create a compliant replacement/adjustment.', 'Cancel only when type/status allows, with a reason; never delete the record.'], ['ISSUED时：在线查看、发邮件或下载PDF。', '待处理时：检查网络后使用 **同步状态**；不要另行开票。', 'FAILED时：读取错误码/信息，修正后凭权限 **重试**。', 'REVIEW_REQUIRED或开票后信息错误：交会计，查看技术日志并按规定替换/调整。', '仅在类型与状态允许时注明原因作废；不得删除记录。']),
          image('invoice-04-actions.png', 'Đồng bộ, thử lại, gửi email, PDF và nhật ký kỹ thuật', 'Sync, retry, email, PDF and technical log actions', '同步、重试、邮件、PDF与技术日志操作'),
          callout('important', L('Bill đã trả hàng', 'Returned bill', '已退货账单'), 'Hệ thống giữ HĐĐT để rà soát và có thể chặn phát hành tự động. Không phát hành lại để “bù”; kế toán phải xử lý chứng từ điều chỉnh/thay thế.', 'The system holds the e-invoice for review and may block automatic issuance. Do not reissue to offset it; accounting must use adjustment/replacement documents.', '系统会保留电子发票供复核并可能阻止自动开票。不要通过重复开票“冲抵”；应由会计处理调整/替代凭证。')
        ])
      ]
    },
    {
      id: 'accounting-setup', group: 'accounting', order: 1,
      paths: L('ke-toan/ho-so-thue-va-tai-khoan', 'accounting/tax-profile-and-accounts', 'accounting/tax-profile-and-accounts'),
      title: L('Thiết lập hồ sơ thuế và tài khoản nhận tiền', 'Set up tax profile and settlement accounts', '设置税务档案与收款账户'),
      summary: L('Khai thông tin kinh doanh, địa điểm, nhóm doanh thu, thuế suất, ngân hàng và MISA.', 'Configure business identity, locations, revenue groups, tax rates, bank and MISA.', '配置经营主体、地点、收入组、税率、银行与MISA。'), minutes: 12,
      sections: [
        sec('tax', L('1. Hồ sơ kê khai thuế', '1. Tax filing profile', '1. 税务申报档案'), [
          steps(['Vào **Kế toán**, chọn **Thiết lập hồ sơ kê khai thuế lần đầu**.', 'Nhập đúng tên hộ/doanh nghiệp, MST, địa chỉ và thông tin đăng ký.', 'Chọn trụ sở chính và liên kết các chi nhánh/địa điểm kinh doanh.', 'Phân loại nhóm doanh thu và phạm vi danh mục áp dụng.', 'Kiểm tra tỷ lệ thuế suất từng nhóm rồi **Hoàn thành & Kích hoạt**.', 'Khi thay đổi pháp lý, dùng Cập nhật hồ sơ và lưu bằng chứng/phê duyệt nội bộ.'], ['Open **Accounting** and start the first-time tax profile.', 'Enter legal name, tax ID, address and registration details.', 'Set head office and link branches/business locations.', 'Classify revenue groups and applicable menu categories.', 'Verify rates, then **Complete & Activate**.', 'For legal changes, update the profile and retain internal evidence/approval.'], ['进入 **会计** 并启动首次税务档案设置。', '填写法定名称、税号、地址与登记信息。', '设置总部并关联门店/经营地点。', '分类收入组及适用菜单范围。', '核对税率后 **完成并启用**。', '法律信息变更时更新档案并保留内部证据/审批。']),
          image('accounting-01-tax-profile.png', 'Hồ sơ kê khai thuế và địa điểm kinh doanh', 'Tax profile and business locations', '税务档案与经营地点')
        ]),
        sec('money', L('2. Ngân hàng, thanh toán và MISA', '2. Bank, payments and MISA', '2. 银行、支付与MISA'), [
          bullets(['Tài khoản nhận chuyển khoản phải đúng chủ tài khoản, số tài khoản và ngân hàng; thử QR với số tiền nhỏ.', 'Chỉ bật phương thức thanh toán cửa hàng thực sự nhận và có quy trình đối soát.', 'Kết nối MISA bằng MST, tài khoản, mật khẩu và mẫu hóa đơn đúng; kiểm tra trạng thái kết nối trước khi phát hành thật.', 'Thay đổi credential, mẫu số hoặc tài khoản nhận tiền là thao tác nhạy cảm và cần người có quyền.'], ['Settlement account must have correct holder, number and bank; test QR with a small amount.', 'Enable only payment methods the store accepts and reconciles.', 'Connect MISA with correct tax ID, account, password and template; verify connection before live issuance.', 'Credential, template or settlement account changes are sensitive and require authorization.'], ['收款账户的户名、账号与银行必须正确；用小额测试二维码。', '仅启用门店实际接受并能对账的支付方式。', '使用正确税号、账号、密码与发票模板连接MISA；正式开票前验证连接。', '凭据、模板或收款账户变更属于敏感操作，需要授权。'], true),
          image('accounting-02-bank.png', 'Tài khoản ngân hàng và phương thức thanh toán', 'Bank account and payment methods', '银行账户与支付方式'),
          image('accounting-03-misa.png', 'Cấu hình kết nối MISA meInvoice', 'MISA meInvoice connection', 'MISA meInvoice连接配置')
        ])
      ]
    },
    {
      id: 'accounting-shift-cash', group: 'accounting', order: 2,
      paths: L('ke-toan/ca-ket-tien-doi-soat', 'accounting/shifts-cash-reconciliation', 'accounting/shifts-cash-reconciliation'),
      title: L('Ca làm việc, két tiền và đối soát', 'Shifts, cash drawer and reconciliation', '班次、钱箱与对账'),
      summary: L('Mở ca, ghi thu/chi, kết ca và xử lý chênh lệch có dấu vết.', 'Open shifts, record cash movements, close and resolve variances with auditability.', '开班、记录现金收支、结班并可审计地处理差异。'), minutes: 11,
      sections: [
        sec('shift', L('1. Vòng đời ca', '1. Shift lifecycle', '1. 班次生命周期'), [
          steps(['Nếu bật bắt buộc mở ca, nhân viên phải chọn ca và nhập tiền đầu ca trước khi bán.', 'Trong ca, mọi thu/chi két dùng đúng chức năng và nhập lý do/đối tác/chứng từ.', 'Không sửa/xóa khoản chi đã liên kết từ màn Chi phí; xử lý trong sổ quỹ để không lệch.', 'Cuối ca dừng nhận giao dịch, kiểm tra bill mở và HĐĐT lỗi/chờ.', 'Đếm tiền thực tế, nhập số đếm và đối chiếu số hệ thống; ghi lý do mọi chênh lệch.', 'Xác nhận kết ca một lần; ca đã đóng ở nơi khác không được đóng lại.'], ['When shift enforcement is on, select a shift and enter opening cash before selling.', 'During the shift, record every cash in/out with reason, counterparty and evidence.', 'Do not edit/delete drawer-linked expenses in Expenses; use the cash ledger.', 'At close, stop transactions and check open bills plus failed/pending e-invoices.', 'Count physical cash, enter count, compare expected and explain every variance.', 'Close once; never close a shift already closed elsewhere.'], ['启用强制班次时，销售前选择班次并录入期初现金。', '班次中所有现金收支都通过正确功能记录原因、对方与凭证。', '不要在费用页修改/删除已关联钱箱的费用；应在现金账处理。', '结班时停止交易并检查未结账单及失败/待处理电子发票。', '实点现金、录入盘点数、核对应有金额并说明差异。', '只结班一次；已在其他设备结班的班次不得重复关闭。']),
          image('accounting-04-shift.png', 'Mở ca, tiền đầu ca và trạng thái ca', 'Open shift, opening cash and status', '开班、期初现金与班次状态'),
          image('accounting-05-close.png', 'Kết ca và chênh lệch tiền két', 'Shift close and cash variance', '结班与现金差异')
        ]),
        sec('reconcile', L('2. Khi số tiền không khớp', '2. When money does not match', '2. 金额不一致时'), [
          bullets(['So bill tiền mặt với Báo cáo tiền két.', 'Kiểm tra hoàn tiền, chi tiền, hoàn chi và giao dịch ghi nhầm phương thức.', 'Kiểm tra bill vừa được ngân hàng tự xác nhận ở thiết bị khác.', 'Không tạo bill/thu tiền mới để bù chênh lệch.', 'Lưu biên bản, lý do và người duyệt; điều chỉnh bằng nghiệp vụ đúng loại.'], ['Compare cash bills with Cash Drawer report.', 'Check refunds, expenses, reimbursements and wrong payment methods.', 'Check bills auto-confirmed by bank on another device.', 'Never create a new bill/payment to offset a variance.', 'Keep evidence, reason and approver; use the correct adjustment transaction.'], ['将现金账单与钱箱报表核对。', '检查退款、支出、报销及支付方式误记。', '检查是否有银行在其他设备自动确认的账单。', '不得新建账单/收款来冲平差异。', '保留证据、原因与审批人，并使用正确调整业务。'], true)
        ])
      ]
    },
    {
      id: 'settings-foundation', group: 'settings', order: 1,
      paths: L('cai-dat/tong-quan-thiet-lap', 'settings/setup-overview', 'settings/setup-overview'),
      title: L('Tổng quan 12 nhóm cài đặt', 'Overview of all 12 settings areas', '12个设置区域总览'),
      summary: L('Thứ tự thiết lập an toàn và phạm vi hỗ trợ theo Desktop, Tablet, Mobile.', 'Safe setup order and device availability across Desktop, Tablet and Mobile.', '安全设置顺序及桌面端、平板端、手机端支持范围。'), minutes: 12,
      sections: [
        sec('matrix', L('1. Danh mục và thiết bị hỗ trợ', '1. Settings and supported devices', '1. 设置与支持设备'), [
          table(L(['Nhóm', 'Dùng để', 'Thiết bị'], ['Area', 'Purpose', 'Devices'], ['区域', '用途', '设备']), settingsRows),
          callout('note', L('Bản điện thoại', 'Phone edition', '手机端'), 'Source đã có một số màn hình phone nhưng bộ hướng dẫn/ảnh chưa nghiệm thu. Help Center giữ nguyên mục Mobile ở trạng thái “sắp ra mắt”; không coi là quy trình chính thức cho đến khi hoàn tất kiểm thử và ảnh.', 'Some phone screens exist in source, but the guide and screenshots are not accepted yet. Help Center keeps Mobile as “coming soon” until testing and imagery are complete.', '源码中已有部分手机页面，但指南与截图尚未验收。帮助中心将手机端标记为“即将推出”，直至测试和图片完成。')
        ]),
        sec('order', L('2. Thứ tự thiết lập đề nghị', '2. Recommended setup order', '2. 建议设置顺序'), [
          steps(['Chi nhánh, kho và kênh bán.', 'Nhân sự, vai trò, quyền và phạm vi chi nhánh.', 'Bàn/khu vực, thực đơn, recipe và trạm.', 'Phương thức thanh toán, ca/két và tài khoản ngân hàng.', 'Máy in, mẫu bill/tem, màn hình khách và thiết bị khách.', 'MISA/ERP/marketplace, loyalty/khuyến mại và thông báo.', 'Chạy ca thử: F&B, Retail, QR, in, kho, HĐĐT và báo cáo.'], ['Branches, warehouses and channels.', 'Staff, roles, permissions and branch scope.', 'Tables/zones, menu, recipes and stations.', 'Payment methods, shifts/drawer and settlement bank.', 'Printers, templates, customer display and guest devices.', 'MISA/ERP/marketplaces, loyalty/promotions and notifications.', 'Run a test shift covering F&B, Retail, QR, print, inventory, e-invoice and reports.'], ['门店、仓库与渠道。', '员工、角色、权限与门店范围。', '桌台/区域、菜单、配方与制作台。', '支付方式、班次/钱箱与收款银行。', '打印机、模板、顾客显示与顾客设备。', 'MISA/ERP/平台、积分/促销与通知。', '进行测试班次，覆盖餐饮、零售、二维码、打印、库存、电子发票与报表。']),
          image('settings-01-overview.png', '12 nhóm trong màn Cài đặt', 'The 12 Settings areas', '设置页面的12个区域')
        ])
      ]
    },
    {
      id: 'settings-print-devices', group: 'settings', order: 2,
      paths: L('cai-dat/may-in-thiet-bi-hien-thi', 'settings/printers-devices-displays', 'settings/printers-devices-displays'),
      title: L('Máy in, Bill/Tem, thiết bị khách và màn hình phụ', 'Printers, templates, guest devices and customer display', '打印机、模板、顾客设备与顾客显示'),
      summary: L('Kết nối đúng máy, phân tuyến loại phiếu và kiểm thử từ đầu đến cuối.', 'Connect the right printer, route document types and test end to end.', '连接正确打印机、路由单据类型并进行端到端测试。'), minutes: 11,
      sections: [
        sec('printer', L('1. Máy in và tuyến in', '1. Printers and routing', '1. 打印机与路由'), [
          bullets(['Desktop agent phải đang chạy và đã báo danh thiết bị/máy in.', 'Mỗi máy in gán đúng loại: Hóa đơn/Tạm tính, Bếp, Tem ly, Tem sản phẩm, Tem vận đơn, Runner hoặc Báo cáo.', 'Máy in USB cắm ở máy nào thì thao tác tại máy đó; quản lý từ máy khác cần đúng quyền.', 'Máy in LAN/IP kiểm tra địa chỉ, cổng và cùng mạng.', 'In thử từng loại trước; sau đó chạy bill thật nhỏ và kiểm tra xác nhận đã in.'], ['Desktop agent must be running and reporting device/printers.', 'Assign the correct type: Receipt, Kitchen, Cup label, Product label, Shipping label, Runner or Report.', 'Operate a USB printer on its host device; remote management requires permission.', 'For LAN/IP, verify address, port and network.', 'Test each type, then run a small live bill and verify print acknowledgement.'], ['桌面打印代理必须运行并上报设备/打印机。', '正确分配类型：小票、厨房、杯贴、商品标签、运单、传菜或报表。', 'USB打印机应在其连接电脑操作；远程管理需要权限。', 'LAN/IP打印机检查地址、端口与同网。', '逐类测试，再用小额真实账单确认打印回执。'], true),
          image('settings-02-printers.png', 'Danh sách máy in và loại tuyến', 'Printer list and route types', '打印机列表与路由类型'),
          image('settings-03-template.png', 'Thiết kế mẫu bill và tem nhãn', 'Receipt and label designer', '小票与标签设计器')
        ]),
        sec('display', L('2. Thiết bị khách và hiển thị', '2. Guest devices and displays', '2. 顾客设备与显示'), [
          steps(['Đặt mật khẩu thiết bị khách 4 số khó đoán; không dùng 0000/1111/1234.', 'Bật đúng chế độ self-order và kiểm tra thiết bị đã kết nối.', 'Desktop: chọn màn hình phụ và thử hiển thị giỏ, tổng, QR.', 'BYOD: cấu hình banner và QR bàn, quét thử bằng điện thoại khách.', 'Kiểm tra thoát kiosk/PIN nhân viên và thông báo không xuất hiện trên màn khách.'], ['Use a non-trivial 4-digit guest-device password; avoid 0000/1111/1234.', 'Enable the correct self-order mode and verify device connection.', 'Desktop: select the second screen and test cart, total and QR.', 'BYOD: configure banner/table QR and scan with a guest phone.', 'Verify kiosk exit/staff PIN and that staff notifications do not appear to guests.'], ['设置不易猜的4位顾客设备密码，避免0000/1111/1234。', '启用正确自助点餐模式并确认设备连接。', '桌面端：选择副屏并测试购物车、总额与二维码。', '自带设备 (BYOD)：配置横幅/桌台二维码并用顾客手机试扫。', '验证退出自助模式/员工PIN，确保员工通知不显示给顾客。']),
          image('settings-04-guest-device-phone.png', 'Cấu hình thiết bị khách trên điện thoại', 'Guest-device settings on a phone', '手机端顾客设备设置'),
          image('settings-04-guest-device-tablet.png', 'Cấu hình thiết bị khách trên Tablet', 'Guest-device settings on a tablet', '平板端顾客设备设置'),
          image('settings-05-customer-display.png', 'Cấu hình màn hình phụ dành cho khách', 'Customer-facing secondary display settings', '顾客副屏设置'),
          image('settings-05-customer-display-BYOD.png', 'Cấu hình banner và trải nghiệm BYOD', 'BYOD banner and experience settings', '自带设备 (BYOD) 横幅与体验设置')
        ])
      ]
    },
    {
      id: 'settings-integrations', group: 'settings', order: 3,
      paths: L('cai-dat/lien-ket-dong-bo', 'settings/integrations-and-sync', 'settings/integrations-and-sync'),
      title: L('Liên kết MISA, thanh toán, marketplace và đồng bộ', 'MISA, payment, marketplace and sync integrations', 'MISA、支付、电商平台与同步集成'),
      summary: L('Kết nối, kiểm thử, giám sát và ngắt liên kết mà không làm mất dấu giao dịch.', 'Connect, test, monitor and disconnect without losing transaction traceability.', '连接、测试、监控与断开，同时保留交易可追溯性。'), minutes: 12,
      sections: [
        sec('connect', L('1. Quy trình kết nối chuẩn', '1. Standard connection flow', '1. 标准连接流程'), [
          steps(['Chuẩn bị tài khoản chủ/quyền admin của nhà cung cấp và chọn đúng chi nhánh.', 'Nhập credential trong **Cài đặt → Liên kết**; không gửi mật khẩu/token qua chat.', 'Hoàn tất OAuth/callback nếu có, rồi ánh xạ gian hàng với chi nhánh và kho.', 'Liên kết SKU bên ngoài với hàng hóa POS; xử lý toàn bộ mặt hàng chưa ánh xạ.', 'Chạy giao dịch thử: nhận đơn/webhook, thanh toán hoặc HĐĐT.', 'Kiểm tra báo cáo/log và chỉ bật vận hành thật sau khi test đạt.'], ['Prepare provider owner/admin access and select the correct branch.', 'Enter credentials under **Settings → Integrations**; never send passwords/tokens through chat.', 'Complete OAuth/callback, then map shops to branches and warehouses.', 'Map external SKUs to POS products and resolve all unmapped items.', 'Run a test order/webhook, payment or e-invoice.', 'Verify reports/logs before enabling live operations.'], ['准备服务商店主/管理员权限并选择正确门店。', '在 **设置 → 集成** 输入凭据；不要通过聊天发送密码/令牌。', '完成OAuth/回调，再将店铺映射到门店和仓库。', '将外部SKU关联到POS商品并处理全部未映射项。', '测试订单/回调、支付或电子发票。', '核对报表/日志后再正式启用。']),
          image('settings-06-integrations.png', 'Danh sách liên kết và trạng thái', 'Integration list and status', '集成列表与状态')
        ]),
        sec('disconnect', L('2. Khi lỗi hoặc cần ngắt', '2. On errors or disconnection', '2. 出错或需断开时'), [
          bullets(['Không xóa giao dịch/đơn cũ; ngắt kết nối chỉ dừng đồng bộ mới.', 'Trước khi refresh token, kiểm tra có tiến trình refresh đang chạy.', 'Sai webhook/secure token: tắt nhận dữ liệu, sửa bí mật ở cả hai đầu rồi test lại.', 'Gian hàng không có quyền hoặc không tìm thấy: đăng nhập đúng tài khoản chủ shop và cấp đủ scope.', 'Chụp trạng thái, mã lỗi và thời điểm; che token/mật khẩu trước khi gửi hỗ trợ.'], ['Never delete old transactions/orders; disconnect only stops new synchronization.', 'Before refreshing a token, check whether refresh is already in progress.', 'For webhook/secret failures, pause ingestion, fix both ends and retest.', 'For missing shop/scope, sign in as the shop owner and grant required scopes.', 'Capture status, code and time; redact tokens/passwords before support.'], ['不要删除旧交易/订单；断开仅停止新的同步。', '刷新令牌前确认没有刷新任务正在进行。', '回调/密钥错误时暂停接收，修正两端后重测。', '店铺/权限缺失时用店主账号登录并授予所需范围。', '记录状态、错误码与时间；提交支持前遮盖令牌/密码。'], true)
        ])
      ]
    },
    {
      id: 'troubleshooting-first-response', group: 'troubleshooting', order: 1,
      paths: L('xu-ly-loi/quy-trinh-phan-ung', 'troubleshooting/first-response', 'troubleshooting/first-response'),
      title: L('Quy trình xử lý lỗi an toàn', 'Safe incident response flow', '安全故障处理流程'),
      summary: L('Phân biệt lỗi nhập liệu, quyền, đồng bộ, thiết bị và hệ thống trước khi thử lại.', 'Separate validation, permission, sync, device and system faults before retrying.', '重试前区分输入、权限、同步、设备与系统故障。'), minutes: 8,
      sections: [
        sec('capture', L('1. Ghi nhận trước khi thao tác lại', '1. Capture before retrying', '1. 重试前记录'), [
          bullets(['Thiết bị và phiên bản: Desktop/Tablet/BYOD/Mobile.', 'Chi nhánh, người dùng/vai trò và màn hình đang mở.', 'Mã bill/đơn/phiếu/HĐĐT/giao dịch.', 'Thông báo + mã lỗi nguyên văn, ảnh toàn màn hình và giờ phút phát sinh.', 'Mạng đang online/offline; thao tác cuối cùng và đã bấm mấy lần.'], ['Device/version: Desktop, Tablet, BYOD or Mobile.', 'Branch, user/role and current screen.', 'Bill/order/document/e-invoice/transaction ID.', 'Exact message/code, full-screen screenshot and incident time.', 'Online/offline state, last action and number of attempts.'], ['设备/版本：桌面端、平板端、自带设备 (BYOD) 或手机端。', '门店、用户/角色与当前页面。', '账单/订单/单据/电子发票/交易编号。', '完整错误信息/代码、全屏截图与发生时间。', '在线/离线状态、最后操作及点击次数。'], true)
        ]),
        sec('decide', L('2. Quy tắc thử lại', '2. Retry rules', '2. 重试规则'), [
          table(L(['Loại lỗi', 'Dấu hiệu', 'Xử lý đầu tiên'], ['Type', 'Signal', 'First action'], ['类型', '表现', '首要处理']), [
            [L('Nhập liệu', 'Validation', '输入校验'), L('Thiếu/sai trường, số âm, MST/PIN sai định dạng.', 'Missing/invalid field, negative value, bad tax ID/PIN.', '字段缺失/无效、负数、税号/PIN格式错误。'), L('Sửa đúng dữ liệu rồi gửi một lần.', 'Correct data and submit once.', '修正数据后只提交一次。')],
            [L('Quyền/PIN', 'Permission/PIN', '权限/PIN'), L('PERM_REQUIRED/APPROVAL_*.', 'PERM_REQUIRED/APPROVAL_*.', 'PERM_REQUIRED/APPROVAL_*。'), L('Đăng nhập đúng vai trò hoặc xin duyệt mới.', 'Use the proper role or request fresh approval.', '使用正确角色或重新申请审批。')],
            [L('Xung đột đa thiết bị', 'Multi-device conflict', '多设备冲突'), L('VERSION_CONFLICT, đã thanh toán, mất quyền sửa.', 'VERSION_CONFLICT, paid, edit lease lost.', '版本冲突、已付款、失去编辑权。'), L('Tải lại; tuyệt đối không thu/lưu lần nữa trước khi kiểm tra.', 'Reload; never collect/save again before checking.', '刷新；检查前绝不重复收款/保存。')],
            [L('Mạng/đồng bộ', 'Network/sync', '网络/同步'), L('Pending, timeout, offline, STORE_OFFLINE.', 'Pending, timeout, offline, STORE_OFFLINE.', 'Pending、超时、离线、STORE_OFFLINE。'), L('Giữ nguyên dữ liệu, kiểm tra mạng/server rồi đồng bộ.', 'Preserve data, check network/server and sync.', '保留数据，检查网络/服务器后同步。')],
            [L('Hệ thống', 'System', '系统'), 'INTERNAL_ERROR', L('Không lặp thao tác nhạy cảm; gửi bộ thông tin đã ghi cho kỹ thuật.', 'Do not repeat sensitive actions; send captured evidence to support.', '不要重复敏感操作；将记录信息发给技术支持。')]
          ]),
          callout('important', L('Ba thao tác không được bấm lặp', 'Three actions never to repeat blindly', '三类操作不得盲目重复'), 'Thanh toán, phát hành HĐĐT và cân bằng kho. Luôn kiểm tra lịch sử/trạng thái server trước.', 'Payment, e-invoice issuance and stock reconciliation. Always check server/history state first.', '支付、电子发票开具与库存平衡。必须先检查服务器/历史状态。')
        ])
      ]
    },
    {
      id: 'troubleshooting-devices', group: 'troubleshooting', order: 2,
      paths: L('xu-ly-loi/desktop-tablet-byod', 'troubleshooting/desktop-tablet-byod', 'troubleshooting/desktop-tablet-byod'),
      title: L('Lỗi Desktop, Tablet và BYOD', 'Desktop, Tablet and BYOD issues', '桌面端、平板端与自带设备 (BYOD) 故障'),
      summary: L('Checklist theo từng loại thiết bị đang được hướng dẫn chính thức.', 'Device-specific checks for currently documented editions.', '当前正式文档所覆盖设备的专项检查。'), minutes: 12,
      sections: [
        sec('desktop', L('1. Desktop/POS', '1. Desktop/POS', '1. 桌面端/POS'), [
          table(L(['Hiện tượng', 'Kiểm tra', 'Cách xử lý'], ['Symptom', 'Check', 'Resolution'], ['现象', '检查', '处理']), [
            [L('Không vào server', 'Cannot reach server', '无法连接服务器'), L('URL, DNS, mạng, giờ hệ thống.', 'URL, DNS, network, system clock.', 'URL、DNS、网络、系统时间。'), L('Thử trang health; sửa mạng/DNS, không đổi dữ liệu cục bộ.', 'Test health page; fix network/DNS without modifying local data.', '测试健康页；修复网络/DNS，不改本地数据。')],
            [L('Không in', 'No printing', '无法打印'), L('Agent, máy in mặc định, tuyến, giấy/kết nối.', 'Agent, default printer, route, paper/connectivity.', '代理、默认打印机、路由、纸张/连接。'), L('Mở agent, báo danh lại, in thử đúng loại.', 'Start agent, re-register and test the correct route.', '启动代理、重新上报并测试正确路由。')],
            [L('Màn khách không hiện', 'Customer display blank', '顾客显示空白'), L('Màn thứ 2, chế độ Extend, cấu hình hiển thị.', 'Second monitor, Extend mode, display settings.', '第二屏、扩展模式、显示设置。'), L('Chọn lại màn, mở thử và kiểm tra trình điều khiển.', 'Reselect display, test and verify driver.', '重新选择显示器、测试并检查驱动。')],
            [L('App treo khi cập nhật', 'Update stalls', '更新卡住'), L('Dung lượng, quyền cài APK/EXE, mạng.', 'Disk, install permission, network.', '磁盘、安装权限、网络。'), L('Không chạy nhiều bộ cài; ghi phiên bản rồi mở lại app.', 'Do not run multiple installers; record version and reopen.', '不要运行多个安装包；记录版本后重开。')]
          ]),
          image('trouble-01-desktop-status.png', 'Trạng thái kết nối và phiên bản trên Desktop', 'Desktop connection and version status', '桌面端连接与版本状态')
        ]),
        sec('tablet', L('2. Tablet/self-order', '2. Tablet/self-order', '2. 平板/自助点餐'), [
          bullets(['Không thấy bàn: chọn đúng chi nhánh/khu vực và kiểm tra bàn đang hoạt động.', 'Không gửi được món: kiểm tra mạng, phiên QR/bàn và món còn bán theo lịch.', 'Thoát kiosk: dùng đúng thao tác logo/PIN nhân viên; không tắt app cưỡng bức giữa lúc gửi.', 'Thông báo nhân viên không được hiện trên màn khách; nếu có, thoát kiosk và đăng nhập lại đúng chế độ.', 'BYOD QR báo không hợp lệ: QR bị đổi/thu hồi, bill đã đóng hoặc khách đang dùng QR bàn cũ. In/quét QR hiện tại.'], ['Missing table: verify branch/zone and active table.', 'Cannot send items: check network, table/QR session and selling schedule.', 'Exit kiosk with the defined logo/staff PIN flow; do not force close while sending.', 'Staff notifications must not appear on guest screen; exit and re-enter the correct mode.', 'Invalid BYOD QR means revoked/old QR or closed bill; scan the current table QR.'], ['看不到桌台：检查门店/区域及桌台启用状态。', '无法发送菜品：检查网络、桌台/二维码会话与销售时段。', '按规定的Logo/员工PIN退出自助模式；发送中不要强制关闭。', '顾客屏不应显示员工通知；如出现，退出后以正确模式重新进入。', '自带设备 (BYOD) 二维码无效表示已撤销/过期或账单已关闭；扫描当前桌台二维码。'], true),
          image('trouble-02-tablet-status.png', 'Tablet: chi nhánh, bàn và trạng thái kết nối', 'Tablet branch, table and connectivity', '平板端门店、桌台与连接状态'),
          image('trouble-03-byod-invalid.png', 'Thông báo QR BYOD không hợp lệ/hết phiên', 'Invalid or expired BYOD QR', '自带设备 (BYOD) 二维码无效/会话过期')
        ])
      ]
    },
    {
      id: 'troubleshooting-codes', group: 'troubleshooting', order: 3,
      paths: L('xu-ly-loi/danh-muc-ma-loi', 'troubleshooting/error-code-catalog', 'troubleshooting/error-code-catalog'),
      title: L('Danh mục đầy đủ mã lỗi cấu hình', 'Complete configured error-code catalog', '完整已配置错误码目录'),
      summary: L('Toàn bộ 62 mã lỗi ổn định hiện có, kèm nhóm và cách phản ứng.', 'All 62 current stable error codes with family and response.', '当前全部62个稳定错误码及分类与处理方式。'), minutes: 18,
      sections: [
        sec('codes', L('1. 62 mã lỗi ổn định', '1. All 62 stable codes', '1. 全部62个稳定错误码'), [
          p('Bảng dưới lấy từ source hiện tại. Mã là khóa chẩn đoán; thông báo chi tiết có thể bổ sung tên bill, mặt hàng, số tiền hoặc nhà cung cấp.', 'This table reflects the current source. Codes are diagnostic keys; detail messages may include bill, item, amount or provider.', '下表来自当前源码。错误码是诊断键；详细信息可能包含账单、商品、金额或服务商。'),
          table(L(['Mã lỗi', 'Nhóm', 'Phản ứng chuẩn'], ['Error code', 'Family', 'Standard response'], ['错误码', '分类', '标准处理']), codeRows)
        ]),
        sec('download', L('2. Danh mục thông báo đầy đủ từ source', '2. Full source-derived message catalog', '2. 源码完整消息目录'), [
          p('Tải **[error-catalog.csv](/assets/help/error-catalog.csv)** để xem toàn bộ **811 dòng cấu hình** hiện được trích tự động: 62 mã ổn định (64 vị trí khai báo), 649 thông báo backend và 98 thông báo lỗi phía ứng dụng. Mỗi dòng có module, lớp thiết bị và file:dòng nguồn. Nội dung gốc được giữ nguyên để tìm chính xác trong log/source.', 'Download **[error-catalog.csv](/assets/help/error-catalog.csv)** for all **811 extracted configuration rows**: 62 stable codes (64 declarations), 649 backend messages and 98 client error messages. Each row includes module, device layer and source file:line. Original text is retained for exact log/source matching.', '下载 **[error-catalog.csv](/assets/help/error-catalog.csv)** 查看自动提取的全部 **811条配置记录**：62个稳定错误码（64处声明）、649条后端消息和98条客户端错误消息。每行包含模块、设备层及源码文件:行号；保留原文以便精确匹配日志/源码。'),
          callout('note', L('Cách cập nhật danh mục', 'Updating the catalog', '更新目录'), 'Sau mỗi bản phát hành, chạy `node docs/help-center/tools/generate-error-catalog.mjs`, kiểm tra số dòng và triển khai lại file CSV.', 'After each release, run `node docs/help-center/tools/generate-error-catalog.mjs`, verify row count and redeploy the CSV.', '每次发布后运行 `node docs/help-center/tools/generate-error-catalog.mjs`，核对行数并重新部署CSV。')
        ])
      ]
    },
    {
      id: 'mobile-placeholder', group: 'mobile', order: 1,
      paths: L('dien-thoai/trang-thai-va-ke-hoach', 'phone/status-and-plan', 'phone/status-and-plan'),
      title: L('Hướng dẫn điện thoại — khu vực đã dành sẵn', 'Phone guides — reserved area', '手机指南—已预留区域'),
      summary: L('Chưa phát hành hướng dẫn chính thức; URL và checklist đã sẵn sàng để bổ sung sau nghiệm thu.', 'Official phone documentation is not released yet; URLs and checklist are ready for acceptance.', '手机端正式文档尚未发布；网址与验收清单已准备。'), minutes: 4,
      sections: [
        sec('status', L('1. Trạng thái hiện tại', '1. Current status', '1. 当前状态'), [
          callout('warn', L('Chưa dùng làm tài liệu đào tạo', 'Not yet for training', '暂不可用于培训'), 'Source có các màn hình Phone nhưng quy trình, ảnh và ma trận thiết bị chưa được nghiệm thu. Hiện chỉ Desktop và Tablet/BYOD là tài liệu chính thức.', 'Phone screens exist in source, but workflows, screenshots and device matrix are not accepted. Desktop and Tablet/BYOD remain the official guides.', '源码中已有手机页面，但流程、截图与设备矩阵尚未验收。目前仅桌面端与平板/自带设备 (BYOD) 为正式文档。'),
          bullets(['Không sao chép ảnh Desktop rồi ghi là Mobile.', 'Không cam kết nút/vị trí cho đến khi test trên thiết bị thật.', 'Lỗi Mobile vẫn xuất hiện trong CSV kỹ thuật nếu đã có trong source, nhưng không coi là quy trình hỗ trợ hoàn chỉnh.'], ['Do not relabel Desktop screenshots as Mobile.', 'Do not promise button placement until real-device testing.', 'Mobile source errors appear in the technical CSV, but do not imply a complete support workflow.'], ['不要把桌面端截图改标为手机端。', '真机测试前不要承诺按钮位置。', '源码中的手机错误会出现在技术CSV中，但不代表支持流程已完整。'], true)
        ]),
        sec('planned', L('2. Cấu trúc sẽ bổ sung', '2. Planned guide structure', '2. 计划补充结构'), [
          table(L(['URL dự kiến', 'Nội dung', 'Ảnh cần'], ['Reserved URL', 'Content', 'Screenshots'], ['预留网址', '内容', '所需截图']), [
            ['/vi/dien-thoai/dang-nhap-va-tong-quan/', L('Đăng nhập, chi nhánh, launcher và dashboard.', 'Login, branch, launcher and dashboard.', '登录、门店、启动页与仪表板。'), 'mobile-01…03'],
            ['/vi/dien-thoai/ban-le-va-thanh-toan/', L('Bán một tay, giỏ, QR/tiền mặt, in bill.', 'One-handed sale, cart, QR/cash and receipt.', '单手销售、购物车、二维码/现金与小票。'), 'mobile-04…09'],
            ['/vi/dien-thoai/kho-va-chung-tu/', L('Hàng hóa, nhập, chuyển, kiểm và lịch sử.', 'Products, receipt, transfer, stocktake and history.', '商品、入库、调拨、盘点与历史。'), 'mobile-10…15'],
            ['/vi/dien-thoai/khach-hang-hoa-don-ca/', L('Khách hàng, trả hàng, hóa đơn và ca.', 'Customers, returns, invoices and shifts.', '客户、退货、发票与班次。'), 'mobile-16…21'],
            ['/vi/dien-thoai/cai-dat-va-loi/', L('Thiết lập hỗ trợ và lỗi riêng Mobile.', 'Supported settings and phone-specific issues.', '支持的设置与手机专项故障。'), 'mobile-22…26']
          ]),
          image('mobile-00-placeholder.png', 'Ảnh bìa Mobile sẽ chụp sau khi nghiệm thu', 'Phone cover image after acceptance', '手机端验收后的封面图')
        ])
      ]
    }
  );

  data.ui.vi.homeCopy = 'Hướng dẫn Dan D Pak POS cho kho, Retail, F&B, báo cáo, quản lý, hóa đơn, kế toán, cài đặt và xử lý lỗi trên Desktop/Tablet/BYOD.';
  data.ui.en.homeCopy = 'Dan D Pak POS guides for inventory, Retail, F&B, reports, management, invoices, accounting, settings and troubleshooting on Desktop/Tablet/BYOD, with a reserved Phone area.';
  data.ui.zh.homeCopy = 'Dan D Pak POS 分步指南：库存、零售、餐饮、报表、管理、发票、会计、设置与桌面端/平板/自带设备 (BYOD) 故障排除；手机端区域已预留。';
})();
