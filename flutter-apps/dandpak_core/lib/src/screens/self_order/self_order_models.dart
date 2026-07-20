// lib/screens/self_order/self_order_models.dart
// Model riêng cho module iPad Self-Order — tách biệt khỏi POS models.

int _soIntValue(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return double.tryParse(value?.toString() ?? '')?.toInt() ?? 0;
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
  final String status; // 'empty', 'serving', 'paying', 'busy', etc.

  SoTableModel({
    required this.id,
    required this.code,
    required this.name,
    required this.zoneId,
    required this.status,
  });

  factory SoTableModel.fromJson(Map<String, dynamic> json) {
    return SoTableModel(
      id: (json['id'] ?? '').toString(),
      code: (json['code'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      zoneId: (json['zone_id'] ?? json['zone'] ?? '').toString(),
      status: (json['status'] ?? 'empty').toString(),
    );
  }
}
