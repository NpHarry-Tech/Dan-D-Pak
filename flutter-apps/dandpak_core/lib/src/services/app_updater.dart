import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

import '../app_flavor.dart';
import 'api_service.dart';
import 'app_notifier.dart';
import 'app_log.dart';
import 'black_box.dart';
import 'local_store.dart';
import 'pending_update.dart';
import 'release_scope.dart';
import 'system_log.dart';

/// Thông tin một bản cập nhật khả dụng trên server.
class UpdateInfo {
  final int buildNumber;
  final String version;
  final String notes;
  final String url; // đường dẫn tương đối, vd /api/app/download/windows
  final bool mandatory;
  final String scopeKey;
  final String serverOrigin;
  const UpdateInfo({
    required this.buildNumber,
    required this.version,
    required this.notes,
    required this.url,
    required this.mandatory,
    required this.scopeKey,
    required this.serverOrigin,
  });
}

/// Auto-update: hỏi server có bản mới hơn bản đang chạy không, tải về và cài.
///
/// - Windows (desktop): tải setup.exe → chạy IM LẶNG → thoát app để installer
///   cài đè (cùng AppId nên NÂNG CẤP TẠI CHỖ, giữ dữ liệu, xong tự mở lại app).
/// - Android: tải apk → FileProvider → mở trình cài đặt hệ thống; lần đầu có
///   thể phải cấp quyền "Cài ứng dụng từ nguồn này" (app tự dẫn tới màn đó).
class AppUpdater {
  static final Set<String> _notifiedBuilds = {};
  static final ValueNotifier<int> contextRevision = ValueNotifier<int>(0);

  /// Nền tảng gửi cho server. iOS/khác → null (chưa hỗ trợ tự cập nhật).
  ///
  /// ĐIỆN THOẠI VÀ TABLET LÀ HAI BẢN KHÁC NHAU, phải có khe phát hành riêng.
  /// Trước đây cả hai đều báo 'android' nên dùng chung một khe: publish bản này
  /// là đè bản kia, và máy tablet có thể tải nhầm APK điện thoại.
  ///
  /// Tablet GIỮ NGUYÊN 'android' — đổi khe của tablet thì mọi máy đang chạy sẽ
  /// hỏi một khe chưa có gì và im lặng không thấy bản cập nhật nào nữa.
  static String? get _platform {
    if (Platform.isWindows) return 'windows';
    if (Platform.isAndroid) {
      return AppFlavor.current.isHandset ? 'android-phone' : 'android';
    }
    return null;
  }

  /// Trả về bản cập nhật nếu server có build MỚI HƠN bản đang chạy, else null.
  static Future<UpdateInfo?> checkForUpdate(
    ApiService api, {
    String? platformOverride,
    int? currentBuildOverride,
  }) async {
    final platform = platformOverride ?? _platform;
    if (platform == null) return null;
    final scope = ReleaseScope.forServer(api.baseUrl, platform);
    final currentBuild = currentBuildOverride ?? AppFlavor.current.buildNumber;
    try {
      final decoded = await api.getJson(
        '/api/app/version?platform=$platform',
        errorMessage: 'Không kiểm tra được cập nhật',
      );
      if (decoded is! Map) return null;
      final build = (decoded['buildNumber'] as num?)?.toInt() ?? 0;
      final available = decoded['available'] == true;
      final url = (decoded['url'] ?? '').toString();
      // The request may have completed after the operator switched server.
      // Never apply Review data to the now-active Production context.
      if (ReleaseScope.forServer(api.baseUrl, platform).key != scope.key) {
        return null;
      }
      // Cache is scoped telemetry/restart context, never the source of the
      // current decision. Do not make UI correctness depend on disk latency.
      final cacheManifest = Map<dynamic, dynamic>.from(decoded);
      if (!isDownloadUrlSafeForScope(url, scope)) cacheManifest['url'] = '';
      unawaited(_persistManifest(scope, cacheManifest).catchError((Object e) {
        dlog('khong luu duoc release cache da scope (bo qua): $e');
      }));
      final decision = evaluateRelease(
        currentBuild: currentBuild,
        serverBuild: build,
        serverMandatory: decoded['mandatory'] == true,
      );
      if (!available ||
          !decision.updateAvailable ||
          !isDownloadUrlSafeForScope(url, scope)) {
        return null;
      }
      final info = UpdateInfo(
        buildNumber: build,
        version: (decoded['version'] ?? '').toString(),
        notes: (decoded['notes'] ?? '').toString(),
        url: url,
        mandatory: decision.mandatoryGate,
        scopeKey: scope.key,
        serverOrigin: scope.serverOrigin,
      );
      // Gửi thông báo là VIỆC PHỤ — không được để nó nuốt mất bản cập nhật.
      // Trước đây lời gọi này nằm thẳng trong try chung: máy nào chặn quyền
      // thông báo, hoặc plugin lỗi, là cả hàm rơi vào catch và trả null — người
      // dùng không bao giờ thấy có bản mới, mà nhật ký cũng chỉ ghi một dòng
      // "checkForUpdate failed" chẳng liên quan gì tới cập nhật.
      // CÓ HẠN GIỜ, không chỉ try/catch: kênh thông báo của hệ điều hành có thể
      // KHÔNG ném lỗi mà treo luôn — lúc đó cả hàm đứng im, màn Cập nhật kẹt mãi
      // ở "Đang kiểm tra..." và người dùng không bao giờ thấy nút tải.
      // Notification is a side effect. It must never delay the update decision
      // or leave the mandatory-update UI stuck in "checking".
      unawaited(_notifyAvailableOnce(info)
          .timeout(const Duration(seconds: 3))
          .catchError((Object e) {
        dlog('khong gui duoc thong bao cap nhat (bo qua): $e');
      }));
      return info;
    } catch (e) {
      dlog('checkForUpdate failed: $e');
      return null; // im lặng — cập nhật không bao giờ được cản trở bán hàng
    }
  }

