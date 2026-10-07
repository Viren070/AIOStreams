package io.github.viren070.aiostreams.exoplayer

import android.graphics.Color
import android.graphics.Typeface
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.text.Cue
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.text.CuesWithTiming
import androidx.media3.extractor.text.DefaultSubtitleParserFactory
import androidx.media3.extractor.text.SubtitleParser
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.SubtitleView
import java.util.TreeMap
import java.util.concurrent.ConcurrentHashMap

/** mpv's `sub-*` options, which the page sets for every subtitle. */
@OptIn(UnstableApi::class)
internal class SubtitleStyle {
    var visible = true
    var scale = 1.0
    /** Percent of the screen from the top where unplaced lines sit at the bottom. */
    var position = 100.0
    var forceMargins = false
    private var color = Color.WHITE
    private var outlineColor = Color.BLACK
    private var outlineSize = 1.65
    private var backColor = Color.TRANSPARENT
    private var box = false
    private var bold = false
    private var override = AssStyle.SCALE

    /** False for a property that isn't a subtitle style. */
    fun set(name: String, value: String): Boolean {
        when (name) {
            "sub-visibility" -> visible = value == "yes"
            "sub-scale" -> scale = value.toDoubleOrNull() ?: 1.0
            "sub-pos" -> position = value.toDoubleOrNull() ?: 100.0
            "sub-ass-force-margins" -> forceMargins = value == "yes"
            "sub-color" -> color = colorOf(value) ?: color
            "sub-outline-color" -> outlineColor = colorOf(value) ?: outlineColor
            "sub-outline-size" -> outlineSize = value.toDoubleOrNull() ?: outlineSize
            "sub-back-color" -> backColor = colorOf(value) ?: backColor
            "sub-border-style" -> box = value == "background-box"
            "sub-bold" -> bold = value == "yes"
            "sub-ass-override" -> override = when (value) {
                "no" -> AssStyle.NONE
                "force", "strip" -> AssStyle.FORCE
                else -> AssStyle.SCALE
            }
            else -> return false
        }
        return true
    }

    fun apply(view: SubtitleView) {
        val edge = if (!box && outlineSize > 0) CaptionStyleCompat.EDGE_TYPE_OUTLINE else CaptionStyleCompat.EDGE_TYPE_NONE
        view.setStyle(
            CaptionStyleCompat(
                color,
                if (box) backColor else Color.TRANSPARENT,
                Color.TRANSPARENT,
                edge,
                outlineColor,
                if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT,
            ),
        )
        view.setApplyEmbeddedStyles(override != AssStyle.FORCE)
        view.setApplyEmbeddedFontSizes(override != AssStyle.FORCE)
        view.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * scale.toFloat())
        view.setBottomPaddingFraction(SubtitleView.DEFAULT_BOTTOM_PADDING_FRACTION + (100 - position.toFloat()) / 100)
    }

    fun assStyle() = AssStyle(
        override, assColor(color), assColor(outlineColor), assColor(backColor), outlineSize,
        // mpv's numbers for outline-and-shadow and background-box.
        if (box) 4 else 1,
        bold,
    )

    private companion object {
        /** mpv writes `#AARRGGBB`, as Android reads it. */
        fun colorOf(value: String) = runCatching { Color.parseColor(value) }.getOrNull()

        /** ASS keeps alpha last, and counts it as transparency. */
        fun assColor(argb: Int) =
            (Color.red(argb) shl 24) or (Color.green(argb) shl 16) or (Color.blue(argb) shl 8) or (255 - Color.alpha(argb))
    }
}

/** A text subtitle's lines, which the engine shows on the video's frames so its delay applies. */
@OptIn(UnstableApi::class)
internal class TextTimeline(private val replace: Boolean) {
    private val lines = TreeMap<Long, MutableList<CuesWithTiming>>()
    private var longestUs = 0L

    @Synchronized
    fun add(cues: CuesWithTiming) {
        val starting = lines.getOrPut(cues.startTimeUs) { mutableListOf() }
        // Reading a file again after a seek gives the same lines again.
        if (replace) starting.clear() else if (starting.any { it.durationUs == cues.durationUs && it.cues == cues.cues }) return
        starting += cues
        if (cues.durationUs != C.TIME_UNSET) longestUs = maxOf(longestUs, cues.durationUs)
    }

    @Synchronized
    fun cuesAt(timeUs: Long): List<Cue> {
        if (replace) {
            val line = lines.floorEntry(timeUs)?.value?.last() ?: return emptyList()
            return if (line.durationUs == C.TIME_UNSET || timeUs < line.endTimeUs) line.cues else emptyList()
        }
        return lines.subMap(timeUs - longestUs, true, timeUs, true).values.flatten()
            .filter { timeUs < it.endTimeUs }
            .flatMap { it.cues }
    }
}

/** The file's text subtitles, as its reader parses them. */
internal class TextTracks {
    private val timelines = ConcurrentHashMap<String, TextTimeline>()

    /** Counts files, so a file's reader can't reach the next one's tracks. */
    @Volatile
    private var file = 0

    operator fun get(track: String): TextTimeline? = timelines[track]

    fun reset() {
        file++
        timelines.clear()
    }

    /** The reader's way in for the file opening now. */
    fun sink(): TextSink {
        val opened = file
        return object : TextSink {
            override fun track(track: String, replace: Boolean) {
                if (opened == file) timelines.putIfAbsent(track, TextTimeline(replace))
            }

            override fun cues(track: String, cues: CuesWithTiming) {
                if (opened == file) timelines[track]?.add(cues)
            }
        }
    }
}

/** A subtitle file the page added, which the engine draws itself rather than reloading the video. */
@OptIn(UnstableApi::class)
internal class ExternalSubtitle(
    val id: Int,
    val url: String,
    val title: String?,
    val lang: String?,
    val codec: String,
    /** An ASS script, which libass draws. */
    val script: ByteArray?,
    /** Anything else, which the subtitle view draws. */
    val text: TextTimeline?,
) {
    /** What libass knows the script as. */
    val key = "+$id"

    companion object {
        fun parse(id: Int, url: String, title: String?, lang: String?, bytes: ByteArray): ExternalSubtitle {
            val text = String(bytes, Charsets.UTF_8).trimStart('\uFEFF', ' ', '\r', '\n')
            if (text.startsWith("[Script Info]", ignoreCase = true)) {
                return ExternalSubtitle(id, url, title, lang, "ass", bytes, null)
            }
            val mime = if (text.startsWith("WEBVTT")) MimeTypes.TEXT_VTT else MimeTypes.APPLICATION_SUBRIP
            val parser = DefaultSubtitleParserFactory().create(Format.Builder().setSampleMimeType(mime).build())
            val timeline = TextTimeline(replace = false)
            parser.parse(bytes, SubtitleParser.OutputOptions.allCues()) { timeline.add(it) }
            val codec = if (mime == MimeTypes.TEXT_VTT) "webvtt" else "subrip"
            return ExternalSubtitle(id, url, title, lang, codec, null, timeline)
        }
    }
}
