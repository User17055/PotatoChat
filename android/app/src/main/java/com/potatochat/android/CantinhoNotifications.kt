package com.potatochat.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput

/**
 * Notificações do Nosso cantinho (veja "nosso cantinho" em lib/potato.php):
 * - lembretes da rotina ("O que você almoçou?"), com o Responder na própria notificação (a resposta vai para o dia da
 *   pessoa sem abrir o app) e, no da rotina, o "Fiz tudo";
 * - lembretes dos compromissos da agenda;
 * - novidades da outra pessoa (cartinha nova, compromisso marcado, sonho realizado, o que comeu…).
 * Tocar abre o app direto na parte certa (extra EXTRA_OPEN).
 */
object CantinhoNotifications {
    const val REMINDER_CHANNEL = "potato_reminders"
    const val UPDATES_CHANNEL = "potato_cantinho"
    const val KEY_ANSWER = "potato_answer"
    const val EXTRA_FIELD = "field"
    const val EXTRA_DAY = "day"
    const val EXTRA_NOTIFICATION = "notification_id"
    const val EXTRA_OPEN = "open"
    private const val UPDATES_ID = 950

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(REMINDER_CHANNEL, "Lembretes", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Rotina do dia (dá para responder na notificação) e compromissos da agenda"
        })
        manager.createNotificationChannel(NotificationChannel(UPDATES_CHANNEL, "Nosso cantinho", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Cartinhas, agenda, sonhos e a rotina da outra pessoa"
        })
    }

    /** Abre o app na parte do Nosso cantinho (hoje, agenda, sonhos, cartinhas, jogos). */
    fun openIntent(context: Context, section: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_OPEN, section)
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /**
     * Lembrete. field = o que ele pergunta (acordar, cafe, almoco, lanche, jantar, rotina) ou null num compromisso;
     * reply = dá para responder escrevendo.
     */
    fun showReminder(context: Context, id: Int, title: String, text: String, field: String?, day: String, reply: Boolean) {
        if (!allowed(context)) return
        val builder = NotificationCompat.Builder(context, REMINDER_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(openIntent(context, if (field == null) "agenda" else "hoje", id))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(if (field == null) NotificationCompat.CATEGORY_EVENT else NotificationCompat.CATEGORY_REMINDER)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_NONE)
        if (field != null && reply) {
            val input = RemoteInput.Builder(KEY_ANSWER).setLabel(if (field == "acordar") "Que horas? (ex.: 7:30)" else "Conta aqui…").build()
            val action = NotificationCompat.Action.Builder(R.drawable.ic_notification, "Responder", answerIntent(context, id, field, day, mutable = true))
                .addRemoteInput(input)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                .setShowsUserInterface(false)
                .build()
            builder.addAction(action)
            if (field == "acordar") builder.addAction(R.drawable.ic_notification, "Acordei agora", answerIntent(context, id + 1, field, day, mutable = false, notification = id))
        }
        if (field == "rotina") builder.addAction(R.drawable.ic_notification, "Fiz tudo", answerIntent(context, id, field, day, mutable = false))
        context.getSystemService(NotificationManager::class.java).notify(id, builder.build())
    }

    /** Depois de responder: a notificação vira "Anotado!" (o Android espera uma atualização) e some sozinha. */
    fun showAnswered(context: Context, id: Int, ok: Boolean) {
        if (!allowed(context)) return
        val notification = NotificationCompat.Builder(context, REMINDER_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (ok) "Anotado!" else "Não deu para anotar")
            .setContentText(if (ok) "Já está na sua rotina de hoje." else "Abra o app e conte por lá.")
            .setContentIntent(openIntent(context, "hoje", id))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(if (ok) 2500 else 20_000)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(id, notification)
    }

    /** Novidade da outra pessoa no Nosso cantinho. */
    fun showUpdate(context: Context, title: String, text: String, section: String, sender: String, avatarUrl: String?) {
        if (!allowed(context)) return
        val builder = NotificationCompat.Builder(context, UPDATES_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(openIntent(context, section, UPDATES_ID))
            .setAutoCancel(true)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
        runCatching { builder.setLargeIcon(Avatars.get(context, sender, avatarUrl)) }
        context.getSystemService(NotificationManager::class.java).notify(UPDATES_ID + (section.hashCode() and 0xff), builder.build())
    }

    private fun answerIntent(context: Context, requestCode: Int, field: String, day: String, mutable: Boolean, notification: Int = requestCode): PendingIntent {
        val intent = Intent(context, NotificationReplyReceiver::class.java)
            .setAction(NotificationReplyReceiver.ACTION_ROUTINE)
            .putExtra(EXTRA_FIELD, field)
            .putExtra(EXTRA_DAY, day)
            .putExtra(EXTRA_NOTIFICATION, notification)
        // O campo de resposta precisa de um PendingIntent mutável (o Android põe o texto nele).
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (mutable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, requestCode, intent, flags)
    }

    private fun allowed(context: Context): Boolean =
        context.getSharedPreferences(MainActivity.PREFS, 0).getBoolean("notifications", true) &&
            (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
}
