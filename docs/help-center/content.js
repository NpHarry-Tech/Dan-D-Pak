/* Dan D Pak Help Center content. Keep screenshots in assets/screenshots using the
   exact file names declared below; missing files are rendered as placeholders. */
(function () {
  const L = (vi, en, zh) => ({ vi, en, zh });
  const p = (vi, en, zh) => ({ type: 'p', text: L(vi, en, zh) });
  const bullets = (vi, en, zh, checklist = false) => ({ type: 'bullets', items: L(vi, en, zh), checklist });
  const steps = (vi, en, zh) => ({ type: 'steps', items: L(vi, en, zh) });
  const callout = (kind, title, vi, en, zh) => ({ type: 'callout', kind, title, text: L(vi, en, zh) });
  const image = (file, vi, en, zh) => ({ type: 'image', file, caption: L(vi, en, zh) });
  const sec = (id, title, blocks) => ({ id, title, blocks });

  const groups = [
    { id: 'start', icon: '✦', name: L('Bắt đầu', 'Getting started', '开始使用'), description: L('Thiết lập dữ liệu nền trước khi vận hành.', 'Prepare the core data before opening.', '营业前准备基础数据。') },
    { id: 'warehouse', icon: '▦', name: L('Kho hàng', 'Inventory & warehouse', '库存与仓库'), description: L('Hàng hóa, nhập–xuất, lô/HSD, kiểm kho và giá.', 'Products, receipts, issues, lots, stocktakes and pricing.', '商品、出入库、批次/效期、盘点与价格。') },
    { id: 'retail', icon: '▤', name: L('Bán lẻ', 'Retail', '零售'), description: L('Quét hàng, giảm giá, ghi chú, thanh toán và trả hàng.', 'Scan, discount, note, collect payment and return.', '扫码、折扣、备注、收款与退货。') },
    { id: 'fnb', icon: '◉', name: L('F&B', 'Food & beverage', '餐饮'), description: L('Bàn, gọi món, Tablet/BYOD, bếp và tách/gộp bill.', 'Tables, ordering, Tablet/BYOD, kitchen and bill operations.', '桌台、点餐、平板/自带设备 (BYOD)、厨房与账单操作。') },
    { id: 'payment', icon: '₫', name: L('Thanh toán & hóa đơn', 'Payment & invoices', '支付与发票'), description: L('Tiền mặt, chuyển khoản, thanh toán hỗn hợp và HĐĐT.', 'Cash, bank transfer, split tender and e-invoices.', '现金、转账、混合支付与电子发票。') }
  ];

  const articles = [
    {
      id: 'start-overview', group: 'start', order: 1,
      paths: L('bat-dau/quy-trinh-van-hanh', 'getting-started/operating-flow', 'getting-started/operating-flow'),
      title: L('Quy trình bắt đầu với Dan D Pak POS', 'Getting started with Dan D Pak POS', '开始使用 Dan D Pak POS'),
      summary: L('Lộ trình thiết lập từ chi nhánh, kho, hàng hóa đến ca bán đầu tiên.', 'Set up branches, warehouses and products before your first shift.', '从门店、仓库、商品设置到首个营业班次。'),
      minutes: 8,
      sections: [
        sec('before', L('1. Chuẩn bị trước khi bán', '1. Before you sell', '1. 开售前准备'), [
          steps(
            ['Đăng nhập bằng tài khoản được cấp, chọn đúng chi nhánh đang làm việc.', 'Vào **Cài đặt → Chi nhánh & kho** để kiểm tra chi nhánh, kho bán và kho nguyên liệu.', 'Tạo người dùng, vai trò và quyền; chỉ cấp quyền hủy món, chỉnh giá, xuất kho, cân bằng kho hoặc hoàn tiền cho người chịu trách nhiệm.', 'Khai báo máy in hóa đơn, máy in bếp/bar và tuyến in.', 'Tạo hàng hóa Retail hoặc nguyên liệu/vật dụng F&B; sau đó lập phiếu nhập hàng hay tồn đầu bằng chứng từ.'],
            ['Sign in with the assigned account and select the correct branch.', 'Open **Settings → Branches & warehouses** and verify the selling and ingredient warehouses.', 'Create users, roles and permissions. Restrict item cancellation, price override, stock issue, stocktake approval and refunds.', 'Configure receipt and kitchen/bar printers with their routes.', 'Create Retail SKUs or F&B ingredients/supplies, then post opening stock through a receipt document.'],
            ['使用已分配账户登录并选择正确门店。', '进入 **设置 → 门店与仓库**，确认销售仓与原料仓。', '创建用户、角色和权限；取消菜品、改价、出库、盘点平衡及退款仅授予负责人。', '设置小票打印机、厨房/吧台打印机及打印路由。', '创建零售商品或餐饮原料/用品，再通过入库单录入期初库存。']
          ),
          image('start-01-branch-login.png', 'Đăng nhập và chọn chi nhánh', 'Sign in and select a branch', '登录并选择门店'),
          callout('important', L('Không sửa tồn trực tiếp', 'Never edit stock directly', '不要直接修改库存'), 'Mọi tăng/giảm tồn phải đi qua phiếu nhập, xuất, chuyển, trả hoặc kiểm kho để còn mã chứng từ, người thực hiện và lịch sử.', 'Every stock change must come from a receipt, issue, transfer, return or stocktake so the document, operator and audit trail remain intact.', '所有库存增减必须通过入库、出库、调拨、退货或盘点单完成，以保留单号、操作人和审计记录。')
        ]),
        sec('daily', L('2. Trình tự vận hành mỗi ngày', '2. Daily operating sequence', '2. 每日营业顺序'), [
          steps(
            ['Thu ngân mở ca và nhập tiền đầu ca.', 'Kho nhận hàng, kiểm số lượng/lô/HSD rồi hoàn thành phiếu.', 'Retail tạo giỏ bằng quét mã; F&B chọn bàn, thêm món và **Gửi bếp**.', 'Đơn khách gọi trên Tablet/BYOD phải được nhân viên mở chuông đơn chờ, đọc lại và xác nhận trước khi xuống bếp.', 'Kiểm tra khách hàng, giảm giá, ghi chú; đối chiếu số phải thu rồi thanh toán.', 'Xuất hóa đơn điện tử khi khách yêu cầu hoặc khi hồ sơ khách được đặt tự động.', 'Cuối ca đối chiếu tiền mặt, chuyển khoản, hoàn/huỷ và đóng ca.'],
            ['The cashier opens a shift and records opening cash.', 'Warehouse staff receive goods, verify quantity/lot/expiry, then complete the document.', 'Retail builds a cart by barcode; F&B selects a table, adds items and taps **Send to kitchen**.', 'Tablet/BYOD orders must be read back and accepted by staff from the pending-order bell before routing to production.', 'Confirm customer, discounts and notes; verify amount due, then take payment.', 'Issue an e-invoice when requested or when the customer profile is configured for automatic invoicing.', 'Reconcile cash, transfers, refunds and cancellations, then close the shift.'],
            ['收银员开班并录入备用金。', '仓库收货，核对数量、批次和效期后完成单据。', '零售通过条码建立购物车；餐饮选择桌台、加菜并点击 **发送厨房**。', '顾客通过平板/自带设备 (BYOD) 下单后，员工必须在待确认铃铛中复述并确认，之后才会进入制作。', '确认客户、折扣和备注，核对应收金额后收款。', '客户要求或客户档案设为自动开票时开具电子发票。', '班末核对现金、转账、退款和取消记录后结班。']
          )
        ]),
        sec('success', L('3. Tiêu chí hoàn tất', '3. Completion checklist', '3. 完成检查'), [
          bullets(['Đúng chi nhánh và kho.', 'Có ca đang mở trước khi thu tiền.', 'Không còn đơn Tablet/BYOD chờ xác nhận.', 'Tổng thanh toán khớp bill; hóa đơn và phiếu in có mã tham chiếu.', 'Chứng từ kho có người tạo, lý do và trạng thái hoàn thành.'], ['Correct branch and warehouse.', 'A shift is open before collection.', 'No Tablet/BYOD order remains pending.', 'Tender equals bill total; invoice and print jobs have references.', 'Inventory documents have an operator, reason and completed state.'], ['门店与仓库正确。', '收款前已开班。', '没有未确认的平板/自带设备 (BYOD) 订单。', '实收与账单一致；发票和打印任务有参考号。', '库存单据包含操作人、原因及完成状态。'], true)
        ])
      ]
    },
    {
      id: 'warehouse-products', group: 'warehouse', order: 1,
      paths: L('kho/tao-hang-hoa', 'warehouse/create-products', 'warehouse/create-products'),
      title: L('Tạo hàng hóa, nguyên liệu và đơn vị quy đổi', 'Create products, ingredients and units', '创建商品、原料与换算单位'),
      summary: L('Khai báo đúng mã hàng, giá/VAT, lô–HSD và quy cách thùng/lốc.', 'Configure codes, price/VAT, lot-expiry tracking and case-pack units.', '设置货号、价格/税率、批次效期及箱/组换算。'), minutes: 10,
      sections: [
        sec('choose', L('1. Chọn đúng loại mặt hàng', '1. Choose the correct item type', '1. 选择正确商品类型'), [
          p('Vào **Kho → Tồn kho → Tạo mới**. Kho bán lẻ tạo **Hàng hóa**; kho F&B tạo **Nguyên liệu** hoặc **Vật dụng**. Loại hàng quyết định nơi hiển thị và cách trừ kho.', 'Open **Warehouse → Stock → Create**. A retail warehouse creates a **Product**; an F&B warehouse creates an **Ingredient** or **Supply**. The type controls visibility and stock consumption.', '进入 **仓库 → 库存 → 新建**。零售仓创建 **商品**；餐饮仓创建 **原料** 或 **用品**。类型决定显示位置和扣库方式。'),
          image('warehouse-01-create-menu.png', 'Nút Tạo mới và lựa chọn loại mặt hàng', 'Create menu and item types', '新建菜单与商品类型')
        ]),
        sec('fields', L('2. Nhập thông tin hàng hóa', '2. Enter product information', '2. 填写商品信息'), [
          steps(
            ['Nhập **Tên hàng**, **Mã hàng** duy nhất và mã vạch nếu có. Chọn nhóm hàng/thương hiệu để lọc báo cáo.', 'Chọn đơn vị gốc (cái, chai, kg…), giá vốn tham khảo, định mức tồn tối thiểu.', 'Với Retail, nhập giá bán, VAT và xác định giá đã gồm VAT hay chưa. Kiểm tra giá trước và sau thuế hệ thống hiển thị.', 'Bật **Quản lý theo lô** nếu cần truy xuất lô; bật **Bắt buộc hạn sử dụng** cho thực phẩm/dược phẩm cần kiểm soát HSD.', 'Thêm ảnh và nội dung giới thiệu cho màn hình khách nếu cần.'],
            ['Enter a unique **Product name**, **Item code**, and barcode when available. Select category/brand for filtering and reports.', 'Choose the base unit (piece, bottle, kg…), reference cost and minimum stock.', 'For Retail, enter selling price, VAT and whether the entered price includes VAT. Verify the displayed pre-tax and tax-inclusive price.', 'Enable **Lot tracking** when traceability is required; enable **Expiry required** for expiry-controlled goods.', 'Add an image and customer-facing description when needed.'],
            ['填写唯一的 **商品名称**、**货号**，有条码时录入条码。选择分类/品牌便于筛选和报表。', '选择基本单位（件、瓶、公斤等）、参考成本和最低库存。', '零售商品填写售价、增值税率，并确认录入价格是否含税；核对系统显示的税前/税后价。', '需要追溯时开启 **批次管理**；需控效期的食品/药品开启 **必须填写有效期**。', '如需在顾客端展示，可添加图片和商品介绍。']
          ),
          image('warehouse-02-product-form.png', 'Biểu mẫu Thông tin hàng hóa, VAT và quản lý lô', 'Product, VAT and lot tracking form', '商品、税率与批次管理表单')
        ]),
        sec('units', L('3. Thêm đơn vị quy đổi', '3. Add conversion units', '3. 添加换算单位'), [
          p('Trong **Biến thể / đơn vị quy đổi**, mỗi hệ số là số đơn vị gốc chứa trong một đơn vị bán. Ví dụ: đơn vị gốc là Chai; Lốc = 6; Thùng = 24. Tên đơn vị không được trùng và hệ số phải lớn hơn 0.', 'Under **Variants / conversion units**, each factor is the number of base units in one selling unit. Example: base Bottle; Pack = 6; Case = 24. Unit names must be unique and factors greater than zero.', '在 **规格/换算单位** 中，换算系数表示一个销售单位包含多少基本单位。例如：基本单位为“瓶”；“组”=6；“箱”=24。单位名称不可重复，系数必须大于0。'),
          image('warehouse-03-conversion-units.png', 'Đơn vị gốc và các đơn vị quy đổi', 'Base and conversion units', '基本单位与换算单位'),
          callout('warn', L('Lưu ý', 'Important', '注意'), 'Không nhập tồn đầu ngay trong form hàng hóa. Hãy lưu mặt hàng rồi dùng **Nhập hàng** hoặc **Kiểm kho** để hệ thống tạo chứng từ và lịch sử lô.', 'Do not type opening stock in the product form. Save the item, then use **Receiving** or **Stocktake** to create a document and lot history.', '不要在商品表单中直接录入期初库存。保存商品后，请使用 **入库** 或 **盘点** 建立单据与批次记录。')
        ]),
        sec('save', L('4. Lưu và kiểm tra', '4. Save and verify', '4. 保存并检查'), [
          bullets(['Lưu sản phẩm và tìm lại bằng mã, tên hoặc mã vạch.', 'Mở chi tiết để kiểm tra kho, tồn, giá/VAT, nhóm hàng và ngày tạo.', 'Dùng **In tem mã** để chọn số tem và gửi tới máy in tem đã cấu hình.'], ['Save, then find the product by code, name or barcode.', 'Open details and verify warehouse, stock, price/VAT, category and creation date.', 'Use **Print barcode labels** to choose copies and route them to the configured label printer.'], ['保存后通过货号、名称或条码查找商品。', '打开详情检查仓库、库存、价格/税率、分类和创建日期。', '使用 **打印条码标签** 选择份数并发送到已设置的标签打印机。'], true)
        ])
      ]
    },
    {
      id: 'warehouse-receive', group: 'warehouse', order: 2,
      paths: L('kho/nhap-hang', 'warehouse/receive-stock', 'warehouse/receive-stock'),
      title: L('Nhập hàng và quản lý nhà cung cấp', 'Receive stock and manage suppliers', '商品入库与供应商管理'),
      summary: L('Tạo phiếu nhập đúng kho, giá vốn, lô/HSD và chứng từ mua hàng.', 'Post receipts with the correct warehouse, cost, lot/expiry and supplier reference.', '按正确仓库、成本、批次效期和供应商凭证办理入库。'), minutes: 9,
      sections: [
        sec('prepare', L('1. Chuẩn bị nhận hàng', '1. Prepare the receipt', '1. 入库前准备'), [
          bullets(['Hàng hóa/nguyên liệu đã tồn tại và đúng đơn vị.', 'Nhà cung cấp đã được tạo trong **Kho → Nhà cung cấp**.', 'Có hóa đơn/phiếu giao hàng để đối chiếu mã, số lượng, đơn giá, lô và HSD.', 'Đang chọn đúng chi nhánh và kho nhận.'], ['The product/ingredient exists with the correct unit.', 'The supplier exists under **Warehouse → Suppliers**.', 'A supplier invoice/delivery note is available to verify code, quantity, unit cost, lot and expiry.', 'The correct branch and receiving warehouse are selected.'], ['商品/原料已建立且单位正确。', '供应商已在 **仓库 → 供应商** 中建立。', '准备供应商发票/送货单以核对货号、数量、单价、批次和效期。', '已选择正确门店和收货仓。'], true),
          image('warehouse-04-supplier-list.png', 'Chọn loại đối tác Nhà cung cấp trong màn hình Khách hàng/Đối tác', 'Select the Supplier partner type on the Contacts screen', '在客户/合作伙伴页面选择供应商类型')
        ]),
        sec('receive', L('2. Lập phiếu nhập', '2. Create the receipt', '2. 创建入库单'), [
          steps(
            ['Vào **Kho → Nhập hàng**, nhấn **+ Nhập hàng** và chọn kho nhận.', 'Chọn nhà cung cấp, nhập mã chứng từ/tham chiếu và ghi chú nếu có.', 'Tìm hàng theo mã/tên hoặc quét mã; nhập số lượng thực nhận và giá vốn theo đơn vị.', 'Với hàng quản lý lô, nhập chính xác **Số lô** và **Hạn dùng**. Không gộp hai lô/HSD khác nhau vào cùng một dòng.', 'Đối chiếu tổng số mặt hàng, tổng số lượng và giá trị; nhấn **Hoàn thành**.'],
            ['Open **Warehouse → Receiving**, select **+ Receive stock**, and choose the destination warehouse.', 'Select supplier and enter the external reference/document code plus notes.', 'Find by name/code or scan; enter actual received quantity and unit cost.', 'For lot-controlled goods, enter the exact **Lot number** and **Expiry date**. Do not combine different lots/expiries on one line.', 'Review item count, total quantity and value, then tap **Complete**.'],
            ['进入 **仓库 → 入库**，点击 **+ 入库** 并选择收货仓。', '选择供应商，填写外部单据/参考号及备注。', '按名称/货号搜索或扫码，填写实收数量和单位成本。', '批次商品必须准确填写 **批号** 与 **有效期**；不同批次/效期不可合并为一行。', '核对商品种数、总数量和金额后点击 **完成**。']
          ),
          image('warehouse-05-goods-receipt.png', 'Danh sách phiếu nhập và nút + Nhập hàng', 'Receipt list and the + Receive stock button', '入库单列表与“+ 入库”按钮'),
          image('warehouse-06-quick-receive.png', 'Phiếu nhập đang lập: hàng hóa, đơn vị, số lượng, giá, lô, NSX và HSD', 'Draft receipt with item, unit, quantity, cost, lot, manufacture and expiry dates', '入库草稿：商品、单位、数量、成本、批次、生产日期与有效期'),
          callout('important', L('Chỉ ghi nhận số thực nhận', 'Post actual quantity only', '仅按实收数量入库'), 'Nếu giao thiếu/thừa, nhập số thực tế và ghi chênh lệch trong ghi chú/chứng từ. Không sửa tồn sau đó để “khớp giấy”.', 'If delivery differs, post the actual quantity and record the variance in notes. Never alter stock later merely to match paperwork.', '如交货有短溢，应按实收数量入库并在备注中记录差异；不要事后直接改库存来“对纸”。')
        ]),
        sec('quick', L('3. Nhập nhanh từ chi tiết mặt hàng', '3. Quick receipt from item details', '3. 从商品详情快速入库'), [
          p('Tại **Kho → Tồn kho**, mở mặt hàng và chọn **Nhập**. Nhập số lượng; nếu theo lô, bổ sung số lô/HSD, giá vốn và nhà cung cấp. Cách này phù hợp cho một mặt hàng; phiếu mua nhiều dòng nên dùng màn **Nhập hàng**.', 'From **Warehouse → Stock**, open an item and choose **Receive**. Enter quantity plus lot/expiry, cost and supplier when applicable. Use this for a single item; use the full **Receiving** page for multi-line purchases.', '在 **仓库 → 库存** 打开商品并选择 **入库**。填写数量；需要时补充批号/效期、成本及供应商。此方式适合单品，多品采购应使用完整 **入库** 页面。')
        ])
      ]
    },
    {
      id: 'warehouse-stocktake', group: 'warehouse', order: 3,
      paths: L('kho/kiem-kho', 'warehouse/stocktake', 'warehouse/stocktake'),
      title: L('Kiểm kho và cân bằng tồn', 'Stocktake and reconcile inventory', '库存盘点与平衡'),
      summary: L('Đếm thực tế, lưu tạm, xử lý chênh lệch và tạo bút toán cân bằng có kiểm soát.', 'Count, save drafts, review variances and post controlled adjustments.', '实盘、暂存、复核差异并受控生成库存调整。'), minutes: 10,
      sections: [
        sec('count', L('1. Tạo phiếu kiểm', '1. Create a stocktake', '1. 创建盘点单'), [
          image('warehouse-07-stocktake-form.png', 'Danh sách phiếu kiểm và nút + Kiểm kho', 'Stocktake list and the + Stocktake button', '盘点单列表与“+ 盘点”按钮'),
          steps(
            ['Vào **Kho → Kiểm kho**, nhấn **+ Kiểm kho** và chọn kho kiểm.', 'Tìm hàng bằng mã/tên hoặc F3. Có thể chọn file dữ liệu hoặc dán bảng Excel theo mẫu.', 'Nhập **SL thực tế**. Với hàng theo lô, đếm riêng từng lô và ghi HSD tương ứng.', 'Theo dõi cột **Tồn kho**, **Thực tế** và **Lệch**. Số dương là tăng; số âm là thiếu.', 'Chọn **Lưu tạm & thoát** nếu chưa đếm xong; không bấm Hoàn thành giữa chừng.'],
            ['Open **Warehouse → Stocktake**, tap **+ Stocktake**, and select the warehouse.', 'Find products by code/name or F3. You may load a data file or paste the Excel template.', 'Enter **Counted quantity**. For lot-controlled goods, count each lot separately with its expiry.', 'Review **System stock**, **Counted** and **Variance**. Positive means an increase; negative means a shortage.', 'Choose **Save draft & exit** when counting is incomplete; do not complete midway.'],
            ['进入 **仓库 → 盘点**，点击 **+ 盘点** 并选择仓库。', '按货号/名称或F3查找；也可导入数据文件或粘贴Excel模板。', '填写 **实盘数量**。批次商品需按批次分别盘点并填写对应效期。', '查看 **账面库存**、**实盘** 和 **差异**；正数为盘盈，负数为盘亏。', '未盘完时选择 **保存草稿并退出**，不要中途完成。']
          ),
          image('warehouse-08-stocktake-approve.png', 'Phiếu kiểm đang nhập với tồn hệ thống, SL thực tế và chênh lệch', 'Draft stocktake with system stock, counted quantity and variance', '盘点草稿：账面库存、实盘数量与差异')
        ]),
        sec('approve', L('2. Cân bằng kho', '2. Reconcile stock', '2. 库存平衡'), [
          p('Mở lại phiếu tạm, đối chiếu các dòng lệch lớn, kiểm tra nhầm đơn vị/lô và đếm lại. Khi chắc chắn, chọn **Cân bằng kho**. Hệ thống tạo chuyển động điều chỉnh cho từng chênh lệch; phiếu chuyển sang **Đã cân bằng kho**.', 'Reopen the draft, investigate large variances, check unit/lot mistakes and recount. When verified, choose **Reconcile stock**. The system posts an adjustment movement per variance and changes the document to **Reconciled**.', '重新打开草稿，复核大额差异、单位/批次错误并重盘。确认后选择 **库存平衡**；系统为每项差异生成调整流水，单据状态变为 **已平衡**。'),
          callout('important', L('Quyền nhạy cảm', 'Sensitive permission', '敏感权限'), 'Cân bằng kho làm thay đổi tồn và phải do người có quyền thực hiện. Không dùng kiểm kho để che sai sót nhập/xuất; hãy sửa bằng chứng từ đúng loại và ghi lý do.', 'Reconciliation changes on-hand stock and requires the proper permission. Do not use a stocktake to hide receipt/issue errors; post the correct document with a reason.', '库存平衡会改变现存量，必须由有权限人员执行。不要用盘点掩盖出入库错误；应使用正确单据并注明原因。')
        ]),
        sec('excel', L('3. Dùng Excel an toàn', '3. Use Excel safely', '3. 安全使用Excel'), [
          bullets(['Mẫu cột: Mã hàng | Số lượng | Lô 1 | HSD 1 | Số lượng 1 | Lô 2…', 'Mã không tìm thấy phải được xử lý trước khi hoàn thành.', 'Giữ nguyên số 0 với mặt hàng đã kiểm nhưng thực tế hết; để trống nghĩa là chưa đếm.', 'Lưu file gốc làm biên bản đối chiếu.'], ['Columns: Item code | Quantity | Lot 1 | Expiry 1 | Quantity 1 | Lot 2…', 'Resolve unmatched codes before completion.', 'Keep zero for items counted as none; blank means not counted.', 'Retain the source file as reconciliation evidence.'], ['列格式：货号 | 数量 | 批次1 | 效期1 | 数量1 | 批次2…', '完成前处理所有未匹配货号。', '实盘为零应明确填0；留空表示尚未盘点。', '保留原始文件作为对账依据。'], true)
        ])
      ]
    },
    {
      id: 'warehouse-movements', group: 'warehouse', order: 4,
      paths: L('kho/chuyen-xuat-tra-hang', 'warehouse/transfers-issues-returns', 'warehouse/transfers-issues-returns'),
      title: L('Chuyển kho, xuất nội bộ và trả hàng nhập', 'Transfers, internal issues and purchase returns', '调拨、内部领用与采购退货'),
      summary: L('Chọn đúng nghiệp vụ để tồn và giá trị đi đúng nơi, có lý do và chứng từ.', 'Choose the correct operation so stock and value move with full references.', '选择正确业务，让库存与金额准确流转并保留凭证。'), minutes: 11,
      sections: [
        sec('transfer', L('1. Chuyển hàng giữa kho', '1. Transfer between warehouses', '1. 仓库调拨'), [
          image('warehouse-09-transfer-form.png', 'Danh sách Chuyển hàng và nút + Chuyển hàng', 'Transfer list and the + Transfer button', '调拨列表与“+ 调拨”按钮'),
          steps(
            ['Vào **Kho → Chuyển hàng → + Chuyển hàng**.', 'Chọn **Từ kho** và **Tới kho**; hai kho phải khác nhau.', 'Thêm hàng, nhập số lượng chuyển; hệ thống cảnh báo nếu vượt tồn.', 'Với hàng lô/HSD, chọn đúng lô xuất. Kiểm tra tổng dòng và tổng số lượng.', 'Hoàn thành để tạo đồng thời chuyển đi ở kho nguồn và chuyển đến ở kho đích.'],
            ['Open **Warehouse → Transfers → + Transfer**.', 'Select **From warehouse** and **To warehouse**; they must differ.', 'Add items and quantities; the system flags quantities above available stock.', 'For lot/expiry goods, choose the correct outgoing lot. Review lines and total quantity.', 'Complete to post transfer-out at source and transfer-in at destination.'],
            ['进入 **仓库 → 调拨 → + 调拨**。', '选择 **调出仓** 与 **调入仓**，两者必须不同。', '添加商品与调拨数量；超出可用库存时系统会警告。', '批次商品选择正确的出库批次，核对行数和总数量。', '完成后同时生成源仓调出与目标仓调入记录。']
          )
        ]),
        sec('internal', L('2. Xuất dùng nội bộ', '2. Internal consumption', '2. 内部领用'), [
          p('Dùng **Xuất nội bộ** cho hàng lấy khỏi kho nhưng không bán: dùng thử, văn phòng, bếp sử dụng không qua recipe, hư hỏng đã được duyệt… Chọn kho xuất, hàng/lô, số lượng và ghi lý do đủ rõ để đối soát. Không dùng nghiệp vụ này cho bán Retail.', 'Use **Internal issue** for stock leaving inventory without a sale: samples, office use, non-recipe kitchen consumption, approved damage, etc. Select warehouse, item/lot, quantity and a clear reason. Never use this operation for a Retail sale.', '商品离库但非销售时使用 **内部领用**：试用品、办公使用、未走配方的厨房耗用、已批准损坏等。选择仓库、商品/批次、数量并写明原因；零售销售不可使用此业务。'),
          image('warehouse-10-internal-issue.png', 'Phiếu xuất dùng nội bộ và lý do', 'Internal issue and reason', '内部领用单与原因')
        ]),
        sec('return', L('3. Trả hàng cho nhà cung cấp', '3. Return to supplier', '3. 退还供应商'), [
          steps(
            ['Vào **Kho → Trả hàng nhập**, tạo phiếu mới.', 'Chọn nhà cung cấp và kho xuất trả.', 'Chọn đúng hàng, đơn vị, lô/HSD và số lượng thực trả; nhập đơn giá/giá trị theo chứng từ.', 'Ghi số hóa đơn/phiếu nhập gốc và lý do: lỗi, cận date, giao sai…', 'Hoàn thành và đối chiếu công nợ/phiếu chi theo quy trình kế toán.'],
            ['Open **Warehouse → Purchase returns** and create a return.', 'Select supplier and issuing warehouse.', 'Choose the exact item, unit, lot/expiry and actual return quantity; enter document value/cost.', 'Reference the original supplier invoice/receipt and reason: defect, short expiry, wrong delivery, etc.', 'Complete, then reconcile supplier balance/cash-out according to accounting policy.'],
            ['进入 **仓库 → 采购退货** 新建退货单。', '选择供应商及退货出库仓。', '选择准确商品、单位、批次/效期和实退数量，并按凭证填写成本/金额。', '填写原供应商发票/入库单号及原因：质量问题、临期、错发等。', '完成后按财务流程核对供应商往来及付款。']
          ),
          image('warehouse-11-purchase-return.png', 'Phiếu trả hàng nhập mới: kho xuất, nhà cung cấp, hàng hóa và số tiền hoàn', 'New purchase return: issuing warehouse, supplier, items and refund amount', '新采购退货单：出库仓、供应商、商品与应退金额')
        ])
      ]
    },
    {
      id: 'warehouse-lots-prices-history', group: 'warehouse', order: 5,
      paths: L('kho/lo-han-dung-gia-lich-su', 'warehouse/lots-pricing-history', 'warehouse/lots-pricing-history'),
      title: L('Lô, hạn dùng, bảng giá và lịch sử kho', 'Lots, expiry, price books and stock history', '批次、效期、价目表与库存历史'),
      summary: L('Tra cứu tồn theo lô, cảnh báo HSD, thiết lập giá và kiểm toán mọi chuyển động.', 'Trace lot balances, expiry, price books and every inventory movement.', '追踪批次库存、效期、价目表及全部库存流水。'), minutes: 8,
      sections: [
        sec('lots', L('1. Lô và hạn sử dụng', '1. Lots and expiry', '1. 批次与有效期'), [
          p('Mở **Kho → Lô & HSD** để xem số lô, HSD, ngày nhập, số lượng còn, giá vốn, nhà cung cấp và kho. Ưu tiên xử lý lô sắp hết hạn; mọi xuất/điều chuyển phải chọn đúng lô để số lượng từng lô không âm.', 'Open **Warehouse → Lots & expiry** to review lot number, expiry, received date, balance, unit cost, supplier and warehouse. Prioritize near-expiry lots and always select the correct lot on issue/transfer to prevent negative lot balances.', '打开 **仓库 → 批次与效期** 查看批号、效期、入库日、剩余量、成本、供应商和仓库。优先处理临期批次；出库/调拨必须选择正确批次，避免批次数量为负。'),
          image('warehouse-12-lot-expiry.png', 'Danh sách lô và số ngày còn lại', 'Lot list and days remaining', '批次列表与剩余天数')
        ]),
        sec('price', L('2. Thiết lập giá', '2. Configure prices', '2. 设置价格'), [
          steps(
            ['Vào **Kho → Thiết lập giá**, chọn bảng giá chung hoặc bảng giá theo kênh/nhóm khách.', 'Lọc theo nhóm hàng, tồn kho hoặc điều kiện giá so với giá vốn/giá nhập cuối.', 'Mở mặt hàng, nhập giá bán và VAT; xác định giá đã gồm VAT. Để trống giá ở bảng phụ nếu muốn kế thừa giá chung.', 'Lưu và thử bán một đơn nháp đúng kênh để kiểm tra giá được lấy.'],
            ['Open **Warehouse → Price setup** and select the default or a channel/customer price book.', 'Filter by category, stock condition, or selling price versus cost/latest purchase cost.', 'Open an item, enter selling price and VAT, and specify tax inclusion. Leave a secondary price blank to inherit the default.', 'Save and build a draft sale in the target channel to verify price resolution.'],
            ['进入 **仓库 → 价格设置**，选择通用价目表或渠道/客户价目表。', '按分类、库存状态或售价与成本/最近进价关系筛选。', '打开商品填写售价与税率，并指定是否含税；附属价目表留空表示继承通用价。', '保存后在目标渠道建立测试草稿，确认取价正确。']
          ),
          image('warehouse-13-price-book.png', 'Bảng giá, VAT và bộ lọc giá', 'Price book, VAT and price filters', '价目表、税率与价格筛选')
        ]),
        sec('history', L('3. Lịch sử và phiếu kho', '3. History and inventory documents', '3. 库存历史与单据'), [
          p('Tab **Lịch sử** cho biết loại chuyển động như bán Retail, trừ recipe, nhập, kiểm kho, trả hàng, xuất, chuyển đi/đến. Tab **Phiếu kho** gom chứng từ nhập tồn đầu, nhập/xuất, chuyển, điều chỉnh kiểm kê, xuất nội bộ và trả hàng nhập. Khi điều tra chênh lệch, lọc theo mã hàng + kho + thời gian rồi mở chứng từ tham chiếu.', 'The **History** tab shows Retail sale, recipe consumption, receipt, stocktake, return, issue and transfer movements. **Inventory documents** lists opening/receipts/issues, transfers, stocktake adjustments, internal issues and purchase returns. To investigate a variance, filter by item + warehouse + period and open the reference document.', '**历史** 标签显示零售销售、配方耗用、入库、盘点、退货、出库和调拨流水；**库存单据** 汇总期初、出入库、调拨、盘点调整、内部领用与采购退货。调查差异时按商品+仓库+时间筛选并打开参考单据。'),
          image('warehouse-14-stock-history.png', 'Tab Lịch sử kho; dữ liệu sẽ xuất hiện sau khi phát sinh nhập, xuất, bán hoặc kiểm kho', 'Stock history tab; entries appear after receipts, issues, sales or stocktakes', '库存历史标签；发生入库、出库、销售或盘点后会显示记录'),
          callout('note', L('Cách đối soát', 'Reconciliation tip', '对账提示'), 'Tồn hiện tại = tồn đầu + toàn bộ tăng − toàn bộ giảm. Nếu sai, tìm chuyển động đầu tiên làm số dư lệch; không tạo một phiếu điều chỉnh mới trước khi biết nguyên nhân.', 'Current stock = opening + all inbound − all outbound. Find the first movement that makes the running balance diverge; do not post a new adjustment before identifying the cause.', '当前库存=期初+全部入库−全部出库。应找到首次导致余额偏差的流水；未查明原因前不要新建调整单。')
        ])
      ]
    },
    {
      id: 'retail-sale', group: 'retail', order: 1,
      paths: L('ban-le/quy-trinh-ban-hang', 'retail/sales-flow', 'retail/sales-flow'),
      title: L('Quy trình bán hàng Retail', 'Retail sales workflow', '零售销售流程'),
      summary: L('Từ quét mã, chọn khách, kiểm tra giỏ đến thanh toán và in hóa đơn.', 'From barcode scanning and customer selection to payment and receipt.', '从扫码、选择客户、核对购物车到支付与打印。'), minutes: 9,
      sections: [
        sec('cart', L('1. Tạo giỏ hàng', '1. Build the cart', '1. 建立购物车'), [
          steps(
            ['Mở **Bán lẻ** và bảo đảm đúng chi nhánh/kho, ca thu ngân đang mở.', 'Quét mã vạch hoặc tìm theo mã/tên. Chọn đúng đơn vị bán và lô nếu hệ thống yêu cầu.', 'Điều chỉnh số lượng; mở từng dòng để thêm ghi chú hoặc chọn CTKM cho sản phẩm.', 'Chọn khách hàng bằng tên/SĐT/MST hoặc tạo khách mới. Ưu đãi hồ sơ khách sẽ được tính trong bản xem trước.', 'Kiểm tra tồn, giá, VAT, tạm tính, giảm giá và tổng phải thu trên giỏ.'],
            ['Open **Retail** and verify branch/warehouse and that the cashier shift is open.', 'Scan a barcode or search by code/name. Select the correct selling unit and lot when requested.', 'Adjust quantity; open a line to add a note or select an item promotion.', 'Find the customer by name/phone/tax code or create one. Profile benefits are included in the preview.', 'Verify stock, price, VAT, subtotal, discounts and amount due.'],
            ['打开 **零售**，确认门店/仓库正确且收银班次已开启。', '扫描条码或按货号/名称搜索；系统要求时选择正确销售单位与批次。', '调整数量；打开商品行添加备注或选择单品促销。', '按姓名/电话/税号选择客户或新建客户；客户权益会计入预览。', '核对库存、价格、税额、小计、折扣和应收金额。']
          ),
          image('retail-01-cart.png', 'Màn hình bán lẻ với ô quét/tìm và giỏ hàng', 'Retail search/scan and cart', '零售扫码/搜索与购物车')
        ]),
        sec('check', L('2. Kiểm tra trước thanh toán', '2. Pre-payment checks', '2. 收款前检查'), [
          bullets(['Đúng khách hàng hoặc “Bán cho người tiêu dùng”.', 'Không có dòng sai số lượng, đơn vị, lô hoặc giá.', 'Ghi chú đổi/trả, giao hàng hoặc yêu cầu đặc biệt đã được lưu.', 'Giảm giá item, CTKM bill và giảm thủ công không bị áp trùng.', 'Tổng phải thu trên màn khách trùng màn thu ngân.'], ['Correct customer or “Consumer sale”.', 'No incorrect quantity, unit, lot or price.', 'Return/delivery/special notes are saved.', 'Item promotion, bill promotion and manual discount are not duplicated.', 'Customer display amount matches cashier amount.'], ['客户正确或选择“消费者销售”。', '数量、单位、批次和价格均无误。', '退换、配送或特殊要求备注已保存。', '单品促销、整单促销与手工折扣没有重复。', '客显应收金额与收银端一致。'], true),
          image('retail-02-customer-total.png', 'Khách hàng, giảm giá và tổng thanh toán', 'Customer, discounts and total', '客户、折扣与应收总额')
        ]),
        sec('complete', L('3. Hoàn tất bán hàng', '3. Complete the sale', '3. 完成销售'), [
          p('Nhấn **Thanh toán**, chọn một hoặc nhiều phương thức, kiểm tra tiền khách đưa/tiền thừa hoặc giao dịch chuyển khoản. Sau khi hệ thống báo thành công mới giao hàng và in/gửi hóa đơn. Không bấm lặp nếu màn hình đang xử lý.', 'Tap **Payment**, select one or more tenders, verify cash received/change or bank confirmation. Hand over goods and print/share the receipt only after success is confirmed. Do not tap repeatedly while processing.', '点击 **支付**，选择一种或多种方式，核对收款/找零或转账确认。仅在系统提示成功后交货并打印/发送小票；处理中不要重复点击。'),
          image('retail-03-checkout.png', 'Hộp thoại thanh toán Retail', 'Retail checkout dialog', '零售支付窗口')
        ])
      ]
    },
    {
      id: 'retail-discounts-notes', group: 'retail', order: 2,
      paths: L('ban-le/giam-gia-ghi-chu-tra-hang', 'retail/discounts-notes-returns', 'retail/discounts-notes-returns'),
      title: L('Giảm giá item, giảm bill, ghi chú và trả hàng Retail', 'Retail item/bill discounts, notes and returns', '零售单品/整单折扣、备注与退货'),
      summary: L('Phân biệt đúng từng loại giảm giá và giữ đầy đủ dấu vết khi trả hàng.', 'Apply each discount at the right level and retain a complete return trail.', '正确区分折扣层级，并在退货时保留完整记录。'), minutes: 10,
      sections: [
        sec('discount', L('1. Giảm giá đúng cấp', '1. Discount at the right level', '1. 在正确层级打折'), [
          steps(
            ['**CTKM item:** mở dòng sản phẩm → chọn chương trình phù hợp. Chỉ ảnh hưởng dòng/sku đủ điều kiện.', '**Chỉnh giá/giảm trực tiếp item:** nhập giá bán mới cho dòng; có thể cần PIN người có quyền. Ghi lý do theo quy định.', '**CTKM cả bill:** chọn chương trình ở khu vực tổng đơn; hệ thống kiểm tra thời gian, khách, mức tối thiểu và phạm vi.', '**Giảm thủ công bill:** nhập số tiền giảm ở tổng đơn. Kiểm tra số giảm không vượt tổng hợp lệ.', 'Đọc bản xem trước để biết dòng nào được giảm, tổng giảm và tổng phải thu trước khi thanh toán.'],
            ['**Item promotion:** open the product line and choose an eligible promotion. It affects only eligible lines/SKUs.', '**Direct item price override:** enter the new unit price; an authorized PIN may be required. Record the reason.', '**Bill promotion:** choose a promotion in the order summary. Time, customer, threshold and scope are validated.', '**Manual bill discount:** enter the amount in the order summary and ensure it does not exceed the eligible total.', 'Read the preview showing affected lines, total discount and amount due before payment.'],
            ['**单品促销：** 打开商品行并选择符合条件的促销，仅影响符合范围的行/SKU。', '**直接改单品价格：** 输入新单价，可能需要授权PIN，并按规定记录原因。', '**整单促销：** 在订单汇总区选择；系统校验时间、客户、门槛与适用范围。', '**手工整单折扣：** 在汇总区输入折扣金额，不得超过可折金额。', '付款前查看预览，确认受影响商品、总折扣和应收金额。']
          ),
          image('retail-04-item-promotion.png', 'CTKM/giảm giá trên một dòng hàng', 'Item-level promotion/discount', '单品促销/折扣'),
          image('retail-05-bill-discount.png', 'CTKM và giảm thủ công trên cả bill', 'Bill promotion and manual discount', '整单促销与手工折扣'),
          callout('important', L('Không cộng tay', 'Do not calculate off-system', '不要线下手算'), 'Không tự trừ tiền ngoài hệ thống. Mọi ưu đãi phải xuất hiện trong bản xem trước và hóa đơn để doanh thu, VAT, tồn kho và hoàn trả khớp nhau.', 'Never subtract an off-system amount. Every benefit must appear in the preview and receipt so revenue, VAT, stock and refunds reconcile.', '不要在系统外自行减价。所有优惠必须出现在预览和小票中，确保收入、税额、库存及退款一致。')
        ]),
        sec('notes', L('2. Ghi chú item và ghi chú bill', '2. Item and bill notes', '2. 单品备注与整单备注'), [
          p('**Ghi chú item** dùng cho thông tin gắn với đúng sản phẩm: quà tặng, lỗi bao bì, màu khách chọn, yêu cầu giao… **Ghi chú bill** dùng cho toàn giao dịch: mã đơn ngoài, giờ giao, người nhận, thỏa thuận đổi trả. Ghi cụ thể, tránh chỉ viết “đặc biệt” hoặc “như cũ”.', '**Item notes** belong to one product: gift wrap, damaged packaging, chosen color, delivery handling. **Bill notes** apply to the transaction: external order ID, delivery time, recipient or return agreement. Be specific; avoid vague notes such as “special” or “same as before”.', '**单品备注** 用于特定商品：礼品包装、包装瑕疵、颜色、配送要求等；**整单备注** 用于整笔交易：外部订单号、送达时间、收货人或退换约定。应具体清晰，避免只写“特殊”或“照旧”。'),
          image('retail-06-notes.png', 'Vị trí ghi chú item và ghi chú bill', 'Item-note and bill-note locations', '单品备注与整单备注位置')
        ]),
        sec('returns', L('3. Trả hàng theo hóa đơn', '3. Return against a receipt', '3. 按原单退货'), [
          steps(
            ['Mở **Lịch sử/Hóa đơn**, tìm hóa đơn gốc bằng mã, thời gian, khách hoặc hàng hóa.', 'Chọn **Trả hàng**, đánh dấu đúng dòng và số lượng thực nhận lại; kiểm tra lô/serial nếu áp dụng.', 'Nhập lý do; xác định hàng trở lại tồn bán được hay cần xử lý theo quy trình nội bộ.', 'Kiểm tra số hoàn theo giá/giảm giá của hóa đơn gốc và chọn phương thức hoàn.', 'Xác nhận, in/gửi chứng từ trả hàng và đối chiếu tiền ra trong ca.'],
            ['Open **History/Receipts** and find the original sale by code, date, customer or product.', 'Choose **Return**, select the exact lines and received quantities, and verify lot/serial when applicable.', 'Enter a reason and determine whether goods return to sellable stock or require internal handling.', 'Verify refund based on original price/discount and choose the refund method.', 'Confirm, print/share the return document and reconcile cash-out in the shift.'],
            ['打开 **历史/小票**，按单号、时间、客户或商品查找原销售。', '选择 **退货**，勾选正确商品行与实退数量；如适用核对批次/序列号。', '填写原因，并确定商品是否回到可售库存或进入内部处理。', '按原单价格/折扣核对退款金额并选择退款方式。', '确认后打印/发送退货凭证，并在班次中核对现金支出。']
          ),
          image('retail-07-return.png', 'Chọn dòng và số lượng trả theo hóa đơn', 'Select return lines and quantities', '按原单选择退货商品与数量')
        ])
      ]
    },
    {
      id: 'fnb-sale', group: 'fnb', order: 1,
      paths: L('fnb/quy-trinh-ban-hang', 'fnb/service-flow', 'fnb/service-flow'),
      title: L('Quy trình bán hàng F&B tại POS', 'F&B service workflow at POS', '餐饮POS服务流程'),
      summary: L('Chọn bàn, thêm món/topping, ghi chú, gửi bếp, phục vụ và xử lý bill.', 'Select a table, add items/modifiers, send to production, serve and manage the bill.', '选桌、加菜/加料、备注、发送制作、上菜及账单处理。'), minutes: 12,
      sections: [
        sec('order', L('1. Nhận bàn và gọi món', '1. Seat and order', '1. 开台与点餐'), [
          steps(
            ['Mở **POS Cashier**, chọn đúng khu vực và bàn. Kiểm tra bàn trống hay đã có bill trước khi thêm món.', 'Chọn món F&B; chọn size/topping/modifier/combo đúng yêu cầu. Thêm **ghi chú món** như ít cay, không hành.', 'Với hàng Retail bán kèm, dùng **Thêm retail** và quét/chọn hàng.', 'Đọc lại món, số lượng, topping và ghi chú với khách.', 'Nhấn **Gửi bếp**. Chờ thông báo “Đã gửi món vào bếp/bar”; món mới được định tuyến đến đúng trạm.'],
            ['Open **POS Cashier**, select the area and table. Confirm whether the table is empty or has an existing bill.', 'Choose F&B items and the requested size/topping/modifier/combo. Add an **item note** such as less spicy or no onion.', 'For packaged Retail items, use **Add retail** and scan/select the SKU.', 'Read back items, quantities, modifiers and notes to the guest.', 'Tap **Send to kitchen** and wait for the success message; only then are new items routed to their stations.'],
            ['打开 **POS Cashier**，选择区域和桌台；加菜前确认桌台为空或已有账单。', '选择菜品及所需规格/加料/选项/套餐，填写 **菜品备注**（如少辣、不要葱）。', '随餐销售零售商品时使用 **添加零售** 并扫码/选择商品。', '向顾客复述菜品、数量、加料和备注。', '点击 **发送厨房** 并等待成功提示；此后新菜才会路由至对应制作台。']
          ),
          image('fnb-01-floor-table.png', 'Sơ đồ bàn và trạng thái bàn', 'Floor plan and table status', '桌台图与桌台状态'),
          image('fnb-02-item-modifier-note.png', 'Chọn topping/modifier và ghi chú món', 'Select modifiers and add an item note', '选择加料/选项并填写菜品备注')
        ]),
        sec('during', L('2. Trong quá trình phục vụ', '2. During service', '2. 服务过程中'), [
          bullets(['Theo dõi trạng thái món tại KDS: mới → nhận → đang làm → sẵn sàng → đã phục vụ.', 'Món thêm phải tạo vào đúng bàn và **Gửi bếp** lần nữa; hệ thống chỉ gửi các dòng mới.', 'Món chưa gửi có thể sửa số lượng/giá/ghi chú. Món đã gửi chỉ đổi ghi chú; muốn đổi giá phải hủy đúng quyền rồi thêm lại.', 'Hủy món đã gửi cần lý do và PIN có quyền; món đã chế biến có quyền riêng cao hơn.', 'Dùng **In tạm tính** để khách kiểm tra, không xem đó là thanh toán.'], ['Track KDS states: new → accepted → preparing → ready → served.', 'Add-ons must be placed on the same table and **Send to kitchen** again; only new lines are sent.', 'Unsent items may change quantity/price/note. Sent items allow note changes only; cancel with authorization and re-add to change price.', 'Cancelling a sent item requires a reason and authorized PIN; prepared-item cancellation is more restricted.', 'Use **Print pro-forma** for review; it is not payment.'], ['在KDS跟踪状态：新单 → 接单 → 制作中 → 已完成 → 已上菜。', '加菜必须加入同一桌并再次 **发送厨房**；系统只发送新行。', '未发送菜品可改数量/价格/备注；已发送菜品仅可改备注，改价需授权取消后重加。', '取消已发送菜品需填写原因及授权PIN；已制作菜品权限更高。', '使用 **打印预结单** 供顾客核对；预结单不代表已付款。'], true),
          image('fnb-03-kds-status.png', 'KDS và trạng thái món theo trạm', 'KDS item status by station', '各制作台KDS菜品状态')
        ]),
        sec('bill', L('3. Xử lý bàn và bill', '3. Table and bill operations', '3. 桌台与账单操作'), [
          p('**Chuyển bàn** đưa bill sang bàn đích; **Gộp bàn** nhập hai bill thành một; **Tách bill** chọn dòng khách thanh toán riêng. Luôn đọc lại bàn nguồn/đích, món và tổng sau thao tác. Không dọn bàn có bill đã thanh toán sai; dùng luồng **Hoàn tiền và dọn bàn** với lý do.', '**Move table** sends a bill to another table; **Merge** combines two bills; **Split bill** selects lines for separate payment. Always verify source/destination, items and totals. Never clear an incorrectly paid table; use **Refund and clear table** with a reason.', '**转台** 将账单移至目标桌；**并台** 合并两张账单；**拆单** 选择需单独结算的菜品。操作后必须核对源/目标桌、菜品和金额。已误结账的桌台不得直接清台，应使用 **退款并清台** 并填写原因。'),
          image('fnb-04-move.png', 'Chọn bàn đích khi chuyển toàn bộ bill', 'Choose the destination table when moving the full bill', '整单转台时选择目标桌'),
          image('fnb-04-merge.png', 'Chọn bàn đích để gộp bill; hệ thống báo khi không có bàn phù hợp', 'Choose a destination table to merge bills; the dialog reports when none is eligible', '选择并台目标桌；无符合条件的桌台时系统会提示')
        ])
      ]
    },
    {
      id: 'fnb-self-order-confirm', group: 'fnb', order: 2,
      paths: L('fnb/xac-nhan-don-tablet-byod', 'fnb/confirm-tablet-byod-orders', 'fnb/confirm-tablet-byod-orders'),
      title: L('Xác nhận đơn khách gọi từ Tablet hoặc BYOD', 'Confirm Tablet or BYOD guest orders', '确认平板或自带设备 (BYOD) 顾客订单'),
      summary: L('Quy trình bắt buộc từ chuông đơn chờ đến khi món thật sự xuống bếp/bar.', 'The required flow from pending-order bell to kitchen/bar routing.', '从待确认铃铛到菜品正式进入厨房/吧台的必做流程。'), minutes: 7,
      sections: [
        sec('flow', L('1. Hiểu đúng trạng thái', '1. Understand the state', '1. 正确理解状态'), [
          p('Khi khách bấm gửi trên Tablet hoặc điện thoại quét QR BYOD, món vào trạng thái **Chờ xác nhận (pending_confirm)**. Đây chưa phải lệnh chế biến: chưa in phiếu bếp và chưa xuất hiện như món đã nhận ở KDS. POS phát chuông/banner và tăng số trên biểu tượng đơn chờ.', 'When guests submit from a Tablet or QR/BYOD phone, items enter **Pending confirmation (pending_confirm)**. This is not a production instruction: no kitchen ticket is printed and KDS does not treat it as accepted. POS rings/shows a banner and increments the pending badge.', '顾客通过平板或使用自带设备 (BYOD) 手机扫码提交后，菜品进入 **待确认（pending_confirm）**。这还不是制作指令：不会打印厨房单，KDS也不会视为已接单。POS会响铃/显示横幅并增加待确认数字。'),
          image('fnb-05-pending-bell.png', 'Chuông và số lượng đơn chờ xác nhận trên POS', 'Pending-order bell and count on POS', 'POS待确认铃铛与数量'),
          callout('important', L('Bắt buộc xác nhận', 'Confirmation is mandatory', '必须确认'), 'Không bỏ qua màn đơn chờ và không bảo bếp làm theo màn hình của khách. Chỉ nút **Xác nhận (Accept)** trên POS mới chuyển món đến KDS/máy in đúng trạm.', 'Never skip pending orders or ask the kitchen to cook from the guest screen. Only **Accept** on POS routes items to the correct KDS/printer.', '不得跳过待确认页面，也不要让厨房按顾客屏幕制作。只有POS上的 **确认（Accept）** 才会把菜品路由到正确KDS/打印机。')
        ]),
        sec('accept', L('2. Nhân viên kiểm và xác nhận', '2. Review and accept', '2. 员工审核并确认'), [
          steps(
            ['Chạm biểu tượng đơn chờ. Chọn đúng nhóm theo bàn/nguồn **Đơn khách**.', 'Đọc lại từng món, số lượng, combo, topping/modifier và ghi chú. Kiểm tra cảnh báo hết món hoặc yêu cầu không thể đáp ứng.', 'Trao đổi lại với khách tại bàn/điện thoại nếu nội dung chưa rõ. Nhân viên chịu trách nhiệm xác nhận yêu cầu đặc biệt.', 'Đánh dấu các món hợp lệ rồi nhấn **Xác nhận (Accept)**.', 'Chờ thông báo đã xác nhận và gửi bếp/bar. Kiểm tra ticket tại đúng trạm nếu là món quan trọng/đặc biệt.'],
            ['Tap the pending-order icon and choose the correct group by table/source **Guest order**.', 'Read every item, quantity, combo, modifier and note. Check unavailable items or requests that cannot be fulfilled.', 'Clarify ambiguous requests with the guest. Staff owns the final interpretation of special requests.', 'Select valid items and tap **Accept**.', 'Wait for the confirmation/routing message, then verify the proper station for critical special items.'],
            ['点击待确认图标，按桌台/来源选择正确的 **顾客订单** 组。', '逐项核对菜品、数量、套餐、加料/选项及备注，检查售罄或无法满足的要求。', '如内容不清楚，需与桌边/电话顾客确认；员工负责最终确认特殊要求。', '勾选有效菜品并点击 **确认（Accept）**。', '等待已确认并发送厨房/吧台提示；重要特殊菜品需核对对应制作台票据。']
          ),
          image('fnb-06-pending-detail.png', 'Chi tiết món khách vừa gọi, topping và ghi chú', 'Pending guest items, modifiers and notes', '顾客待确认菜品、加料与备注'),
          image('fnb-07-accept-order.png', 'Chọn món và nút Xác nhận (Accept)', 'Select items and Accept', '选择菜品并确认')
        ]),
        sec('reject', L('3. Từ chối món', '3. Reject items', '3. 拒绝菜品'), [
          steps(
            ['Chỉ chọn những dòng cần từ chối; không từ chối cả nhóm nếu các món khác vẫn phục vụ được.', 'Nhập **Lý do từ chối** rõ ràng, ví dụ “Hết cá hồi lúc 19:40”, không ghi chung chung “không được”.', 'Nhấn **Từ chối (Reject)** và báo khách chọn món thay thế/kiểm tra trạng thái trên thiết bị.', 'Món bị từ chối không được gửi bếp. Theo dõi badge đến khi không còn món chờ.'],
            ['Select only lines to reject; do not reject the group when other items can be fulfilled.', 'Enter a specific **Rejection reason**, e.g. “Salmon sold out at 19:40”, not a vague “cannot”.', 'Tap **Reject** and ask the guest to choose a replacement or check their device status.', 'Rejected items are not routed. Monitor the badge until no item is pending.'],
            ['只选择需要拒绝的行；其他菜品可提供时不要拒绝整组。', '填写明确的 **拒绝原因**，例如“19:40三文鱼售罄”，不要只写“不能”。', '点击 **拒绝（Reject）**，通知顾客选择替代菜品或查看设备状态。', '被拒绝菜品不会发送厨房；持续关注徽标直至无待确认项。']
          ),
          image('fnb-08-reject-reason.png', 'Nhập lý do và từ chối món đã chọn', 'Enter a reason and reject selected items', '填写原因并拒绝所选菜品')
        ]),
        sec('byod', L('4. Lưu ý riêng với BYOD', '4. BYOD-specific notes', '4. 自带设备 (BYOD) 特别说明'), [
          bullets(['Khách không cần cài app/đăng nhập; QR xác định đúng bàn.', 'Nhiều điện thoại có thể cùng bàn; nhân viên kiểm cả giỏ chung trước khi xác nhận.', 'Nút “Yêu cầu thanh toán” chỉ gọi POS, không tự thu tiền hay đánh dấu đã thanh toán.', 'Khi chuyển bàn hoặc kết thúc bill, phiên QR cũ đóng; khách quét QR bàn mới.', 'Nếu khách gọi nhân viên nhiều lần, hệ thống có thời gian chờ chống bấm liên tục.'], ['No app/login is required; the QR identifies the table.', 'Multiple phones may share a table; review the combined cart before acceptance.', '“Request payment” only alerts POS; it never collects or marks the bill paid.', 'After table move or bill completion, the old session closes; scan the new table QR.', 'Staff-call requests have a cooldown to prevent repeated taps.'], ['顾客无需安装或登录；二维码确定桌台。', '同桌可使用多部手机；确认前检查公共购物车。', '“请求结账”仅通知POS，不会自动收款或标记已支付。', '转台或结账后旧会话关闭；顾客需扫描新桌二维码。', '呼叫服务员设有冷却时间，防止连续点击。'], true)
        ])
      ]
    },
    {
      id: 'fnb-discounts-notes', group: 'fnb', order: 3,
      paths: L('fnb/giam-gia-ghi-chu-bill', 'fnb/discounts-notes-bill', 'fnb/discounts-notes-bill'),
      title: L('Giảm giá, ghi chú và chuẩn bị bill F&B', 'F&B discounts, notes and bill preparation', '餐饮折扣、备注与结账准备'),
      summary: L('Áp CTKM item/bill, chỉnh giá có quyền và giữ ghi chú xuyên suốt đến bếp.', 'Apply item/bill promotions, authorized price overrides and production notes.', '应用单品/整单促销、授权改价并让备注完整传到制作端。'), minutes: 8,
      sections: [
        sec('notes', L('1. Ghi chú món là thông tin sản xuất', '1. Item notes are production instructions', '1. 菜品备注是制作指令'), [
          p('Nhập ghi chú lúc chọn món hoặc mở dòng → **Ghi chú món**. Viết ngắn nhưng cụ thể: “không đậu phộng – dị ứng”, “ít đá 30%”, “ra món sau”. Kiểm tra ghi chú trên dòng trước khi Gửi bếp. Với món đã gửi, thay đổi ghi chú phải được lưu lên server và báo trực tiếp trạm bếp nếu họ đã bắt đầu làm.', 'Add a note while selecting an item or open the line → **Item note**. Be concise and specific: “no peanuts – allergy”, “30% ice”, “serve later”. Verify before Send to kitchen. For sent items, save the update and directly alert the station if preparation has begun.', '点菜时或打开菜品行 → **菜品备注** 填写。简短但具体，如“花生过敏—不要花生”“冰量30%”“稍后上”。发送厨房前核对；已发送后修改须保存至服务器，若已开始制作还应直接通知制作台。'),
          image('fnb-09-click-on-item-to-notes.png', 'Chạm dòng món để mở thao tác Ghi chú món', 'Tap the item line to open Item note', '点击菜品行打开菜品备注'),
          image('fnb-09-line-note.png', 'Nhập nội dung ghi chú món và nhấn OK', 'Enter the item note and tap OK', '填写菜品备注并点击确定'),
          callout('important', L('Dị ứng', 'Allergies', '过敏'), 'Ghi chú trên POS không thay thế quy trình an toàn dị ứng của nhà hàng. Nhân viên vẫn phải xác nhận trực tiếp với bếp theo quy định nội bộ.', 'A POS note does not replace the restaurant allergy protocol. Staff must still confirm directly with the kitchen.', 'POS备注不能替代餐厅的过敏安全流程；员工仍须按内部规定直接与厨房确认。')
        ]),
        sec('discount', L('2. CTKM và chỉnh giá', '2. Promotions and price overrides', '2. 促销与改价'), [
          steps(
            ['Mở dòng → **CTKM cho món** để chọn ưu đãi áp được cho sản phẩm Retail trên bill hoặc chương trình hỗ trợ.', 'Dùng **Chỉnh giá / giảm giá món** trước khi gửi bếp. Giá mới có thể yêu cầu PIN; giá gốc vẫn được lưu để đối soát.', 'Chọn **CTKM cho cả bill** tại khu vực tổng. Hệ thống preview điều kiện và số giảm.', 'Nếu cần giảm thủ công, mở **Giảm giá** và nhập số tiền VND. Kiểm tra tổng cuối cùng.', 'In tạm tính cho khách xác nhận trước khi thanh toán nếu bill phức tạp.'],
            ['Open a line → **Item promotion** for an eligible Retail line or supported promotion.', 'Use **Item price/discount** before sending. An authorized PIN may be required; list price remains available for audit.', 'Choose **Bill promotion** in the summary and review eligibility/discount preview.', 'For a manual discount, open **Discount** and enter the VND amount. Verify the final total.', 'Print a pro-forma for guest approval before paying a complex bill.'],
            ['打开菜品行 → **单品促销**，为符合条件的零售商品行或支持的活动选择优惠。', '发送前使用 **改单品价格/折扣**；可能需要授权PIN，原价会保留用于审计。', '在汇总区选择 **整单促销** 并查看条件/折扣预览。', '手工折扣时打开 **折扣**，输入越南盾金额并核对最终总额。', '复杂账单付款前可打印预结单让顾客确认。']
          ),
          image('fnb-10-discount-actions.png', 'Các nút CTKM item, CTKM bill và giảm thủ công', 'Item promotion, bill promotion and manual discount', '单品促销、整单促销与手工折扣')
        ]),
        sec('final', L('3. Checklist trước khi thu tiền', '3. Checklist before collection', '3. 收款前检查'), [
          bullets(['Tất cả lượt gọi món đã được gửi/xác nhận; không còn pending_confirm.', 'Món hủy có lý do và quyền phê duyệt.', 'Món đã phục vụ, món đang làm và món bị từ chối khớp thực tế.', 'Khách hàng và thông tin xuất hóa đơn đã đủ.', 'Giảm giá hiển thị đúng cấp; tổng trên màn khách khớp bill.', 'Nếu tách bill, từng bill chứa đúng món và tổng của từng khách.'], ['All order rounds are sent/accepted; no pending_confirm remains.', 'Cancelled items have a reason and approval.', 'Served, preparing and rejected items match reality.', 'Customer and invoicing details are complete.', 'Discounts appear at the correct level; customer display matches.', 'For split bills, each bill has the correct items and total.'], ['所有点单批次均已发送/确认，无pending_confirm。', '取消菜品有原因和授权。', '已上菜、制作中与拒绝菜品符合实际。', '客户与开票信息完整。', '折扣层级正确；客显金额一致。', '拆单时每张账单的菜品和金额正确。'], true)
        ])
      ]
    },
    {
      id: 'payment-invoice', group: 'payment', order: 1,
      paths: L('thanh-toan/quy-trinh-thanh-toan-xuat-hoa-don', 'payment/checkout-and-invoice', 'payment/checkout-and-invoice'),
      title: L('Thanh toán, in bill và xuất hóa đơn điện tử', 'Payment, receipt printing and e-invoicing', '支付、小票打印与电子发票'),
      summary: L('Quy trình chung cho Retail và F&B, gồm tiền mặt, chuyển khoản, thanh toán nhiều phương thức và HĐĐT.', 'The shared Retail/F&B flow for cash, bank, split tender and e-invoices.', '零售与餐饮通用的现金、转账、混合支付及电子发票流程。'), minutes: 12,
      sections: [
        sec('before', L('1. Kiểm tra trước khi thanh toán', '1. Before payment', '1. 支付前检查'), [
          bullets(['Ca thu ngân đang mở và đúng người thu.', 'Bill đúng khách, hàng/món, số lượng, ghi chú, VAT và giảm giá.', 'Không còn món F&B chờ xác nhận; bill tách/gộp đã ổn định.', 'Thông tin người mua/MST/tên công ty/địa chỉ/email đủ nếu cần HĐĐT.', 'Số phải thu trên POS trùng màn hình khách.'], ['The cashier shift is open under the correct operator.', 'Customer, items, quantities, notes, VAT and discounts are correct.', 'No F&B item remains pending; bill split/merge is finalized.', 'Buyer/tax ID/company/address/email are complete when an e-invoice is needed.', 'POS amount due matches the customer display.'], ['收银班次已开启且操作人正确。', '客户、商品/菜品、数量、备注、税额和折扣正确。', '无餐饮待确认菜品，拆单/并单已完成。', '需要电子发票时，购方/税号/公司/地址/邮箱完整。', 'POS应收金额与客显一致。'], true),
          image('payment-01-review-total-Retail.png', 'Kiểm tra tổng bill Retail trước thanh toán', 'Review the Retail bill total before payment', '付款前核对零售账单总额'),
          image('payment-01-review-total-F&B.png', 'Kiểm tra tổng bill F&B trước thanh toán', 'Review the F&B bill total before payment', '付款前核对餐饮账单总额')
        ]),
        sec('methods', L('2. Chọn phương thức thanh toán', '2. Choose payment methods', '2. 选择支付方式'), [
          steps(
            ['Mở **Thanh toán**. Chọn **Tiền mặt**, **Chuyển khoản/QR**, **Thẻ** hoặc phương thức đã cấu hình.', 'Tiền mặt: nhập tiền khách đưa, đọc tiền thừa và chỉ đóng ngăn kéo sau khi đếm.', 'Chuyển khoản/QR: hiển thị đúng tài khoản và số tiền; chờ hệ thống/provider xác nhận. Chỉ xác nhận thủ công khi được phép và phải nhập lý do/chứng cứ.', 'Thanh toán hỗn hợp: thêm nhiều dòng, nhập số tiền từng phương thức; tổng các dòng phải bằng tổng bill.', 'Nhấn hoàn tất một lần và chờ kết quả. Nếu lỗi/timeout, kiểm tra lịch sử trước khi thử lại để tránh thu trùng.'],
            ['Open **Payment** and select **Cash**, **Bank/QR**, **Card** or another configured method.', 'Cash: enter received amount, state the change, and close the drawer only after counting.', 'Bank/QR: show the correct account and amount and wait for system/provider confirmation. Manual confirmation requires permission plus a reason/evidence.', 'Split tender: add lines and amounts; their total must equal the bill.', 'Submit once and wait. On error/timeout, check history before retrying to avoid duplicate collection.'],
            ['打开 **支付**，选择 **现金**、**转账/二维码**、**银行卡** 或其他已配置方式。', '现金：输入实收金额，复述找零，点清后再关闭钱箱。', '转账/二维码：显示正确账户和金额，等待系统/服务商确认；手工确认需权限并填写原因/凭证。', '混合支付：添加多行及各自金额；合计必须等于账单金额。', '只提交一次并等待结果；报错/超时时先查历史再重试，避免重复收款。']
          ),
          image('payment-02-methods.png', 'Các phương thức và dòng thanh toán', 'Payment methods and tender lines', '支付方式与收款明细'),
          image('payment-03-qr-confirm.png', 'Mã QR và trạng thái xác nhận giao dịch trên POS', 'Payment QR and confirmation status on POS', 'POS上的付款二维码与确认状态'),
          image('payment-03-qr-confirm-customer-view.png', 'Mã QR và số tiền trên màn hình khách hàng', 'QR and amount on the customer display', '客显上的二维码与付款金额'),
          callout('important', L('Không dùng ảnh chụp làm bằng chứng duy nhất', 'Do not rely only on a screenshot', '不要仅凭截图确认'), 'Ảnh chuyển khoản của khách có thể sai hoặc giả. Ưu tiên trạng thái giao dịch từ hệ thống/ngân hàng; xác nhận tay phải được phân quyền và ghi lý do.', 'A guest transfer screenshot can be wrong or forged. Prefer system/bank status; manual confirmation must be authorized and reasoned.', '顾客转账截图可能错误或伪造；优先以系统/银行状态为准，手工确认必须获授权并记录原因。')
        ]),
        sec('invoice', L('3. Xuất hóa đơn điện tử', '3. Issue an e-invoice', '3. 开具电子发票'), [
          steps(
            ['Chọn khách đã có hồ sơ hoặc nhập đúng tên người mua/công ty, MST, địa chỉ và email. Tra cứu MST nếu quy trình cửa hàng yêu cầu.', 'Sau thanh toán, mở hóa đơn trong **Lịch sử/Hóa đơn** và chọn **Xuất/Phát hành HĐĐT**; khách auto-invoice có thể được hệ thống gợi ý/tự xử lý theo cấu hình.', 'Xem lại mẫu hóa đơn: ngày, người mua, tên hàng/món, đơn vị, số lượng, đơn giá, VAT, giảm giá và tổng.', 'Xác nhận phát hành một lần. Lưu mã HĐĐT/trạng thái và gửi link/PDF theo kênh được phép.', 'Nếu thông tin sai sau phát hành, không xóa hóa đơn. Dùng quy trình điều chỉnh/thay thế/hủy theo nhà cung cấp HĐĐT và quyền kế toán.'],
            ['Select a saved customer or enter correct buyer/company name, tax ID, address and email. Validate the tax ID when policy requires.', 'After payment, open the receipt under **History/Invoices** and choose **Issue e-invoice**; automatic invoicing may be suggested or triggered by configuration.', 'Review date, buyer, item names, units, quantities, prices, VAT, discounts and totals.', 'Issue once. Retain the e-invoice code/status and send its link/PDF through an approved channel.', 'If incorrect after issuance, never delete it. Follow the provider/accounting adjustment, replacement or cancellation flow.'],
            ['选择已有客户或准确填写购方/公司名称、税号、地址和邮箱；按门店规定核验税号。', '付款后在 **历史/发票** 打开小票并选择 **开具电子发票**；按配置可提示或自动开票。', '复核日期、购方、商品/菜品名称、单位、数量、单价、税率、折扣和总额。', '只开具一次，保存电子发票代码/状态，并通过允许的渠道发送链接/PDF。', '开具后信息错误不得删除；应按服务商和财务权限执行调整、替换或作废流程。']
          ),
          image('payment-04-buyer-info.png', 'Thông tin người mua dùng để xuất HĐĐT', 'Buyer information for e-invoice', '电子发票购方信息'),
          image('payment-05-issue-invoice.png', 'Xem trước và phát hành hóa đơn điện tử', 'Review and issue the e-invoice', '预览并开具电子发票')
        ]),
        sec('after', L('4. Sau thanh toán', '4. After payment', '4. 支付后'), [
          bullets(['Đơn/bill chuyển trạng thái đã thanh toán; tồn kho và báo cáo cập nhật.', 'In bill hoặc gửi bản điện tử cho khách; in lại phải có lịch sử.', 'F&B: bàn trở về trạng thái phù hợp sau khi hoàn tất; không còn yêu cầu thanh toán treo.', 'Retail: hàng đã giao đúng số lượng; hóa đơn/phiếu trả sau này liên kết được với giao dịch gốc.', 'Nếu cần hoàn tiền, dùng chức năng hoàn/return và lý do; không sửa/xóa giao dịch đã đóng.'], ['Order/bill is paid; stock and reports update.', 'Print or send the receipt; reprints remain logged.', 'F&B table is released appropriately with no pending payment request.', 'Retail goods are handed over correctly and future returns can reference the original sale.', 'For a refund, use the refund/return flow with a reason; never edit/delete a closed transaction.'], ['订单/账单变为已支付，库存和报表更新。', '打印或发送电子小票；补打会保留记录。', '餐饮桌台正确释放且无未处理结账请求。', '零售商品正确交付，后续退货可关联原交易。', '退款使用退款/退货流程并填写原因；不得修改/删除已关闭交易。'], true)
        ])
      ]
    }
  ];

  window.HELP_CONTENT = {
    languages: ['vi', 'en', 'zh'], groups, articles,
    ui: {
      vi: { helpCenter: 'Trung tâm hướng dẫn', search: 'Tìm hướng dẫn', contents: 'Danh mục', needHelp: 'Bạn vẫn cần hỗ trợ?', supportCopy: 'Gửi mã đơn, ảnh màn hình và thời điểm phát sinh để được xử lý nhanh.', homeTitle: 'Bạn cần hỗ trợ nội dung gì?', homeCopy: 'Hướng dẫn từng bước cho Dan D Pak POS: kho, Retail, F&B, Tablet/BYOD, thanh toán và hóa đơn.', searchPlaceholder: 'Tìm kiếm hướng dẫn…', articles: 'bài hướng dẫn', updated: 'Cập nhật 21/09/2026', read: 'phút đọc', onPage: 'Trong bài này', related: 'Bài viết liên quan', screenshotPending: 'Ảnh đang chờ chụp', noResult: 'Không tìm thấy hướng dẫn phù hợp.', home: 'Trang chủ' },
      en: { helpCenter: 'Help Center', search: 'Search guides', contents: 'Topics', needHelp: 'Still need help?', supportCopy: 'Send the order ID, screenshot and incident time for faster support.', homeTitle: 'How can we help?', homeCopy: 'Step-by-step Dan D Pak POS guides for inventory, Retail, F&B, Tablet/BYOD, payments and invoices.', searchPlaceholder: 'Search guides…', articles: 'guides', updated: 'Updated 21 Sep 2026', read: 'min read', onPage: 'On this page', related: 'Related guides', screenshotPending: 'Screenshot pending', noResult: 'No matching guide found.', home: 'Home' },
      zh: { helpCenter: '帮助中心', search: '搜索指南', contents: '目录', needHelp: '仍需帮助？', supportCopy: '请发送订单号、屏幕截图和发生时间，以便快速处理。', homeTitle: '需要哪方面的帮助？', homeCopy: 'Dan D Pak POS分步指南：库存、零售、餐饮、平板/自带设备 (BYOD)、支付与发票。', searchPlaceholder: '搜索指南…', articles: '篇指南', updated: '更新于2026年9月21日', read: '分钟阅读', onPage: '本文目录', related: '相关指南', screenshotPending: '等待截图', noResult: '未找到匹配指南。', home: '首页' }
    }
  };
})();
