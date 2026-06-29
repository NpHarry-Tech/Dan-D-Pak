// lib/providers/auth_provider.dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/tablet_models.dart';
import '../services/api_service.dart';

class AuthProvider with ChangeNotifier {
  String? _token;
  User? _currentUser;
  bool _busy = false;
  String? _error;

  String? get token => _token;
  User? get currentUser => _currentUser;
  bool get isAuthenticated => _token != null && _currentUser != null;
  bool get busy => _busy;
  String? get error => _error;

  AuthProvider() {
    _loadSession();
  }

  Future<void> _loadSession() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('auth_token');
    final savedUserJson = prefs.getString('auth_user');
    if (savedUserJson != null) {
      try {
        _currentUser = User.fromJson(jsonDecode(savedUserJson));
      } catch (_) {
        _token = null;
        _currentUser = null;
      }
    }
    notifyListeners();
  }

  Future<bool> login(String baseUrl, String username, String pin, String branchId) async {
    _busy = true;
    _error = null;
    notifyListeners();

    try {
      final res = await ApiService.login(baseUrl, username, pin, branchId);
      _token = res['token'] as String;
      _currentUser = User.fromJson(res['user']);

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('auth_token', _token!);
      await prefs.setString('auth_user', jsonEncode(res['user']));
      
      _busy = false;
      notifyListeners();
      return true;
    } catch (e) {
      _error = e.toString().replaceFirst('Exception: ', '');
      _busy = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> logout() async {
    _token = null;
    _currentUser = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('auth_token');
    await prefs.remove('auth_user');
    notifyListeners();
  }

  bool hasPermission(String perm) {
    if (_currentUser == null) return false;
    return _currentUser!.hasPerm(perm);
  }
}
