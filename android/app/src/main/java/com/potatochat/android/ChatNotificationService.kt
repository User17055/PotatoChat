package com.potatochat.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.potatochat.android.data.ChatEvent
import com.potatochat.android.data.ChatRepository
import com.potatochat.android.model.Session
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import java.util.UUID

/** Mantem o long polling ativo quando a WebView esta em segundo plano. */
class ChatNotificationService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var repository: ChatRepository? = null
    private var myName = ""
    private var connected = false
    private val pendingReplies = ArrayDeque<String>()

    override fun onCreate() {
        super.onCreate()
        createChannels()
        startForeground(FOREGROUND_ID, foregroundNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_SEND_REPLY) {
            intent.getStringExtra(EXTRA_REPLY_TEXT)?.trim()?.takeIf { it.isNotBlank() }?.let(pendingReplies::addLast)
        }
        if (repository != null) {
            if (connected) sendPendingReplies()
            return START_STICKY
        }
        val prefs = getSharedPreferences(MainActivity.PREFS, 0)
        val token = prefs.getString("token", "").orEmpty()
        myName = prefs.getString("name", "").orEmpty()
        if (token.isBlank() || !prefs.getBoolean("notifications", true)) {
            stopSelf()
            return START_NOT_STICKY
        }

        val chat = ChatRepository()
        repository = chat
        scope.launch {
            chat.events.collect { event ->
                when (event) {
                    is ChatEvent.Connected -> {
                        connected = event.connected
                        if (connected) sendPendingReplies()
                    }
                    is ChatEvent.Message -> if (!event.message.sender.equals(myName, ignoreCase = true)) {
                        ChatNotifications.showIncoming(this@ChatNotificationService, event.message.sender, event.message.text)
                    }
                    is ChatEvent.Signal -> if (event.event == "webrtc-offer") {
                        val name = event.data.optString("name", "Potato Chat")
                        val media = when (event.data.optString("media")) {
                            "video" -> "Chamada de video"
                            "screen" -> "Transmissao de tela"
                            else -> "Chamada de voz"
                        }
                        notifyCall("$name esta ligando", media)
                    }
                    else -> Unit
                }
            }
        }
        chat.connect(MainActivity.SITE_ORIGIN, Session(token, myName))
        return START_STICKY
    }

    private fun sendPendingReplies() {
        val chat = repository ?: return
        if (!connected || pendingReplies.isEmpty()) return
        scope.launch {
            while (connected && pendingReplies.isNotEmpty()) {
                val text = pendingReplies.removeFirst()
                chat.send(text, "android-reply-${UUID.randomUUID()}", null)
                    .onSuccess { ChatNotifications.showOutgoing(this@ChatNotificationService, text) }
            }
        }
    }

    private fun notifyCall(title: String, body: String) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val notification = NotificationCompat.Builder(this, MainActivity.CALL_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body.take(180))
            .setStyle(NotificationCompat.BigTextStyle().bigText(body.take(500)))
            .setContentIntent(openAppIntent())
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_NONE)
            .setNumber(0)
            .build()
        getSystemService(NotificationManager::class.java).notify(ChatNotifications.CALL_ID, notification)
    }

    private fun foregroundNotification() = NotificationCompat.Builder(this, BACKGROUND_CHANNEL)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle("Potato Chat")
        .setContentText("Conectado para receber mensagens")
        .setContentIntent(openAppIntent())
        .setOngoing(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setBadgeIconType(NotificationCompat.BADGE_ICON_NONE)
        .setNumber(0)
        .build()

    private fun openAppIntent(): PendingIntent {
        val intent = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun createChannels() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.deleteNotificationChannel("potato_background")
        manager.createNotificationChannel(NotificationChannel(BACKGROUND_CHANNEL, "Conexao em segundo plano", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
        manager.createNotificationChannel(NotificationChannel(MainActivity.MESSAGE_CHANNEL, "Mensagens", NotificationManager.IMPORTANCE_HIGH).apply { setShowBadge(true) })
        manager.createNotificationChannel(NotificationChannel(MainActivity.CALL_CHANNEL, "Chamadas", NotificationManager.IMPORTANCE_HIGH).apply { setShowBadge(false) })
    }

    override fun onDestroy() {
        repository?.disconnect()
        repository = null
        connected = false
        scope.cancel()
        stopForeground(STOP_FOREGROUND_REMOVE)
        getSystemService(NotificationManager::class.java).cancel(FOREGROUND_ID)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_SEND_REPLY = "com.potatochat.android.SEND_REPLY"
        const val EXTRA_REPLY_TEXT = "reply_text"
        private const val FOREGROUND_ID = 900
        private const val BACKGROUND_CHANNEL = "potato_background_silent"
    }
}
