import 'package:flutter/foundation.dart';
import 'package:dandpak_core/dandpak_core.dart';
import '../models/pos_models.dart';
import '../services/api_service.dart';
import '../services/app_log.dart';
import '../services/local_store.dart';
import '../services/node_runner.dart';
import '../services/socket_service.dart';
import '../services/system_log.dart';

class AuthProvider extends ChangeNotifier {
  final ApiService apiService;

  bool _isLoading = false;
  bool _booting = true;
  bool _branchConfirmed = false;
  String _serverUrl = DanDpakDefaults.baseUrl;
  String _selectedBranchId = DanDpakDefaults.branchId;
  User? _currentUser;
  String? _token;
  List<Branch> _branches = [];
  List<User> _loginUsers = [];

  AuthProvider({required this.apiService}) {
    _loadPreferences();
  }

  bool get isLoading => _isLoading;
  bool get booting => _booting;
  bool get branchConfirmed => _branchConfirmed;
  bool get isLoggedIn => _token != null && _currentUser != null;
  String get serverUrl => _serverUrl;
  String get selectedBranchId => _selectedBranchId;
  User? get currentUser => _currentUser;
  String? get token => _token;
  List<Branch> get branches => _branches;
  List<User> get loginUsers => _loginUsers;
  Branch get selectedBranch => _branches.firstWhere(
        (b) => b.id == _selectedBranchId,
        orElse: () => Branch(
            id: _selectedBranchId,
            name: _selectedBranchId,
            code: _selectedBranchId,
            address: ''),
      );

  Future<void> _loadPreferences() async {
    _booting = true;
    try {
      final prefs = LocalStore.instance;
      _serverUrl =
          await prefs.getString('server_url') ?? DanDpakDefaults.baseUrl;
      _selectedBranchId =
          await prefs.getString('branch_id') ?? DanDpakDefaults.branchId;
      _token = await prefs.getString('auth_token');

      apiService.setBaseUrl(_serverUrl);
      apiService.setToken(_token);
      apiService.setBranchId(_selectedBranchId);
      // Server boots in the background; wait for it before the first calls so we
      // don't race an un-booted engine (branch list / auto-login would fail).
      await NodeRunner.ready;
      try {
        await loadBranches(silent: true);
      } catch (e) {
        dlog("Failed to load branches at startup: $e");
      }

      if (_token != null) {
        try {
          final me = await apiService.getMe();
          _currentUser = User.fromJson(me);
        } catch (e) {
          dlog("Failed to auto-login: $e");
          _token = null;
          apiService.setToken(null);
        }
      }
      _syncLogContext();
    } finally {
      _booting = false;
      notifyListeners();
    }
  }

  Future<void> loadBranches({bool silent = false}) async {
    if (!silent) {
      _isLoading = true;
      notifyListeners();
    }
    try {
      final rows = await apiService.getBranches();
      _branches = rows
          .whereType<Map>()
          .map((b) => Branch.fromJson(Map<String, dynamic>.from(b)))
          .toList();
      if (_branches.isNotEmpty &&
          !_branches.any((b) => b.id == _selectedBranchId)) {
        _selectedBranchId = _branches.first.id;
        apiService.setBranchId(_selectedBranchId);
        await LocalStore.instance.setString('branch_id', _selectedBranchId);
      }
    } finally {
      if (!silent) {
        _isLoading = false;
        notifyListeners();
      }
    }
  }

  Future<void> loadLoginUsers() async {
    _isLoading = true;
    notifyListeners();
    try {
      apiService.setBranchId(_selectedBranchId);
      final rows = await apiService.getUsers();
      _loginUsers = rows
          .whereType<Map>()
          .map((u) => User.fromJson(Map<String, dynamic>.from(u)))
          .toList();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> updateServerUrl(String url) async {
    _serverUrl = url;
    apiService.setBaseUrl(url);
    final prefs = LocalStore.instance;
    await prefs.setString('server_url', url);
    notifyListeners();
  }

  Future<void> selectBranch(String branchId) async {
    _selectedBranchId = branchId;
    apiService.setBranchId(branchId);
    await LocalStore.instance.setString('branch_id', branchId);
    notifyListeners();
    await loadLoginUsers();
  }

  /// Xác nhận cơ sở đã chọn -> chuyển sang màn đăng nhập.
  void confirmBranch() {
    _branchConfirmed = true;
    notifyListeners();
  }

  /// Quay lại màn chọn cơ sở (nút "Đổi cơ sở").
  void changeBranch() {
    _branchConfirmed = false;
    notifyListeners();
  }

  Future<void> login(String username, String pin, String branchId) async {
    _isLoading = true;
    notifyListeners();

    try {
      final res = await apiService.login(username, pin, branchId);
      _token = res['token'];
      // Server trả `perms` ở NGOÀI object `user` (publicUser không nhúng quyền).
      // Gộp vào trước khi parse để hasPermission() hoạt động ngay sau đăng nhập
      // — nếu không, mọi tài khoản (trừ owner) sẽ như KHÔNG có quyền nào.
      final userJson = Map<String, dynamic>.from(res['user'] as Map);
      if (res['perms'] is List) userJson['perms'] = res['perms'];
      _currentUser = User.fromJson(userJson);
      _selectedBranchId = branchId;

      apiService.setToken(_token);
      apiService.setBranchId(branchId);
      _syncLogContext();

      final prefs = LocalStore.instance;
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

  /// Mọi dòng nhật ký hệ thống từ giờ mang đúng user/chi nhánh hiện tại.
  void _syncLogContext() {
    SystemLog.setContext(
      user: _currentUser?.username ?? '',
      uid: _currentUser?.id ?? '',
      branch: _selectedBranchId,
      branchLabel: selectedBranch.name,
    );
  }

  Future<void> logout({bool keepBranch = false}) async {
    _isLoading = true;
    notifyListeners();

    try {
      await apiService.logout();
    } catch (_) {}

    _token = null;
    _currentUser = null;
    _branchConfirmed = keepBranch;
    apiService.setToken(null);
    SocketService().logoutDisconnect();
    _syncLogContext();

    final prefs = LocalStore.instance;
    await prefs.remove('auth_token');

    _isLoading = false;
    notifyListeners();
  }

  bool hasPermission(String? permission) {
    if (permission == null || permission.isEmpty) return true;
    final user = _currentUser;
    if (user == null) return false;
    if (user.role == 'owner') return true;
    return user.permissions.contains('*') ||
        user.permissions.contains(permission);
  }
}
