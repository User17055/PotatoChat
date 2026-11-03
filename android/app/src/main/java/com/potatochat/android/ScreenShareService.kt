package com.potatochat.android

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.os.*
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import org.webrtc.*
import java.util.concurrent.Executors

/** Captura no Android e entrega uma faixa WebRTC ao site por uma conexão local, sem servidor de mídia. */
class ScreenShareService : Service() {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var id = ""
    private var egl: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var peer: PeerConnection? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var helper: SurfaceTextureHelper? = null
    private var source: VideoSource? = null
    private var track: VideoTrack? = null
    @Volatile private var answered = false
    @Volatile private var closing = false

    private fun work(task: () -> Unit) {
        if (!closing) runCatching { worker.execute { if (!closing) task() } }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) {
            if (intent.getStringExtra("id").isNullOrEmpty() || intent.getStringExtra("id") == id) stopSelf()
            return START_NOT_STICKY
        }
        if (id.isNotEmpty() || intent == null) return START_NOT_STICKY
        id = intent.getStringExtra("id").orEmpty()
        val permission = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra("permission", Intent::class.java)
            else @Suppress("DEPRECATION") intent.getParcelableExtra<Intent>("permission")
        if (permission == null || id.isBlank()) { stopSelf(); return START_NOT_STICKY }
        try {
            // O serviço deve estar em primeiro plano ANTES de obter a projeção (Android 14+).
            val stop = PendingIntent.getService(this, 71, Intent(this, ScreenShareService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val open = PendingIntent.getActivity(this, 72, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Transmissão de tela", NotificationManager.IMPORTANCE_LOW))
            val notification = NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification).setContentTitle("Transmitindo sua tela")
                .setContentText("Toque para voltar à chamada").setContentIntent(open)
                .setOngoing(true).setOnlyAlertOnce(true)
                .addAction(R.drawable.ic_notification, "Parar transmissão", stop).build()
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
            else startForeground(NOTIFICATION_ID, notification)
            work {
                runCatching { capture(permission, intent.getStringExtra("sdp").orEmpty(), intent.getIntExtra("height", 720), intent.getIntExtra("fps", 30)) }
                    .onFailure { fail("Não foi possível capturar a tela: ${it.message.orEmpty()}") }
            }
            main.postDelayed({ if (!answered) fail("A conexão local de captura não respondeu.") }, 25000)
        } catch (error: Exception) { fail("Não foi possível iniciar a transmissão: ${error.message.orEmpty()}") }
        return START_NOT_STICKY
    }

    private fun capture(permission: Intent, offer: String, maxSize: Int, fps: Int) {
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(applicationContext).createInitializationOptions())
        val context = EglBase.create().also { egl = it }.eglBaseContext
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(context, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(context)).createPeerConnectionFactory()
        source = factory!!.createVideoSource(true)
        helper = SurfaceTextureHelper.create("PotatoScreen", context)
        capturer = ScreenCapturerAndroid(permission, object : MediaProjection.Callback() {
            override fun onStop() { main.post { stopSelf() } }
        }).also { it.initialize(helper, applicationContext, source!!.capturerObserver) }
        val metrics = resources.displayMetrics
        val scale = minOf(1.0, maxSize.coerceIn(720, 1080).toDouble() / minOf(metrics.widthPixels, metrics.heightPixels))
        val width = ((metrics.widthPixels * scale).toInt() / 2 * 2).coerceAtLeast(2)
        val height = ((metrics.heightPixels * scale).toInt() / 2 * 2).coerceAtLeast(2)
        source!!.adaptOutputFormat(width, height, fps.coerceIn(15, 60))
        capturer!!.startCapture(width, height, fps)
        track = factory!!.createVideoTrack("potato-screen", source)
        val config = PeerConnection.RTCConfiguration(emptyList()).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
        peer = factory!!.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                if (state == PeerConnection.IceConnectionState.FAILED) fail("A conexão local de captura foi interrompida.")
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {
                if (state == PeerConnection.IceGatheringState.COMPLETE) work { answerReady() }
            }
            override fun onIceCandidate(candidate: IceCandidate?) {}
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
            override fun onAddStream(stream: MediaStream?) {}
            override fun onRemoveStream(stream: MediaStream?) {}
            override fun onDataChannel(channel: DataChannel?) {}
            override fun onRenegotiationNeeded() {}
        }) ?: error("WebRTC indisponível")
        peer!!.setRemoteDescription(sdp(onSet = {
            val transceiver = peer!!.transceivers.firstOrNull() ?: error("Faixa de vídeo ausente")
            transceiver.direction = RtpTransceiver.RtpTransceiverDirection.SEND_ONLY
            check(transceiver.sender.setTrack(track, false))
            peer!!.createAnswer(sdp(onCreate = { answer ->
                peer!!.setLocalDescription(sdp(onSet = {
                    if (peer?.iceGatheringState() == PeerConnection.IceGatheringState.COMPLETE) answerReady()
                }), answer)
            }), MediaConstraints())
        }), SessionDescription(SessionDescription.Type.OFFER, offer))
    }

    private fun answerReady() {
        if (answered) return
        val answer = peer?.localDescription ?: return
        answered = true
        emit("answer", answer.description)
    }

    private fun sdp(onCreate: (SessionDescription) -> Unit = {}, onSet: () -> Unit = {}) = object : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) { work { runCatching { onCreate(description) }.onFailure { fail(it.message.orEmpty()) } } }
        override fun onSetSuccess() { work { runCatching(onSet).onFailure { fail(it.message.orEmpty()) } } }
        override fun onCreateFailure(error: String?) { fail(error.orEmpty()) }
        override fun onSetFailure(error: String?) { fail(error.orEmpty()) }
    }

    private fun emit(event: String, value: String = "") {
        val payload = JSONObject().put("id", id).put("event", event).put("value", value)
        main.post { ScreenShareBridge.page?.invoke(payload) }
    }

    private fun fail(reason: String) { if (!closing) { emit("error", reason); main.post { stopSelf() } } }

    override fun onDestroy() {
        closing = true
        main.removeCallbacksAndMessages(null)
        emit("stopped")
        worker.execute {
            // Remover o callback e parar a projeção antes de liberar a thread de textura.
            runCatching { capturer?.stopCapture() }
            runCatching { capturer?.dispose() }
            peer?.close(); peer?.dispose()
            track?.dispose(); source?.dispose(); helper?.dispose(); factory?.dispose(); egl?.release()
        }
        worker.shutdown()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    companion object {
        const val STOP = "com.potatochat.android.SCREEN_STOP"
        const val CHANNEL = "potato_screen"
        const val NOTIFICATION_ID = 503
    }
}

object ScreenShareBridge {
    var page: ((JSONObject) -> Unit)? = null
}
