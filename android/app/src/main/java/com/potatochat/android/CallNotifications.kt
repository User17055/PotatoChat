package com.potatochat.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat

/**
 * Notificações de chamada (veja "chamadas" em lib/potato.php):
 * - chamada recebida: toca com o toque do celular (também bloqueado, em tela cheia), com Atender e Recusar. Depois de
 *   tocar, a chamada continua aberta: a notificação vira "está te esperando na chamada", sem som, com o Entrar;
 * - chamada perdida, com o Ligar de volta;
 * - a chamada em andamento (a do CallService), com o desligar e o mudo.
 * Atender, Entrar e Ligar de volta abrem o app (MainActivity, extras EXTRA_CALL_ACTION, EXTRA_CALL_ID, EXTRA_ROOM e
 * EXTRA_MEDIA); recusar vai pelo NotificationReplyReceiver, sem abrir o app.
 */
object CallNotifications {
    const val RING_CHANNEL = "potato_ring"
    const val ONGOING_CHANNEL = "potato_call_ongoing"
    const val RING_ID = ChatNotifications.CALL_ID
    const val MISSED_ID = 903
    const val ONGOING_ID = 904
    const val EXTRA_CALL_ACTION = "call_action"
    const val EXTRA_CALL_ID = "call_id"
    const val EXTRA_ROOM = "room"
    const val EXTRA_MEDIA = "media"
    private val MEDIA = mapOf("audio" to "Chamada de voz", "video" to "Chamada de vídeo", "screen" to "Transmissão de tela")

    /** Uma chamada para esta pessoa (o aviso call-ring do site). */
    data class Incoming(val id: String, val room: String, val caller: String, val media: String)

