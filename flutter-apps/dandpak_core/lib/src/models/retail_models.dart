// Retail SKU, lot, customer, voucher, cart, and payment models.
// They mirror the JSON contracts used by Flutter retail screen and /api/retail/checkout.

String retailS(dynamic v) => v?.toString() ?? '';

num retailN(dynamic v) {
  if (v is num) return v;
  return num.tryParse(retailS(v).replaceAll(',', '.')) ?? 0;
}

bool retailB(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  final s = retailS(v).trim().toLowerCase();
  return s == '1' || s == 'true' || s == 'yes' || s == 'on';
}

Map<String, dynamic> retailMap(dynamic v) =>
    v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

List<int> retailIntList(dynamic v) {
  final raw = v is List
      ? v
      : retailS(v)
          .split(',')
          .map((e) => e.trim())
          .where((e) => e.isNotEmpty)
          .toList();
  final out = <int>{};
  for (final item in raw) {
    final n = item is num ? item.toInt() : int.tryParse(retailS(item));
    if (n != null) out.add(n);
  }
  final list = out.toList()..sort();
  return list;
}

class Sku {
  final String id;
  final String barcode;
  final String name;
  final String emoji;
  final String image;
  final num price;
  final num stock;
  final String unit;
  final String category;
  final String warehouseId;
  final bool trackLot;
  final bool expiryRequired;

  const Sku({
    required this.id,
    required this.barcode,
    required this.name,
    required this.emoji,
    required this.image,
    required this.price,
    required this.stock,
    required this.unit,
    required this.category,
    required this.warehouseId,
    required this.trackLot,
    required this.expiryRequired,
  });

  // Snapshot đủ để MỌI máy dựng lại dòng giỏ hàng mà không cần SKU nằm sẵn trong
  // trang đã tải (dùng cho giỏ hàng bán lẻ chia sẻ đa thiết bị).
  Map<String, dynamic> toJson() => {
        'id': id,
        'barcode': barcode,
        'name': name,
        'emoji': emoji,
        'image': image,
        'price': price,
        'stock': stock,
        'unit': unit,
        'category': category,
        'warehouse_id': warehouseId,
        'track_lot': trackLot,
        'expiry_required': expiryRequired,
      };

  factory Sku.fromJson(Map<String, dynamic> j) {
    final unit = retailS(j['unit']).trim();
    return Sku(
      id: retailS(j['id']),
      barcode: retailS(j['barcode']),
      name: retailS(j['name']),
      emoji: retailS(j['emoji']),
      image: retailS(j['image']),
      price: retailN(j['price']),
      stock: retailN(j['stock']),
      unit: unit.isEmpty ? 'cái' : unit,
      category: retailS(j['category']),
      warehouseId: retailS(j['warehouse_id']),
      trackLot: retailB(j['track_lot']),
      expiryRequired: retailB(j['expiry_required']),
    );
  }
}

class StockLot {
  final String id;
  final String branchId;
  final String warehouseId;
  final String itemType;
  final String itemId;
  final String lotNo;
  final String expiryDate;
  final String receivedAt;
  final num qtyOnHand;
  final num unitCost;
  final String supplier;
  final String status;
  final String warehouseName;
  final String itemName;
  final String unit;

  const StockLot({
    required this.id,
    required this.branchId,
    required this.warehouseId,
    required this.itemType,
    required this.itemId,
    required this.lotNo,
    required this.expiryDate,
    required this.receivedAt,
    required this.qtyOnHand,
    required this.unitCost,
    required this.supplier,
    required this.status,
    required this.warehouseName,
    required this.itemName,
    required this.unit,
  });

  factory StockLot.fromJson(Map<String, dynamic> j) => StockLot(
        id: retailS(j['id']),
        branchId: retailS(j['branch_id']),
        warehouseId: retailS(j['warehouse_id']),
        itemType: retailS(j['item_type']),
        itemId: retailS(j['item_id']),
        lotNo: retailS(j['lot_no']),
        expiryDate: retailS(j['expiry_date']),
        receivedAt: retailS(j['received_at']),
        qtyOnHand: retailN(j['qty_on_hand']),
        unitCost: retailN(j['unit_cost']),
        supplier: retailS(j['supplier']),
        status: retailS(j['status']),
        warehouseName: retailS(j['warehouse_name']),
        itemName: retailS(j['item_name']),
        unit: retailS(j['unit']),
      );

