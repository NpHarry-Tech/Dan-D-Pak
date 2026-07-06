package com.dandpak.pos

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

/**
 * App wrapper mỏng: nạp web POS vào WebView và gắn cầu nối thanh toán thẻ.
 *
 * Scaffold — cần Android Studio + SDK của hãng máy/VCB để build. Xem ../README.md.
 */
class MainActivity : AppCompatActivity() {

    // TODO: trỏ về server cửa hàng (LAN IP của máy chạy `npm start`, cổng 3000).
    // Tablet shell mở launcher với app=tablet để hiện module tablet/iPad self-order.
    private val WEB_POS_URL = "http://192.168.1.10:3000/?app=tablet"

    private lateinit var webView: WebView
    private lateinit var bridge: CardTerminalBridge

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true   // localStorage cho auth_token
            databaseEnabled = true
        }
        webView.webViewClient = WebViewClient()

        // Gắn cầu nối: web gọi window.NativeCardTerminal.charge(...)
        bridge = CardTerminalBridge(this, webView)
        webView.addJavascriptInterface(bridge, "NativeCardTerminal")

        webView.loadUrl(WEB_POS_URL)
    }

    // Nhận kết quả Intent từ app VCB rồi chuyển cho bridge xử lý.
    @Deprecated("Dùng ActivityResult API nếu nâng cấp")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        bridge.handleActivityResult(requestCode, resultCode, data)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
