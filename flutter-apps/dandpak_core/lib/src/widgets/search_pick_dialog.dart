import 'package:flutter/material.dart';

import '../ui/app_theme.dart';
import '../utils/translation.dart';

/// Một lựa chọn cho [showSearchPickDialog].
class SearchPickOption {
  final String value;
  final String label;
  const SearchPickOption(this.value, this.label);
}

/// Hộp thoại tìm-rồi-chọn 1 giá trị từ danh sách dài — thay cho
/// `DropdownButtonFormField`/`DropdownMenu` khi trường chọn nằm TRONG một
/// ListView/SingleChildScrollView đang cuộn: cả hai widget dropdown built-in
/// của Flutter định vị SAI vị trí popup trong tình huống này (lỗi Flutter đã
/// biết — flutter/flutter#12053, #139871), không phải lỗi logic ở đây. Dùng
/// showDialog riêng (luôn tự căn giữa màn hình) để không bao giờ dính lỗi đó.
Future<String?> showSearchPickDialog(
  BuildContext context, {
  required String title,
  required List<SearchPickOption> options,
  String? initialValue,
  String? hintText,
}) {
  return showDialog<String>(
    context: context,
    builder: (_) => _SearchPickDialog(
      title: title,
      options: options,
      initialValue: initialValue,
      hintText: hintText,
    ),
  );
}

/// Trường trông như dropdown (khung + nhãn + mũi tên) nhưng bấm vào mở
/// [showSearchPickDialog] thay vì popup nội tuyến — dùng ở mọi nơi trước đây
/// định dùng DropdownButtonFormField/DropdownMenu cho danh sách dài mà
/// trường nằm trong khối đang cuộn.
class SearchPickField extends StatelessWidget {
  final String? value;
  final List<SearchPickOption> options;
  final String dialogTitle;
  final String? hintText;
  final ValueChanged<String?> onChanged;
  final bool isDense;

  const SearchPickField({
    super.key,
    required this.value,
    required this.options,
    required this.dialogTitle,
    required this.onChanged,
    this.hintText,
    this.isDense = true,
  });

  @override
  Widget build(BuildContext context) {
    SearchPickOption? selected;
    for (final o in options) {
      if (o.value == value) {
        selected = o;
        break;
      }
    }
    return InkWell(
      onTap: () async {
        final picked = await showSearchPickDialog(
          context,
          title: dialogTitle,
          options: options,
          initialValue: value,
          hintText: hintText,
        );
        if (picked != null) onChanged(picked);
      },
      child: InputDecorator(
        decoration: InputDecoration(
          isDense: isDense,
          hintText: hintText,
          suffixIcon: Icon(Icons.arrow_drop_down),
        ),
        child: Text(
          selected?.label ?? '',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
  }
}

class _SearchPickDialog extends StatefulWidget {
  final String title;
  final List<SearchPickOption> options;
  final String? initialValue;
  final String? hintText;
  const _SearchPickDialog({
    required this.title,
    required this.options,
    this.initialValue,
    this.hintText,
  });

  @override
  State<_SearchPickDialog> createState() => _SearchPickDialogState();
}

class _SearchPickDialogState extends State<_SearchPickDialog> {
  final _query = TextEditingController();

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final q = _query.text.trim();
    final filtered = q.isEmpty
        ? widget.options
        : widget.options.where((o) => searchMatches(o.label, q)).toList();
    return Dialog(
      backgroundColor: DanColors.surface,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 420, maxHeight: 560),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(20, 18, 12, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Text(widget.title,
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w900)),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: Icon(Icons.close, size: 20),
                  ),
                ],
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(20, 0, 20, 10),
              child: TextField(
                controller: _query,
                autofocus: true,
                decoration: InputDecoration(
                  isDense: true,
                  prefixIcon: Icon(Icons.search, size: 18),
                  hintText: widget.hintText ?? t('Tìm kiếm...'),
                ),
                onChanged: (_) => setState(() {}),
              ),
            ),
            Divider(height: 1, color: DanColors.border),
            Flexible(
              child: filtered.isEmpty
                  ? Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(t('Không tìm thấy kết quả'),
                          style: TextStyle(color: DanColors.muted)),
                    )
                  : ListView.builder(
                      shrinkWrap: true,
                      padding: EdgeInsets.symmetric(vertical: 6),
                      itemCount: filtered.length,
                      itemBuilder: (context, i) {
                        final o = filtered[i];
                        final selected = o.value == widget.initialValue;
                        return ListTile(
                          dense: true,
                          selected: selected,
                          selectedTileColor: DanColors.brandDim,
                          title: Text(o.label,
                              maxLines: 1, overflow: TextOverflow.ellipsis),
                          trailing: selected
                              ? Icon(Icons.check, size: 18, color: DanColors.brand)
                              : null,
                          onTap: () => Navigator.of(context).pop(o.value),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
