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
    val failed: Boolean = false
)
data class Person(val name: String, val online: Boolean, val active: Boolean, val lastSeen: String?)
data class ReadReceipt(val id: String, val at: String?)

fun JSONObject.toMessage() = ChatMessage(
    id = optString("id"), clientId = optString("clientId").takeIf { it.isNotBlank() && it != "null" },
    sender = optString("sender"), text = optString("text"), createdAt = optString("createdAt"),
    replyTo = optJSONObject("replyTo")?.let { Reply(it.optString("id"), it.optString("sender"), it.optString("text")) },
    reactions = optJSONObject("reactions")?.let { objectJson ->
        objectJson.keys().asSequence().associateWith { key -> objectJson.optJSONArray(key).toStrings() }
    } ?: emptyMap(), deleted = optBoolean("deleted")
)

fun JSONArray?.toStrings(): List<String> = if (this == null) emptyList() else (0 until length()).map { optString(it) }
fun JSONArray?.toMessages(): List<ChatMessage> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it)?.toMessage() }
fun JSONArray?.toPeople(): List<Person> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }.map {
    Person(it.optString("name"), it.optBoolean("online"), it.optBoolean("active"), it.optString("lastSeen").takeIf { value -> value.isNotBlank() && value != "null" })
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
