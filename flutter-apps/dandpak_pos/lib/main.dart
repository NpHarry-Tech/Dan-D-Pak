import 'package:dandpak_core/dandpak_core.dart';
import 'package:flutter/material.dart';
import 'package:media_kit/media_kit.dart';
import 'package:provider/provider.dart';

import 'providers/auth_provider.dart';
import 'providers/customer_display_controller.dart';
import 'providers/pos_provider.dart';
import 'screens/branch_select_screen.dart';
import 'screens/customer_display/second_screen.dart';
import 'screens/launcher_screen.dart';
import 'screens/login_gate_screen.dart';
import 'screens/splash_screen.dart';
import 'services/api_service.dart';
import 'services/client_log.dart';
import 'services/node_runner.dart';
import 'ui/app_theme.dart';
import 'widgets/window_controls.dart';

Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();

  // desktop_multi_window launches the 2nd display window as a fresh engine
  // running this same main() with ['multi_window', windowId, args]. That window
  // is a thin display — no Node engine, no provider tree, just the screen fed
  // over the plugin channel.
  if (args.isNotEmpty && args.first == 'multi_window') {
    runApp(const CustomerDisplayWindowApp());
    return;
  }

  // Initialise the inline audio engine (used to preview/play notification
  // sounds). Guarded so a platform without the native libs can't block boot.
  try {
    MediaKit.ensureInitialized();
  } catch (_) {}
  // Start the bundled Node engine in the BACKGROUND — do not await, so the
  // window paints in <1s. The first API calls await NodeRunner.ready.
  NodeRunner.startServer();
  // Tự cứu "connection refused": engine chết/chưa chạy → API client gọi hook
  // này để hồi sinh Node rồi retry request trong suốt (an toàn vì refused =
  // request chưa hề tới server). Kèm watchdog 10s trong NodeRunner.
  DanDpakApiClient.onConnectionRefused = NodeRunner.recover;

  final apiService = ApiService();
  // Every uncaught error is shipped to the local engine's log stream
  // (POST /api/client-log) so client + server logs live in one place.
  ClientLog.attach(apiService);
  ClientLog.installGlobalHooks();
  runApp(
    MultiProvider(
      providers: [
        Provider<ApiService>.value(value: apiService),
        ChangeNotifierProvider(
            create: (_) => AuthProvider(apiService: apiService)),
        ChangeNotifierProvider(
            create: (_) => PosProvider(apiService: apiService)),
        // Drives the secondary display; mirrors the live cart.
        ChangeNotifierProxyProvider<PosProvider, CustomerDisplayController>(
          create: (_) => CustomerDisplayController(api: apiService),
          update: (_, pos, ctrl) =>
              (ctrl ?? CustomerDisplayController(api: apiService))..attach(pos),
        ),
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

class _DandpakPosAppState extends State<DandpakPosApp>
    with WidgetsBindingObserver {
  bool _secondaryDisplayAutoOpenQueued = false;
  String? _secondaryDisplayAutoOpenBranch;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  void _queueSavedSecondaryDisplayOpen(String branchId) {
    if (_secondaryDisplayAutoOpenQueued) return;
    if (_secondaryDisplayAutoOpenBranch == branchId) return;
    _secondaryDisplayAutoOpenQueued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      final display = context.read<CustomerDisplayController>();
      await NodeRunner.ready;
      await display.loadConfig();
      if (!mounted) return;
      _secondaryDisplayAutoOpenQueued = false;
      _secondaryDisplayAutoOpenBranch = branchId;
      if (!display.enabled) return;
      await SecondScreen.instance.open(display).catchError((_) {});
    });
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
      theme: DanTheme.light(),
      builder: (context, child) =>
          WindowChrome(child: child ?? const SizedBox()),
      home: Consumer<AuthProvider>(
        builder: (context, auth, _) {
          if (!auth.booting) {
            _queueSavedSecondaryDisplayOpen(auth.selectedBranchId);
          }
          if (auth.booting) return const SplashScreen();
          if (auth.isLoggedIn) return const LauncherScreen();
          if (!auth.branchConfirmed) return const BranchSelectScreen();
          return const LoginGateScreen();
        },
      ),
    );
  }
}
