import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import '../primitives.dart';
import '../models/pos_models.dart';
import '../services/api_service.dart';
import '../services/app_log.dart';
import '../services/hardware_agent_launcher.dart';
import '../services/local_store.dart';
import '../services/node_runner.dart';
import '../services/socket_service.dart';
import '../services/system_log.dart';
import '../utils/translation.dart';

class AuthProvider extends ChangeNotifier {
  /// Máy để bàn tại quầy (Windows/macOS/Linux) — KHÔNG giữ phiên qua các lần mở
  /// app. Web/tablet/KDS thì giữ như cũ. Đặt riêng một cờ để chỗ lưu và chỗ đọc
  /// token dùng CHUNG một quy tắc, tránh lệch nhau.
  static bool get _desktopRequiresFreshLogin {
    if (kIsWeb) return false;
    return Platform.isWindows || Platform.isMacOS || Platform.isLinux;
  }

  final ApiService apiService;

  bool _isLoading = false;
  bool _booting = true;
  bool _branchConfirmed = false;
  String _serverUrl = DanDpakDefaults.baseUrl;
  String _selectedBranchId = DanDpakDefaults.branchId;
  String _language = 'vi';
  User? _currentUser;
  String? _token;
  List<Branch> _branches = [];
  List<User> _loginUsers = [];
  // Server báo tài khoản vừa đăng nhập còn dùng PIN mặc định (owner/1234) →
  // app phải ép đổi PIN NGAY trước khi cho dùng tiếp (chặn ở login gate).
  bool _mustChangePin = false;

  AuthProvider({required this.apiService}) {
    _loadPreferences();
  }

  bool get isLoading => _isLoading;
  bool get booting => _booting;
  bool get branchConfirmed => _branchConfirmed;
  bool get isLoggedIn => _token != null && _currentUser != null;
  String get serverUrl => _serverUrl;
  String get selectedBranchId => _selectedBranchId;
  String get language => _language;
  User? get currentUser => _currentUser;
  String? get token => _token;
  bool get mustChangePin => _mustChangePin;
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
      final savedServerUrl = await prefs.getString('server_url');
      final savedHost =
          Uri.tryParse(DanDpakApiClient.normalizeBaseUrl(savedServerUrl ?? ''))
              ?.host;
      _serverUrl = savedServerUrl == null ||
              savedServerUrl.trim().isEmpty ||
              savedHost == '127.0.0.1' ||
              savedHost == 'localhost' ||
              savedHost == '42.96.18.70'
          ? DanDpakDefaults.baseUrl
          : savedServerUrl;
      if (_serverUrl != savedServerUrl) {
        await prefs.setString('server_url', _serverUrl);
      }
      _selectedBranchId =
          await prefs.getString('branch_id') ?? DanDpakDefaults.branchId;
      _setLanguage(await prefs.getString('app_lang') ?? 'vi', notify: false);
      // MÁY DESKTOP TẠI QUẦY: đóng hẳn app rồi mở lại thì PHẢI đăng nhập lại.
      // Máy quầy dùng chung nhiều ca, giữ phiên qua các lần khởi động đồng nghĩa
      // người mở app sau đang thao tác dưới danh nghĩa người ca trước. Chi nhánh
      // vẫn nhớ (đọc ở trên) nên thu ngân chỉ phải chọn tên + nhập PIN.
      // Tablet/KDS thì giữ nguyên: chúng là màn treo tường, bắt đăng nhập lại sau
      // mỗi lần chớp điện sẽ làm gián đoạn bếp.
      if (_desktopRequiresFreshLogin) {
        await prefs.remove('auth_token');
        _token = null;
      } else {
        _token = await prefs.getString('auth_token');
      }

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
          _setLanguage(_currentUser!.lang, notify: false);
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

  Future<void> setLoginLanguage(String lang) async {
    _setLanguage(lang);
    await LocalStore.instance.setString('app_lang', _language);
  }

  Future<void> login(String username, String pin, String branchId,
      {String? preferredLang}) async {
    _isLoading = true;
    notifyListeners();

    try {
      final res = await apiService.login(username, pin, branchId);
      _token = res['token'];
      _mustChangePin = res['security_warning'] == 'default_admin_pin';
      // Server trả `perms` ở NGOÀI object `user` (publicUser không nhúng quyền).
      // Gộp vào trước khi parse để hasPermission() hoạt động ngay sau đăng nhập
      // — nếu không, mọi tài khoản (trừ owner) sẽ như KHÔNG có quyền nào.
      final userJson = Map<String, dynamic>.from(res['user'] as Map);
      if (res['perms'] is List) userJson['perms'] = res['perms'];
      _currentUser = User.fromJson(userJson);
      _selectedBranchId = branchId;

      apiService.setToken(_token);
      apiService.setBranchId(branchId);
      if (preferredLang != null &&
          L10n.clean(preferredLang) != _currentUser!.lang) {
        final updated = await apiService.updateMyLanguage(preferredLang);
        _currentUser = User.fromJson({
          ...Map<String, dynamic>.from(updated),
          if (res['perms'] is List) 'perms': res['perms'],
        });
      }
      _setLanguage(_currentUser!.lang, notify: false);
      _syncLogContext();

      final prefs = LocalStore.instance;
      // Desktop: token chỉ sống trong bộ nhớ của phiên chạy này — đóng app là mất,
      // mở lại phải đăng nhập. Xem _desktopRequiresFreshLogin.
      if (_desktopRequiresFreshLogin) {
        await prefs.remove('auth_token');
      } else {
        await prefs.setString('auth_token', _token!);
      }
      await prefs.setString('branch_id', branchId);
      await prefs.setString('app_lang', _language);

      // Máy Windows tại quầy: tự khởi động ngầm Hardware Agent (không cửa sổ)
      // dùng LUÔN tài khoản/PIN vừa đăng nhập — để server (đặt trên VPS) in
      // được lên máy in/két/máy quẹt thẻ cắm tại quầy. Tự bỏ qua nếu bản build
      // này không kèm agent hoặc không phải Windows.
      HardwareAgentLauncher.spawnIfNeeded(
        centralUrl: _serverUrl,
        username: username,
        pin: pin,
        branchId: branchId,
      );

      _isLoading = false;
      notifyListeners();
    } catch (e) {
      _isLoading = false;
      notifyListeners();
      rethrow;
    }
  }

  /// Đổi PIN của chính mình (dùng cho luồng ép-đổi PIN mặc định lần đầu). Xóa cờ
  /// [mustChangePin] khi thành công để login gate cho đi tiếp.
  Future<void> changeOwnPin(String currentPin, String newPin) async {
    await apiService.changeMyPin(currentPin, newPin);
    _mustChangePin = false;
    notifyListeners();
  }

  void _setLanguage(String lang, {bool notify = true}) {
    _language = L10n.clean(lang);
    L10n.setLocale(_language);
    if (notify) notifyListeners();
  }

  /// Mọi dòng nhật ký hệ thống từ giờ mang đúng user/chi nhánh hiện tại.
  void _syncLogContext() {
    SystemLog.setContext(
      user: _currentUser?.username ?? '',
      uid: _currentUser?.id ?? '',
      branch: _selectedBranchId,
      branchLabel: selectedBranch.name,
    );
    // Vai trò máy này → định tuyến thông báo nghiệp vụ đúng người (Cài đặt → Thông báo).
    SocketService().currentUserRole = _currentUser?.role ?? '';
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
