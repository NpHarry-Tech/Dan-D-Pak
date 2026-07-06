// lib/main.dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/app_provider.dart';
import 'providers/auth_provider.dart';
import 'providers/ordering_provider.dart';
import 'screens/connection_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AppProvider()),
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => OrderingProvider()),
      ],
      child: const DandpakTabletApp(),
    ),
  );
}

class DandpakTabletApp extends StatelessWidget {
  const DandpakTabletApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Dan D Pak Tablet App',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      darkTheme: ThemeData(
        brightness: Brightness.dark,
        useMaterial3: true,
        primaryColor: const Color(0xFF2F7D6B),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF2F7D6B),
          brightness: Brightness.dark,
          primary: const Color(0xFF2F7D6B),
          background: const Color(0xFF0F141C),
          surface: const Color(0xFF161D26),
        ),
        scaffoldBackgroundColor: const Color(0xFF0F141C),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF161C23),
          elevation: 0,
          titleTextStyle: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: Colors.white,
          ),
          iconTheme: IconThemeData(color: Colors.white),
        ),
        cardTheme: const CardThemeData(
          color: Color(0xFF1C2430),
          elevation: 4,
        ),
      ),
      home: const ConnectionScreen(),
    );
  }
}
