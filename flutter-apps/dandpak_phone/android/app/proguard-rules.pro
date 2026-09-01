# ML Kit Barcode Scanning Proguard rules
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_barcode.** { *; }
-dontwarn com.google.mlkit.**

# Webview Flutter ProGuard rules

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

