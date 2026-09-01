import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/management_models.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import 'management_widgets.dart';
import '../../utils/translation.dart';
import '../../ui/file_pick.dart';

/// Trình dựng QUYỂN — dùng chung cho HAI loại:
///   kind 'fnb'    — Menu quyển nhà hàng, chấm điểm trỏ tới MÓN (menu_items)
///   kind 'retail' — Catalogue bán lẻ,   chấm điểm trỏ tới HÀNG HOÁ (skus)
///
/// Cùng một trình dựng vì thao tác giống hệt nhau: thêm trang (ảnh hoặc import
/// PubHTML5), đặt chấm điểm lên trang, gắn chấm điểm với một mặt hàng, bấm Lưu.
/// Tách thành hai panel thì mọi sửa lỗi phải làm hai lần và chúng sẽ trôi khác
/// nhau dần — đó là lý do bản catalogue rút gọn trước đây thiếu import PubHTML5,
/// thiếu nút Lưu và không gắn được hàng hoá vào trang.
class BookMenuPanel extends StatefulWidget {
  final ApiService api;
  final Widget? moduleSwitcher;

  /// 'fnb' | 'retail'
  final String kind;

  BookMenuPanel({
    super.key,
    required this.api,
    this.moduleSwitcher,
    this.kind = 'fnb',
  });

  bool get laRetail => kind == 'retail';

  @override
  State<BookMenuPanel> createState() => _BookMenuPanelState();
}

class _BookMenuPanelState extends State<BookMenuPanel> {
  Map<String, dynamic>? _cfg;
  List<AdminMenuItem> _items = [];

  /// Khoá trong chấm điểm chứa mã mặt hàng — khác nhau giữa hai loại quyển.
  String get _khoaHang => widget.laRetail ? 'sku_id' : 'menu_item_id';

  /// Khoá trong cấu hình lưu "quyển đang dùng" — hai loại có hai khoá riêng để
  /// bật catalogue bán lẻ không làm đổi menu đang chạy trên iPad nhà hàng.
  String get _khoaQuyen =>
      widget.laRetail ? 'activeRetailBookId' : 'activeBookId';

  /// Chỉ hiện những quyển ĐÚNG LOẠI — trộn hai loại vào một danh sách thì rất
  /// dễ gắn nhầm catalogue bán lẻ làm menu nhà hàng.
  List<Map<String, dynamic>> get _quyenCungLoai => _books()
      .where((b) => ('${b['kind'] ?? 'fnb'}' == 'retail') == widget.laRetail)
      .toList();

  /// Khoá bật/tắt cũng riêng: tắt catalogue bán lẻ không được tắt menu iPad.
  String get _khoaBat => widget.laRetail ? 'retailEnabled' : 'enabled';

  /// Menu FnB mặc định BẬT (cửa hàng nào cũng có menu), catalogue bán lẻ mặc
  /// định TẮT — chưa dựng quyển mà bật là màn khách hiện trang trắng.
  bool get _dangBat {
    final v = _cfg?[_khoaBat];
    return widget.laRetail ? v == true : v != false;
  }

  bool _loading = true;
  bool _saving = false;

  /// Vì sao không tra được mặt hàng nào (kho chưa nối / kho được chọn chưa có
  /// hàng). Không có hàng thì không gắn được chấm điểm nào — phải nói ra.
  String _lyDoTrong = '';
  String? _error;
  String? _bookId;
  int _pageIdx = 0;
  String? _hotspotId;

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
      final cfg = Map<String, dynamic>.from(
          await widget.api.getBookMenuConfig() as Map);

