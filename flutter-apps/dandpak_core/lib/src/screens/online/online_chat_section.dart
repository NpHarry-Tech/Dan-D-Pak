import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/debouncer.dart';
import '../../ui/format.dart';
import '../../utils/business_datetime.dart';
import '../../utils/translation.dart';
import '../management/management_widgets.dart';
import 'online_shared.dart';

/// Trạng thái hộp thư chat — PHÂN BIỆT RẠCH RÒI để không gộp "chưa cấu hình" với
/// "đã cấu hình nhưng chưa có hội thoại" (sự cố 2026-09-04: màn trống mập mờ).
enum ChatListState { loading, error, notConfigured, empty, hasData }

/// Quyết định trạng thái hộp thư từ dữ liệu hiện có (thuần, để test được):
///  • loading        → đang tải danh sách
///  • error          → tải lỗi (auth/mạng…) → hiện lỗi + nút thử lại
///  • hasData        → có hội thoại
///  • notConfigured  → ĐÃ biết capabilities và KHÔNG kênh nào được kết nối
///  • empty          → có kênh nhưng chưa có hội thoại (hoặc chưa biết capabilities)
ChatListState chatListState({
  required bool loading,
  required bool hasError,
  required bool capsLoaded,
  required Map<String, dynamic> connectors,
  required int conversationCount,
}) {
  if (loading) return ChatListState.loading;
  if (hasError) return ChatListState.error;
  if (conversationCount > 0) return ChatListState.hasData;
  if (capsLoaded && connectors.isEmpty) return ChatListState.notConfigured;
  return ChatListState.empty;
}

/// Chat đa kênh (Dan-D Pak Omni) — hộp thư hội thoại. Hiện đọc + thao tác nội
/// bộ; gửi tin ra ngoài mở khi connector (Meta/Zalo/Shopee…) được cấp quyền.
class OnlineChatSection extends StatefulWidget {
  const OnlineChatSection({super.key});

  @override
  State<OnlineChatSection> createState() => _OnlineChatSectionState();
}

class _OnlineChatSectionState extends State<OnlineChatSection> {
  final SocketService _socket = SocketService();
  final Debouncer _refresh = Debouncer();
  final Debouncer _searchDebounce = Debouncer();
  final _search = TextEditingController();