  static String notificationBody(UpdateInfo info, {String? localeName}) {
    final version = info.version.isEmpty ? '${info.buildNumber}' : info.version;
    return (localeName ?? Platform.localeName).toLowerCase().startsWith('vi')
        ? 'Phần mềm hiện tại có bản cập nhật mới số "$version", hãy vào app để cập nhật ngay lập tức.'
        : 'A new software update "$version" is available. Open the app to update now.';
  }

  static Future<void> _notifyAvailableOnce(UpdateInfo info) async {
    final notificationIdentity = '${info.scopeKey}|${info.buildNumber}';
    if (!_notifiedBuilds.add(notificationIdentity)) return;
    try {
      final scope = ReleaseScope.forServer(
        info.serverOrigin,
        info.scopeKey.split('|').last,
      );
      final key = scope.storageKey('notified_build');
      final store = LocalStore.instance;
      if (await store.getString(key) == '${info.buildNumber}') return;
      await store.setString(key, '${info.buildNumber}');
      AppNotifier.show(
        title: 'Dan-D Pak POS',
        body: notificationBody(info),
        inApp: false,
        androidNotify: true,
      );
    } catch (_) {/* thông báo không được làm hỏng kiểm tra cập nhật */}
  }

  /// Tải bản cài về rồi khởi chạy. Trả lỗi (String) nếu thất bại, null nếu OK
  /// (khi OK, với Windows app sẽ tự thoát để installer cài đè).
  static Future<String?> downloadAndInstall(
      ApiService api, UpdateInfo info) async {
    final platform = _platform;
    if (platform == null) return 'Nền tảng này chưa hỗ trợ tự cập nhật';
    final activeScope = ReleaseScope.forServer(api.baseUrl, platform);
    if (activeScope.key != info.scopeKey ||
        activeScope.serverOrigin != info.serverOrigin ||
        !isDownloadUrlSafeForScope(info.url, activeScope)) {
      return 'Máy chủ đã thay đổi. Hãy kiểm tra lại bản cập nhật từ máy chủ hiện tại.';
    }
    try {
      final bytes = await api.getBytes(
        _downloadPath(info.url),
        timeout: const Duration(minutes: 8),
        errorMessage: 'Tải bản cập nhật thất bại',
      );
      if (bytes.isEmpty) return 'Bản cập nhật tải về rỗng';

      // Bám vào HỆ ĐIỀU HÀNH, không so chuỗi nền tảng: khe phát hành của điện
      // thoại là 'android-phone', so `== 'android'` sẽ trượt và app tải bản .apk
      // về rồi đặt tên .exe, lưu sai thư mục, cài không nổi.
      final ext = Platform.isAndroid ? 'apk' : 'exe';
      // Android: PHẢI nằm trong getCacheDir() (path_provider) vì FileProvider
      // chỉ chia sẻ được cache-path (systemTemp trỏ vào code_cache — không share
      // được). Dùng thư mục cố định để bản sau ghi đè bản trước, không rác máy.
      final base = Platform.isAndroid
          ? (await getTemporaryDirectory()).path
          : Directory.systemTemp.path;
      final dir = Directory('${Directory(base).path}/dandpak_update/'
          '${_safeScopeDirectory(activeScope)}')
        ..createSync(recursive: true);
      final file = File('${dir.path}/dan-d-pak-update.$ext');
      await file.writeAsBytes(bytes, flush: true);

      // §2 — lưu marker BỀN VỮNG ngay trước khi chạy installer để lần khởi động
      // đầu sau cập nhật (sau đăng nhập) đối chiếu build thật rồi ghi ĐÚNG một dòng
      // "Cập nhật thành công" vào Nhật ký hoạt động (không ghi nếu thực tế chưa lên).
      await PendingUpdate.mark(
        oldBuild: AppFlavor.current.buildNumber,
        expectedBuild: info.buildNumber,
        version: info.version,
      );

      if (platform == 'windows') {
        // Cài IM LẶNG: không wizard, tự dùng lại thư mục cài cũ
        // (UsePreviousAppDir=yes), cài xong tự mở lại app ([Run] postinstall).
        // Thoát app NGAY sau khi khởi chạy để không khoá file .exe đang chạy.
        SystemLog.log(
          level: 'info',
          source: 'updater',
          eventType: 'update_started',
          title:
              'Bắt đầu cài bản cập nhật ${info.version} (build ${info.buildNumber})',
          action: 'app_update',
        );
        await Process.start(
            file.path,
            [
              '/VERYSILENT',
              '/SUPPRESSMSGBOXES',
              '/NORESTART',
              '/SP-',
              '/FORCECLOSEAPPLICATIONS',
            ],
            mode: ProcessStartMode.detached);
        BlackBox
            .markCleanExit(); // thoát chủ động để cập nhật — không phải crash
        await Future.delayed(const Duration(milliseconds: 400));
        exit(0);
      }

      // Android: mở trình cài đặt hệ thống qua kênh native (FileProvider).
      const ch = MethodChannel('com.dandpak.pos/updater');
      final res =
          await ch.invokeMethod<String>('installApk', {'path': file.path});
      if (res == 'NEEDS_PERMISSION') {
        return 'Hãy bật "Cho phép từ nguồn này" cho Dan-D Pak POS ở màn cài đặt '
            'vừa mở, rồi quay lại bấm Cập nhật ngay lần nữa.';
      }
      if (res != null && res.isNotEmpty) {
        _logUpdateFailed(info, res);
        return res; // lỗi từ phía native
      }
      SystemLog.log(
        level: 'info',
        source: 'updater',
        eventType: 'update_started',
        title:
            'Đã mở trình cài đặt bản ${info.version} (build ${info.buildNumber})',
        action: 'app_update',
      );
      return null; // trình cài đặt đã mở — bấm Cài đặt là xong
    } catch (e) {
      dlog('downloadAndInstall failed: $e');
      final message = e.toString().replaceFirst('Exception: ', '');
      _logUpdateFailed(info, message);
      return message;
    }
  }

