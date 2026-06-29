import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'providers/auth_provider.dart';
import 'providers/pos_provider.dart';
import 'screens/login_screen.dart';
import 'screens/pos_screen.dart';
import 'services/api_service.dart';
import 'services/node_runner.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await NodeRunner.startServer();

  final apiService = ApiService();
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider(apiService: apiService)),
        ChangeNotifierProvider(create: (_) => PosProvider(apiService: apiService)),
      ],
      child: const DandpakPosApp(),
    ),
  );
}

class DandpakPosApp extends StatefulWidget {
  const DandpakPosApp({super.key});

  @override
  State<DandpakPosApp> createState() => _DandpakPosAppState();
}

class _DandpakPosAppState extends State<DandpakPosApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.detached) {
      NodeRunner.stopServer();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    NodeRunner.stopServer();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Dan D Pak POS',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFD9A441),
          brightness: Brightness.dark,
        ),
      ),
      home: Consumer<AuthProvider>(
        builder: (context, auth, _) {
          if (auth.isLoggedIn) return const PosScreen();
          return const LoginScreen();
        },
      ),
    );
  }
}
