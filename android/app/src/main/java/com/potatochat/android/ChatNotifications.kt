package com.potatochat.android

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import org.json.JSONArray
import org.json.JSONObject

/** Builds the single conversation notification and keeps its recent message history. */
object ChatNotifications {
    const val MESSAGE_ID = 901
    const val CALL_ID = 902
    const val KEY_TEXT_REPLY = "potato_text_reply"
    private const val HISTORY_KEY = "notification_history"
    private const val MAX_HISTORY = 10

    @Synchronized
    fun showIncoming(context: Context, sender: String, body: String) {
        val messages = readHistory(context).apply {
            add(NotificationMessage(sender, body.ifBlank { "Nova mensagem" }, System.currentTimeMillis(), false))
        }.takeLast(MAX_HISTORY)
        writeHistory(context, messages)
        showConversation(context, messages, sender, true)
    }

    @Synchronized
    fun showOutgoing(context: Context, body: String) {
        val myName = prefs(context).getString("name", "").orEmpty().ifBlank { "Você" }
        val messages = readHistory(context).apply {
            add(NotificationMessage(myName, body, System.currentTimeMillis(), true))
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
        val myName = prefs(context).getString("name", "").orEmpty().ifBlank { "Você" }
        val me = Person.Builder().setName(myName).build()
        val people = mutableMapOf<String, Person>()
        val style = NotificationCompat.MessagingStyle(me).setGroupConversation(false)
        messages.forEach { message ->
            val person = if (message.mine) null else people.getOrPut(message.sender) {
                Person.Builder().setName(message.sender).build()
            }
            style.addMessage(message.text.take(500), message.time, person)
        }

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
            .setContentTitle(sender)
            .setContentText(messages.lastOrNull()?.text.orEmpty().take(180))
            .setStyle(style)
            .setContentIntent(openPending)
            .addAction(replyAction)
            .setAutoCancel(true)
            .setOnlyAlertOnce(!alert)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setShortcutId("potato_conversation")
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .setNumber(messages.count { !it.mine })
            .build()
        context.getSystemService(NotificationManager::class.java).notify(MESSAGE_ID, notification)
    }

    private fun prefs(context: Context) = context.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE)

    private fun readHistory(context: Context): MutableList<NotificationMessage> {
        val raw = prefs(context).getString(HISTORY_KEY, null) ?: return mutableListOf()
        return runCatching {
            val json = JSONArray(raw)
            MutableList(json.length()) { index ->
                val item = json.getJSONObject(index)
                NotificationMessage(
                    item.optString("sender"), item.optString("text"),
                    item.optLong("time"), item.optBoolean("mine")
                )
            }
        }.getOrDefault(mutableListOf())
    }

    private fun writeHistory(context: Context, messages: List<NotificationMessage>) {
        val json = JSONArray()
        messages.forEach { message ->
            json.put(JSONObject().put("sender", message.sender).put("text", message.text)
                .put("time", message.time).put("mine", message.mine))
        }
        prefs(context).edit().putString(HISTORY_KEY, json.toString()).apply()
    }

    private data class NotificationMessage(val sender: String, val text: String, val time: Long, val mine: Boolean)
}
