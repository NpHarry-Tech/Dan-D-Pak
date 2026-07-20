import '../../utils/translation.dart';
// Chuỗi giao diện iPad Self-Order — 5 ngôn ngữ (Việt / Anh / Trung / Nhật / Hàn).
// Màn CHỌN BÀN là màn của nhân viên nên cố định tiếng Việt, không nằm ở đây.

class SelfOrderLang {
  final String code;
  final String flag;
  final String nativeName;

  // Màn chọn ngôn ngữ
  final String greetTitle;
  final String greetSub;
  final String btnStart;

  // Màn nhập số điện thoại
  final String phoneTitle;
  final String phoneSub;
  final String phoneHint;
  final String btnSkip;
  final String btnContinue;
  final String phoneInvalid;
  final String memberHello; // %s = tên khách
  final String memberNew;
  final String pointsLabel;

  // Màn chọn món
  final String menuTitle;
  final String allCategory;
  final String reorderTitle;
  final String cartEmpty;
  final String cartTitle;
  final String totalLabel;
  final String sendKitchenBtn;
  final String clearCartBtn;
  final String callStaffBtn;
  final String sentOk;
  final String checkoutBtn;
  final String needSendFirst;
  final String addToCartBtn;
  final String itemInfoTitle;
  final String priceLabel;
  final String categoryLabel;
  final String descriptionLabel;
  final String codeLabel;
  final String ingredientsLabel;
  final String allergensLabel;
  final String optionsLabel;
  final String addonsLabel;
  final String prepTimeLabel;
  final String minutesSuffix;

  // Màn thanh toán
  final String payTitle;
  final String totalDue;
  final String payCash;
  final String payTransfer;
  final String payCard;
  final String staffComing;
  final String qrTitle;
  final String qrWaiting;
  final String paidOk;
  final String backBtn;

  // Hóa đơn điện tử
  final String askInvoiceTitle;
  final String askInvoiceSub;
  final String invoiceYes;
  final String invoiceNo;
  final String taxCodeLabel;
  final String lookupBtn;
  final String companyLabel;
  final String addressLabel;
  final String emailLabel;
  final String contactPhoneLabel;
  final String submitInvoiceBtn;
  final String invoiceDone;

  // Cảm ơn
  final String thanksTitle;
  final String thanksSub;

  // Mục t("Món đã gửi bếp") — trạng thái từng món realtime theo KDS.
  // Optional với mặc định tiếng Việt để khỏi phá 5 constructor cũ.
  final String sentItemsTitle;
  final String stWaitConfirm;
  final String stQueued;
  final String stPreparing;
  final String stReady;
  final String stServed;
  final String stCancelled;

  SelfOrderLang({
    required this.code,
    required this.flag,
    required this.nativeName,
    required this.greetTitle,
    required this.greetSub,
    required this.btnStart,
    required this.phoneTitle,
    required this.phoneSub,
    required this.phoneHint,
    required this.btnSkip,
    required this.btnContinue,
    required this.phoneInvalid,
    required this.memberHello,
    required this.memberNew,
    required this.pointsLabel,
    required this.menuTitle,
    required this.allCategory,
    required this.reorderTitle,
    required this.cartEmpty,
    required this.cartTitle,
    required this.totalLabel,
    required this.sendKitchenBtn,
    required this.clearCartBtn,
    required this.callStaffBtn,
    required this.sentOk,
    required this.checkoutBtn,
    required this.needSendFirst,
    this.addToCartBtn = 'Thêm vào giỏ hàng',
    this.itemInfoTitle = 'Thông tin món',
    this.priceLabel = 'Giá',
    this.categoryLabel = 'Danh mục',
    this.descriptionLabel = 'Mô tả',
    this.codeLabel = 'Mã món',
    this.ingredientsLabel = 'Thành phần',
    this.allergensLabel = 'Dị ứng',
    this.optionsLabel = 'Tùy chọn',
    this.addonsLabel = 'Món thêm',
    this.prepTimeLabel = 'Thời gian chuẩn bị',
    this.minutesSuffix = 'phút',
    required this.payTitle,
    required this.totalDue,
    required this.payCash,
    required this.payTransfer,
    required this.payCard,
    required this.staffComing,
    required this.qrTitle,
    required this.qrWaiting,
    required this.paidOk,
    required this.backBtn,
    required this.askInvoiceTitle,
    required this.askInvoiceSub,
    required this.invoiceYes,
    required this.invoiceNo,
    required this.taxCodeLabel,
    required this.lookupBtn,
    required this.companyLabel,
    required this.addressLabel,
    required this.emailLabel,
    required this.contactPhoneLabel,
    required this.submitInvoiceBtn,
    required this.invoiceDone,
    required this.thanksTitle,
    required this.thanksSub,
    this.sentItemsTitle = 'Món đã gửi bếp',
    this.stWaitConfirm = 'Chờ xác nhận',
    this.stQueued = 'Bếp đã nhận',
    this.stPreparing = 'Đang chế biến',
    this.stReady = 'Đã xong',
    this.stServed = 'Đã phục vụ',
    this.stCancelled = 'Đã hủy',
  });

