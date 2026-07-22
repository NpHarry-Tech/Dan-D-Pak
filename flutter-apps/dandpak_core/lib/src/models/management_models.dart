// Data models for the Management (Quản lý) module — mirrors the payload
// returned by GET /api/dashboard and /api/dashboard/trends.

num _num(dynamic v) {
  if (v is num) return v;
  return num.tryParse(v?.toString() ?? '') ?? 0;
}

int _int(dynamic v) => _num(v).round();

String _str(dynamic v) => v?.toString() ?? '';

class DashboardWindow {
  final DateTime? start;
  final DateTime? end;
  final String source; // 'shift' | 'calendar'
  final bool closed;

  const DashboardWindow({
    this.start,
    this.end,
    this.source = 'calendar',
    this.closed = false,
  });

  bool get isShift => source == 'shift';

  factory DashboardWindow.fromJson(Map<String, dynamic> json) {
    DateTime? parse(dynamic v) {
      final s = v?.toString();
      if (s == null || s.isEmpty) return null;
      return DateTime.tryParse(s)?.toLocal();
    }

    return DashboardWindow(
      start: parse(json['start']),
      end: parse(json['end']),
      source: _str(json['source']).isEmpty ? 'calendar' : _str(json['source']),
      closed: json['closed'] == true,
    );
  }
}

class PaymentMethodStat {
  final String method;
  final num amount;
  const PaymentMethodStat(this.method, this.amount);
}

class TopItem {
  final String name;
  final String emoji;
  final int qty;
  final num revenue;
  const TopItem({
    required this.name,
    required this.emoji,
    required this.qty,
    required this.revenue,
  });

  factory TopItem.fromJson(Map<String, dynamic> j) => TopItem(
        name: _str(j['name']),
        emoji: _str(j['emoji']),
        qty: _int(j['qty']),
        revenue: _num(j['revenue']),
      );
}

class LowStockItem {
  final String name;
  final num stock;
  final num minStock;
  final String unit;
  const LowStockItem({
    required this.name,
    required this.stock,
    required this.minStock,
    required this.unit,
  });

  factory LowStockItem.fromJson(Map<String, dynamic> j) => LowStockItem(
        name: _str(j['name']),
        stock: _num(j['stock']),
        minStock: _num(j['min_stock']),
        unit: _str(j['unit']),
      );
}

class StationLoad {
  final String station;
  final int count;
  const StationLoad(this.station, this.count);
}

class DashboardData {
  final num revenue;
  final int bills;
  final num avg;
  final int openOrders;
  final List<num> byHour; // 24 buckets
  final Map<String, num> byChannel;
  final List<PaymentMethodStat> methods;
  final List<TopItem> topItems;
  final List<LowStockItem> lowStock;
  final List<StationLoad> stations;
  final DashboardWindow window;

  const DashboardData({
    required this.revenue,
    required this.bills,
    required this.avg,
    required this.openOrders,
    required this.byHour,
    required this.byChannel,
    required this.methods,
    required this.topItems,
    required this.lowStock,
    required this.stations,
    required this.window,
  });

  factory DashboardData.fromJson(Map<String, dynamic> j) {
    final hourRaw = j['byHour'];
    final hours = List<num>.filled(24, 0);
    if (hourRaw is List) {
      for (var i = 0; i < hourRaw.length && i < 24; i++) {
        hours[i] = _num(hourRaw[i]);
      }
    }

    final channelRaw = j['byChannel'];
    final channels = <String, num>{};
    if (channelRaw is Map) {
      channelRaw.forEach((k, v) => channels[k.toString()] = _num(v));
    }

    List<Map<String, dynamic>> mapList(dynamic v) => (v is List)
        ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
        : <Map<String, dynamic>>[];

    return DashboardData(
      revenue: _num(j['revenue']),
      bills: _int(j['bills']),
      avg: _num(j['avg']),
      openOrders: _int(j['openOrders']),
      byHour: hours,
      byChannel: channels,
      methods: mapList(j['methods'])
          .map((m) => PaymentMethodStat(_str(m['method']), _num(m['amt'])))
          .toList(),
      topItems: mapList(j['topItems']).map(TopItem.fromJson).toList(),
      lowStock: mapList(j['lowStock']).map(LowStockItem.fromJson).toList(),
      stations: mapList(j['stations'])
          .map((s) => StationLoad(_str(s['station']), _int(s['n'])))
          .toList(),
      window: DashboardWindow.fromJson(
          j['window'] is Map ? Map<String, dynamic>.from(j['window']) : {}),
    );
  }
}

