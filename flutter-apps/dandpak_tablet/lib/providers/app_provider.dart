// lib/providers/app_provider.dart
import 'package:dandpak_core/dandpak_core.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/tablet_models.dart';
import '../services/api_service.dart';
import '../services/discovery_service.dart';

class AppProvider with ChangeNotifier {
  String _serverUrl = DanDpakDefaults.baseUrl;
  bool _isConnected = false;
  bool _isScanning = false;
  String _scanProgressText = '';
  List<Branch> _branches = [];
  Branch? _activeBranch;
  Warehouse? _activeWarehouse;

  String get serverUrl => _serverUrl;
  bool get isConnected => _isConnected;
  bool get isScanning => _isScanning;
  String get scanProgressText => _scanProgressText;
  List<Branch> get branches => _branches;
  Branch? get activeBranch => _activeBranch;
  Warehouse? get activeWarehouse => _activeWarehouse;

  AppProvider() {
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    final String defaultUrl = kIsWeb ? Uri.base.origin : DanDpakDefaults.baseUrl;
    _serverUrl = prefs.getString('server_url') ?? defaultUrl;
    final savedBranchId = prefs.getString('active_branch_id');
    final savedBranchName = prefs.getString('active_branch_name');
    if (savedBranchId != null && savedBranchName != null) {
      _activeBranch = Branch(id: savedBranchId, name: savedBranchName);
    }
    notifyListeners();
    // Test initial connection
    testConnection();
  }

  Future<void> saveServerUrl(String url) async {
    _serverUrl = url.trim().replaceAll(RegExp(r'/+$'), '');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('server_url', _serverUrl);
    notifyListeners();
    await testConnection();
  }

  Future<void> setActiveBranch(Branch branch) async {
    _activeBranch = branch;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('active_branch_id', branch.id);
    await prefs.setString('active_branch_name', branch.name);
    notifyListeners();
  }

  void setActiveWarehouse(Warehouse warehouse) {
    _activeWarehouse = warehouse;
    notifyListeners();
  }

  Future<bool> testConnection() async {
    try {
      _branches = await ApiService.fetchBranches(_serverUrl);
      _isConnected = true;
      if (_activeBranch != null && !_branches.any((b) => b.id == _activeBranch!.id)) {
        _activeBranch = null;
      }
      if (_activeBranch == null && _branches.isNotEmpty) {
        await setActiveBranch(_branches.first);
      }
      notifyListeners();
      return true;
    } catch (_) {
      _isConnected = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> startAutoDiscovery() async {
    _isScanning = true;
    _scanProgressText = 'Bắt đầu quét mạng LAN...';
    notifyListeners();

    final result = await DiscoveryService.discoverServer(
      onProgress: (currentIp) {
        _scanProgressText = 'Đang ping: $currentIp...';
        notifyListeners();
      },
    );

    _isScanning = false;
    if (result != null) {
      _scanProgressText = 'Đã tìm thấy máy chủ: $result';
      await saveServerUrl(result);
    } else {
      _scanProgressText = 'Không tìm thấy máy chủ nào trong mạng LAN.';
    }
    notifyListeners();
  }
}
