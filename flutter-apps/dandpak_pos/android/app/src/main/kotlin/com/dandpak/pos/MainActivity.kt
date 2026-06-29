package com.dandpak.pos

import android.app.Activity
import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import org.json.JSONObject

class MainActivity: FlutterActivity() {
    private val CHANNEL = "com.dandpak.pos/card_terminal"
    private val REQ_VCB_PAYMENT = 1001
    private var pendingResult: MethodChannel.Result? = null
    private var pendingTerminal: String = ""

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
