package com.potatochat.android

import android.Manifest
import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var mediaRequest: PermissionRequest? = null

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (::webView.isInitialized) {
            webView.evaluateJavascript("window.__potatoSetNotificationPermission?.('${if (granted) "granted" else "denied"}')", null)
        }
    }

    private val mediaPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val request = mediaRequest ?: return@registerForActivityResult
        mediaRequest = null
        val resources = mutableListOf<String>()
        if (result[Manifest.permission.RECORD_AUDIO] == true) resources += PermissionRequest.RESOURCE_AUDIO_CAPTURE
        if (result[Manifest.permission.CAMERA] == true) resources += PermissionRequest.RESOURCE_VIDEO_CAPTURE
        if (resources.isEmpty()) request.deny() else request.grant(resources.toTypedArray())
    }

    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        if (result.resultCode != RESULT_OK) {
            callback.onReceiveValue(null)
            return@registerForActivityResult
        }

        val data = result.data
        val uris = buildList {
            data?.clipData?.let { clip ->
                for (index in 0 until clip.itemCount) add(clip.getItemAt(index).uri)
            }
            data?.data?.let { if (it !in this) add(it) }
        }
        uris.forEach { uri ->
            runCatching {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }
        callback.onReceiveValue(uris.takeIf { it.isNotEmpty() }?.toTypedArray())
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(18, 16, 13)
        window.navigationBarColor = Color.rgb(18, 16, 13)
        createChannels()
        configureWebView()
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(18, 16, 13))
            addView(webView)
        }
        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            // Teclado aberto: o site encolhe até em cima dele. Sem isso o teclado cobria o fim da conversa, e o site
            // não tinha como saber que ele abriu (as abas de baixo dependem disso).
            val bottom = maxOf(bars.bottom, insets.getInsets(WindowInsetsCompat.Type.ime()).bottom)
            val params = webView.layoutParams as FrameLayout.LayoutParams
            if (params.topMargin != bars.top || params.bottomMargin != bottom) {
                params.topMargin = bars.top
                params.bottomMargin = bottom
                webView.layoutParams = params
            }
            insets
        }
        setContentView(root)
        ViewCompat.requestApplyInsets(root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        // Aberto por uma notificação do Nosso cantinho: o site já começa na parte certa (#agenda, #cartinhas…).
        webView.loadUrl(SITE_URL + section(intent)?.let { "#$it" }.orEmpty())
    }

    // Com o app já aberto, a notificação do Nosso cantinho só troca a parte que aparece.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val section = section(intent) ?: return
        webView.evaluateJavascript("window.potatoOpen && window.potatoOpen(${JSONObject.quote(section)})", null)
    }

    private fun section(intent: Intent?): String? =
        intent?.getStringExtra(CantinhoNotifications.EXTRA_OPEN)?.takeIf { it in setOf("hoje", "agenda", "sonhos", "cartinhas", "jogos") }

    @Suppress("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(18, 16, 13))
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_DEFAULT
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                userAgentString = "$userAgentString PotatoChatAndroid/2.0"
            }
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    return if (uri.host.equals(SITE_HOST, ignoreCase = true)) false
                    else {
                        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                        true
                    }
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread { handleMediaPermission(request) }
                }

                override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    val acceptedTypes = params?.acceptTypes
                        ?.flatMap { it.split(',') }
                        ?.map { it.trim() }
                        ?.filter { it.isNotEmpty() }
                        ?.distinct()
                        .orEmpty()
                    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
                        type = acceptedTypes.singleOrNull() ?: "*/*"
                        if (acceptedTypes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, acceptedTypes.toTypedArray())
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params?.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                    }
                    runCatching { filePicker.launch(intent) }.onFailure {
                        fileCallback = null
                        callback?.onReceiveValue(null)
                    }
                    return true
                }
            }
            setDownloadListener(DownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
                download(url, userAgent, contentDisposition, mimeType)
            })
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "PotatoAndroid", setOf(SITE_ORIGIN)) { _, message, sourceOrigin, isMainFrame, _ ->
                if (isMainFrame && sourceOrigin.toString().startsWith(SITE_ORIGIN)) handleBridgeMessage(message.data.orEmpty())
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, bridgeScript(), setOf(SITE_ORIGIN))
        }
    }

    private fun handleMediaPermission(request: PermissionRequest) {
        if (request.origin.host != SITE_HOST) return request.deny()
        val requested = request.resources.toSet()
        val permissions = buildList {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in requested && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) add(Manifest.permission.RECORD_AUDIO)
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in requested && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) add(Manifest.permission.CAMERA)
        }
        if (permissions.isEmpty()) {
            request.grant(request.resources.filter { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE || it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }.toTypedArray())
        } else {
            mediaRequest?.deny()
            mediaRequest = request
            mediaPermissions.launch(permissions.toTypedArray())
        }
    }

    private fun handleBridgeMessage(raw: String) {
        val message = runCatching { JSONObject(raw) }.getOrNull() ?: return
        when (message.optString("type")) {
            "state" -> {
                val session = message.optJSONObject("session")
                getSharedPreferences(PREFS, 0).edit()
                    .putString("token", session?.optString("token").orEmpty())
                    .putString("name", session?.optString("name").orEmpty())
                    .putBoolean("notifications", message.optBoolean("notifications", true))
                    .apply()
                if (session == null) stopService(Intent(this, ChatNotificationService::class.java))
            }
            "notification" -> showNotification(
                message.optString("title", "Potato Chat"),
                message.optString("body"),
                message.optString("tag") == "potato-call",
                message.optString("icon").takeIf { it.startsWith(SITE_ORIGIN) }
            )
            "permission" -> requestNotificationPermission()
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            webView.evaluateJavascript("window.__potatoSetNotificationPermission?.('granted')", null)
        } else notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun bridgeScript(): String {
        val initialPermission = if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) "granted" else "default"
        return """
            (() => {
              if (window.__potatoNativeReady) return;
              window.__potatoNativeReady = true;
              const nativeStyle = document.createElement('style');
              nativeStyle.textContent = '@media (max-width:760px){.tabbar{padding-bottom:6px!important}}';
              (document.head || document.documentElement).appendChild(nativeStyle);
              let permission = '$initialPermission';
              const send = value => { try { window.PotatoAndroid?.postMessage(JSON.stringify(value)); } catch (_) {} };
              window.__potatoSetNotificationPermission = value => { permission = value; };
              class NativeNotification {
                static get permission() { return permission; }
                static requestPermission() {
                  send({ type: 'permission' });
                  return new Promise(resolve => {
                    let tries = 0;
                    const timer = setInterval(() => {
                      if (permission !== 'default' || ++tries > 60) { clearInterval(timer); resolve(permission); }
                    }, 250);
                  });
                }
                constructor(title, options = {}) {
                  this.onclick = null;
                  send({ type: 'notification', title: String(title || 'Potato Chat'), body: String(options.body || ''), tag: String(options.tag || ''), icon: String(options.icon || '') });
                }
                close() {}
              }
              try { Object.defineProperty(window, 'Notification', { value: NativeNotification, configurable: false }); }
              catch (_) { window.Notification = NativeNotification; }
              let lastState = '';
              const sync = () => {
                try {
                  const raw = localStorage.getItem('potato.session');
                  const notifyRaw = localStorage.getItem('potato.notify');
                  const state = String(raw) + '|' + String(notifyRaw);
                  if (state === lastState) return;
                  lastState = state;
                  send({ type: 'state', session: raw ? JSON.parse(raw) : null, notifications: notifyRaw === null || JSON.parse(notifyRaw) !== false });
                } catch (_) {}
              };
              sync();
              setInterval(sync, 750);
            })();
        """.trimIndent()
    }

    private fun showNotification(title: String, body: String, call: Boolean, icon: String?) {
        if (!getSharedPreferences(PREFS, 0).getBoolean("notifications", true)) return
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        if (!call) {
            // A foto de quem mandou pode precisar ser baixada: fora da thread principal.
            val context = applicationContext
            Thread { ChatNotifications.showIncoming(context, title, body, icon) }.start()
            return
        }
        val intent = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(this, CALL_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body.take(180))
            .setStyle(NotificationCompat.BigTextStyle().bigText(body.take(500)))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_NONE)
            .setNumber(0)
            .build()
        getSystemService(NotificationManager::class.java).notify(ChatNotifications.CALL_ID, notification)
    }

    private fun download(url: String, userAgent: String, disposition: String, mimeType: String) {
        val fileName = URLUtil.guessFileName(url, disposition, mimeType)
        val request = DownloadManager.Request(Uri.parse(url))
            .setMimeType(mimeType)
            .addRequestHeader("User-Agent", userAgent)
            .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url).orEmpty())
            .setTitle(fileName)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
        getSystemService(DownloadManager::class.java).enqueue(request)
    }

    private fun createChannels() {
        CantinhoNotifications.createChannels(this)
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(MESSAGE_CHANNEL, "Mensagens", NotificationManager.IMPORTANCE_HIGH).apply { setShowBadge(true) })
        manager.createNotificationChannel(NotificationChannel(CALL_CHANNEL, "Chamadas", NotificationManager.IMPORTANCE_HIGH).apply { setShowBadge(false) })
    }

    override fun onStart() {
        super.onStart()
        stopService(Intent(this, ChatNotificationService::class.java))
        val notifications = getSystemService(NotificationManager::class.java)
        notifications.cancelAll()
        ChatNotifications.clear(this)
        // O One UI cria um resumo automatico; limpa novamente depois que o servico termina.
        webView.postDelayed({ notifications.cancelAll() }, 500)
    }

    private fun startBackgroundNotifications() {
        val prefs = getSharedPreferences(PREFS, 0)
        if (prefs.getString("token", "").orEmpty().isNotBlank() && prefs.getBoolean("notifications", true)) {
            runCatching { ContextCompat.startForegroundService(this, Intent(this, ChatNotificationService::class.java)) }
        }
    }

    override fun onResume() { super.onResume(); webView.onResume() }
    override fun onPause() { startBackgroundNotifications(); webView.onPause(); super.onPause() }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        mediaRequest?.deny()
        webView.stopLoading()
        webView.webChromeClient = null
        webView.webViewClient = WebViewClient()
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        const val SITE_URL = BuildConfig.SITE_URL
        val SITE_ORIGIN: String = SITE_URL.trimEnd('/')
        val SITE_HOST: String = Uri.parse(SITE_URL).host.orEmpty()
        const val PREFS = "potato.webview"
        const val MESSAGE_CHANNEL = "potato_messages"
        const val CALL_CHANNEL = "potato_calls"
    }
}
