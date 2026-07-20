import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../models/management_models.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../widgets/manager_pin_dialog.dart';
import '../../widgets/side_sheet.dart';
import '../self_order/self_order_strings.dart';
import 'book_menu_panel.dart';
import 'management_widgets.dart';
import '../../utils/translation.dart';

part 'menu_item_dialogs.dart';
part 'menu_shared.dart';

Map<String, String> get _stationLabels => {
      'kitchen': t('Bếp'),
      'bar': 'Bar',
      'salad': t('Salad/Lạnh'),
      'beverage': 'Beverage',
    };

/// Management → Thực đơn tab. Port of the web FnB menu management:
/// item list with availability/hide/delete, create/edit form (image, price,
/// station, recipe, schedule) and category management.
class MenuTab extends StatefulWidget {
  final ApiService api;
  MenuTab({super.key, required this.api});

  @override
  State<MenuTab> createState() => _MenuTabState();
}

class _MenuTabState extends State<MenuTab> {
  MenuManageData? _data;
  List<IngredientRef> _ingredients = [];
  String? _error;
  bool _loading = true;
  String _search = '';
  String? _filterCategoryId;
  String _subTab = 'items';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        widget.api.getMenuManage(),
        widget.api.getIngredients(),
      ]);
      if (!mounted) return;
      setState(() {
        _data = MenuManageData.fromJson(results[0] as Map<String, dynamic>);
        _ingredients = (results[1] as List)
            .whereType<Map>()
            .map((e) => IngredientRef.fromJson(Map<String, dynamic>.from(e)))
            .toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  String _categoryName(String id) =>
      _data?.categories
          .firstWhere((c) => c.id == id,
              orElse: () => AdminCategory(id: '', name: '', icon: ''))
          .name ??
      '';

  void _toast(String msg, {bool error = false}) =>
      appToast(context, msg, isError: error);

  Future<void> _toggleAvailability(AdminMenuItem item) async {
    try {
      await widget.api.setMenuAvailability(item.id, !item.available);
      _toast(item.available ? t('Đã tắt món') : t('Đã bật món'));
      _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  Future<void> _toggleHidden(AdminMenuItem item) async {
    try {
      await widget.api.setMenuHidden(item.id, !item.hidden);
      _toast(item.hidden ? t('Đã hiện món') : t('Đã ẩn món'));
      _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  Future<void> _delete(AdminMenuItem item) async {
    final pin = await requestManagerPin(
        context, t('Xóa món ăn "${item.name}". Cần PIN Manager hoặc Admin.'));
    if (pin == null) return;
    try {
      final r = await widget.api.deleteMenuItem(item.id, pin);
      _toast(r['archived'] == true
          ? t('Đã lưu trữ món (đã có order)')
          : t('Đã xóa món'));
      _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  Future<void> _openForm([AdminMenuItem? item]) async {
    final data = _data;
    if (data == null) return;
    final serverUrl = context.read<AuthProvider>().serverUrl;
    final saved = await showSideSheet<bool>(
      context,
      width: double.infinity,
      backgroundColor: Colors.transparent,
      elevation: 0,
      builder: (_) => _ItemFormDialog(
        api: widget.api,
        item: item,
        categories: data.categories,
        items: data.items,
        ingredients: _ingredients,
        serverUrl: serverUrl,
      ),
    );
    if (saved == true) _load();
  }

  Future<void> _openCategories() async {
    final data = _data;
    if (data == null) return;
    final changed = await showDialog<bool>(
      context: context,
      builder: (_) =>
          _CategoryManagerDialog(api: widget.api, categories: data.categories),
    );
    if (changed == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _data == null) {
      return Center(child: CircularProgressIndicator());
    }
    if (_error != null && _data == null) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được thực đơn ($_error)'),
            error: true, onRetry: _load),
      );
    }
    final data = _data!;
    final serverUrl = context.read<AuthProvider>().serverUrl;

    final items = data.items.where((i) {
      final catOk =
          _filterCategoryId == null || i.categoryId == _filterCategoryId;
      final q = foldSearch(_search);
      final searchOk = searchMatches(i.name, q);
      return catOk && searchOk;
    }).toList();

    if (_subTab == 'book') {
      return BookMenuPanel(
        api: widget.api,
        moduleSwitcher: _subNav(),
      );
    }

    return Column(
      children: [
        _subNav(),
        Divider(height: 1, color: DanColors.border),
        _toolbar(data),
        Divider(height: 1, color: DanColors.border),
        Expanded(
          child: items.isEmpty
              ? Center(
                  child: Text(t('Không có món nào'),
                      style: TextStyle(color: DanColors.faint)))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: EdgeInsets.all(16),
                    itemCount: items.length,
                    separatorBuilder: (_, __) => SizedBox(height: 8),
                    itemBuilder: (_, i) => _MenuRow(
                      item: items[i],
                      categoryName: _categoryName(items[i].categoryId),
                      serverUrl: serverUrl,
                      onEdit: () => _openForm(items[i]),
                      onToggleHidden: () => _toggleHidden(items[i]),
                      onDelete: () => _delete(items[i]),
                      onToggleAvailability: () => _toggleAvailability(items[i]),
                    ),
                  ),
                ),
        ),
      ],
    );
  }

  Widget _subNav() {
    Widget tab(String key, IconData icon, String label) {
      final selected = _subTab == key;
      return ChoiceChip(
        selected: selected,
        avatar: Icon(icon,
            size: 16, color: selected ? DanColors.brand : DanColors.muted),
        label: Text(label),
        onSelected: (_) => setState(() => _subTab = key),
      );
    }

    return Container(
      alignment: Alignment.centerLeft,
      padding: EdgeInsets.fromLTRB(14, 10, 14, 10),
      color: DanColors.surface,
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          tab('items', Icons.restaurant_menu_outlined, t('Thực đơn FnB')),
          tab('book', Icons.menu_book_outlined, t('Menu quyển')),
        ],
      ),
    );
  }

  Widget _toolbar(MenuManageData data) {
    return Padding(
      padding: EdgeInsets.all(14),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              decoration: InputDecoration(
                hintText: t('Tìm món...'),
                prefixIcon: Icon(Icons.search),
                isDense: true,
              ),
              onChanged: (v) => setState(() => _search = v),
            ),
          ),
          SizedBox(width: 10),
          SizedBox(
            width: 190,
            child: DropdownButtonFormField<String?>(
              initialValue: _filterCategoryId,
              isExpanded: true,
              decoration: InputDecoration(isDense: true),
              hint: Text(t('Tất cả nhóm')),
              items: [
                DropdownMenuItem(value: null, child: Text(t('Tất cả nhóm'))),
                for (final c in data.categories)
                  DropdownMenuItem(
                      value: c.id,
                      child: Text('${c.icon} ${c.name}'.trim(),
                          overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) => setState(() => _filterCategoryId = v),
            ),
          ),
          SizedBox(width: 10),
          OutlinedButton.icon(
            onPressed: _openCategories,
            icon: Icon(Icons.category_outlined, size: 16),
            label: Text(t('Danh mục')),
            style: OutlinedButton.styleFrom(minimumSize: Size(0, 44)),
          ),
          SizedBox(width: 8),
          FilledButton.icon(
            onPressed: () => _openForm(),
            icon: Icon(Icons.add, size: 18),
            label: Text(t('Thêm món')),
            style: FilledButton.styleFrom(minimumSize: Size(0, 44)),
          ),
        ],
      ),
    );
  }
}

