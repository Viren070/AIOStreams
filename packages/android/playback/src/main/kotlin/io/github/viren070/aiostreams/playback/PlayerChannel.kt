package io.github.viren070.aiostreams.playback

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
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
 * Carries the page's `mpv-*` messages to the engine and the engine's reports
 * back, on the main thread, as the desktop app does.
 */
class PlayerChannel(
    private val engine: Engine,
    private val send: (JsonObject) -> Unit,
    private val onPlaying: (Boolean) -> Unit,
) : Engine.Listener {
    private val main = Handler(Looper.getMainLooper())
    private val latest = mutableMapOf<String, JsonElement>()
    private val held = mutableMapOf<String, JsonElement>()
    private val sentAt = mutableMapOf<String, Long>()
    private var playing = false

    fun start() = engine.start(this)

    /** False for a message that isn't the player's. */
    fun handle(type: String, message: JsonObject): Boolean {
        when (type) {
            "mpv-command" -> {
                val args = message["args"] as? JsonArray ?: return true
                MpvProtocol.command(args)
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
            else -> return false
        }
        return true
    }

    override fun onProperty(name: String, value: JsonElement) {
        main.post { receive(name, value) }
    }

    override fun onEvent(name: String) {
        main.post {
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
        if (name == "pause" || name == "idle-active") updatePlaying()
        if (name !in MpvProtocol.throttled) return send(property(name, value))
        val wait = THROTTLE_MS - (SystemClock.uptimeMillis() - (sentAt[name] ?: 0))
        if (wait <= 0) return emitNow(name, value)
        if (held.put(name, value) == null) main.postDelayed({ held.remove(name)?.let { emitNow(name, it) } }, wait)
    }

    private fun emitNow(name: String, value: JsonElement) {
        sentAt[name] = SystemClock.uptimeMillis()
        send(property(name, value))
    }

    private fun updatePlaying() {
        val paused = (latest["pause"] as? JsonPrimitive)?.booleanOrNull ?: true
        val idle = (latest["idle-active"] as? JsonPrimitive)?.booleanOrNull ?: true
        val now = !paused && !idle
        if (now != playing) {
            playing = now
            onPlaying(now)
        }
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
    }
}