  List<Map<String, dynamic>> _conversations = [];
  Map<String, dynamic> _capabilities = {};
  bool _capsLoaded = false;
  String _selectedId = '';
  Map<String, dynamic> _detail = {};
  List<Map<String, dynamic>> _messages = [];
  bool _unreadOnly = false;
  String _query = '';
  bool _loading = true;
  bool _loadingThread = false;
  bool _disposed = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _connect();
      _loadCaps();
      _load();
    });
  }

  void _connect() {
    final auth = context.read<AuthProvider>();
    _socket.connect(
        baseUrl: auth.serverUrl,
        branch: auth.selectedBranchId,
        token: auth.token ?? '');
    _socket.addListener(_onSocket);
  }

  void _onSocket(String event, dynamic payload) {
    if (_disposed || !mounted) return;
    if (event.startsWith('omni:')) {
      _refresh(() {
        if (!_disposed && mounted) {
          _load(silent: true);
          if (_selectedId.isNotEmpty) _openThread(_selectedId, silent: true);
        }
      });
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _refresh.dispose();
    _searchDebounce.dispose();
    _search.dispose();
    _socket.removeListener(_onSocket);
    super.dispose();
  }

  Future<void> _loadCaps() async {
    try {
      final c = await context.read<ApiService>().getOmniCapabilities();
      if (mounted) {
        setState(() {
          _capabilities = c;
          _capsLoaded = true;
        });
      }
    } catch (_) {
      // Không rõ có kênh nào được cấu hình hay không → giữ _capsLoaded=false để
      // KHÔNG khẳng định "chưa kết nối" (tránh thông báo sai).
    }
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);
    try {
      final res = await context.read<ApiService>().getOmniConversations(
            unread: _unreadOnly,
            q: _query,
            limit: 60,
          );
      if (!mounted) return;
      setState(() {
        _conversations = oList(res['rows']);
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

  Future<void> _openThread(String id, {bool silent = false}) async {
    if (!silent) setState(() => _loadingThread = true);
    _selectedId = id;
    try {
      final api = context.read<ApiService>();
      final detail = await api.getOmniConversation(id);
      final msgs = await api.getOmniMessages(id, limit: 80);
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _messages = msgs
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _loadingThread = false;
      });
      // Mark read
      if (oNum(detail['unread_count']) > 0) {
        await api.updateOmniConversation(id, {'mark_read': true});
        _load(silent: true);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingThread = false;
      });
      if (mounted) {
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final narrow = MediaQuery.sizeOf(context).width < 820;
    if (narrow && _selectedId.isNotEmpty) {
      return _threadPane(showBack: true);
    }
    return Row(
      children: [
        SizedBox(width: narrow ? double.infinity : 320, child: _listPane()),
        if (!narrow) ...[
          const VerticalDivider(width: 1, color: DanColors.border),
          Expanded(child: _threadPane()),
        ],
      ],
    );
  }

  Widget _listPane() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _search,
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: t('Tìm kiếm'),
                    prefixIcon: const Icon(Icons.search, size: 18),
                  ),
                  onChanged: (v) {
                    final q = v.trim();
                    _searchDebounce(() {
                      if (!mounted || q == _query) return;
                      setState(() => _query = q);
                      _load();
                    });
                  },
                ),
              ),
              IconButton(
                tooltip: t('Chưa đọc'),
                isSelected: _unreadOnly,
                onPressed: () {
                  setState(() => _unreadOnly = !_unreadOnly);
                  _load();
                },
                icon: const Icon(Icons.mark_email_unread_outlined),
              ),
            ],
          ),
        ),
        const Divider(height: 1, color: DanColors.border),
        Expanded(child: _list()),
      ],
    );
  }

  Widget _list() {
    final state = chatListState(
      loading: _loading,
      hasError: _error != null,
      capsLoaded: _capsLoaded,
      connectors: oMap(_capabilities['connectors']),
      conversationCount: _conversations.length,
    );
    switch (state) {
      case ChatListState.loading:
        return const Center(child: CircularProgressIndicator());
      case ChatListState.error:
        return Padding(
          padding: const EdgeInsets.all(24),
          child: InlineMessage(_error!, error: true, onRetry: _load),
        );
      case ChatListState.notConfigured:
        return OnlineEmpty(
          t('Chưa kết nối kênh chat nào — vào Cài đặt → Kết nối để thêm Facebook/Zalo/Shopee…'),
          icon: Icons.link_off);
      case ChatListState.empty:
        return OnlineEmpty(t('Chưa có hội thoại'), icon: Icons.forum_outlined);
      case ChatListState.hasData:
        break;
    }
    return ListView.separated(
      itemCount: _conversations.length,
      separatorBuilder: (_, __) =>
          const Divider(height: 1, color: DanColors.border),
      itemBuilder: (_, i) => _convTile(_conversations[i]),
    );
  }

  Widget _convTile(Map<String, dynamic> c) {
    final id = oStr(c['id']);
    final selected = id == _selectedId;
    final unread = oNum(c['unread_count']).toInt();
    final name = oStr(c['display_name']).isNotEmpty
        ? oStr(c['display_name'])
        : oStr(c['external_user_id']);
    final at = BusinessDateTime.parseApi(c['last_message_at']);
    return InkWell(
      onTap: () => _openThread(id),
      child: Container(
        color: selected ? DanColors.brandDim : null,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          children: [
            CircleAvatar(
              radius: 18,
              backgroundColor: providerMeta(oStr(c['provider']))
                  .color
                  .withValues(alpha: .15),
              child: Icon(providerMeta(oStr(c['provider'])).icon,
                  size: 16, color: providerMeta(oStr(c['provider'])).color),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Expanded(
                      child: Text(name.isEmpty ? t('Khách') : name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 13,
                              fontWeight: unread > 0
                                  ? FontWeight.w800
                                  : FontWeight.w600)),
                    ),
                    if (at != null)
                      Text(Fmt.hm(at),
                          style: const TextStyle(
                              fontSize: 10.5, color: DanColors.faint)),
                  ]),
                  const SizedBox(height: 2),
                  Text(oStr(c['last_message']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 12,
                          color:
                              unread > 0 ? DanColors.text : DanColors.faint)),
                ],
              ),
            ),
            if (unread > 0)
              Container(
                margin: const EdgeInsets.only(left: 6),
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                    color: DanColors.late,
                    borderRadius: BorderRadius.circular(9)),
                child: Text('$unread',
                    style: const TextStyle(
                        fontSize: 10,
                        color: Colors.white,
                        fontWeight: FontWeight.w800)),
              ),
          ],
        ),
      ),
    );
  }

  Widget _threadPane({bool showBack = false}) {
    if (_selectedId.isEmpty) {
      return OnlineEmpty(t('Chọn một hội thoại để bắt đầu'),
          icon: Icons.chat_bubble_outline);
    }
    if (_loadingThread) {
      return const Center(child: CircularProgressIndicator());
    }
    return Column(
      children: [
        _threadHeader(showBack),
        const Divider(height: 1, color: DanColors.border),
        Expanded(
          child: ListView.builder(
            reverse: false,
            padding: const EdgeInsets.all(16),
            itemCount: _messages.length,
            itemBuilder: (_, i) => _messageBubble(_messages[i]),
          ),
        ),
        _composer(),
      ],
    );
  }

  Widget _threadHeader(bool showBack) {
    final name = oStr(_detail['display_name']).isNotEmpty
        ? oStr(_detail['display_name'])
        : oStr(_detail['external_user_id']);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          if (showBack)
            IconButton(
                onPressed: () => setState(() => _selectedId = ''),
                icon: const Icon(Icons.arrow_back)),
          ProviderBadge(oStr(_detail['provider'])),
          const SizedBox(width: 10),
          Expanded(
            child: Text(name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style:
                    const TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
          ),
          OnlinePill(_statusLabel(oStr(_detail['status'])),
              _statusColor(oStr(_detail['status']))),
          PopupMenuButton<String>(
            onSelected: _onMenu,
            itemBuilder: (_) => [
              PopupMenuItem(value: 'open', child: Text(t('Đánh dấu Mở'))),
              PopupMenuItem(value: 'resolved', child: Text(t('Đã xử lý'))),
              PopupMenuItem(value: 'closed', child: Text(t('Đóng hội thoại'))),
              const PopupMenuDivider(),
              PopupMenuItem(value: 'note', child: Text(t('Ghi chú'))),
            ],
          ),
        ],
      ),
    );
  }

  String _statusLabel(String s) =>
      const {
        'open': 'Đang mở',
        'pending': 'Chờ',
        'resolved': 'Đã xử lý',
        'closed': 'Đã đóng',
      }[s] ??
      s;

  Color _statusColor(String s) =>
      const {
        'open': DanColors.doing,
        'pending': DanColors.doing,
        'resolved': DanColors.done,
        'closed': DanColors.muted,
      }[s] ??
      DanColors.muted;

  Future<void> _onMenu(String action) async {
    final api = context.read<ApiService>();
    try {
      if (action == 'note') {
        final ctrl = TextEditingController(text: oStr(_detail['note']));
        final ok = await showDialog<bool>(
          context: context,
          builder: (_) => AlertDialog(
            title: Text(t('Ghi chú hội thoại')),
            content: TextField(controller: ctrl, maxLines: 4),
            actions: [
              TextButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  child: Text(t('Đóng'))),
              FilledButton(
                  onPressed: () => Navigator.of(context).pop(true),
                  child: Text(t('Lưu'))),
            ],
          ),
        );
        if (ok == true) {
          await api
              .updateOmniConversation(_selectedId, {'note': ctrl.text.trim()});
        }
      } else {
        await api.updateOmniConversation(_selectedId, {'status': action});
      }
      await _openThread(_selectedId, silent: true);
      if (mounted) appToast(context, t('Đã cập nhật'));
    } catch (e) {
      if (mounted) {
        appToast(context, e.toString().replaceFirst('Exception: ', ''),
            isError: true);
      }
    }
  }

  Widget _messageBubble(Map<String, dynamic> m) {
    final outbound = oStr(m['direction']) == 'outbound';
    final at = BusinessDateTime.parseApi(m['sent_at']);
    return Align(
      alignment: outbound ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        constraints:
            BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * .5),
        decoration: BoxDecoration(
          color: outbound ? DanColors.brand : DanColors.surface2,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment:
              outbound ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            Text(oStr(m['body']),
                style: TextStyle(
                    fontSize: 13,
                    color: outbound ? Colors.white : DanColors.text)),
            if (at != null)
              Text(Fmt.hm(at),
                  style: TextStyle(
                      fontSize: 9.5,
                      color: outbound ? Colors.white70 : DanColors.faint)),
          ],
        ),
      ),
    );
  }

  Widget _composer() {
    // Gửi outbound cần connector sống. Cho tới lúc đó chỉ hiện trạng thái, không
    // giả vờ gửi được.
    final provider = oStr(_detail['provider']);
    final conn =
        oMap(oMap(_capabilities['connectors'])[_connectorKey(provider)]);
    final canSend = conn['outbound'] == true;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: DanColors.border)),
      ),
      child: canSend
          ? Row(children: [
              const Expanded(
                child: TextField(
                  decoration: InputDecoration(hintText: 'Nhập tin nhắn…'),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(onPressed: () {}, child: Text(t('Gửi'))),
            ])
          : Row(children: [
              const Icon(Icons.lock_outline, size: 16, color: DanColors.faint),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  t('Gửi tin ra kênh này mở khi connector được cấp quyền (${providerMeta(provider).name}).'),
                  style: const TextStyle(fontSize: 12, color: DanColors.faint),
                ),
              ),
            ]),
    );
  }

  String _connectorKey(String provider) {
    switch (provider) {
      case 'facebook':
        return 'facebook_messenger';
      case 'instagram':
        return 'instagram_messaging';
      case 'zalooa':
        return 'zalo_oa';
      case 'shopee':
        return 'shopee_shop';
      case 'tiktokshop':
        return 'tiktok_shop';
      case 'haravan':
        return 'harasocial_chat';
      default:
        return provider;
    }
  }
}