class TrendPoint {
  final String label;
  final num value;
  const TrendPoint(this.label, this.value);

  factory TrendPoint.fromJson(Map<String, dynamic> j) =>
      TrendPoint(_str(j['label']), _num(j['value']));
}

// ── Menu management ────────────────────────────────────────────────────

List<String> _strList(dynamic v) {
  if (v is List) return v.map((e) => e.toString()).toList();
  if (v is String && v.trim().isNotEmpty) {
    return v
        .split(',')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();
  }
  return <String>[];
}

class AdminCategory {
  final String id;
  final String name;
  final String icon;
  const AdminCategory(
      {required this.id, required this.name, required this.icon});
  factory AdminCategory.fromJson(Map<String, dynamic> j) => AdminCategory(
        id: _str(j['id']),
        name: _str(j['name']),
        icon: _str(j['icon']),
      );
}

class RecipeLine {
  final String inventoryItemId;
  final num qty;
  const RecipeLine(this.inventoryItemId, this.qty);
  factory RecipeLine.fromJson(Map<String, dynamic> j) =>
      RecipeLine(_str(j['inventory_item_id']), _num(j['qty']));
  Map<String, dynamic> toJson() =>
      {'inventory_item_id': inventoryItemId, 'qty': qty};
}

class MenuSchedule {
  final String mode; // always | daily | weekly | date
  final String start;
  final String end;
  final List<String> days;
  final String date;
  const MenuSchedule({
    this.mode = 'always',
    this.start = '00:00',
    this.end = '23:59',
    this.days = const [],
    this.date = '',
  });

  factory MenuSchedule.fromJson(Map<String, dynamic> j) => MenuSchedule(
        mode: _str(j['mode']).isEmpty ? 'always' : _str(j['mode']),
        start: _str(j['start']).isEmpty ? '00:00' : _str(j['start']),
        end: _str(j['end']).isEmpty ? '23:59' : _str(j['end']),
        days: _strList(j['days']),
        date: _str(j['date']),
      );

  Map<String, dynamic> toJson() => {
        'mode': mode,
        'start': start,
        'end': end,
        'days': days,
        'date': date,
      };
}

class MenuAddon {
  final String key;
  final String name;
  final String kind; // combo | extra
  final String type; // paid | free
  final num price;
  final String refItemId;
  final bool available;

  const MenuAddon({
    required this.key,
    required this.name,
    required this.kind,
    required this.type,
    required this.price,
    required this.refItemId,
    required this.available,
  });

  factory MenuAddon.fromJson(Map<String, dynamic> j) => MenuAddon(
        key: _str(j['key']),
        name: _str(j['name']),
        kind: _str(j['kind']).isEmpty ? 'extra' : _str(j['kind']),
        type: _str(j['type']).isEmpty ? 'paid' : _str(j['type']),
        price: _num(j['price']),
        refItemId: _str(j['ref_item_id']),
        available: j['available'] != false && j['available'] != 0,
      );
}

class AdminMenuItem {
  final String id;
  final String name;
  final String emoji;
  final String image;
  final String description;
  final num price;
  final num vatRate;
  final bool priceIncludesVat;
  final String categoryId;
  final String station;
  final int slaMinutes;
  final bool available;
  final bool hidden;
  final bool scheduleAvailable;
  final List<String> ingredients;
  final List<String> allergens;
  final List<RecipeLine> recipe;
  final MenuSchedule schedule;
  final List<MenuAddon> addons;
  final Map<String, Map<String, String>> translations;

