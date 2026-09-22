/* Detailed operating controls and exception handling for every guide. */
(function () {
  'use strict';
  const data = window.HELP_CONTENT;
  if (!data) return;
  const L = (vi, en, zh) => ({ vi, en, zh });
  const p = (vi, en, zh) => ({ type: 'p', text: L(vi, en, zh) });
  const bullets = (vi, en, zh, checklist = false) => ({ type: 'bullets', items: L(vi, en, zh), checklist });
  const steps = (vi, en, zh) => ({ type: 'steps', items: L(vi, en, zh) });
  const callout = (kind, title, vi, en, zh) => ({ type: 'callout', kind, title, text: L(vi, en, zh) });
  const table = (headers, rows) => ({ type: 'table', headers, rows });
  const sec = (id, title, blocks) => ({ id, title, blocks });
  const add = (id, minutes, sections) => {
    const article = data.articles.find(item => item.id === id);
    if (!article) throw new Error(`Missing help article: ${id}`);
    article.minutes = Math.max(article.minutes, minutes);
    article.sections.push(...sections);
  };

  add('start-overview', 13, [
    sec('opening-check', L('4. Checklist trước ca vận hành đầu tiên', '4. First-shift readiness checklist', '4. 首个营业班次检查表'), [
      bullets(['Đăng nhập thử từng vai trò và kiểm tra đúng chi nhánh/module.', 'Tạo một mặt hàng Retail và một món F&B mẫu; kiểm tra giá, VAT, đơn vị, recipe.', 'Mở ca thử, tạo bill Retail/F&B, gửi bếp, giảm giá, thanh toán tiền mặt và QR.', 'Kiểm tra tồn kho trước/sau, báo cáo bán hàng, tiền két và lịch sử bill.', 'In tạm tính/bill/phiếu bếp/tem; kiểm tra màn hình khách và QR BYOD.', 'Phát hành một HĐĐT thử theo môi trường/quy trình được phép, rồi kiểm tra tra cứu/PDF/email.', 'Ghi người chịu trách nhiệm cho Kho, Thu ngân, Bếp, Kế toán và quản trị hệ thống.'], ['Test every role and verify branch/module access.', 'Create one Retail SKU and one F&B item; verify price, VAT, unit and recipe.', 'Open a test shift; run Retail/F&B, kitchen send, discount, cash and QR payment.', 'Compare stock, sales report, drawer report and bill history before/after.', 'Test pro-forma, receipt, kitchen ticket, label, customer display and BYOD QR.', 'Issue one permitted test e-invoice and verify lookup/PDF/email.', 'Name owners for Warehouse, Cashier, Kitchen, Accounting and system administration.'], ['测试每个角色并确认门店/模块权限。', '创建一个零售SKU和一个餐饮菜品，核对价格、税率、单位与配方。', '开启测试班次，完成零售/餐饮、厨房发送、折扣、现金与二维码支付。', '对比前后库存、销售报表、钱箱报表与账单历史。', '测试预结单、小票、厨房单、标签、顾客显示与自带设备 (BYOD) 二维码。', '按允许流程开具一张测试电子发票并验证查询/PDF/邮件。', '明确仓库、收银、厨房、会计与系统管理负责人。'], true),
      callout('important', L('Chỉ mở bán khi chuỗi kiểm thử khép kín', 'Go live only after the chain closes', '仅在全链路验证完成后营业'), 'Không chỉ kiểm tra “tạo được bill”. Một ca thử chỉ đạt khi tiền, tồn, bếp, in, HĐĐT và báo cáo đều truy ngược được về cùng giao dịch.', 'A test is not complete when a bill merely exists. Payment, stock, kitchen, printing, e-invoice and reports must all trace to the same transaction.', '测试不能只停留在“能创建账单”。支付、库存、厨房、打印、电子发票与报表都必须能追溯到同一交易。')
    ])
  ]);

  add('warehouse-products', 15, [
    sec('field-reference', L('5. Quy tắc nhập từng trường quan trọng', '5. Rules for critical fields', '5. 关键字段录入规则'), [
      table(L(['Trường', 'Quy tắc', 'Nếu sai'], ['Field', 'Rule', 'If wrong'], ['字段', '规则', '错误影响']), [
        [L('Mã hàng/SKU', 'Item/SKU code', '货号/SKU'), L('Duy nhất trong chi nhánh; ngắn, ổn định, không tái dùng.', 'Unique per branch; short, stable and never reused.', '门店内唯一、简短稳定且不得复用。'), L('Quét/tìm nhầm và lịch sử không rõ.', 'Wrong scan/search and ambiguous history.', '扫码/搜索错误，历史不清。')],
        [L('Mã vạch', 'Barcode', '条码'), L('Duy nhất; quét thử từ máy thật.', 'Unique; test with the actual scanner.', '唯一；用真实扫码设备测试。'), L('Không bán được hoặc gọi nhầm SKU.', 'Cannot sell or resolves to the wrong SKU.', '无法销售或匹配错误SKU。')],
        [L('Đơn vị gốc', 'Base unit', '基本单位'), L('Đơn vị nhỏ nhất dùng để tồn và recipe.', 'Smallest unit used for stock and recipes.', '库存与配方使用的最小单位。'), L('Sai tồn, giá vốn và định lượng.', 'Wrong stock, cost and recipe quantity.', '库存、成本与配方用量错误。')],
        [L('Hệ số quy đổi', 'Conversion factor', '换算系数'), L('Số đơn vị gốc trong một đơn vị bán.', 'Base units contained in one selling unit.', '一个销售单位包含的基本单位数。'), L('Nhập/xuất nhân sai số lượng.', 'Receipts/issues multiply the wrong quantity.', '出入库数量成倍错误。')],
        [L('VAT/Giá bán', 'VAT/Sale price', '税率/售价'), L('Theo chính sách thuế và bảng giá đang áp dụng.', 'Follow the active tax policy and price book.', '遵循现行税务政策与价目表。'), L('Bill/HĐĐT và doanh thu sai.', 'Wrong bill/e-invoice and revenue.', '账单/电子发票与营收错误。')],
        [L('Quản lý lô/HSD', 'Lot/expiry control', '批次/效期管理'), L('Bật trước khi nhập lô đầu tiên nếu mặt hàng cần truy xuất.', 'Enable before the first receipt when traceability is required.', '需要追溯时应在首次入库前启用。'), L('Không thể truy đúng lô/HSD đã bán.', 'Sold lot/expiry cannot be traced correctly.', '无法正确追溯已售批次/效期。')]
      ]),
      bullets(['Sau khi lưu, tìm lại bằng tên, mã và mã vạch.', 'Mở chi tiết kiểm tra đúng kho, tồn 0 hoặc tồn từ chứng từ, bảng giá và trạng thái hoạt động.', 'Nếu đã phát sinh giao dịch, hạn chế đổi mã/đơn vị gốc; tạo SKU mới hoặc dùng quy trình chuyển đổi có kiểm soát.'], ['After saving, find the item by name, code and barcode.', 'Open details and verify warehouse, document-driven stock, price book and active status.', 'After transactions exist, avoid changing code/base unit; create a new SKU or controlled conversion.'], ['保存后分别按名称、货号与条码查找。', '打开明细核对仓库、单据驱动库存、价目表与启用状态。', '产生交易后避免修改货号/基本单位；应新建SKU或使用受控转换流程。'], true)
    ])
  ]);

  add('warehouse-receive', 14, [
    sec('receive-exceptions', L('4. Thiếu, thừa, sai giá hoặc sai lô', '4. Shortage, overage, price or lot errors', '4. 短溢、价格或批次错误'), [
      table(L(['Tình huống', 'Cách ghi nhận', 'Không được làm'], ['Situation', 'Record it as', 'Never do'], ['情况', '记录方式', '禁止操作']), [
        [L('Giao thiếu/thừa', 'Short/over delivery', '短交/多交'), L('Nhập số thực nhận; ghi chênh lệch và tham chiếu chứng từ.', 'Receive actual quantity and note the variance/reference.', '按实收数量入库并记录差异/单据。'), L('Nhập theo hóa đơn rồi sửa tồn tay.', 'Post paperwork quantity then alter stock manually.', '按发票数量入库后手工改库存。')],
        [L('Hai lô/HSD', 'Two lots/expiries', '两个批次/效期'), L('Tách thành hai dòng/lô.', 'Create separate lines/lots.', '拆分为两行/批次。'), L('Gộp chung để nhập nhanh.', 'Combine them for convenience.', '为省事合并。')],
        [L('Sai giá sau hoàn tất', 'Wrong cost after completion', '完成后成本错误'), L('Lập điều chỉnh/chứng từ đúng quy trình và ghi lý do.', 'Use the approved correction document and reason.', '按流程创建更正单并注明原因。'), L('Xóa lịch sử hoặc sửa trực tiếp tồn.', 'Delete history or directly edit stock.', '删除历史或直接改库存。')],
        [L('Hàng hỏng khi nhận', 'Damaged on receipt', '收货即损坏'), L('Tách số đạt và số từ chối/trả NCC.', 'Separate accepted and rejected/supplier-return quantities.', '分开合格与拒收/退供应商数量。'), L('Nhập toàn bộ vào tồn bán được.', 'Put all units into sellable stock.', '全部计入可售库存。')]
      ]),
      callout('warn', L('Phiếu hoàn tất làm thay đổi tồn', 'Completion changes stock', '完成单据会改变库存'), 'Trước khi bấm Hoàn thành, người lập phải đọc lại kho nhận, NCC, đơn vị, số lượng, giá, lô và HSD. Nếu chưa đủ dữ liệu, lưu tạm.', 'Before Complete, reread destination warehouse, supplier, unit, quantity, cost, lot and expiry. Save as draft if anything is unresolved.', '点击完成前必须复核收货仓、供应商、单位、数量、成本、批次与效期；信息不全时保存草稿。')
    ])
  ]);

  add('warehouse-stocktake', 15, [
    sec('variance-investigation', L('4. Điều tra chênh lệch trước khi cân bằng', '4. Investigate variances before reconciliation', '4. 库存平衡前调查差异'), [
      steps(['Tạm dừng nhập/xuất/bán với khu vực đang đếm hoặc ghi rõ thời điểm chốt.', 'Lọc các dòng lệch lớn theo số lượng và giá trị.', 'Kiểm tra nhầm đơn vị quy đổi, lô/HSD, hàng đang chuyển, phiếu tạm và bill vừa thanh toán.', 'Đếm lại bởi người thứ hai; ghi nguyên nhân cho từng chênh lệch đáng kể.', 'Người có quyền xem lại tổng giá trị tăng/giảm rồi mới Cân bằng kho.', 'Sau cân bằng, mở Lịch sử kho và xác nhận mỗi dòng có chứng từ kiểm kho tương ứng.'], ['Pause stock movement/sales in the count area or record the cutoff time.', 'Filter large quantity and value variances.', 'Check unit conversion, lot/expiry, in-transit goods, drafts and newly paid bills.', 'Have a second person recount and document material causes.', 'An authorized reviewer checks total value increase/decrease before reconciliation.', 'After posting, verify each adjustment in Stock history.'], ['暂停盘点区域的出入库/销售，或明确记录截止时间。', '筛选数量与金额差异较大的行。', '检查单位换算、批次/效期、在途商品、草稿与刚付款账单。', '由第二人复盘并记录重大差异原因。', '有权限人员复核库存增减总价值后再平衡。', '完成后在库存历史中确认每条调整对应盘点单。']),
      bullets(['Không nhập số hệ thống vào cột thực tế để “cho khớp”.', 'Không cân bằng khi còn người đang bán/nhập cùng SKU mà chưa có thời điểm chốt.', 'Không dùng một lý do chung cho mọi dòng nếu nguyên nhân khác nhau.'], ['Never copy system quantity into counted quantity merely to match.', 'Do not reconcile while the same SKUs are still moving without a cutoff.', 'Do not use one blanket reason when causes differ.'], ['不要为了“对平”把系统数量抄到实盘栏。', '同一SKU仍在流转且无截止点时不要平衡。', '原因不同的差异不要统一填写同一理由。'], true)
    ])
  ]);

  add('warehouse-movements', 15, [
    sec('choose-document', L('4. Chọn đúng loại chứng từ', '4. Choose the correct document', '4. 选择正确单据类型'), [
      table(L(['Nhu cầu', 'Chứng từ', 'Kết quả tồn'], ['Need', 'Document', 'Stock result'], ['需求', '单据', '库存结果']), [
        [L('Đưa hàng sang kho khác', 'Move to another warehouse', '调拨到其他仓库'), L('Chuyển kho', 'Transfer', '调拨单'), L('Giảm kho nguồn, tăng kho đích; có cùng tham chiếu.', 'Decrease source and increase destination under one reference.', '同一引用下源仓减少、目标仓增加。')],
        [L('Dùng nội bộ/hao hụt có lý do', 'Internal use/approved loss', '内部领用/合理损耗'), L('Xuất nội bộ', 'Internal issue', '内部出库'), L('Chỉ giảm kho xuất và lưu lý do/người nhận.', 'Decrease source only and retain reason/recipient.', '仅减少出库仓并保留原因/领用人。')],
        [L('Trả hàng mua cho NCC', 'Return purchase to supplier', '采购退供应商'), L('Trả hàng nhập', 'Purchase return', '采购退货'), L('Giảm đúng kho/lô và liên kết NCC/chứng từ.', 'Decrease exact warehouse/lot and link supplier/reference.', '减少正确仓库/批次并关联供应商/单据。')],
        [L('Sửa số thực tế sau kiểm', 'Correct counted stock', '盘点后修正实存'), L('Kiểm kho → Cân bằng', 'Stocktake → Reconcile', '盘点→平衡'), L('Sinh chuyển động stocktake có dấu vết.', 'Creates traceable stocktake movements.', '生成可追溯的盘点调整流水。')]
      ]),
      callout('important', L('Không dùng chuyển kho để che xuất dùng', 'Do not disguise consumption as a transfer', '不得用调拨掩盖领用'), 'Kho đích phải tồn tại và thực sự nhận hàng. Nếu hàng đã tiêu thụ/hỏng/mất, dùng loại xuất phù hợp và lý do thật.', 'A transfer requires a real destination that receives the goods. Consumed, damaged or missing goods need the appropriate issue type and true reason.', '调拨必须有真实接收货物的目标仓。已领用、损坏或丢失应使用相应出库类型并填写真实原因。')
    ])
  ]);

  add('warehouse-lots-prices-history', 13, [
    sec('traceability', L('4. Truy xuất từ bán hàng về lô và giá', '4. Trace sales to lot and price', '4. 从销售追溯批次与价格'), [
      steps(['Từ bill, ghi mã đơn, SKU, số lượng và thời điểm.', 'Mở Lịch sử kho theo SKU/kho/kỳ; tìm chuyển động sale hoặc recipe.', 'Mở lô liên quan để kiểm tra số lô, HSD, nhập từ phiếu/NCC nào và số còn lại.', 'Đối chiếu bảng giá/giá hiệu lực tại thời điểm bán, VAT và mức giảm trên bill.', 'Nếu không khớp, không sửa bản ghi cũ; lập hồ sơ sai lệch và điều chỉnh bằng chứng từ phù hợp.'], ['From the bill, capture order ID, SKU, quantity and time.', 'Open Stock history for SKU/warehouse/period and find sale/recipe movement.', 'Open the lot and verify lot number, expiry, source receipt/supplier and balance.', 'Reconcile the effective price book, VAT and bill discount at sale time.', 'If mismatched, do not rewrite history; document and correct through the proper transaction.'], ['从账单记录订单号、SKU、数量与时间。', '按SKU/仓库/期间打开库存历史，找到sale或recipe流水。', '打开相关批次，核对批号、效期、来源入库单/供应商与余量。', '核对销售当时生效价目表、税率与账单折扣。', '不一致时不得改写历史；应记录并通过正确单据调整。']),
      bullets(['Xuất hàng theo FEFO khi quy trình yêu cầu: ưu tiên lô hết hạn sớm nhưng vẫn còn hợp lệ.', 'Không đổi HSD để làm lô hết cảnh báo.', 'Bảng giá mới chỉ áp dụng theo phạm vi/thời điểm; không sửa hồi tố bill đã đóng.'], ['Use FEFO where required: earliest valid expiry first.', 'Never change expiry merely to clear an alert.', 'A new price book applies by scope/time; never retroactively rewrite closed bills.'], ['需要时按FEFO出库：优先使用最早但仍有效的批次。', '不得修改效期来消除预警。', '新价目表按范围/时间生效；不得追溯修改已关闭账单。'], true)
    ])
  ]);

  add('retail-sale', 14, [
    sec('retail-controls', L('4. Kiểm soát trong lúc bán', '4. Controls during a Retail sale', '4. 零售销售过程控制'), [
      table(L(['Tình huống', 'Thu ngân làm', 'Quản lý khi cần'], ['Situation', 'Cashier action', 'Manager action'], ['情况', '收银员操作', '需要时经理操作']), [
        [L('Quét không ra hàng', 'Barcode not found', '扫码无商品'), L('Tìm tên/mã; kiểm tra đang đúng chi nhánh và hàng đang hoạt động.', 'Search name/code and verify branch/active status.', '按名称/货号搜索，确认门店与启用状态。'), L('Kiểm tra mã vạch/SKU trong Kho; không tạo hàng trùng ngay tại quầy.', 'Check barcode/SKU in Warehouse; do not create a duplicate at checkout.', '在仓库检查条码/SKU；不要在收银台临时创建重复商品。')],
        [L('Hết/không đủ tồn', 'No/insufficient stock', '库存不足'), L('Kiểm tra kho bán và lô; bỏ hoặc giảm số lượng.', 'Check selling warehouse/lot; remove or reduce quantity.', '检查销售仓/批次；删除或减少数量。'), L('Xác minh tồn thực tế/chứng từ; không cho bán âm nếu chưa có quy trình.', 'Verify physical stock/documents; do not allow negative stock without policy.', '核实实存/单据；无流程时不得负库存销售。')],
        [L('Giỏ đổi ở máy khác', 'Cart changed elsewhere', '购物车被其他设备修改'), L('Dừng, tải lại và đọc toàn bộ giỏ.', 'Stop, reload and reread the cart.', '停止操作，刷新并重新核对购物车。'), L('Tiếp quản chỉ khi chắc máy kia đã dừng và có quyền duyệt.', 'Take over only after the other device stops and approval is valid.', '确认另一设备已停止且审批有效后再接管。')],
        [L('Thanh toán timeout', 'Payment timeout', '支付超时'), L('Không bấm lại; mở lịch sử và kiểm tra ngân hàng.', 'Do not retry; check history and bank.', '不要重试；检查历史与银行。'), L('Chỉ xử lý tiếp sau khi xác định rõ đã thu hay chưa.', 'Proceed only after paid/unpaid state is certain.', '仅在明确已收/未收后继续。')]
      ]),
      callout('warn', L('Một giỏ — một người chịu trách nhiệm', 'One cart — one responsible operator', '一个购物车—一个责任操作人'), 'Khi nhiều thiết bị cùng mở một giỏ, chỉ một máy được sửa/thu tiền. Thiết bị còn lại để chế độ xem hoặc đóng giỏ.', 'When several devices view one cart, only one edits/collects. Others stay view-only or close it.', '多设备查看同一购物车时，仅一台可编辑/收款；其他设备应只读或关闭。')
    ])
  ]);

  add('retail-discounts-notes', 15, [
    sec('discount-order', L('4. Thứ tự áp ưu đãi và cách kiểm tra', '4. Discount order and verification', '4. 优惠应用顺序与检查'), [
      steps(['Chọn khách trước nếu ưu đãi phụ thuộc hạng/SĐT.', 'Áp CTKM cấp item cho đúng dòng và số lượng đủ điều kiện.', 'Áp voucher/CTKM cấp bill sau khi giỏ ổn định.', 'Chỉ dùng giảm thủ công khi chính sách cho phép; nhập lý do/PIN nếu yêu cầu.', 'Kiểm tra từng dòng: giá gốc, giá sau giảm, số giảm; sau đó kiểm tổng bill, VAT và phải thu.', 'In tạm tính hoặc cho khách xem màn hình khách trước khi thanh toán.', 'Sau thanh toán, mở lịch sử xác nhận ưu đãi và ghi chú vẫn gắn đúng bill.'], ['Select customer first for tier/phone-based benefits.', 'Apply item promotions to the correct eligible line/quantity.', 'Apply bill voucher/promotion after the cart is stable.', 'Use manual discount only under policy, with reason/PIN when required.', 'Verify each line list price, net price and discount, then bill total, VAT and amount due.', 'Print/show a pro-forma before payment.', 'After payment, verify discounts and notes remain on the bill history.'], ['若优惠依赖会员等级/手机号，先选择客户。', '将单品促销应用到正确且符合条件的行/数量。', '购物车稳定后再应用整单优惠券/促销。', '仅按政策使用手工折扣，并在需要时填写原因/PIN。', '逐行核对原价、折后价、优惠额，再核对整单总额、税额与应收。', '付款前打印/展示预结单。', '付款后在历史中确认优惠与备注仍正确关联。']),
      table(L(['Ghi chú', 'Đặt ở đâu', 'Dùng cho'], ['Note', 'Where', 'Use'], ['备注', '位置', '用途']), [
        [L('Ghi chú item', 'Item note', '单品备注'), L('Ngay dòng hàng', 'On the item line', '商品行'), L('Serial/lô cần giao, đóng gói, yêu cầu riêng của hàng.', 'Serial/lot to deliver, packing and item-specific request.', '交付序列号/批次、包装与商品专项要求。')],
        [L('Ghi chú bill', 'Bill note', '整单备注'), L('Khu vực tổng bill', 'Bill summary', '账单汇总区'), L('Giao hàng, người nhận, lý do nghiệp vụ chung.', 'Delivery, recipient and overall business context.', '配送、收货人及整单业务说明。')]
      ])
    ])
  ]);

  add('fnb-sale', 17, [
    sec('table-order-lifecycle', L('4. Trạng thái bàn, lượt gọi và món', '4. Table, order-round and item lifecycle', '4. 桌台、点单轮次与菜品生命周期'), [
      table(L(['Đối tượng', 'Trạng thái cần theo dõi', 'Điều kiện chuyển'], ['Object', 'States to watch', 'Transition condition'], ['对象', '关注状态', '转换条件']), [
        [L('Bàn', 'Table', '桌台'), L('Trống → Có khách → Chờ thanh toán → Trống', 'Empty → Occupied → Payment requested → Empty', '空闲→有客→请求结账→空闲'), L('Mở bill, phục vụ, thanh toán hoàn tất và dọn bàn.', 'Open bill, serve, complete payment and clear.', '开账、服务、完成付款并清台。')],
        [L('Lượt gọi', 'Order round', '点单轮次'), L('Nháp / chờ xác nhận / đã gửi', 'Draft / pending confirmation / sent', '草稿/待确认/已发送'), L('Nhân viên kiểm món, topping, ghi chú và chấp nhận/từ chối.', 'Staff reviews item, modifiers and note, then accepts/rejects.', '员工核对菜品、选项与备注后接受/拒绝。')],
        [L('Món', 'Item', '菜品'), L('Chờ làm → đang làm → xong → phục vụ', 'Queued → preparing → ready → served', '待制作→制作中→完成→已上菜'), L('KDS/trạm cập nhật đúng thao tác thực tế.', 'KDS/station updates actual progress.', 'KDS/制作台按实际进度更新。')]
      ]),
      bullets(['Không thanh toán khi còn món pending_confirm.', 'Món đã bắt đầu làm không xóa như món nháp; dùng hủy đúng quyền, lý do và báo bếp.', 'Chuyển/gộp/tách bàn phải kiểm tra lại khách, món, giảm giá, cọc và yêu cầu thanh toán.', 'Sau thanh toán phải xác nhận bàn được giải phóng và không còn ticket/yêu cầu treo.'], ['Do not pay while any item is pending_confirm.', 'Do not delete a started item like a draft; use authorized void with reason and alert kitchen.', 'After move/merge/split, recheck guest, items, discounts, deposits and payment requests.', 'After payment, verify table release and no stale ticket/request.'], ['存在pending_confirm菜品时不得付款。', '已开始制作的菜品不能像草稿一样删除；须授权撤销、填写原因并通知厨房。', '转台/并台/拆单后重新核对客人、菜品、折扣、定金与结账请求。', '付款后确认桌台释放且无遗留工单/请求。'], true)
    ])
  ]);

  add('fnb-self-order-confirm', 13, [
    sec('confirmation-cases', L('5. Xử lý từng trường hợp đơn chờ', '5. Handle each pending-order case', '5. 处理各种待确认订单'), [
      table(L(['Trường hợp', 'Xác nhận', 'Từ chối/điều chỉnh'], ['Case', 'Accept', 'Reject/adjust'], ['情况', '接受', '拒绝/调整']), [
        [L('Đủ món và topping', 'All items/modifiers available', '菜品与选项齐全'), L('Chọn đúng toàn bộ dòng rồi Xác nhận; kiểm ticket KDS.', 'Select all valid lines, Accept and verify KDS ticket.', '选择全部有效行并确认，检查KDS工单。'), L('Không cần sửa.', 'No adjustment.', '无需调整。')],
        [L('Một món hết', 'One item unavailable', '一个菜品售罄'), L('Xác nhận các dòng còn lại nếu khách đồng ý.', 'Accept remaining lines only with guest agreement.', '经顾客同意后接受其余行。'), L('Chọn dòng hết, lý do cụ thể; báo khách chọn món khác.', 'Reject that line with a specific reason and offer an alternative.', '选中售罄行，填写具体原因并建议替代。')],
        [L('Ghi chú dị ứng', 'Allergy note', '过敏备注'), L('Chỉ xác nhận sau khi bếp xác nhận khả năng đáp ứng.', 'Accept only after kitchen confirms feasibility.', '厨房确认可满足后再接受。'), L('Từ chối nếu không đảm bảo an toàn; liên hệ trực tiếp khách.', 'Reject if safety cannot be assured and contact the guest.', '无法保证安全时拒绝并直接联系顾客。')],
        [L('Đơn trùng/chậm mạng', 'Duplicate/network delay', '重复/网络延迟'), L('So món và thời gian với bill hiện tại trước.', 'Compare items/time with current bill first.', '先与当前账单的菜品/时间比较。'), L('Không chấp nhận cả hai; ghi rõ trùng và giữ bằng chứng.', 'Do not accept both; mark duplicate and retain evidence.', '不得两单都接受；注明重复并保留证据。')]
      ]),
      callout('important', L('SLA xác nhận', 'Confirmation SLA', '确认时限'), 'Phân công rõ ai theo dõi chuông đơn chờ trong ca. Nếu quá thời gian nội bộ, nhân viên phải kiểm tra mạng/thiết bị và liên hệ bàn; không để khách tự đoán đơn đã vào bếp.', 'Assign a staff member to monitor pending-order alerts. When the internal SLA is exceeded, check network/device and contact the table; never let guests guess whether the kitchen received it.', '班次中明确由谁监控待确认提醒。超过内部时限时检查网络/设备并联系桌台；不要让顾客猜订单是否已进厨房。')
    ])
  ]);

  add('fnb-discounts-notes', 13, [
    sec('change-after-send', L('4. Thay đổi sau khi đã gửi bếp', '4. Changes after kitchen send', '4. 发送厨房后的变更'), [
      steps(['Mở đúng bill/bàn và xác định món đang ở trạng thái nào.', 'Nếu chỉ bổ sung ghi chú, lưu trên dòng và báo trực tiếp trạm nếu món đang làm.', 'Nếu đổi topping/số lượng làm thay đổi giá hoặc cách chế biến, hủy/điều chỉnh theo quyền thay vì sửa im lặng.', 'Ghi lý do, người duyệt và xác nhận ticket mới/hủy đã tới đúng KDS/máy in.', 'Đọc lại tạm tính với khách, đặc biệt sau thay đổi giá/khuyến mại.', 'Trước thanh toán, so trạng thái món trên POS, KDS và thực tế tại bàn.'], ['Open the correct bill/table and identify item state.', 'For an added note, save it and directly notify the station if preparation started.', 'For modifier/quantity changes affecting price or preparation, use authorized void/adjustment rather than silent edits.', 'Record reason/approver and verify new/cancel ticket at the correct KDS/printer.', 'Review pro-forma with the guest after price/promotion changes.', 'Before payment, reconcile item state across POS, KDS and the table.'], ['打开正确账单/桌台并确认菜品状态。', '仅补充备注时保存到菜品行；已制作时直接通知制作台。', '选项/数量变化影响价格或制作时，使用授权撤销/调整，不得静默修改。', '记录原因/审批人并确认新单/撤销单到达正确KDS/打印机。', '价格/促销变化后与顾客重新核对预结单。', '付款前核对POS、KDS与桌面实际菜品状态。'])
    ])
  ]);

  add('payment-invoice', 18, [
    sec('payment-recovery', L('5. Phục hồi khi thanh toán gián đoạn', '5. Recover an interrupted payment', '5. 支付中断恢复'), [
      table(L(['Tình huống', 'Kiểm tra bắt buộc', 'Quyết định'], ['Situation', 'Mandatory check', 'Decision'], ['情况', '必须检查', '决定']), [
        [L('Tiền mặt đã nhận nhưng app lỗi', 'Cash taken but app errored', '已收现金但应用报错'), L('Bill trong lịch sử, ca/két và log thanh toán.', 'Bill history, shift/drawer and payment log.', '账单历史、班次/钱箱与支付日志。'), L('Chỉ ghi nhận lại khi chắc server chưa có thanh toán; giữ biên bản.', 'Re-record only when server is certainly unpaid; retain evidence.', '仅在确定服务器未付款时重新记录，并保留证据。')],
        [L('QR báo timeout', 'QR timeout', '二维码超时'), L('Ngân hàng/provider, mã tham chiếu, số tiền và bill.', 'Bank/provider, reference, amount and bill.', '银行/服务商、参考号、金额与账单。'), L('Đã có giao dịch thì chờ/sync; chưa có mới tạo lại.', 'If transaction exists, wait/sync; recreate only if absent.', '有交易则等待/同步；确认无交易后才重建。')],
        [L('Bill tự đóng ở máy khác', 'Bill closed elsewhere', '账单在其他设备自动关闭'), L('ORDER_ALREADY_PAID/ALREADY_SETTLED và lịch sử.', 'ORDER_ALREADY_PAID/ALREADY_SETTLED and history.', 'ORDER_ALREADY_PAID/ALREADY_SETTLED与历史。'), L('Không thu thêm; in/gửi lại chứng từ nếu cần.', 'Do not collect again; reprint/resend evidence if needed.', '不要再次收款；需要时补打/重发凭证。')],
        [L('In lỗi sau khi đã thu', 'Print failed after payment', '付款后打印失败'), L('Bill đã paid và print job.', 'Paid bill and print job.', '已付款账单与打印任务。'), L('Dùng In lại; không tạo/thu bill mới.', 'Use Reprint; never create/collect a new bill.', '使用补打；不得新建/重复收款。')]
      ]),
      callout('important', L('Ưu tiên chống thu trùng', 'Prevent duplicate collection first', '优先防止重复收款'), 'Khi trạng thái chưa rõ, dừng thu và kiểm tra. Chậm vài phút an toàn hơn tạo hai giao dịch cho cùng một bill.', 'When state is uncertain, stop and verify. A short delay is safer than two transactions for one bill.', '状态不明时停止收款并核查。短暂等待比同一账单产生两笔交易更安全。')
    ])
  ]);

  add('reports-center', 18, [
    sec('filters-permissions', L('4. Bộ lọc, quyền và cách khoanh vùng số liệu', '4. Filters, permissions and data scope', '4. 筛选、权限与数据范围'), [
      table(L(['Bộ lọc', 'Tác động', 'Kiểm tra'], ['Filter', 'Effect', 'Verify'], ['筛选', '影响', '核对']), [
        [L('Từ–Đến ngày', 'From–To', '起止日期'), L('Giới hạn giao dịch theo ngày nghiệp vụ Việt Nam.', 'Limits transactions by Vietnam business date.', '按越南业务日期限制交易。'), L('Mốc đầu/cuối ngày và kỳ hiển thị.', 'Displayed period and day boundaries.', '显示期间与日界限。')],
        [L('Chi nhánh', 'Branch', '门店'), L('Một chi nhánh hoặc tổng hợp nhiều chi nhánh được phép.', 'One branch or authorized multi-branch consolidation.', '单门店或有权限的多门店汇总。'), L('Nhãn scope trên kết quả và cột chi nhánh.', 'Scope label and branch column.', '结果范围标签与门店列。')],
        [L('Kênh', 'Channel', '渠道'), L('Tại bàn, Retail, Online hoặc mang đi khi báo cáo hỗ trợ.', 'Dine-in, Retail, Online or takeaway when supported.', '报表支持时筛选堂食、零售、在线或外带。'), L('Tổng sau lọc không được hiểu là tổng toàn cửa hàng.', 'Filtered total is not the whole-store total.', '筛选后总额不等于全店总额。')],
        [L('Sản phẩm/Kho', 'Product/Warehouse', '商品/仓库'), L('Chỉ một đối tượng trong báo cáo chi tiết.', 'Narrows detail to one object.', '将明细限定为单一对象。'), L('Tên/mã và đơn vị trên từng dòng.', 'Name/code and unit on each row.', '逐行核对名称/代码与单位。')]
      ]),
      bullets(['Quyền `reports` xem toàn trung tâm; quyền `report.<mã>` chỉ mở báo cáo tương ứng.', 'Không thấy báo cáo: kiểm tra vai trò, chi nhánh và quyền trước khi kết luận hệ thống thiếu dữ liệu.', 'Tất cả chi nhánh chỉ gồm các chi nhánh người dùng được phép xem.'], ['`reports` grants the full center; `report.<key>` grants one report.', 'If a report is missing, check role, branch and permission before assuming missing data.', 'All branches includes only branches the user may view.'], ['`reports`可查看整个报表中心；`report.<代码>`仅授权对应报表。', '看不到报表时先检查角色、门店与权限，不要直接判断数据缺失。', '全部门店仅包含用户有权查看的门店。'], true)
    ]),
    sec('report-anomaly', L('5. Khi số liệu báo cáo có vẻ sai', '5. When report figures look wrong', '5. 报表数据疑似错误时'), [
      steps(['Giữ nguyên bộ lọc và chụp toàn màn hình.', 'Ghi tên báo cáo, kỳ, chi nhánh và thời điểm tạo.', 'Chọn một dòng/bill mẫu và truy ngược về lịch sử/chứng từ gốc.', 'Kiểm tra trạng thái: paid/open/returned/cancelled/draft và thời điểm nghiệp vụ.', 'So với báo cáo liên quan, không so các phạm vi khác nhau.', 'Nếu vẫn lệch, xuất Excel và gửi dòng mẫu + mã bill cho kỹ thuật; không chỉnh dữ liệu để ép khớp.'], ['Keep filters unchanged and capture the full screen.', 'Record report name, period, branch and generated time.', 'Pick one row/bill and trace it to source history/document.', 'Check paid/open/returned/cancelled/draft state and business time.', 'Compare only reports with the same scope.', 'If still wrong, export Excel and send sample row/bill ID; do not edit data to force a match.'], ['保持筛选不变并截取全屏。', '记录报表名、期间、门店与生成时间。', '选择一行/一张账单追溯到原始历史/单据。', '检查paid/open/returned/cancelled/draft状态与业务时间。', '仅比较相同范围的报表。', '仍不一致时导出Excel并提交样例行/账单号；不得改数据强行对平。'])
    ])
  ]);

  add('reports-export-reconcile', 16, [
    sec('variance-workflow', L('3. Quy trình xử lý chênh lệch', '3. Variance resolution workflow', '3. 差异处理流程'), [
      steps(['Đóng băng phạm vi: cùng kỳ, cùng chi nhánh, cùng thời điểm xuất.', 'Xác định chênh thuộc doanh thu, phương thức thanh toán, tiền két, kho hay HĐĐT.', 'Khoanh một mã bill/giao dịch/chứng từ làm mẫu.', 'Truy nguồn theo thứ tự: trạng thái bill → thanh toán → chuyển động két/kho → HĐĐT.', 'Phân loại: thời điểm khác kỳ, giao dịch đang chờ, hoàn/trả, sai phương thức, thiếu chứng từ hoặc lỗi hệ thống.', 'Lập điều chỉnh đúng nghiệp vụ với lý do/người duyệt; không sửa file Excel thay cho hệ thống.', 'Xuất lại báo cáo sau điều chỉnh và lưu cả bản trước/sau.'], ['Freeze scope: same period, branch and export time.', 'Identify whether variance is revenue, tender, drawer, stock or e-invoice.', 'Select one bill/transaction/document as a trace sample.', 'Trace bill state → payment → drawer/stock movement → e-invoice.', 'Classify timing, pending, refund/return, wrong tender, missing document or system fault.', 'Post the correct authorized adjustment; never use edited Excel as the system record.', 'Re-export and retain before/after versions.'], ['冻结范围：同一期间、门店与导出时间。', '判断差异属于营收、支付方式、钱箱、库存还是电子发票。', '选择一个账单/交易/单据作为追踪样例。', '按账单状态→支付→钱箱/库存流水→电子发票追溯。', '分类为跨期、待处理、退款/退货、支付方式错误、缺单或系统错误。', '按业务创建授权调整；不得用修改Excel替代系统记录。', '调整后重新导出并保留前后版本。']),
      callout('note', L('Quy ước lưu trữ', 'Archive convention', '归档约定'), 'Tên file nên gồm `YYYYMMDD-YYYYMMDD_chi-nhanh_loai-bao-cao_thoi-diem-xuat`. Lưu PDF bản chốt và Excel chi tiết cùng biên bản chênh lệch.', 'Name files `YYYYMMDD-YYYYMMDD_branch_report_export-time`. Keep final PDF, detailed Excel and variance record together.', '文件名建议为 `YYYYMMDD-YYYYMMDD_门店_报表类型_导出时间`，同时归档最终PDF、明细Excel与差异记录。')
    ])
  ]);

  add('management-overview', 16, [
    sec('menu-change-control', L('3. Kiểm soát thay đổi thực đơn', '3. Menu change control', '3. 菜单变更控制'), [
      table(L(['Thay đổi', 'Cần kiểm tra trước', 'Kiểm tra sau'], ['Change', 'Before', 'After'], ['变更', '变更前检查', '变更后检查']), [
        [L('Giá/VAT', 'Price/VAT', '价格/税率'), L('Ngày hiệu lực, chính sách, CTKM và HĐĐT.', 'Effective date, policy, promotions and e-invoice.', '生效日期、政策、促销与电子发票。'), L('POS/Tablet/BYOD, tạm tính và HĐĐT mẫu.', 'POS/Tablet/BYOD, pro-forma and sample e-invoice.', 'POS/平板/自带设备 (BYOD)、预结单与测试电子发票。')],
        [L('Recipe', 'Recipe', '配方'), L('Đúng SKU kho, đơn vị và định lượng.', 'Correct stock SKU, unit and quantity.', '正确库存SKU、单位与用量。'), L('Bill thử sinh tiêu hao đúng kho/lô.', 'Test bill consumes correct warehouse/lot.', '测试账单扣减正确仓库/批次。')],
        [L('Trạm chế biến', 'Station', '制作台'), L('Trạm đang hoạt động và máy in/KDS.', 'Active station and printer/KDS.', '启用的制作台与打印机/KDS。'), L('Ticket tới đúng nơi, không in trùng.', 'Ticket reaches the right place once.', '工单一次到达正确位置。')],
        [L('Ẩn/xóa món', 'Hide/delete item', '隐藏/删除菜品'), L('Bill mở, combo, recipe và lịch sử.', 'Open bills, combos, recipes and history.', '未结账单、组合、配方与历史。'), L('Món không còn cho đơn mới nhưng lịch sử vẫn đọc được.', 'Unavailable for new orders while history remains readable.', '新订单不可选，但历史仍可读取。')]
      ]),
      bullets(['Thay đổi lớn thực hiện ngoài giờ cao điểm.', 'Ghi người yêu cầu, người duyệt, thời điểm và nội dung trước/sau.', 'Có kế hoạch quay lại cấu hình cũ nếu POS/KDS/kho không đúng.'], ['Make major changes outside peak hours.', 'Record requester, approver, time and before/after values.', 'Keep a rollback plan if POS/KDS/inventory fails validation.'], ['重大变更应避开高峰期。', '记录申请人、审批人、时间及变更前后内容。', '如POS/KDS/库存验证失败，应有恢复旧配置方案。'], true)
    ])
  ]);

  add('management-users', 18, [
    sec('permission-design', L('3. Thiết kế quyền theo công việc', '3. Design permissions by job', '3. 按岗位设计权限'), [
      table(L(['Vai trò', 'Quyền thường cần', 'Quyền nên tách'], ['Role', 'Typical access', 'Keep separate'], ['角色', '通常需要', '应单独控制']), [
        [L('Thu ngân', 'Cashier', '收银员'), L('Bán, thanh toán, xem bill trong chi nhánh.', 'Sell, pay and view branch bills.', '销售、收款与查看本门店账单。'), L('Hoàn tiền, hủy món đã làm, chỉnh giá, cân kho.', 'Refund, void made item, price override, stock balance.', '退款、撤销已制作菜品、改价、库存平衡。')],
        [L('Bếp', 'Kitchen', '厨房'), L('KDS, cập nhật chế biến.', 'KDS and preparation status.', 'KDS与制作状态。'), L('Thu tiền, giá, báo cáo tài chính.', 'Payment, pricing and financial reports.', '收款、定价与财务报表。')],
        [L('Thủ kho', 'Warehouse', '仓管'), L('Mặt hàng, nhập/xuất/chuyển/kiểm.', 'Items, receipts, issues, transfers and counts.', '商品、出入库、调拨与盘点。'), L('Cân bằng/xóa chứng từ nếu không được duyệt riêng.', 'Reconcile/delete documents without separate approval.', '未经单独批准的库存平衡/删除单据。')],
        [L('Kế toán', 'Accounting', '会计'), L('Báo cáo, tiền, HĐĐT và đối soát.', 'Reports, money, e-invoice and reconciliation.', '报表、资金、电子发票与对账。'), L('Quản trị hệ thống/nhân sự nếu không cần.', 'System/staff administration unless needed.', '非必要的系统/员工管理。')],
        [L('Quản lý', 'Manager', '经理'), L('Duyệt ngoại lệ và vận hành chi nhánh.', 'Approve exceptions and manage branch operations.', '审批例外与管理门店运营。'), L('Admin toàn hệ thống, bí mật tích hợp.', 'Global Admin and integration secrets.', '全局管理员与集成密钥。')]
      ]),
      steps(['Tạo vai trò theo công việc, không theo tên cá nhân.', 'Bắt đầu từ ít quyền, bổ sung khi có nhu cầu được duyệt.', 'Test các thao tác được phép và bị chặn bằng tài khoản thử.', 'Rà soát quyền định kỳ và ngay khi đổi vị trí/nghỉ việc.', 'Đối chiếu Nhật ký hoạt động với các thao tác nhạy cảm.'], ['Create roles for jobs, not individuals.', 'Start with least access and add approved needs.', 'Test allowed and denied actions with a test user.', 'Review periodically and whenever duties/employment change.', 'Reconcile activity logs with sensitive actions.'], ['按岗位而不是个人姓名创建角色。', '从最小权限开始，仅按审批需求增加。', '用测试账号验证允许与拒绝的操作。', '定期以及岗位/离职变化时复核权限。', '将活动日志与敏感操作核对。'])
    ]),
    sec('offboarding', L('4. Khóa tài khoản và bàn giao', '4. Disable and hand over accounts', '4. 停用账号与交接'), [
      bullets(['Kết thúc ca/bill đang mở và bàn giao tiền/chứng từ.', 'Khóa tài khoản, thu hồi thiết bị và đổi bí mật dùng chung bắt buộc.', 'Không xóa người dùng nếu cần giữ lịch sử người thao tác.', 'Kiểm tra token/phiên đăng nhập và quyền chi nhánh.', 'Lưu biên bản bàn giao và người phê duyệt.'], ['Close open shifts/bills and hand over cash/documents.', 'Disable account, recover devices and rotate required shared secrets.', 'Do not delete a user when actor history must remain.', 'Review tokens/sessions and branch access.', 'Retain handover and approval evidence.'], ['关闭未结班次/账单并交接现金/单据。', '停用账号、回收设备并轮换必须更换的共享密钥。', '需要保留操作人历史时不要删除用户。', '检查令牌/会话与门店权限。', '保存交接与审批记录。'], true)
    ])
  ]);

  add('invoice-management', 16, [
    sec('invoice-filters', L('3. Bộ lọc và cách khoanh đúng hóa đơn', '3. Filters and precise invoice lookup', '3. 筛选与精确查找发票'), [
      table(L(['Cần tìm', 'Bộ lọc/khóa', 'Kiểm tra trong chi tiết'], ['Find', 'Filter/key', 'Verify in detail'], ['查找目标', '筛选/关键字', '明细核对']), [
        [L('Một giao dịch cụ thể', 'One transaction', '某笔交易'), L('Mã bill hoặc mã đơn đầy đủ.', 'Full bill/order ID.', '完整账单号或订单号。'), L('Chi nhánh, giờ thanh toán, tổng và phương thức.', 'Branch, payment time, total and tender.', '门店、付款时间、总额与支付方式。')],
        [L('HĐĐT của khách', 'Customer e-invoice', '客户电子发票'), L('Tên, MST, email hoặc SĐT.', 'Name, tax ID, email or phone.', '名称、税号、邮箱或电话。'), L('Loại người mua, địa chỉ và thông tin phát hành.', 'Buyer type, address and issuance details.', '购方类型、地址与开票信息。')],
        [L('Danh sách lỗi', 'Failed set', '失败列表'), L('FAILED/REVIEW_REQUIRED và kỳ.', 'FAILED/REVIEW_REQUIRED plus period.', 'FAILED/REVIEW_REQUIRED与期间。'), L('Mã lỗi, lần thử, provider và nhật ký kỹ thuật.', 'Code, attempts, provider and technical log.', '错误码、尝试次数、服务商与技术日志。')],
        [L('Hóa đơn chờ', 'Pending set', '待处理发票'), L('QUEUED/PROCESSING/PENDING và kỳ gần.', 'QUEUED/PROCESSING/PENDING in a recent period.', '近期QUEUED/PROCESSING/PENDING。'), L('Thời điểm cập nhật cuối; không tạo bản mới.', 'Last update time; do not create another.', '最后更新时间；不要新建。')]
      ]),
      bullets(['Tổng trạng thái ở đầu trang dùng để phát hiện; danh sách/chi tiết dùng để xử lý.', 'Một bill hiện chỉ có một HĐĐT bao phủ toàn bộ dòng hàng; trạng thái dòng theo trạng thái bill.', 'Bill có hoàn trả phải kiểm tra cả giao dịch gốc và các dòng/phiếu trả trước khi xử lý HĐĐT.'], ['Top status totals are for detection; list/detail is for action.', 'A bill currently has one e-invoice covering all lines; line status follows bill status.', 'For returned bills, inspect original transaction and all return lines/documents first.'], ['顶部状态汇总用于发现问题；列表/明细用于处理。', '当前一张账单只有一张覆盖全部明细的电子发票；行状态跟随账单状态。', '有退货的账单应先检查原交易及全部退货行/单据。'], true)
    ]),
    sec('invoice-result-check', L('4. Kiểm tra kết quả sau mỗi thao tác', '4. Verify after every invoice action', '4. 每次发票操作后的核验'), [
      bullets(['Đồng bộ: trạng thái và updated_at phải thay đổi hoặc xác nhận vẫn đang chờ.', 'Thử lại: chỉ tạo một lần xử lý mới; không sinh HĐĐT thứ hai cho cùng bill.', 'Gửi email: đúng email người nhận và trạng thái ISSUED.', 'Tải PDF/Tra cứu: số hóa đơn, mẫu/ký hiệu, người mua, tổng tiền khớp chi tiết.', 'Hủy/điều chỉnh/thay thế: giữ liên kết với hóa đơn gốc và lý do/người duyệt.'], ['Sync must update status/time or confirm it is still pending.', 'Retry creates one new attempt, never a second e-invoice for the bill.', 'Email goes to the intended recipient and only for ISSUED.', 'PDF/lookup number, template/symbol, buyer and total match details.', 'Cancel/adjust/replace retains original linkage, reason and approver.'], ['同步后状态/更新时间应变化或确认仍在等待。', '重试只创建一次新处理，不得为同一账单生成第二张发票。', '邮件仅在ISSUED状态发送给正确收件人。', 'PDF/查询中的号码、模板/字轨、购方与总额应一致。', '作废/调整/替换需保留原发票关联、原因与审批人。'], true)
    ])
  ]);

  add('invoice-operations', 20, [
    sec('retry-decision', L('3. Khi nào Đồng bộ, Thử lại hay chuyển Kế toán', '3. Sync, retry or escalate to Accounting', '3. 何时同步、重试或交会计'), [
      table(L(['Dấu hiệu', 'Chọn', 'Điều kiện'], ['Signal', 'Choose', 'Condition'], ['表现', '选择', '条件']), [
        [L('Đang xử lý/chờ provider', 'Processing/provider pending', '处理中/等待服务商'), L('Đồng bộ trạng thái', 'Sync status', '同步状态'), L('Đã chờ đủ thời gian, mạng ổn; không sửa dữ liệu.', 'Reasonable wait elapsed, network is stable; do not alter data.', '已合理等待且网络稳定；不修改数据。')],
        [L('FAILED do dữ liệu/cấu hình đã sửa được', 'FAILED with fixable data/config', 'FAILED且数据/配置可修复'), L('Thử lại', 'Retry', '重试'), L('Đọc log, sửa nguyên nhân, có quyền/PIN và chắc chưa ISSUED.', 'Read log, fix cause, authorize and ensure not ISSUED.', '查看日志、修正原因、取得权限/PIN并确认未ISSUED。')],
        [L('ISSUED nhưng thông tin sai', 'ISSUED with wrong information', 'ISSUED但信息错误'), L('Kế toán xử lý', 'Accounting flow', '会计流程'), L('Lập điều chỉnh/thay thế theo loại hóa đơn; không Retry/Hủy tùy tiện.', 'Use compliant adjustment/replacement; no arbitrary retry/cancel.', '按发票类型调整/替换；不得随意重试/作废。')],
        [L('REVIEW_REQUIRED/returned hold/replacement required', 'Review/return/replacement hold', '需复核/退货/替换限制'), L('Kế toán + nhật ký kỹ thuật', 'Accounting + technical log', '会计+技术日志'), L('Giữ bill và bằng chứng; xử lý có phê duyệt.', 'Preserve bill/evidence and use approved handling.', '保留账单/证据并按审批处理。')]
      ]),
      callout('important', L('Không suy trạng thái từ màn hình cũ', 'Never infer status from a stale screen', '不得根据旧页面推断状态'), 'Trước thao tác nhạy cảm, tải lại chi tiết hoặc Đồng bộ trạng thái. Hóa đơn có thể đã được provider xử lý trong lúc người dùng chờ.', 'Reload details or sync before sensitive action. The provider may have completed the invoice while the user waited.', '敏感操作前刷新明细或同步状态；用户等待期间服务商可能已完成处理。')
    ]),
    sec('technical-log', L('4. Đọc nhật ký kỹ thuật an toàn', '4. Read technical logs safely', '4. 安全阅读技术日志'), [
      bullets(['Ghi request time, provider, HTTP/result code, error code và thông báo đã che bí mật.', 'So payload nghiệp vụ: người mua, tổng, thuế, mẫu/ký hiệu; không sao chép token/mật khẩu.', 'Phân biệt lỗi dữ liệu 4xx, lỗi xác thực/cấu hình, lỗi tạm thời provider/network và lỗi hệ thống.', 'Khi gửi hỗ trợ, chỉ gửi phần cần thiết; che credential, token, tài khoản và dữ liệu cá nhân.', 'Lưu kết luận và hành động đã làm để tránh người sau thử lại trùng.'], ['Record request time, provider, result/HTTP code and redacted error.', 'Compare business payload: buyer, total, tax, template/symbol; never copy credentials.', 'Separate validation 4xx, auth/config, transient provider/network and system errors.', 'Share only necessary evidence with secrets and personal data redacted.', 'Record conclusion/action so the next person does not retry again.'], ['记录请求时间、服务商、HTTP/结果码与脱敏错误。', '比较业务载荷：购方、总额、税率、模板/字轨；不得复制凭据。', '区分数据4xx、认证/配置、服务商/网络临时错误与系统错误。', '向支持提交时仅发送必要证据，并遮盖密钥、账户与个人数据。', '记录结论与已执行操作，避免后续重复重试。'], true)
    ])
  ]);

  add('accounting-setup', 19, [
    sec('tax-review', L('3. Rà soát trước khi kích hoạt thuế/HĐĐT', '3. Review before tax/e-invoice activation', '3. 启用税务/电子发票前复核'), [
      table(L(['Hạng mục', 'Người kiểm', 'Bằng chứng'], ['Area', 'Reviewer', 'Evidence'], ['项目', '复核人', '证据']), [
        [L('Pháp nhân/MST/địa chỉ', 'Legal entity/tax ID/address', '主体/税号/地址'), L('Kế toán hoặc người đại diện.', 'Accounting or legal representative.', '会计或法定代表。'), L('Đăng ký kinh doanh/hồ sơ thuế hiện hành.', 'Current registration/tax record.', '现行登记/税务资料。')],
        [L('Chi nhánh/địa điểm', 'Branches/locations', '门店/经营地点'), L('Kế toán + quản trị hệ thống.', 'Accounting + system admin.', '会计+系统管理员。'), L('Danh sách địa điểm và mapping chi nhánh.', 'Location list and branch mapping.', '经营地点清单与门店映射。')],
        [L('Nhóm doanh thu/thuế suất', 'Revenue group/tax rate', '收入组/税率'), L('Kế toán thuế.', 'Tax accountant.', '税务会计。'), L('Chính sách áp dụng và danh mục được gán.', 'Applicable policy and assigned categories.', '适用政策与已分配分类。')],
        [L('MISA mẫu/ký hiệu', 'MISA template/symbol', 'MISA模板/字轨'), L('Người quản lý HĐĐT.', 'E-invoice owner.', '电子发票负责人。'), L('Trạng thái kết nối và hóa đơn thử.', 'Connection status and test invoice.', '连接状态与测试发票。')],
        [L('Ngân hàng/QR', 'Bank/QR', '银行/二维码'), L('Kế toán quỹ/đối soát.', 'Treasury/reconciliation owner.', '资金/对账负责人。'), L('Giao dịch thử, đúng người nhận và số tiền.', 'Test transaction with correct recipient/amount.', '收款人/金额正确的测试交易。')]
      ]),
      bullets(['Không kích hoạt bằng dữ liệu demo trên production.', 'Không chia sẻ credential MISA/ngân hàng qua ảnh hoặc tài liệu hướng dẫn.', 'Mọi thay đổi sau kích hoạt phải có người yêu cầu, duyệt, giờ thay đổi và kiểm thử sau thay đổi.'], ['Never activate production with demo identity data.', 'Never expose MISA/bank credentials in screenshots or guides.', 'Post-activation changes require requester, approval, timestamp and regression test.'], ['生产环境不得使用演示主体数据启用。', '截图或指南中不得暴露MISA/银行凭据。', '启用后的任何变更都需记录申请人、审批、时间并进行回归测试。'], true)
    ]),
    sec('activation-test', L('4. Bộ kiểm thử kích hoạt', '4. Activation test pack', '4. 启用测试包'), [
      steps(['Tạo bill Retail/F&B có VAT và giảm giá theo mẫu thường gặp.', 'Thu bằng tiền mặt và QR thử; kiểm tra sổ ca/két và giao dịch ngân hàng.', 'Phát hành HĐĐT thử được phép; so từng dòng, thuế và tổng.', 'Kiểm tra link tra cứu, PDF, email và trạng thái trên màn Hóa đơn.', 'Xuất Báo cáo bán hàng, tiền két và HĐĐT; đối chiếu cùng bill.', 'Ghi kết quả đạt/không đạt và chỉ mở vận hành thật khi tất cả mục quan trọng đạt.'], ['Create representative Retail/F&B bills with VAT and discounts.', 'Test cash and QR; verify shift/drawer and bank transaction.', 'Issue a permitted test e-invoice and compare lines, tax and total.', 'Verify lookup link, PDF, email and Invoices status.', 'Export sales, drawer and e-invoice reports and reconcile the same bill.', 'Record pass/fail and go live only after all critical checks pass.'], ['创建具有代表性的含税与折扣零售/餐饮账单。', '测试现金与二维码，核对班次/钱箱及银行交易。', '按允许流程开具测试电子发票并核对明细、税额与总额。', '验证查询链接、PDF、邮件与发票页面状态。', '导出销售、钱箱与电子发票报表并核对同一账单。', '记录通过/失败，关键项全部通过后才正式启用。'])
    ])
  ]);

  add('accounting-shift-cash', 18, [
    sec('drawer-entry', L('3. Ghi thu/chi két đúng cách', '3. Record drawer movements correctly', '3. 正确记录钱箱收支'), [
      table(L(['Nghiệp vụ', 'Thông tin bắt buộc', 'Đối chiếu'], ['Transaction', 'Required data', 'Reconcile'], ['业务', '必填信息', '核对']), [
        [L('Chi tiền', 'Cash expense', '现金支出'), L('Số tiền > 0, lý do, bên nhận/NCC, chứng từ.', 'Amount > 0, reason, recipient/supplier and evidence.', '金额>0、原因、收款方/供应商与凭证。'), L('Không vượt tiền mặt trong két; xuất hiện ở tiền két/chi phí.', 'Must not exceed drawer cash; appears in drawer/expense records.', '不得超过钱箱现金；应出现在钱箱/费用记录。')],
        [L('Hoàn chi', 'Reimbursement', '报销回补'), L('Khoản chi gốc và số còn thiếu.', 'Original expense and outstanding amount.', '原支出与未补金额。'), L('Không hoàn vượt số còn thiếu.', 'Never reimburse above outstanding.', '不得超过未补金额。')],
        [L('Đổi tiền đầu ca', 'Opening-cash change', '修改期初现金'), L('Mật khẩu/PIN quản lý, lý do và số mới.', 'Manager credential, reason and new amount.', '经理凭据、原因与新金额。'), L('Nhật ký thay đổi và chênh trước/sau.', 'Audit log and before/after variance.', '审计日志与前后差异。')],
        [L('Hoàn tiền bill', 'Bill refund', '账单退款'), L('Bill gốc, dòng/số lượng, lý do và quyền.', 'Original bill, lines/quantity, reason and authorization.', '原账单、明细/数量、原因与权限。'), L('Tiền, hàng và báo cáo hoàn cùng liên kết bill gốc.', 'Money, stock and refund report link to original bill.', '资金、库存与退款报表关联原账单。')]
      ])
    ]),
    sec('close-blockers', L('4. Các điều kiện chặn kết ca', '4. Shift-close blockers', '4. 结班阻断条件'), [
      bullets(['Còn bill mở hoặc thanh toán chưa xác định.', 'Còn HĐĐT lỗi/chưa xuất khi chính sách bắt buộc xử lý.', 'Tiền đếm chưa nhập hoặc chênh chưa có lý do/người duyệt.', 'Giao dịch két đang thiếu thông tin/chứng từ.', 'Ca đã được đóng từ thiết bị khác: tải lại, không đóng lặp.'], ['Open bill or uncertain payment.', 'Failed/unissued e-invoice when policy requires resolution.', 'Missing physical count or unexplained/unapproved variance.', 'Incomplete drawer movement/evidence.', 'Shift already closed elsewhere: reload, never close twice.'], ['仍有未结账单或支付状态不明。', '政策要求处理但仍有失败/未开电子发票。', '未录入实点现金或差异无原因/审批。', '钱箱流水信息/凭证不完整。', '班次已在其他设备关闭：刷新，勿重复结班。'], true),
      callout('important', L('Không dùng PIN để bỏ qua đối soát', 'PIN does not replace reconciliation', 'PIN不能替代对账'), 'Quyền quản lý cho phép xác nhận ngoại lệ nhưng không biến chênh lệch thành đúng. Vẫn phải có số đếm, nguyên nhân, bằng chứng và người chịu trách nhiệm.', 'Manager approval authorizes an exception; it does not make a variance correct. Count, cause, evidence and ownership remain required.', '经理审批仅授权例外，不会使差异自动正确；仍需实点数、原因、证据与责任人。')
    ])
  ]);

  add('settings-foundation', 20, [
    sec('setting-control', L('3. Quy trình thay đổi cấu hình production', '3. Production configuration change flow', '3. 生产配置变更流程'), [
      steps(['Ghi yêu cầu: mục nào, chi nhánh nào, lý do, người yêu cầu và thời gian dự kiến.', 'Chụp/ghi giá trị hiện tại và xác định tác động đến POS, Tablet/BYOD, kho, in, thanh toán, HĐĐT và báo cáo.', 'Chọn người duyệt có đúng quyền; thay đổi ngoài giờ cao điểm nếu rủi ro.', 'Chỉ thay một nhóm liên quan tại một thời điểm và lưu.', 'Chạy test nghiệp vụ tương ứng từ đầu đến cuối.', 'Ghi giá trị mới, kết quả và người thực hiện; nếu không đạt, quay lại cấu hình cũ đã ghi.', 'Thông báo cho người dùng bị ảnh hưởng và theo dõi ca đầu sau thay đổi.'], ['Record request, setting, branch, reason, requester and planned time.', 'Capture current value and assess POS, Tablet/BYOD, stock, printing, payment, e-invoice and report impact.', 'Use an authorized approver and avoid peak hours for risky changes.', 'Change one related setting group at a time and save.', 'Run the affected workflow end to end.', 'Record new value/result/actor; roll back to captured value on failure.', 'Notify affected users and monitor the first shift.'], ['记录设置项、门店、原因、申请人及计划时间。', '保存当前值并评估对POS、平板/自带设备 (BYOD)、库存、打印、支付、电子发票与报表的影响。', '由有权限人员审批，高风险变更避开高峰期。', '一次仅修改一组相关配置并保存。', '端到端测试受影响业务。', '记录新值、结果与操作人；失败时恢复已记录旧值。', '通知受影响用户并监控变更后的首个班次。']),
      callout('warn', L('Không thử trực tiếp bằng giao dịch giá trị lớn', 'Never test with a large real transaction', '不得用大额真实交易测试'), 'Dùng dữ liệu demo hoặc giao dịch nhỏ có kiểm soát. Với HĐĐT, tuân thủ môi trường và quy trình thử được kế toán cho phép.', 'Use demo data or a controlled small transaction. For e-invoice, follow the accounting-approved test environment/process.', '使用演示数据或受控小额交易。电子发票测试须遵守会计批准的环境/流程。')
    ]),
    sec('setting-backup', L('4. Hồ sơ cấu hình tối thiểu', '4. Minimum configuration record', '4. 最低配置记录'), [
      bullets(['Danh sách chi nhánh, kho mặc định và kênh bán.', 'Vai trò/quyền và người có PIN duyệt.', 'Phương thức thanh toán, tài khoản nhận tiền và ca/két.', 'Máy in, thiết bị, màn hình khách và tuyến in.', 'MISA/marketplace/ERP: trạng thái, mapping; không ghi bí mật thô.', 'Menu/recipe/giá/thuế và lịch áp dụng.', 'Ngày kiểm tra gần nhất, người kiểm và kết quả.'], ['Branches, default warehouses and channels.', 'Roles/permissions and approval owners.', 'Payment methods, settlement account and shifts/drawer.', 'Printers, devices, customer display and routes.', 'MISA/marketplace/ERP status and mappings, never raw secrets.', 'Menu/recipe/price/tax and schedules.', 'Last review date, reviewer and result.'], ['门店、默认仓库与销售渠道。', '角色/权限及审批PIN负责人。', '支付方式、收款账户与班次/钱箱。', '打印机、设备、顾客显示与路由。', 'MISA/平台/ERP状态与映射，不记录明文密钥。', '菜单/配方/价格/税率与生效时段。', '最近检查日期、检查人及结果。'], true)
    ])
  ]);

  add('settings-print-devices', 18, [
    sec('print-diagnosis', L('3. Chẩn đoán in từ đầu đến cuối', '3. End-to-end print diagnosis', '3. 端到端打印诊断'), [
      steps(['Xác định loại chứng từ không in và mã bill/job.', 'Kiểm tra bill/job đã được tạo trên server hay chưa.', 'Xem tuyến loại phiếu → máy in → thiết bị chủ.', 'Kiểm tra thiết bị chủ online, agent đang chạy và máy in xuất hiện.', 'In test từ đúng thiết bị; kiểm tra giấy, lỗi vật lý, IP/cổng hoặc USB.', 'Nếu job có nhưng chưa xác nhận: thử In lại một lần; không tạo bill mới.', 'Nếu in trùng: kiểm tra nhiều tuyến/agent hoặc người dùng bấm lặp; giữ mã job để kỹ thuật tra.'], ['Identify document type and bill/job ID.', 'Check whether server created the bill/job.', 'Trace document type → printer → host device.', 'Verify host online, agent running and printer discovered.', 'Test from the host; inspect paper, hardware, IP/port or USB.', 'If job exists but unconfirmed, Reprint once; never create a new bill.', 'For duplicates, inspect duplicate routes/agents/retries and retain job ID.'], ['确定未打印单据类型及账单/任务号。', '检查服务器是否已创建账单/打印任务。', '追踪单据类型→打印机→主设备。', '确认主设备在线、代理运行且发现打印机。', '在主设备测试，并检查纸张、硬件、IP/端口或USB。', '任务存在但未确认时只补打一次；不得新建账单。', '重复打印时检查重复路由/代理/重试，并保留任务号。']),
      table(L(['Lỗi', 'Nguyên nhân thường gặp', 'Cách xử lý'], ['Issue', 'Common cause', 'Resolution'], ['问题', '常见原因', '处理']), [
        [L('Không có job', 'No job', '无任务'), L('Chưa cấu hình loại phiếu hoặc nghiệp vụ chưa hoàn tất.', 'No route or business action incomplete.', '未配置路由或业务尚未完成。'), L('Kiểm tra cấu hình và trạng thái bill.', 'Check route and bill state.', '检查路由与账单状态。')],
        [L('Job chờ mãi', 'Job stuck', '任务一直等待'), L('Agent/thiết bị offline hoặc job không thuộc máy.', 'Agent/device offline or wrong owner device.', '代理/设备离线或任务归属错误。'), L('Mở đúng agent, báo danh và tải lại.', 'Start correct agent, register and reload.', '启动正确代理、重新上报并刷新。')],
        [L('In sai máy', 'Wrong printer', '打印到错误设备'), L('Sai tuyến hoặc tên máy in thay đổi.', 'Wrong route or changed printer name.', '路由错误或打印机名称变化。'), L('Chọn lại máy in và in test từng loại.', 'Remap and test each type.', '重新映射并逐类测试。')],
        [L('Mở két không chạy', 'Drawer does not open', '钱箱不开'), L('Cần máy in bill LAN/IP ESC/POS và lệnh đúng.', 'Requires compatible receipt printer/routing.', '需要兼容的小票打印机/路由。'), L('Kiểm tra kết nối và test lệnh tại máy chủ.', 'Check connection and test on host.', '检查连接并在主设备测试。')]
      ])
    ]),
    sec('device-security', L('4. An toàn thiết bị khách', '4. Guest-device security', '4. 顾客设备安全'), [
      bullets(['Mỗi thiết bị có định danh rõ, tên dễ nhận biết và đúng chi nhánh.', 'Mật khẩu/PIN kiosk không dùng chung với PIN cá nhân quản lý.', 'Thu hồi/đổi QR BYOD khi bàn/thiết bị thay đổi hoặc nghi bị chụp phát tán.', 'Không hiện thông báo nội bộ, dữ liệu khách khác hay nút quản trị trên màn khách.', 'Sau cập nhật app, test lại thoát kiosk, gọi món, gọi nhân viên và yêu cầu thanh toán.'], ['Give every device a clear identity/name and correct branch.', 'Kiosk password must not reuse a manager personal PIN.', 'Rotate/revoke BYOD QR after table/device change or suspected leakage.', 'Never show internal alerts, other-customer data or admin actions to guests.', 'After app update, retest kiosk exit, ordering, staff call and payment request.'], ['每台设备应有清晰标识/名称并绑定正确门店。', '自助设备密码不得复用经理个人PIN。', '桌台/设备变更或疑似泄露时撤销/更换自带设备 (BYOD) 二维码。', '顾客屏不得显示内部提醒、其他客户数据或管理操作。', '应用更新后重新测试退出自助、点餐、呼叫服务员与结账请求。'], true)
    ])
  ]);

  add('settings-integrations', 20, [
    sec('integration-matrix', L('3. Checklist theo loại liên kết', '3. Checklist by integration type', '3. 按集成类型检查'), [
      table(L(['Liên kết', 'Trước khi bật', 'Test bắt buộc'], ['Integration', 'Before enable', 'Required test'], ['集成', '启用前', '必测']), [
        [L('MISA meInvoice', 'MISA meInvoice', 'MISA电子发票'), L('MST, credential, mẫu/ký hiệu, loại nghiệp vụ.', 'Tax ID, credentials, template/symbol and invoice type.', '税号、凭据、模板/字轨与发票类型。'), L('Phát hành, tra cứu, PDF/email và trạng thái lỗi.', 'Issue, lookup, PDF/email and failure state.', '开具、查询、PDF/邮件与失败状态。')],
        [L('QR/SePay/Casso/PayOS', 'QR/SePay/Casso/PayOS', '二维码/SePay/Casso/PayOS'), L('Tài khoản nhận, API/webhook secret và chi nhánh.', 'Settlement account, API/webhook secret and branch.', '收款账户、API/回调密钥与门店。'), L('Đúng số tiền, tự xác nhận một lần và chống thu trùng.', 'Correct amount, single auto-confirmation and duplicate prevention.', '金额正确、仅自动确认一次并防重复收款。')],
        [L('Marketplace', 'Marketplace', '电商平台'), L('Tài khoản chủ shop, scope, callback, mapping shop–chi nhánh–kho.', 'Owner account, scopes, callback and shop/branch/warehouse mapping.', '店主账号、权限范围、回调及店铺/门店/仓库映射。'), L('Nhận đơn, map SKU, trạng thái, hủy/hoàn và đối soát.', 'Order receive, SKU map, status, cancel/refund and reconciliation.', '接单、SKU映射、状态、取消/退款与对账。')],
        [L('ERP/Cloud sync', 'ERP/Cloud sync', 'ERP/云同步'), L('Endpoint, quyền, chi nhánh và nguồn dữ liệu chuẩn.', 'Endpoint, authorization, branch and source of truth.', '端点、权限、门店与主数据源。'), L('Một thay đổi mỗi chiều, mất mạng/khôi phục và chống trùng.', 'One change each direction, outage/recovery and deduplication.', '双向单次变更、断网/恢复与去重。')]
      ])
    ]),
    sec('integration-incident', L('4. Xử lý sự cố liên kết', '4. Integration incident handling', '4. 集成故障处理'), [
      steps(['Tạm dừng thao tác có thể tạo giao dịch trùng, nhưng không xóa dữ liệu cũ.', 'Ghi provider, chi nhánh/shop, mã đơn/giao dịch, lỗi và thời điểm.', 'Kiểm tra trạng thái kết nối, token/scope/webhook và mapping.', 'Xác định dữ liệu đã tới bên nào; chọn một nguồn sự thật theo nghiệp vụ.', 'Khôi phục credential/kết nối rồi chạy một giao dịch thử có kiểm soát.', 'Đối soát các giao dịch trong khoảng sự cố và xử lý thiếu/trùng riêng từng mã.', 'Ghi kết luận; chỉ mở lại tự động khi test đạt.'], ['Pause actions that may duplicate transactions; never delete old data.', 'Record provider, branch/shop, order/transaction, error and time.', 'Check connection, token/scope/webhook and mappings.', 'Determine which side received data and choose the business source of truth.', 'Restore credentials/connectivity and run one controlled test.', 'Reconcile the incident window and resolve each missing/duplicate ID.', 'Document conclusion and resume automation only after a pass.'], ['暂停可能产生重复交易的操作，但不得删除旧数据。', '记录服务商、门店/店铺、订单/交易号、错误与时间。', '检查连接、令牌/权限/回调与映射。', '确认数据到达哪一端，并按业务选择主数据源。', '恢复凭据/连接后进行一次受控测试。', '对账故障时间段，逐个处理缺失/重复编号。', '记录结论，测试通过后才恢复自动化。'])
    ])
  ]);

  add('troubleshooting-first-response', 15, [
    sec('severity', L('3. Phân loại mức độ và đường xử lý', '3. Severity and escalation', '3. 严重程度与升级路径'), [
      table(L(['Mức', 'Ví dụ', 'Hành động'], ['Level', 'Example', 'Action'], ['级别', '示例', '行动']), [
        [L('P1 — Dừng bán/rủi ro tiền dữ liệu', 'P1 — Sales stopped/data-money risk', 'P1—停业/资金数据风险'), L('Không vào hệ thống toàn cửa hàng, DB lỗi, thu trùng hàng loạt, mất dữ liệu.', 'Store-wide outage, DB error, widespread duplicate charges or data loss.', '全店不可用、数据库错误、大面积重复收款或数据丢失。'), L('Dừng thao tác liên quan, giữ bằng chứng, báo kỹ thuật/quản lý ngay; dùng quy trình dự phòng được duyệt.', 'Stop affected actions, preserve evidence, escalate immediately and use approved contingency.', '停止相关操作、保留证据、立即升级并使用已批准应急流程。')],
        [L('P2 — Một chức năng chính bị chặn', 'P2 — Major function blocked', 'P2—主要功能受阻'), L('Không thanh toán QR, không in bếp, HĐĐT lỗi nhiều bill.', 'QR payment, kitchen print or e-invoice blocked for multiple bills.', '多个账单二维码支付、厨房打印或电子发票受阻。'), L('Khoanh thiết bị/kênh, chuyển phương án an toàn và xử lý trong ca.', 'Isolate device/channel, use safe alternative and resolve during shift.', '隔离设备/渠道，使用安全替代方案并在班次内处理。')],
        [L('P3 — Một giao dịch/người dùng', 'P3 — Single transaction/user', 'P3—单笔交易/单用户'), L('Một bill xung đột, sai quyền, một máy in lỗi.', 'One bill conflict, permission issue or one printer failure.', '单张账单冲突、权限问题或单台打印机故障。'), L('Làm theo bài lỗi tương ứng, ghi mã và theo dõi.', 'Follow the relevant guide, record code and monitor.', '按对应指南处理、记录错误码并监控。')],
        [L('P4 — Hỏi cách dùng/cải tiến', 'P4 — How-to/improvement', 'P4—使用咨询/改进'), L('Không ảnh hưởng giao dịch hiện tại.', 'No current transaction impact.', '不影响当前交易。'), L('Ghi yêu cầu, xử lý theo kế hoạch; không thay cấu hình giữa giờ cao điểm.', 'Log for planned handling; avoid peak-hour configuration changes.', '记录并计划处理；高峰期不改配置。')]
      ]),
      callout('important', L('Bảo toàn bằng chứng', 'Preserve evidence', '保留证据'), 'Không xóa app, log, bill, job in, HĐĐT hay chứng từ trước khi ghi mã/thời điểm và kiểm tra server. Việc “dọn cho sạch” có thể làm mất dấu nguyên nhân.', 'Do not delete app data, logs, bills, print jobs, e-invoices or documents before recording IDs/time and checking server. Cleanup can destroy the cause trail.', '记录编号/时间并检查服务器前，不得删除应用数据、日志、账单、打印任务、电子发票或单据；“清理”可能破坏原因链。')
    ]),
    sec('support-package', L('4. Bộ thông tin gửi hỗ trợ', '4. Support evidence package', '4. 提交支持的信息包'), [
      bullets(['Một câu mô tả kết quả mong đợi và kết quả thực tế.', 'Môi trường/domain, chi nhánh, thiết bị, hệ điều hành và phiên bản app.', 'Vai trò người dùng; không gửi PIN/mật khẩu/token.', 'Mã bill/order/payment/invoice/document/print job.', 'Ảnh hoặc video từ trước khi bấm đến lúc lỗi; che dữ liệu nhạy cảm.', 'Giờ địa phương chính xác và mạng đang dùng.', 'Các bước đã thử và kết quả từng bước.'], ['Expected vs actual in one sentence.', 'Environment/domain, branch, device, OS and app version.', 'User role; never PIN/password/token.', 'Bill/order/payment/invoice/document/print-job IDs.', 'Screenshot/video from before action to error, with sensitive data redacted.', 'Exact local time and network.', 'Steps already tried and each result.'], ['一句话说明预期与实际结果。', '环境/域名、门店、设备、系统与应用版本。', '用户角色；不得发送PIN/密码/令牌。', '账单/订单/支付/发票/单据/打印任务编号。', '从操作前到报错的截图/视频，并遮盖敏感数据。', '准确本地时间与所用网络。', '已尝试步骤及每步结果。'], true)
    ])
  ]);

  add('troubleshooting-devices', 19, [
    sec('network-device-matrix', L('3. Ma trận kiểm tra mạng và thiết bị', '3. Network and device matrix', '3. 网络与设备检查矩阵'), [
      table(L(['Lớp', 'Desktop', 'Tablet', 'BYOD'], ['Layer', 'Desktop', 'Tablet', 'BYOD'], ['层级', '桌面端', '平板端', '自带设备 (BYOD)']), [
        [L('Server', 'Server', '服务器'), L('Mở health/domain và đăng nhập.', 'Open health/domain and sign in.', '打开健康页/域名并登录。'), L('Kiểm tra server URL/chi nhánh.', 'Verify server URL/branch.', '检查服务器URL/门店。'), L('QR phải trỏ đúng domain/tenant.', 'QR must target correct domain/tenant.', '二维码须指向正确域名/租户。')],
        [L('Mạng', 'Network', '网络'), L('LAN/DNS/firewall và giờ máy.', 'LAN/DNS/firewall and clock.', '局域网/DNS/防火墙与时间。'), L('Wi-Fi ổn định, không captive portal.', 'Stable Wi-Fi, no captive portal.', '稳定Wi-Fi且无认证门户。'), L('4G/Wi-Fi khách truy cập HTTPS được.', 'Guest 4G/Wi-Fi can reach HTTPS.', '顾客4G/Wi-Fi可访问HTTPS。')],
        [L('Phiên', 'Session', '会话'), L('Đúng người/chi nhánh/ca.', 'Correct user/branch/shift.', '正确用户/门店/班次。'), L('Đúng chế độ nhân viên/kiosk.', 'Correct staff/kiosk mode.', '正确员工/自助模式。'), L('QR generation còn hiệu lực và bill chưa đóng.', 'QR generation active and bill open.', '二维码代次有效且账单未关闭。')],
        [L('Realtime', 'Realtime', '实时'), L('Bàn/KDS/đơn chờ cập nhật.', 'Tables/KDS/pending update.', '桌台/KDS/待处理更新。'), L('Đơn gửi hiện trên POS.', 'Sent order appears on POS.', '发送订单出现在POS。'), L('Giỏ/yêu cầu hiển thị cho nhân viên.', 'Cart/request reaches staff.', '购物车/请求到达员工端。')]
      ]),
      steps(['Thử tải lại đúng một lần sau khi ghi bằng chứng.', 'So cùng dữ liệu trên một thiết bị khác để tách lỗi tài khoản/dữ liệu với lỗi thiết bị.', 'Đổi mạng chỉ để chẩn đoán; không thanh toán lặp khi trạng thái chưa rõ.', 'Nếu chỉ một thiết bị lỗi, ghi model/OS/version và cài đặt quyền mạng/thông báo.', 'Nếu mọi thiết bị lỗi, nâng mức sự cố lên server/network.'], ['Reload once after capturing evidence.', 'Compare the same data on another device to separate account/data from device.', 'Change network only for diagnosis; never repeat uncertain payment.', 'For one-device faults, record model/OS/version and network/notification permissions.', 'If all devices fail, escalate as server/network.'], ['记录证据后仅刷新一次。', '在另一设备查看同一数据，区分账号/数据与设备问题。', '切换网络仅用于诊断；支付状态不明时不得重复。', '仅一台设备故障时记录型号/系统/版本及网络/通知权限。', '所有设备都失败时按服务器/网络故障升级。'])
    ]),
    sec('update-recovery', L('4. Sau cập nhật ứng dụng', '4. After an app update', '4. 应用更新后'), [
      bullets(['Xác nhận phiên bản mới và đúng kênh Desktop/Tablet/Mobile.', 'Đăng nhập, chọn chi nhánh và mở đúng module.', 'Test một luồng không tiền trước: xem hàng/bàn, gửi món thử nếu môi trường cho phép.', 'Test in/realtime/camera/quét mã theo thiết bị.', 'Chỉ sau đó test thanh toán nhỏ có kiểm soát.', 'Nếu lỗi, ghi phiên bản cũ/mới và không tự cài nhiều gói chồng nhau.'], ['Confirm new version and correct Desktop/Tablet/Mobile channel.', 'Sign in, choose branch and open expected modules.', 'Test a no-money flow first.', 'Test print/realtime/camera/scanner by device.', 'Then run a controlled small payment.', 'On failure, record old/new versions and do not stack installers.'], ['确认新版本及正确的桌面/平板/手机渠道。', '登录、选择门店并打开预期模块。', '先测试不涉及资金的流程。', '按设备测试打印/实时/相机/扫码。', '再进行受控小额支付测试。', '失败时记录旧/新版本，不要叠加安装多个包。'], true)
    ])
  ]);

  add('troubleshooting-codes', 24, [
    sec('use-code', L('3. Cách dùng mã lỗi để xử lý', '3. Use error codes operationally', '3. 在运营中使用错误码'), [
      steps(['Sao chép nguyên mã viết hoa và thông báo kèm theo.', 'Tìm mã trong bảng/CSV; đọc module và lớp thiết bị.', 'Áp phản ứng chuẩn của nhóm trước, sau đó đọc thông báo cụ thể để biết đối tượng.', 'Kiểm tra trạng thái server/lịch sử trước khi thử lại thao tác tiền, tồn hoặc HĐĐT.', 'Ghi mã đối tượng và kết quả sau xử lý.', 'Nếu lặp lại, gửi mã + source module + thời điểm; không chỉ gửi ảnh “có lỗi”.'], ['Copy the exact uppercase code and accompanying message.', 'Find it in the table/CSV and note module/device layer.', 'Apply family response, then use detailed message for the affected object.', 'Check server/history before retrying money, stock or e-invoice actions.', 'Record object ID and post-action result.', 'If repeated, send code, module and time, not merely an error screenshot.'], ['复制完整大写错误码与附带信息。', '在表格/CSV中查找并记录模块/设备层。', '先执行分类标准处理，再根据详细信息确定对象。', '重试资金、库存或电子发票操作前检查服务器/历史。', '记录对象编号与处理结果。', '重复时提交错误码、模块与时间，不要只发“有错误”的截图。']),
      table(L(['Tiền tố/từ khóa', 'Ưu tiên kiểm tra'], ['Prefix/keyword', 'Check first'], ['前缀/关键字', '优先检查']), [
        ['ORDER / CART / EDIT_LEASE', L('Bill/giỏ hiện tại, thiết bị khác và lịch sử thanh toán.', 'Current bill/cart, other device and payment history.', '当前账单/购物车、其他设备与支付历史。')],
        ['PAYMENT / ALREADY_SETTLED', L('Provider/ngân hàng, tham chiếu và trạng thái paid.', 'Provider/bank, reference and paid status.', '服务商/银行、参考号与付款状态。')],
        ['INVOICE / EINVOICE / BUYER / MISSING_', L('Người mua, mẫu/ký hiệu, TransactionID và trạng thái provider.', 'Buyer, template/symbol, TransactionID and provider state.', '购方、模板/字轨、TransactionID与服务商状态。')],
        ['APPROVAL / PERM / TAKEOVER', L('Vai trò, chi nhánh, phạm vi và lượt duyệt còn hạn.', 'Role, branch, scope and fresh approval.', '角色、门店、范围与有效审批。')],
        ['SYNC / OFFLINE / STORE_', L('Chế độ online-only, mạng, branch/edge và nguồn sự thật.', 'Online-only mode, network, branch/edge and source of truth.', '仅在线模式、网络、门店/边缘与主数据源。')],
        ['MARKETPLACE / HARAVAN / TIKTOK / ONLINE_', L('Token/scope, shop mapping, webhook và SKU mapping.', 'Token/scope, shop mapping, webhook and SKU mapping.', '令牌/权限、店铺映射、回调与SKU映射。')]
      ])
    ]),
    sec('catalog-coverage', L('4. Phạm vi của file CSV', '4. CSV catalog coverage', '4. CSV目录覆盖范围'), [
      bullets(['`error_code`: mã ổn định nên dùng để dashboard/cảnh báo và tài liệu.', '`backend_message`: thông báo nghiệp vụ có thể chứa biến như bill, SKU, tiền hoặc provider.', '`client_message`: kiểm tra/nhắc lỗi phát sinh trực tiếp ở ứng dụng.', '`device_layer`: nơi lỗi có thể được tạo/hiển thị; Backend/all clients không có nghĩa mọi thiết bị đều có cùng nút.', '`source`: file:dòng tại thời điểm sinh catalog, dùng cho kỹ thuật; có thể đổi sau refactor.', 'Catalog là snapshot theo source hiện tại; chạy generator sau mỗi release.'], ['`error_code`: stable key for dashboards, alerts and documentation.', '`backend_message`: business message that may interpolate bill, SKU, amount or provider.', '`client_message`: validation/error generated in the app.', '`device_layer`: origin/display layer; Backend/all clients does not imply identical UI buttons.', '`source`: file:line at generation time for engineers and may move after refactor.', 'The catalog is a source snapshot; regenerate each release.'], ['`error_code`：用于仪表板、告警与文档的稳定键。', '`backend_message`：可能插入账单、SKU、金额或服务商的业务信息。', '`client_message`：应用端生成的校验/错误。', '`device_layer`：产生/显示层；Backend/all clients不表示各设备按钮相同。', '`source`：生成时的文件:行号，重构后可能变化。', '目录是当前源码快照；每次发布后重新生成。'], true)
    ])
  ]);

  add('mobile-placeholder', 10, [
    sec('acceptance', L('3. Tiêu chí để Mobile chuyển sang chính thức', '3. Phone documentation acceptance criteria', '3. 手机文档转正式的验收标准'), [
      bullets(['Chốt danh sách module thật sự phát hành trên Phone và quyền tương ứng.', 'Test trên ít nhất một Android màn nhỏ và một thiết bị kích thước phổ biến; iOS nếu có phát hành.', 'Mỗi luồng có điều kiện trước, từng bước, kết quả và phục hồi lỗi.', 'Ảnh đúng Phone, không dùng ảnh Desktop/Tablet; che dữ liệu nhạy cảm.', 'Kiểm tra bán Retail một tay, khách hàng, trả hàng, ca, kho/chứng từ, hóa đơn và máy in hỗ trợ.', 'Đối chiếu hành vi đa thiết bị với Desktop/Tablet, nhất là khóa bill và thanh toán.', 'Hoàn thành ba ngôn ngữ, URL, tìm kiếm và kiểm tra responsive.', 'Được người phụ trách nghiệp vụ nghiệm thu trước khi bỏ nhãn “sắp ra mắt”.'], ['Finalize released Phone modules and permissions.', 'Test at least one small Android and one common-size device; iOS if released.', 'Every flow includes prerequisites, steps, expected result and recovery.', 'Use real Phone screenshots, never relabeled Desktop/Tablet, with data redacted.', 'Test one-hand Retail, customers, returns, shifts, warehouse/documents, invoices and supported printing.', 'Reconcile multi-device behavior with Desktop/Tablet, especially bill locks and payment.', 'Complete all languages, URLs, search and responsive QA.', 'Obtain business-owner acceptance before removing “coming soon”.'], ['确定手机端正式发布模块与权限。', '至少测试一台小屏Android和一台常见尺寸设备；发布iOS时也需测试。', '每个流程包含前置条件、步骤、预期结果与恢复方式。', '使用真实手机截图，不得改标桌面/平板截图，并遮盖敏感数据。', '测试单手零售、客户、退货、班次、仓库/单据、发票与支持的打印。', '与桌面/平板核对多设备行为，尤其账单锁与支付。', '完成三语、网址、搜索与响应式QA。', '经业务负责人验收后才移除“即将推出”。'], true)
    ]),
    sec('mobile-error-plan', L('4. Lỗi Mobile phải có bài riêng', '4. Phone-specific issue plan', '4. 手机专项故障规划'), [
      table(L(['Nhóm lỗi', 'Phải kiểm tra'], ['Issue area', 'Required checks'], ['故障组', '必须检查']), [
        [L('Quyền hệ điều hành', 'OS permissions', '系统权限'), L('Camera/quét mã, thông báo, tệp, cài APK và chạy nền.', 'Camera/scanner, notifications, files, APK install and background.', '相机/扫码、通知、文件、APK安装与后台运行。')],
        [L('Mạng di động/Wi-Fi', 'Mobile/Wi-Fi', '移动网络/Wi-Fi'), L('Đổi mạng, captive portal, DNS, HTTPS và giờ máy.', 'Network switch, captive portal, DNS, HTTPS and clock.', '切换网络、认证门户、DNS、HTTPS与系统时间。')],
        [L('In cầm tay', 'Handheld printing', '手持打印'), L('Sunmi/Bluetooth/LAN, quyền và trạng thái job.', 'Sunmi/Bluetooth/LAN, permission and job status.', 'Sunmi/蓝牙/LAN、权限与任务状态。')],
        [L('Cập nhật', 'Update', '更新'), L('Đúng kênh android-phone, quyền cài nguồn ngoài và dung lượng.', 'Correct android-phone channel, sideload permission and storage.', '正确android-phone渠道、未知来源安装权限与存储。')],
        [L('Bán hàng', 'Selling', '销售'), L('Tồn, bill lock, QR, auto-confirm, in sau thu và chống thu trùng.', 'Stock, bill lock, QR, auto-confirm, post-payment print and duplicate prevention.', '库存、账单锁、二维码、自动确认、付款后打印与防重复收款。')]
      ])
    ])
  ]);

  data.ui.vi.imageOpen = 'Bấm để phóng to';
  data.ui.vi.imageActual = 'Kích thước thật';
  data.ui.vi.imageFit = 'Thu vừa màn hình';
  data.ui.en.imageOpen = 'Click to enlarge';
  data.ui.en.imageActual = 'Actual size';
  data.ui.en.imageFit = 'Fit to screen';
  data.ui.zh.imageOpen = '点击放大';
  data.ui.zh.imageActual = '实际大小';
  data.ui.zh.imageFit = '适应屏幕';
})();
