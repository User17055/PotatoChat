package com.potatochat.android

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * A notificação única da conversa, no estilo de mensagens do Android: a foto de quem mandou em cada mensagem,
 * o histórico recente (a conversa de antes também, para dar contexto) e o responder direto da barra.
 * Baixa fotos (Avatars): chame fora da thread principal.
 */
object ChatNotifications {
    const val MESSAGE_ID = 901
    const val CALL_ID = 902
    const val KEY_TEXT_REPLY = "potato_text_reply"
    private const val HISTORY_KEY = "notification_history"
    private const val AVATARS_KEY = "notification_avatars"
    private const val MAX_HISTORY = 10
    // Mensagens de antes que entram como contexto na primeira notificação (mais que isso, ela fica comprida demais).
    private const val EARLIER = 4
    private const val SHORTCUT_ID = "potato_conversation"

    /** Uma mensagem da conversa (earlier = as de antes da nova, que entram como contexto na primeira notificação). */
    data class Line(val sender: String, val text: String, val time: Long, val mine: Boolean)

    /** Lembra as fotos de perfil (nome → endereço) para as próximas notificações. */
    fun rememberAvatars(context: Context, avatars: Map<String, String?>) {
        val json = JSONObject()
        avatars.forEach { (name, url) -> if (url != null) json.put(name, url) }
        prefs(context).edit().putString(AVATARS_KEY, json.toString()).apply()
    }

    @Synchronized
    fun showIncoming(context: Context, sender: String, body: String, avatarUrl: String? = null, earlier: List<Line> = emptyList()) {
        val now = System.currentTimeMillis()
        val text = body.ifBlank { "Nova mensagem" }
        val messages = readHistory(context)
        // A mesma mensagem pode chegar pelo site e pelo serviço ao mesmo tempo: entra uma vez só.
        if (messages.any { it.sender == sender && it.text == text && now - it.time < 15_000 }) return
        if (messages.isEmpty()) messages += earlier.takeLast(EARLIER).map { NotificationMessage(it.sender, it.text, it.time, it.mine, fresh = false) }
        messages += NotificationMessage(sender, text, now, mine = false, fresh = true)
        if (avatarUrl != null) rememberAvatars(context, readAvatars(context) + (sender to avatarUrl))
        writeHistory(context, messages.takeLast(MAX_HISTORY))
        showConversation(context, messages.takeLast(MAX_HISTORY), sender, true)
    }

    @Synchronized
    fun showOutgoing(context: Context, body: String) {
        val myName = myName(context)
        val messages = readHistory(context).apply {
            add(NotificationMessage(myName, body, System.currentTimeMillis(), mine = true, fresh = false))
        }.takeLast(MAX_HISTORY)
        writeHistory(context, messages)
        val sender = messages.lastOrNull { !it.mine }?.sender ?: "Potato Chat"
        showConversation(context, messages, sender, false)
    }

    @Synchronized
    fun clear(context: Context) {
        prefs(context).edit().remove(HISTORY_KEY).apply()
        context.getSystemService(NotificationManager::class.java).cancel(MESSAGE_ID)
    }

    private fun showConversation(context: Context, messages: List<NotificationMessage>, sender: String, alert: Boolean) {
        val avatars = readAvatars(context)
        val myName = myName(context)
        val person = { name: String -> Person.Builder().setName(name).setKey(name).setIcon(IconCompat.createWithBitmap(Avatars.get(context, name, avatars[name]))).build() }
        val me = person(myName)
        val people = mutableMapOf<String, Person>()
        val style = NotificationCompat.MessagingStyle(me).setGroupConversation(false)
        messages.forEach { message ->
            style.addMessage(message.text.take(500), message.time, if (message.mine) null else people.getOrPut(message.sender) { person(message.sender) })
        }
        val senderPerson = people[sender] ?: person(sender)
        publishShortcut(context, senderPerson)

        val openIntent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val openPending = PendingIntent.getActivity(
            context, 0, openIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val replyInput = RemoteInput.Builder(KEY_TEXT_REPLY).setLabel("Responder").build()
        val replyIntent = Intent(context, NotificationReplyReceiver::class.java).setAction(NotificationReplyReceiver.ACTION_REPLY)
        val mutableFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        val replyPending = PendingIntent.getBroadcast(
            context, 1, replyIntent, PendingIntent.FLAG_UPDATE_CURRENT or mutableFlag
        )
        val replyAction = NotificationCompat.Action.Builder(R.drawable.ic_notification, "Responder", replyPending)
            .addRemoteInput(replyInput)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .build()

        val notification = NotificationCompat.Builder(context, MainActivity.MESSAGE_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setLargeIcon(Avatars.get(context, sender, avatars[sender]))
            .setContentTitle(sender)
            .setContentText(messages.lastOrNull()?.text.orEmpty().take(180))
            .setStyle(style)
            .setContentIntent(openPending)
            .addAction(replyAction)
            .setAutoCancel(true)
            .setOnlyAlertOnce(!alert)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setShortcutId(SHORTCUT_ID)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .setNumber(messages.count { it.fresh })
            .build()
        context.getSystemService(NotificationManager::class.java).notify(MESSAGE_ID, notification)
    }

    // Atalho "de conversa": com ele, o Android (11+) mostra a notificação na área de conversas, com a foto em destaque.
    private fun publishShortcut(context: Context, person: Person) {
        runCatching {
            val shortcut = ShortcutInfoCompat.Builder(context, SHORTCUT_ID)
                .setShortLabel(person.name ?: "Potato Chat")
                .setLongLived(true)
                .setPerson(person)
                .setIcon(person.icon ?: IconCompat.createWithResource(context, R.mipmap.ic_launcher))
                .setIntent(Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW))
                .build()
            ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
        }
    }

    private fun prefs(context: Context) = context.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE)
    private fun myName(context: Context) = prefs(context).getString("name", "").orEmpty().ifBlank { "Você" }

    private fun readAvatars(context: Context): Map<String, String> = runCatching {
        val json = JSONObject(prefs(context).getString(AVATARS_KEY, null) ?: "{}")
        json.keys().asSequence().associateWith { json.getString(it) }
    }.getOrDefault(emptyMap())

    private fun readHistory(context: Context): MutableList<NotificationMessage> {
        val raw = prefs(context).getString(HISTORY_KEY, null) ?: return mutableListOf()
        return runCatching {
            val json = JSONArray(raw)
            MutableList(json.length()) { index ->
                val item = json.getJSONObject(index)
                NotificationMessage(
                    item.optString("sender"), item.optString("text"),
                    item.optLong("time"), item.optBoolean("mine"), item.optBoolean("fresh", !item.optBoolean("mine"))
                )
            }
        }.getOrDefault(mutableListOf())
    }

    private fun writeHistory(context: Context, messages: List<NotificationMessage>) {
        val json = JSONArray()
        messages.forEach { message ->
            json.put(JSONObject().put("sender", message.sender).put("text", message.text)
                .put("time", message.time).put("mine", message.mine).put("fresh", message.fresh))
        }
        prefs(context).edit().putString(HISTORY_KEY, json.toString()).apply()
    }

    /** fresh = chegou depois que o app saiu da tela (conta no número da notificação). */
    private data class NotificationMessage(val sender: String, val text: String, val time: Long, val mine: Boolean, val fresh: Boolean)
}
