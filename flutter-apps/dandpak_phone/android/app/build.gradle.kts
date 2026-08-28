import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // Đọc google-services.json (đẩy thông báo Firebase Cloud Messaging).
    id("com.google.gms.google-services")
}

android {
    namespace = "com.dandpak.dandpak_phone"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    val keystorePropertiesFile = rootProject.file("key.properties")
    val keystoreProperties = Properties()
    if (keystorePropertiesFile.exists()) {
        keystoreProperties.load(FileInputStream(keystorePropertiesFile))
    }
    val releaseRequested = gradle.startParameter.taskNames.any {
        it.contains("release", ignoreCase = true)
    }
    val requiredSigningKeys = listOf("keyAlias", "keyPassword", "storeFile", "storePassword")
    val missingSigningKeys = requiredSigningKeys.filter {
        keystoreProperties.getProperty(it).isNullOrBlank()
    }
    val releaseStoreFile = keystoreProperties.getProperty("storeFile")?.let { file(it) }
    if (releaseRequested &&
        (!keystorePropertiesFile.exists() || missingSigningKeys.isNotEmpty() || releaseStoreFile?.isFile != true)
    ) {
        throw GradleException(
            "Release signing is not configured. Provide android/key.properties and an existing production " +
                "keystore with keyAlias, keyPassword, storeFile and storePassword. Debug signing is forbidden."
        )
    }

    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties["keyAlias"] as String?
            keyPassword = keystoreProperties["keyPassword"] as String?
            storeFile = releaseStoreFile
            storePassword = keystoreProperties["storePassword"] as String?
        }
    }

    defaultConfig {
        applicationId = "com.dandpak.dandpak_phone"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // Ký bằng key.properties (trỏ về đúng key đã ký các bản đang cài) — giữ
            // liên tục chữ ký để auto-update không bị Android từ chối.
            signingConfig = signingConfigs.getByName("release")
            // R8/shrink TẮT: các bản đang chạy trên máy POS (build 68) build KHÔNG R8.
            // Bật R8 mà proguard-rules chưa đủ dễ nuốt class dùng qua reflection/JSON
            // -> crash lúc chạy. Giữ đúng cấu hình đã kiểm chứng cho hệ thống tiền thật.
            isMinifyEnabled = false
            isShrinkResources = false
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    // FileProvider cho auto-update (MainActivity mở trình cài APK).
    implementation("androidx.core:core-ktx:1.13.1")
}

flutter {
    source = "../.."
}
