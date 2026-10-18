package io.github.viren070.aiostreams.mpv

import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.util.Base64
import android.util.Log
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import io.github.viren070.aiostreams.playback.CacheBudget
import io.github.viren070.aiostreams.playback.Change
import io.github.viren070.aiostreams.playback.Engine
import io.github.viren070.aiostreams.playback.Fit
import io.github.viren070.aiostreams.playback.LoadRequest
import io.github.viren070.aiostreams.playback.Pick
import io.github.viren070.aiostreams.playback.PlayerChapter
import io.github.viren070.aiostreams.playback.PlayerSettings
import io.github.viren070.aiostreams.playback.PlayerState
import io.github.viren070.aiostreams.playback.PlayerTrack
import io.github.viren070.aiostreams.playback.Sound
import io.github.viren070.aiostreams.playback.Style
import io.github.viren070.aiostreams.playback.SubtitleFont
import io.github.viren070.aiostreams.playback.SubtitleMode
import `is`.xyz.mpv.MPV
import `is`.xyz.mpv.MPVNode
import java.io.File
import java.security.KeyStore
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** libmpv, drawing into a surface of its own. */
class MpvEngine(private val context: Context) : Engine {
    private lateinit var mpv: MPV
    // The page's calls wait on mpv, never the main thread.
    private val calls = Executors.newSingleThreadExecutor { Thread(it, "mpv-calls") }
    private var listener: Engine.Listener? = null

    @Volatile
    private var cause: String? = null

    @Volatile
    private var dolbyVision = true
    private var stripping = false

    @Volatile
    private var sound = Sound()

    // Used on the calls thread only.
    private var filters: SoundFilters? = null
    private var subtitleScale: Double? = null
    private var ownFont = ""
    private var statsPage: String? = null

    // The shown subtitle and the file's picture subtitles, which keep their own size.
    @Volatile
    private var shownSubtitle: String? = null

    @Volatile
    private var pictures = emptySet<String>()
    private var picture = false

    private val tv = context.getSystemService(UiModeManager::class.java).currentModeType ==
        Configuration.UI_MODE_TYPE_TELEVISION

    private val dir = File(context.filesDir, "mpv")

    override val description: String
        get() = property("mpv-version") ?: "mpv"

    override fun start(listener: Engine.Listener) {
        this.listener = listener
        dir.mkdirs()
        // mpv's TLS can't read Android's certificate store, so it gets a copy each start.
        writeCertificates(context, File(dir, CA_BUNDLE))
        fallbackFont(context)
        copyFonts()
        val options = mapOf(
            "config" to "yes",
            "config-dir" to dir.path,
            "gpu-shader-cache-dir" to context.cacheDir.path,
            "icc-cache-dir" to context.cacheDir.path,
            // The surface brings the real output; a file opened before it would otherwise get none.
            "vo" to "null",
            "gpu-context" to "android",
            "hwdec" to "mediacodec,mediacodec-copy",
            "tls-verify" to "yes",
            "tls-ca-file" to File(dir, CA_BUNDLE).path,
            "keep-open" to "no",
            "force-window" to "no",
            "input-default-bindings" to "no",
            "input-vo-keyboard" to "no",
            "osc" to "no",
            "osd-bar" to "no",
            "ytdl" to "no",
        )
        mpv = MPV(context) { for ((name, value) in options) it.setOptionString(name, value) }
        // MPV leaves mpv paused, and idling only until its first file ends.
        mpv.setOptionString("idle", "yes")
        mpv.setPropertyBoolean("pause", false)
        ownFont = mpv.getPropertyString("sub-font").orEmpty()
        mpv.addObserver(observer)
        mpv.addLogObserver(logs)
        for (name in OBSERVED) mpv.observeProperty(name, formatOf(name))
        mpv.observeProperty(AUDIO_PARAMS, MPV.mpvFormat.MPV_FORMAT_NODE)
        calls.execute { filters = SoundFilters(mpv) }
    }

    private fun command(vararg args: String) = calls.execute { mpv.command(*args) }

    private fun set(name: String, value: String) = mpv.setPropertyString(name, value)

    override fun property(name: String): String? = mpv.getPropertyString(name)

