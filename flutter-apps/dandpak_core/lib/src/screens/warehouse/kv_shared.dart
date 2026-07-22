import 'package:flutter/material.dart';

import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../utils/translation.dart';
import '../../widgets/scan_button.dart';

/// Bộ widget DÙNG CHUNG cho các trang Kho kiểu KiotViet (Thiết lập giá, Kiểm
/// kho, Nhập hàng, Trả hàng nhập, Chuyển hàng, Xuất dùng nội bộ…).
///
/// Các trang này "copy frontend của nhau" — cùng bố cục: sidebar lọc bên trái +
/// toolbar tìm kiếm + bảng dữ liệu + dòng mở rộng chi tiết; form phiếu = bảng
/// dòng hàng bên trái + panel thông tin bên phải. Giữ đúng ngôn ngữ thiết kế
/// của app (DanColors/DanRadius), không copy màu KiotViet.

String kvs(dynamic v) => v?.toString() ?? '';
num kvn(dynamic v) => v is num ? v : num.tryParse(kvs(v)) ?? 0;
bool kvb(dynamic v) => v == true || v == 1 || v == '1';

/// Số THUẦN cho ô nhập liệu (không dấu phân cách nghìn). KHÔNG dùng Fmt.int0
/// ở đây: int0 format vi-VN "4.000" → parse lại thành 4 (sai 1000 lần).
String kvNumText(num v) {
  if (v == v.roundToDouble()) return v.round().toString();
  return v.toString();
}

/// Parse số người dùng nhập: bỏ khoảng trắng, chấp nhận "," làm dấu thập phân.
num? kvParseNum(String s) {
  final cleaned = s.trim().replaceAll(' ', '').replaceAll(',', '.');
  if (cleaned.isEmpty) return null;
  return num.tryParse(cleaned);
}

String kvShortDate(String iso) {
  final t = DateTime.tryParse(iso);
  if (t == null) return iso.isEmpty ? '—' : iso;
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(t.day)}/${two(t.month)}/${t.year}';
}

String kvDateTime(String iso) {
  final t = DateTime.tryParse(iso);
  if (t == null) return iso.isEmpty ? '—' : iso;
  return Fmt.dmyHm(t);
}

/// Danh sách Map an toàn từ dynamic.
List<Map<String, dynamic>> kvMapList(dynamic v) => (v is List)
    ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
    : <Map<String, dynamic>>[];

// ── Sidebar lọc ─────────────────────────────────────────────────────────────

class KvSidebar extends StatelessWidget {
  final List<Widget> children;
  final VoidCallback? onClear;
  final bool showClear;
  const KvSidebar(
      {super.key, required this.children, this.onClear, this.showClear = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 240,
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border(right: BorderSide(color: DanColors.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(14, 12, 10, 6),
            child: Row(
              children: [
                Text(t('Bộ lọc'),
                    style:
                        TextStyle(fontSize: 13.5, fontWeight: FontWeight.w900)),
                Spacer(),
                if (showClear && onClear != null)
                  TextButton(
                    onPressed: onClear,
                    style: TextButton.styleFrom(
                        padding: EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: Size(0, 30),
                        foregroundColor: DanColors.late),
                    child: Text(t('Xóa lọc'), style: TextStyle(fontSize: 12)),
                  ),
              ],
            ),
          ),
          Divider(height: 1, color: DanColors.border),
          Expanded(child: ListView(padding: EdgeInsets.zero, children: children)),
        ],
      ),
    );
  }
}

class KvFilterGroup extends StatelessWidget {
  final String title;
  final Widget child;
  final bool initiallyExpanded;
  const KvFilterGroup(
      {super.key,
      required this.title,
      required this.child,
      this.initiallyExpanded = true});

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        initiallyExpanded: initiallyExpanded,
        tilePadding: EdgeInsets.symmetric(horizontal: 14),
        childrenPadding: EdgeInsets.fromLTRB(14, 0, 10, 8),
        title: Text(title,
            style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
                color: DanColors.text)),
        children: [child],
      ),
    );
  }
}

