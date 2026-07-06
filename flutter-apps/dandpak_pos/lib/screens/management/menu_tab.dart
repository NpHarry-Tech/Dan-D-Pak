import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/management_models.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../widgets/manager_pin_dialog.dart';
import '../../widgets/side_sheet.dart';
import 'book_menu_panel.dart';
import 'management_widgets.dart';

const _stationLabels = {
  'kitchen': 'Bếp',
  'bar': 'Bar',
  'salad': 'Salad/Lạnh',
  'beverage': 'Beverage',
};

/// Management → Thực đơn tab. Port of the web FnB menu management:
/// item list with availability/hide/delete, create/edit form (image, price,
/// station, recipe, schedule) and category management.
class MenuTab extends StatefulWidget {
  final ApiService api;
  const MenuTab({super.key, required this.api});

  @override
  State<MenuTab> createState() => _MenuTabState();
}

class _MenuTabState extends State<MenuTab> {
  MenuManageData? _data;
  List<IngredientRef> _ingredients = const [];
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
              orElse: () => const AdminCategory(id: '', name: '', icon: ''))
          .name ??
      '';

  void _toast(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? DanColors.late : DanColors.text,
    ));
  }

  Future<void> _toggleAvailability(AdminMenuItem item) async {
    try {
      await widget.api.setMenuAvailability(item.id, !item.available);
      _toast(item.available ? 'Đã tắt món' : 'Đã bật món');
      _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  Future<void> _toggleHidden(AdminMenuItem item) async {
    try {
      await widget.api.setMenuHidden(item.id, !item.hidden);
      _toast(item.hidden ? 'Đã hiện món' : 'Đã ẩn món');
      _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  Future<void> _delete(AdminMenuItem item) async {
    final pin = await requestManagerPin(
        context, 'Xóa món ăn "${item.name}". Cần PIN Manager hoặc Admin.');
    if (pin == null) return;
    try {
      final r = await widget.api.deleteMenuItem(item.id, pin);
      _toast(r['archived'] == true
          ? 'Đã lưu trữ món (đã có order)'
          : 'Đã xóa món');
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
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _data == null) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage('Không tải được thực đơn ($_error)',
            error: true, onRetry: _load),
      );
    }
    final data = _data!;
    final serverUrl = context.read<AuthProvider>().serverUrl;

    final items = data.items.where((i) {
      final catOk =
          _filterCategoryId == null || i.categoryId == _filterCategoryId;
      final q = _search.trim().toLowerCase();
      final searchOk = q.isEmpty || i.name.toLowerCase().contains(q);
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
        const Divider(height: 1, color: DanColors.border),
        _toolbar(data),
        const Divider(height: 1, color: DanColors.border),
        Expanded(
          child: items.isEmpty
              ? const Center(
                  child: Text('Không có món nào',
                      style: TextStyle(color: DanColors.faint)))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
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
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      color: DanColors.surface,
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          tab('items', Icons.restaurant_menu_outlined, 'Thực đơn FnB'),
          tab('book', Icons.menu_book_outlined, 'Menu quyển'),
        ],
      ),
    );
  }

  Widget _toolbar(MenuManageData data) {
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              decoration: const InputDecoration(
                hintText: 'Tìm món...',
                prefixIcon: Icon(Icons.search),
                isDense: true,
              ),
              onChanged: (v) => setState(() => _search = v),
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(
            width: 190,
            child: DropdownButtonFormField<String?>(
              initialValue: _filterCategoryId,
              isExpanded: true,
              decoration: const InputDecoration(isDense: true),
              hint: const Text('Tất cả nhóm'),
              items: [
                const DropdownMenuItem(value: null, child: Text('Tất cả nhóm')),
                for (final c in data.categories)
                  DropdownMenuItem(
                      value: c.id,
                      child: Text('${c.icon} ${c.name}'.trim(),
                          overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) => setState(() => _filterCategoryId = v),
            ),
          ),
          const SizedBox(width: 10),
          OutlinedButton.icon(
            onPressed: _openCategories,
            icon: const Icon(Icons.category_outlined, size: 16),
            label: const Text('Danh mục'),
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
          ),
          const SizedBox(width: 8),
          FilledButton.icon(
            onPressed: () => _openForm(),
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Thêm món'),
            style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
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

  const _MenuRow({
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
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Row(
        children: [
          _Thumb(item: item, serverUrl: serverUrl),
          const SizedBox(width: 12),
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
                          style: const TextStyle(
                              fontSize: 14.5, fontWeight: FontWeight.w800)),
                    ),
                    if (item.hidden) ...[
                      const SizedBox(width: 6),
                      const _Chip('Ẩn', DanColors.muted),
                    ],
                    if (!item.scheduleAvailable) ...[
                      const SizedBox(width: 6),
                      const _Chip('Ngoài lịch', DanColors.doing),
                    ],
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  '${categoryName.isNotEmpty ? '$categoryName · ' : ''}${Fmt.money(item.price)} · ${_stationLabels[item.station] ?? item.station}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style:
                      const TextStyle(fontSize: 11.5, color: DanColors.faint),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          TextButton(onPressed: onEdit, child: const Text('Sửa')),
          TextButton(
              onPressed: onToggleHidden,
              child: Text(item.hidden ? 'Hiện' : 'Ẩn')),
          TextButton(
            onPressed: onDelete,
            style: TextButton.styleFrom(foregroundColor: DanColors.late),
            child: const Text('Xóa'),
          ),
          const SizedBox(width: 4),
          Tooltip(
            message: item.available ? 'Đang bán' : 'Tạm hết',
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
  const _Thumb({required this.item, required this.serverUrl});

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
          child: const SizedBox.shrink(),
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
  const _Chip(this.label, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
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

class _ItemFormDialog extends StatefulWidget {
  final ApiService api;
  final AdminMenuItem? item;
  final List<AdminCategory> categories;
  final List<AdminMenuItem> items;
  final List<IngredientRef> ingredients;
  final String serverUrl;

  const _ItemFormDialog({
    required this.api,
    required this.item,
    required this.categories,
    required this.items,
    required this.ingredients,
    required this.serverUrl,
  });

  @override
  State<_ItemFormDialog> createState() => _ItemFormDialogState();
}

class _ItemFormDialogState extends State<_ItemFormDialog> {
  late final TextEditingController _name;
  late final TextEditingController _price;
  late final TextEditingController _emoji;
  late final TextEditingController _sla;
  late final TextEditingController _image;
  late final TextEditingController _description;
  late final TextEditingController _ingredients;
  late final TextEditingController _allergens;

  late String _categoryId;
  late String _station;
  late bool _hidden;
  late String _schedMode;
  late final TextEditingController _start;
  late final TextEditingController _end;
  late final TextEditingController _date;
  late Set<String> _days;
  late List<_RecipeRow> _recipe;
  late List<_AddonRow> _addons;

  bool _saving = false;
  bool _uploadingImage = false;

  bool get _isEdit => widget.item != null;

  @override
  void initState() {
    super.initState();
    final i = widget.item;
    _name = TextEditingController(text: i?.name ?? '');
    _price = TextEditingController(
        text: i != null ? i.price.round().toString() : '');
    _emoji = TextEditingController(text: i?.emoji ?? '');
    _sla = TextEditingController(text: (i?.slaMinutes ?? 10).toString());
    _image = TextEditingController(text: i?.image ?? '');
    _description = TextEditingController(text: i?.description ?? '');
    _ingredients =
        TextEditingController(text: (i?.ingredients ?? const []).join(', '));
    _allergens =
        TextEditingController(text: (i?.allergens ?? const []).join(', '));
    _categoryId = i?.categoryId.isNotEmpty == true
        ? i!.categoryId
        : (widget.categories.isNotEmpty ? widget.categories.first.id : '');
    _station = _stationLabels.containsKey(i?.station) ? i!.station : 'kitchen';
    _hidden = i?.hidden ?? false;
    final s = i?.schedule ?? const MenuSchedule();
    _schedMode = const {'always', 'daily', 'weekly', 'date'}.contains(s.mode)
        ? s.mode
        : 'always';
    _start = TextEditingController(text: s.start);
    _end = TextEditingController(text: s.end);
    _date = TextEditingController(text: s.date);
    _days = s.days.toSet();
    _recipe = (i?.recipe ?? const [])
        .map((r) => _RecipeRow(r.inventoryItemId, r.qty.toString()))
        .toList();
    _addons = (i?.addons ?? const [])
        .map((a) => _AddonRow(
              kind: a.kind == 'combo' ? 'combo' : 'extra',
              type: a.type == 'free' ? 'free' : 'paid',
              price: a.price.round().toString(),
              refItemId: a.refItemId,
              name: a.name,
              available: a.available,
            ))
        .toList();
    // Live-update the iPad preview as these fields change.
    for (final c in [_name, _price, _emoji, _image, _description]) {
      c.addListener(_onPreviewChange);
    }
  }

  void _onPreviewChange() {
    if (mounted) setState(() {});
  }

  String get _categoryName {
    for (final c in widget.categories) {
      if (c.id == _categoryId) return c.name;
    }
    return '';
  }

  @override
  void dispose() {
    for (final c in [
      _name,
      _price,
      _emoji,
      _sla,
      _image,
      _description,
      _ingredients,
      _allergens,
      _start,
      _end,
      _date,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  List<String> _parseList(String s) =>
      s.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toList();

  Future<void> _save() async {
    if (_name.text.trim().isEmpty || _categoryId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Cần nhập tên món và chọn nhóm'),
        backgroundColor: DanColors.late,
      ));
      return;
    }
    final pin = await requestManagerPin(
        context,
        _isEdit
            ? 'Cập nhật món "${_name.text.trim()}".'
            : 'Tạo món mới "${_name.text.trim()}".');
    if (pin == null) return;

    final body = <String, dynamic>{
      'name': _name.text.trim(),
      'price': int.tryParse(_price.text.trim()) ?? 0,
      'emoji': _emoji.text.trim(),
      'sla_minutes': int.tryParse(_sla.text.trim()) ?? 10,
      'image': _image.text.trim(),
      'description': _description.text.trim(),
      'category_id': _categoryId,
      'station': _station,
      'ingredients': _parseList(_ingredients.text),
      'allergens': _parseList(_allergens.text),
      'hidden': _hidden,
      'schedule': {
        'mode': _schedMode,
        'start': _start.text.trim(),
        'end': _end.text.trim(),
        'days': _days.toList(),
        'date': _date.text.trim(),
      },
      'recipe': [
        for (final r in _recipe)
          if (r.ingredientId.isNotEmpty)
            {
              'inventory_item_id': r.ingredientId,
              'qty': double.tryParse(r.qty) ?? 0
            },
      ],
      'addons': [
        for (final a in _addons)
          if ((a.kind == 'combo' && a.refItemId.isNotEmpty) ||
              (a.kind != 'combo' && a.name.trim().isNotEmpty))
            {
              'kind': a.kind == 'combo' ? 'combo' : 'extra',
              'type': a.type == 'free' ? 'free' : 'paid',
              'price':
                  a.type == 'free' ? 0 : (int.tryParse(a.price.trim()) ?? 0),
              'ref_item_id': a.kind == 'combo' ? a.refItemId : null,
              'name': a.name.trim(),
              'available': a.available,
            },
      ],
      'security_pin': pin,
    };

    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await widget.api.updateMenuItem(widget.item!.id, body);
      } else {
        await widget.api.createMenuItem(body);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: DanColors.late,
        ));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Left: The edit form container styled as a side sheet drawer
        SizedBox(
          width: 580,
          child: Scaffold(
            backgroundColor: DanColors.surface,
            body: SafeArea(
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 16, 12, 10),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(_isEdit ? 'Sửa món' : 'Thêm món mới',
                              style: const TextStyle(
                                  fontSize: 19, fontWeight: FontWeight.w900)),
                        ),
                        IconButton(
                            onPressed: () => Navigator.of(context).pop(),
                            icon: const Icon(Icons.close)),
                      ],
                    ),
                  ),
                  const Divider(height: 1, color: DanColors.border),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.all(20),
                      children: [
                        _field('Tên món', _name, hint: 'VD: Bún bò Huế'),
                        Row(
                          children: [
                            Expanded(
                                child: _field('Giá', _price, number: true)),
                            const SizedBox(width: 12),
                            Expanded(child: _field('Emoji', _emoji)),
                            const SizedBox(width: 12),
                            Expanded(
                                child: _field('SLA phút', _sla, number: true)),
                          ],
                        ),
                        Row(
                          children: [
                            Expanded(child: _categoryDropdown()),
                            const SizedBox(width: 12),
                            Expanded(child: _stationDropdown()),
                          ],
                        ),
                        _imageEditor(),
                        _field('Mô tả món', _description, lines: 2),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                                child: _field(
                                    'Nguyên liệu (hiển thị)', _ingredients,
                                    lines: 2, hint: 'thịt bò, hành...')),
                            const SizedBox(width: 12),
                            Expanded(
                                child: _field('Allergen / dị ứng', _allergens,
                                    lines: 2, hint: 'sữa, trứng...')),
                          ],
                        ),
                        const SizedBox(height: 6),
                        _recipeEditor(),
                        const SizedBox(height: 14),
                        _addonsEditor(),
                        const SizedBox(height: 14),
                        _scheduleEditor(),
                        const SizedBox(height: 10),
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          value: _hidden,
                          activeThumbColor: DanColors.brand,
                          title: const Text('Ẩn khỏi iPad / POS',
                              style: TextStyle(
                                  fontSize: 13.5, fontWeight: FontWeight.w700)),
                          onChanged: (v) => setState(() => _hidden = v),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1, color: DanColors.border),
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        TextButton(
                            onPressed: () => Navigator.of(context).pop(),
                            child: const Text('Hủy')),
                        const SizedBox(width: 8),
                        FilledButton(
                          onPressed: _saving ? null : _save,
                          child: _saving
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white))
                              : Text(_isEdit ? 'Lưu thay đổi' : 'Tạo món'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        // Right: The empty space and floating preview card in the remaining space
        Expanded(
          child: GestureDetector(
            behavior: HitTestBehavior.translucent,
            onTap: () => Navigator.of(context).maybePop(),
            child: Center(
              child: GestureDetector(
                onTap:
                    () {}, // Prevent pop when tapping the preview card itself
                child: _MenuItemPreview(state: this),
              ),
            ),
          ),
        ),
      ],
    );
  }

  // ── Live preview accessors (read by _MenuItemPreview) ─────────────────
  String get pvName => _name.text.trim();
  String get pvEmoji => _emoji.text.trim();
  String get pvImage => _image.text.trim();
  String get pvDescription => _description.text.trim();
  num get pvPrice => num.tryParse(_price.text.trim()) ?? 0;
  bool get pvHidden => _hidden;
  String get pvStationLabel => _stationLabels[_station] ?? _station;
  String get pvCategory => _categoryName;
  String get pvServerUrl => widget.serverUrl;
  List<String> get pvIngredients => _parseList(_ingredients.text);
  List<String> get pvAllergens => _parseList(_allergens.text);

  Widget _field(String label, TextEditingController c,
      {bool number = false, int lines = 1, String? hint}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style:
                  const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          const SizedBox(height: 5),
          TextField(
            controller: c,
            maxLines: lines,
            keyboardType: number ? TextInputType.number : null,
            decoration: InputDecoration(hintText: hint, isDense: true),
          ),
        ],
      ),
    );
  }

  Widget _categoryDropdown() {
    final hasCat = widget.categories.any((c) => c.id == _categoryId);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Nhóm',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          const SizedBox(height: 5),
          DropdownButtonFormField<String>(
            initialValue: hasCat ? _categoryId : null,
            isExpanded: true,
            decoration: const InputDecoration(isDense: true),
            items: [
              for (final c in widget.categories)
                DropdownMenuItem(
                    value: c.id,
                    child: Text('${c.icon} ${c.name}'.trim(),
                        overflow: TextOverflow.ellipsis)),
            ],
            onChanged: (v) => setState(() => _categoryId = v ?? _categoryId),
          ),
        ],
      ),
    );
  }

  Widget _stationDropdown() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Station',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          const SizedBox(height: 5),
          DropdownButtonFormField<String>(
            initialValue: _station,
            isExpanded: true,
            decoration: const InputDecoration(isDense: true),
            items: [
              for (final e in _stationLabels.entries)
                DropdownMenuItem(value: e.key, child: Text(e.value)),
            ],
            onChanged: (v) => setState(() => _station = v ?? _station),
          ),
        ],
      ),
    );
  }

  Widget _imageEditor() {
    final src = _image.text.trim();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Ảnh món',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Container(
                  width: 86,
                  height: 86,
                  color: DanColors.surface2,
                  alignment: Alignment.center,
                  child: src.isEmpty
                      ? Text(pvEmoji, style: const TextStyle(fontSize: 30))
                      : Image.network(
                          _absoluteImageUrl(src),
                          width: 86,
                          height: 86,
                          fit: BoxFit.cover,
                          cacheWidth: 172,
                          filterQuality: FilterQuality.low,
                          gaplessPlayback: true,
                          errorBuilder: (_, __, ___) => Text(pvEmoji,
                              style: const TextStyle(fontSize: 30)),
                        ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  children: [
                    TextField(
                      controller: _image,
                      decoration: const InputDecoration(
                        isDense: true,
                        hintText: '/uploads/menu/... hoặc https://...',
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        OutlinedButton.icon(
                          onPressed: _uploadingImage ? null : _pickMenuImage,
                          icon: _uploadingImage
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2))
                              : const Icon(Icons.image_outlined, size: 16),
                          label:
                              Text(_uploadingImage ? 'Đang tải' : 'Chọn ảnh'),
                        ),
                        const SizedBox(width: 8),
                        TextButton(
                          onPressed: _uploadingImage
                              ? null
                              : () => setState(_image.clear),
                          child: const Text('Bỏ ảnh'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _absoluteImageUrl(String src) {
    if (src.startsWith('http') || src.startsWith('data:')) return src;
    return '${widget.serverUrl}${src.startsWith('/') ? '' : '/'}$src';
  }

  Future<void> _pickMenuImage() async {
    final path = await _pickImagePath();
    if (path == null || path.isEmpty) return;

    final file = File(path);
    final length = await file.length();
    if (length > 20 * 1024 * 1024) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Ảnh tối đa 20MB'),
        backgroundColor: DanColors.late,
      ));
      return;
    }

    setState(() => _uploadingImage = true);
    try {
      final bytes = await file.readAsBytes();
      final name = path.split(RegExp(r'[\\/]')).last;
      final res = await widget.api.uploadMenuImage(
        originalName: name,
        mimeType: _mimeForFileName(name),
        data: base64Encode(bytes),
      );
      if (!mounted) return;
      setState(() {
        _image.text = (res['url'] ?? '').toString();
        _uploadingImage = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploadingImage = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
        backgroundColor: DanColors.late,
      ));
    }
  }

  Future<String?> _pickImagePath() async {
    const script = r'''
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Chọn ảnh món'
$dialog.Filter = 'Ảnh (*.jpg;*.jpeg;*.png;*.webp;*.gif)|*.jpg;*.jpeg;*.png;*.webp;*.gif'
$dialog.Multiselect = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.FileName
}
''';
    final result = await Process.run(
      'powershell.exe',
      ['-NoProfile', '-STA', '-Command', script],
    );
    if (result.exitCode != 0) return null;
    return result.stdout.toString().trim();
  }

  Widget _addonsEditor() {
    final otherItems =
        widget.items.where((m) => m.id != widget.item?.id).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Món ăn kèm & Extra',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        if (_addons.isEmpty)
          const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Text('Chưa có món kèm / extra.',
                style: TextStyle(color: DanColors.faint, fontSize: 12)),
          ),
        for (var i = 0; i < _addons.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                SizedBox(
                  width: 116,
                  child: DropdownButtonFormField<String>(
                    initialValue: _addons[i].kind,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true),
                    items: const [
                      DropdownMenuItem(value: 'combo', child: Text('Ăn kèm')),
                      DropdownMenuItem(value: 'extra', child: Text('Extra')),
                    ],
                    onChanged: (v) => setState(() {
                      _addons[i].kind = v ?? 'extra';
                      if (_addons[i].kind == 'combo' &&
                          _addons[i].refItemId.isEmpty &&
                          otherItems.isNotEmpty) {
                        _addons[i].refItemId = otherItems.first.id;
                        _addons[i].name = otherItems.first.name;
                      }
                    }),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _addons[i].kind == 'combo'
                      ? DropdownButtonFormField<String>(
                          initialValue: otherItems
                                  .any((m) => m.id == _addons[i].refItemId)
                              ? _addons[i].refItemId
                              : null,
                          isExpanded: true,
                          decoration: const InputDecoration(
                              isDense: true, hintText: 'Chọn món'),
                          items: [
                            for (final item in otherItems)
                              DropdownMenuItem(
                                value: item.id,
                                child: Text(item.name,
                                    overflow: TextOverflow.ellipsis),
                              ),
                          ],
                          onChanged: (v) => setState(() {
                            _addons[i].refItemId = v ?? '';
                            for (final item in otherItems) {
                              if (item.id == v) {
                                _addons[i].name = item.name;
                                break;
                              }
                            }
                          }),
                        )
                      : TextField(
                          controller:
                              TextEditingController(text: _addons[i].name)
                                ..selection = TextSelection.collapsed(
                                    offset: _addons[i].name.length),
                          decoration: const InputDecoration(
                              isDense: true, hintText: 'Tên extra / topping'),
                          onChanged: (v) => _addons[i].name = v,
                        ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 112,
                  child: DropdownButtonFormField<String>(
                    initialValue: _addons[i].type,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true),
                    items: const [
                      DropdownMenuItem(value: 'paid', child: Text('Mua thêm')),
                      DropdownMenuItem(value: 'free', child: Text('Tặng kèm')),
                    ],
                    onChanged: (v) => setState(() {
                      _addons[i].type = v ?? 'paid';
                      if (_addons[i].type == 'free') _addons[i].price = '0';
                    }),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 82,
                  child: TextField(
                    enabled: _addons[i].type != 'free',
                    controller: TextEditingController(text: _addons[i].price)
                      ..selection = TextSelection.collapsed(
                          offset: _addons[i].price.length),
                    keyboardType: TextInputType.number,
                    decoration:
                        const InputDecoration(isDense: true, hintText: 'Giá'),
                    onChanged: (v) => _addons[i].price = v,
                  ),
                ),
                IconButton(
                  onPressed: () => setState(() => _addons.removeAt(i)),
                  icon: const Icon(Icons.remove_circle_outline,
                      color: DanColors.late, size: 20),
                ),
              ],
            ),
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: () => setState(() {
              if (otherItems.isNotEmpty) {
                _addons.add(_AddonRow(
                  kind: 'combo',
                  type: 'paid',
                  price: '0',
                  refItemId: otherItems.first.id,
                  name: otherItems.first.name,
                ));
              } else {
                _addons.add(_AddonRow(kind: 'extra', type: 'paid', price: '0'));
              }
            }),
            icon: const Icon(Icons.add, size: 16),
            label: const Text('Thêm món kèm / extra'),
          ),
        ),
      ],
    );
  }

  Widget _recipeEditor() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Công thức trừ kho',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        for (var i = 0; i < _recipe.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Expanded(
                  flex: 3,
                  child: DropdownButtonFormField<String>(
                    initialValue: _recipe[i].ingredientId.isEmpty
                        ? null
                        : _recipe[i].ingredientId,
                    isExpanded: true,
                    decoration: const InputDecoration(
                        isDense: true, hintText: 'Nguyên liệu'),
                    items: [
                      for (final ing in widget.ingredients)
                        DropdownMenuItem(
                            value: ing.id,
                            child: Text('${ing.name} (${ing.unit})',
                                overflow: TextOverflow.ellipsis)),
                    ],
                    onChanged: (v) =>
                        setState(() => _recipe[i].ingredientId = v ?? ''),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 1,
                  child: TextField(
                    controller: TextEditingController(text: _recipe[i].qty)
                      ..selection = TextSelection.collapsed(
                          offset: _recipe[i].qty.length),
                    keyboardType: TextInputType.number,
                    decoration:
                        const InputDecoration(isDense: true, hintText: 'SL'),
                    onChanged: (v) => _recipe[i].qty = v,
                  ),
                ),
                IconButton(
                  onPressed: () => setState(() => _recipe.removeAt(i)),
                  icon: const Icon(Icons.remove_circle_outline,
                      color: DanColors.late, size: 20),
                ),
              ],
            ),
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: () => setState(() => _recipe.add(_RecipeRow('', '1'))),
            icon: const Icon(Icons.add, size: 16),
            label: const Text('Thêm nguyên liệu'),
          ),
        ),
      ],
    );
  }

  Widget _scheduleEditor() {
    const dayLabels = [
      ['0', 'CN'],
      ['1', 'T2'],
      ['2', 'T3'],
      ['3', 'T4'],
      ['4', 'T5'],
      ['5', 'T6'],
      ['6', 'T7'],
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Lịch bán',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        DropdownButtonFormField<String>(
          initialValue: _schedMode,
          isExpanded: true,
          decoration: const InputDecoration(isDense: true),
          items: const [
            DropdownMenuItem(value: 'always', child: Text('Bán cả ngày')),
            DropdownMenuItem(value: 'daily', child: Text('Theo giờ mỗi ngày')),
            DropdownMenuItem(
                value: 'weekly', child: Text('Theo ngày trong tuần')),
            DropdownMenuItem(value: 'date', child: Text('Chỉ một ngày')),
          ],
          onChanged: (v) => setState(() => _schedMode = v ?? 'always'),
        ),
        if (_schedMode == 'daily' || _schedMode == 'weekly') ...[
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: _field('Từ giờ', _start, hint: '08:00')),
              const SizedBox(width: 12),
              Expanded(child: _field('Đến giờ', _end, hint: '21:00')),
            ],
          ),
        ],
        if (_schedMode == 'weekly') ...[
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            children: [
              for (final d in dayLabels)
                FilterChip(
                  label: Text(d[1]),
                  selected: _days.contains(d[0]),
                  onSelected: (sel) => setState(() {
                    if (sel) {
                      _days.add(d[0]);
                    } else {
                      _days.remove(d[0]);
                    }
                  }),
                ),
            ],
          ),
        ],
        if (_schedMode == 'date') ...[
          const SizedBox(height: 8),
          _field('Ngày bán (YYYY-MM-DD)', _date, hint: '2026-06-30'),
        ],
      ],
    );
  }
}