  String get label {
    final expiry = expiryDate.isEmpty ? 'không HSD' : expiryDate;
    return '$lotNo · HSD $expiry · tồn ${qtyOnHand.round()}';
  }
}

class RetailVoucher {
  final String id;
  final String code;
  final String name;
  final String type;
  final num value;
  final String scope;
  final String skuId;
  final String lotNo;
  final num minTotal;
  final bool active;
  final bool usable;
  final String startsAt;
  final String endsAt;
  final String note;
  final String skuName;
  final String skuEmoji;
  final List<int> months;
  final List<int> monthDays;
  final List<int> weekdays;
  final String timeStart;
  final String timeEnd;
  final String birthdayMode;
  final String usageLimit;
  final String scheduleLabel;
  final String scopeLabel;

  const RetailVoucher({
    required this.id,
    required this.code,
    required this.name,
    required this.type,
    required this.value,
    required this.scope,
    required this.skuId,
    required this.lotNo,
    required this.minTotal,
    required this.active,
    required this.usable,
    required this.startsAt,
    required this.endsAt,
    required this.note,
    required this.skuName,
    required this.skuEmoji,
    required this.months,
    required this.monthDays,
    required this.weekdays,
    required this.timeStart,
    required this.timeEnd,
    required this.birthdayMode,
    required this.usageLimit,
    required this.scheduleLabel,
    required this.scopeLabel,
  });

  factory RetailVoucher.fromJson(Map<String, dynamic> j) {
    final schedule = retailMap(j['schedule']);
    return RetailVoucher(
      id: retailS(j['id']),
      code: retailS(j['code']),
      name: retailS(j['name']),
      type: retailS(j['type']).isEmpty ? 'pct' : retailS(j['type']),
      value: retailN(j['value']),
      scope: retailS(j['scope']).isEmpty ? 'order' : retailS(j['scope']),
      skuId: retailS(j['sku_id']),
      lotNo: retailS(j['lot_no']),
      minTotal: retailN(j['min_total']),
      active: retailB(j['active']),
      usable:
          j.containsKey('usable') ? retailB(j['usable']) : retailB(j['active']),
      startsAt: retailS(j['starts_at']),
      endsAt: retailS(j['ends_at']),
      note: retailS(j['note']),
      skuName: retailS(j['sku_name']),
      skuEmoji: retailS(j['sku_emoji']),
      months: retailIntList(schedule['months']),
      monthDays: retailIntList(schedule['monthDays'] ?? schedule['month_days']),
      weekdays: retailIntList(schedule['weekdays']),
      timeStart: retailS(schedule['timeStart'] ?? schedule['time_start']),
      timeEnd: retailS(schedule['timeEnd'] ?? schedule['time_end']),
      birthdayMode:
          retailS(schedule['birthdayMode'] ?? schedule['birthday_mode']).isEmpty
              ? 'off'
              : retailS(schedule['birthdayMode'] ?? schedule['birthday_mode']),
      usageLimit:
          retailS(schedule['usageLimit'] ?? schedule['usage_limit']).isEmpty
              ? 'unlimited'
              : retailS(schedule['usageLimit'] ?? schedule['usage_limit']),
      scheduleLabel: retailS(j['schedule_label']),
      scopeLabel: retailS(j['scope_label']),
    );
  }

  bool get isOrder => scope == 'order';
  bool get isSku => scope == 'sku';

  /// 'all_sku': áp MỌI sản phẩm nhưng tính riêng từng dòng hàng (khác toàn
  /// bill gộp chung) — vd "mua 5 tặng 1 bất kỳ món nào".
  bool get isAllSku => scope == 'all_sku';

  /// Voucher này có áp cho dòng hàng của [skuId] (lot [lotNo]) không.
  bool appliesToSku(String skuId, {String? lotNo}) {
    if (isAllSku) return true;
    if (!isSku || this.skuId != skuId) return false;
    return this.lotNo.isEmpty || this.lotNo == lotNo;
  }

