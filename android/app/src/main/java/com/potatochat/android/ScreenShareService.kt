package com.potatochat.android

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.content.res.Configuration
import android.view.WindowManager
import android.os.*
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import org.webrtc.*
import org.webrtc.audio.JavaAudioDeviceModule
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
    private var audio: PlaybackCapture? = null
    private var audioDevice: JavaAudioDeviceModule? = null
    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null
    private var captureSize = 1080
    private var captureFps = 30
    private var captureWidth = 0
    private var captureHeight = 0
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
                runCatching { capture(permission, intent.getStringExtra("sdp").orEmpty(), intent.getIntExtra("height", 1080), intent.getIntExtra("fps", 30), intent.getBooleanExtra("audio", false)) }
                    .onFailure { fail("Não foi possível capturar a tela: ${it.message.orEmpty()}") }
            }
            main.postDelayed({ if (!answered) fail("A conexão local de captura não respondeu.") }, 25000)
        } catch (error: Exception) { fail("Não foi possível iniciar a transmissão: ${error.message.orEmpty()}") }
        return START_NOT_STICKY
    }

    private fun capture(permission: Intent, offer: String, maxSize: Int, fps: Int, withAudio: Boolean) {
        captureSize = maxSize.coerceIn(720, 1080)
        captureFps = fps.coerceIn(15, 60)
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(applicationContext).createInitializationOptions())
        val context = EglBase.create().also { egl = it }.eglBaseContext
        // O ADM desta conexão recebe só playback. O microfone continua na chamada do WebView.
        val playback = PlaybackCapture { emit("audio-error", it) }.also { audio = it }
        audioDevice = JavaAudioDeviceModule.builder(applicationContext)
            .setSampleRate(48000).setUseStereoInput(true)
            .setUseHardwareAcousticEchoCanceler(false).setUseHardwareNoiseSuppressor(false)
            .setAudioBufferCallback { buffer, _, channels, rate, _, _ -> playback.read(buffer, channels, rate) }
            .createAudioDeviceModule().also { it.setAudioRecordEnabled(false) }
        factory = PeerConnectionFactory.builder()
            .setAudioDeviceModule(audioDevice)
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(context, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(context)).createPeerConnectionFactory()
        source = factory!!.createVideoSource(true)
        helper = SurfaceTextureHelper.create("PotatoScreen", context)
        capturer = ScreenCapturerAndroid(permission, object : MediaProjection.Callback() {
            override fun onStop() { main.post { stopSelf() } }
            override fun onCapturedContentResize(width: Int, height: Int) { work { resize(width, height) } }
        }).also { it.initialize(helper, applicationContext, source!!.capturerObserver) }
        val (width, height) = displaySize()
        resize(width, height)
        capturer!!.startCapture(captureWidth, captureHeight, captureFps)
        track = factory!!.createVideoTrack("potato-screen", source)
        if (withAudio && Build.VERSION.SDK_INT >= 29) {
            runCatching { playback.start(applicationContext, requireNotNull(capturer!!.mediaProjection)) }
                .onSuccess {
                    val constraints = MediaConstraints().apply {
                        listOf("googEchoCancellation", "googAutoGainControl", "googNoiseSuppression", "googHighpassFilter")
                            .forEach { mandatory.add(MediaConstraints.KeyValuePair(it, "false")) }
                    }
                    audioSource = factory!!.createAudioSource(constraints)
                    audioTrack = factory!!.createAudioTrack("potato-screen-audio", audioSource)
                }.onFailure { playback.stop(); playback.release(); emit("audio-error", "Não foi possível capturar o som interno. A tela continua sem esse áudio.") }
        }
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
            val transceiver = peer!!.transceivers.firstOrNull { it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO } ?: error("Faixa de vídeo ausente")
            transceiver.direction = RtpTransceiver.RtpTransceiverDirection.SEND_ONLY
            check(transceiver.sender.setTrack(track, false))
            peer!!.transceivers.firstOrNull { it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO }?.let {
                it.direction = if (audioTrack != null) RtpTransceiver.RtpTransceiverDirection.SEND_ONLY else RtpTransceiver.RtpTransceiverDirection.INACTIVE
                if (audioTrack != null) check(it.sender.setTrack(audioTrack, false))
            }
            peer!!.createAnswer(sdp(onCreate = { answer ->
                peer!!.setLocalDescription(sdp(onSet = {
                    // A primeira passagem é local: preserve os pixels antes da codificação para a internet.
                    val params = transceiver.sender.parameters
                    params.degradationPreference = RtpParameters.DegradationPreference.MAINTAIN_RESOLUTION
                    params.encodings.forEach { it.maxBitrateBps = 16000000; it.minBitrateBps = 4000000; it.maxFramerate = captureFps; it.scaleResolutionDownBy = 1.0 }
                    check(transceiver.sender.setParameters(params))
                    peer!!.setBitrate(4000000, 10000000, 16000000)
                    if (peer?.iceGatheringState() == PeerConnection.IceGatheringState.COMPLETE) answerReady()
                }), answer)
            }), MediaConstraints())
        }), SessionDescription(SessionDescription.Type.OFFER, offer))
    }

    private fun displaySize(): Pair<Int, Int> {
        val manager = getSystemService(WindowManager::class.java)
        if (Build.VERSION.SDK_INT >= 30) return manager.maximumWindowMetrics.bounds.let { it.width() to it.height() }
        val metrics = android.util.DisplayMetrics()
        @Suppress("DEPRECATION") manager.defaultDisplay.getRealMetrics(metrics)
        return metrics.widthPixels to metrics.heightPixels
    }

    private fun resize(width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        val scale = minOf(1.0, captureSize.toDouble() / minOf(width, height))
        val w = ((width * scale).toInt() / 2 * 2).coerceAtLeast(2)
        val h = ((height * scale).toInt() / 2 * 2).coerceAtLeast(2)
        if (w == captureWidth && h == captureHeight) return
        captureWidth = w; captureHeight = h
        source?.adaptOutputFormat(w, h, captureFps)
        capturer?.changeCaptureFormat(w, h, captureFps)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Android 14+ informa o tamanho do conteúdo escolhido; versões anteriores seguem o display.
        if (Build.VERSION.SDK_INT < 34) work { val (w, h) = displaySize(); resize(w, h) }
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
        val payload = JSONObject().put("id", id).put("event", event).put("value", value).put("audio", audioTrack != null)
        main.post { ScreenShareBridge.page?.invoke(payload) }
    }

    private fun fail(reason: String) { if (!closing) { emit("error", reason); main.post { stopSelf() } } }

    override fun onDestroy() {
        closing = true
        main.removeCallbacksAndMessages(null)
        emit("stopped")
        worker.execute {
            // Desbloqueia AudioRecord.read antes de o WebRTC aguardar sua thread de áudio.
            audio?.stop()
            // Remover o callback e parar a projeção antes de liberar a thread de textura.
            runCatching { capturer?.stopCapture() }
            runCatching { capturer?.dispose() }
            peer?.close(); peer?.dispose()
            audioTrack?.dispose(); audioSource?.dispose()
            track?.dispose(); source?.dispose(); helper?.dispose(); factory?.dispose(); audioDevice?.release(); audio?.release(); egl?.release()
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
