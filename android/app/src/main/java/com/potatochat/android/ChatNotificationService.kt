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
import com.potatochat.android.model.ChatMessage
import com.potatochat.android.model.Session
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.time.Instant
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/** Mantem o long polling ativo quando a WebView esta em segundo plano. */
class ChatNotificationService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var repository: ChatRepository? = null
    private var myName = ""
    private var connected = false
    private val pendingReplies = ArrayDeque<String>()
    // Fotos de perfil (nome → endereço) e as últimas mensagens da conversa, que entram como contexto na notificação.
    private val avatars = mutableMapOf<String, String?>()
    private val recent = ArrayDeque<ChatMessage>()
    // Nosso cantinho: os lembretes das próximas 48 horas (us_schedule), a diferença para o relógio do servidor, os já
    // pedidos (claim) e as respostas dadas na notificação esperando a conexão.
    private var schedule = listOf<Reminder>()
    private var clockOffset = 0L
    private val claimed = mutableSetOf<String>()
    private val pendingAnswers = ArrayDeque<RoutineAnswer>()

    private data class Reminder(val key: String, val at: Long, val kind: String, val field: String?, val day: String, val title: String, val text: String, val reply: Boolean)
    private data class RoutineAnswer(val day: String, val field: String, val text: String, val notification: Int)

    override fun onCreate() {
        super.onCreate()
        createChannels()
        CantinhoNotifications.createChannels(this)
        startForeground(FOREGROUND_ID, foregroundNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_SEND_REPLY) {
            intent.getStringExtra(EXTRA_REPLY_TEXT)?.trim()?.takeIf { it.isNotBlank() }?.let(pendingReplies::addLast)
        }
        if (intent?.action == ACTION_ROUTINE_REPLY) {
            val field = intent.getStringExtra(CantinhoNotifications.EXTRA_FIELD)
            val day = intent.getStringExtra(CantinhoNotifications.EXTRA_DAY)
            if (field != null && day != null) {
                pendingAnswers.addLast(RoutineAnswer(day, field, intent.getStringExtra(EXTRA_REPLY_TEXT).orEmpty(), intent.getIntExtra(CantinhoNotifications.EXTRA_NOTIFICATION, 0)))
            }
        }
        if (repository != null) {
            if (connected) {
                sendPendingReplies()
                sendPendingAnswers()
            }
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
                        if (connected) {
                            sendPendingReplies()
                            sendPendingAnswers()
                            loadSchedule()
                        }
                    }
                    is ChatEvent.Us -> onUs(event.data)
                    is ChatEvent.History -> {
                        recent.clear()
                        recent.addAll(event.messages.filter { !it.deleted }.takeLast(RECENT))
                    }
                    is ChatEvent.Presence -> {
                        val next = event.people.associate { it.name to it.avatar }
                        if (next != avatars) {
                            avatars.clear()
                            avatars.putAll(next)
                            ChatNotifications.rememberAvatars(this@ChatNotificationService, avatars)
                        }
                    }
                    is ChatEvent.Message -> {
                        val message = event.message
                        val earlier = recent.filter { it.id != message.id }.map { line(it) }
                        recent.addLast(message)
                        while (recent.size > RECENT) recent.removeFirst()
                        if (!message.sender.equals(myName, ignoreCase = true)) {
                            val avatar = avatars[message.sender]
                            launch(Dispatchers.IO) {
                                ChatNotifications.showIncoming(this@ChatNotificationService, message.sender, message.preview, avatar, earlier)
                            }
                        }
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
        // Lembretes: confere a cada 20 segundos o que já venceu; a lista é refeita a cada meia hora (e quando a agenda muda).
        scope.launch {
            while (true) {
                delay(20_000)
                checkReminders()
            }
        }
        scope.launch {
            while (true) {
                delay(30 * 60_000L)
                loadSchedule()
            }
        }
        return START_STICKY
    }

    // ---------- Nosso cantinho ----------

    private fun loadSchedule() {
        val chat = repository ?: return
        scope.launch {
            // Minutos do fuso em relação ao UTC (Brasília: -180), como o site manda.
            val tz = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000
            val result = chat.us(JSONObject().put("op", "schedule").put("tz", tz)) ?: return@launch
            clockOffset = result.optLong("serverNow", System.currentTimeMillis()) - System.currentTimeMillis()
            val items = result.optJSONArray("items") ?: JSONArray()
            schedule = (0 until items.length()).mapNotNull { items.optJSONObject(it) }.map {
                Reminder(
                    it.optString("key"), it.optLong("at"), it.optString("kind"), it.optString("field").takeIf { field -> field.isNotBlank() && field != "null" },
                    it.optString("day"), it.optString("title"), it.optString("text"), it.optBoolean("reply")
                )
            }
            checkReminders()
        }
    }

    // Lembrete vencido há menos de 2 horas: o servidor diz se ainda vale (o site aberto pode ter mostrado antes, ou a
    // pessoa já contou o que almoçou) e o texto de agora (na rotina, o que falta).
    private fun checkReminders() {
        val chat = repository ?: return
        if (!connected) return
        val now = System.currentTimeMillis() + clockOffset
        val due = schedule.filter { it.at <= now && now - it.at < 2 * 3_600_000L && it.key !in claimed }
        if (due.isEmpty()) return
        claimed += due.map { it.key }
        scope.launch {
            for (item in due) {
                val result = chat.us(JSONObject().put("op", "claim").put("key", item.key))
                if (result == null) {
                    claimed -= item.key
                    continue
                }
                if (!result.optBoolean("fire")) continue
                val text = result.optString("text").ifBlank { item.text }
                launch(Dispatchers.IO) {
                    CantinhoNotifications.showReminder(this@ChatNotificationService, REMINDER_BASE + (item.key.hashCode() and 0xffff), item.title, text, item.field, item.day, item.reply)
                }
            }
        }
    }

    private fun sendPendingAnswers() {
        val chat = repository ?: return
        if (!connected || pendingAnswers.isEmpty()) return
        scope.launch {
            while (connected && pendingAnswers.isNotEmpty()) {
                val answer = pendingAnswers.removeFirst()
                val clock = SimpleDateFormat("HH:mm", Locale.US).format(Date(System.currentTimeMillis() + clockOffset))
                val result = chat.us(JSONObject().put("op", "reply").put("day", answer.day).put("field", answer.field).put("text", answer.text).put("clock", clock))
                launch(Dispatchers.IO) { CantinhoNotifications.showAnswered(this@ChatNotificationService, answer.notification, result != null) }
            }
        }
    }

    // Novidade no Nosso cantinho: a agenda refaz os lembretes; o que a outra pessoa fez vira notificação.
    private fun onUs(data: JSONObject) {
        val kind = data.optString("kind")
        if (kind == "event" || kind == "prompts") loadSchedule()
        val by = data.optString("by")
        if (by.isBlank() || by.equals(myName, ignoreCase = true)) return
        val item = data.optJSONObject("item")
        val title: String
        val text: String
        val section: String
        when (kind) {
            "letter" -> {
                section = "cartinhas"
                title = when (data.optString("action")) {
                    "new" -> "$by te escreveu uma cartinha"
                    "read" -> "$by leu a sua cartinha"
                    else -> return
                }
                text = item?.optString("title").orEmpty()
            }
            "event" -> {
                if (!data.optBoolean("created") || item == null) return
                section = "agenda"
                title = "$by marcou na agenda"
                text = "${item.optString("title")} · ${eventWhen(item)}"
            }
            "goal" -> {
                section = "sonhos"
                val goal = item?.optString("title").orEmpty()
                when (data.optString("action")) {
                    "done" -> {
                        if (item?.optBoolean("done") != true) return
                        title = "Sonho realizado!"
                        text = "$by marcou “$goal” como realizado"
                    }
                    "deposit" -> {
                        val amount = data.optDouble("amount", 0.0)
                        if (amount <= 0) return
                        title = "$by guardou dinheiro"
                        text = "${NumberFormat.getCurrencyInstance(Locale("pt", "BR")).format(amount)} para “$goal”"
                    }
                    else -> return
                }
            }
            "day" -> {
                val meal = data.optString("meal").takeIf { it.isNotBlank() && it != "null" } ?: return
                val entry = item?.optJSONObject("meals")?.optJSONObject(meal) ?: return
                section = "hoje"
                title = "$by contou o que comeu"
                text = "${MEALS[meal] ?: "Refeição"}: ${entry.optString("text").ifBlank { "mandou a foto" }}"
            }
            else -> return
        }
        val avatar = avatars[by]
        scope.launch(Dispatchers.IO) { CantinhoNotifications.showUpdate(this@ChatNotificationService, title, text, section, by, avatar) }
    }

    // "25/10 às 19:00" (ou só a data, no dia inteiro).
    private fun eventWhen(event: JSONObject): String {
        val date = event.optString("date")
        val time = event.optString("time").takeIf { it.isNotBlank() && it != "null" }
        val day = if (date.length == 10) "${date.substring(8, 10)}/${date.substring(5, 7)}" else date
        return if (time != null) "$day às $time" else day
    }

    private fun line(message: ChatMessage) = ChatNotifications.Line(
        message.sender, message.preview,
        runCatching { Instant.parse(message.createdAt).toEpochMilli() }.getOrDefault(System.currentTimeMillis()),
        message.sender.equals(myName, ignoreCase = true)
    )

    private fun sendPendingReplies() {
        val chat = repository ?: return
        if (!connected || pendingReplies.isEmpty()) return
        scope.launch {
            while (connected && pendingReplies.isNotEmpty()) {
                val text = pendingReplies.removeFirst()
                chat.send(text, "android-reply-${UUID.randomUUID()}", null)
                    .onSuccess { scope.launch(Dispatchers.IO) { ChatNotifications.showOutgoing(this@ChatNotificationService, text) } }
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
        const val ACTION_ROUTINE_REPLY = "com.potatochat.android.ROUTINE_REPLY"
        const val EXTRA_REPLY_TEXT = "reply_text"
        private const val REMINDER_BASE = 1000
        private val MEALS = mapOf("cafe" to "Café da manhã", "almoco" to "Almoço", "lanche" to "Lanche", "jantar" to "Jantar")
        private const val RECENT = 8
        private const val FOREGROUND_ID = 900
        private const val BACKGROUND_CHANNEL = "potato_background_silent"
    }
}
