package com.potatochat.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors

/** O WebView reproduz; esta sessão publica o estado real e encaminha os controles à mesma fila. */
class MusicService : Service() {
    data class State(val uid: String, val room: String, val title: String, val artist: String, val cover: String,
        val duration: Long, val position: Long, val playing: Boolean, val buffering: Boolean,
        val muted: Boolean, val canSkip: Boolean)

    internal lateinit var mediaSession: MediaSession
        private set
    private val handler = Handler(Looper.getMainLooper())
    private val artworkWorker = Executors.newSingleThreadExecutor()
    private var artwork: MusicArtwork.Images? = null
    private var coverUrl = ""
    private var artworkLoading = false
    private var artworkAttempts = 0
    private var artworkRetryAt = 0L
    private var published: State? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val renew = object : Runnable {
        override fun run() {
            if (state?.let { it.playing || it.buffering } == true) wakeLock?.acquire(10 * 60 * 1000L)
            else wakeLock?.takeIf { it.isHeld }?.release()
            handler.postDelayed(this, 5 * 60 * 1000L)
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Música", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
        wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PotatoChat:musica").apply { setReferenceCounted(false) }
        mediaSession = MediaSession(this, "PotatoChatMusic").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() = dispatch("play")
                override fun onPause() = dispatch("pause")
                override fun onStop() = dispatch("stop")
                override fun onSkipToPrevious() = dispatch("previous")
                override fun onSkipToNext() = dispatch("next")
                override fun onSeekTo(pos: Long) = dispatch("seek", pos)
                override fun onCustomAction(action: String, extras: Bundle?) = dispatch(action)
            }, handler)
            isActive = true
        }
        handler.post(renew)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val current = state ?: run { stopSelf(); return START_NOT_STICKY }
        if (intent?.action in ACTIONS && intent?.getStringExtra(EXTRA_UID) == current.uid && intent.getStringExtra(EXTRA_ROOM) == current.room) {
            dispatch(intent.action!!)
        }
        render()
        return START_NOT_STICKY
    }

    private fun dispatch(action: String, position: Long? = null) {
        val current = state ?: return
        if (action == "next" && !current.canSkip) return
        if (!MusicBridge.send(action, current.uid, current.room, position)) stop(this)
    }

    private fun render() {
        val current = state ?: return
        if (current.cover != coverUrl) {
            coverUrl = current.cover
            artwork = MusicArtwork.cache.get(coverUrl)
            artworkLoading = false
            artworkAttempts = 0
            artworkRetryAt = 0L
        }
        if (artwork == null && coverUrl.startsWith("https://") && !artworkLoading && artworkAttempts < 3 && SystemClock.elapsedRealtime() >= artworkRetryAt) {
            val requested = coverUrl
            artworkLoading = true
            artworkAttempts++
            artworkWorker.execute {
                val loaded = MusicArtwork.load(requested)
                handler.post {
                    if (instance === this && coverUrl == requested) {
                        artworkLoading = false
                        artwork = loaded
                        artworkRetryAt = SystemClock.elapsedRealtime() + artworkAttempts * 10000L
                        if (loaded != null) { publishMetadata(); publishNotification() }
                    }
                }
            }
        }
        val playing = when { current.buffering -> PlaybackState.STATE_BUFFERING; current.playing -> PlaybackState.STATE_PLAYING; else -> PlaybackState.STATE_PAUSED }
        val actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
            PlaybackState.ACTION_STOP or PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SEEK_TO or
            (if (current.canSkip) PlaybackState.ACTION_SKIP_TO_NEXT else 0L)
        mediaSession.setPlaybackState(PlaybackState.Builder().setActions(actions)
            .setState(playing, current.position.coerceIn(0L, if (current.duration > 0) current.duration else Long.MAX_VALUE), if (current.playing) 1f else 0f, SystemClock.elapsedRealtime())
            .addCustomAction("mute", if (current.muted) "Ativar som" else "Silenciar música", if (current.muted) R.drawable.ic_volume_off else R.drawable.ic_volume)
            .addCustomAction("stop", "Parar música", R.drawable.ic_stop).build())
        if (published?.let { it.uid != current.uid || it.title != current.title || it.artist != current.artist || it.duration != current.duration || it.cover != current.cover } != false) publishMetadata()
        if (current.playing || current.buffering) { if (wakeLock?.isHeld != true) wakeLock?.acquire(10 * 60 * 1000L) }
        else wakeLock?.takeIf { it.isHeld }?.release()
        if (published?.copy(position = current.position) != current || (Build.VERSION.SDK_INT < 33 && published?.position != current.position)) publishNotification()
        published = current
    }

    private fun publishMetadata() {
        val current = state ?: return
        mediaSession.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_MEDIA_ID, current.uid)
            .putString(MediaMetadata.METADATA_KEY_TITLE, current.title).putString(MediaMetadata.METADATA_KEY_ARTIST, current.artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, "Potato Chat").putLong(MediaMetadata.METADATA_KEY_DURATION, current.duration)
            .apply { artwork?.let {
                putBitmap(MediaMetadata.METADATA_KEY_ART, it.background)
                putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it.cover)
                putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, it.cover)
            } }.build())
    }

    private fun publishNotification() {
        val current = state ?: return
        val open = PendingIntent.getActivity(this, 100, Intent(this, MainActivity::class.java)
            .setData(Uri.parse("potato://music/${current.uid}/open"))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("music_open", true).putExtra(EXTRA_UID, current.uid).putExtra(EXTRA_ROOM, current.room), PENDING_FLAGS)
        mediaSession.setSessionActivity(open)
        fun action(icon: Int, label: String, name: String, enabled: Boolean = true) = Notification.Action.Builder(icon, label,
            if (enabled) PendingIntent.getService(this, 101, Intent(this, MusicService::class.java).setAction(name)
                .setData(Uri.parse("potato://music/${current.uid}/$name"))
                .putExtra(EXTRA_UID, current.uid).putExtra(EXTRA_ROOM, current.room), PENDING_FLAGS) else null).build()
        val actions = listOf(
            action(R.drawable.ic_previous, "Voltar ao início", "previous"),
            action(if (current.playing || current.buffering) R.drawable.ic_pause else R.drawable.ic_play, if (current.playing || current.buffering) "Pausar" else "Reproduzir", if (current.playing || current.buffering) "pause" else "play"),
            action(R.drawable.ic_next, "Próxima", "next", current.canSkip),
            action(if (current.muted) R.drawable.ic_volume_off else R.drawable.ic_volume, if (current.muted) "Ativar som" else "Silenciar música", "mute"),
            action(R.drawable.ic_stop, "Parar música", "stop"))
        val notification = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(current.title).setContentText(current.artist).setSubText(if (current.buffering) "Carregando…" else if (current.muted) "Som silenciado neste aparelho" else "Potato Chat")
            .setLargeIcon(artwork?.cover).setColor(artwork?.color ?: 0x24201d).setColorized(artwork != null)
            .setContentIntent(open).setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT).setOnlyAlertOnce(true).setShowWhen(false)
            .setOngoing(current.playing || current.buffering).setAutoCancel(false)
            .apply { actions.forEach(::addAction) }
            .apply {
                // Android 13+ desenha o player a partir da MediaSession; os anteriores usam este corpo personalizado.
                val style = if (Build.VERSION.SDK_INT < 33) Notification.DecoratedMediaCustomViewStyle() else Notification.MediaStyle()
                setStyle(style.setMediaSession(mediaSession.sessionToken).setShowActionsInCompactView(0, 1, 2))
                if (Build.VERSION.SDK_INT < 33) {
                    setCustomContentView(contentView(R.layout.music_notification_compact, current))
                    setCustomBigContentView(contentView(R.layout.music_notification_expanded, current))
                }
            }
            .apply { if (Build.VERSION.SDK_INT >= 31) setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE) }.build()
        runCatching {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            else startForeground(NOTIFICATION_ID, notification)
        }.onFailure { stop(this) }
    }

    private fun contentView(layout: Int, current: State) = RemoteViews(packageName, layout).apply {
        setImageViewBitmap(R.id.music_background, artwork?.background)
        setImageViewBitmap(R.id.music_cover, artwork?.cover)
        setTextViewText(R.id.music_title, current.title)
        setTextViewText(R.id.music_artist, current.artist)
        setProgressBar(R.id.music_progress, 1000, if (current.duration > 0) ((current.position * 1000) / current.duration).coerceIn(0, 1000).toInt() else 0, current.buffering)
    }

    override fun onDestroy() {
        if (instance === this) { instance = null; state = null }
        handler.removeCallbacksAndMessages(null)
        artworkWorker.shutdownNow()
        wakeLock?.takeIf { it.isHeld }?.release()
        mediaSession.isActive = false
        mediaSession.release()
        stopForeground(STOP_FOREGROUND_REMOVE)
        getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL = "potato_music"
        const val NOTIFICATION_ID = 906
        const val EXTRA_UID = "music_uid"
        const val EXTRA_ROOM = "music_room"
        private const val PENDING_FLAGS = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        private val ACTIONS = setOf("play", "pause", "previous", "next", "mute", "stop")
        @Volatile private var state: State? = null
        @Volatile private var instance: MusicService? = null

        fun update(context: Context, next: State) {
            state = next
            val running = instance
            if (running != null) running.render()
            else runCatching { ContextCompat.startForegroundService(context, Intent(context, MusicService::class.java)) }
        }

        fun stop(context: Context) {
            state = null
            context.stopService(Intent(context, MusicService::class.java))
            context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
        }
    }

}

object MusicBridge {
    @Volatile var page: ((String, String, String, Long?) -> Unit)? = null
    fun send(action: String, uid: String, room: String, position: Long? = null): Boolean {
        val target = page ?: return false
        target(action, uid, room, position)
        return true
    }
}
