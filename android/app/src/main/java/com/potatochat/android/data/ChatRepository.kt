package com.potatochat.android.data

import com.potatochat.android.model.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

sealed interface ChatEvent {
    data class Connected(val connected: Boolean, val error: String? = null) : ChatEvent
    data class History(val messages: List<ChatMessage>, val reads: Map<String, ReadReceipt>, val me: String, val hasMore: Boolean) : ChatEvent
    data class Older(val messages: List<ChatMessage>, val hasMore: Boolean) : ChatEvent
    data class Message(val message: ChatMessage) : ChatEvent
    data class MessageUpdate(val message: ChatMessage) : ChatEvent
    data class Presence(val people: List<Person>) : ChatEvent
    data class Seen(val name: String, val receipt: ReadReceipt) : ChatEvent
    data class Typing(val active: Boolean) : ChatEvent
    data class Signal(val event: String, val data: JSONObject) : ChatEvent
    /** Mudança no Nosso cantinho (aviso "us" do site): o dia de alguém, a agenda, um sonho, uma cartinha… */
    data class Us(val data: JSONObject) : ChatEvent
}

/** Cliente nativo do protocolo HTTP usado pela versao PHP publicada do Potato Chat. */
class ChatRepository {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(55, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val sendMutex = Mutex()
    private var connectionJob: Job? = null
    private var generation = 0
    private var currentServer: String? = null
    private var currentSession: Session? = null
    private var connectionId: String? = null
    private var cursor = 0L
    private var waitSeconds = 20

    private val _events = MutableSharedFlow<ChatEvent>(extraBufferCapacity = 128, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val events: SharedFlow<ChatEvent> = _events

    suspend fun login(server: String, name: String, password: String): Result<Session> = withContext(Dispatchers.IO) {
        runCatching {
            val json = request(server, "login", JSONObject().put("name", name).put("password", password))
            if (json.optBoolean("confirm")) {
                error("Esta conta ainda precisa ser criada. Entre primeiro pelo site para confirmar a senha.")
            }
            Session(json.getString("token"), json.getString("name"))
        }
    }

    fun connect(server: String, session: Session) {
        disconnect()
        val myGeneration = ++generation
        val conn = UUID.randomUUID().toString()
        currentServer = server.trimEnd('/')
        currentSession = session
        connectionId = conn
        connectionJob = scope.launch {
            var attempt = 0
            while (myGeneration == generation) {
                try {
                    val data = request(currentServer!!, "connect", basePayload(session, conn))
                    if (data.optBoolean("roomFull")) {
                        _events.emit(ChatEvent.Connected(false, "A sala ja esta cheia."))
                        return@launch
                    }
                    cursor = data.optLong("cursor")
                    waitSeconds = data.optInt("wait", 20).coerceIn(0, 35)
                    _events.emit(ChatEvent.Connected(true))
                    emitHistory(data.optJSONObject("history"), session.name)
                    _events.emit(ChatEvent.Presence(data.optJSONArray("presence").toPeople()))
                    poll(myGeneration, session, conn)
                    attempt = 0
                } catch (_: CancellationException) {
                    return@launch
                } catch (error: Throwable) {
                    if (myGeneration != generation) return@launch
                    _events.emit(ChatEvent.Connected(false, if (attempt == 0) friendly(error) else null))
                    attempt++
                    delay((500L shl attempt.coerceAtMost(3)).coerceAtMost(8_000L))
                }
            }
        }
    }

    private suspend fun poll(myGeneration: Int, session: Session, conn: String) {
        while (myGeneration == generation) {
            val body = basePayload(session, conn).put("cursor", cursor)
            val data = request(currentServer!!, "poll", body)
            cursor = data.optLong("cursor", cursor)
            waitSeconds = data.optInt("wait", waitSeconds).coerceIn(0, 35)
            data.optJSONObject("history")?.let { emitHistory(it, session.name) }
            val events = data.optJSONArray("events") ?: JSONArray()
            for (index in 0 until events.length()) {
                val event = events.optJSONObject(index) ?: continue
                dispatch(event.optString("type"), event.opt("data"))
            }
            _events.emit(ChatEvent.Presence(data.optJSONArray("presence").toPeople()))
            if (waitSeconds > 0) delay(100)
        }
    }

    fun disconnect() {
        val server = currentServer
        val session = currentSession
        val conn = connectionId
        generation++
        connectionJob?.cancel()
        connectionJob = null
        currentServer = null
        currentSession = null
        connectionId = null
        if (server != null && session != null && conn != null) scope.launch {
            runCatching { request(server, "disconnect", basePayload(session, conn)) }
        }
    }

    fun emit(event: String, data: JSONObject = JSONObject()) {
        scope.launch { runCatching { sendOperation(event, data) } }
    }

    fun typing(active: Boolean) {
        scope.launch { runCatching { sendOperation("typing", active) } }
    }

    fun visible(active: Boolean) {
        scope.launch { runCatching { sendOperation("visibility", active) } }
    }

    /** Ação do Nosso cantinho (op "us" do site: lembretes, resposta a um lembrete…). A resposta, se deu certo; senão, null. */
    suspend fun us(data: JSONObject): JSONObject? = withContext(Dispatchers.IO) {
        runCatching { sendOperation("us", data) as? JSONObject }.getOrNull()?.takeIf { it.optBoolean("ok") }
    }

    fun react(id: String, emoji: String) = emit("react", JSONObject().put("id", id).put("emoji", emoji))
    fun delete(id: String) = emit("delete", JSONObject().put("id", id))
    fun seen(id: String) = emit("seen", JSONObject().put("id", id))

    fun loadOlder(before: String) {
        scope.launch {
            runCatching { sendOperation("history:before", JSONObject().put("before", before)) }
                .onSuccess { result ->
                    val json = result as? JSONObject ?: return@onSuccess
                    _events.emit(ChatEvent.Older(json.optJSONArray("items").toMessages(), json.optBoolean("hasMore")))
                }
                .onFailure { _events.emit(ChatEvent.Older(emptyList(), false)) }
        }
    }

    suspend fun send(text: String, clientId: String, replyTo: String?): Result<ChatMessage> = withContext(Dispatchers.IO) {
        runCatching {
            val data = JSONObject().put("text", text).put("clientId", clientId).apply {
                if (replyTo != null) put("replyTo", replyTo)
            }
            val result = sendOperation("message", data) as? JSONObject
                ?: error("O servidor nao confirmou a mensagem.")
            if (!result.optBoolean("ok")) error(result.optString("error", "Falha ao enviar."))
            result.getJSONObject("message").toMessage()
        }
    }

    private suspend fun sendOperation(event: String, data: Any?): Any? = sendMutex.withLock {
        val server = currentServer ?: error("Sem conexao.")
        val session = currentSession ?: error("Sem conexao.")
        val conn = connectionId ?: error("Sem conexao.")
        val operation = JSONObject().put("event", event).put("data", data ?: JSONObject.NULL)
        val response = request(server, "ops", basePayload(session, conn).put("ops", JSONArray().put(operation)))
        response.optJSONArray("results")?.opt(0).takeUnless { it == JSONObject.NULL }
    }

    private suspend fun emitHistory(json: JSONObject?, fallbackName: String) {
        if (json == null) return
        val reads = json.optJSONObject("reads")?.let { source ->
            source.keys().asSequence().associateWith { key ->
                source.optJSONObject(key)?.let { ReadReceipt(it.optString("id"), it.optString("at")) }
                    ?: ReadReceipt("", null)
            }
        } ?: emptyMap()
        _events.emit(ChatEvent.History(json.optJSONArray("items").toMessages(), reads, json.optString("me", fallbackName), json.optBoolean("hasMore")))
    }

    private suspend fun dispatch(type: String, raw: Any?) {
        val data = raw as? JSONObject
        when (type) {
            "message" -> data?.let { _events.emit(ChatEvent.Message(it.toMessage())) }
            "message:update" -> data?.let { _events.emit(ChatEvent.MessageUpdate(it.toMessage())) }
            "seen" -> data?.let { _events.emit(ChatEvent.Seen(it.optString("name"), ReadReceipt(it.optString("id"), it.optString("at")))) }
            "typing" -> data?.let { _events.emit(ChatEvent.Typing(it.optBoolean("active"))) }
            "us" -> data?.let { _events.emit(ChatEvent.Us(it)) }
            "webrtc-offer", "webrtc-answer", "webrtc-ice", "call-state", "call-declined", "call-ended", "call-handled", "peer-left" ->
                _events.emit(ChatEvent.Signal(type, data ?: JSONObject()))
        }
    }

    private fun basePayload(session: Session, conn: String) = JSONObject()
        .put("token", session.token)
        .put("client", "web")
        .put("conn", conn)
        .put("visible", true)

    private fun request(server: String, action: String, body: JSONObject): JSONObject {
        val media = "application/json; charset=utf-8".toMediaType()
        val request = Request.Builder()
            .url("${server.trimEnd('/')}/api.php?action=$action")
            .header("Accept", "application/json")
            .post(body.toString().toRequestBody(media))
            .build()
        return http.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            val json = runCatching { JSONObject(raw) }.getOrElse {
                val detail = if (raw.trimStart().startsWith("<!DOCTYPE", true) || raw.trimStart().startsWith("<html", true))
                    "O servidor devolveu uma pagina HTML em vez da API."
                else "Resposta invalida do servidor."
                throw IOException("$detail (HTTP ${response.code})")
            }
            if (!response.isSuccessful) throw ApiException(response.code, json.optString("error", "Erro ${response.code} no servidor."))
            json
        }
    }

    private fun friendly(error: Throwable): String = when (error) {
        is ApiException -> error.message ?: "Nao foi possivel conectar."
        is java.net.UnknownHostException -> "Servidor nao encontrado. Verifique a internet."
        is java.net.SocketTimeoutException -> "O servidor demorou para responder."
        else -> error.message ?: "Nao foi possivel conectar."
    }

    private class ApiException(val status: Int, message: String) : IOException(message)
}
