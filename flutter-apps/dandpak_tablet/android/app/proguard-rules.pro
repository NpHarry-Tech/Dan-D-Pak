# Webview Flutter ProGuard rules
-keep class com.oi.webview_flutter.** { *; }

# General Flutter Proguard rules
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.embedding.** { *; }
-keep class io.flutter.plugins.** { *; }
-keep class androidx.lifecycle.** { *; }
-dontwarn io.flutter.plugins.**
-dontwarn com.google.android.play.core.**
-dontwarn com.google.android.gms.internal.**

