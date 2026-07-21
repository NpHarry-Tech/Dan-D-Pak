package com.dandpak.dandpak_phone

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import org.json.JSONObject
import java.io.File

class MainActivity: FlutterActivity() {
    private val CHANNEL = "com.dandpak.pos/card_terminal"
    private val UPDATER_CHANNEL = "com.dandpak.pos/updater"
    private val NOTIFICATION_CHANNEL = "com.dandpak.pos/notifications"
    private val REQ_VCB_PAYMENT = 1001
    private val REQ_NOTIFICATIONS = 1002
    private var pendingResult: MethodChannel.Result? = null
    private var pendingTerminal: String = ""
    private var pendingNotification: Triple<String, String, ByteArray?>? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            if (call.method == "charge") {
                val amount = call.argument<Int>("amount") ?: 0
                val reference = call.argument<String>("reference") ?: ""
                val billNo = call.argument<String>("billNo") ?: ""
                pendingTerminal = call.argument<String>("terminalName") ?: "VCB SmartPOS"
                pendingResult = result

                try {
                    // Gọi app thanh toán VCB SmartPOS (PAX A920)
                    val intent = Intent("vn.com.vietcombank.smartpos.PAYMENT").apply {
                        putExtra("amount", amount)
                        putExtra("transType", "SALE")
                        putExtra("billNo", billNo)
                        putExtra("reference", reference)
                    }
                    startActivityForResult(intent, REQ_VCB_PAYMENT)
                } catch (e: Exception) {
                    val errorJson = JSONObject().apply {
                        put("approved", false)
                        put("error", "Không khởi động được app VCB SmartPOS: ${e.message}")
                    }
                    result.success(errorJson.toString())
                    pendingResult = null
                }
            } else {
                result.notImplemented()
            }
        }

        // Auto-update: nhận đường dẫn APK đã tải, mở trình cài đặt hệ thống.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, UPDATER_CHANNEL).setMethodCallHandler { call, result ->
            if (call.method == "installApk") {
                result.success(installApk(call.argument<String>("path") ?: ""))
            } else {
                result.notImplemented()
            }
        }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, NOTIFICATION_CHANNEL).setMethodCallHandler { call, result ->
            if (call.method == "showNotification") {
                showSystemNotification(
                    call.argument<String>("title") ?: "Dan-D Pak POS",
                    call.argument<String>("body") ?: "",
                    call.argument<ByteArray>("logo")
                )
                result.success(null)
            } else {
                result.notImplemented()
            }
        }
    }

    private fun showSystemNotification(title: String, body: String, logo: ByteArray?) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            pendingNotification = Triple(title, body, logo)
            ActivityCompat.requestPermissions(
                this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATIONS)
            return
        }
        val channelId = "dandpak_updates"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(channelId, "Dan-D Pak POS", NotificationManager.IMPORTANCE_HIGH)
            )
        }
        val openApp = packageManager.getLaunchIntentForPackage(packageName)
            ?: Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
        logo?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
            ?.let(notification::setLargeIcon)
        NotificationManagerCompat.from(this).notify(20260721, notification.build())
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_NOTIFICATIONS && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            pendingNotification?.let { showSystemNotification(it.first, it.second, it.third) }
        }
        if (requestCode == REQ_NOTIFICATIONS) pendingNotification = null
    }

    /** Trả null nếu đã mở trình cài đặt; "NEEDS_PERMISSION" nếu phải cấp quyền
     *  "Cài ứng dụng không rõ nguồn gốc" trước (đã tự mở màn cấp quyền); còn lại
     *  là thông báo lỗi để hiện cho người dùng. */
    private fun installApk(path: String): String? {
        return try {
            val file = File(path)
            if (!file.exists()) return "Không tìm thấy file cập nhật: $path"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !packageManager.canRequestPackageInstalls()) {
                // Android 8+: app phải được cấp quyền cài APK → dẫn thẳng tới
                // đúng màn cấp quyền của app này rồi báo về cho Flutter.
                startActivity(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:$packageName"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return "NEEDS_PERMISSION"
            }
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            })
            null
        } catch (e: Exception) {
            "Không mở được trình cài đặt: ${e.message}"
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_VCB_PAYMENT) {
            val result = pendingResult ?: return
            pendingResult = null

            val resultJson = JSONObject()
            if (resultCode == Activity.RESULT_OK && data != null) {
                val approved = data.getBooleanExtra("approved", true)
                resultJson.put("approved", approved)
                resultJson.put("txnId", data.getStringExtra("txnId") ?: "")
                resultJson.put("rrn", data.getStringExtra("rrn") ?: "")
                resultJson.put("approval", data.getStringExtra("approvalCode") ?: "")
                resultJson.put("mask", data.getStringExtra("cardMask") ?: "")
                resultJson.put("scheme", data.getStringExtra("cardScheme") ?: "")
                resultJson.put("terminal", pendingTerminal)
            } else {
                resultJson.put("approved", false)
                resultJson.put("error", "Giao dịch bị hủy hoặc thất bại.")
            }
            result.success(resultJson.toString())
        }
    }
}
