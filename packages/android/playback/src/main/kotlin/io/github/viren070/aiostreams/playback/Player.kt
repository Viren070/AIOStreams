package io.github.viren070.aiostreams.playback

import android.net.Uri
import java.io.File
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/*
 * The page's player messages, as the desktop app's `core/src/playback.rs`
 * reads and writes them. The page names no engine command or property.
 */

enum class SubtitleMode { DEFAULT, ALWAYS, SMART, FORCED, NONE }

data class LoadRequest(
    val url: String,
    val headers: Map<String, String>,
    val startMs: Double,
    /** Plays after the current file rather than in its place. */
    val append: Boolean,
    val audioLanguages: List<String>,
    val subtitleLanguages: List<String>,
    val subtitleMode: SubtitleMode,
)

/** A track to show, or none at all with a null id. */
data class Pick(val id: String?)

/** What the page changes; null leaves it as it is. */
data class Change(
    val paused: Boolean? = null,
    val volume: Double? = null,
    val muted: Boolean? = null,
    val speed: Double? = null,
    val audio: Pick? = null,
    val subtitle: Pick? = null,
    val subtitleDelayMs: Double? = null,
) {
    /** `next` over this, as a later change wins. */
    fun then(next: Change) = Change(
        next.paused ?: paused, next.volume ?: volume, next.muted ?: muted, next.speed ?: speed,
        next.audio ?: audio, next.subtitle ?: subtitle, next.subtitleDelayMs ?: subtitleDelayMs,
    )
}

/** Colours are `#AARRGGBB` or `#RRGGBB`, sizes in mpv's units. */
data class SubtitleLook(
    val scale: Double,
    val bold: Boolean,
    val color: String,
    val outlineColor: String,
    val outlineSize: Double,
    val shadowSize: Double,
    val font: SubtitleFont?,
    val backColor: String,
    val box: Boolean,
    val forceStyle: Boolean,
    /** Percent of the height from the top where the bottom line sits. */
    val position: Double,
)

/**
 * The page's font families, which `id` also names on Android; libass knows
 * them by `family`, from the system's `file`. Sans serif is the bundled font.
 */
enum class SubtitleFont(val id: String, val family: String, val file: File?) {
    SANS_SERIF("sans-serif", "sans-serif", null),
    SERIF("serif", "Noto Serif", File("/system/fonts/NotoSerif-Regular.ttf")),
    MONOSPACE("monospace", "Droid Sans Mono", File("/system/fonts/DroidSansMono.ttf")),
    SERIF_MONOSPACE("serif-monospace", "Cutive Mono", File("/system/fonts/CutiveMono.ttf")),
    CASUAL("casual", "Coming Soon", File("/system/fonts/ComingSoon.ttf")),
    CURSIVE("cursive", "Dancing Script", File("/system/fonts/DancingScript-Regular.ttf")),
}

enum class Fit { FIT, CROP, STRETCH }

data class Style(val fit: Fit, val subtitles: SubtitleLook)

/** The settings the page sends that each engine applies itself. */
data class PlayerSettings(
    val hardwareDecoding: Boolean = true,
    /** `auto`, `stereo`, `5.1` or `7.1`. */
    val audioChannels: String = "auto",
    /** In mpv's `audio-spdif` names. */
    val passthrough: List<String> = emptyList(),
    /** Only those of [passthrough] the audio output decodes itself. */
    val passthroughAuto: Boolean = false,
    val audioDelayMs: Double = 0.0,
    /** Megabytes of the stream to hold, 0 to size it from the device's memory. */
    val cacheMb: Int = 0,
)

