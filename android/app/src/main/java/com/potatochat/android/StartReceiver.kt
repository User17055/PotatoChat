package com.potatochat.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/**
 * Celular ligado (ou o app atualizado): a conexão em segundo plano volta sozinha, sem precisar abrir o app. Sem isso,
 * depois de reiniciar o celular ninguém conseguiria ligar nem mandar mensagem com aviso até o app ser aberto.
 */
class StartReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val prefs = context.getSharedPreferences(MainActivity.PREFS, 0)
        if (prefs.getString("token", "").isNullOrBlank() || !prefs.getBoolean("notifications", true)) return
        runCatching { ContextCompat.startForegroundService(context, Intent(context, ChatNotificationService::class.java)) }
    }
}