class KvRadioOption extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final int? count;
  const KvRadioOption(
      {super.key,
      required this.label,
      required this.selected,
      required this.onTap,
      this.count});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: 5, horizontal: 2),
        child: Row(
          children: [
            Icon(selected ? Icons.radio_button_checked : Icons.radio_button_off,
                size: 15, color: selected ? DanColors.brand : DanColors.faint),
            SizedBox(width: 8),
            Expanded(
              child: Text(label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                      color: selected ? DanColors.text : DanColors.muted)),
            ),
            if (count != null)
              Text('$count',
                  style: TextStyle(fontSize: 11, color: DanColors.faint)),
          ],
        ),
      ),
    );
  }
}

class KvCheckOption extends StatelessWidget {
  final String label;
  final bool checked;
  final ValueChanged<bool> onChanged;
  const KvCheckOption(
      {super.key,
      required this.label,
      required this.checked,
      required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => onChanged(!checked),
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: 5, horizontal: 2),
        child: Row(
          children: [
            Icon(checked ? Icons.check_box : Icons.check_box_outline_blank,
                size: 16, color: checked ? DanColors.brand : DanColors.faint),
            SizedBox(width: 8),
            Expanded(
              child: Text(label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: checked ? FontWeight.w700 : FontWeight.w500,
                      color: checked ? DanColors.text : DanColors.muted)),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Toolbar + bảng danh sách ────────────────────────────────────────────────

class KvToolbar extends StatelessWidget {
  final String hint;
  final ValueChanged<String> onSearch;
  final List<Widget> actions;
  final TextEditingController? controller;
  final bool showFilterToggle;
  final bool filtersShown;
  final VoidCallback? onToggleFilters;
  const KvToolbar({
    super.key,
    required this.hint,
    required this.onSearch,
    this.actions = const [],
    this.controller,
    this.showFilterToggle = false,
    this.filtersShown = true,
    this.onToggleFilters,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: DanColors.surface,
      padding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          if (showFilterToggle)
            IconButton(
              tooltip: filtersShown ? t('Ẩn bộ lọc') : t('Hiện bộ lọc'),
              onPressed: onToggleFilters,
              icon: Icon(
                  filtersShown ? Icons.filter_alt : Icons.filter_alt_outlined,
                  color: DanColors.muted),
            ),
          Expanded(
            child: SizedBox(
              height: 40,
              child: TextField(
                controller: controller,
                decoration: InputDecoration(
                  hintText: hint,
                  prefixIcon: Icon(Icons.search, size: 20),
                  isDense: true,
                  filled: true,
                  fillColor: DanColors.surface2,
                  contentPadding: EdgeInsets.symmetric(vertical: 0),
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(DanRadius.sm),
                      borderSide: BorderSide.none),
                ),
                onChanged: onSearch,
              ),
            ),
          ),
          for (final a in actions) ...[SizedBox(width: 8), a],
        ],
      ),
    );
  }
}

/// Ô tiêu đề cột — dùng chung để header và dòng thẳng hàng theo width cố định.
Widget kvHeaderCell(String label,
    {double? width,
    int flex = 0,
    TextAlign align = TextAlign.left}) {
  final text = Text(label,
      textAlign: align,
      style: TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w800,
          color: DanColors.muted,
          letterSpacing: .2));
  if (width != null) return SizedBox(width: width, child: text);
  return Expanded(flex: flex <= 0 ? 1 : flex, child: text);
}

class KvTableHeader extends StatelessWidget {
  final List<Widget> cells;
  const KvTableHeader({super.key, required this.cells});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: DanColors.surface2,
      padding: EdgeInsets.symmetric(horizontal: 20, vertical: 9),
      child: Row(children: cells),
    );
  }
}

/// Chip trạng thái phiếu (Phiếu tạm / Đã nhập hàng / Đã cân bằng / Đã hủy…).
class KvStatusChip extends StatelessWidget {
  final String label;
  final Color color;
  const KvStatusChip({super.key, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
          color: color.withValues(alpha: .13),
          borderRadius: BorderRadius.circular(6)),
      child: Text(label,
          style: TextStyle(
              fontSize: 11, fontWeight: FontWeight.w800, color: color)),
    );
  }
}

/// Badge "Mới" đỏ nhỏ (giống KiotViet đánh dấu mục Xuất dùng nội bộ).
class KvNewBadge extends StatelessWidget {
  const KvNewBadge({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
          color: DanColors.late, borderRadius: BorderRadius.circular(8)),
      child: Text(t('Mới'),
          style: TextStyle(
              fontSize: 9.5, fontWeight: FontWeight.w900, color: Colors.white)),
    );
  }
}

