package com.potatochat.android.model

import org.json.JSONArray
import org.json.JSONObject

data class Session(val token: String, val name: String)
data class Reply(val id: String, val sender: String, val text: String)
data class ChatMessage(
    val id: String,
    val clientId: String? = null,
    val sender: String,
    val text: String,
    val createdAt: String,
    val replyTo: Reply? = null,
    val reactions: Map<String, List<String>> = emptyMap(),
    val deleted: Boolean = false,
    val pending: Boolean = false,
    val failed: Boolean = false,
    /** Texto curto para notificações: o texto, ou "Foto", "Mensagem de voz (0:12)"… como no site (previewText). */
    val preview: String = text
)
/** avatar = endereço da foto de perfil (relativo ao site), ou null sem foto. */
data class Person(val name: String, val online: Boolean, val active: Boolean, val lastSeen: String?, val avatar: String? = null)
data class ReadReceipt(val id: String, val at: String?)

fun JSONObject.toMessage() = ChatMessage(
    id = optString("id"), clientId = optString("clientId").takeIf { it.isNotBlank() && it != "null" },
    sender = optString("sender"), text = optString("text"), createdAt = optString("createdAt"),
    replyTo = optJSONObject("replyTo")?.let { Reply(it.optString("id"), it.optString("sender"), it.optString("text")) },
    reactions = optJSONObject("reactions")?.let { objectJson ->
        objectJson.keys().asSequence().associateWith { key -> objectJson.optJSONArray(key).toStrings() }
    } ?: emptyMap(), deleted = optBoolean("deleted"), preview = previewText()
)

private fun JSONObject.previewText(): String {
    val text = optString("text")
    val file = optJSONObject("file")
    val voice = file?.optJSONObject("voice")
    return when {
        optBoolean("deleted") -> "Mensagem apagada"
        optJSONObject("gif") != null -> "GIF"
        optJSONObject("music") != null -> "Música: ${optJSONObject("music")?.optString("title").orEmpty()}"
        voice != null -> voice.optDouble("duration", 0.0).toInt().let { "Mensagem de voz (%d:%02d)".format(it / 60, it % 60) }
        file != null && text.isBlank() -> when (file.optString("kind")) {
            "image" -> "Foto"
            "video" -> "Vídeo"
            "audio" -> "Áudio"
            else -> file.optString("name", "Arquivo")
        }
        else -> text
    }
}

fun JSONArray?.toStrings(): List<String> = if (this == null) emptyList() else (0 until length()).map { optString(it) }
fun JSONArray?.toMessages(): List<ChatMessage> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it)?.toMessage() }
fun JSONArray?.toPeople(): List<Person> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }.map {
    Person(
        it.optString("name"), it.optBoolean("online"), it.optBoolean("active"),
        it.optString("lastSeen").takeIf { value -> value.isNotBlank() && value != "null" },
        it.optString("avatar").takeIf { value -> value.isNotBlank() && value != "null" }
    )
}

enum class CallMedia { AUDIO, VIDEO, SCREEN }
enum class CallRole { CALLER, CALLEE }
data class RemoteMediaState(val mic: Boolean = true, val cam: Boolean = false, val screen: Boolean = false)
data class CallUiState(
    val active: Boolean = false, val incoming: Boolean = false, val connected: Boolean = false,
    val role: CallRole = CallRole.CALLER, val media: CallMedia = CallMedia.AUDIO,
    val peerName: String = "", val peerId: String? = null, val status: String = "",
    val mic: Boolean = true, val camera: Boolean = false, val screen: Boolean = false,
    val remote: RemoteMediaState = RemoteMediaState()
)