    /** libass here finds fonts only in mpv's fonts folder. */
    private fun copyFonts() {
        val fonts = File(dir, "fonts").apply { mkdirs() }
        for (file in SubtitleFont.entries.mapNotNull { it.file }) {
            val copy = File(fonts, file.name)
            if (!copy.exists() && file.canRead()) runCatching { file.copyTo(copy) }
        }
    }

    fun reloadConfig() = command("load-config-file", configFile(context).path)

    override fun load(request: LoadRequest) = calls.execute {
        val options = buildList {
            if (request.startMs > 0) add("start=${seconds(request.startMs)}")
            addAll(listOption("alang", request.audioLanguages))
            val slang = listOption("slang", request.subtitleLanguages)
            when (request.subtitleMode) {
                SubtitleMode.NONE -> add("sid=no")
                SubtitleMode.FORCED -> addAll(listOf("subs-fallback=no", "subs-fallback-forced=always"))
                SubtitleMode.ALWAYS -> addAll(slang + listOf("subs-fallback=yes", "subs-with-matching-audio=yes"))
                SubtitleMode.SMART -> addAll(slang + "subs-with-matching-audio=no")
                SubtitleMode.DEFAULT -> addAll(slang)
            }
            headerFields(request.headers)?.let(::add)
        }
        // A queued file replaces whatever was queued before it.
        if (request.append) mpv.command("playlist-clear")
        mpv.command("loadfile", request.url, if (request.append) "append" else "replace", "-1", options.joinToString(","))
    }

    override fun stop() = command("stop")

    override fun change(change: Change) = calls.execute {
        change.paused?.let { set("pause", flag(it)) }
        change.volume?.let { set("volume", Math.round(it * 100).toString()) }
        change.muted?.let { set("mute", flag(it)) }
        change.speed?.let { set("speed", it.toString()) }
        change.audio?.let { set("aid", it.id ?: "no") }
        change.subtitle?.let { set("sid", it.id ?: "no") }
        change.subtitleDelayMs?.let { set("sub-delay", seconds(it)) }
    }

    // mpv's keyframe seeks aren't bounded, so it seeks exactly.
    override fun seek(positionMs: Double, snapMs: Double) = command("seek", seconds(positionMs), "absolute")

    override fun addSubtitle(url: String, title: String?, language: String?) =
        command("sub-add", url, "select", title.orEmpty(), language.orEmpty())

    override fun setStyle(style: Style) = calls.execute {
        val s = style.subtitles
        set("keepaspect", flag(style.fit != Fit.STRETCH))
        set("panscan", if (style.fit == Fit.CROP) "1" else "0")
        set("sub-ass-force-margins", flag(style.fit == Fit.CROP))
        set("sub-bold", flag(s.bold))
        set("sub-color", s.color)
        set("sub-outline-color", s.outlineColor)
        set("sub-outline-size", s.outlineSize.toString())
        set("sub-shadow-offset", s.shadowSize.toString())
        set("sub-shadow-color", s.outlineColor)
        set("sub-font", s.font?.family ?: ownFont)
        set("sub-back-color", s.backColor)
        set("sub-border-style", if (s.box) "background-box" else "outline-and-shadow")
        set("sub-ass-override", if (s.forceStyle) "force" else "scale")
        set("sub-pos", Math.round(s.position).toString())
        subtitleScale = s.scale
        set("sub-scale", if (picture) "1" else s.scale.toString())
    }

    // TVs copy MediaCodec's frames back: some draw direct ones wrong, and they have no battery to save.
    override fun setSettings(settings: PlayerSettings) = calls.execute {
        set(
            "hwdec",
            when {
                !settings.hardwareDecoding -> "no"
                tv -> "mediacodec-copy"
                else -> "mediacodec,mediacodec-copy"
            },
        )
        set("audio-channels", settings.audioChannels.takeIf { it in setOf("stereo", "5.1", "7.1") } ?: "auto-safe")
        set("audio-spdif", settings.passthrough.joinToString(","))
        set("audio-delay", seconds(settings.audioDelayMs))
        // The user's mpv.conf may size it instead.
        if (configFile(context).takeIf { it.exists() }?.readText()?.contains("demuxer-max-bytes") != true) {
            val budget = CacheBudget.bytes(context, settings.cacheMb)
            set("demuxer-max-bytes", (budget - budget / 4).toString())
            set("demuxer-max-back-bytes", (budget / 4).toString())
        }
    }

