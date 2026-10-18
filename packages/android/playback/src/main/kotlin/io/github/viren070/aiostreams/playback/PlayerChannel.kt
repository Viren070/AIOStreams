package io.github.viren070.aiostreams.playback

import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/**
 * Carries the page's `player-*` and `now-playing` messages to the engine and
 * the session, and the engine's reports back, on the main thread, as the
 * desktop app does.
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
    private val showVideo: (Boolean) -> Unit = {},
    /** Those of the formats the audio output decodes itself. */
    private val passthrough: (List<String>) -> List<String> = { emptyList() },
) : Engine.Listener {
    private val main = Handler(Looper.getMainLooper())
    private var state = PlayerState()
    private var tracks = emptyList<PlayerTrack>()
    private var chapters = emptyList<PlayerChapter>()
    private var heldPosition: PlayerState? = null
    private var positionSentAt = 0L

    // What the page set, which a new engine takes over.
    private var settled = Change()
    private var style: Style? = null
    private var settings: PlayerSettings? = null

    /** The file playing, which a new engine loads again. */
    private var loaded: LoadRequest? = null

    val session = SessionPlayer(send)

    fun start() = engine.start(this)

    /** Hands playback to `next`, releasing the engine it had; with `reload`, at the same place in the file. */
    fun replace(next: Engine, reload: Boolean) {
        val at = state.positionMs
        engine.release()
        state = PlayerState()
        heldPosition = null
        engine = next
        next.start(this)
        settings?.let { next.setSettings(applied(it)) }
        style?.let(next::setStyle)
        next.change(settled)
        if (reload) loaded?.let { load ->
            next.load(load.copy(startMs = at?.takeIf { it > 0 } ?: load.startMs, append = false))
        }
    }

    fun setSettings(settings: PlayerSettings) {
        this.settings = settings
        engine.setSettings(applied(settings))
    }

    /** The audio output now decodes other formats. */
    fun outputChanged() {
        settings?.takeIf { it.passthroughAuto }?.let { engine.setSettings(applied(it)) }
    }

    private fun applied(settings: PlayerSettings) =
        if (settings.passthroughAuto) settings.copy(passthrough = passthrough(settings.passthrough)) else settings

    val paused get() = state.paused != false

    fun change(change: Change) {
        settled = settled.then(change.copy(audio = null, subtitle = null))
        engine.change(change)
    }

    /** False for a message that isn't the player's. */
    fun handle(type: String, message: JsonObject): Boolean {
        when (type) {
            "player-load" -> PlayerProtocol.load(message, isLocal).onSuccess(::load).onFailure(::reject)
            "player-stop" -> {
                loaded = null
                engine.stop()
            }
            "player-set" -> PlayerProtocol.change(message).onSuccess(::change).onFailure(::reject)
            "player-seek" -> message.number("positionMs")?.let { engine.seek(it, message.number("snapMs") ?: 0.0) }
            "player-skips" -> engine.setSkips(PlayerProtocol.skips(message))
            "player-subtitle-add" -> {
                val url = message.text("url").orEmpty()
                if (PlayerProtocol.isWebUrl(url) || isLocal(url)) {
                    engine.addSubtitle(url, message.text("title"), message.text("language"))
                } else {
                    reject(IllegalArgumentException("only http(s) subtitles and downloads load"))
                }
            }
            "player-style" -> PlayerProtocol.style(message)
                .onSuccess {
                    style = it
                    engine.setStyle(it)
                }
                .onFailure(::reject)
            "player-stats-overlay" -> engine.showStatsOverlay(message.text("page"))
            "player-sync" -> {
                send(PlayerProtocol.state(state))
                send(PlayerProtocol.tracks(tracks))
                send(PlayerProtocol.chapters(chapters))
            }
            "player-stats" -> send(buildJsonObject {
                put("type", "player-stats")
                put("stats", engine.stats())
                put("cpuMs", Process.getElapsedCpuTime())
                put("atMs", SystemClock.elapsedRealtime())
            })
            "subtitle-file" -> runCatching { addSubtitle(message) }.onFailure(::reject)
            "now-playing" -> {
                val item = message["item"] as? JsonObject
                session.setItem(item?.let(::itemOf))
                if (item == null) {
                    frameRate(null)
                    showVideo(false)
                }
            }
            else -> return false
        }
        return true
    }

    private fun load(request: LoadRequest) {
        beforeLoad()
        showVideo(true)
        loaded = request
        engine.load(request)
    }

    override fun onUnplayable(error: String) {
        main.post {
            if (fallBack()) return@post
            send(PlayerProtocol.ended("error", error, null))
        }
    }

    override fun onState(state: PlayerState) {
        main.post { receive(state) }
    }

    override fun onTracks(tracks: List<PlayerTrack>) {
        main.post {
            this.tracks = tracks
            send(PlayerProtocol.tracks(tracks))
        }
    }

    override fun onChapters(chapters: List<PlayerChapter>) {
        main.post {
            this.chapters = chapters
            send(PlayerProtocol.chapters(chapters))
        }
    }

    override fun onEvent(name: String) {
        main.post {
            session.onEvent(name)
            send(buildJsonObject {
                put("type", "player-event")
                put("name", name)
            })
        }
    }

    override fun onEnded(reason: String, error: String?, cause: String?) {
        main.post { send(PlayerProtocol.ended(reason, error, cause)) }
    }

    override fun onVideo(width: Int?, height: Int?, frameRate: Double?) {
        main.post {
            frameRate?.takeIf { it > 0 }?.let(this.frameRate)
            if (width != null && height != null) session.onVideoSize(width, height)
        }
    }

    /** Positions come several times a second, so they go out at most every [THROTTLE_MS]; the rest at once. */
    private fun receive(update: PlayerState) {
        state = state.then(update)
        session.onState(update)
        val rest = update.copy(positionMs = null, bufferedMs = null)
        if (rest != PlayerState()) send(PlayerProtocol.state(rest))
        if (update.positionMs == null && update.bufferedMs == null) return
        val position = (heldPosition ?: PlayerState()).then(PlayerState(positionMs = update.positionMs, bufferedMs = update.bufferedMs))
        val wait = THROTTLE_MS - (SystemClock.uptimeMillis() - positionSentAt)
        if (wait <= 0) return sendPosition(position)
        if (heldPosition == null) main.postDelayed({ heldPosition?.let(::sendPosition) }, wait)
        heldPosition = position
    }

    private fun sendPosition(position: PlayerState) {
        heldPosition = null
        positionSentAt = SystemClock.uptimeMillis()
        send(PlayerProtocol.state(position))
    }

    /** The page never names a path for the engine to open, so the file is written here first. */
    private fun addSubtitle(message: JsonObject) {
        val name = message.text("name") ?: error("subtitle file without a name")
        val extension = name.substringAfterLast('.', "").lowercase()
        require(extension in SUBTITLE_TYPES) { "$name is not a subtitle file" }
        val bytes = Base64.decode(message.text("data").orEmpty(), Base64.DEFAULT)
        require(bytes.size <= MAX_SUBTITLE_BYTES) { "$name is too big" }
        subtitles.mkdirs()
        val file = File(subtitles, "${next.getAndIncrement()}.$extension")
        file.writeBytes(bytes)
        engine.addSubtitle(file.path, name.take(200), null)
    }

    private fun reject(error: Throwable) {
        Log.w(TAG, "refused: ${error.message}")
        send(buildJsonObject {
            put("type", "error")
            put("message", error.message)
        })
    }

    private companion object {
        const val TAG = "player"
        const val THROTTLE_MS = 250L
        const val MAX_SUBTITLE_BYTES = 10 shl 20
        val SUBTITLE_TYPES = setOf("srt", "vtt", "ass", "ssa", "sub", "sup")

        val next = AtomicInteger()

        fun JsonObject.text(name: String) = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

        fun JsonObject.number(name: String) = (this[name] as? JsonPrimitive)?.doubleOrNull

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
