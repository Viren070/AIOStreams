package io.github.viren070.aiostreams.playback

import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import io.github.viren070.aiostreams.natives.SubtitleTimeline
import io.github.viren070.aiostreams.natives.Thumbnails
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
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
    /** The device's trusted roots as PEM, for reading a file's index outside the players. */
    private val trustedRoots: () -> ByteArray? = { null },
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
    private var reference: String? = null

    /** A file's subtitle lines from its index, null where it has none, the file being read, and who waits on it. */
    private var indexed: Pair<String, List<List<SubtitleLine>>?>? = null
    private var indexing: String? = null
    private val waiting = mutableListOf<Pair<String, (List<List<SubtitleLine>>?) -> Unit>>()
    private val reader = Executors.newSingleThreadExecutor { Thread(it, "subtitle-index") }

    /** The file seek-bar thumbnails come from and its handle, used only on [thumbnailer]. */
    private var thumbnails: Pair<String, Long>? = null
    private var thumbnailFiles = 0
    private val thumbnailer = Executors.newSingleThreadExecutor { Thread(it, "thumbnails") }

    private val thumbnailImages = object : LinkedHashMap<String, ByteArray>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ByteArray>) =
            size > KEPT_THUMBNAILS
    }

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
        reference?.let(next::watchSubtitleLines)
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
                thumbnailer.execute(::closeThumbnails)
            }
            "player-set" -> PlayerProtocol.change(message).onSuccess(::change).onFailure(::reject)
            "player-seek" -> message.number("positionMs")?.let { engine.seek(it, message.number("snapMs") ?: 0.0) }
            "player-skips" -> engine.setSkips(PlayerProtocol.skips(message))
            "player-subtitle-add" -> {
                val url = message.text("url").orEmpty()
                if (PlayerProtocol.isWebUrl(url) || isLocal(url)) {
                    engine.addSubtitle(
                        url,
                        message.text("title"),
                        message.text("language"),
                        message.number("replace")?.toInt(),
                    )
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
            "player-subtitle-lines" -> PlayerProtocol.reference(message)
                .onSuccess {
                    reference = it.id
                    engine.watchSubtitleLines(it.id?.takeIf(::readable))
                    if (it.id != null) withIndex { lines -> reference?.let { track -> sendLines(track, lines) } }
                }
                .onFailure(::reject)
            "player-subtitle-index" -> withIndex { lines -> send(PlayerProtocol.subtitleIndex(ownSubtitles().map { it.id }, lines)) }
            "player-thumbnail" -> thumbnail(message)
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

    override fun onSubtitleLines(track: String, lines: List<SubtitleLine>) {
        main.post { send(PlayerProtocol.subtitleLines(track, lines)) }
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
        val rest = update.copy(positionMs = null, buffered = null)
        if (rest != PlayerState()) send(PlayerProtocol.state(rest))
        if (update.positionMs == null && update.buffered == null) return
        val position = (heldPosition ?: PlayerState()).then(PlayerState(positionMs = update.positionMs, buffered = update.buffered))
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

    /** Neither engine reads lines from subtitles drawn as pictures, so only the index has theirs. */
    private fun readable(track: String) = tracks.none { it.id == track && it.codec in PICTURE_CODECS }

    /** Hands `then` every own subtitle's lines from the file's index, read once a file; null without one. */
    private fun withIndex(then: (List<List<SubtitleLine>>?) -> Unit) {
        val load = loaded ?: return then(null)
        indexed?.takeIf { it.first == load.url }?.let { return then(it.second) }
        waiting += load.url to then
        if (indexing == load.url) return
        indexing = load.url
        reader.execute {
            val headers = load.headers.flatMap { listOf(it.key, it.value) }.toTypedArray()
            val lines = runCatching { indexLines(SubtitleTimeline.read(load.url, headers, trustedRoots())) }
                .onFailure { Log.w(TAG, "couldn't read the subtitle index", it) }
                .getOrNull()
            main.post {
                if (indexing == load.url) indexing = null
                val ready = waiting.filter { it.first == load.url }
                waiting.removeAll(ready)
                if (loaded?.url != load.url) return@post
                indexed = load.url to lines
                for ((_, call) in ready) call(lines)
            }
        }
    }

    private fun ownSubtitles() = tracks.filter { it.type == "subtitle" && !it.external }

    /** The index lists the file's own subtitles in the engine's order. */
    private fun sendLines(track: String, indexed: List<List<SubtitleLine>>?) {
        val own = ownSubtitles()
        val lines = indexed?.takeIf { it.size == own.size }?.getOrNull(own.indexOfFirst { it.id == track })
        if (!lines.isNullOrEmpty()) send(PlayerProtocol.subtitleLines(track, lines))
    }

    private fun thumbnail(message: JsonObject) {
        val url = message.text("url").orEmpty()
        val position = message.number("positionMs")?.toLong()
        val showing = message.number("showingMs")?.toLong() ?: -1
        if (!PlayerProtocol.isWebUrl(url) && !isLocal(url)) {
            return reject(IllegalArgumentException("only http(s) files and downloads have thumbnails"))
        }
        val headers = (message["headers"] as? JsonObject).orEmpty()
            .flatMap { (name, value) -> listOf(name, (value as? JsonPrimitive)?.contentOrNull.orEmpty()) }
            .toTypedArray()
        thumbnailer.execute {
            val handle = thumbnails?.takeIf { it.first == url }?.second ?: runCatching {
                closeThumbnails()
                val file = ++thumbnailFiles
                Thumbnails.open(url, headers, trustedRoots()) { at, jpeg, error ->
                    val src = jpeg?.let {
                        "/thumbnail/$file-$at.jpg".also { path ->
                            synchronized(thumbnailImages) { thumbnailImages[path] = it }
                        }
                    }
                    main.post { sendThumbnail(url, at, src, error) }
                }
            }.onFailure { main.post { sendThumbnail(url, -1, null, it.toString()) } }
                .getOrNull()?.also { thumbnails = url to it }
            handle?.let { if (position == null) Thumbnails.prepare(it) else Thumbnails.want(it, position, showing) }
        }
    }

    private fun closeThumbnails() {
        thumbnails?.let { Thumbnails.close(it.second) }
        thumbnails = null
    }

    private fun sendThumbnail(url: String, positionMs: Long, src: String?, error: String?) {
        if (error != null) Log.i(TAG, "no thumbnails: $error")
        send(buildJsonObject {
            put("type", "player-thumbnail")
            put("url", url)
            if (src != null) put("positionMs", positionMs)
            put("src", src)
        })
    }

    /** The JPEG at a thumbnail path the page was sent, from the web view's loader threads. */
    fun thumbnail(path: String): ByteArray? = synchronized(thumbnailImages) { thumbnailImages[path] }

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
        const val KEPT_THUMBNAILS = 256
        val SUBTITLE_TYPES = setOf("srt", "vtt", "ass", "ssa", "sub", "sup")
        val PICTURE_CODECS = setOf("hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle")

        val next = AtomicInteger()

        fun JsonObject.text(name: String) = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

        fun JsonObject.number(name: String) = (this[name] as? JsonPrimitive)?.doubleOrNull

        /** Each subtitle track's lines from [SubtitleTimeline.read], null when the file has no index. */
        fun indexLines(json: String): List<List<SubtitleLine>>? {
            val tracks = (Json.parseToJsonElement(json) as? JsonObject)?.get("tracks") as? JsonArray ?: return null
            return tracks.map { track ->
                ((track as? JsonObject)?.get("lines") as? JsonArray).orEmpty().mapNotNull { line ->
                    val (start, end) = (line as? JsonArray)?.map { (it as? JsonPrimitive)?.doubleOrNull } ?: return@mapNotNull null
                    if (start != null && end != null) SubtitleLine(start, end) else null
                }
            }
        }

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
