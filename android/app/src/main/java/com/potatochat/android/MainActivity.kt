package com.potatochat.android

import android.Manifest
import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.Icon
import android.media.projection.MediaProjectionManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.util.Rational
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
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
    // A chamada aberta no site (null = nenhuma): enquanto ela existe, o CallService segura o microfone com o app fora da
    // tela, e o WebView não é pausado.
    private var callState: CallService.State? = null
    private var screenActive = false
    private var peerScreenActive = false
    private var peerVideoActive = false
    private var pipRatio = Rational(16, 9)
    private var pipPending = false
    private var pendingScreen: JSONObject? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    private val screenPermission = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val request = pendingScreen ?: return@registerForActivityResult
        pendingScreen = null
        val id = request.optString("id")
        if (result.resultCode != RESULT_OK || result.data == null) {
            screenEvent(JSONObject().put("id", id).put("event", "error").put("value", "Compartilhamento de tela cancelado."))
        } else {
            runCatching {
                ContextCompat.startForegroundService(this, Intent(this, ScreenShareService::class.java)
                    .putExtra("id", id).putExtra("sdp", request.optString("sdp"))
                    .putExtra("height", request.optInt("height", 720)).putExtra("fps", request.optInt("fps", 30))
                    .putExtra("audio", request.optBoolean("audio", false))
                    .putExtra("permission", result.data))
            }.onFailure {
                screenEvent(JSONObject().put("id", id).put("event", "error").put("value", "Não foi possível iniciar a captura."))
            }
        }
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (::webView.isInitialized) {
            webView.evaluateJavascript("window.__potatoSetNotificationPermission?.('${if (granted) "granted" else "denied"}')", null)
        }
    }

    private val mediaPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val request = mediaRequest ?: return@registerForActivityResult
        mediaRequest = null
        val resources = mutableListOf<String>()
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) resources += PermissionRequest.RESOURCE_AUDIO_CAPTURE
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in request.resources && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) resources += PermissionRequest.RESOURCE_VIDEO_CAPTURE
        if (resources.isEmpty()) request.deny() else request.grant(resources.toTypedArray())
        // A chamada começou antes da permissão do microfone: agora o serviço dela pode começar.
        callState?.let(::startCallService)
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
        CallBridge.page = { action -> runOnUiThread { js("window.potatoCall?.(${JSONObject.quote(action)})") } }
        ScreenShareBridge.page = ::screenEvent
        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                runOnUiThread { if (callState != null) js("window.potatoCall?.('network')") }
            }
        }.also { getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(it) }
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(18, 16, 13))
            addView(webView)
        }
        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            // Teclado aberto: o site encolhe até em cima dele. Sem isso o teclado cobria o fim da conversa.
            val bottom = if (isInPictureInPictureMode) 0 else maxOf(bars.bottom, insets.getInsets(WindowInsetsCompat.Type.ime()).bottom)
            val top = if (isInPictureInPictureMode) 0 else bars.top
            val params = webView.layoutParams as FrameLayout.LayoutParams
            if (params.topMargin != top || params.bottomMargin != bottom) {
                params.topMargin = top
                params.bottomMargin = bottom
                webView.layoutParams = params
            }
            // As barras já ficam de fora (as margens acima): o WebView não recebe as medidas delas, senão o site
            // (safe-area) deixaria o mesmo espaço de novo, uma faixa escura embaixo.
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
        ViewCompat.requestApplyInsets(root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (callState != null) {
                    if (!enterCallPip()) moveTaskToBack(true)
                } else if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        // Aberto por uma notificação: o site já começa na parte certa (#agenda, #cartinhas…), na conversa da mensagem
        // (#conversa=), atendendo a chamada (#atender=) ou ligando de volta (#ligar=).
        overLockForCall(intent)
        val hash = section(intent) ?: callHash(intent)
        webView.loadUrl(SITE_URL + hash?.let { "#$it" }.orEmpty())
    }

    // Com o app já aberto, a notificação só troca o que aparece (ou atende, liga, abre a conversa).
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        overLockForCall(intent)
        section(intent)?.let { webView.evaluateJavascript("window.potatoOpen && window.potatoOpen(${JSONObject.quote(it)})", null) }
        val action = intent.getStringExtra(CallNotifications.EXTRA_CALL_ACTION)
        val room = intent.getStringExtra(ChatNotifications.EXTRA_ROOM).orEmpty()
        when (action) {
            "return" -> js("window.potatoCall?.('return', ${JSONObject.quote(intent.getStringExtra(CallNotifications.EXTRA_CALL_ID).orEmpty())})")
            "accept" -> js("window.potatoCall && window.potatoCall('accept', ${JSONObject.quote(intent.getStringExtra(CallNotifications.EXTRA_CALL_ID).orEmpty())})")
            "dial" -> js("window.potatoCall && window.potatoCall('dial', ${JSONObject.quote(intent.getStringExtra(CallNotifications.EXTRA_MEDIA).orEmpty())}, ${JSONObject.quote(room)})")
            null -> if (room.isNotBlank()) js("window.potatoRoom && window.potatoRoom(${JSONObject.quote(room)})")
        }
    }

    private fun js(code: String) = webView.evaluateJavascript(code, null)

    private fun callHash(intent: Intent?): String? {
        val room = intent?.getStringExtra(ChatNotifications.EXTRA_ROOM).orEmpty()
        return when (intent?.getStringExtra(CallNotifications.EXTRA_CALL_ACTION)) {
            "accept" -> "atender=${intent.getStringExtra(CallNotifications.EXTRA_CALL_ID).orEmpty()}"
            "dial" -> "ligar=${intent.getStringExtra(CallNotifications.EXTRA_MEDIA).orEmpty()}:$room"
            else -> room.takeIf { it.isNotBlank() }?.let { "conversa=$it" }
        }
    }

    // Chamada tocando com o celular bloqueado (a notificação em tela cheia): o app aparece por cima, sem desbloquear,
    // até a chamada acabar.
    private fun overLockForCall(intent: Intent?) {
        if (intent?.getStringExtra(CallNotifications.EXTRA_CALL_ACTION) in setOf("show", "accept")) showOverLock(true)
    }

    private fun showOverLock(on: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(on)
            setTurnScreenOn(on)
        } else {
            @Suppress("DEPRECATION")
            val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            if (on) window.addFlags(flags) else window.clearFlags(flags)
        }
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
                userAgentString = "$userAgentString PotatoChatAndroid/3.0"
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

                // O processo do site caiu (pouca memória, com o app em segundo plano): sem isso o app fecharia. A chamada
                // que estava nele acabou; o app abre de novo.
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    callState = null
                    CallService.stop(this@MainActivity)
                    stopService(Intent(this@MainActivity, ScreenShareService::class.java))
                    recreate()
                    return true
                }
            }
            // Com o app fora da tela no meio de uma chamada, o site continua com a mesma prioridade (não é encerrado antes).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
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
                if (isMainFrame && sourceOrigin.toString().trimEnd('/') == SITE_ORIGIN) handleBridgeMessage(message.data.orEmpty())
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
                message.optString("tag"),
                message.optString("icon").takeIf { it.startsWith(SITE_ORIGIN) }
            )
            "permission" -> requestNotificationPermission()
            "call" -> onCallState(message)
            "screen-start" -> {
                if (pendingScreen != null) {
                    screenEvent(JSONObject().put("id", message.optString("id")).put("event", "error").put("value", "Já existe uma solicitação de captura."))
                } else if (lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) {
                    pendingScreen = message
                    runCatching { screenPermission.launch(getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent()) }
                        .onFailure { pendingScreen = null; screenEvent(JSONObject().put("id", message.optString("id")).put("event", "error").put("value", "Captura de tela indisponível.")) }
                } else screenEvent(JSONObject().put("id", message.optString("id")).put("event", "error").put("value", "Abra o aplicativo para iniciar a transmissão."))
            }
            "screen-stop" -> {
                if (pendingScreen?.optString("id") == message.optString("id")) pendingScreen = null
                stopService(Intent(this, ScreenShareService::class.java))
            }
            "pip" -> if (!enterCallPip()) js("window.potatoCall?.('pip-unavailable')")
            "pip-shape" -> {
                val width = message.optInt("width")
                val height = message.optInt("height")
                if (width > 0 && height > 0) {
                    // O Android aceita proporções entre 1:2,39 e 2,39:1.
                    pipRatio = Rational(((width.toDouble() / height).coerceIn(1.0 / 2.39, 2.39) * 10000).toInt(), 10000)
                    updatePip()
                }
            }
            // O convite (Adicionar pessoa): a janela de compartilhar do Android (WhatsApp, Instagram…).
            "share" -> runCatching {
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, message.optString("text"))
                startActivity(Intent.createChooser(send, "Mandar o convite"))
            }
        }
    }

    // O site avisa como está a chamada (active: começou, conectou, mudo; não: acabou). ringing = ainda tocando aqui.
    private fun onCallState(message: JSONObject) {
        if (!message.optBoolean("active")) {
            callState = null
            screenActive = false
            peerScreenActive = false
            peerVideoActive = false
            pipRatio = Rational(16, 9)
            pendingScreen = null
            stopService(Intent(this, ScreenShareService::class.java))
            CallService.stop(this)
            updatePip()
            if (isInPictureInPictureMode) moveTaskToBack(true)
            if (!message.optBoolean("ringing")) showOverLock(false)
            return
        }
        val state = CallService.State(
            message.optString("id"), message.optString("name"), message.optString("avatar").takeIf { it.isNotBlank() },
            message.optString("media"), message.optBoolean("connected"), message.optLong("since"), message.optBoolean("mic", true),
            message.optString("phase", if (message.optBoolean("connected")) "connected" else "calling"), message.optLong("waitingUntil"), message.optString("room")
        )
        callState = state
        screenActive = message.optBoolean("screen")
        peerScreenActive = message.optBoolean("peerScreen")
        peerVideoActive = message.optBoolean("peerVideo", peerScreenActive)
        startCallService(state)
        updatePip()
    }

    private fun screenEvent(payload: JSONObject) {
        if (::webView.isInitialized) js("window.dispatchEvent(new CustomEvent('potato-screen', {detail: $payload}))")
    }

    private fun pipParams(): PictureInPictureParams {
        val hangup = PendingIntent.getService(this, 73, Intent(this, CallService::class.java).setAction(CallService.ACTION_HANGUP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val action = RemoteAction(Icon.createWithResource(this, R.drawable.ic_notification), "Desligar", "Encerrar chamada", hangup)
        return PictureInPictureParams.Builder().setAspectRatio(pipRatio).setActions(listOf(action)).apply {
            if (Build.VERSION.SDK_INT >= 31) {
                // Preparamos a superfície de vídeo antes de entrar, evitando miniaturizar o site inteiro.
                setAutoEnterEnabled(false)
                setSeamlessResizeEnabled(false)
            }
        }.build()
    }

    private fun updatePip() {
        if (packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) runCatching { setPictureInPictureParams(pipParams()) }
    }

    private fun enterCallPip(): Boolean {
        if (callState == null || !peerVideoActive || pendingScreen != null || !packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return false
        if (isInPictureInPictureMode || pipPending) return true
        pipPending = true
        webView.evaluateJavascript("window.potatoCall?.('pip', true)") {
            webView.postOnAnimation {
                pipPending = false
                val entered = callState != null && peerVideoActive && pendingScreen == null && runCatching { enterPictureInPictureMode(pipParams()) }.getOrDefault(false)
                if (!entered) js("window.potatoCall?.('pip', false)")
            }
        }
        return true
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (peerVideoActive) enterCallPip()
    }

    override fun onPictureInPictureModeChanged(inPip: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(inPip, newConfig)
        js("window.potatoCall?.('pip', $inPip)")
        (webView.parent as? android.view.View)?.let { ViewCompat.requestApplyInsets(it) }
    }

    // O Android só deixa o microfone em segundo plano com a permissão dele já dada (senão o serviço nem começa).
    private fun startCallService(state: CallService.State) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return
        runCatching { CallService.update(this, state) }
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
              window.__potatoScreenCapture = true;
              window.__potatoScreenAudio = ${Build.VERSION.SDK_INT >= 29};
              const nativeStyle = document.createElement('style');
              nativeStyle.textContent = '@media (max-width:760px){.tabbar{padding-bottom:6px!important}}';
              if (document.head || document.documentElement) (document.head || document.documentElement).appendChild(nativeStyle);
              else document.addEventListener('DOMContentLoaded', () => document.head.appendChild(nativeStyle), {once:true});
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

    // Mensagem que o site avisou com a página escondida (tag "potato-chat:<conversa>"). A chamada tem a notificação
    // própria, do serviço em segundo plano.
    private fun showNotification(title: String, body: String, tag: String, icon: String?) {
        if (!tag.startsWith("potato-chat")) return
        if (!getSharedPreferences(PREFS, 0).getBoolean("notifications", true)) return
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        // A foto de quem mandou pode precisar ser baixada: fora da thread principal.
        val context = applicationContext
        val room = tag.substringAfter(':', "")
        Thread { ChatNotifications.showIncoming(context, room, title, body, icon) }.start()
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
        CallNotifications.createChannels(this)
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(MESSAGE_CHANNEL, "Mensagens", NotificationManager.IMPORTANCE_HIGH).apply { setShowBadge(true) })
        manager.createNotificationChannel(NotificationChannel(CALL_CHANNEL, "Chamadas", NotificationManager.IMPORTANCE_HIGH).apply { setShowBadge(false) })
    }

    override fun onStart() {
        super.onStart()
        stopService(Intent(this, ChatNotificationService::class.java))
        val notifications = getSystemService(NotificationManager::class.java)
        notifications.activeNotifications.filter { it.id != CallNotifications.ONGOING_ID && it.id != ScreenShareService.NOTIFICATION_ID }
            .forEach { notifications.cancel(it.tag, it.id) }
        callState?.let(::startCallService)
        ChatNotifications.clear(this)
        // O One UI cria um resumo automatico; limpa novamente depois que o servico termina.
        webView.postDelayed({
            // Não apagar as notificações dos serviços que mantêm a chamada e a captura ativas.
            notifications.activeNotifications.filter { it.id != CallNotifications.ONGOING_ID && it.id != ScreenShareService.NOTIFICATION_ID }
                .forEach { notifications.cancel(it.tag, it.id) }
        }, 500)
        // De volta à tela no meio de uma chamada: a câmera que desligou ao sair volta.
        if (callState != null) js("window.potatoCall && window.potatoCall('foreground')")
    }

    // Saindo da tela no meio de uma chamada: o Android não deixa a câmera continuar (o microfone continua).
    override fun onStop() {
        if (callState != null) js("window.potatoCall && window.potatoCall('background')")
        super.onStop()
    }

    private fun startBackgroundNotifications() {
        val prefs = getSharedPreferences(PREFS, 0)
        if (prefs.getString("token", "").orEmpty().isNotBlank() && prefs.getBoolean("notifications", true)) {
            runCatching { ContextCompat.startForegroundService(this, Intent(this, ChatNotificationService::class.java)) }
        }
    }

    override fun onResume() { super.onResume(); webView.onResume() }
    // Numa chamada o WebView não pausa: ela continua com o app em segundo plano.
    override fun onPause() {
        startBackgroundNotifications()
        if (callState == null) webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        CallBridge.page = null
        ScreenShareBridge.page = null
        networkCallback?.let { runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } }
        stopService(Intent(this, ScreenShareService::class.java))
        CallService.stop(this)
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
        val SITE_ORIGIN: String = Uri.parse(SITE_URL).let { "${it.scheme}://${it.encodedAuthority}" }
        val SITE_HOST: String = Uri.parse(SITE_URL).host.orEmpty()
        const val PREFS = "potato.webview"
        const val MESSAGE_CHANNEL = "potato_messages"
        const val CALL_CHANNEL = "potato_calls"
    }
}