/// Trạng thái rỗng giữa bảng ("Không tìm thấy kết quả").
class KvEmptyState extends StatelessWidget {
  final String message;
  final String? hint;
  const KvEmptyState({super.key, required this.message, this.hint});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 96,
            height: 96,
            decoration: BoxDecoration(
                color: DanColors.brandDim, shape: BoxShape.circle),
            child: Icon(Icons.inbox_outlined,
                size: 44, color: DanColors.brand),
          ),
          SizedBox(height: 14),
          Text(message,
              style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w800)),
          if (hint != null) ...[
            SizedBox(height: 4),
            Text(hint!,
                style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
          ],
        ],
      ),
    );
  }
}

// ── Dòng hàng trong form phiếu ──────────────────────────────────────────────

/// Một dòng hàng trên form phiếu (nhập hàng / trả hàng / kiểm kho / chuyển
/// kho / xuất nội bộ). Giữ controller để nhập liệu mượt trong bảng.
class KvDocLine {
  final Map<String, dynamic> item; // SKU hoặc inventory item gốc
  final String stockType; // 'sku' | 'inventory'
  final TextEditingController qty;
  final TextEditingController cost;
  final TextEditingController lotNo;
  final TextEditingController expiry;

  KvDocLine(this.item, this.stockType,
      {num? initialQty, num? initialCost, String? lot, String? exp})
      : qty = TextEditingController(
            text: initialQty == null ? '1' : kvNumText(initialQty)),
        cost = TextEditingController(
            text: initialCost == null ? '' : kvNumText(initialCost)),
        lotNo = TextEditingController(text: lot ?? ''),
        expiry = TextEditingController(text: exp ?? '');

  String get id => kvs(item['id']);
  String get code => kvs(item['code']).isEmpty
      ? (kvs(item['barcode']).isEmpty ? id : kvs(item['barcode']))
      : kvs(item['code']);
  String get name => kvs(item['name']);
  String get unit => kvs(item['unit']);
  num get stock => kvn(item['stock']);
  num get qtyNum => kvParseNum(qty.text) ?? 0;
  num get costNum => kvParseNum(cost.text) ?? 0;
  num get lineTotal => qtyNum * costNum;

  void dispose() {
    qty.dispose();
    cost.dispose();
    lotNo.dispose();
    expiry.dispose();
  }
}

/// Ô tìm hàng hóa (theo mã / tên / mã vạch) hiển thị kết quả ngay dưới ô tìm —
/// dùng chung cho mọi form phiếu. Danh sách hàng do trang truyền vào.
class KvItemSearchField extends StatefulWidget {
  final List<Map<String, dynamic>> items;
  final ValueChanged<Map<String, dynamic>> onPick;
  final String hint;
  const KvItemSearchField(
      {super.key,
      required this.items,
      required this.onPick,
      this.hint = ''});

  @override
  State<KvItemSearchField> createState() => _KvItemSearchFieldState();
}

class _KvItemSearchFieldState extends State<KvItemSearchField> {
  final _ctrl = TextEditingController();
  String _q = '';

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _results {
    if (foldSearch(_q).isEmpty) return const [];
    return widget.items
        .where((s) => searchMatchesAny(
            [s['name'], s['code'], s['barcode'], s['category']], _q))
        .take(8)
        .toList();
  }

  void _pick(Map<String, dynamic> item) {
    widget.onPick(item);
    _ctrl.clear();
    setState(() => _q = '');
  }

