// lib/screens/self_order/self_order_models.dart
// Model riêng cho module iPad Self-Order — tách biệt khỏi POS models.

int _soIntValue(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return double.tryParse(value?.toString() ?? '')?.toInt() ?? 0;
}

// Một lựa chọn trong nhóm (size/topping/combo). price = sale_price (đã gồm VAT).
class SoOptionItem {
  final String key;
  final String name;
  final String type; // paid | free
  final int price;
  final bool available;
  SoOptionItem({
    required this.key,
    required this.name,
    required this.type,
    required this.price,
    this.available = true,
  });
  factory SoOptionItem.fromJson(Map<String, dynamic> j) => SoOptionItem(
        key: (j['key'] ?? '').toString(),
        name: (j['name'] ?? '').toString(),
        type: j['type'] == 'free' ? 'free' : 'paid',
        price: _soIntValue(j['sale_price'] ?? j['price']),
        available: j['available'] != false,
      );
}

class SoOptionGroup {
  final String key;
  final String name;
  final String position; // top | bottom
  final int min;
  final int max; // 0 = không giới hạn
  final List<SoOptionItem> options;
  SoOptionGroup({
    required this.key,
    required this.name,
    required this.position,
    required this.min,
    required this.max,
    required this.options,
  });
  bool get single => min == 1 && max == 1;
  bool get required => min >= 1;
  factory SoOptionGroup.fromJson(Map<String, dynamic> j) => SoOptionGroup(
        key: (j['key'] ?? '').toString(),
        name: (j['name'] ?? '').toString(),
        position: j['position'] == 'bottom' ? 'bottom' : 'top',
        min: _soIntValue(j['min']),
        max: _soIntValue(j['max']),
        options: (j['options'] is List)
            ? (j['options'] as List)
                .whereType<Map>()
                .map((e) => SoOptionItem.fromJson(Map<String, dynamic>.from(e)))
                .where((o) => o.available)
                .toList()
            : <SoOptionItem>[],
      );
}

class SoMenuItem {
  final String id;
  final String name;
  final int price;
  final String? code;
  final String? barcode;
  final String? category;
  final String? categoryId;
  final String? image;
  final String? emoji;
  final String? description;
  final int slaMinutes;
  final List<dynamic> ingredients;
  final List<dynamic> allergens;
  final List<dynamic> modifiers;
  final List<dynamic> addons;
  final List<SoOptionGroup> optionGroups;

  SoMenuItem({
    required this.id,
    required this.name,
    required this.price,
    this.code,
    this.barcode,
    this.category,
    this.categoryId,
    this.image,
    this.emoji,
    this.description,
    this.slaMinutes = 0,
    this.ingredients = const [],
    this.allergens = const [],
    required this.modifiers,
    this.addons = const [],
    this.optionGroups = const [],
  });

  factory SoMenuItem.fromJson(Map<String, dynamic> json) {
    return SoMenuItem(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      price: _soIntValue(json['price']),
      code: json['code']?.toString(),
      barcode: json['barcode']?.toString(),
      category: json['category']?.toString(),
      categoryId: json['category_id']?.toString(),
      image: json['image']?.toString(),
      emoji: json['emoji']?.toString(),
      description: json['description']?.toString(),
      slaMinutes: _soIntValue(json['sla_minutes']),
      ingredients:
          json['ingredients'] is List ? json['ingredients'] as List : [],
      allergens: json['allergens'] is List ? json['allergens'] as List : [],
      modifiers: json['modifiers'] is List ? json['modifiers'] as List : [],
      addons: json['addons'] is List ? json['addons'] as List : [],
      optionGroups: (json['option_groups'] is List)
          ? (json['option_groups'] as List)
              .whereType<Map>()
              .map((e) => SoOptionGroup.fromJson(Map<String, dynamic>.from(e)))
              .where((g) => g.options.isNotEmpty)
              .toList()
          : <SoOptionGroup>[],
    );
  }
}

class SoZone {
  final String id;
  final String name;

  SoZone({required this.id, required this.name});

  factory SoZone.fromJson(Map<String, dynamic> json) {
    return SoZone(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
    );
  }
}

class SoTableModel {
  final String id;
  final String code;
  final String name;
  final String zoneId;
  final double posX; // vị trí sơ đồ theo đơn vị ô lưới (số thực, -1 = chưa xếp)
  final double posY;
  final String status; // 'empty', 'serving', 'paying', 'busy', etc.

  SoTableModel({
    required this.id,
    required this.code,
    required this.name,
    required this.zoneId,
    this.posX = -1,
    this.posY = -1,
    required this.status,
  });

  static double _num(dynamic v, double d) {
    if (v is num) return v.toDouble();
    return double.tryParse('${v ?? ''}') ?? d;
  }

  factory SoTableModel.fromJson(Map<String, dynamic> json) {
    return SoTableModel(
      id: (json['id'] ?? '').toString(),
      code: (json['code'] ?? '').toString(),
      // Server chỉ có `code` (VD "A01") → dùng làm tên hiển thị nếu thiếu name.
      name: (json['name'] ?? json['code'] ?? '').toString(),
      zoneId: (json['zone_id'] ?? json['zone'] ?? '').toString(),
      posX: _num(json['pos_x'], -1),
      posY: _num(json['pos_y'], -1),
      status: (json['status'] ?? 'empty').toString(),
    );
  }
}
