import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const DandpakBackOfficeApp());
}

class DandpakBackOfficeApp extends StatelessWidget {
  const DandpakBackOfficeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Dan D Pak Back Office',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      darkTheme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF2F7D6B),
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: const Color(0xFF0F141C),
      ),
      home: const BackOfficeShell(),
    );
  }
}

class ApiClient {
  ApiClient({required String baseUrl, required this.token, required this.branchId})
      : baseUrl = _cleanBaseUrl(baseUrl);

  final String baseUrl;
  final String token;
  final String branchId;

  static String _cleanBaseUrl(String url) => url.trim().replaceFirst(RegExp(r'/$'), '');

  Map<String, String> get headers => {
        'Content-Type': 'application/json',
        'x-auth-token': token,
        'Authorization': 'Bearer $token',
        'x-branch-id': branchId,
      };

  static Future<List<Map<String, dynamic>>> branches(String baseUrl) async {
    final root = _cleanBaseUrl(baseUrl);
    final res = await http.get(Uri.parse('$root/api/branches')).timeout(const Duration(seconds: 6));
    if (res.statusCode != 200) throw Exception('Cannot load branches (${res.statusCode})');
    final data = jsonDecode(res.body);
    if (data is! List) return [];
    return data.map((e) => _asMap(e)).toList();
  }

  static Future<Map<String, dynamic>> login({
    required String baseUrl,
    required String username,
    required String pin,
    required String branchId,
  }) async {
    final root = _cleanBaseUrl(baseUrl);
    final res = await http
        .post(
          Uri.parse('$root/api/login'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'username': username, 'pin': pin, 'branch_id': branchId}),
        )
        .timeout(const Duration(seconds: 10));
    final data = jsonDecode(res.body);
    if (res.statusCode != 200 || data is! Map || data['token'] == null) {
      throw Exception(data is Map ? (data['error'] ?? data['message'] ?? 'Login failed') : 'Login failed');
    }
    return _asMap(data);
  }

  Future<dynamic> get(String path, {Map<String, String>? query}) async {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final res = await http.get(uri, headers: headers).timeout(const Duration(seconds: 12));
    final body = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      final msg = body is Map ? (body['error'] ?? body['message'] ?? body['code']) : null;
      throw Exception(msg ?? 'HTTP ${res.statusCode}');
    }
    return body;
  }
}

class BackOfficeShell extends StatefulWidget {
  const BackOfficeShell({super.key});

  @override
  State<BackOfficeShell> createState() => _BackOfficeShellState();
}

class _BackOfficeShellState extends State<BackOfficeShell> {
  final _baseUrl = TextEditingController(text: 'http://127.0.0.1:3000');
  final _username = TextEditingController();
  final _pin = TextEditingController();

  List<Map<String, dynamic>> _branches = [];
  String _branchId = 'br1';
  ApiClient? _client;
  Map<String, dynamic>? _user;
  int _selected = 0;
  int _refresh = 0;
  bool _loadingBranches = false;
  bool _loggingIn = false;
  String? _loginError;

  final modules = const [
    ModuleSpec('dashboard', 'Dashboard', Icons.space_dashboard_outlined),
    ModuleSpec('reports', 'Reports', Icons.query_stats_outlined),
    ModuleSpec('inventory', 'Inventory', Icons.inventory_2_outlined),
    ModuleSpec('contacts', 'Contacts', Icons.groups_2_outlined),
    ModuleSpec('purchase', 'Purchase', Icons.local_shipping_outlined),
    ModuleSpec('expenses', 'Expenses', Icons.receipt_long_outlined),
    ModuleSpec('invoices', 'Invoices', Icons.description_outlined),
    ModuleSpec('documents', 'Documents', Icons.folder_copy_outlined),
  ];

  @override
  void initState() {
    super.initState();
    _loadBranches();
  }

  @override
  void dispose() {
    _baseUrl.dispose();
    _username.dispose();
    _pin.dispose();
    super.dispose();
  }