  const AdminMenuItem({
    required this.id,
    required this.name,
    required this.emoji,
    required this.image,
    required this.description,
    required this.price,
    required this.vatRate,
    required this.priceIncludesVat,
    required this.categoryId,
    required this.station,
    required this.slaMinutes,
    required this.available,
    required this.hidden,
    required this.scheduleAvailable,
    required this.ingredients,
    required this.allergens,
    required this.recipe,
    required this.schedule,
    required this.addons,
    required this.translations,
  });

  factory AdminMenuItem.fromJson(Map<String, dynamic> j) {
    final recipeRaw = j['recipe'];
    final addonsRaw = j['addons'];
    return AdminMenuItem(
      id: _str(j['id']),
      name: _str(j['name']),
      emoji: _str(j['emoji']),
      image: _str(j['image']),
      description: _str(j['description']),
      price: _num(j['price']),
      vatRate: _num(j['vat_rate']),
      priceIncludesVat:
          j['price_includes_vat'] != 0 && j['price_includes_vat'] != false,
      categoryId: _str(j['category_id']),
      station: _str(j['station']).isEmpty ? 'kitchen' : _str(j['station']),
      slaMinutes: _int(j['sla_minutes'] ?? 10),
      available: j['available'] != 0 && j['available'] != false,
      hidden: j['hidden'] == 1 || j['hidden'] == true,
      scheduleAvailable: j['schedule_available'] == null
          ? true
          : (j['schedule_available'] != false && j['schedule_available'] != 0),
      ingredients: _strList(j['ingredients']),
      allergens: _strList(j['allergens']),
      recipe: (recipeRaw is List)
          ? recipeRaw
              .whereType<Map>()
              .map((e) => RecipeLine.fromJson(Map<String, dynamic>.from(e)))
              .toList()
          : <RecipeLine>[],
      schedule: MenuSchedule.fromJson(
          j['schedule'] is Map ? Map<String, dynamic>.from(j['schedule']) : {}),
      addons: (addonsRaw is List)
          ? addonsRaw
              .whereType<Map>()
              .map((e) => MenuAddon.fromJson(Map<String, dynamic>.from(e)))
              .toList()
          : <MenuAddon>[],
      translations: _translations(j['translations']),
    );
  }
}

Map<String, Map<String, String>> _translations(dynamic raw) {
  const langs = ['vi', 'en', 'zh', 'ja', 'ko'];
  final map = raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
  return {
    for (final lang in langs)
      lang: {
        'name': map[lang] is Map ? _str((map[lang] as Map)['name']) : '',
        'description':
            map[lang] is Map ? _str((map[lang] as Map)['description']) : '',
      }
  };
}

class MenuManageData {
  final List<AdminCategory> categories;
  final List<AdminMenuItem> items;
  const MenuManageData(this.categories, this.items);

  factory MenuManageData.fromJson(Map<String, dynamic> j) {
    List<Map<String, dynamic>> list(dynamic v) => (v is List)
        ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
        : <Map<String, dynamic>>[];
    return MenuManageData(
      list(j['categories']).map(AdminCategory.fromJson).toList(),
      list(j['items']).map(AdminMenuItem.fromJson).toList(),
    );
  }
}

class IngredientRef {
  final String id;
  final String name;
  final String unit;
  const IngredientRef(this.id, this.name, this.unit);
  factory IngredientRef.fromJson(Map<String, dynamic> j) =>
      IngredientRef(_str(j['id']), _str(j['name']), _str(j['unit']));
}

// ── Report center ──────────────────────────────────────────────────────

class ReportGroup {
  final String key;
  final String label;
  const ReportGroup(this.key, this.label);
  factory ReportGroup.fromJson(Map<String, dynamic> j) =>
      ReportGroup(_str(j['key']), _str(j['label']));
}

class ReportInfo {
  final String key;
  final String group;
  final String label;
  final String description;
  const ReportInfo({
    required this.key,
    required this.group,
    required this.label,
    required this.description,
  });
  factory ReportInfo.fromJson(Map<String, dynamic> j) => ReportInfo(
        key: _str(j['key']),
        group: _str(j['group']),
        label: _str(j['label']),
        description: _str(j['description']),
      );
}