data class PlayerState(
    val positionMs: Double? = null,
    val durationMs: Double? = null,
    val bufferedMs: Double? = null,
    val paused: Boolean? = null,
    val buffering: Boolean? = null,
    val seeking: Boolean? = null,
    val idle: Boolean? = null,
    val volume: Double? = null,
    val maxVolume: Double? = null,
    val muted: Boolean? = null,
    val speed: Double? = null,
    val audio: Pick? = null,
    val subtitle: Pick? = null,
) {
    /** `next` over this, as a later report wins. */
    fun then(next: PlayerState) = PlayerState(
        next.positionMs ?: positionMs, next.durationMs ?: durationMs, next.bufferedMs ?: bufferedMs,
        next.paused ?: paused, next.buffering ?: buffering, next.seeking ?: seeking, next.idle ?: idle,
        next.volume ?: volume, next.maxVolume ?: maxVolume, next.muted ?: muted, next.speed ?: speed,
        next.audio ?: audio, next.subtitle ?: subtitle,
    )

    fun changesFrom(previous: PlayerState) = PlayerState(
        positionMs = positionMs.takeIf { it != previous.positionMs },
        durationMs = durationMs.takeIf { it != previous.durationMs },
        bufferedMs = bufferedMs.takeIf { it != previous.bufferedMs },
        paused = paused.takeIf { it != previous.paused },
        buffering = buffering.takeIf { it != previous.buffering },
        seeking = seeking.takeIf { it != previous.seeking },
        idle = idle.takeIf { it != previous.idle },
        volume = volume.takeIf { it != previous.volume },
        maxVolume = maxVolume.takeIf { it != previous.maxVolume },
        muted = muted.takeIf { it != previous.muted },
        speed = speed.takeIf { it != previous.speed },
        audio = audio.takeIf { it != previous.audio },
        subtitle = subtitle.takeIf { it != previous.subtitle },
    )
}

data class PlayerTrack(
    val id: String,
    /** `audio` or `subtitle`. */
    val type: String,
    val title: String? = null,
    val language: String? = null,
    val codec: String? = null,
    val default: Boolean = false,
    val forced: Boolean = false,
    val hearingImpaired: Boolean = false,
    val visualImpaired: Boolean = false,
    val external: Boolean = false,
    /** Where an added track was loaded from. */
    val url: String? = null,
)

data class PlayerChapter(val title: String?, val startMs: Double)

/** A stretch the page offers to skip, or skips itself when [auto]. */
data class Skip(val startMs: Double, val endMs: Double, val auto: Boolean)

object PlayerProtocol {
    private val modes = mapOf(
        "default" to SubtitleMode.DEFAULT, "always" to SubtitleMode.ALWAYS, "smart" to SubtitleMode.SMART,
        "forced" to SubtitleMode.FORCED, "none" to SubtitleMode.NONE,
    )

    fun isWebUrl(value: String) = Uri.parse(value).scheme in setOf("http", "https")

    /** `isLocal` says whether a path is one of the app's downloads, the only files the page may open. */
    fun load(message: JsonObject, isLocal: (String) -> Boolean) = runCatching {
        val url = message.text("url") ?: error("player-load takes a url")
        require(isWebUrl(url) || isLocal(url)) { "only http(s) urls and downloads play" }
        LoadRequest(
            url = url,
            headers = headers(message["headers"]),
            startMs = message.number("startMs") ?: 0.0,
            append = message.flag("append") == true,
            audioLanguages = languages(message["audioLanguages"]),
            subtitleLanguages = languages(message["subtitleLanguages"]),
            subtitleMode = modes[message.text("subtitleMode")] ?: SubtitleMode.DEFAULT,
        )
    }

    fun change(message: JsonObject) = runCatching {
        Change(
            paused = message.flag("paused"),
            volume = message.number("volume"),
            muted = message.flag("muted"),
            speed = message.number("speed"),
            audio = pick(message, "audio"),
            subtitle = pick(message, "subtitle"),
            subtitleDelayMs = message.number("subtitleDelayMs"),
        )
    }

    fun style(message: JsonObject) = runCatching {
        val look = message["subtitles"] as? JsonObject ?: error("player-style takes subtitles")
        fun colour(name: String) = look.text(name)?.takeIf { COLOUR.matches(it) } ?: error("$name is not a colour")
        Style(
            fit = when (message.text("fit")) {
                "crop" -> Fit.CROP
                "stretch" -> Fit.STRETCH
                else -> Fit.FIT
            },
            subtitles = SubtitleLook(
                scale = look.number("scale") ?: 1.0,
                bold = look.flag("bold") == true,
                color = colour("color"),
                outlineColor = colour("outlineColor"),
                outlineSize = look.number("outlineSize") ?: 0.0,
                shadowSize = look.number("shadowSize") ?: 0.0,
                font = look.text("font")?.let { name ->
                    SubtitleFont.entries.find { it.id == name } ?: error("$name is not a font")
                },
                backColor = colour("backColor"),
                box = look.flag("box") == true,
                forceStyle = look.text("override") == "force",
                position = look.number("position") ?: 100.0,
            ),
        )
    }

    fun skips(message: JsonObject) = (message["segments"] as? JsonArray).orEmpty().mapNotNull { segment ->
        val range = segment as? JsonObject ?: return@mapNotNull null
        val start = range.number("startMs") ?: return@mapNotNull null
        val end = range.number("endMs") ?: return@mapNotNull null
        Skip(start, end, range.flag("auto") == true).takeIf { end > start }
    }

