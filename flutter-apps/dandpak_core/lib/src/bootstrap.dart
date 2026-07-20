import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:media_kit/media_kit.dart';
import 'package:provider/provider.dart';
import 'package:local_notifier/local_notifier.dart';

import 'app_flavor.dart';
import 'primitives.dart';
import 'providers/auth_provider.dart';
import 'providers/customer_display_controller.dart';
import 'providers/pos_provider.dart';
import 'screens/branch_select_screen.dart';
import 'screens/customer_display/second_screen.dart';
import 'screens/launcher_screen.dart';
import 'services/second_window_fullscreen.dart';
import 'screens/login_gate_screen.dart';
import 'screens/splash_screen.dart';
import 'services/api_service.dart';
import 'services/black_box.dart';
import 'services/client_log.dart';
import 'services/connectivity_status.dart';
import 'services/local_store.dart';
import 'services/perf_mode.dart';
import 'services/system_log.dart';
import 'services/node_runner.dart';
import 'ui/app_theme.dart';
import 'widgets/window_controls.dart';

final Map<String, DateTime> _lastApiNetworkLogs = <String, DateTime>{};

Future<bool> _shouldRunLocalEngine() async {
  if (Platform.isAndroid || Platform.isIOS) return false;
  try {
    final saved = await LocalStore.instance.getString('server_url');
    final url = (saved == null || saved.trim().isEmpty)
        ? DanDpakDefaults.baseUrl
        : saved.trim();
    final host =
        Uri.tryParse(DanDpakApiClient.normalizeBaseUrl(url))?.host ?? '';
    return host.isEmpty || host == '127.0.0.1' || host == 'localhost';
  } catch (_) {
    return true;
  }
}

Future<void> runDandpakApp({
  required List<String> args,
  required AppFlavor flavor,
}) async {
  AppFlavor.current = flavor;

  await runZonedGuarded(() async {
    await _mainImpl(args);
  }, (error, stack) {
    ClientLog.report(error, stack, context: 'zone');
  });
}

