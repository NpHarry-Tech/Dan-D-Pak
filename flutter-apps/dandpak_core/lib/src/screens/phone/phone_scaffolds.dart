import 'dart:async';

import 'package:flutter/material.dart';

import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'phone_kit.dart';

/// KHUÔN DÙNG CHUNG cho các màn điện thoại.
///
/// Phần lớn trong 53 màn của bản thiết kế là biến thể của ba khuôn: danh sách,
/// chi tiết, biểu mẫu. Gom vào đây để mỗi màn cụ thể chỉ còn phần NGHIỆP VỤ
/// (gọi API nào, mỗi dòng hiện gì) — thay vì chép lại bố cục 50 lần rồi lệch
/// nhau dần.

/// Dải chỉ số đầu màn (2 hoặc 4 ô).
class PhoneMetricStrip extends StatelessWidget {
  /// [items] = (nhãn, giá trị, màu giá trị tuỳ chọn).
  final List<(String, String, Color?)> items;
  final int columns;

  const PhoneMetricStrip(this.items, {super.key, this.columns = 2});

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    final rows = <List<(String, String, Color?)>>[];
    for (var i = 0; i < items.length; i += columns) {
      rows.add(items.sublist(i, (i + columns).clamp(0, items.length)));
    }
    return Container(
      color: DanColors.border,
      child: Column(
        children: [
          for (final r in rows)
            // IntrinsicHeight: các ô phải CAO BẰNG NHAU (kẻ dọc giữa chúng mới
            // thẳng), nhưng chiều cao do nội dung quyết định. Dùng thẳng
            // CrossAxisAlignment.stretch trong Column là ép chiều cao vô hạn.
            IntrinsicHeight(
                child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var i = 0; i < columns; i++)
                  Expanded(
                    child: i < r.length
                        ? Container(
                            color: DanColors.surface,
                            margin: EdgeInsets.only(
                                left: i == 0 ? 0 : 1, bottom: 1),
                            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(r[i].$2,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                        fontSize: 17,
                                        fontWeight: FontWeight.w800,
                                        color: r[i].$3 ?? DanColors.text,
                                        fontFeatures: const [
                                          FontFeature.tabularFigures()
                                        ])),
                                const SizedBox(height: 3),
                                Text(r[i].$1,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w700,
                                        color: DanColors.muted)),
                              ],
                            ),
                          )
                        : Container(
                            color: DanColors.surface,
                            margin: EdgeInsets.only(
                                left: i == 0 ? 0 : 1, bottom: 1)),
                  ),
              ],
            )),
        ],
      ),
    );
  }
}

/// Một dòng trong danh sách: tiêu đề + phụ đề + số tiền + nhãn trạng thái.
class PhoneListRow extends StatelessWidget {
  final String title;
  final String subtitle;
  final String? amount;
  final String? badge;
  final PhoneTone badgeTone;
  final Color? amountColor;
  final String? leadingIndex;
  final VoidCallback? onTap;

  const PhoneListRow({
    super.key,
    required this.title,
    this.subtitle = '',
    this.amount,
    this.badge,
    this.badgeTone = PhoneTone.neutral,
    this.amountColor,
    this.leadingIndex,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 60),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
        decoration: const BoxDecoration(
          color: DanColors.surface,
          border: Border(bottom: BorderSide(color: DanColors.border)),
        ),
        child: Row(
          children: [
            if (leadingIndex != null) ...[
              SizedBox(
                width: 22,
                child: Text(leadingIndex!,
                    style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: DanColors.faint)),
              ),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 13.5, fontWeight: FontWeight.w700)),
                  if (subtitle.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: DanColors.muted)),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (amount != null)
                  Text(amount!,
                      style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w800,
                          color: amountColor ?? DanColors.text,
                          fontFeatures: const [FontFeature.tabularFigures()])),
                if (badge != null)
                  Padding(
                    padding: EdgeInsets.only(top: amount != null ? 4 : 0),
                    child: PhoneBadge(badge!, tone: badgeTone),
                  ),
              ],
            ),
            if (onTap != null) ...[
              const SizedBox(width: 4),
              const Icon(Icons.chevron_right, size: 17, color: DanColors.faint),
            ],
          ],
        ),
      ),
    );
  }
}

/// Thanh tìm kiếm dùng trong đầu các màn danh sách.
class PhoneSearchBar extends StatelessWidget {
  final TextEditingController controller;
  final String hint;
  final ValueChanged<String>? onChanged;
  final VoidCallback? onSubmit;

  const PhoneSearchBar({
    super.key,
    required this.controller,
    required this.hint,
    this.onChanged,
    this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 46,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          const Icon(Icons.search, size: 18, color: DanColors.faint),
          const SizedBox(width: 9),
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              onSubmitted: (_) => onSubmit?.call(),
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                isDense: true,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                filled: false,
                contentPadding: EdgeInsets.zero,
                hintText: hint,
                hintStyle: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: DanColors.faint),
              ),
              style:
                  const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// KHUÔN MÀN DANH SÁCH. Lo sẵn: nạp dữ liệu, tải lại, lỗi, rỗng, tìm kiếm.
/// Màn cụ thể chỉ cần đưa [fetch] và [rowBuilder].
class PhoneListScaffold<T> extends StatefulWidget {
  final String title;
  final String? subtitle;
  final bool showBack;
  final List<Widget> actions;