  Future<void> _loadBranches() async {
    setState(() {
      _loadingBranches = true;
      _loginError = null;
    });
    try {
      final branches = await ApiClient.branches(_baseUrl.text);
      setState(() {
        _branches = branches;
        if (branches.isNotEmpty) _branchId = (branches.first['id'] ?? 'br1').toString();
      });
    } catch (e) {
      setState(() => _loginError = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loadingBranches = false);
    }
  }

  Future<void> _login() async {
    setState(() {
      _loggingIn = true;
      _loginError = null;
    });
    try {
      final session = await ApiClient.login(
        baseUrl: _baseUrl.text,
        username: _username.text.trim(),
        pin: _pin.text.trim(),
        branchId: _branchId,
      );
      setState(() {
        _client = ApiClient(baseUrl: _baseUrl.text, token: session['token'].toString(), branchId: _branchId);
        _user = _asMap(session['user']);
        _pin.clear();
      });
    } catch (e) {
      setState(() => _loginError = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loggingIn = false);
    }
  }

  void _logout() {
    setState(() {
      _client = null;
      _user = null;
      _selected = 0;
    });
  }

  @override
  Widget build(BuildContext context) {
    final client = _client;
    if (client == null) {
      return LoginView(
        baseUrl: _baseUrl,
        username: _username,
        pin: _pin,
        branches: _branches,
        branchId: _branchId,
        loadingBranches: _loadingBranches,
        loggingIn: _loggingIn,
        error: _loginError,
        onBranchChanged: (value) => setState(() => _branchId = value),
        onReloadBranches: _loadBranches,
        onLogin: _login,
      );
    }

    final active = modules[_selected];
    return Scaffold(
      body: Row(
        children: [
          Container(
            width: 260,
            color: const Color(0xFF151B23),
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 26, 20, 18),
                  child: Row(
                    children: [
                      const Icon(Icons.admin_panel_settings_outlined, color: Color(0xFF2F7D6B), size: 30),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Dan D Pak', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                            Text('Back Office', style: TextStyle(color: Colors.white.withOpacity(0.55), fontSize: 12)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: RepaintBoundary(
                    child: ListView.builder(
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      itemCount: modules.length,
                      itemBuilder: (context, index) {
                        final item = modules[index];
                        final activeItem = index == _selected;
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 3),
                          child: ListTile(
                            selected: activeItem,
                            selectedTileColor: const Color(0xFF2F7D6B).withOpacity(0.14),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                            leading: Icon(item.icon, color: activeItem ? const Color(0xFF49D3A4) : Colors.white54),
                            title: Text(
                              item.label,
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                color: activeItem ? Colors.white : Colors.white70,
                              ),
                            ),
                            onTap: () => setState(() => _selected = index),
                          ),
                        );
                      },
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        (_user?['name'] ?? _user?['username'] ?? 'Signed in').toString(),
                        style: const TextStyle(fontWeight: FontWeight.w800),
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Text(client.branchId, style: TextStyle(color: Colors.white.withOpacity(0.45), fontSize: 12)),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: _logout,
                        icon: const Icon(Icons.logout, size: 18),
                        label: const Text('Logout'),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: RepaintBoundary(
              child: Column(
                children: [
                  Container(
                    height: 68,
                    padding: const EdgeInsets.symmetric(horizontal: 22),
                    decoration: BoxDecoration(
                      color: const Color(0xFF111821),
                      border: Border(bottom: BorderSide(color: Colors.white.withOpacity(0.06))),
                    ),
                    child: Row(
                      children: [
                        Icon(active.icon, color: const Color(0xFF49D3A4)),
                        const SizedBox(width: 12),
                        Text(active.label, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                        const Spacer(),
                        IconButton.filledTonal(
                          tooltip: 'Refresh',
                          onPressed: () => setState(() => _refresh++),
                          icon: const Icon(Icons.refresh),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: ModulePage(
                      key: ValueKey('${active.id}-$_refresh-${client.branchId}'),
                      spec: active,
                      client: client,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class LoginView extends StatelessWidget {
  const LoginView({
    super.key,
    required this.baseUrl,
    required this.username,
    required this.pin,
    required this.branches,
    required this.branchId,
    required this.loadingBranches,
    required this.loggingIn,
    required this.error,
    required this.onBranchChanged,
    required this.onReloadBranches,
    required this.onLogin,
  });

  final TextEditingController baseUrl;
  final TextEditingController username;
  final TextEditingController pin;
  final List<Map<String, dynamic>> branches;
  final String branchId;
  final bool loadingBranches;
  final bool loggingIn;
  final String? error;
  final ValueChanged<String> onBranchChanged;
  final VoidCallback onReloadBranches;
  final VoidCallback onLogin;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: Container(
            padding: const EdgeInsets.all(26),
            decoration: BoxDecoration(
              color: const Color(0xFF151B23),
              border: Border.all(color: Colors.white.withOpacity(0.08)),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Dan D Pak Back Office', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
                const SizedBox(height: 24),
                TextField(
                  controller: baseUrl,
                  decoration: InputDecoration(
                    labelText: 'Server URL',
                    suffixIcon: IconButton(
                      tooltip: 'Load branches',
                      onPressed: loadingBranches ? null : onReloadBranches,
                      icon: loadingBranches
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.sync),
                    ),
                  ),
                  onSubmitted: (_) => onReloadBranches(),
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  value: branches.any((b) => b['id']?.toString() == branchId) ? branchId : null,
                  items: branches
                      .map(
                        (b) => DropdownMenuItem(
                          value: (b['id'] ?? '').toString(),
                          child: Text((b['name'] ?? b['id'] ?? '').toString()),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) onBranchChanged(value);
                  },
                  decoration: const InputDecoration(labelText: 'Branch'),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: username,
                  decoration: const InputDecoration(labelText: 'Username'),
                  textInputAction: TextInputAction.next,
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: pin,
                  decoration: const InputDecoration(labelText: 'PIN'),
                  obscureText: true,
                  keyboardType: TextInputType.number,
                  onSubmitted: (_) => onLogin(),
                ),
                if (error != null) ...[
                  const SizedBox(height: 12),
                  Text(error!, style: const TextStyle(color: Color(0xFFFF7A7A), fontWeight: FontWeight.w700)),
                ],
                const SizedBox(height: 22),
                FilledButton.icon(
                  onPressed: loggingIn ? null : onLogin,
                  icon: loggingIn
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.login),
                  label: const Text('Login'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class ModuleSpec {
  const ModuleSpec(this.id, this.label, this.icon);

  final String id;
  final String label;
  final IconData icon;
}

class ModulePage extends StatefulWidget {
  const ModulePage({super.key, required this.spec, required this.client});

  final ModuleSpec spec;
  final ApiClient client;

  @override
  State<ModulePage> createState() => _ModulePageState();
}

class _ModulePageState extends State<ModulePage> {
  String _reportType = 'sales_overview';
  late Future<dynamic> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<dynamic> _load() async {
    switch (widget.spec.id) {
      case 'dashboard':
        return widget.client.get('/api/dashboard');
      case 'reports':
        final catalog = await widget.client.get('/api/reports/catalog');
        final reports = catalog is Map && catalog['reports'] is List ? catalog['reports'] as List : [];
        if (reports.isNotEmpty && !reports.any((r) => r is Map && r['key'] == _reportType)) {
          _reportType = (reports.first as Map)['key'].toString();
        }
        final preview = await widget.client.get('/api/reports/preview', query: {'type': _reportType});
        return {'catalog': catalog, 'preview': preview};
      case 'inventory':
        final values = await Future.wait([
          widget.client.get('/api/warehouses'),
          widget.client.get('/api/inventory'),
          widget.client.get('/api/skus'),
          widget.client.get('/api/warehouse/lots'),
          widget.client.get('/api/movements', query: {'limit': '80'}),
        ]);
        return {
          'Warehouses': values[0],
          'Ingredients': values[1],
          'Retail SKUs': values[2],
          'Lots': values[3],
          'Movements': values[4],
        };
      case 'contacts':
        return widget.client.get('/api/partners');
      case 'purchase':
        return widget.client.get('/api/purchase');
      case 'expenses':
        return widget.client.get('/api/expenses');
      case 'invoices':
        return widget.client.get('/api/invoices');
      case 'documents':
        return widget.client.get('/api/documents/files');
      default:
        return {};
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<dynamic>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return Center(
            child: Container(
              width: 520,
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: const Color(0xFF241A1A),
                border: Border.all(color: const Color(0xFFFF7A7A).withOpacity(0.35)),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                snapshot.error.toString().replaceFirst('Exception: ', ''),
                style: const TextStyle(color: Color(0xFFFFB0B0), fontWeight: FontWeight.w700),
              ),
            ),
          );
        }
        final data = snapshot.data;
        if (widget.spec.id == 'dashboard') return DashboardPanel(data: data);
        if (widget.spec.id == 'reports') {
          return ReportsPanel(
            data: _asMap(data),
            reportType: _reportType,
            onChanged: (type) {
              setState(() {
                _reportType = type;
                _future = _load();
              });
            },
          );
        }
        if (widget.spec.id == 'inventory' && data is Map) {
          return InventoryPanel(sections: data.map((key, value) => MapEntry(key.toString(), value)));
        }
        return Padding(
          padding: const EdgeInsets.all(18),
          child: DataSection(title: widget.spec.label, data: data),
        );
      },
    );
  }
}

class DashboardPanel extends StatelessWidget {
  const DashboardPanel({super.key, required this.data});

  final dynamic data;

  @override
  Widget build(BuildContext context) {
    final map = _asMap(data);
    final metrics = [
      Metric('Revenue', _firstValue(map, ['revenue', 'today_revenue', 'total_revenue', 'sales'])),
      Metric('Bills', _firstValue(map, ['bills', 'orders', 'order_count', 'paid_orders'])),
      Metric('Open Orders', _firstValue(map, ['openOrders', 'open_orders', 'open'])),
      Metric('Low Stock', _firstValue(map, ['lowStock', 'low_stock', 'alerts'])),
    ];
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: metrics.map((m) => MetricTile(metric: m)).toList(),
        ),
        const SizedBox(height: 18),
        DataSection(title: 'Dashboard Payload', data: data),
      ],
    );
  }
}

class ReportsPanel extends StatelessWidget {
  const ReportsPanel({super.key, required this.data, required this.reportType, required this.onChanged});

  final Map<String, dynamic> data;
  final String reportType;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final catalog = _asMap(data['catalog']);
    final reports = catalog['reports'] is List ? catalog['reports'] as List : [];
    final selectedValue = reports.any((r) => r is Map && r['key']?.toString() == reportType) ? reportType : null;
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: SizedBox(
            width: 360,
            child: DropdownButtonFormField<String>(
              value: selectedValue,
              items: reports
                  .whereType<Map>()
                  .map(
                    (r) => DropdownMenuItem(
                      value: (r['key'] ?? '').toString(),
                      child: Text((r['label'] ?? r['key'] ?? '').toString(), overflow: TextOverflow.ellipsis),
                    ),
                  )
                  .toList(),
              onChanged: (value) {
                if (value != null) onChanged(value);
              },
              decoration: const InputDecoration(labelText: 'Report'),
            ),
          ),
        ),
        const SizedBox(height: 18),
        DataSection(title: 'Preview', data: data['preview']),
      ],
    );
  }
}

class InventoryPanel extends StatelessWidget {
  const InventoryPanel({super.key, required this.sections});

  final Map<String, dynamic> sections;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        for (final entry in sections.entries) ...[
          DataSection(title: entry.key, data: entry.value),
          const SizedBox(height: 18),
        ],
      ],
    );
  }
}

class DataSection extends StatelessWidget {
  const DataSection({super.key, required this.title, required this.data});

  final String title;
  final dynamic data;

  @override
  Widget build(BuildContext context) {
    final rows = _rows(data);
    final columns = _columns(rows);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF151B23),
        border: Border.all(color: Colors.white.withOpacity(0.07)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
              const SizedBox(width: 10),
              Text('${rows.length} rows', style: TextStyle(color: Colors.white.withOpacity(0.45), fontSize: 12)),
            ],
          ),
          const SizedBox(height: 12),
          if (rows.isEmpty)
            Text('No data', style: TextStyle(color: Colors.white.withOpacity(0.45)))
          else
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                headingRowHeight: 36,
                dataRowMinHeight: 38,
                dataRowMaxHeight: 56,
                columns: columns.map((c) => DataColumn(label: Text(c))).toList(),
                rows: rows.take(80).map((row) {
                  return DataRow(
                    cells: columns
                        .map(
                          (c) => DataCell(
                            ConstrainedBox(
                              constraints: const BoxConstraints(maxWidth: 240),
                              child: Text(_pretty(row[c]), maxLines: 2, overflow: TextOverflow.ellipsis),
                            ),
                          ),
                        )
                        .toList(),
                  );
                }).toList(),
              ),
            ),
        ],
      ),
    );
  }
}

