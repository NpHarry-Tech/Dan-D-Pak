import 'dart:async';

import 'package:dandpak_core/src/services/api_service.dart';
import 'package:dandpak_core/src/services/app_updater.dart';
import 'package:dandpak_core/src/services/release_scope.dart';
import 'package:flutter_test/flutter_test.dart';

const prod = 'https://api.dandpakpos.io.vn';
const review = 'https://api-review.dandpakpos.io.vn';

class _ReleaseApi extends ApiService {
  _ReleaseApi(String origin, this.manifests) : super(baseUrl: origin);

  final Map<String, Map<String, dynamic>> manifests;
  int bytesRequests = 0;

  @override
  Future<dynamic> getJson(String path,
      {Duration timeout = const Duration(seconds: 20),
      String? errorMessage}) async {
    return Map<String, dynamic>.from(manifests[baseUrl]!);
  }

  @override
  Future<List<int>> getBytes(String path,
      {Duration timeout = const Duration(seconds: 30),
      String? errorMessage}) async {
    bytesRequests++;
    return [1, 2, 3];
  }
}

class _DelayedReleaseApi extends ApiService {
  _DelayedReleaseApi() : super(baseUrl: review);

  final response = Completer<Map<String, dynamic>>();

  @override
  Future<dynamic> getJson(String path,
          {Duration timeout = const Duration(seconds: 20),
          String? errorMessage}) =>
      response.future;
}

Map<String, dynamic> manifest(int build,
        {required bool mandatory, required String url}) =>
    {
      'available': true,
      'buildNumber': build,
      'version': 'v$build',
      'notes': 'notes-$build',
      'mandatory': mandatory,
      'url': url,
    };

void main() {
  final manifests = <String, Map<String, dynamic>>{
    prod:
        manifest(82, mandatory: false, url: '/api/app/download/android-phone'),
    review:
        manifest(90, mandatory: true, url: '/api/app/download/android-phone'),
  };

  test('1: local 79 + Prod 82 mandatory shows update', () async {
    final api = _ReleaseApi(prod, {
      ...manifests,
      prod:
          manifest(82, mandatory: true, url: '/api/app/download/android-phone'),
    });
    final info = await AppUpdater.checkForUpdate(api,
        platformOverride: 'android-phone', currentBuildOverride: 79);
    expect(info?.buildNumber, 82);
    expect(info?.mandatory, isTrue);
  });

  test('2: local 82 + Prod 82 mandatory never gates', () async {
    final api = _ReleaseApi(prod, {
      ...manifests,
      prod:
          manifest(82, mandatory: true, url: '/api/app/download/android-phone'),
    });
    expect(
        await AppUpdater.checkForUpdate(api,
            platformOverride: 'android-phone', currentBuildOverride: 82),
        isNull);
  });

  test('3 and 6: Review mandatory cannot leak after switch to Prod', () async {
    final api = _ReleaseApi(review, manifests);
    final reviewInfo = await AppUpdater.checkForUpdate(api,
        platformOverride: 'android-phone', currentBuildOverride: 82);
    expect(reviewInfo?.mandatory, isTrue);
    api.setBaseUrl(prod);
    final prodInfo = await AppUpdater.checkForUpdate(api,
        platformOverride: 'android-phone', currentBuildOverride: 82);
    expect(prodInfo, isNull);
  });

  test('4: local 90 + Prod 82 never forces downgrade', () async {
    final api = _ReleaseApi(prod, manifests);
    expect(
        await AppUpdater.checkForUpdate(api,
            platformOverride: 'android-phone', currentBuildOverride: 90),
        isNull);
  });

  test('5: Prod then Review fetches Review 90, not Prod cache 82', () async {
    final api = _ReleaseApi(prod, manifests);
    final prodInfo = await AppUpdater.checkForUpdate(api,
        platformOverride: 'android-phone', currentBuildOverride: 79);
    expect(prodInfo?.buildNumber, 82);
    api.setBaseUrl(review);
    final reviewInfo = await AppUpdater.checkForUpdate(api,
        platformOverride: 'android-phone', currentBuildOverride: 79);
    expect(reviewInfo?.buildNumber, 90);
    expect(reviewInfo?.scopeKey, contains('api-review'));
  });

  test('7: stale Review URL is rejected after switching to Production',
      () async {
    final api = _ReleaseApi(review, manifests);
    final info = await AppUpdater.checkForUpdate(api,
        platformOverride: 'windows', currentBuildOverride: 82);
    expect(info, isNotNull);
    api.setBaseUrl(prod);
    final error = await AppUpdater.downloadAndInstall(api, info!);
    expect(error, contains('Máy chủ đã thay đổi'));
    expect(api.bytesRequests, 0);
  });

  test('8: restart after Review to Prod recomputes current origin', () async {
    final beforeRestart = _ReleaseApi(review, manifests);
    expect(
        (await AppUpdater.checkForUpdate(beforeRestart,
                platformOverride: 'android-phone', currentBuildOverride: 82))
            ?.buildNumber,
        90);
    final afterRestart = _ReleaseApi(prod, manifests);
    expect(
        await AppUpdater.checkForUpdate(afterRestart,
            platformOverride: 'android-phone', currentBuildOverride: 82),
        isNull);
  });

  test('9: auth lifecycle is not part of release identity', () {
    final before = ReleaseScope.forServer(prod, 'android-phone');
    // Logout/login changes credentials, not origin/environment/platform.
    final after = ReleaseScope.forServer('$prod/', 'android-phone');
    expect(after.key, before.key);
  });

  test('10: Phone Tablet Windows use different release keys', () {
    final keys = {
      ReleaseScope.forServer(prod, 'android-phone').key,
      ReleaseScope.forServer(prod, 'android').key,
      ReleaseScope.forServer(prod, 'windows').key,
    };
    expect(keys, hasLength(3));
  });

  test('origin includes scheme and non-default port', () {
    expect(ReleaseScope.normalizedServerOrigin('HTTPS://EXAMPLE.COM:443/a'),
        'https://example.com');
    expect(ReleaseScope.normalizedServerOrigin('https://example.com:8443/a'),
        'https://example.com:8443');
  });

  test('in-flight Review response is discarded after origin changes', () async {
    final api = _DelayedReleaseApi();
    final pending = AppUpdater.checkForUpdate(api,
        platformOverride: 'android-phone', currentBuildOverride: 82);
    api.setBaseUrl(prod);
    api.response.complete(
        manifest(90, mandatory: true, url: '/api/app/download/android-phone'));
    expect(await pending, isNull);
  });
}