  /// Nạp dữ liệu. Nhận từ khóa tìm kiếm hiện tại.
  final Future<List<T>> Function(String query) fetch;
  final Future<List<T>> Function(String query, int page)? fetchMore;
  final int pageSize;
  final Widget Function(BuildContext, T, int) rowBuilder;

  /// Dải chỉ số tính từ dữ liệu đã nạp (rỗng = không hiện).
  final List<(String, String, Color?)> Function(List<T>)? metrics;
  final int metricColumns;

  final String? searchHint;
  final List<Widget> Function(BuildContext)? filters;
  final Widget? actionBar;
  final String emptyTitle;
  final String emptyHint;
  final IconData emptyIcon;

  const PhoneListScaffold({
    super.key,
    required this.title,
    required this.fetch,
    this.fetchMore,
    this.pageSize = 100,
    required this.rowBuilder,
    this.subtitle,
    this.showBack = true,
    this.actions = const [],
    this.metrics,
    this.metricColumns = 2,
    this.searchHint,
    this.filters,
    this.actionBar,
    this.emptyTitle = 'Chưa có dữ liệu',
    this.emptyHint = 'Kéo xuống để tải lại',
    this.emptyIcon = Icons.inbox_outlined,
  });

  @override
  State<PhoneListScaffold<T>> createState() => PhoneListScaffoldState<T>();
}

class PhoneListScaffoldState<T> extends State<PhoneListScaffold<T>> {
  final _searchCtrl = TextEditingController();
  Timer? _debounce;
  List<T> _items = [];
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  int _page = 1;
  String? _error;

