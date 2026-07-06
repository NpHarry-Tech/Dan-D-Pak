import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/format.dart';
import '../../ui/open_file.dart';
import '../management/management_widgets.dart';

String _s(dynamic v) => v?.toString() ?? '';
num _n(dynamic v) => v is num ? v : num.tryParse(_s(v)) ?? 0;

String _fileIcon(String name) {
  final n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'PDF';
  if (n.endsWith('.doc') || n.endsWith('.docx')) return 'DOC';
  if (n.endsWith('.xls') || n.endsWith('.xlsx') || n.endsWith('.csv')) return 'XLS';
  if (n.endsWith('.png') ||
      n.endsWith('.jpg') ||
      n.endsWith('.jpeg') ||
      n.endsWith('.webp')) {
    return 'IMG';
  }
  if (n.endsWith('.zip') || n.endsWith('.rar')) return 'ZIP';
  return 'FILE';
}

String _humanSize(num bytes) {
  if (bytes >= 1e9) return '${(bytes / 1e9).toStringAsFixed(1)} GB';
  if (bytes >= 1e6) return '${(bytes / 1e6).toStringAsFixed(1)} MB';
  if (bytes >= 1e3) return '${(bytes / 1e3).round()} KB';
  return '${bytes.round()} B';
}

/// Embeddable document library (used inside the Database module's Tài liệu
/// tab) — port of the web Tài liệu (documents.html): search, download
/// (opens via OS) and delete.
class DocumentsBody extends StatefulWidget {
  const DocumentsBody({super.key});

  @override
  State<DocumentsBody> createState() => _DocumentsBodyState();
}

class _DocumentsBodyState extends State<DocumentsBody> {
  List<Map<String, dynamic>> _files = [];
  String _search = '';
  bool _loading = true;
  String? _error;
  String? _downloading;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await context.read<ApiService>().getDocuments(q: _search.trim());
      if (!mounted) return;
      setState(() {
        _files = (res['files'] is List)
            ? (res['files'] as List)
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : [];
        _loading = false;
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

  void _toast(String m, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(m), backgroundColor: error ? DanColors.late : DanColors.text));
  }

  Future<void> _download(Map<String, dynamic> f) async {
    final id = _s(f['id']);
    setState(() => _downloading = id);
    try {
      final bytes = await context.read<ApiService>().downloadDocument(id);
      final name = _s(f['original_name']).isNotEmpty
          ? _s(f['original_name'])
          : _s(f['name']);
      await openBytes(bytes, name.isEmpty ? 'document' : name);
      _toast('Đã mở tài liệu');
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    } finally {
      if (mounted) setState(() => _downloading = null);
    }
  }

  Future<void> _delete(Map<String, dynamic> f) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: const Text('Xóa tài liệu'),
        content: Text('Xóa "${_s(f['original_name']).isEmpty ? _s(f['name']) : _s(f['original_name'])}"?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Hủy')),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: FilledButton.styleFrom(backgroundColor: DanColors.late),
            child: const Text('Xóa'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await context.read<ApiService>().deleteDocument(_s(f['id']));
      _load();
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(14),
          child: TextField(
            decoration: const InputDecoration(
                hintText: 'Tìm tài liệu…',
                prefixIcon: Icon(Icons.search),
                isDense: true),
            onChanged: (v) => _search = v,
            onSubmitted: (_) => _load(),
          ),
        ),
        const Divider(height: 1, color: DanColors.border),
        Expanded(child: _body()),
      ],
    );
  }

  Widget _body() {
    if (_loading && _files.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _files.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(40),
        child: InlineMessage('Không tải được tài liệu ($_error)',
            error: true, onRetry: _load),
      );
    }
    if (_files.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(40),
          child: Text(
              'Chưa có tài liệu nào.\n(Tải lên tài liệu mới sẽ bổ sung sau khi tích hợp chọn file.)',
              textAlign: TextAlign.center,
              style: TextStyle(color: DanColors.faint)),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: GridView.builder(
        padding: const EdgeInsets.all(16),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 280,
          mainAxisExtent: 160,
          crossAxisSpacing: 14,
          mainAxisSpacing: 14,
        ),
        itemCount: _files.length,
        itemBuilder: (_, i) => _card(_files[i]),
      ),
    );
  }

  Widget _card(Map<String, dynamic> f) {
    final name = _s(f['original_name']).isEmpty ? _s(f['name']) : _s(f['original_name']);
    final created = DateTime.tryParse(_s(f['created_at']));
    final size = _n(f['size']);
    final id = _s(f['id']);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(_fileIcon(name), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: DanColors.muted)),
              const Spacer(),
              if (_s(f['category']).isNotEmpty)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                      color: DanColors.surface2,
                      borderRadius: BorderRadius.circular(5)),
                  child: Text(_s(f['category']),
                      style: const TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          color: DanColors.muted)),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text(
            [
              if (size > 0) _humanSize(size),
              if (created != null) Fmt.dmyHm(created).substring(6),
            ].join(' · '),
            style: const TextStyle(fontSize: 11, color: DanColors.faint),
          ),
          const Spacer(),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _downloading == id ? null : () => _download(f),
                  icon: _downloading == id
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.download, size: 16),
                  label: const Text('Mở', style: TextStyle(fontSize: 12.5)),
                  style: OutlinedButton.styleFrom(minimumSize: const Size(0, 34)),
                ),
              ),
              IconButton(
                onPressed: () => _delete(f),
                icon: const Icon(Icons.delete_outline,
                    size: 18, color: DanColors.faint),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