Future<void> _mainImpl(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();

  if (Platform.isWindows) {
    try {
      await localNotifier.setup(
        appName: 'Dan D Pak POS',
      );
    } catch (_) {}
  }

  // desktop_multi_window launches the 2nd display window as a fresh engine
  // running this same main() with ['multi_window', windowId, args]. That window

  // over the plugin channel.
  if (args.isNotEmpty && args.first == 'multi_window') {
    BlackBox.init(role: 'display');
    runApp(CustomerDisplayWindowApp());
    return;
  }

  // Initialise the inline audio engine (used to preview/play notification
  // sounds). Guarded so a platform without the native libs can't block boot.
  try {
    MediaKit.ensureInitialized();
  } catch (_) {}

  final localEngine = await _shouldRunLocalEngine();
  if (localEngine) {
    // window paints in <1s. The first API calls await NodeRunner.ready.
    NodeRunner.startServer();

    DanDpakApiClient.onConnectionRefused = NodeRunner.recover;
  }

  final apiService = ApiService();
  // Every uncaught error is shipped to the local engine's log stream
  // (POST /api/client-log) so client + server logs live in one place.
  ClientLog.attach(apiService);
  ClientLog.installGlobalHooks();

  SystemLog.attach(apiService);
  _logUpdateSuccessIfJustUpdated();

  PerfMode.init();

  BlackBox.init(role: 'main', api: apiService);
  DanDpakApiClient.onRequestTrace = (line) => BlackBox.add('api', line);

  DanDpakApiClient.correlationIdProvider = SystemLog.currentCorrelationId;

  DanDpakApiClient.onApiResult = (t) {
    ConnectivityStatus.instance.onApiTrace(t);
    if (t.networkIssue) {
      if (t.path.startsWith('/api/system-logs') ||
          t.path.startsWith('/api/client-log')) {
        return;
      }
      if (t.method == 'GET') return;
      final eventType =
          t.exceptionType == 'TimeoutException' ? 'api_timeout' : 'api_offline';
      final key = '$eventType:${t.method}:${t.path}';
      final now = DateTime.now();
      final last = _lastApiNetworkLogs[key];
      if (last != null && now.difference(last).inSeconds < 60) return;
      _lastApiNetworkLogs[key] = now;
      SystemLog.log(
        level: 'warn',
        source: 'flutter_app',
        eventType: eventType,
        title: 'Không gọi được ${t.method} ${t.path}',
        message: t.error ?? '',
        endpoint: t.path,
        method: t.method,
        statusCode: 0,
        durationMs: t.durationMs,
        correlationId: t.correlationId,
        exceptionType: t.exceptionType,
      );
    }
    // Lỗi thao tác của người dùng KHÔNG bắc cầu ở đây để tránh TRÙNG: mọi lỗi hiển
    // thị đều đã đi qua appToast(isError:true) (thay cho "label đỏ" cũ) → 1 thông báo.
  };
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

Future<void> _logUpdateSuccessIfJustUpdated() async {
  try {
    final build = AppFlavor.current.buildNumber;
    final versionName = AppFlavor.current.versionName;
    final prev = await LocalStore.instance.getString('last_run_build');
    if (prev == '$build') return;
    final prevBuild = int.tryParse(prev ?? '');
    if (prevBuild == null) {
      await LocalStore.instance.setString('last_run_build', '$build');
      return;
    }
    if (build < prevBuild) {
      SystemLog.log(
        level: 'warn',
        source: 'updater',
        eventType: 'old_build_started',
        title:
            'Đang mở bản cũ: build $build thấp hơn build đã chạy $prevBuild ($versionName)',
        message:
            'Có thể đang mở nhầm shortcut/exe cũ. Không hạ mốc cập nhật đã lưu',
        action: 'app_update',
      );
      return;
    }
    await LocalStore.instance.setString('last_run_build', '$build');
    SystemLog.log(
      level: 'info',
      source: 'updater',
      eventType: 'update_success',
      title: 'Cập nhật thành công: build $prev -> $build ($versionName)',
      action: 'app_update',
    );
  } catch (_) {/* không chặn boot */}
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

      if (!hasSecondMonitor()) return;
      await SecondScreen.instance.open(display).catchError((_) {});
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.detached) {
      BlackBox.markCleanExit();
      NodeRunner.stopServer();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    BlackBox.markCleanExit();
    NodeRunner.stopServer();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: PerfMode.lowEnd,
      builder: (context, lowEnd, _) => _buildApp(lowEnd),
    );
  }

  Widget _buildApp(bool lowEnd) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      // Messenger toàn cục để AppNotifier hiện banner thông báo trong-app trên MỌI màn.
      scaffoldMessengerKey: appMessengerKey,
      title: 'Dan D Pak POS',
      theme: DanTheme.light(lowEnd: lowEnd),
      builder: (context, child) {
        final mq = MediaQuery.of(context);
        return MediaQuery(
          data: mq.copyWith(textScaler: TextScaler.noScaling),
          child: Listener(
            behavior: HitTestBehavior.translucent,
            onPointerDown: (e) => BlackBox.add('tap',
                '(${e.position.dx.toStringAsFixed(0)},${e.position.dy.toStringAsFixed(0)})'),
            child: WindowChrome(
              child: SafeArea(
                top: false,
                child: child ?? const SizedBox(),
              ),
            ),
          ),
        );
      },
      home: Consumer<AuthProvider>(
        builder: (context, auth, _) {
          if (!auth.booting) {
            _queueSavedSecondaryDisplayOpen(auth.selectedBranchId);
          }
          if (auth.booting) return SplashScreen();
          if (auth.isLoggedIn) return LauncherScreen();
          if (!auth.branchConfirmed) return BranchSelectScreen();
          return LoginGateScreen();
        },
      ),
    );
  }
}