  @override
  void initState() {
    super.initState();
    reload();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> reload() async {
    if (mounted) setState(() => _loading = true);
    try {
      final list = await widget.fetch(_searchCtrl.text.trim());
      if (!mounted) return;
      setState(() {
        _items = list;
        _page = 1;
        _hasMore = widget.fetchMore != null && list.length >= widget.pageSize;
        _loading = false;
        _loadingMore = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    final fetchMore = widget.fetchMore;
    if (fetchMore == null || _loadingMore || !_hasMore) return;
    setState(() => _loadingMore = true);
    try {
      final next = await fetchMore(_searchCtrl.text.trim(), _page + 1);
      if (!mounted) return;
      setState(() {
        _items.addAll(next);
        _page += 1;
        _hasMore = next.length >= widget.pageSize;
        _loadingMore = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingMore = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  void _onSearch(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 320), reload);
  }

  @override
  Widget build(BuildContext context) {
    final filters = widget.filters?.call(context) ?? const <Widget>[];
    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Container(
              color: DanColors.surface,
              child: Column(
                children: [
                  PhoneHeader(
                    title: t(widget.title),
                    subtitle: widget.subtitle,
                    onBack: widget.showBack
                        ? () => Navigator.of(context).maybePop()
                        : null,
                    actions: widget.actions,
                  ),
                  if (widget.searchHint != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                      child: PhoneSearchBar(
                        controller: _searchCtrl,
                        hint: t(widget.searchHint!),
                        onChanged: _onSearch,
                        onSubmit: reload,
                      ),
                    ),
                  if (filters.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                      child: SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: [
                            for (final f in filters)
                              Padding(
                                padding: const EdgeInsets.only(right: 8),
                                child: f,
                              ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
            if (widget.metrics != null && _items.isNotEmpty)
              PhoneMetricStrip(widget.metrics!(_items),
                  columns: widget.metricColumns),
            Expanded(child: _body()),
            if (widget.actionBar != null)
              PhoneActionBar(child: widget.actionBar!),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading && _items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _items.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: InlineMessage('${t(widget.title)}: $_error',
            error: true, onRetry: reload),
      );
    }
    if (_items.isEmpty) {
      return RefreshIndicator(
        onRefresh: reload,
        child: ListView(children: [
          PhoneEmpty(
              title: widget.emptyTitle,
              hint: widget.emptyHint,
              icon: widget.emptyIcon),
        ]),
      );
    }
    return RefreshIndicator(
      onRefresh: reload,
      child: ListView.builder(
        padding: EdgeInsets.zero,
        itemCount: _items.length + (_hasMore ? 1 : 0),
        itemBuilder: (ctx, i) {
          if (i == _items.length) {
            return Padding(
              padding: const EdgeInsets.all(16),
              child: OutlinedButton.icon(
                onPressed: _loadingMore ? null : _loadMore,
                icon: _loadingMore
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.expand_more),
                label: Text(t('Xem thêm lịch sử')),
              ),
            );
          }
          return widget.rowBuilder(ctx, _items[i], i);
        },
      ),
    );
  }
}

/// Khối thông tin trong màn chi tiết.
class PhoneInfoCard extends StatelessWidget {
  final String? title;
  final List<(String, String)> rows;
  final List<Widget> extra;

  const PhoneInfoCard(
      {super.key, this.title, this.rows = const [], this.extra = const []});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null)
            Padding(
              padding: const EdgeInsets.only(top: 10, bottom: 2),
              child: Text(t(title!),
                  style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      letterSpacing: .8,
                      color: DanColors.muted)),
            ),
          for (final r in rows) PhoneKv(t(r.$1), r.$2),
          ...extra,
          const SizedBox(height: 6),
        ],
      ),
    );
  }
}

/// Ô nhập trong biểu mẫu — nhãn trên, giá trị dưới, chạm cả hàng.
class PhoneField extends StatelessWidget {
  final String label;
  final String value;
  final String hint;
  final VoidCallback? onTap;
  final ValueChanged<String>? onChanged;
  final TextEditingController? controller;
  final TextInputType? keyboardType;
  final bool required;

  /// Nút phụ nằm cuối hàng (VD: nút dò máy in). Có [trailing] thì nó THAY cho
  /// mũi tên ">" — hai biểu tượng cạnh nhau chỉ làm người dùng bấm nhầm.
  final Widget? trailing;

  const PhoneField({
    super.key,
    required this.label,
    this.value = '',
    this.hint = '',
    this.onTap,
    this.onChanged,
    this.controller,
    this.keyboardType,
    this.required = false,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    final labelRow = Row(
      children: [
        Text(t(label),
            style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                color: DanColors.muted)),
        if (required)
          const Text(' *',
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  color: DanColors.late)),
      ],
    );

    // Có onTap = ô CHỌN (mở bottom sheet). Không có = ô GÕ.
    if (onTap != null) {
      return InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 62),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: const BoxDecoration(
            color: DanColors.surface,
            border: Border(bottom: BorderSide(color: DanColors.border)),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    labelRow,
                    const SizedBox(height: 3),
                    Text(value.isEmpty ? t(hint) : value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: value.isEmpty
                                ? DanColors.faint
                                : DanColors.text)),
                  ],
                ),
              ),
              trailing ??
                  const Icon(Icons.chevron_right,
                      size: 18, color: DanColors.faint),
            ],
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: const BoxDecoration(
        color: DanColors.surface,
        border: Border(bottom: BorderSide(color: DanColors.border)),
      ),
      child: Row(
        children: [
          Expanded(child: _typedField()),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }

  Widget _typedField() {
    final labelRow = Row(
      children: [
        Text(t(label),
            style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                color: DanColors.muted)),
        if (required)
          const Text(' *',
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  color: DanColors.late)),
      ],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        labelRow,
        TextField(
          controller: controller,
          onChanged: onChanged,
          keyboardType: keyboardType,
          decoration: InputDecoration(
            isDense: true,
            border: InputBorder.none,
            enabledBorder: InputBorder.none,
            focusedBorder: InputBorder.none,
            filled: false,
            contentPadding: const EdgeInsets.symmetric(vertical: 6),
            hintText: t(hint),
            hintStyle: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: DanColors.faint),
          ),
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
        ),
      ],
    );
  }
}

/// Công tắc bật/tắt trong màn thiết lập.
class PhoneToggleRow extends StatelessWidget {
  final String label;
  final String? hint;
  final bool value;
  final ValueChanged<bool> onChanged;

  const PhoneToggleRow({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    this.hint,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 58),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: const BoxDecoration(
        color: DanColors.surface,
        border: Border(bottom: BorderSide(color: DanColors.border)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(t(label),
                    style: const TextStyle(
                        fontSize: 13.5, fontWeight: FontWeight.w700)),
                if (hint != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(t(hint!),
                        style: const TextStyle(
                            fontSize: 11, color: DanColors.muted)),
                  ),
              ],
            ),
          ),
          Switch(value: value, onChanged: onChanged),
        ],
      ),
    );
  }
}

/// Lưới module (màn "Nhiều hơn").
class PhoneModuleGrid extends StatelessWidget {
  /// (nhãn, icon, hành động). Mục bị khoá quyền thì truyền null cho hành động.
  final List<(String, IconData, VoidCallback?)> items;
  const PhoneModuleGrid(this.items, {super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: DanColors.border,
      child: GridView.count(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisCount: 3,
        mainAxisSpacing: 1,
        crossAxisSpacing: 1,
        childAspectRatio: 1.05,
        children: [
          for (final (label, icon, go) in items)
            Material(
              color: DanColors.surface,
              child: InkWell(
                onTap: go,
                child: Opacity(
                  opacity: go == null ? .4 : 1,
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(icon, size: 23, color: DanColors.brand),
                      const SizedBox(height: 9),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                        child: Text(t(label),
                            textAlign: TextAlign.center,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w700,
                                height: 1.25)),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