  /// Nhãn trạng thái món (khớp trạng thái KDS phía server).
  String itemStatusLabel(String status) {
    switch (status) {
      case 'pending_confirm':
        return stWaitConfirm;
      case 'new':
      case 'accepted':
        return stQueued;
      case 'preparing':
        return stPreparing;
      case 'ready':
        return stReady;
      case 'served':
        return stServed;
      case 'cancelled':
        return stCancelled;
    }
    return status;
  }

  String categoryName(String name) {
    final key = name.trim().toLowerCase();
    if (key.isEmpty) return name;
    final table = _categoryNames[code];
    return table?[key] ?? name;
  }
}

const _categoryNames = <String, Map<String, String>>{
  'en': {
    'mì & hủ tiếu': 'Noodles',
    'mi & hu tieu': 'Noodles',
    'ăn sáng': 'Breakfast',
    'an sang': 'Breakfast',
    'cơm': 'Rice',
    'com': 'Rice',
    'tráng miệng': 'Dessert',
    'trang mieng': 'Dessert',
    'thức uống': 'Drinks',
    'thuc uong': 'Drinks',
  },
  'zh': {
    'mì & hủ tiếu': '面条',
    'mi & hu tieu': '面条',
    'ăn sáng': '早餐',
    'an sang': '早餐',
    'cơm': '米饭',
    'com': '米饭',
    'tráng miệng': '甜点',
    'trang mieng': '甜点',
    'thức uống': '饮品',
    'thuc uong': '饮品',
  },
  'ja': {
    'mì & hủ tiếu': '麺類',
    'mi & hu tieu': '麺類',
    'ăn sáng': '朝食',
    'an sang': '朝食',
    'cơm': 'ご飯',
    'com': 'ご飯',
    'tráng miệng': 'デザート',
    'trang mieng': 'デザート',
    'thức uống': 'ドリンク',
    'thuc uong': 'ドリンク',
  },
  'ko': {
    'mì & hủ tiếu': '면류',
    'mi & hu tieu': '면류',
    'ăn sáng': '아침 식사',
    'an sang': '아침 식사',
    'cơm': '밥',
    'com': '밥',
    'tráng miệng': '디저트',
    'trang mieng': '디저트',
    'thức uống': '음료',
    'thuc uong': '음료',
  },
};