  bool usableForCustomer(RetailCustomer? customer, {DateTime? at}) {
    if (!active || !usable) return false;
    final now = at ?? DateTime.now();
    final start = _parseWindow(startsAt, endOfDay: false);
    final end = _parseWindow(endsAt, endOfDay: true);
    if (start != null && now.isBefore(start)) return false;
    if (end != null && now.isAfter(end)) return false;
    if (months.isNotEmpty && !months.contains(now.month)) return false;
    if (monthDays.isNotEmpty && !monthDays.contains(now.day)) return false;
    final wd = now.weekday;
    if (weekdays.isNotEmpty && !weekdays.contains(wd)) return false;
    if (!_timeAllowed(now)) return false;
    if (birthdayMode != 'off') {
      final bd = _parseBirthday(customer?.birthday ?? '');
      if (bd == null) return false;
      if (birthdayMode == 'month' && bd.$1 != now.month) return false;
      if (birthdayMode == 'day' && (bd.$1 != now.month || bd.$2 != now.day)) {
        return false;
      }
    }
    return true;
  }

  String get valueLabel {
    if (type == 'buy_x_get_1') return 'Mua ${value.round()} tặng 1';
    return type == 'pct' ? '${value.round()}%' : '${value.round()}đ';
  }

  String get displayName {
    if (code.isNotEmpty) return '$name ($code)';
    return name;
  }

  num amountFor(num base, {int qty = 1}) {
    if (base <= 0) return 0;
    if (type == 'buy_x_get_1') return 0;
    if (type == 'pct') return (base * value / 100).floor();
    final raw = isSku ? value * qty : value;
    return raw.clamp(0, base);
  }

  DateTime? _parseWindow(String value, {required bool endOfDay}) {
    final s = value.trim();
    if (s.isEmpty) return null;
    final raw = s.length <= 10 ? '$s ${endOfDay ? '23:59:59' : '00:00:00'}' : s;
    return DateTime.tryParse(raw.replaceFirst(' ', 'T'));
  }

  bool _timeAllowed(DateTime now) {
    final start = _minutes(timeStart);
    final end = _minutes(timeEnd);
    if (start == null && end == null) return true;
    final cur = now.hour * 60 + now.minute;
    if (start != null && end != null) {
      if (start <= end) return cur >= start && cur <= end;
      return cur >= start || cur <= end;
    }
    if (start != null) return cur >= start;
    return cur <= end!;
  }

  int? _minutes(String value) {
    final m = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(value.trim());
    if (m == null) return null;
    final h = int.tryParse(m.group(1) ?? '');
    final min = int.tryParse(m.group(2) ?? '');
    if (h == null || min == null || h < 0 || h > 23 || min < 0 || min > 59) {
      return null;
    }
    return h * 60 + min;
  }

  (int, int)? _parseBirthday(String value) {
    final s = value.trim();
    if (s.isEmpty) return null;
    final iso = RegExp(r'^\d{4}-(\d{1,2})-(\d{1,2})').firstMatch(s);
    if (iso != null) {
      final m = int.tryParse(iso.group(1) ?? '');
      final d = int.tryParse(iso.group(2) ?? '');
      return m == null || d == null ? null : (m, d);
    }
    final short = RegExp(r'^(\d{1,2})[/-](\d{1,2})').firstMatch(s);
    if (short == null) return null;
    final d = int.tryParse(short.group(1) ?? '');
    final m = int.tryParse(short.group(2) ?? '');
    return m == null || d == null ? null : (m, d);
  }
}

class RetailCustomer {
  final String id;
  final String code;
  final String name;
  final String phone;
  final String email;
  final String taxCode;
  final String company;
  final String address;
  final String addressDetail;
  final String addressWard;
  final String addressProvince;
  final String wardCode;
  final String provinceCode;
  final String birthday;
  final String preferences;
  final String allergies;
  final String perkType;
  final num perkValue;
  final bool autoInvoice;
  final num totalOrders;
  final num totalSpent;

  const RetailCustomer({
    required this.id,
    required this.code,
    required this.name,
    required this.phone,
    required this.email,
    required this.taxCode,
    required this.company,
    required this.address,
    required this.addressDetail,
    required this.addressWard,
    required this.addressProvince,
    required this.wardCode,
    required this.provinceCode,
    required this.birthday,
    required this.preferences,
    required this.allergies,
    required this.perkType,
    required this.perkValue,
    required this.autoInvoice,
    required this.totalOrders,
    required this.totalSpent,
  });

