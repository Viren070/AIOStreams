package io.github.viren070.aiostreams.playback

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import java.io.File
import java.util.Base64
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Carries the page's `mpv-*` and `now-playing` messages to the engine and the
 * session, and the engine's reports back, on the main thread, as the desktop
 * app does.
 */
class PlayerChannel(
    private var engine: Engine,
    private val send: (JsonObject) -> Unit,
    /** A downloaded file, which the page may play. */
    private val isLocal: (String) -> Boolean,
    /** Where subtitle files the page adds are written. */
    private val subtitles: File,
) : Engine.Listener {
    private val main = Handler(Looper.getMainLooper())
    private val latest = mutableMapOf<String, JsonElement>()
    private val held = mutableMapOf<String, JsonElement>()
    private val sentAt = mutableMapOf<String, Long>()

    val session = SessionPlayer(send)

    fun start() = engine.start(this)

    /** Hands playback to `next`, releasing the engine it had. */
    fun replace(next: Engine) {
        engine.release()
        latest.clear()
        held.clear()
        engine = next
        next.start(this)
    }

    /** False for a message that isn't the player's. */
    fun handle(type: String, message: JsonObject): Boolean {
        when (type) {
            "mpv-command" -> {
                val args = message["args"] as? JsonArray ?: return true
                MpvProtocol.command(args, isLocal)
                    .onSuccess(engine::command)
                    .onFailure { reject(it) }
            }
            "mpv-set-prop" -> {
                val name = message["name"]?.jsonPrimitive?.content ?: return true
                MpvProtocol.setProperty(name, message["value"] ?: JsonNull)
                    .onSuccess { engine.setProperty(name, it) }
                    .onFailure { reject(it) }
            }
            "mpv-sync" -> latest.forEach { (name, value) -> send(property(name, value)) }
            "subtitle-file" -> runCatching { addSubtitle(message) }.onFailure { reject(it) }
            "now-playing" -> session.setItem((message["item"] as? JsonObject)?.let(::itemOf))
            else -> return false
        }
        return true
    }

    override fun onProperty(name: String, value: JsonElement) {
        main.post { receive(name, value) }
    }

    override fun onEvent(name: String) {
        main.post {
            session.onEvent(name)
            send(buildJsonObject {
                put("type", "mpv-event")
                put("name", name)
            })
        }
    }

    override fun onEnded(reason: String, error: String?, cause: String?) {
        main.post {
            send(buildJsonObject {
                put("type", "mpv-ended")
                put("reason", reason)
                put("error", error)
                if (cause != null) put("cause", cause)
            })
        }
    }

    private fun receive(name: String, value: JsonElement) {
        latest[name] = value
        session.onProperty(name, value)
        if (name !in MpvProtocol.throttled) return send(property(name, value))
        val wait = THROTTLE_MS - (SystemClock.uptimeMillis() - (sentAt[name] ?: 0))
        if (wait <= 0) return emitNow(name, value)
        if (held.put(name, value) == null) main.postDelayed({ held.remove(name)?.let { emitNow(name, it) } }, wait)
    }

    private fun emitNow(name: String, value: JsonElement) {
        sentAt[name] = SystemClock.uptimeMillis()
        send(property(name, value))
    }

    /** The page never names a path for mpv to open, so the file is written here first. */
    private fun addSubtitle(message: JsonObject) {
        val name = message["name"]?.jsonPrimitive?.content ?: error("subtitle file without a name")
        val extension = name.substringAfterLast('.', "").lowercase()
        require(extension in SUBTITLE_TYPES) { "$name is not a subtitle file" }
        val bytes = Base64.getDecoder().decode(message["data"]?.jsonPrimitive?.content ?: "")
        require(bytes.size <= MAX_SUBTITLE_BYTES) { "$name is too big" }
        subtitles.mkdirs()
        val file = File(subtitles, "${next.getAndIncrement()}.$extension")
        file.writeBytes(bytes)
        engine.command(listOf("sub-add", file.path, "select", name.take(200)))
    }

    private fun reject(error: Throwable) {
        Log.w(TAG, "refused: ${error.message}")
        send(buildJsonObject {
            put("type", "error")
            put("message", error.message)
        })
    }

    private fun property(name: String, value: JsonElement) = buildJsonObject {
        put("type", "mpv-prop")
        put("name", name)
        put("data", value)
    }

    private companion object {
        const val TAG = "player"
        const val THROTTLE_MS = 250L
        const val MAX_SUBTITLE_BYTES = 10 shl 20
        val SUBTITLE_TYPES = setOf("srt", "vtt", "ass", "ssa", "sub", "sup")
        val next = AtomicInteger()

        fun itemOf(item: JsonObject): NowPlayingItem? {
            fun text(name: String) = (item[name] as? JsonPrimitive)?.takeIf { it.isString }?.content
            fun flag(name: String) = (item[name] as? JsonPrimitive)?.booleanOrNull == true
            return NowPlayingItem(
                title = text("title") ?: return null,
                subtitle = text("subtitle"),
                artwork = text("artwork"),
                previous = flag("previous"),
                next = flag("next"),
                pip = flag("pip"),
                background = flag("background"),
            )
        }
    }
}
