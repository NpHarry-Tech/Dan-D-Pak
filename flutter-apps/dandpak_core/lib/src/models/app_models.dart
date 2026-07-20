class AppModuleGroup {
  final String key;
  final String label;
  final int sort;

  AppModuleGroup({
    required this.key,
    required this.label,
    required this.sort,
  });

  factory AppModuleGroup.fromJson(Map<String, dynamic> json) {
    return AppModuleGroup(
      key: json['key']?.toString() ?? '',
      label: json['label']?.toString() ?? '',
      sort: int.tryParse(json['sort']?.toString() ?? '') ?? 0,
    );
  }
}

class AppModule {
  final String key;
  final String label;
  final String icon;
  final String group;
  final String href;
  final String? permission;
  final String status;
  final String description;
  final bool visible;

  AppModule({
    required this.key,
    required this.label,
    required this.icon,
    required this.group,
    required this.href,
    required this.permission,
    required this.status,
    required this.description,
    required this.visible,
  });

  bool get isActive => status == 'active';

  factory AppModule.fromJson(Map<String, dynamic> json) {
    return AppModule(
      key: json['key']?.toString() ?? '',
      label: json['label']?.toString() ?? '',
      icon: json['icon']?.toString() ?? '',
      group: json['group']?.toString() ?? '',
      href: json['href']?.toString() ?? '',
      permission: json['perm']?.toString(),
      status: json['status']?.toString() ?? 'planned',
      description: json['description']?.toString() ?? '',
      visible: json['visible'] != false,
    );
  }
}

class ModuleCatalog {
  final List<AppModuleGroup> groups;
  final List<AppModule> modules;

  ModuleCatalog({
    required this.groups,
    required this.modules,
  });

  factory ModuleCatalog.fromJson(Map<String, dynamic> json) {
    final groups = json['groups'] is List
        ? (json['groups'] as List)
            .whereType<Map>()
            .map((g) => AppModuleGroup.fromJson(Map<String, dynamic>.from(g)))
            .toList()
        : <AppModuleGroup>[];
    final modules = json['modules'] is List
        ? (json['modules'] as List)
            .whereType<Map>()
            .map((m) => AppModule.fromJson(Map<String, dynamic>.from(m)))
            .toList()
        : <AppModule>[];
    groups.sort((a, b) => a.sort.compareTo(b.sort));
    return ModuleCatalog(groups: groups, modules: modules);
  }
}