  factory RetailCustomer.fromJson(Map<String, dynamic> j) => RetailCustomer(
        id: retailS(j['id']),
        code: retailS(j['code']),
        name: retailS(j['name']),
        phone: retailS(j['phone']),
        email: retailS(j['email']),
        taxCode: retailS(j['tax_code']),
        company: retailS(j['company']),
        address: retailS(j['address']),
        addressDetail: retailS(j['address_detail']),
        addressWard: retailS(j['address_ward']),
        addressProvince: retailS(j['address_province']),
        wardCode: retailS(j['ward_code']),
        provinceCode: retailS(j['province_code']),
        birthday: retailS(j['birthday']),
        preferences: retailS(j['preferences']),
        allergies: retailS(j['allergies']),
        perkType:
            retailS(j['perk_type']).isEmpty ? 'none' : retailS(j['perk_type']),
        perkValue: retailN(j['perk_value']),
        autoInvoice: retailB(j['auto_invoice']),
        totalOrders: retailN(j['total_orders']),
        totalSpent: retailN(j['total_spent']),
      );

  String get title =>
      name.isNotEmpty ? name : (company.isNotEmpty ? company : phone);

  String get subtitle {
    final parts = <String>[
      if (phone.isNotEmpty) phone,
      if (taxCode.isNotEmpty) 'MST $taxCode',
      if (perkLabel.isNotEmpty) perkLabel,
    ];
    return parts.join(' · ');
  }

  String get perkLabel {
    if (perkType == 'pct' && perkValue > 0) {
      return 'Ưu đãi ${perkValue.round()}%';
    }
    if ((perkType == 'amount' || perkType == 'cash') && perkValue > 0) {
      return 'Ưu đãi ${perkValue.round()}đ';
    }
    return '';
  }

  num perkAmount(num base) {
    if (base <= 0) return 0;
    if (perkType == 'pct') {
      return (base * perkValue / 100).floor().clamp(0, base);
    }
    if (perkType == 'amount' || perkType == 'cash') {
      return perkValue.clamp(0, base);
    }
    return 0;
  }

  Map<String, dynamic> toCheckoutCustomer() => {
        'id': id,
        'name': name,
        'phone': phone,
        'email': email,
        'tax_code': taxCode,
        'company': company,
        'address': address,
        'address_detail': addressDetail,
        'address_ward': addressWard,
        'address_province': addressProvince,
        'ward_code': wardCode,
        'province_code': provinceCode,
        'birthday': birthday,
        'preferences': preferences,
        'allergies': allergies,
        'perk_type': perkType,
        'perk_value': perkValue.round(),
      };
}

class CartLine {
  final Sku sku;
  int qty;
  String? lotId;
  String? voucherId;

  CartLine(this.sku, this.qty, {this.lotId, this.voucherId});

  num get lineTotal => sku.price * qty;

  CartLine copy() => CartLine(sku, qty, lotId: lotId, voucherId: voucherId);
}

class RetailSaleTab {
  final int id;
  final List<CartLine> cart;
  RetailCustomer? customer;
  String? orderVoucherId;
  num manualDiscount;

  RetailSaleTab({
    required this.id,
    List<CartLine>? cart,
    this.customer,
    this.orderVoucherId,
    this.manualDiscount = 0,
  }) : cart = cart ?? <CartLine>[];

  String get title => 'Hóa đơn ${id.toString().padLeft(2, '0')}';
}

class PaymentLine {
  final String method;
  final num amount;
  final String reference;

  /// Đối soát thủ công: id giao dịch tiền-về chưa khớp (bank_transactions)
  /// được thu ngân gắn vào dòng này; server đánh dấu 'claimed' sau khi thu.
  final String? bankTxId;

  /// Lý do xác nhận tay (không có webhook) — server bắt PIN + ghi audit.
  final String? manualReason;

  const PaymentLine({
    required this.method,
    required this.amount,
    this.reference = '',
    this.bankTxId,
    this.manualReason,
  });

  Map<String, dynamic> toJson() => {
        'method': method,
        'amount': amount.round(),
        'reference': reference,
        if (bankTxId != null && bankTxId!.isNotEmpty) 'bank_tx_id': bankTxId,
        if (manualReason != null) 'manual_confirm': {'reason': manualReason},
      };
}
