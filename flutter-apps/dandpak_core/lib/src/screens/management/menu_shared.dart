// GENERATED SPLIT of menu_tab.dart — recipe/addon + dialog nhóm món (part of, cùng library).
part of 'menu_tab.dart';

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
  _CategoryManagerDialog({required this.api, required this.categories});

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
      appToast(context, m, isError: error);

  Future<void> _add() async {
    final name = _newName.text.trim();
    if (name.isEmpty) return;
    final pin = await requestManagerPin(context, t('Tạo danh mục "$name".'));
    if (pin == null) return;
    try {
      final c =
          await widget.api.createCategory(name, _newIcon.text.trim(), pin);
      setState(() {
        _cats.add(AdminCategory.fromJson(c));
        _newName.clear();
        _changed = true;
      });
      _toast(t('Đã tạo nhóm $name'));
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  Future<void> _delete(AdminCategory c) async {
    final pin =
        await requestManagerPin(context, t('Xóa danh mục "${c.name}".'));
    if (pin == null) return;
    try {
      await widget.api.deleteCategory(c.id, pin);
      setState(() {
        _cats.removeWhere((x) => x.id == c.id);
        _changed = true;
      });
      _toast(t('Đã xóa nhóm'));
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
          title: Text(t('Sửa danh mục')),
          content: SizedBox(
            width: 360,
            child: Row(
              children: [
                SizedBox(
                  width: 64,
                  child: TextField(
                    controller: icon,
                    textAlign: TextAlign.center,
                    decoration: InputDecoration(labelText: 'Icon'),
                  ),
                ),
                SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: name,
                    autofocus: true,
                    decoration: InputDecoration(labelText: t('Tên nhóm')),
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
                child: Text(t('Hủy'))),
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(AdminCategory(
                id: c.id,
                name: name.text.trim(),
                icon: icon.text.trim(),
              )),
              child: Text(t('Lưu')),
            ),
          ],
        );
      },
    );
    if (draft == null || draft.name.isEmpty) return;
    if (!mounted) return;
    final pin =
        await requestManagerPin(context, t('Cập nhật danh mục "${c.name}".'));
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
      _toast(t('Đã lưu danh mục'));
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: DanColors.surface,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 480, maxHeight: 620),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(20, 18, 20, 10),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(t('Quản lý danh mục'),
                    style:
                        TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
              ),
            ),
            Divider(height: 1, color: DanColors.border),
            Flexible(
              child: ListView(
                padding: EdgeInsets.all(16),
                children: [
                  for (final c in _cats)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Text(c.icon, style: TextStyle(fontSize: 22)),
                      title: Text(c.name,
                          style: TextStyle(fontWeight: FontWeight.w700)),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            onPressed: () => _edit(c),
                            icon: Icon(Icons.edit_outlined,
                                color: DanColors.brand),
                          ),
                          IconButton(
                            onPressed: () => _delete(c),
                            icon: Icon(Icons.delete_outline,
                                color: DanColors.late),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            Divider(height: 1, color: DanColors.border),
            Padding(
              padding: EdgeInsets.all(14),
              child: Row(
                children: [
                  SizedBox(
                    width: 56,
                    child: TextField(
                      controller: _newIcon,
                      textAlign: TextAlign.center,
                      decoration: InputDecoration(isDense: true),
                    ),
                  ),
                  SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: _newName,
                      decoration: InputDecoration(
                          isDense: true, hintText: t('Tên nhóm mới')),
                      onSubmitted: (_) => _add(),
                    ),
                  ),
                  SizedBox(width: 8),
                  FilledButton(onPressed: _add, child: Text(t('Thêm'))),
                ],
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(14, 0, 14, 14),
              child: Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => Navigator.of(context).pop(_changed),
                  child: Text(t('Đóng')),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
