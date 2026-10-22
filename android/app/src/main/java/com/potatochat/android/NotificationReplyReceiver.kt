package com.potatochat.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat

/**
 * O que foi escrito (ou tocado) numa notificação, mandado sem abrir o app: a resposta a uma mensagem da conversa
 * (ACTION_REPLY) ou a um lembrete da rotina (ACTION_ROUTINE: "O que você almoçou?", "Acordei agora", "Fiz tudo").
 * Quem envia é o serviço (ChatNotificationService), que fica conectado ao chat.
 */
class NotificationReplyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val text = RemoteInput.getResultsFromIntent(intent)?.let { results ->
            results.getCharSequence(ChatNotifications.KEY_TEXT_REPLY) ?: results.getCharSequence(CantinhoNotifications.KEY_ANSWER)
        }?.toString()?.trim().orEmpty()
        val service = Intent(context, ChatNotificationService::class.java)
        when (intent.action) {
            ACTION_REPLY -> {
                if (text.isBlank()) return
                service.setAction(ChatNotificationService.ACTION_SEND_REPLY).putExtra(ChatNotificationService.EXTRA_REPLY_TEXT, text)
            }
            ACTION_ROUTINE -> {
                // "Acordei agora" e "Fiz tudo" vêm sem texto: o servidor usa a hora do aparelho ou marca todos os hábitos.
                val field = intent.getStringExtra(CantinhoNotifications.EXTRA_FIELD) ?: return
                val day = intent.getStringExtra(CantinhoNotifications.EXTRA_DAY) ?: return
                if (text.isBlank() && field != "acordar" && field != "rotina") return
                service.setAction(ChatNotificationService.ACTION_ROUTINE_REPLY)
                    .putExtra(CantinhoNotifications.EXTRA_FIELD, field)
                    .putExtra(CantinhoNotifications.EXTRA_DAY, day)
                    .putExtra(CantinhoNotifications.EXTRA_NOTIFICATION, intent.getIntExtra(CantinhoNotifications.EXTRA_NOTIFICATION, 0))
                    .putExtra(ChatNotificationService.EXTRA_REPLY_TEXT, text)
            }
            else -> return
        }
        ContextCompat.startForegroundService(context, service)
    }

    companion object {
        const val ACTION_REPLY = "com.potatochat.android.REPLY"
        const val ACTION_ROUTINE = "com.potatochat.android.ROUTINE"
    }
}
