package com.potatochat.android

import android.annotation.SuppressLint
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

// Netflix e HBO Max dentro do app (Batata Watch Party, como no Rave): um navegador por cima do chat, com a conta de cada
// um (os cookies ficam neste aparelho; nenhuma senha passa pelo Potato). O script assets/stream-sync.js faz o player
// seguir a sala e conta o que a pessoa faz lá (play, pause, pulo, título novo); o site recebe isso por toSite e faz a
// ponte com a sala, e o estado da sala chega aqui por state().
class StreamOverlay(private val activity: ComponentActivity, private val host: FrameLayout, private val toSite: (String) -> Unit) {
    private var layer: FrameLayout? = null
    private var view: WebView? = null
    private var title: TextView? = null
    private var fullscreen: View? = null
    private var fullscreenDone: WebChromeClient.CustomViewCallback? = null
    private var insetTop = 0
    private var insetBottom = 0

    val active get() = view != null
    val shown get() = layer?.visibility == View.VISIBLE

    // Abre (ou só mostra) o serviço. Um título específico (/watch/…) troca a página; a página inicial não tira a pessoa
    // de onde ela está.
    fun show(service: String, url: String) {
        if (!allowed(url)) return
        val web = view ?: create()
        layer?.visibility = View.VISIBLE
        title?.text = if (service == "max") "HBO Max · Batata Watch Party" else "Netflix · Batata Watch Party"
        val current = web.url.orEmpty()
        val wanted = titleId(url)
        if (current.isBlank() || Uri.parse(current).host != Uri.parse(url).host || (wanted.isNotEmpty() && wanted != titleId(current))) web.loadUrl(url)
    }

    fun hide() {
        layer?.visibility = View.GONE
    }

    fun close() {
        exitFullscreen()
        view?.apply {
            stopLoading()
            loadUrl("about:blank")
            destroy()
        }
        view = null
        layer?.let(host::removeView)
        layer = null
        CookieManager.getInstance().flush()
    }

    // O estado da sala, vindo do site, para o player seguir.
    fun state(raw: String) {
        view?.evaluateJavascript("window.__potatoRoom && window.__potatoRoom(${JSONObject.quote(raw)})", null)
    }

    // Voltar: sai da tela cheia; depois, volta para o chat (o vídeo continua).
    fun back(): Boolean {
        if (fullscreen != null) {
            fullscreenDone?.onCustomViewHidden()
            exitFullscreen()
            return true
        }
        if (shown) {
            hide()
            return true
        }
        return false
    }

    fun setInsets(top: Int, bottom: Int) {
        insetTop = top
        insetBottom = bottom
        (layer?.layoutParams as? FrameLayout.LayoutParams)?.let {
            if (it.topMargin != top || it.bottomMargin != bottom) {
                it.topMargin = top
                it.bottomMargin = bottom
                layer?.layoutParams = it
            }
        }
    }

    fun pause() = view?.onPause()
    fun resume() = view?.onResume()

    private fun dp(value: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), activity.resources.displayMetrics).toInt()

    private fun pill(text: String, onClick: () -> Unit) = TextView(activity).apply {
        this.text = text
        setTextColor(Color.WHITE)
        textSize = 14f
        setPadding(dp(14), dp(8), dp(14), dp(8))
        background = android.graphics.drawable.GradientDrawable().apply { cornerRadius = dp(18).toFloat(); setColor(Color.argb(60, 255, 255, 255)) }
        setOnClickListener { onClick() }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun create(): WebView {
        val web = WebView(activity).apply {
            setBackgroundColor(Color.BLACK)
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                useWideViewPort = true
                loadWithOverviewMode = true
                builtInZoomControls = true
                displayZoomControls = false
                cacheMode = WebSettings.LOAD_DEFAULT
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                // A Netflix e a HBO Max só tocam no site "de computador" (no do celular, mandam baixar o app). O Chrome
                // de verdade do aparelho, só que se dizendo do Windows, como o Rave faz.
                val chrome = Regex("Chrome/([\\d.]+)").find(WebSettings.getDefaultUserAgent(activity))?.groupValues?.get(1) ?: "131.0.0.0"
                userAgentString = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$chrome Safari/537.36"
            }
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
            webViewClient = object : WebViewClient() {
                // Só páginas da web: links para abrir o app da Netflix (intent://, nflx://) ficam de fora.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.url.scheme !in setOf("http", "https")
            }
            webChromeClient = object : WebChromeClient() {
                // O filme protegido (Widevine) precisa dessa permissão; câmera e microfone, não.
                override fun onPermissionRequest(request: PermissionRequest) {
                    activity.runOnUiThread {
                        if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID in request.resources && allowed(request.origin.toString())) {
                            request.grant(arrayOf(PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID))
                        } else request.deny()
                    }
                }

                // Tela cheia do player: o vídeo ocupa tudo, deitado, sem as barras do Android.
                override fun onShowCustomView(custom: View, callback: CustomViewCallback) {
                    exitFullscreen()
                    fullscreen = custom
                    fullscreenDone = callback
                    host.addView(custom, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                    WindowCompat.getInsetsController(activity.window, custom).apply {
                        systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                        hide(WindowInsetsCompat.Type.systemBars())
                    }
                    activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                }

                override fun onHideCustomView() = exitFullscreen()
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "PotatoStream", ORIGINS) { _, message, origin, isMainFrame, _ ->
                val raw = message.data.orEmpty()
                val type = runCatching { JSONObject(raw).optString("type") }.getOrNull()
                if (isMainFrame && origin.toString().trimEnd('/') in ORIGINS && raw.length < 4000 && type in setOf("hello", "playing", "action")) toSite(raw)
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, activity.assets.open("stream-sync.js").bufferedReader().use { it.readText() }, ORIGINS)
        }
        // A faixa de cima: voltar para o chat (o vídeo continua) e fechar o serviço.
        val bar = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(6), dp(8), dp(6))
            setBackgroundColor(Color.rgb(18, 16, 13))
        }
        val label = TextView(activity).apply {
            setTextColor(Color.argb(200, 255, 255, 255))
            textSize = 13f
            gravity = Gravity.CENTER
        }
        title = label
        bar.addView(pill("← Chat") { hide() })
        bar.addView(label, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(pill("Fechar") { close() })
        val box = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        box.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        box.addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        layer = FrameLayout(activity).apply {
            setBackgroundColor(Color.BLACK)
            addView(box)
            isClickable = true
        }
        host.addView(layer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT).apply {
            topMargin = insetTop
            bottomMargin = insetBottom
        })
        view = web
        return web
    }

    private fun exitFullscreen() {
        val custom = fullscreen ?: return
        host.removeView(custom)
        fullscreen = null
        fullscreenDone = null
        WindowCompat.getInsetsController(activity.window, host).show(WindowInsetsCompat.Type.systemBars())
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }

    companion object {
        val ORIGINS = setOf("https://www.netflix.com", "https://play.max.com", "https://play.hbomax.com")

        fun allowed(url: String): Boolean = Uri.parse(url).let { it.scheme == "https" && "${it.scheme}://${it.host}" in ORIGINS }

        // O título pelo endereço: na Netflix, /watch/123; na HBO Max, /video/watch/<id>/<id>.
        fun titleId(url: String): String = Regex("/watch/([^?#]+)").find(url)?.groupValues?.get(1).orEmpty()
    }
}
