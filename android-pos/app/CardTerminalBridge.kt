package com.dandpak.pos

import android.app.Activity
import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * Cầu nối JS ↔ native cho thanh toán thẻ. Tuân thủ ../CONTRACT.md.
 *
 * Web gọi:   window.NativeCardTerminal.charge(payloadJson, token)
 * Native trả: window.__cardTerminalResult(token, resultJson)
 */
class CardTerminalBridge(
    private val activity: Activity,
    private val webView: WebView,
) {
    private val REQ_VCB_PAYMENT = 1001
    private var pendingToken: String? = null
    private var pendingTerminal: String? = null

    /** Web gọi để bắt đầu quẹt thẻ. */
    @JavascriptInterface
    fun charge(payloadJson: String, token: String) {
        val p = JSONObject(payloadJson)
        val amount = p.optInt("amount", 0)
        val reference = p.optString("reference", "")
        val billNo = p.optString("billNo", "")
        pendingToken = token
        pendingTerminal = p.optString("terminalName", "")

        val intent = Intent().apply {
            action = "vn.com.vietcombank.smartpos.PAYMENT"
            putExtra("amount", amount.toLong())
            putExtra("transType", "SALE")
            putExtra("billNo", billNo)
            putExtra("reference", reference)
        }

        // Kiểm tra ứng dụng hỗ trợ Intent, nếu không tìm thấy thử các package/action khác của VNPAY
        val pm = activity.packageManager
        if (intent.resolveActivity(pm) == null) {
            intent.action = "com.vnpay.pos.action.PAYMENT"
        }
        if (intent.resolveActivity(pm) == null) {
            intent.action = "com.vnpay.merchant.payment"
        }

        try {
            activity.startActivityForResult(intent, REQ_VCB_PAYMENT)
        } catch (e: Exception) {
            resolve(token, JSONObject().apply {
                put("approved", false)
                put("error", "Không tìm thấy app thanh toán VCB/VNPAY SmartPOS trên máy. Chi tiết: ${e.message}")
            })
        }
    }

    /** MainActivity chuyển onActivityResult về đây. */
    fun handleActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQ_VCB_PAYMENT) return
        val token = pendingToken ?: return
        pendingToken = null

        val result = JSONObject()
        if (resultCode == Activity.RESULT_OK && data != null) {
            val respCode = data.getStringExtra("respCode") ?: data.getStringExtra("responseCode") ?: ""
            val isApproved = respCode == "00" || data.getBooleanExtra("approved", false)

            result.put("approved", isApproved)
            result.put("txnId", data.getStringExtra("txnId") ?: data.getStringExtra("traceNo") ?: "")
            result.put("rrn", data.getStringExtra("rrn") ?: data.getStringExtra("refNo") ?: "")
            result.put("approval", data.getStringExtra("approvalCode") ?: data.getStringExtra("appCode") ?: "")
            result.put("mask", data.getStringExtra("cardMask") ?: data.getStringExtra("cardNo") ?: data.getStringExtra("cardNumber") ?: "")
            result.put("scheme", data.getStringExtra("cardScheme") ?: data.getStringExtra("cardType") ?: "")
            result.put("terminal", pendingTerminal ?: "")

            if (!isApproved) {
                val errorMsg = data.getStringExtra("error") ?: data.getStringExtra("message") ?: "Giao dịch bị từ chối (Mã lỗi: $respCode)"
                result.put("error", errorMsg)
            }
        } else {
            result.put("approved", false)
            result.put("error", "Giao dịch bị hủy hoặc thất bại")
        }
        resolve(token, result)
    }

    private fun resolve(token: String, result: JSONObject) {
        val js = "window.__cardTerminalResult(${JSONObject.quote(token)}, ${JSONObject.quote(result.toString())})"
        webView.post { webView.evaluateJavascript(js, null) }
    }
}