    fun mediaLabel(media: String) = MEDIA[media] ?: "Chamada"

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(RING_CHANNEL, "Chamadas recebidas", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Toca quando alguém liga (também com o app fechado)"
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            )
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 900, 700, 900)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setShowBadge(false)
        })
        manager.createNotificationChannel(NotificationChannel(ONGOING_CHANNEL, "Chamada em andamento", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Mantém a chamada com o app em segundo plano"
            setShowBadge(false)
        })
        manager.createNotificationChannel(NotificationChannel(MainActivity.CALL_CHANNEL, "Chamadas", NotificationManager.IMPORTANCE_HIGH).apply { setShowBadge(false) })
    }

    /** Abre o app para uma chamada: accept (atender), show (só mostrar a janela de atender) ou dial (ligar de volta). */
    fun openIntent(context: Context, action: String, requestCode: Int, id: String = "", room: String = "", media: String = ""): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_CALL_ACTION, action)
            .putExtra(EXTRA_CALL_ID, id)
            .putExtra(EXTRA_ROOM, room)
            .putExtra(EXTRA_MEDIA, media)
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /**
     * Chamada recebida. ringing = ainda tocando (som, tela cheia; some sozinha em ringMs); senão, "está te esperando".
     * Baixa a foto (Avatars): chame fora da thread principal.
     */
    fun showIncoming(context: Context, call: Incoming, avatarUrl: String?, ringing: Boolean, ringMs: Long) {
        if (!allowed(context)) return
        val person = person(context, call.caller, avatarUrl)
        val accept = openIntent(context, "accept", 30, call.id, call.room)
        val show = openIntent(context, "show", 31, call.id, call.room)
        val decline = PendingIntent.getBroadcast(
            context, 32,
            Intent(context, NotificationReplyReceiver::class.java).setAction(NotificationReplyReceiver.ACTION_DECLINE_CALL).putExtra(EXTRA_CALL_ID, call.id),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val title = if (ringing) "${call.caller} está ligando" else "${call.caller} está te esperando na chamada"
        val builder = { style: Boolean ->
            NotificationCompat.Builder(context, if (ringing) RING_CHANNEL else MainActivity.CALL_CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setLargeIcon(Avatars.get(context, call.caller, avatarUrl))
                .setContentTitle(title)
                .setContentText(mediaLabel(call.media))
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(show)
                .setOngoing(ringing)
                .setAutoCancel(!ringing)
                .setOnlyAlertOnce(!ringing)
                .setBadgeIconType(NotificationCompat.BADGE_ICON_NONE)
                .apply {
                    if (ringing) {
                        setFullScreenIntent(show, true)
                        setTimeoutAfter(ringMs.coerceAtLeast(1000))
                    }
                    if (style) setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, accept))
                    else {
                        addAction(R.drawable.ic_notification, if (ringing) "Recusar" else "Agora não", decline)
                        addAction(R.drawable.ic_notification, if (ringing) "Atender" else "Entrar", accept)
                    }
                }
                .build()
                .apply { if (ringing) flags = flags or Notification.FLAG_INSISTENT }
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        // O estilo de chamada do Android só vale com tela cheia (sem a permissão dela, ou esperando, vai o comum).
        runCatching { manager.notify(RING_ID, builder(ringing)) }.onFailure { manager.notify(RING_ID, builder(false)) }
    }

    fun cancelIncoming(context: Context) {
        context.getSystemService(NotificationManager::class.java).cancel(RING_ID)
    }

    /** Chamada perdida, com o Ligar de volta (na mesma conversa). */
    fun showMissed(context: Context, caller: String, media: String, room: String, avatarUrl: String?) {
        if (!allowed(context)) return
        val notification = NotificationCompat.Builder(context, MainActivity.CALL_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setLargeIcon(Avatars.get(context, caller, avatarUrl))
            .setContentTitle("Chamada perdida de $caller")
            .setContentText(mediaLabel(media))
            .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
            .setContentIntent(ChatNotifications.openIntent(context, room))
            .addAction(R.drawable.ic_notification, "Ligar de volta", openIntent(context, "dial", 33, room = room, media = if (media == "video") "video" else "audio"))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_NONE)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(MISSED_ID, notification)
    }

    /** A chamada em andamento (a do CallService): o tempo dela, o desligar e o mudo; tocar volta para a chamada. */
    fun ongoing(context: Context, state: CallService.State, avatar: android.graphics.Bitmap): Notification {
        val person = Person.Builder().setName(state.name.ifBlank { "Chamada" }).setKey(state.name).setIcon(IconCompat.createWithBitmap(avatar)).setImportant(true).build()
        val hangUp = PendingIntent.getService(context, 40, Intent(context, CallService::class.java).setAction(CallService.ACTION_HANGUP)
            .setData(android.net.Uri.parse("potato://call/${state.id}/hangup")).putExtra(EXTRA_CALL_ID, state.id), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val mute = PendingIntent.getService(context, 41, Intent(context, CallService::class.java).setAction(CallService.ACTION_MUTE)
            .setData(android.net.Uri.parse("potato://call/${state.id}/mute")).putExtra(EXTRA_CALL_ID, state.id), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val open = openIntent(context, "return", 42, state.id, state.room, state.media)
        val waiting = state.phase == "waiting" && state.waitingUntil > 0
        val status = when (state.phase) {
            "waiting" -> "${state.name} está ausente · aguardando retorno"
            "reconnecting" -> "Reconectando com ${state.name}…"
            "connecting" -> "Conectando com ${state.name}…"
            "calling" -> "Chamando ${state.name}…"
            else -> "Em chamada · ${mediaLabel(state.media)}"
        } + if (state.mic) "" else " · microfone silenciado"
        return NotificationCompat.Builder(context, ONGOING_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(state.name)
            .setContentText(status)
            .setSubText(status)
            .setLargeIcon(avatar)
            .setStyle(NotificationCompat.CallStyle.forOngoingCall(person, hangUp))
            .addAction(if (state.mic) R.drawable.ic_mic else R.drawable.ic_mic_off, if (state.mic) "Silenciar" else "Ativar microfone", mute)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(open)
            .setOngoing(true)
            .setAutoCancel(false)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setOnlyAlertOnce(true)
            .setUsesChronometer(waiting || (state.connected && state.since > 0))
            .setChronometerCountDown(waiting)
            .setWhen(if (waiting) state.waitingUntil else if (state.connected && state.since > 0) state.since else System.currentTimeMillis())
            .setShowWhen(waiting || (state.connected && state.since > 0))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_NONE)
            .build().apply { flags = flags or Notification.FLAG_ONGOING_EVENT or Notification.FLAG_NO_CLEAR }
    }

    private fun person(context: Context, name: String, avatarUrl: String?) =
        Person.Builder().setName(name).setKey(name).setIcon(IconCompat.createWithBitmap(Avatars.get(context, name, avatarUrl))).setImportant(true).build()

    private fun allowed(context: Context): Boolean =
        context.getSharedPreferences(MainActivity.PREFS, 0).getBoolean("notifications", true) &&
            (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
}