List<SelfOrderLang> kSelfOrderLangs = [
  SelfOrderLang(
    code: 'vi',
    flag: '🇻🇳',
    nativeName: t('Tiếng Việt'),
    greetTitle: t('Chào mừng quý khách!'),
    greetSub: t('Chọn ngôn ngữ để bắt đầu'),
    btnStart: t('Tiếp tục →'),
    phoneTitle: t('Nhập số điện thoại'),
    phoneSub:
        t('Tích điểm thành viên và lưu món bạn yêu thích (không bắt buộc)'),
    phoneHint: t('Ví dụ: 0901234567'),
    btnSkip: t('Bỏ qua & Gọi món'),
    btnContinue: t('Tiếp tục →'),
    phoneInvalid: t('Số điện thoại chưa đúng, vui lòng kiểm tra lại'),
    memberHello: t('Xin chào %s!'),
    memberNew: t('Đã tạo thẻ thành viên cho bạn 🎉'),
    pointsLabel: t('Điểm tích lũy'),
    menuTitle: t('Thực đơn'),
    allCategory: t('Tất cả'),
    reorderTitle: t('⭐ Món bạn hay gọi — chạm để gọi lại'),
    cartEmpty: t('Chưa chọn món ăn nào'),
    cartTitle: t('Giỏ hàng'),
    totalLabel: t('Tổng'),
    sendKitchenBtn: t('GỬI BẾP'),
    clearCartBtn: t('Xóa hết'),
    callStaffBtn: t('Gọi nhân viên'),
    sentOk: t('Đã gửi món cho bếp!'),
    checkoutBtn: t('THANH TOÁN'),
    needSendFirst: t('Bạn chưa gọi món nào'),
    payTitle: t('Chọn cách thanh toán'),
    totalDue: t('Tổng cần thanh toán'),
    payCash: t('Tiền mặt'),
    payTransfer: t('Chuyển khoản'),
    payCard: t('Quẹt thẻ'),
    staffComing: t('Nhân viên sẽ đến hỗ trợ bạn ngay. Xin chờ trong giây lát!'),
    qrTitle: t('Quét mã QR để thanh toán'),
    qrWaiting: t('Đang chờ thanh toán…'),
    paidOk: t('Đã nhận thanh toán. Cảm ơn quý khách!'),
    backBtn: t('← Quay lại'),
    askInvoiceTitle: t('Xuất hóa đơn công ty (VAT)?'),
    askInvoiceSub: t('Nhập mã số thuế để nhận hóa đơn điện tử qua email'),
    invoiceYes: t('Có, xuất hóa đơn'),
    invoiceNo: t('Không, cảm ơn'),
    taxCodeLabel: t('Mã số thuế'),
    lookupBtn: t('Truy xuất'),
    companyLabel: t('Tên công ty'),
    addressLabel: t('Địa chỉ'),
    emailLabel: t('Email nhận hóa đơn'),
    contactPhoneLabel: t('Số điện thoại liên hệ'),
    submitInvoiceBtn: t('Xuất hóa đơn'),
    invoiceDone:
        t('Đã ghi nhận! Hóa đơn điện tử sẽ được gửi về email của bạn.'),
    thanksTitle: t('Cảm ơn quý khách!'),
    thanksSub: t('Hẹn gặp lại quý khách lần sau 💙'),
  ),
  SelfOrderLang(
    code: 'en',
    flag: '🇬🇧',
    nativeName: 'English',
    greetTitle: 'Welcome!',
    greetSub: 'Choose your language to start',
    btnStart: 'Continue →',
    phoneTitle: 'Enter your phone number',
    phoneSub: 'Earn reward points and save your favorites (optional)',
    phoneHint: 'e.g. 0901234567',
    btnSkip: 'Skip & Order',
    btnContinue: 'Continue →',
    phoneInvalid: 'Invalid phone number, please check again',
    memberHello: 'Hello %s!',
    memberNew: 'Your membership card has been created 🎉',
    pointsLabel: 'Reward points',
    menuTitle: 'Menu',
    allCategory: 'All',
    reorderTitle: '⭐ Your favorites — tap to reorder',
    cartEmpty: 'Your cart is empty',
    cartTitle: 'Cart',
    totalLabel: 'Total',
    sendKitchenBtn: 'SEND TO KITCHEN',
    clearCartBtn: 'Clear',
    callStaffBtn: 'Call Staff',
    sentOk: 'Your order has been sent!',
    checkoutBtn: 'CHECK OUT',
    needSendFirst: 'You have not ordered anything yet',
    addToCartBtn: 'Add to cart',
    itemInfoTitle: 'Item details',
    priceLabel: 'Price',
    categoryLabel: 'Category',
    descriptionLabel: 'Description',
    codeLabel: 'Item code',
    ingredientsLabel: 'Ingredients',
    allergensLabel: 'Allergens',
    optionsLabel: 'Options',
    addonsLabel: 'Add-ons',
    prepTimeLabel: 'Prep time',
    minutesSuffix: 'min',
    payTitle: 'Choose payment method',
    totalDue: 'Total due',
    payCash: 'Cash',
    payTransfer: 'Bank transfer',
    payCard: 'Card',
    staffComing: 'Our staff will be right with you. Please wait a moment!',
    qrTitle: 'Scan the QR code to pay',
    qrWaiting: 'Waiting for payment…',
    paidOk: 'Payment received. Thank you!',
    backBtn: '← Back',
    askInvoiceTitle: 'Need a VAT invoice?',
    askInvoiceSub: 'Enter your tax code to receive an e-invoice by email',
    invoiceYes: 'Yes, issue invoice',
    invoiceNo: 'No, thanks',
    taxCodeLabel: 'Tax code',
    lookupBtn: 'Look up',
    companyLabel: 'Company name',
    addressLabel: 'Address',
    emailLabel: 'Email for invoice',
    contactPhoneLabel: 'Contact phone',
    submitInvoiceBtn: 'Issue invoice',
    invoiceDone: 'Done! The e-invoice will be sent to your email.',
    thanksTitle: 'Thank you!',
    thanksSub: 'See you again soon 💙',
    sentItemsTitle: 'Sent to kitchen',
    stWaitConfirm: 'Awaiting confirm',
    stQueued: 'Accepted',
    stPreparing: 'Preparing',
    stReady: 'Ready',
    stServed: 'Served',
    stCancelled: 'Cancelled',
  ),
  SelfOrderLang(
    code: 'zh',
    flag: '🇨🇳',
    nativeName: '中文',
    greetTitle: '欢迎光临！',
    greetSub: '请选择语言开始',
    btnStart: '继续 →',
    phoneTitle: '请输入手机号码',
    phoneSub: '累积会员积分并保存您喜爱的菜品（可选）',
    phoneHint: '例如：0901234567',
    btnSkip: '跳过并点餐',
    btnContinue: '继续 →',
    phoneInvalid: '手机号码不正确，请重新检查',
    memberHello: '您好 %s！',
    memberNew: '已为您创建会员卡 🎉',
    pointsLabel: '积分',
    menuTitle: '菜单',
    allCategory: '全部',
    reorderTitle: '⭐ 您常点的菜 — 点击再来一份',
    cartEmpty: '购物车是空的',
    cartTitle: '购物车',
    totalLabel: '合计',
    sendKitchenBtn: '发送到厨房',
    clearCartBtn: '清空',
    callStaffBtn: '呼叫服务员',
    sentOk: '您的订单已发送！',
    checkoutBtn: '结账',
    needSendFirst: '您还没有点任何菜',
    addToCartBtn: '加入购物车',
    itemInfoTitle: '菜品详情',
    priceLabel: '价格',
    categoryLabel: '分类',
    descriptionLabel: '介绍',
    codeLabel: '菜品编号',
    ingredientsLabel: '配料',
    allergensLabel: '过敏原',
    optionsLabel: '选项',
    addonsLabel: '加点',
    prepTimeLabel: '准备时间',
    minutesSuffix: '分钟',
    payTitle: '选择支付方式',
    totalDue: '应付总额',
    payCash: '现金',
    payTransfer: '银行转账',
    payCard: '刷卡',
    staffComing: '服务员马上就到，请稍候！',
    qrTitle: '扫描二维码付款',
    qrWaiting: '等待付款中…',
    paidOk: '已收到付款，谢谢！',
    backBtn: '← 返回',
    askInvoiceTitle: '需要开增值税发票吗？',
    askInvoiceSub: '输入税号，电子发票将发送到您的邮箱',
    invoiceYes: '是，开发票',
    invoiceNo: '不用了，谢谢',
    taxCodeLabel: '税号',
    lookupBtn: '查询',
    companyLabel: '公司名称',
    addressLabel: '地址',
    emailLabel: '接收发票的邮箱',
    contactPhoneLabel: '联系电话',
    submitInvoiceBtn: '开具发票',
    invoiceDone: '已完成！电子发票将发送到您的邮箱。',
    thanksTitle: '谢谢惠顾！',
    thanksSub: '期待您再次光临 💙',
    sentItemsTitle: '已下单的菜',
    stWaitConfirm: '待确认',
    stQueued: '厨房已接单',
    stPreparing: '制作中',
    stReady: '已完成',
    stServed: '已上菜',
    stCancelled: '已取消',
  ),
  SelfOrderLang(
    code: 'ja',
    flag: '🇯🇵',
    nativeName: '日本語',
    greetTitle: 'いらっしゃいませ！',
    greetSub: '言語を選択して開始してください',
    btnStart: '次へ →',
    phoneTitle: '電話番号を入力してください',
    phoneSub: 'ポイントを貯めてお気に入りを保存（任意）',
    phoneHint: '例：0901234567',
    btnSkip: 'スキップして注文',
    btnContinue: '次へ →',
    phoneInvalid: '電話番号が正しくありません。ご確認ください',
    memberHello: 'こんにちは %s さん！',
    memberNew: '会員カードを作成しました 🎉',
    pointsLabel: 'ポイント',
    menuTitle: 'メニュー',
    allCategory: 'すべて',
    reorderTitle: '⭐ いつものメニュー — タップして再注文',
    cartEmpty: 'カートは空です',
    cartTitle: 'カート',
    totalLabel: '合計',
    sendKitchenBtn: 'キッチンへ送る',
    clearCartBtn: 'クリア',
    callStaffBtn: 'スタッフを呼ぶ',
    sentOk: 'ご注文を送信しました！',
    checkoutBtn: 'お会計',
    needSendFirst: 'まだ何も注文していません',
    addToCartBtn: 'カートに追加',
    itemInfoTitle: 'メニュー詳細',
    priceLabel: '価格',
    categoryLabel: 'カテゴリー',
    descriptionLabel: '説明',
    codeLabel: '品番',
    ingredientsLabel: '材料',
    allergensLabel: 'アレルゲン',
    optionsLabel: 'オプション',
    addonsLabel: '追加',
    prepTimeLabel: '調理時間',
    minutesSuffix: '分',
    payTitle: 'お支払い方法を選択',
    totalDue: 'お支払い合計',
    payCash: '現金',
    payTransfer: '銀行振込',
    payCard: 'カード',
    staffComing: 'スタッフがすぐに参ります。少々お待ちください！',
    qrTitle: 'QRコードをスキャンしてお支払い',
    qrWaiting: 'お支払いを待っています…',
    paidOk: 'お支払いを確認しました。ありがとうございます！',
    backBtn: '← 戻る',
    askInvoiceTitle: 'VATインボイスが必要ですか？',
    askInvoiceSub: '税番号を入力すると、電子インボイスをメールでお送りします',
    invoiceYes: 'はい、発行する',
    invoiceNo: 'いいえ、結構です',
    taxCodeLabel: '税番号',
    lookupBtn: '照会',
    companyLabel: '会社名',
    addressLabel: '住所',
    emailLabel: 'インボイス受取メール',
    contactPhoneLabel: '連絡先電話番号',
    submitInvoiceBtn: 'インボイス発行',
    invoiceDone: '完了しました！電子インボイスをメールでお送りします。',
    thanksTitle: 'ありがとうございました！',
    thanksSub: 'またのお越しをお待ちしております 💙',
    sentItemsTitle: '注文済みの品',
    stWaitConfirm: '確認待ち',
    stQueued: '受付済み',
    stPreparing: '調理中',
    stReady: 'できあがり',
    stServed: '提供済み',
    stCancelled: 'キャンセル',
  ),
  SelfOrderLang(
    code: 'ko',
    flag: '🇰🇷',
    nativeName: '한국어',
    greetTitle: '어서오세요!',
    greetSub: '시작하려면 언어를 선택하세요',
    btnStart: '계속 →',
    phoneTitle: '전화번호를 입력하세요',
    phoneSub: '포인트 적립 및 즐겨찾는 메뉴 저장 (선택)',
    phoneHint: '예: 0901234567',
    btnSkip: '건너뛰고 주문',
    btnContinue: '계속 →',
    phoneInvalid: '전화번호가 올바르지 않습니다. 다시 확인해 주세요',
    memberHello: '안녕하세요 %s님!',
    memberNew: '멤버십 카드가 생성되었습니다 🎉',
    pointsLabel: '적립 포인트',
    menuTitle: '메뉴',
    allCategory: '전체',
    reorderTitle: '⭐ 자주 주문한 메뉴 — 탭하여 재주문',
    cartEmpty: '장바구니가 비어 있습니다',
    cartTitle: '장바구니',
    totalLabel: '합계',
    sendKitchenBtn: '주방으로 보내기',
    clearCartBtn: '비우기',
    callStaffBtn: '직원 호출',
    sentOk: '주문이 전송되었습니다!',
    checkoutBtn: '결제하기',
    needSendFirst: '아직 주문한 메뉴가 없습니다',
    addToCartBtn: '장바구니에 담기',
    itemInfoTitle: '메뉴 상세',
    priceLabel: '가격',
    categoryLabel: '카테고리',
    descriptionLabel: '설명',
    codeLabel: '메뉴 코드',
    ingredientsLabel: '재료',
    allergensLabel: '알레르기 유발 성분',
    optionsLabel: '옵션',
    addonsLabel: '추가 메뉴',
    prepTimeLabel: '준비 시간',
    minutesSuffix: '분',
    payTitle: '결제 방법 선택',
    totalDue: '총 결제 금액',
    payCash: '현금',
    payTransfer: '계좌이체',
    payCard: '카드',
    staffComing: '직원이 곧 도와드리겠습니다. 잠시만 기다려 주세요!',
    qrTitle: 'QR 코드를 스캔하여 결제',
    qrWaiting: '결제 대기 중…',
    paidOk: '결제가 완료되었습니다. 감사합니다!',
    backBtn: '← 뒤로',
    askInvoiceTitle: 'VAT 세금계산서가 필요하신가요?',
    askInvoiceSub: '사업자번호를 입력하면 전자계산서를 이메일로 보내드립니다',
    invoiceYes: '네, 발행합니다',
    invoiceNo: '아니요, 괜찮습니다',
    taxCodeLabel: '사업자번호',
    lookupBtn: '조회',
    companyLabel: '회사명',
    addressLabel: '주소',
    emailLabel: '계산서 수신 이메일',
    contactPhoneLabel: '연락처',
    submitInvoiceBtn: '계산서 발행',
    invoiceDone: '완료되었습니다! 전자계산서를 이메일로 보내드립니다.',
    thanksTitle: '감사합니다!',
    thanksSub: '다음에 또 뵙겠습니다 💙',
    sentItemsTitle: '주문한 메뉴',
    stWaitConfirm: '확인 대기',
    stQueued: '접수됨',
    stPreparing: '조리 중',
    stReady: '완료',
    stServed: '서빙 완료',
    stCancelled: '취소됨',
  ),
];