class _MenuRow extends StatelessWidget {
  final AdminMenuItem item;
  final String categoryName;
  final String serverUrl;
  final VoidCallback onEdit;
  final VoidCallback onToggleHidden;
  final VoidCallback onDelete;
  final VoidCallback onToggleAvailability;

  _MenuRow({
    required this.item,
    required this.categoryName,
    required this.serverUrl,
    required this.onEdit,
    required this.onToggleHidden,
    required this.onDelete,
    required this.onToggleAvailability,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Row(
        children: [
          _Thumb(item: item, serverUrl: serverUrl),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(item.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 14.5, fontWeight: FontWeight.w800)),
                    ),
                    if (item.hidden) ...[
                      SizedBox(width: 6),
                      _Chip(t('Ẩn'), DanColors.muted),
                    ],
                    if (!item.scheduleAvailable) ...[
                      SizedBox(width: 6),
                      _Chip(t('Ngoài lịch'), DanColors.doing),
                    ],
                  ],
                ),
                SizedBox(height: 3),
                Text(
                  '${categoryName.isNotEmpty ? '$categoryName · ' : ''}${Fmt.money(item.price)} · ${_stationLabels[item.station] ?? item.station}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 11.5, color: DanColors.faint),
                ),
              ],
            ),
          ),
          SizedBox(width: 8),
          TextButton(onPressed: onEdit, child: Text(t('Sửa'))),
          TextButton(
              onPressed: onToggleHidden,
              child: Text(item.hidden ? t('Hiện') : t('Ẩn'))),
          TextButton(
            onPressed: onDelete,
            style: TextButton.styleFrom(foregroundColor: DanColors.late),
            child: Text(t('Xóa')),
          ),
          SizedBox(width: 4),
          Tooltip(
            message: item.available ? t('Đang bán') : t('Tạm hết'),
            child: Switch(
              value: item.available,
              activeThumbColor: DanColors.done,
              onChanged: (_) => onToggleAvailability(),
            ),
          ),
        ],
      ),
    );
  }
}

class _Thumb extends StatelessWidget {
  final AdminMenuItem item;
  final String serverUrl;
  _Thumb({required this.item, required this.serverUrl});

  @override
  Widget build(BuildContext context) {
    Widget fallback() => Container(
          width: 46,
          height: 46,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: DanColors.surface2,
            borderRadius: BorderRadius.circular(8),
          ),
          child: SizedBox.shrink(),
        );

    if (item.image.isEmpty) return fallback();
    final url = item.image.startsWith('http')
        ? item.image
        : '$serverUrl${item.image.startsWith('/') ? '' : '/'}${item.image}';
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Image.network(
        url,
        width: 46,
        height: 46,
        fit: BoxFit.cover,
        // Decode at thumbnail size — the menu list can hold hundreds of rows.
        cacheWidth: 92,
        filterQuality: FilterQuality.low,
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) => fallback(),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final Color color;
  _Chip(this.label, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .14),
        borderRadius: BorderRadius.circular(5),
      ),
      child: Text(label,
          style: TextStyle(
              fontSize: 10, fontWeight: FontWeight.w800, color: color)),
    );
  }
}

// ── Item create/edit form ───────────────────────────────────────────────