  /// Mã từ camera (tablet/phone) hoặc máy quét USB: khớp CHÍNH XÁC
  /// barcode/mã hàng → thêm dòng ngay; không thấy → đổ vào ô tìm để soi tay.
  void _applyScannedCode(String code) {
    final c = code.trim().toLowerCase();
    if (c.isEmpty) return;
    for (final s in widget.items) {
      if (kvs(s['barcode']).toLowerCase() == c ||
          kvs(s['code']).toLowerCase() == c) {
        _pick(s);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text('${t('Đã thêm')}: ${kvs(s['name'])}'),
            duration: Duration(seconds: 1),
            backgroundColor: DanColors.text));
        return;
      }
    }
    _ctrl.text = code.trim();
    setState(() => _q = code.trim());
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(t('Không thấy mã "$code" trong kho này')),
        backgroundColor: DanColors.late));
  }

  @override
  Widget build(BuildContext context) {
    final results = _results;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: 40,
          child: TextField(
            controller: _ctrl,
            decoration: InputDecoration(
              hintText:
                  widget.hint.isEmpty ? t('Tìm hàng hóa theo mã hoặc tên (F3)') : widget.hint,
              prefixIcon: Icon(Icons.search, size: 20),
              // Tablet/phone: nút camera quét mã → tự thêm dòng.
              // Desktop: icon gợi ý ô nhập máy quét USB (không bấm).
              suffixIcon: ScanIconButton(
                  title: t('Quét mặt hàng'),
                  size: 20,
                  color: DanColors.muted,
                  onCode: _applyScannedCode),
              isDense: true,
              filled: true,
              fillColor: DanColors.surface2,
              contentPadding: EdgeInsets.symmetric(vertical: 0),
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(DanRadius.sm),
                  borderSide: BorderSide.none),
            ),
            onChanged: (v) => setState(() => _q = v),
            onSubmitted: (_) {
              // Máy quét USB gõ mã + Enter: ưu tiên khớp CHÍNH XÁC
              // barcode/mã; không có thì lấy kết quả tìm đầu tiên.
              final c = _q.trim().toLowerCase();
              for (final s in widget.items) {
                if (kvs(s['barcode']).toLowerCase() == c ||
                    kvs(s['code']).toLowerCase() == c) {
                  _pick(s);
                  return;
                }
              }
              if (results.isNotEmpty) _pick(results.first);
            },
          ),
        ),
        if (results.isNotEmpty)
          Container(
            margin: EdgeInsets.only(top: 4),
            constraints: BoxConstraints(maxHeight: 320),
            decoration: BoxDecoration(
              color: DanColors.surface,
              border: Border.all(color: DanColors.border2),
              borderRadius: BorderRadius.circular(DanRadius.sm),
              boxShadow: [
                BoxShadow(
                    color: Color(0x14102840),
                    blurRadius: 10,
                    offset: Offset(0, 4)),
              ],
            ),
            child: ListView.separated(
              shrinkWrap: true,
              padding: EdgeInsets.zero,
              itemCount: results.length,
              separatorBuilder: (_, __) =>
                  Divider(height: 1, color: DanColors.border),
              itemBuilder: (_, i) {
                final s = results[i];
                return InkWell(
                  onTap: () => _pick(s),
                  child: Padding(
                    padding:
                        EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 110,
                          child: Text(
                              kvs(s['code']).isEmpty
                                  ? kvs(s['barcode'])
                                  : kvs(s['code']),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  fontFamily: 'JetBrains Mono',
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w700,
                                  color: DanColors.brand)),
                        ),
                        SizedBox(width: 10),
                        Expanded(
                          child: Text(kvs(s['name']),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w600)),
                        ),
                        SizedBox(width: 10),
                        Text(
                            '${t('Tồn')}: ${Fmt.int0(kvn(s['stock']))} ${kvs(s['unit'])}',
                            style: TextStyle(
                                fontSize: 11.5, color: DanColors.muted)),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
      ],
    );
  }
}

/// Panel meta bên phải của form phiếu (người tạo + thời gian, mã phiếu tự
/// động, trạng thái, các dòng tổng, ghi chú, nút Lưu tạm / Hoàn thành).
class KvDocMetaPanel extends StatelessWidget {
  final String userName;
  final String codeHint;
  final String statusLabel;
  final List<Widget> children;
  final TextEditingController? noteCtrl;
  final VoidCallback? onSaveDraft;
  final VoidCallback? onComplete;
  final bool busy;
  final String completeLabel;

  const KvDocMetaPanel({
    super.key,
    required this.userName,
    required this.codeHint,
    this.statusLabel = '',
    this.children = const [],
    this.noteCtrl,
    this.onSaveDraft,
    this.onComplete,
    this.busy = false,
    this.completeLabel = '',
  });

