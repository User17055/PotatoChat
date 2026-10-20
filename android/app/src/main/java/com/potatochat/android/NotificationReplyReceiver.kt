package com.potatochat.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat

/** Receives text typed in the Android notification and sends it without opening the app. */
class NotificationReplyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_REPLY) return
        val text = RemoteInput.getResultsFromIntent(intent)
            ?.getCharSequence(ChatNotifications.KEY_TEXT_REPLY)?.toString()?.trim().orEmpty()
        if (text.isBlank()) return

        val service = Intent(context, ChatNotificationService::class.java)
            .setAction(ChatNotificationService.ACTION_SEND_REPLY)
            .putExtra(ChatNotificationService.EXTRA_REPLY_TEXT, text)
        ContextCompat.startForegroundService(context, service)
    }

    companion object {
        const val ACTION_REPLY = "com.potatochat.android.REPLY"
    }
}