  static void _logUpdateFailed(UpdateInfo info, String message) {
    SystemLog.log(
      level: 'error',
      source: 'updater',
      eventType: 'update_failed',
      title:
          'Cập nhật bản ${info.version} (build ${info.buildNumber}) thất bại',
      message: message,
      action: 'app_update',
    );
  }

  static Future<void> prepareForServerOriginChange({
    required String fromBaseUrl,
    required String toBaseUrl,
  }) async {
    final platform = _platform;
    if (platform == null) return;
    final from = ReleaseScope.forServer(fromBaseUrl, platform);
    final to = ReleaseScope.forServer(toBaseUrl, platform);
    if (from.key == to.key) return;
    // Invalidate both the origin being left and the destination before the
    // switch. Namespacing is the safety boundary; invalidation guarantees the
    // next view is recomputed from the destination server, never stale disk.
    await LocalStore.instance.removeWhere((key) =>
        key.startsWith(from.storagePrefix) ||
        key.startsWith(to.storagePrefix));
    await _deleteDownloadedArtifactForScope(from);
    await _deleteDownloadedArtifactForScope(to);
    _notifiedBuilds.removeWhere((identity) =>
        identity.startsWith('${from.key}|') ||
        identity.startsWith('${to.key}|'));
    // Clear mounted update widgets before bootstrap. AuthProvider sends a
    // second revision after the new origin is active; request serials discard
    // any response still arriving from the previous origin.
    contextRevision.value++;
  }

  static void notifyServerOriginChanged() {
    contextRevision.value++;
  }

  static Future<void> _persistManifest(
      ReleaseScope scope, Map<dynamic, dynamic> decoded) async {
    final store = LocalStore.instance;
    await store.setString(scope.storageKey('latest_build'),
        '${(decoded['buildNumber'] as num?)?.toInt() ?? 0}');
    await store.setString(scope.storageKey('mandatory'),
        decoded['mandatory'] == true ? 'true' : 'false');
    await store.setString(
        scope.storageKey('version'), (decoded['version'] ?? '').toString());
    await store.setString(
        scope.storageKey('notes'), (decoded['notes'] ?? '').toString());
    await store.setString(
        scope.storageKey('download_url'), (decoded['url'] ?? '').toString());
    await store.setString(scope.storageKey('checked_at_utc'),
        DateTime.now().toUtc().toIso8601String());
  }

  static String _downloadPath(String rawUrl) {
    final uri = Uri.parse(rawUrl);
    return uri.hasScheme
        ? '${uri.path}${uri.hasQuery ? '?${uri.query}' : ''}'
        : rawUrl;
  }

  static String _safeScopeDirectory(ReleaseScope scope) =>
      scope.key.replaceAll(RegExp(r'[^a-zA-Z0-9._-]'), '_');

  static Future<void> _deleteDownloadedArtifactForScope(
      ReleaseScope scope) async {
    try {
      final base = Platform.isAndroid
          ? (await getTemporaryDirectory()).path
          : Directory.systemTemp.path;
      final dir = Directory('${Directory(base).path}/dandpak_update/'
          '${_safeScopeDirectory(scope)}');
      if (await dir.exists()) await dir.delete(recursive: true);
    } catch (_) {
      // Cache invalidation must not prevent a safe endpoint switch. Scope
      // validation still blocks using any stale artifact.
    }
  }
}
