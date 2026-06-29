double _doubleValue(dynamic value) {
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0.0;
}

class Branch {
  final String id;
  final String name;
  final String address;

  Branch({required this.id, required this.name, required this.address});

  factory Branch.fromJson(Map<String, dynamic> json) {
    return Branch(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      address: json['address'] ?? '',
    );
  }
}

class User {
  final String username;
  final String role;
  final String branchId;
  final List<String> permissions;

  User({
    required this.username,
    required this.role,
    required this.branchId,
    required this.permissions,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    var perms = json['perms'] ?? json['permissions'];
    List<String> parsedPerms = [];
    if (perms is List) {
      parsedPerms = perms.map((p) => p.toString()).toList();
    }
    return User(
      username: json['username'] ?? '',
      role: json['role'] ?? '',
      branchId: json['branch_id'] ?? '',
      permissions: parsedPerms,
    );
  }
}

class Zone {
  final String id;
  final String name;

  Zone({required this.id, required this.name});

  factory Zone.fromJson(Map<String, dynamic> json) {
    return Zone(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
    );
  }
}

class TableModel {
  final String id;
  final String code;
  final String name;
  final String zoneId;
  final String status; // 'empty', 'occupied', 'checking_out', 'dirty'
  final String? activeOrderId;
  final double? activeOrderTotal;

  TableModel({
    required this.id,
    required this.code,
    required this.name,
    required this.zoneId,
    required this.status,
    this.activeOrderId,
    this.activeOrderTotal,
  });

  static double? _money(dynamic value) {
    if (value == null) return null;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString());
  }

  factory TableModel.fromJson(Map<String, dynamic> json) {
    return TableModel(
      id: json['id'] ?? '',
      code: json['code'] ?? '',
      name: json['name'] ?? '',
      zoneId: json['zone_id'] ?? json['zone'] ?? '',
      status: json['status'] ?? 'empty',
      activeOrderId: json['active_order_id'] ?? json['current_order_id'] ?? json['order_id'],
      activeOrderTotal: _money(json['active_order_total'] ?? json['current_total'] ?? json['amount']),
    );
  }
}

class Category {
  final String id;
  final String name;

  Category({required this.id, required this.name});

  factory Category.fromJson(Map<String, dynamic> json) {
    return Category(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
    );
  }
}

class Modifier {
  final String name;
  final double price;

  Modifier({required this.name, required this.price});

  factory Modifier.fromJson(Map<String, dynamic> json) {
    return Modifier(
      name: json['name'] ?? json['label'] ?? '',
      price: _doubleValue(json['price'] ?? json['unit_price']),
    );
  }

  Map<String, dynamic> toJson() => {
    'name': name,
    'price': price,
  };
}

class MenuItem {
  final String id;
  final String code;
  final String name;
  final double price;
  final String categoryId;
  final String imageUrl;
  final List<Modifier> modifiers;

  MenuItem({
    required this.id,
    required this.code,
    required this.name,
    required this.price,
    required this.categoryId,
    required this.imageUrl,
    required this.modifiers,
  });

  factory MenuItem.fromJson(Map<String, dynamic> json) {
    var mods = json['modifiers'] ?? json['toppings'];
    List<Modifier> parsedMods = [];
    if (mods is List) {
      parsedMods = mods.map((m) => Modifier.fromJson(m)).toList();
    }
    return MenuItem(
      id: json['id'] ?? '',
      code: json['code'] ?? json['sku'] ?? '',
      name: json['name'] ?? '',
      price: _doubleValue(json['price'] ?? json['unit_price']),
      categoryId: json['category_id'] ?? json['category'] ?? '',
      imageUrl: json['image_url'] ?? json['image'] ?? '',
      modifiers: parsedMods,
    );
  }
}

class CartItem {
  final MenuItem item;
  int qty;
  final List<Modifier> selectedModifiers;
  String notes;

  CartItem({
    required this.item,
    this.qty = 1,
    required this.selectedModifiers,
    this.notes = '',
  });

  double get unitPrice {
    double total = item.price;
    for (var m in selectedModifiers) {
      total += m.price;
    }
    return total;
  }

  double get totalPrice => unitPrice * qty;

  Map<String, dynamic> toJson() => {
    'id': item.id,
    'sku': item.code,
    'name': item.name,
    'qty': qty,
    'unit_price': item.price,
    'line_total': totalPrice,
    'notes': notes,
    'mods': selectedModifiers.map((m) => m.toJson()).toList(),
  };
}

class Shift {
  final String id;
  final String cashier;
  final double openingBalance;
  final String openedAt;
  final String? closedAt;
  final double? closingBalance;
  final double? expectedBalance;

  Shift({
    required this.id,
    required this.cashier,
    required this.openingBalance,
    required this.openedAt,
    this.closedAt,
    this.closingBalance,
    this.expectedBalance,
  });

  factory Shift.fromJson(Map<String, dynamic> json) {
    // Server dùng các khóa *_cash và user_name; giữ fallback *_balance cho an toàn.
    return Shift(
      id: json['id'] ?? '',
      cashier: json['cashier'] ?? json['user_name'] ?? '',
      openingBalance: _doubleValue(json['opening_cash'] ?? json['opening_balance']),
      openedAt: json['opened_at'] ?? '',
      closedAt: json['closed_at'],
      closingBalance: _doubleValue(json['closing_cash'] ?? json['closing_balance']),
      expectedBalance: _doubleValue(json['expected_cash'] ?? json['expected_balance']),
    );
  }
}
