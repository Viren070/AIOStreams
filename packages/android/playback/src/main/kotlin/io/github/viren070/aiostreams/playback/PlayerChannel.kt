package io.github.viren070.aiostreams.playback

import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import java.io.File
import java.util.Base64
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
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
    /** Picks the engine for the file about to load. */
    private val beforeLoad: () -> Unit = {},
    /** Hands a file the engine can't decode to another engine; false when there is none. */
    private val fallBack: () -> Boolean = { false },
    /** The video's frame rate, or null once the page closes the player. */
    private val frameRate: (Double?) -> Unit = {},
) : Engine.Listener {
    private val main = Handler(Looper.getMainLooper())
    private val latest = mutableMapOf<String, JsonElement>()
    private val held = mutableMapOf<String, JsonElement>()
    private val sentAt = mutableMapOf<String, Long>()
    /** The page's properties, which a new engine takes over. */
    private val settings = LinkedHashMap<String, String>()
    /** The file playing, which a new engine loads again. */
    private var loaded: List<String>? = null

    val session = SessionPlayer(send)

    fun start() = engine.start(this)

    /** Hands playback to `next`, releasing the engine it had; with `reload`, at the same place in the file. */
    fun replace(next: Engine, reload: Boolean) {
        val at = (latest["time-pos"] as? JsonPrimitive)?.doubleOrNull
        engine.release()
        latest.clear()
        held.clear()
        engine = next
        next.start(this)
        for ((name, value) in settings) next.setProperty(name, value)
        if (reload) loaded?.let { next.command(resumed(it, at)) }
    }

    /** False for a message that isn't the player's. */
    fun handle(type: String, message: JsonObject): Boolean {
        when (type) {
            "mpv-command" -> {
                val args = message["args"] as? JsonArray ?: return true
                MpvProtocol.command(args, isLocal)
                    .onSuccess(::command)
                    .onFailure { reject(it) }
            }
            "mpv-set-prop" -> {
                val name = message["name"]?.jsonPrimitive?.content ?: return true
                MpvProtocol.setProperty(name, message["value"] ?: JsonNull)
                    .onSuccess { value ->
                        remember(name, value)
                        engine.setProperty(name, value)
                    }
                    .onFailure { reject(it) }
            }
            "mpv-sync" -> latest.forEach { (name, value) -> send(property(name, value)) }
            "player-stats" -> send(buildJsonObject {
                put("type", "player-stats")
                put("stats", engine.stats())
                put("cpuMs", Process.getElapsedCpuTime())
                put("atMs", SystemClock.elapsedRealtime())
            })
            "subtitle-file" -> runCatching { addSubtitle(message) }.onFailure { reject(it) }
            "now-playing" -> {
                val item = message["item"] as? JsonObject
                session.setItem(item?.let(::itemOf))
                if (item == null) frameRate(null)
            }
            else -> return false
        }
        return true
    }

    private fun command(args: List<String>) {
        when (args[0]) {
            "loadfile" -> {
                beforeLoad()
                loaded = args
            }
            "stop" -> loaded = null
            "set" -> remember(args[1], args[2])
        }
        engine.command(args)
    }

    private fun remember(name: String, value: String) {
        if (name !in TRANSIENT) settings[name] = value
    }

    override fun onUnplayable(error: String) {
        main.post {
            if (fallBack()) return@post
            send(buildJsonObject {
                put("type", "mpv-ended")
                put("reason", "error")
                put("error", error)
            })
        }
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

    val paused get() = (latest["pause"] as? JsonPrimitive)?.booleanOrNull != false

    private fun receive(name: String, value: JsonElement) {
        latest[name] = value
        session.onProperty(name, value)
        if (name == "container-fps") (value as? JsonPrimitive)?.doubleOrNull?.takeIf { it > 0 }?.let(frameRate)
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
        /** Seeks and track picks, which belong to the file rather than the page's settings. */
        val TRANSIENT = setOf("time-pos", "aid", "sid", "secondary-sid")

        /** `loadfile`, starting where the last engine was. */
        fun resumed(load: List<String>, at: Double?): List<String> {
            val options = load.getOrNull(4).orEmpty().split(',').filter { it.isNotEmpty() }
            val start = at?.takeIf { it > 0 }?.let { "start=%.3f".format(Locale.ROOT, it) }
            val kept = if (start == null) options else listOf(start) + options.filterNot { it.startsWith("start=") }
            return listOf(load[0], load[1], "replace", "-1", kept.joinToString(","))
        }

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
