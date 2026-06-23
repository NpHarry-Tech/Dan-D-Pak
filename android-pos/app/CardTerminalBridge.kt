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

    /** Web gọi để bắt đầu quẹt thẻ. Không trả về trực tiếp — kết quả qua callback. */
    @JavascriptInterface
    fun charge(payloadJson: String, token: String) {
        val p = JSONObject(payloadJson)
        val amount = p.optInt("amount", 0)
        val reference = p.optString("reference", "")
        val billNo = p.optString("billNo", "")
        pendingToken = token
        pendingTerminal = p.optString("terminalName", "")

        // TODO(VCB): Mở app thanh toán VCB bằng Intent theo tài liệu ECR của Vietcombank.
        //   Ví dụ MINH HOẠ (action/extras thực tế phải lấy từ tài liệu VCB):
        //
        //   val intent = Intent("vn.com.vietcombank.smartpos.PAYMENT").apply {
        //       putExtra("amount", amount)          // đơn vị theo quy định VCB (đồng / xu)
        //       putExtra("transType", "SALE")
        //       putExtra("billNo", billNo)
        //       putExtra("reference", reference)
        //   }
        //   activity.startActivityForResult(intent, REQ_VCB_PAYMENT)
        //
        // Khi CHƯA có tài liệu: trả lỗi để web tự nhắc dùng chế độ thủ công.
        resolve(token, JSONObject().apply {
            put("approved", false)
            put("error", "Chưa tích hợp Intent VCB (điền TODO(VCB) trong CardTerminalBridge.kt)")
        })
    }

    /** MainActivity chuyển onActivityResult về đây. */
    fun handleActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQ_VCB_PAYMENT) return
        val token = pendingToken ?: return
        pendingToken = null

        val result = JSONObject()
        if (resultCode == Activity.RESULT_OK && data != null) {
            // TODO(VCB): map các extras VCB trả về sang đúng field trong CONTRACT.md.
            result.put("approved", data.getBooleanExtra("approved", true))
            result.put("txnId", data.getStringExtra("txnId") ?: "")
            result.put("rrn", data.getStringExtra("rrn") ?: "")
            result.put("approval", data.getStringExtra("approvalCode") ?: "")
            result.put("mask", data.getStringExtra("cardMask") ?: "")
            result.put("scheme", data.getStringExtra("cardScheme") ?: "")
            result.put("terminal", pendingTerminal ?: "")

            // TODO(PRINTER): nếu muốn native in slip/bill bằng Printer SDK của hãng máy
            //   (PAX/Sunmi/Telpo/Aisino), gọi tại đây sau khi approved=true.
            //   Mặc định: để web in qua luồng print sẵn có là đủ.
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