      // NGUỒN MẶT HÀNG khác nhau: catalogue bán lẻ gắn HÀNG HOÁ trong kho, menu
      // quyển gắn MÓN của nhà hàng. Dùng nhầm nguồn thì chấm điểm trỏ vào mã
      // không tồn tại và màn khách chạm vào không ra gì.
      final List<AdminMenuItem> hang;
      if (widget.laRetail) {
        // KÊNH 'retail' = đúng cái kho đã nối với mục bán lẻ. Chấm điểm chỉ
        // được gắn vào hàng mà quầy thật sự bán được; lấy toàn bộ kho rồi gắn
        // bừa thì khách bấm ra một mặt hàng POS không tính tiền được.
        final res = await widget.api.getSkusPaginated(
            page: 1, limit: 500, q: '', channel: 'retail', inStockOnly: false);
        _lyDoTrong = '${(res['empty_reason'] as Map?)?['message'] ?? ''}';
        // Dựng qua fromJson để khỏi phải điền tay hàng chục trường của món ăn
        // (công thức, dị ứng, lịch bán…) mà hàng hoá bán lẻ không có.
        hang = (res['items'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => AdminMenuItem.fromJson({
                  'id': '${e['id'] ?? ''}',
                  'name': '${e['name'] ?? ''}',
                  'price': e['price'] ?? 0,
                  'image': '${e['image'] ?? ''}',
                }))
            .where((x) => x.id.isNotEmpty)
            .toList();
      } else {
        final menu = MenuManageData.fromJson(
            Map<String, dynamic>.from(await widget.api.getMenuManage() as Map));
        hang = menu.items;
      }
      if (!mounted) return;
      setState(() {
        _cfg = cfg;
        _items = hang;
        _bookId = (widget.laRetail
                ? (cfg['activeRetailBookId'] ?? '')
                : (cfg['activeBookId'] ?? ''))
            .toString();
        _pageIdx = 0;
        _hotspotId = null;
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

  List<Map<String, dynamic>> _books() {
    final cfg = _cfg;
    if (cfg == null) return [];
    final raw = cfg['books'];
    final books = raw is List
        ? raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
        : <Map<String, dynamic>>[];
    cfg['books'] = books;
    return books;
  }

  Map<String, dynamic>? _book() {
    final books = _quyenCungLoai;
    if (books.isEmpty) return null;
    return books.firstWhere(
      (b) => b['id'] == (_bookId ?? _cfg?[_khoaQuyen]),
      orElse: () => books.first,
    );
  }

  List<Map<String, dynamic>> _pages(Map<String, dynamic> book) {
    final raw = book['pages'];
    final pages = raw is List
        ? raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
        : <Map<String, dynamic>>[];
    book['pages'] = pages;
    return pages;
  }

  List<Map<String, dynamic>> _hotspots(Map<String, dynamic> book) {
    final raw = book['hotspots'];
    final list = raw is List
        ? raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
        : <Map<String, dynamic>>[];
    book['hotspots'] = list;
    return list;
  }

  Map<String, dynamic>? _hotspot(Map<String, dynamic> book) {
    final list = _hotspots(book);
    if (_hotspotId == null) return null;
    for (final h in list) {
      if (h['id'] == _hotspotId) return h;
    }
    return null;
  }

  String _menuName(String id) {
    for (final item in _items) {
      if (item.id == id) return item.name;
    }
    return widget.laRetail ? t('Chưa gán hàng hoá') : t('Chưa gán món');
  }

  String _assetUrl(String src) {
    if (src.startsWith('http') || src.startsWith('data:')) return src;
    final base = context.read<AuthProvider>().serverUrl;
    return '$base${src.startsWith('/') ? '' : '/'}$src';
  }

  Map<String, dynamic> _copyCfg() =>
      jsonDecode(jsonEncode(_cfg ?? <String, dynamic>{}))
          as Map<String, dynamic>;

  Future<void> _save({bool reload = true}) async {
    final cfg = _cfg;
    if (cfg == null) return;
    cfg[_khoaQuyen] = _book()?['id'] ?? cfg[_khoaQuyen];
    setState(() => _saving = true);
    try {
      final saved = await widget.api.saveBookMenuConfig(_copyCfg());
      if (!mounted) return;
      setState(() {
        _cfg = saved;
        _bookId = (saved[_khoaQuyen] ?? _bookId ?? '').toString();
        _saving = false;
      });
      if (reload) {
        _toast(
            widget.laRetail ? t('Đã lưu catalogue') : t('Đã lưu menu quyển'));
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  void _toast(String msg, {bool error = false}) =>
      appToast(context, msg, isError: error);

  String _id(String prefix) =>
      '$prefix${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}';

  void _newBook() {
    final books = _books();
    final id = _id('book_');
    final book = {
      'id': id,
      'kind': widget.kind,
      'title': widget.laRetail ? t('Catalogue bán lẻ') : t('Menu mới'),
      'pageWidth': 566.929016,
      'pageHeight': 850.394043,
      // Quyển bán lẻ mở ra RỖNG — ảnh mẫu của menu nhà hàng không liên quan gì
      // tới hàng hoá trong kho, để sẵn chỉ tổ phải xoá đi.
      'pages': widget.laRetail
          ? <Map<String, dynamic>>[]
          : [
              {
                'id': 'p_1',
                'src': '/assets/menu-book/01.webp',
                'label': 'Trang 1'
              }
            ],
      'hotspots': <Map<String, dynamic>>[],
      'created_at': DateTime.now().toIso8601String(),
      'updated_at': DateTime.now().toIso8601String(),
    };
    setState(() {
      books.add(book);
      _cfg?[_khoaQuyen] = id;
      _bookId = id;
      _pageIdx = 0;
      _hotspotId = null;
    });
  }

  void _deleteBook() {
    final books = _quyenCungLoai;
    final book = _book();
    if (book == null) return;
    if (books.length <= 1) {
      _toast(t('Cần giữ lại ít nhất một quyển menu'), error: true);
      return;
    }
    setState(() {
      _books().removeWhere((b) => b['id'] == book['id']);
      _bookId = (_quyenCungLoai.first['id'] ?? '').toString();
      _cfg?[_khoaQuyen] = _bookId;
      _pageIdx = 0;
      _hotspotId = null;
    });
  }

  Future<void> _importPubhtml5() async {
    final values = await showDialog<List<String>>(
      context: context,
      builder: (ctx) {
        final url = TextEditingController();
        final title = TextEditingController(
            text: _book()?['title']?.toString() ?? 'Menu');
        return AlertDialog(
          backgroundColor: DanColors.surface,
          title: Text('Import PubHTML5'),
          content: SizedBox(
            width: dialogWidth(context, 460),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                    controller: url,
                    decoration: InputDecoration(labelText: 'Link PubHTML5')),
                SizedBox(height: 10),
                TextField(
                    controller: title,
                    decoration: InputDecoration(labelText: t('Tên quyển'))),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: Text(t('Hủy'))),
            FilledButton(
              onPressed: () =>
                  Navigator.of(ctx).pop([url.text.trim(), title.text.trim()]),
              child: Text('Import'),
            ),
          ],
        );
      },
    );
    if (values == null || values.first.isEmpty) return;
    setState(() => _saving = true);
    try {
      final cfg = await widget.api
          .importBookMenuPubhtml5(values[0], values[1], kind: widget.kind);
      if (!mounted) return;
      setState(() {
        _cfg = cfg;
        _bookId = (cfg[_khoaQuyen] ?? '').toString();
        _pageIdx = 0;
        _hotspotId = null;
        _saving = false;
      });
      _toast(t('Đã import menu mới'));
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  /// THÊM TRANG = TẢI ẢNH THẬT lên máy chủ.
  ///
  /// Bản cũ chỉ hỏi một đường dẫn kiểu `/assets/menu-book/03.webp` — cửa hàng
  /// không có cách nào đưa ảnh của mình vào, gõ đường dẫn không tồn tại thì
  /// trang hiện ra ô trống. Ảnh đi thẳng lên máy chủ nên mọi máy đều thấy.
  Future<void> _addPage() async {
    final book = _book();
    if (book == null) return;
    final path =
        await pickImagePathCross(title: t('Chọn ảnh trang'), context: context);
    if (path == null) return;
    setState(() => _saving = true);
    try {
      final bytes = await File(path).readAsBytes();
      if (bytes.isEmpty) throw Exception(t('Không đọc được ảnh'));
      final name = path.split(RegExp(r'[\/]')).last;
      // Lưu cấu hình đang sửa TRƯỚC khi tải trang lên: máy chủ ghi trang mới
      // vào bản trên đĩa rồi trả về cả cấu hình, nếu chưa lưu thì chấm điểm và
      // tên quyển vừa sửa sẽ bị bản trả về ghi đè mất.
      await _save(reload: false);
      final cfg = await widget.api.addCataloguePage(
        originalName: name,
        mimeType: _mimeOf(name),
        base64Data: base64Encode(bytes),
        bookId: '${book['id'] ?? ''}',
        kind: widget.kind,
      );
      if (!mounted) return;
      setState(() {
        _cfg = cfg;
        _saving = false;
        _pageIdx = math.max(0, _pages(_book() ?? {}).length - 1);
        _hotspotId = null;
      });
      _toast(t('Đã thêm trang'));
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  String _mimeOf(String name) {
    final n = name.toLowerCase();
    if (n.endsWith('.png')) return 'image/png';
    if (n.endsWith('.webp')) return 'image/webp';
    if (n.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  }

  Future<void> _deletePage() async {
    final book = _book();
    if (book == null) return;
    final pages = _pages(book);
    if (pages.isEmpty) return;
    final page = pages[_pageIdx.clamp(0, pages.length - 1)];
    setState(() => _saving = true);
    try {
      // Xoá trên máy chủ để nó dọn luôn ảnh và dồn số trang của chấm điểm —
      // xoá tại chỗ rồi lưu đè sẽ để lại ảnh mồ côi trong thư mục uploads.
      await _save(reload: false);
      final cfg = await widget.api.removeCataloguePage(
        bookId: '${book['id'] ?? ''}',
        pageId: '${page['id'] ?? ''}',
      );
      if (!mounted) return;
      setState(() {
        _cfg = cfg;
        _saving = false;
        final con = _pages(_book() ?? {}).length;
        _pageIdx = con == 0 ? 0 : _pageIdx.clamp(0, con - 1).toInt();
        _hotspotId = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  void _newHotspot({double x = 50, double y = 50}) {
    final book = _book();
    if (book == null || _items.isEmpty) return;
    final h = {
      'id': _id('hs_'),
      'page': _pageIdx,
      'x': x,
      'y': y,
      'angle': 0,
      _khoaHang: _items.first.id,
      'label': '',
      'enabled': true,
      'color': '#0891b2',
    };
    setState(() {
      _hotspots(book).add(h);
      _hotspotId = h['id'].toString();
    });
  }

  void _deleteHotspot() {
    final book = _book();
    if (book == null || _hotspotId == null) return;
    setState(() {
      _hotspots(book).removeWhere((h) => h['id'] == _hotspotId);
      _hotspotId = null;
    });
  }

  void _moveSelectedHotspot(TapDownDetails details, Size size) {
    final book = _book();
    if (book == null || size.width <= 0 || size.height <= 0) return;
    final h = _hotspot(book);
    if (h == null) {
      _newHotspot(
        x: details.localPosition.dx / size.width * 100,
        y: details.localPosition.dy / size.height * 100,
      );
      return;
    }
    setState(() {
      h['page'] = _pageIdx;
      h['x'] = (details.localPosition.dx / size.width * 100).clamp(0, 100);
      h['y'] = (details.localPosition.dy / size.height * 100).clamp(0, 100);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(_error!, error: true, onRetry: _load),
      );
    }
    if (widget.laRetail && _items.isEmpty && _lyDoTrong.isNotEmpty) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(_lyDoTrong, error: true, onRetry: _load),
      );
    }
    final book = _book();
    if (book == null) {
      // Catalogue bán lẻ bắt đầu từ con số 0 (menu nhà hàng có sẵn quyển mẫu),
      // nên phải có lối tạo quyển đầu tiên ngay tại đây.
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(widget.laRetail
                ? t('Chưa có quyển catalogue nào')
                : t('Chưa có cấu hình menu quyển')),
            SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () {
                _newBook();
                _save();
              },
              icon: Icon(Icons.add, size: 16),
              label: Text(t('Tạo quyển mới')),
            ),
          ],
        ),
      );
    }

    return LayoutBuilder(builder: (context, c) {
      final compact = c.maxWidth < 980 || c.maxHeight < 720;
      final wide = c.maxWidth >= 980;
      final gap = compact ? 8.0 : 10.0;
      final pad = compact ? 6.0 : 8.0;
      final toolsWidth = math.min(390.0, math.max(320.0, c.maxWidth * .22));

      return Padding(
        padding: EdgeInsets.all(pad),
        child: wide
            ? Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: _preview(book, compact: compact, showToolbar: false),
                  ),
                  SizedBox(width: gap),
                  SizedBox(
                    width: toolsWidth,
                    child: _sideTools(book, compact: true),
                  ),
                ],
              )
            : Column(
                children: [
                  Expanded(
                    flex: 5,
                    child: _preview(book, compact: true, showToolbar: false),
                  ),
                  SizedBox(height: gap),
                  Expanded(
                    flex: 4,
                    child: _sideTools(book, compact: true),
                  ),
                ],
              ),
      );
    });
  }

  Widget _topControls(Map<String, dynamic> book, {required bool compact}) {
    final books = _quyenCungLoai;
    return Container(
      padding: EdgeInsets.all(compact ? 10 : 14),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(t('Menu quyển tương tác'),
                        style: TextStyle(
                            fontSize: compact ? 14 : 16,
                            fontWeight: FontWeight.w900)),
                    if (!compact) ...[
                      SizedBox(height: 3),
                      Text(t('Bật cho tablet/iPad dọc; mỗi hotspot mở đúng món thật trong backend.'),
                          style:
                              TextStyle(fontSize: 12, color: DanColors.muted)),
                    ],
                  ],
                ),
              ),
              Switch(
                value: _dangBat,
                activeThumbColor: DanColors.brand,
                onChanged: (v) {
                  setState(() => _cfg?[_khoaBat] = v);
                  _save(reload: false);
                },
              ),
            ],
          ),
          SizedBox(height: compact ? 8 : 12),
          Wrap(
            spacing: compact ? 8 : 10,
            runSpacing: compact ? 8 : 10,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              SizedBox(
                width: compact ? 220 : 250,
                child: DropdownButtonFormField<String>(
                  initialValue: book['id']?.toString(),
                  isExpanded: true,
                  decoration: InputDecoration(
                      labelText: t('Quyển đang chỉnh'), isDense: true),
                  items: [
                    for (final b in books)
                      DropdownMenuItem(
                        value: b['id']?.toString(),
                        child: Text(b['title']?.toString() ?? 'Menu',
                            overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: (v) => setState(() {
                    _bookId = v;
                    _cfg?[_khoaQuyen] = v;
                    _pageIdx = 0;
                    _hotspotId = null;
                  }),
                ),
              ),
              SizedBox(
                width: compact ? 210 : 240,
                child: TextFormField(
                  key: ValueKey('title_${book['id']}'),
                  initialValue: book['title']?.toString() ?? '',
                  decoration:
                      InputDecoration(labelText: t('Tên quyển'), isDense: true),
                  onChanged: (v) => book['title'] = v.trim(),
                ),
              ),
              FilledButton.icon(
                onPressed: _saving ? null : () => _save(),
                icon: _saving
                    ? SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : Icon(Icons.save_outlined, size: 16),
                label: Text(t('Lưu menu quyển')),
              ),
              OutlinedButton.icon(
                  onPressed: _newBook,
                  icon: Icon(Icons.add, size: 16),
                  label: Text(t('Tạo quyển'))),
              OutlinedButton.icon(
                  onPressed: _importPubhtml5,
                  icon: Icon(Icons.cloud_download_outlined, size: 16),
                  label: Text('Import PubHTML5')),
              OutlinedButton.icon(
                onPressed: _deleteBook,
                icon: Icon(Icons.delete_outline, size: 16),
                label: Text(t('Xóa quyển')),
                style:
                    OutlinedButton.styleFrom(foregroundColor: DanColors.late),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _sideTools(Map<String, dynamic> book, {required bool compact}) {
    final pages = _pages(book);
    final gap = compact ? 10.0 : 14.0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.moduleSwitcher != null) ...[
          widget.moduleSwitcher!,
          SizedBox(height: gap),
        ],
        _topControls(book, compact: true),
        SizedBox(height: gap),
        _pageToolbar(pages, compact: true),
        SizedBox(height: gap),
        Expanded(child: _inspector(book, compact: true)),
      ],
    );
  }

  Widget _preview(Map<String, dynamic> book,
      {required bool compact, required bool showToolbar}) {
    final pages = _pages(book);
    final hotspots = _hotspots(book)
        .where((h) => ((h['page'] as num?)?.round() ?? 0) == _pageIdx)
        .toList();
    final safePageIdx =
        pages.isEmpty ? 0 : _pageIdx.clamp(0, pages.length - 1).toInt();
    final page = pages.isEmpty ? null : pages[safePageIdx];
    final pageW =
        math.max(1.0, (book['pageWidth'] as num?)?.toDouble() ?? 566.929016);
    final pageH =
        math.max(1.0, (book['pageHeight'] as num?)?.toDouble() ?? 850.394043);
    return Container(
      color: DanColors.bg,
      child: Column(
        children: [
          Expanded(
            child: LayoutBuilder(builder: (context, c) {
              if (c.maxWidth <= 0 || c.maxHeight <= 0) {
                return SizedBox.shrink();
              }

              final scale = math.min(c.maxWidth / pageW, c.maxHeight / pageH);
              if (!scale.isFinite || scale <= 0) return SizedBox.shrink();

              final canvasW = (pageW * scale).clamp(0.0, c.maxWidth).toDouble();
              final canvasH =
                  (pageH * scale).clamp(0.0, c.maxHeight).toDouble();
              final size = Size(canvasW, canvasH);

              return Center(
                child: SizedBox(
                  width: size.width,
                  height: size.height,
                  child: GestureDetector(
                    onTapDown: (d) => _moveSelectedHotspot(d, size),
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        DecoratedBox(
                          decoration: BoxDecoration(
                            color: DanColors.surface2,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: page == null
                              ? Center(
                                  child: Text(t('Chưa có trang menu'),
                                      style: TextStyle(color: DanColors.faint)))
                              : ClipRRect(
                                  borderRadius: BorderRadius.circular(10),
                                  child: Image.network(
                                    _assetUrl(page['src']?.toString() ?? ''),
                                    fit: BoxFit.fill,
                                    // Menu-book pages are large scans; decode
                                    // at panel width, not source resolution.
                                    cacheWidth: 1400,
                                    gaplessPlayback: true,
                                    errorBuilder: (_, __, ___) => Center(
                                      child: Text(t('Không tải được ảnh trang'),
                                          style:
                                              TextStyle(color: DanColors.late)),
                                    ),
                                  ),
                                ),
                        ),
                        for (final hs in hotspots) _hotspotButton(hs, size),
                      ],
                    ),
                  ),
                ),
              );
            }),
          ),
          if (showToolbar) ...[
            SizedBox(height: compact ? 8 : 10),
            _pageToolbar(pages, compact: compact),
          ],
        ],
      ),
    );
  }

  Widget _pageToolbar(List<Map<String, dynamic>> pages,
      {required bool compact}) {
    final currentPage =
        pages.isEmpty ? 0 : _pageIdx.clamp(0, pages.length - 1).toInt();
    return Container(
      padding: EdgeInsets.symmetric(
          horizontal: compact ? 10 : 12, vertical: compact ? 8 : 10),
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  pages.isEmpty
                      ? 'Trang'
                      : 'Trang ${currentPage + 1}/${pages.length}',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              IconButton(
                tooltip: t('Trang trước'),
                visualDensity: VisualDensity.compact,
                onPressed: currentPage > 0
                    ? () => setState(() => _pageIdx = currentPage - 1)
                    : null,
                icon: Icon(Icons.chevron_left),
              ),
              IconButton(
                tooltip: 'Trang sau',
                visualDensity: VisualDensity.compact,
                onPressed: currentPage < pages.length - 1
                    ? () => setState(() => _pageIdx = currentPage + 1)
                    : null,
                icon: Icon(Icons.chevron_right),
              ),
              IconButton(
                tooltip: t('Thêm trang'),
                visualDensity: VisualDensity.compact,
                onPressed: _addPage,
                icon: Icon(Icons.add_photo_alternate_outlined),
              ),
              IconButton(
                tooltip: t('Xóa trang'),
                visualDensity: VisualDensity.compact,
                onPressed: pages.isNotEmpty ? _deletePage : null,
                color: DanColors.late,
                icon: Icon(Icons.delete_outline),
              ),
            ],
          ),
          // DANH MỤC CỦA TRANG.
          //
          // Quyển catalogue dày vài chục trang thì khách không lật hết để tìm.
          // Gán mục cho trang ở đây, màn khách dựng thanh danh mục và bấm là
          // nhảy thẳng tới trang đầu của mục đó. Nhiều trang cùng một mục thì
          // gõ y hệt tên mục — mục nhận trang ĐẦU TIÊN mang tên ấy.
          if (pages.isNotEmpty) ...[
            SizedBox(height: 10),
            TextFormField(
              key: ValueKey('cat_${pages[currentPage]['id']}'),
              initialValue: pages[currentPage]['category']?.toString() ?? '',
              decoration: InputDecoration(
                labelText: t('Danh mục của trang'),
                hintText: t('VD: Hạt dinh dưỡng'),
                helperText: t('Để trống nếu trang này không mở đầu mục nào'),
                isDense: true,
              ),
              onChanged: (v) =>
                  setState(() => pages[currentPage]['category'] = v.trim()),
            ),
          ],
          SizedBox(height: 8),
          _pageStrip(pages, currentPage: currentPage, compact: compact),
        ],
      ),
    );
  }

  Widget _pageStrip(List<Map<String, dynamic>> pages,
      {required int currentPage, required bool compact}) {
    if (pages.isEmpty) {
      return Text(t('Chưa có trang menu'),
          style: TextStyle(color: DanColors.faint));
    }

    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        for (var i = 0; i < pages.length; i++)
          ChoiceChip(
            label: Text('${i + 1}', overflow: TextOverflow.ellipsis),
            selected: i == currentPage,
            visualDensity: VisualDensity.compact,
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            selectedColor: DanColors.brandDim,
            backgroundColor: DanColors.surface,
            side: BorderSide(
                color: i == currentPage ? DanColors.brand : DanColors.border2),
            labelStyle: TextStyle(
              fontSize: compact ? 12 : 13,
              fontWeight: i == currentPage ? FontWeight.w900 : FontWeight.w700,
              color: i == currentPage ? DanColors.brand : DanColors.text,
            ),
            onSelected: (_) => setState(() {
              _pageIdx = i;
              _hotspotId = null;
            }),
          ),
      ],
    );
  }

  Widget _hotspotButton(Map<String, dynamic> hs, Size size) {
    final x = ((hs['x'] as num?)?.toDouble() ?? 50).clamp(0, 100);
    final y = ((hs['y'] as num?)?.toDouble() ?? 50).clamp(0, 100);
    final selected = hs['id'] == _hotspotId;
    final color = _parseColor(hs['color']?.toString() ?? '#0891b2');
    return Positioned(
      left: size.width * x / 100,
      top: size.height * y / 100,
      child: Transform.translate(
        offset: Offset(-34, -14),
        child: Transform.rotate(
          angle:
              (((hs['angle'] as num?)?.toDouble() ?? 0) * 3.1415926535) / 180,
          child: GestureDetector(
            onTap: () => setState(() => _hotspotId = hs['id']?.toString()),
            child: Container(
              padding: EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color:
                    color.withValues(alpha: hs['enabled'] == false ? .55 : 1),
                borderRadius: BorderRadius.circular(99),
                border: Border.all(color: Colors.white, width: 2),
                boxShadow: selected
                    ? [
                        BoxShadow(
                            color: DanColors.doing.withValues(alpha: .45),
                            blurRadius: 0,
                            spreadRadius: 3)
                      ]
                    : [],
              ),
              child: Text(t('Chọn Món'),
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 10,
                      fontWeight: FontWeight.w800),
                  softWrap: false),
            ),
          ),
        ),
      ),
    );
  }

  Widget _inspector(Map<String, dynamic> book, {required bool compact}) {
    final pageHotspots = _hotspots(book)
        .where((h) => ((h['page'] as num?)?.round() ?? 0) == _pageIdx)
        .toList();
    final hs = _hotspot(book);
    return Container(
      padding: EdgeInsets.all(compact ? 10 : 14),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(t('Chấm tương tác'),
                    style:
                        TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
              ),
              if (compact) ...[
                IconButton(
                  tooltip: t('Thêm nút'),
                  visualDensity: VisualDensity.compact,
                  onPressed: () => _newHotspot(),
                  icon: Icon(Icons.add, size: 18),
                ),
                IconButton(
                  tooltip: t('Xóa'),
                  visualDensity: VisualDensity.compact,
                  onPressed: hs == null ? null : _deleteHotspot,
                  color: DanColors.late,
                  icon: Icon(Icons.delete_outline, size: 18),
                ),
              ] else ...[
                TextButton.icon(
                    onPressed: () => _newHotspot(),
                    icon: Icon(Icons.add, size: 16),
                    label: Text(t('Thêm nút'))),
                TextButton.icon(
                  onPressed: hs == null ? null : _deleteHotspot,
                  icon: Icon(Icons.delete_outline, size: 16),
                  label: Text(t('Xóa')),
                  style: TextButton.styleFrom(foregroundColor: DanColors.late),
                ),
              ],
            ],
          ),
          SizedBox(height: 8),
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (pageHotspots.isEmpty)
                    Padding(
                      padding:
                          EdgeInsets.symmetric(vertical: compact ? 10 : 16),
                      child: Text(
                          t('Trang này chưa có nút. Bấm "Thêm nút" hoặc bấm lên ảnh để tạo nhanh.'),
                          style: TextStyle(color: DanColors.faint)),
                    )
                  else
                    ...pageHotspots.map((h) => Padding(
                          padding: EdgeInsets.only(bottom: 6),
                          child: OutlinedButton(
                            onPressed: () => setState(
                                () => _hotspotId = h['id']?.toString()),
                            style: OutlinedButton.styleFrom(
                              alignment: Alignment.centerLeft,
                              backgroundColor: h['id'] == _hotspotId
                                  ? DanColors.brandDim
                                  : null,
                            ),
                            child: Text(
                              '${h['label']?.toString().isNotEmpty == true ? h['label'] : _menuName(h[_khoaHang]?.toString() ?? '')}  ·  x ${((h['x'] as num?) ?? 0).toStringAsFixed(1)}% y ${((h['y'] as num?) ?? 0).toStringAsFixed(1)}%',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )),
                  Divider(height: 24, color: DanColors.border),
                  if (hs == null)
                    Text(t('Chọn một nút để chỉnh món, vị trí và màu.'),
                        style: TextStyle(color: DanColors.muted))
                  else
                    _hotspotEditor(hs),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _hotspotEditor(Map<String, dynamic> hs) {
    final selectedItem = _items.any((i) => i.id == hs[_khoaHang])
        ? hs[_khoaHang]?.toString()
        : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DropdownButtonFormField<String>(
          initialValue: selectedItem,
          isExpanded: true,
          decoration: InputDecoration(
              labelText: t('Món được mở khi bấm'), isDense: true),
          items: [
            for (final item in _items)
              DropdownMenuItem(
                  value: item.id,
                  child: Text(item.name, overflow: TextOverflow.ellipsis)),
          ],
          onChanged: (v) => setState(() => hs[_khoaHang] = v ?? ''),
        ),
        SizedBox(height: 10),
        TextFormField(
          key: ValueKey('hs_label_${hs['id']}'),
          initialValue: hs['label']?.toString() ?? '',
          decoration:
              InputDecoration(labelText: t('Nhãn nội bộ'), isDense: true),
          onChanged: (v) => hs['label'] = v.trim(),
        ),
        SizedBox(height: 10),
        TextFormField(
          key: ValueKey('hs_color_${hs['id']}'),
          initialValue: hs['color']?.toString() ?? '#0891b2',
          decoration: InputDecoration(labelText: t('Màu nút'), isDense: true),
          onChanged: (v) => setState(() => hs['color'] = v.trim()),
        ),
        SizedBox(height: 10),
        Row(
          children: [
            Expanded(child: _numberField(hs, 'x', 'X %')),
            SizedBox(width: 8),
            Expanded(child: _numberField(hs, 'y', 'Y %')),
            SizedBox(width: 8),
            Expanded(child: _numberField(hs, 'angle', t('Góc'))),
          ],
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: hs['enabled'] != false,
          activeThumbColor: DanColors.brand,
          title: Text(t('Hiện nút trên tablet/iPad'),
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
          onChanged: (v) => setState(() => hs['enabled'] = v),
        ),
      ],
    );
  }

  Widget _numberField(Map<String, dynamic> hs, String key, String label) {
    return TextFormField(
      key: ValueKey('${hs['id']}_$key'),
      initialValue: (((hs[key] as num?)?.toDouble() ?? 0)).toStringAsFixed(1),
      keyboardType: TextInputType.number,
      decoration: InputDecoration(labelText: label, isDense: true),
      onChanged: (v) => setState(() => hs[key] = double.tryParse(v) ?? 0),
    );
  }

  Color _parseColor(String value) {
    final raw = value.replaceFirst('#', '').trim();
    if (raw.length == 6) {
      final v = int.tryParse('ff$raw', radix: 16);
      if (v != null) return Color(v);
    }
    return DanColors.brand;
  }
}
