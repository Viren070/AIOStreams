package io.github.viren070.aiostreams.downloads

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/** The page's `download-*` messages, for the queue. */
class DownloadChannel(private val queue: DownloadQueue, private val onAdd: () -> Unit) {
    private val json = Json { ignoreUnknownKeys = true }

    /** False for a message that isn't about downloads. */
    fun handle(type: String, message: JsonObject): Boolean {
        fun text(name: String) = message[name]?.jsonPrimitive?.content
        when (type) {
            "download-add" -> {
                val jobs = message["jobs"] ?: return true
                queue.add(json.decodeFromJsonElement(ListSerializer(DownloadSpec.serializer()), jobs))
                onAdd()
            }
            "download-control" -> {
                val id = text("id") ?: return true
                when (text("action")) {
                    "pause" -> queue.pause(id)
                    "resume" -> queue.resume(id)
                    "retry" -> queue.retry(id)
                }
            }
            "download-remove" -> queue.remove(
                text("id") ?: return true,
                message["files"]?.jsonPrimitive?.booleanOrNull == true,
            )
            "download-list" -> queue.list()
            "download-config" -> queue.configure(
                message["concurrent"]?.jsonPrimitive?.intOrNull ?: 2,
                message["wifiOnly"]?.jsonPrimitive?.booleanOrNull ?: true,
            )
            else -> return false
        }
        return true
    }
}