class ReportBranch {
  final String id;
  final String name;
  final String code;
  const ReportBranch({
    required this.id,
    required this.name,
    required this.code,
  });
  factory ReportBranch.fromJson(Map<String, dynamic> j) => ReportBranch(
        id: _str(j['id']),
        name: _str(j['name']),
        code: _str(j['code']),
      );
}

class ReportCatalog {
  final List<ReportGroup> groups;
  final List<ReportInfo> reports;
  final List<ReportBranch> branches;
  final String defaultBranchId;
  const ReportCatalog(
    this.groups,
    this.reports, {
    this.branches = const [],
    this.defaultBranchId = '',
  });

  factory ReportCatalog.fromJson(Map<String, dynamic> j) {
    List<Map<String, dynamic>> list(dynamic v) => (v is List)
        ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
        : <Map<String, dynamic>>[];
    return ReportCatalog(
      list(j['groups']).map(ReportGroup.fromJson).toList(),
      list(j['reports']).map(ReportInfo.fromJson).toList(),
      branches: list(j['branches']).map(ReportBranch.fromJson).toList(),
      defaultBranchId: _str(j['default_branch_id']),
    );
  }
}

class ReportColumn {
  final String key;
  final String label;
  final bool right;
  const ReportColumn(this.key, this.label, this.right);
  factory ReportColumn.fromJson(Map<String, dynamic> j) => ReportColumn(
      _str(j['key']), _str(j['label']), _str(j['align']) == 'right');
}

class ReportSection {
  final String title;
  final List<ReportColumn> columns;
  final List<Map<String, dynamic>> rows;
  const ReportSection(this.title, this.columns, this.rows);

  factory ReportSection.fromJson(Map<String, dynamic> j) {
    final cols = (j['columns'] is List)
        ? (j['columns'] as List)
            .whereType<Map>()
            .map((e) => ReportColumn.fromJson(Map<String, dynamic>.from(e)))
            .toList()
        : <ReportColumn>[];
    final rows = (j['rows'] is List)
        ? (j['rows'] as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList()
        : <Map<String, dynamic>>[];
    return ReportSection(_str(j['title']), cols, rows);
  }
}

class ReportSummaryStat {
  final String label;
  final String value;
  const ReportSummaryStat(this.label, this.value);
}

class ReportData {
  final String key;
  final String title;
  final String rangeLabel;
  final String generatedAt;
  final List<ReportSummaryStat> summary;
  final List<ReportSection> sections;

  const ReportData({
    required this.key,
    required this.title,
    required this.rangeLabel,
    required this.generatedAt,
    required this.summary,
    required this.sections,
  });

  factory ReportData.fromJson(Map<String, dynamic> j) {
    final range =
        j['range'] is Map ? Map<String, dynamic>.from(j['range']) : {};
    final summary = (j['summary'] is List)
        ? (j['summary'] as List)
            .whereType<Map>()
            .map((e) => ReportSummaryStat(_str(e['label']), _str(e['value'])))
            .toList()
        : <ReportSummaryStat>[];
    final sections = (j['sections'] is List)
        ? (j['sections'] as List)
            .whereType<Map>()
            .map((e) => ReportSection.fromJson(Map<String, dynamic>.from(e)))
            .toList()
        : <ReportSection>[];
    return ReportData(
      key: _str(j['key']),
      title: _str(j['title']),
      rangeLabel: _str(range['label']),
      generatedAt: _str(j['generated_at']),
      summary: summary,
      sections: sections,
    );
  }
}

/// Ranges keyed by the same identifiers the backend returns.
class TrendsData {
  final Map<String, List<TrendPoint>> series;
  const TrendsData(this.series);

  List<TrendPoint> range(String key) => series[key] ?? const [];

  factory TrendsData.fromJson(Map<String, dynamic> j) {
    final out = <String, List<TrendPoint>>{};
    for (final key in const [
      'byDay',
      'byWeek',
      'byMonth',
      'byQuarter',
      'byYear'
    ]) {
      final raw = j[key];
      if (raw is List) {
        out[key] = raw
            .whereType<Map>()
            .map((e) => TrendPoint.fromJson(Map<String, dynamic>.from(e)))
            .toList();
      } else {
        out[key] = const [];
      }
    }
    return TrendsData(out);
  }
}