    override fun showStatsOverlay(page: String?) = calls.execute {
        if (page != null && page !in STATS_PAGES) return@execute
        if (statsPage != null) mpv.command("script-binding", "stats/display-stats-toggle")
        if (page != null) mpv.command("script-binding", "stats/display-page-$page-toggle")
        statsPage = page
    }

    /** Keeps a picture subtitle at its own size. */
    private fun followSubtitle() {
        val now = shownSubtitle in pictures
        if (now == picture) return
        picture = now
        val scale = subtitleScale ?: return
        set("sub-scale", if (now) "1" else scale.toString())
    }

    override fun setDolbyVision(on: Boolean) {
        dolbyVision = on
    }

    override fun setSound(sound: Sound) {
        this.sound = sound
        calls.execute { filters?.apply(sound) }
    }

    private fun updateFilters(change: SoundFilters.() -> Unit) = calls.execute {
        filters?.run {
            change()
            apply(sound)
        }
    }

    override fun createView(context: Context): View = SurfaceView(context).apply { holder.addCallback(surface) }

    override fun stats(): JsonObject = buildJsonObject {
        put("engine", "mpv")
        for (name in STATS) property(name)?.toLongOrNull()?.let { put(name, it) }
    }

    private val surface = object : SurfaceHolder.Callback {
        override fun surfaceCreated(holder: SurfaceHolder) = calls.execute {
            mpv.attachSurface(holder.surface)
            mpv.setOptionString("force-window", "yes")
            mpv.setPropertyString("vo", VO)
        }

        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) =
            calls.execute { mpv.setPropertyString("android-surface-size", "${width}x$height") }

