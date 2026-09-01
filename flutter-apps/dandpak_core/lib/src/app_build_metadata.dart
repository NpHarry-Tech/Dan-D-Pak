class AppBuildMetadata {
  const AppBuildMetadata._();
  static const gitCommit =
      String.fromEnvironment('BUILD_GIT_COMMIT', defaultValue: 'unknown');
  static const sourceTreeSha256 =
      String.fromEnvironment('BUILD_SOURCE_SHA256', defaultValue: 'unknown');
  static const builtAtUtc =
      String.fromEnvironment('BUILD_TIME_UTC', defaultValue: 'unknown');
  static const schemaVersion =
      String.fromEnvironment('SCHEMA_VERSION', defaultValue: 'unknown');
}