/// Live preview of the item as it appears on the iPad self-order screen —
/// updates as the form on the right is edited.
class _MenuItemPreview extends StatelessWidget {
  final _ItemFormDialogState state;
  const _MenuItemPreview({required this.state});

  ImageProvider? _img() {
    final raw = state.pvImage;
    if (raw.isEmpty) return null;
    final url = raw.startsWith('http')
        ? raw
        : '${state.pvServerUrl}${raw.startsWith('/') ? '' : '/'}$raw';
    // Bound the decode size so a full-res upload can't chew RAM in the live
    // preview while typing.
    return ResizeImage(NetworkImage(url), width: 480);
  }

  @override
  Widget build(BuildContext context) {
    final img = _img();
    final name = state.pvName.isEmpty ? 'Tên món' : state.pvName;
    final price = state.pvPrice;
    final desc = state.pvDescription;

    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            const Text(
              'XEM TRƯỚC TRÊN THIẾT BỊ KHÁCH HÀNG',
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .8,
                  color: Colors.white70),
            ),
            const SizedBox(height: 20),
            Opacity(
              opacity: state.pvHidden ? .45 : 1,
              child: Container(
                width: 220,
                decoration: BoxDecoration(
                  color: DanColors.surface,
                  border: Border.all(color: DanColors.border),
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: const [
                    BoxShadow(
                        color: Color(0x1F000000),
                        blurRadius: 12,
                        offset: Offset(0, 4)),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    AspectRatio(
                      aspectRatio: 1.2,
                      child: ClipRRect(
                        borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(15)),
                        child: img != null
                            ? Image(
                                image: img,
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) =>
                                    _emojiBox(state.pvEmoji, 48))
                            : _emojiBox(state.pvEmoji, 48),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(name,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w800,
                                  height: 1.2)),
                          const SizedBox(height: 6),
                          Text(Fmt.money(price),
                              style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w900,
                                  color: DanColors.brand)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
            Container(
              width: 460,
              decoration: BoxDecoration(
                color: DanColors.surface,
                border: Border.all(color: DanColors.border),
                borderRadius: BorderRadius.circular(16),
                boxShadow: const [
                  BoxShadow(
                      color: Color(0x24000000),
                      blurRadius: 20,
                      offset: Offset(0, 8)),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AspectRatio(
                    aspectRatio: 16 / 9,
                    child: ClipRRect(
                      borderRadius:
                          const BorderRadius.vertical(top: Radius.circular(15)),
                      child: img != null
                          ? Image(
                              image: img,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) =>
                                  _emojiBox(state.pvEmoji, 64))
                          : _emojiBox(state.pvEmoji, 64),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name,
                            style: const TextStyle(
                                fontSize: 18, fontWeight: FontWeight.w900)),
                        const SizedBox(height: 4),
                        if (state.pvCategory.isNotEmpty ||
                            state.pvStationLabel.isNotEmpty)
                          Text(
                              [state.pvCategory, state.pvStationLabel]
                                  .where((e) => e.isNotEmpty)
                                  .join(' · '),
                              style: const TextStyle(
                                  fontSize: 13, color: DanColors.faint)),
                        if (desc.isNotEmpty) ...[
                          const SizedBox(height: 10),
                          Text(desc,
                              style: const TextStyle(
                                  fontSize: 13.5,
                                  color: DanColors.muted,
                                  height: 1.4)),
                        ],
                        if (state.pvIngredients.isNotEmpty) ...[
                          const SizedBox(height: 12),
                          _chips('Nguyên liệu', state.pvIngredients,
                              DanColors.surface2, DanColors.muted),
                        ],
                        if (state.pvAllergens.isNotEmpty) ...[
                          const SizedBox(height: 10),
                          _chips('Dị ứng', state.pvAllergens,
                              const Color(0x1AFF6B6B), DanColors.late),
                        ],
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            Text(Fmt.money(price),
                                style: const TextStyle(
                                    fontSize: 22,
                                    fontWeight: FontWeight.w900,
                                    color: DanColors.brand)),
                            const Spacer(),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 18, vertical: 10),
                              decoration: BoxDecoration(
                                color: DanColors.brand,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: const Text('Thêm',
                                  style: TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w800,
                                      fontSize: 13.5)),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            if (state.pvHidden) ...[
              const SizedBox(height: 16),
              Container(
                width: 460,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0x2BFF6B6B),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: DanColors.late.withOpacity(0.3)),
                ),
                child: const Text(
                  'Món đang ẩn — không hiện trên thiết bị khách hàng',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: Colors.white),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _emojiBox(String emoji, double size) => Container(
        color: DanColors.surface2,
        alignment: Alignment.center,
        child: Text(emoji, style: TextStyle(fontSize: size)),
      );

  Widget _chips(String label, List<String> items, Color bg, Color fg) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                color: DanColors.faint)),
        const SizedBox(height: 5),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final t in items)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                    color: bg, borderRadius: BorderRadius.circular(6)),
                child: Text(t,
                    style: TextStyle(
                        fontSize: 11, fontWeight: FontWeight.w600, color: fg)),
              ),
          ],
        ),
      ],
    );
  }
}