  @override
  Widget build(BuildContext context) {
    final nowTxt = Fmt.dmyHm(DateTime.now());
    return Container(
      width: 340,
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border(left: BorderSide(color: DanColors.border)),
      ),
      child: Column(
        children: [
          Expanded(
            child: ListView(
              padding: EdgeInsets.all(14),
              children: [
                Row(
                  children: [
                    Icon(Icons.person_outline,
                        size: 18, color: DanColors.muted),
                    SizedBox(width: 6),
                    Expanded(
                      child: Text(userName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 13, fontWeight: FontWeight.w700)),
                    ),
                    Text(nowTxt,
                        style:
                            TextStyle(fontSize: 12, color: DanColors.muted)),
                  ],
                ),
                SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: Text(codeHint,
                          style: TextStyle(
                              fontSize: 12.5, color: DanColors.muted)),
                    ),
                    Text(t('Mã phiếu tự động'),
                        style:
                            TextStyle(fontSize: 12, color: DanColors.faint)),
                  ],
                ),
                if (statusLabel.isNotEmpty) ...[
                  SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: Text(t('Trạng thái'),
                            style: TextStyle(
                                fontSize: 12.5, color: DanColors.muted)),
                      ),
                      Text(statusLabel,
                          style: TextStyle(
                              fontSize: 12.5, fontWeight: FontWeight.w800)),
                    ],
                  ),
                ],
                SizedBox(height: 8),
                Divider(height: 18, color: DanColors.border),
                ...children,
                if (noteCtrl != null) ...[
                  SizedBox(height: 12),
                  TextField(
                    controller: noteCtrl,
                    maxLines: 3,
                    decoration: InputDecoration(
                      hintText: t('Ghi chú'),
                      isDense: true,
                      filled: true,
                      fillColor: DanColors.surface2,
                      border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(DanRadius.sm),
                          borderSide: BorderSide.none),
                    ),
                  ),
                ],
              ],
            ),
          ),
          Divider(height: 1, color: DanColors.border),
          Padding(
            padding: EdgeInsets.all(12),
            child: Row(
              children: [
                if (onSaveDraft != null)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: busy ? null : onSaveDraft,
                      style: OutlinedButton.styleFrom(minimumSize: Size(0, 46)),
                      child: Text(t('Lưu tạm')),
                    ),
                  ),
                if (onSaveDraft != null && onComplete != null)
                  SizedBox(width: 10),
                if (onComplete != null)
                  Expanded(
                    child: FilledButton(
                      onPressed: busy ? null : onComplete,
                      style: FilledButton.styleFrom(minimumSize: Size(0, 46)),
                      child: busy
                          ? SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white))
                          : Text(completeLabel.isEmpty
                              ? t('Hoàn thành')
                              : completeLabel),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Dòng tổng trong panel meta ("Tổng tiền hàng", "VAT", "Tổng cộng"…).
class KvMetaTotalRow extends StatelessWidget {
  final String label;
  final String value;
  final bool big;
  final Color? accent;
  const KvMetaTotalRow(
      {super.key,
      required this.label,
      required this.value,
      this.big = false,
      this.accent});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: TextStyle(
                  fontSize: big ? 13.5 : 12.5,
                  fontWeight: big ? FontWeight.w800 : FontWeight.w500,
                  color: DanColors.muted)),
          Text(value,
              style: TextStyle(
                  fontSize: big ? 16 : 13,
                  fontWeight: big ? FontWeight.w900 : FontWeight.w700,
                  color: accent ?? DanColors.text)),
        ],
      ),
    );
  }
}

/// Ô nhập số nhỏ dùng trong bảng dòng hàng (SL, đơn giá, lô…).
class KvCellInput extends StatelessWidget {
  final TextEditingController controller;
  final double width;
  final TextAlign align;
  final String hint;
  final ValueChanged<String>? onChanged;
  final bool number;
  const KvCellInput({
    super.key,
    required this.controller,
    this.width = 86,
    this.align = TextAlign.right,
    this.hint = '',
    this.onChanged,
    this.number = true,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      height: 34,
      child: TextField(
        controller: controller,
        textAlign: align,
        keyboardType: number ? TextInputType.number : TextInputType.text,
        style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: TextStyle(
              fontSize: 11.5,
              color: DanColors.faint,
              fontWeight: FontWeight.w500),
          isDense: true,
          contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          filled: true,
          fillColor: DanColors.surface2,
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(7),
              borderSide: BorderSide.none),
        ),
        onChanged: onChanged,
      ),
    );
  }
}