        // The surface is gone once this returns, so mpv has to let go of it first.
        override fun surfaceDestroyed(holder: SurfaceHolder) {
            val done = CountDownLatch(1)
            calls.execute {
                mpv.setPropertyString("vo", "null")
                mpv.setOptionString("force-window", "no")
                mpv.detachSurface()
                done.countDown()
            }
            done.await(2, TimeUnit.SECONDS)
        }
    }

    override fun release() {
        mpv.removeObserver(observer)
        mpv.removeLogObserver(logs)
        calls.shutdown()
        mpv.close()
    }

    private val observer = object : MPV.EventObserver {
        override fun eventProperty(property: String) =
            if (property == AUDIO_PARAMS) updateFilters { decoded(null) } else report(property, JsonNull)

        override fun eventProperty(property: String, value: Long) = report(property, JsonPrimitive(value))

        override fun eventProperty(property: String, value: Boolean) = report(property, JsonPrimitive(value))

        override fun eventProperty(property: String, value: String) = report(property, JsonPrimitive(value))

        override fun eventProperty(property: String, value: Double) = report(property, JsonPrimitive(value))

        override fun eventProperty(property: String, value: MPVNode) = if (property == AUDIO_PARAMS) {
            updateFilters { decoded(value) }
        } else {
            report(property, runCatching { Json.parseToJsonElement(value.toJson()) }.getOrDefault(JsonNull))
        }

        override fun event(eventId: Int, data: MPVNode) {
            val listener = listener ?: return
            when (eventId) {
                MPV.mpvEvent.MPV_EVENT_START_FILE -> {
                    cause = null
                    updateFilters { startFile() }
                    listener.onEvent("start")
                }
                MPV.mpvEvent.MPV_EVENT_FILE_LOADED -> {
                    calls.execute(::routeDolbyVision)
                    updateFilters { loaded() }
                    // mpv reports the tracks it picked only after this event, which the page re-picks on.
                    for (name in listOf("aid", "sid")) mpv.getPropertyString(name)?.let { report(name, JsonPrimitive(it)) }
                    listener.onEvent("loaded")
                }
                MPV.mpvEvent.MPV_EVENT_PLAYBACK_RESTART -> listener.onEvent("restart")
                MPV.mpvEvent.MPV_EVENT_END_FILE -> {
                    val fields = runCatching { data.asMap() }.getOrNull().orEmpty()
                    val error = fields["file_error"]?.asString()
                    listener.onEnded(fields["reason"]?.asString() ?: "unknown", error, cause.takeIf { error != null })
                    cause = null
                }
            }
        }
    }

    /**
     * Dolby Vision profile 5's metadata has to reshape every frame, which
     * MediaCodec's frames reach mpv too late for. FFmpeg's decoder keeps it.
     * Other profiles carry an HDR10 picture, which plays without it when asked.
     */
    private fun routeDolbyVision() {
        if (stripping) runCatching { mpv.command("vf", "remove", DOLBY_VISION_FILTER) }
        stripping = false
        when (mpv.getPropertyString("current-tracks/video/dolby-vision-profile")) {
            null, "" -> {}
            "5" -> mpv.setPropertyString("file-local-options/hwdec", "no")
            else -> if (!dolbyVision) {
                mpv.command("vf", "add", "$DOLBY_VISION_FILTER:format=dolbyvision=no")
                stripping = true
            }
        }
    }

    private val logs = object : MPV.LogObserver {
        override fun logMessage(prefix: String, level: Int, text: String) {
            val line = text.trimEnd()
            // mpv's error names only the step that failed; FFmpeg's first network error says why.
            if (level <= LOG_ERROR && prefix == "ffmpeg" && cause == null) cause = line.replace(PROTOCOL, "")
            if (level <= LOG_ERROR) updateFilters { refused(prefix, line) }
            if (level <= LOG_WARN) Log.println(if (level <= LOG_ERROR) Log.ERROR else Log.WARN, TAG, "[$prefix] $line")
        }
    }

    /** An observed property's change, in the page's terms. */
    private fun report(name: String, value: JsonElement) {
        val listener = listener ?: return
        val primitive = value as? JsonPrimitive
        val number = primitive?.doubleOrNull
        val on = primitive?.booleanOrNull == true
        val state = when (name) {
            "time-pos" -> PlayerState(positionMs = (number ?: return) * 1000)
            "duration" -> PlayerState(durationMs = (number ?: return) * 1000)
            "demuxer-cache-time" -> PlayerState(bufferedMs = (number ?: return) * 1000)
            "pause" -> PlayerState(paused = on)
            "paused-for-cache" -> PlayerState(buffering = on)
            "seeking" -> PlayerState(seeking = on)
            "idle-active" -> PlayerState(idle = on)
            "volume" -> PlayerState(volume = (number ?: return) / 100)
            "volume-max" -> PlayerState(maxVolume = (number ?: return) / 100)
            "mute" -> PlayerState(muted = on)
            "speed" -> PlayerState(speed = number ?: return)
            "aid" -> PlayerState(audio = Pick(trackId(primitive)))
            "sid" -> {
                shownSubtitle = trackId(primitive)
                calls.execute(::followSubtitle)
                PlayerState(subtitle = Pick(shownSubtitle))
            }
            "track-list" -> {
                val list = (value as? JsonArray).orEmpty().filterIsInstance<JsonObject>()
                pictures = list.filter { it.text("type") == "sub" && it.text("codec") in PICTURE_CODECS }
                    .mapNotNull { it.text("id") }.toSet()
                calls.execute(::followSubtitle)
                return listener.onTracks(list.mapNotNull(::trackOf))
            }
            "chapter-list" -> return listener.onChapters(
                (value as? JsonArray).orEmpty().filterIsInstance<JsonObject>().map {
                    PlayerChapter(it.text("title"), ((it["time"] as? JsonPrimitive)?.doubleOrNull ?: 0.0) * 1000)
                },
            )
            "video-params" -> {
                val params = value as? JsonObject ?: return
                return listener.onVideo(
                    width = (params["dw"] as? JsonPrimitive)?.intOrNull,
                    height = (params["dh"] as? JsonPrimitive)?.intOrNull,
                )
            }
            "container-fps" -> return listener.onVideo(frameRate = number ?: return)
            else -> return
        }
        listener.onState(state)
    }

    companion object {
        private val OBSERVED = listOf(
            "time-pos", "duration", "demuxer-cache-time", "pause", "paused-for-cache", "seeking",
            "idle-active", "volume", "volume-max", "mute", "speed", "aid", "sid",
            "track-list", "chapter-list", "video-params", "container-fps",
        )
        private val STATS_PAGES = setOf("1", "2", "3", "5")
        private val PICTURE_CODECS = setOf("hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle")

        private fun flag(on: Boolean) = if (on) "yes" else "no"

        private fun seconds(ms: Double) = "%.3f".format(Locale.ROOT, ms / 1000)

        private fun listOption(name: String, values: List<String>) =
            values.mapIndexed { i, value -> "$name${if (i > 0) "-append" else ""}=$value" }

        /** mpv's `http-header-fields` option for the headers, as the desktop app builds it. */
        private fun headerFields(headers: Map<String, String>): String? {
            if (headers.isEmpty()) return null
            val list = headers.entries.joinToString(",") { (name, value) -> "$name: ${value.replace(",", "\\,")}" }
            // The length prefix keeps the list's commas inside the one option.
            return "http-header-fields=%${list.length}%$list"
        }

        /** mpv reads a track id as `auto` until a file picks one. */
        private fun trackId(value: JsonPrimitive?) = value?.contentOrNull?.takeIf { it.isNotEmpty() && it.all(Char::isDigit) }

        private fun JsonObject.text(name: String) = (this[name] as? JsonPrimitive)?.contentOrNull

        private fun trackOf(track: JsonObject): PlayerTrack? {
            val type = when (track.text("type")) {
                "audio" -> "audio"
                "sub" -> "subtitle"
                else -> return null
            }
            fun on(name: String) = (track[name] as? JsonPrimitive)?.booleanOrNull == true
            return PlayerTrack(
                id = (track["id"] as? JsonPrimitive)?.longOrNull?.toString() ?: return null,
                type = type,
                title = track.text("title"),
                language = track.text("lang"),
                codec = track.text("codec"),
                default = on("default"),
                forced = on("forced"),
                hearingImpaired = on("hearing-impaired"),
                visualImpaired = on("visual-impaired"),
                external = on("external"),
                url = track.text("external-filename"),
            )
        }

        /** Labelled, so the user's own `vf` stays as it is. */
        private const val DOLBY_VISION_FILTER = "@aiostreams-dovi"

        /** Observed for the sound filters rather than the page. */
        private const val AUDIO_PARAMS = "audio-params"

        /** The user's own options, which mpv reads at start and on [reloadConfig]. */
        fun configFile(context: Context) = File(File(context.filesDir, "mpv"), "mpv.conf")

        /** The font mpv draws subtitles in where a script's own fonts are missing. */
        fun fallbackFont(context: Context): File =
            File(File(context.filesDir, "mpv").apply { mkdirs() }, FONT).also { copyAsset(context, FONT, it) }

        /** Every certificate Android trusts, the user's own included, as PEM. */
        private fun writeCertificates(context: Context, target: File) {
            val store = KeyStore.getInstance("AndroidCAStore").apply { load(null) }
            target.writeText(buildString {
                for (alias in store.aliases()) {
                    val certificate = store.getCertificate(alias) ?: continue
                    append("-----BEGIN CERTIFICATE-----\n")
                    append(Base64.encodeToString(certificate.encoded, Base64.DEFAULT))
                    append("-----END CERTIFICATE-----\n")
                }
                // Same extra roots as the network security config, for mpv's own TLS.
                for (id in listOf(R.raw.isrg_root_x1, R.raw.isrg_root_x2)) {
                    append(context.resources.openRawResource(id).bufferedReader().use { it.readText() })
                }
            })
        }

        private fun copyAsset(context: Context, name: String, target: File) {
            if (target.exists()) return
            context.assets.open(name).use { input -> target.outputStream().use(input::copyTo) }
        }

        private const val CA_BUNDLE = "cacert.pem"
        private const val FONT = "subfont.ttf"

        private val STATS = listOf("frame-drop-count", "decoder-frame-drop-count", "vo-delayed-frame-count")
        private const val TAG = "mpv"
        private const val VO = "gpu-next"
        private const val LOG_ERROR = 20
        private const val LOG_WARN = 30
        private val PROTOCOL = Regex("^\\w+: ")

        private fun formatOf(name: String): Int = when (name) {
            "pause", "paused-for-cache", "seeking", "idle-active", "mute" -> MPV.mpvFormat.MPV_FORMAT_FLAG
            "aid", "sid" -> MPV.mpvFormat.MPV_FORMAT_STRING
            "track-list", "chapter-list", "video-params" -> MPV.mpvFormat.MPV_FORMAT_NODE
            else -> MPV.mpvFormat.MPV_FORMAT_DOUBLE
        }
    }
}
