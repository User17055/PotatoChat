package com.potatochat.android

import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.content.ContextCompat

/**
 * A chamada aberta no site (no WebView) com o app em segundo plano ou a tela desligada. O Android só deixa usar o
 * microfone fora da tela com um serviço em primeiro plano do tipo microfone: é este, que existe enquanto a chamada
 * existe (o site avisa pelo PotatoAndroid, mensagem "call"). Ele mostra a notificação de chamada (desligar, mudo; tocar
 * volta para o app) e mantém o celular acordado. Desligar e mudo vão para o site pelo CallBridge.
 */
class CallService : Service() {
    /** O que a notificação mostra: com quem, o tipo, se já conectou (e desde quando), se o microfone está ligado. */
    data class State(val id: String, val name: String, val avatar: String?, val media: String, val connected: Boolean, val since: Long, val mic: Boolean)

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        CallNotifications.createChannels(this)
        wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PotatoChat:chamada").apply {
            setReferenceCounted(false)
            acquire(6 * 60 * 60 * 1000L)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_HANGUP -> if (!CallBridge.send("hangup")) stopSelf()
            ACTION_MUTE -> CallBridge.send("mute")
        }
        val current = state ?: run {
            stopSelf()
            return START_NOT_STICKY
        }
        // Sem a permissão do microfone (ou começando com o app já fora da tela), o Android não deixa: sem o serviço, a
        // chamada continua só com o app aberto.
        runCatching {
            val notification = CallNotifications.ongoing(this, current, Avatars.get(this, current.name, null))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(CallNotifications.ONGOING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            else startForeground(CallNotifications.ONGOING_ID, notification)
        }.onFailure {
            stopSelf()
            return START_NOT_STICKY
        }
        refreshAvatar(this, current)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        wakeLock?.takeIf { it.isHeld }?.release()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_HANGUP = "com.potatochat.android.CALL_HANGUP"
        const val ACTION_MUTE = "com.potatochat.android.CALL_MUTE"

        @Volatile private var state: State? = null
        @Volatile private var running = false

        /** A chamada mudou (começou, conectou, mudo): o serviço começa, ou só a notificação muda. */
        fun update(context: Context, next: State) {
            val changed = state
            state = next
            if (!running) {
                ContextCompat.startForegroundService(context, Intent(context, CallService::class.java))
                return
            }
            if (changed == next) return
            context.getSystemService(NotificationManager::class.java).notify(CallNotifications.ONGOING_ID, CallNotifications.ongoing(context, next, Avatars.get(context, next.name, null)))
            refreshAvatar(context, next)
        }

        fun stop(context: Context) {
            state = null
            if (running) context.stopService(Intent(context, CallService::class.java))
        }

        // A foto de quem está na chamada pode precisar ser baixada: fora da thread principal, e a notificação é refeita.
        private fun refreshAvatar(context: Context, shown: State) {
            val url = shown.avatar ?: return
            val app = context.applicationContext
            Thread {
                val photo = Avatars.get(app, shown.name, url)
                if (running && state == shown) app.getSystemService(NotificationManager::class.java).notify(CallNotifications.ONGOING_ID, CallNotifications.ongoing(app, shown, photo))
            }.start()
        }
    }
}

/** Leva o que foi tocado na notificação da chamada (desligar, mudo) ao site aberto no app (MainActivity). */
object CallBridge {
    @Volatile var page: ((String) -> Unit)? = null

    /** false = o app não está aberto (não tem site para avisar). */
    fun send(action: String): Boolean {
        val target = page ?: return false
        target(action)
        return true
    }
}