class Metric {
  const Metric(this.label, this.value);
  final String label;
  final dynamic value;
}

class MetricTile extends StatelessWidget {
  const MetricTile({super.key, required this.metric});

  final Metric metric;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 220,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF151B23),
        border: Border.all(color: Colors.white.withOpacity(0.07)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(metric.label, style: TextStyle(color: Colors.white.withOpacity(0.55), fontSize: 12, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text(_pretty(metric.value), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
        ],
      ),
    );
  }
}

Map<String, dynamic> _asMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, val) => MapEntry(key.toString(), val));
  return {};
}

List<Map<String, dynamic>> _rows(dynamic data) {
  dynamic source = data;
  if (source is Map) {
    for (final key in ['rows', 'items', 'data', 'partners', 'orders', 'expenses', 'invoices', 'files', 'documents', 'skus', 'inventory']) {
      if (source[key] is List) {
        source = source[key];
        break;
      }
    }
    if (source is Map) {
      source = source.entries.map((e) => {'key': e.key.toString(), 'value': e.value}).toList();
    }
  }
  if (source is List) {
    return source.map((item) {
      if (item is Map) return item.map((key, value) => MapEntry(key.toString(), value));
      return {'value': item};
    }).toList();
  }
  if (source == null) return [];
  return [{'value': source}];
}

List<String> _columns(List<Map<String, dynamic>> rows) {
  final keys = <String>[];
  for (final row in rows.take(12)) {
    for (final key in row.keys) {
      if (!keys.contains(key) && _isDisplayable(row[key])) keys.add(key);
      if (keys.length >= 7) return keys;
    }
  }
  return keys.isEmpty ? ['value'] : keys;
}

bool _isDisplayable(dynamic value) => value == null || value is String || value is num || value is bool;

dynamic _firstValue(Map<String, dynamic> map, List<String> keys) {
  for (final key in keys) {
    if (map.containsKey(key)) return map[key];
  }
  return '-';
}

String _pretty(dynamic value) {
  if (value == null) return '-';
  if (value is num) {
    if (value % 1 == 0) return value.toInt().toString();
    return value.toStringAsFixed(2);
  }
  if (value is bool) return value ? 'Yes' : 'No';
  if (value is Map || value is List) return jsonEncode(value);
  final text = value.toString();
  return text.isEmpty ? '-' : text;
}
