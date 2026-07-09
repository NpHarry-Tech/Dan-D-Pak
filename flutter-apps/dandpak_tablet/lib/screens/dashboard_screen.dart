// lib/screens/dashboard_screen.dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_provider.dart';
import '../providers/auth_provider.dart';
import 'connection_screen.dart';
import 'kds_module/kds_screen.dart';
import 'ordering_module/order_screen.dart';
import 'inventory_module/inventory_screen.dart';
import 'self_order_module/self_order_welcome_screen.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  int _selectedIndex = 0;

  final List<Widget> _views = [
    const OrderScreen(),
    const KdsScreen(),
    const InventoryScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final appProv = Provider.of<AppProvider>(context);
    final authProv = Provider.of<AuthProvider>(context);

    // If session expired or logged out, go to connection or login screen
    if (!authProv.isAuthenticated) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const ConnectionScreen()),
        );
      });
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final userName = (authProv.currentUser?.name ?? '').trim();
    final userInitial = userName.isNotEmpty ? userName.substring(0, 1).toUpperCase() : 'U';

    return Scaffold(
      body: Row(
        children: [
          // Left Custom Sidebar
          Container(
            width: 250,
            color: const Color(0xFFFFFFFF),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Branding Header
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 30),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: const Color(0xFF0891B2).withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Icon(Icons.tablet, color: Color(0xFF0891B2), size: 24),
                      ),
                      const SizedBox(width: 12),
                      const Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'DAN D PAK',
                            style: TextStyle(color: Color(0xFF1A2230), fontWeight: FontWeight.bold, fontSize: 16, letterSpacing: 1),
                          ),
                          Text(
                            'Tablet Native',
                            style: TextStyle(color: Color(0xFF677084), fontSize: 11),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                // Branch context pill
                if (appProv.activeBranch != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF3F5F7),
                        border: Border.all(color: const Color(0xFFD3D8DF)),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.store, color: Color(0xFF677084), size: 16),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              appProv.activeBranch!.name,
                              style: const TextStyle(color: Color(0xFF1A2230), fontSize: 12, fontWeight: FontWeight.bold),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: 20),
                // Navigation items
                _sidebarItem(0, 'Gọi món / Order', Icons.restaurant_menu),
                _sidebarItem(1, 'Màn hình Bếp (KDS)', Icons.kitchen),
                _sidebarItem(2, 'Quản lý Kho', Icons.inventory_2),
                // iPad Self-order: giao tablet cho KHÁCH tự gọi món — mở
                // toàn màn hình màn /ipad web sẵn có (kiosk; nhân viên thoát
                // bằng 5 chạm góc trên-trái).
                Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  child: ListTile(
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8)),
                    leading: const Icon(Icons.touch_app_outlined,
                        color: Color(0xFF677084), size: 20),
                    title: const Text(
                      'iPad Self-order (Khách)',
                      style: TextStyle(
                        color: Color(0xFF1A2230),
                        fontSize: 13.5,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    onTap: () {
                      Navigator.of(context).push(MaterialPageRoute(
                        fullscreenDialog: true,
                        builder: (_) => SelfOrderWelcomeScreen(
                          serverUrl: appProv.serverUrl,
                          branchId: appProv.activeBranch?.id,
                          staffToken: authProv.token,
                        ),
                      ));
                    },
                  ),
                ),
                const Spacer(),
                // User details
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  child: Row(
                    children: [
                      CircleAvatar(
                        backgroundColor: const Color(0xFF0891B2),
                        radius: 16,
                        child: Text(
                          userInitial,
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              authProv.currentUser?.name ?? 'Nhân viên',
                              style: const TextStyle(color: Color(0xFF1A2230), fontSize: 13, fontWeight: FontWeight.bold),
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              authProv.currentUser?.username ?? 'user',
                              style: const TextStyle(color: Color(0xFF677084), fontSize: 11),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                // Logout Action
                ListTile(
                  leading: const Icon(Icons.logout, color: Color(0xFFFF7A7A), size: 20),
                  title: const Text('Đăng xuất', style: TextStyle(color: Color(0xFFFF7A7A), fontSize: 13, fontWeight: FontWeight.bold)),
                  onTap: authProv.logout,
                ),
                const SizedBox(height: 12),
              ],
            ),
          ),
          // Vertical Splitter line
          const VerticalDivider(color: Color(0xFFE7EAEE), width: 1),
          // Right Views viewport
          Expanded(
            child: _views[_selectedIndex],
          ),
        ],
      ),
    );
  }

  Widget _sidebarItem(int index, String title, IconData icon) {
    final active = _selectedIndex == index;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: ListTile(
        selected: active,
        selectedTileColor: const Color(0xFF0891B2).withValues(alpha: 0.12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        leading: Icon(icon, color: active ? const Color(0xFF0891B2) : const Color(0xFF677084), size: 20),
        title: Text(
          title,
          style: TextStyle(
            color: active ? const Color(0xFF0891B2) : const Color(0xFF1A2230),
            fontSize: 13.5,
            fontWeight: FontWeight.bold,
          ),
        ),
        onTap: () {
          setState(() {
            _selectedIndex = index;
          });
        },
      ),
    );
  }
}