class _RecipeRow {
  String ingredientId;
  String qty;
  _RecipeRow(this.ingredientId, this.qty);
}

class _AddonRow {
  String kind;
  String type;
  String price;
  String refItemId;
  String name;
  bool available;
  _AddonRow({
    required this.kind,
    required this.type,
    required this.price,
    this.refItemId = '',
    this.name = '',
    this.available = true,
  });
}

String _mimeForFileName(String name) {
  final lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

// ── Category manager ─────────────────────────────────────────────────────

class _CategoryManagerDialog extends StatefulWidget {
  final ApiService api;
  final List<AdminCategory> categories;
  const _CategoryManagerDialog({required this.api, required this.categories});

  @override
  State<_CategoryManagerDialog> createState() => _CategoryManagerDialogState();
}

class _CategoryManagerDialogState extends State<_CategoryManagerDialog> {
  late List<AdminCategory> _cats;
  bool _changed = false;
  final _newName = TextEditingController();
  final _newIcon = TextEditingController(text: '');

  @override
  void initState() {
    super.initState();
    _cats = List.of(widget.categories);
  }

  @override
  void dispose() {
    _newName.dispose();
    _newIcon.dispose();
    super.dispose();
  }

  void _toast(String m, {bool error = false}) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(m),
          backgroundColor: error ? DanColors.late : DanColors.text));

  Future<void> _add() async {
    final name = _newName.text.trim();
    if (name.isEmpty) return;
    final pin = await requestManagerPin(context, 'Tạo danh mục "$name".');
    if (pin == null) return;
    try {
      final c = await widget.api.createCategory(name,
          _newIcon.text.trim(), pin);
      setState(() {
        _cats.add(AdminCategory.fromJson(c));
        _newName.clear();
        _changed = true;
      });
      _toast('Đã tạo nhóm $name');
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  Future<void> _delete(AdminCategory c) async {
    final pin = await requestManagerPin(context, 'Xóa danh mục "${c.name}".');
    if (pin == null) return;
    try {
      await widget.api.deleteCategory(c.id, pin);
      setState(() {
        _cats.removeWhere((x) => x.id == c.id);
        _changed = true;
      });
      _toast('Đã xóa nhóm');
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  Future<void> _edit(AdminCategory c) async {
    final draft = await showDialog<AdminCategory>(
      context: context,
      builder: (ctx) {
        final icon = TextEditingController(text: c.icon);
        final name = TextEditingController(text: c.name);
        return AlertDialog(
          backgroundColor: DanColors.surface,
          title: const Text('Sửa danh mục'),
          content: SizedBox(
            width: 360,
            child: Row(
              children: [
                SizedBox(
                  width: 64,
                  child: TextField(
                    controller: icon,
                    textAlign: TextAlign.center,
                    decoration: const InputDecoration(labelText: 'Icon'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: name,
                    autofocus: true,
                    decoration: const InputDecoration(labelText: 'Tên nhóm'),
                    onSubmitted: (_) => Navigator.of(ctx).pop(AdminCategory(
                      id: c.id,
                      name: name.text.trim(),
                      icon: icon.text.trim(),
                    )),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text('Hủy')),
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(AdminCategory(
                id: c.id,
                name: name.text.trim(),
                icon: icon.text.trim(),
              )),
              child: const Text('Lưu'),
            ),
          ],
        );
      },
    );
    if (draft == null || draft.name.isEmpty) return;
    if (!mounted) return;
    final pin =
        await requestManagerPin(context, 'Cập nhật danh mục "${c.name}".');
    if (pin == null) return;
    try {
      final icon = draft.icon;
      await widget.api.updateCategory(c.id, {
        'name': draft.name,
        'icon': icon,
        'security_pin': pin,
      });
      setState(() {
        final idx = _cats.indexWhere((x) => x.id == c.id);
        if (idx >= 0) {
          _cats[idx] = AdminCategory(id: c.id, name: draft.name, icon: icon);
        }
        _changed = true;
      });
      _toast('Đã lưu danh mục');
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: DanColors.surface,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480, maxHeight: 620),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 18, 20, 10),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text('Quản lý danh mục',
                    style:
                        TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
              ),
            ),
            const Divider(height: 1, color: DanColors.border),
            Flexible(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  for (final c in _cats)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Text(c.icon,
                          style: const TextStyle(fontSize: 22)),
                      title: Text(c.name,
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            onPressed: () => _edit(c),
                            icon: const Icon(Icons.edit_outlined,
                                color: DanColors.brand),
                          ),
                          IconButton(
                            onPressed: () => _delete(c),
                            icon: const Icon(Icons.delete_outline,
                                color: DanColors.late),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            const Divider(height: 1, color: DanColors.border),
            Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  SizedBox(
                    width: 56,
                    child: TextField(
                      controller: _newIcon,
                      textAlign: TextAlign.center,
                      decoration: const InputDecoration(isDense: true),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: _newName,
                      decoration: const InputDecoration(
                          isDense: true, hintText: 'Tên nhóm mới'),
                      onSubmitted: (_) => _add(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(onPressed: _add, child: const Text('Thêm')),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
              child: Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => Navigator.of(context).pop(_changed),
                  child: const Text('Đóng'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
