// GENERATED SPLIT of contacts_screen.dart — màn liên hệ cũ + tag/avatar (part of, cùng library).
part of 'contacts_screen.dart';

class _LegacyContactsScreen extends StatefulWidget {
  _LegacyContactsScreen();

  @override
  State<_LegacyContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<_LegacyContactsScreen> {
  List<Map<String, dynamic>> _partners = [];
  Map<String, dynamic> _counts = {};
  String _type = 'all';
  String _search = '';
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await context
          .read<ApiService>()
          .getPartners(type: _type, q: _search.trim());
      if (!mounted) return;
      setState(() {
        _partners = (res['partners'] is List)
            ? (res['partners'] as List)
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : [];
        _counts = res['counts'] is Map
            ? Map<String, dynamic>.from(res['counts'])
            : {};
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

  Future<void> _openForm([Map<String, dynamic>? partner]) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) =>
          _PartnerForm(api: context.read<ApiService>(), partner: partner),
    );
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentUser;
    final branch = auth.selectedBranch;

    return Scaffold(
      backgroundColor: DanColors.bg,
      appBar: DanModuleTopBar(
        brandName: branch.name.isNotEmpty ? branch.name : branch.id,
        title: t('Liên hệ'),
        subtitle: '',
        titleIcon: Icons.groups_2_outlined,
        userName: user?.name ?? '—',
        userRole: roleLabel(user?.role ?? ''),
        online: true,
        onBack: () => Navigator.of(context).maybePop(),
        onLogout: () => auth.logout(),
        actions: [
          DanTopBarButton(
            onPressed: () => _openForm(),
            icon: Icons.person_add_alt,
            label: t('Thêm liên hệ'),
          ),
        ],
      ),
      body: Column(
        children: [
          _filterBar(),
          Divider(height: 1, color: DanColors.border),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _filterBar() {
    return Container(
      color: DanColors.surface,
      padding: EdgeInsets.all(14),
      child: Row(
        children: [
          for (final t in _types) ...[
            ChoiceChip(
              label: Text(
                  t[0] == 'all' ? t[1] : '${t[1]} (${_counts[t[0]] ?? 0})'),
              selected: _type == t[0],
              onSelected: (_) {
                setState(() => _type = t[0]);
                _load();
              },
            ),
            SizedBox(width: 8),
          ],
          SizedBox(width: 4),
          Expanded(
            child: TextField(
              decoration: InputDecoration(
                  hintText: t('Tìm theo tên, SĐT, MST…'),
                  prefixIcon: Icon(Icons.search),
                  isDense: true),
              onChanged: (v) => _search = v,
              onSubmitted: (_) => _load(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading && _partners.isEmpty) {
      return Center(child: CircularProgressIndicator());
    }
    if (_error != null && _partners.isEmpty) {
      return Padding(
        padding: EdgeInsets.all(40),
        child: InlineMessage(t('Không tải được danh bạ ($_error)'),
            error: true, onRetry: _load),
      );
    }
    if (_partners.isEmpty) {
      return Center(
          child: Text(t('Chưa có liên hệ nào'),
              style: TextStyle(color: DanColors.faint)));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: EdgeInsets.all(16),
        itemCount: _partners.length,
        separatorBuilder: (_, __) => SizedBox(height: 8),
        itemBuilder: (_, i) => _row(_partners[i]),
      ),
    );
  }

  Widget _row(Map<String, dynamic> c) {
    final isCustomer = _b(c['is_customer']);
    final isSupplier = _b(c['is_supplier']);
    final orders = _n(c['total_orders']);
    final spent = _n(c['total_spent']);
    return InkWell(
      onTap: () => _openForm(c),
      borderRadius: BorderRadius.circular(DanRadius.md),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: DanColors.surface,
          border: Border.all(color: DanColors.border),
          borderRadius: BorderRadius.circular(DanRadius.md),
        ),
        child: Row(
          children: [
            _ContactAvatar(
              name: _s(c['name']),
              avatar: _s(c['avatar']),
              baseUrl: context.read<ApiService>().baseUrl,
            ),
            SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(_s(c['name']),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 14.5, fontWeight: FontWeight.w800)),
                      ),
                      if (isCustomer) ...[
                        SizedBox(width: 6),
                        _Tag(t('Khách'), DanColors.brand),
                      ],
                      if (isSupplier) ...[
                        SizedBox(width: 6),
                        _Tag('NCC', Color(0xFFB45309)),
                      ],
                    ],
                  ),
                  SizedBox(height: 2),
                  Text(
                    [
                      if (_s(c['phone']).isNotEmpty) _s(c['phone']),
                      if (_s(c['company']).isNotEmpty) _s(c['company']),
                    ].join('  ·  '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12, color: DanColors.faint),
                  ),
                ],
              ),
            ),
            if (isCustomer && orders > 0)
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(t('${Fmt.int0(orders)} đơn'),
                      style:
                          TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                  Text(Fmt.money(spent),
                      style: TextStyle(
                          fontSize: 12,
                          color: DanColors.brand,
                          fontWeight: FontWeight.w800)),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  final String label;
  final Color color;
  _Tag(this.label, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
          color: color.withValues(alpha: .13),
          borderRadius: BorderRadius.circular(5)),
      child: Text(label,
          style: TextStyle(
              fontSize: 10.5, fontWeight: FontWeight.w800, color: color)),
    );
  }
}

class _ContactAvatar extends StatelessWidget {
  final String name;
  final String avatar;
  final String baseUrl;
  final double radius;

  _ContactAvatar({
    required this.name,
    required this.avatar,
    required this.baseUrl,
    this.radius = 20,
  });

  @override
  Widget build(BuildContext context) {
    final fallback = CircleAvatar(
      radius: radius,
      backgroundColor: DanColors.brandDim,
      child: Text(
        (name.isNotEmpty ? name[0] : '?').toUpperCase(),
        style: TextStyle(
          color: DanColors.brand,
          fontWeight: FontWeight.w900,
          fontSize: radius * .72,
        ),
      ),
    );
    if (avatar.trim().isEmpty) return fallback;

    return ClipOval(
      child: Image.network(
        _assetUrl(baseUrl, avatar),
        width: radius * 2,
        height: radius * 2,
        fit: BoxFit.cover,
        // Avatar-size decode: contact lists can be long.
        cacheWidth: (radius * 4).round(),
        filterQuality: FilterQuality.low,
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) => fallback,
      ),
    );
  }
}

