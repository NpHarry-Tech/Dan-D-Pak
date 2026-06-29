// lib/models/tablet_models.dart

int _intValue(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return double.tryParse(value?.toString() ?? '')?.toInt() ?? 0;
}

double _doubleValue(dynamic value) {
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0.0;
}

class Branch {
  final String id;
  final String name;
  final String? code;

  Branch({required this.id, required this.name, this.code});

  factory Branch.fromJson(Map<String, dynamic> json) {
    return Branch(
      id: (json['id'] ?? json['branch_id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      code: json['code']?.toString(),
    );
  }
}

class User {
  final String id;
  final String username;
  final String name;
  final List<String> perms;

  User({required this.id, required this.username, required this.name, required this.perms});

  factory User.fromJson(Map<String, dynamic> json) {
    var pList = json['perms'] ?? json['permissions'] ?? [];
    List<String> permsList = [];
    if (pList is List) {
      permsList = pList.map((e) => e.toString()).toList();
    }
    return User(
      id: (json['id'] ?? '').toString(),
      username: (json['username'] ?? '').toString(),
      name: (json['name'] ?? json['username'] ?? '').toString(),
      perms: permsList,
    );
  }

  bool hasPerm(String perm) => perms.contains('*') || perms.contains(perm);
}

class MenuItem {
  final String id;
  final String name;
  final int price;
  final String? barcode;
  final String? category;
  final String? image;
  final String? emoji;
  final String? description;
  final List<dynamic> modifiers;

  MenuItem({
    required this.id,
    required this.name,
    required this.price,
    this.barcode,
    this.category,
    this.image,
    this.emoji,
    this.description,
    required this.modifiers,
  });

  factory MenuItem.fromJson(Map<String, dynamic> json) {
    return MenuItem(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      price: _intValue(json['price']),
      barcode: json['barcode']?.toString(),
      category: json['category']?.toString(),
      image: json['image']?.toString(),
      emoji: json['emoji']?.toString(),
      description: json['description']?.toString(),
      modifiers: json['modifiers'] is List ? json['modifiers'] as List : [],
    );
  }
}

class Zone {
  final String id;
  final String name;

  Zone({required this.id, required this.name});

  factory Zone.fromJson(Map<String, dynamic> json) {
    return Zone(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
    );
  }
}

class TableModel {
  final String id;
  final String code;
  final String name;
  final String zoneId;
  final String status; // 'empty', 'serving', etc.

  TableModel({
    required this.id,
    required this.code,
    required this.name,
    required this.zoneId,
    required this.status,
  });

  factory TableModel.fromJson(Map<String, dynamic> json) {
    return TableModel(
      id: (json['id'] ?? '').toString(),
      code: (json['code'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      zoneId: (json['zone_id'] ?? json['zone'] ?? '').toString(),
      status: (json['status'] ?? 'empty').toString(),
    );
  }
}

class Warehouse {
  final String id;
  final String name;
  final String? code;
  final String type; // 'kitchen', 'retail'

  Warehouse({required this.id, required this.name, this.code, required this.type});

  factory Warehouse.fromJson(Map<String, dynamic> json) {
    return Warehouse(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      code: json['code']?.toString(),
      type: (json['type'] ?? 'kitchen').toString(),
    );
  }
}

class InventoryItem {
  final String id;
  final String name;
  final String? barcode;
  final String unit;
  final double stock;
  final double minStock;
  final double cost;
  final int? price; // ONLY for SKU
  final String? category;
  final String stockType; // 'sku', 'ingredient', 'supply'
  final bool trackLot;
  final bool expiryRequired;
  final String? image;
  final String? emoji;
  final List<dynamic> units;

  InventoryItem({
    required this.id,
    required this.name,
    this.barcode,
    required this.unit,
    required this.stock,
    required this.minStock,
    required this.cost,
    this.price,
    this.category,
    required this.stockType,
    required this.trackLot,
    required this.expiryRequired,
    this.image,
    this.emoji,
    required this.units,
  });

  factory InventoryItem.fromJson(Map<String, dynamic> json) {
    return InventoryItem(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      barcode: json['barcode']?.toString(),
      unit: (json['unit'] ?? 'cái').toString(),
      stock: _doubleValue(json['stock']),
      minStock: _doubleValue(json['min_stock']),
      cost: _doubleValue(json['cost']),
      price: json['price'] != null ? _intValue(json['price']) : null,
      category: json['category']?.toString(),
      stockType: (json['stock_type'] ?? (json['item_type'] == 'ingredient' ? 'ingredient' : 'supply')).toString(),
      trackLot: json['track_lot'] == true || json['track_lot'] == 1,
      expiryRequired: json['expiry_required'] == true || json['expiry_required'] == 1,
      image: json['image']?.toString(),
      emoji: json['emoji']?.toString(),
      units: json['units'] is List ? json['units'] as List : [],
    );
  }

  bool get low => stock < minStock;
}

class Lot {
  final String id;
  final String itemId;
  final String itemName;
  final String lotNo;
  final double qtyOnHand;
  final String? expiryDate;
  final String? supplier;

  Lot({
    required this.id,
    required this.itemId,
    required this.itemName,
    required this.lotNo,
    required this.qtyOnHand,
    this.expiryDate,
    this.supplier,
  });

  factory Lot.fromJson(Map<String, dynamic> json) {
    return Lot(
      id: (json['id'] ?? '').toString(),
      itemId: (json['item_id'] ?? '').toString(),
      itemName: (json['item_name'] ?? '').toString(),
      lotNo: (json['lot_no'] ?? '').toString(),
      qtyOnHand: _doubleValue(json['qty_on_hand']),
      expiryDate: json['expiry_date']?.toString(),
      supplier: json['supplier']?.toString(),
    );
  }
}
