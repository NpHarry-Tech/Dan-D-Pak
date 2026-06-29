import 'package:flutter/foundation.dart';
import 'package:dandpak_core/dandpak_core.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/pos_models.dart';
import '../services/api_service.dart';

class AuthProvider extends ChangeNotifier {
  final ApiService apiService;
  
  bool _isLoading = false;
  String _serverUrl = DanDpakDefaults.baseUrl;
  String _selectedBranchId = DanDpakDefaults.branchId;
  User? _currentUser;
  String? _token;

  AuthProvider({required this.apiService}) {
    _loadPreferences();
  }

  bool get isLoading => _isLoading;
  bool get isLoggedIn => _token != null && _currentUser != null;
  String get serverUrl => _serverUrl;
  String get selectedBranchId => _selectedBranchId;
  User? get currentUser => _currentUser;
  String? get token => _token;

  Future<void> _loadPreferences() async {
    final prefs = await SharedPreferences.getInstance();
    _serverUrl = prefs.getString('server_url') ?? DanDpakDefaults.baseUrl;
    _selectedBranchId = prefs.getString('branch_id') ?? DanDpakDefaults.branchId;
    _token = prefs.getString('auth_token');
    
    apiService.setBaseUrl(_serverUrl);
    apiService.setToken(_token);

    if (_token != null) {
      try {
        final me = await apiService.getMe();
        _currentUser = User.fromJson(me);
      } catch (e) {
        print("Failed to auto-login: $e");
        _token = null;
        apiService.setToken(null);
      }
    }
    notifyListeners();
  }

  Future<void> updateServerUrl(String url) async {
    _serverUrl = url;
    apiService.setBaseUrl(url);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('server_url', url);
    notifyListeners();
  }

  Future<void> login(String username, String pin, String branchId) async {
    _isLoading = true;
    notifyListeners();

    try {
      final res = await apiService.login(username, pin, branchId);
      _token = res['token'];
      _currentUser = User.fromJson(res['user']);
      _selectedBranchId = branchId;

      apiService.setToken(_token);

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('auth_token', _token!);
      await prefs.setString('branch_id', branchId);

      _isLoading = false;
      notifyListeners();
    } catch (e) {
      _isLoading = false;
      notifyListeners();
      rethrow;
    }
  }

  Future<void> logout() async {
    _isLoading = true;
    notifyListeners();

    try {
      await apiService.logout();
    } catch (_) {}

    _token = null;
    _currentUser = null;
    apiService.setToken(null);

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('auth_token');

    _isLoading = false;
    notifyListeners();
  }
}