    fun settings(message: JsonObject) = PlayerSettings(
        hardwareDecoding = message.flag("hardwareDecoding") != false,
        audioChannels = message.text("audioChannels") ?: "auto",
        passthrough = (message["passthrough"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty(),
        passthroughAuto = message.flag("passthroughAuto") == true,
        audioDelayMs = message.number("audioDelayMs") ?: 0.0,
        cacheMb = message.number("cacheMb")?.toInt() ?: 0,
    )

    fun state(state: PlayerState) = buildJsonObject {
        put("type", "player-state")
        state.positionMs?.let { put("positionMs", it) }
        state.durationMs?.let { put("durationMs", it) }
        state.bufferedMs?.let { put("bufferedMs", it) }
        state.paused?.let { put("paused", it) }
        state.buffering?.let { put("buffering", it) }
        state.seeking?.let { put("seeking", it) }
        state.idle?.let { put("idle", it) }
        state.volume?.let { put("volume", it) }
        state.maxVolume?.let { put("maxVolume", it) }
        state.muted?.let { put("muted", it) }
        state.speed?.let { put("speed", it) }
        state.audio?.let { put("audio", it.id) }
        state.subtitle?.let { put("subtitle", it.id) }
    }

    fun tracks(tracks: List<PlayerTrack>) = buildJsonObject {
        put("type", "player-tracks")
        put("tracks", buildJsonArray {
            for (track in tracks) add(buildJsonObject {
                put("id", track.id)
                put("type", track.type)
                track.title?.let { put("title", it) }
                track.language?.let { put("language", it) }
                track.codec?.let { put("codec", it) }
                put("default", track.default)
                put("forced", track.forced)
                put("hearingImpaired", track.hearingImpaired)
                put("visualImpaired", track.visualImpaired)
                put("external", track.external)
                track.url?.let { put("url", it) }
            })
        })
    }

    fun chapters(chapters: List<PlayerChapter>) = buildJsonObject {
        put("type", "player-chapters")
        put("chapters", buildJsonArray {
            for (chapter in chapters) add(buildJsonObject {
                chapter.title?.let { put("title", it) }
                put("startMs", chapter.startMs)
            })
        })
    }

    /** `cause` is the reader's first error, which says why loading failed. */
    fun ended(reason: String, error: String?, cause: String?) = buildJsonObject {
        put("type", "player-ended")
        put("reason", reason)
        put("error", error)
        cause?.let { put("cause", it) }
        cause?.let { STATUS.find(it) }?.groupValues?.get(1)?.toIntOrNull()?.let { put("status", it) }
    }

    private val COLOUR = Regex("^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
    private val STATUS = Regex("""HTTP error (\d{3})""")
    private val LANGUAGE = Regex("^[A-Za-z0-9-]{1,16}$")

    private fun headers(value: JsonElement?): Map<String, String> =
        (value as? JsonObject).orEmpty().mapValues { (name, value) ->
            val text = (value as? JsonPrimitive)?.takeIf { it.isString }?.content
            // A backslash before mpv's list separator would escape it.
            require(isHeaderName(name) && text != null && text.all { it in ' '..'~' } && !text.endsWith('\\')) {
                "header $name is not allowed"
            }
            text
        }

    private fun languages(value: JsonElement?): List<String> =
        (value as? JsonArray)?.map { element ->
            val code = (element as? JsonPrimitive)?.contentOrNull
            require(code != null && LANGUAGE.matches(code)) { "$element is not a language" }
            code
        }.orEmpty()

    private fun pick(message: JsonObject, name: String): Pick? {
        val value = message[name] ?: return null
        if (value is JsonNull) return Pick(null)
        val id = (value as? JsonPrimitive)?.contentOrNull
        require(id != null && id.all(Char::isDigit) && id.isNotEmpty()) { "$name $value is not a track" }
        return Pick(id)
    }

    private fun isHeaderName(name: String) =
        name.isNotEmpty() && name.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it in "!#\$%&'*+-.^_`|~" }

    private fun JsonObject.text(name: String) = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonObject.flag(name: String) = (this[name] as? JsonPrimitive)?.booleanOrNull

    private fun JsonObject.number(name: String) = (this[name] as? JsonPrimitive)?.let { it.doubleOrNull ?: it.longOrNull?.toDouble() }
}
