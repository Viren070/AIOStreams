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
import io.github.viren070.aiostreams.playback.SubtitleFont
import io.github.viren070.aiostreams.playback.SubtitleLook
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
    private var shadowSize = 0.0
    private var font: SubtitleFont? = null
    private var backColor = Color.TRANSPARENT
    private var box = false
    private var bold = false
    private var override = AssStyle.SCALE

    fun apply(look: SubtitleLook, forceMargins: Boolean) {
        scale = look.scale
        position = look.position
        this.forceMargins = forceMargins
        color = colorOf(look.color) ?: color
        outlineColor = colorOf(look.outlineColor) ?: outlineColor
        outlineSize = look.outlineSize
        shadowSize = look.shadowSize
        font = look.font
        backColor = colorOf(look.backColor) ?: backColor
        box = look.box
        bold = look.bold
        override = if (look.forceStyle) AssStyle.FORCE else AssStyle.SCALE
    }

    fun apply(view: SubtitleView) {
        // The view draws one edge, so a shadow takes the outline's place.
        val edge = when {
            box -> CaptionStyleCompat.EDGE_TYPE_NONE
            shadowSize > 0 -> CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW
            outlineSize > 0 -> CaptionStyleCompat.EDGE_TYPE_OUTLINE
            else -> CaptionStyleCompat.EDGE_TYPE_NONE
        }
        val family = font?.let { Typeface.create(it.id, Typeface.NORMAL) } ?: Typeface.DEFAULT
        view.setStyle(
            CaptionStyleCompat(
                color,
                if (box) backColor else Color.TRANSPARENT,
                Color.TRANSPARENT,
                edge,
                outlineColor,
                Typeface.create(family, if (bold) Typeface.BOLD else Typeface.NORMAL),
            ),
        )
        view.setApplyEmbeddedStyles(override != AssStyle.FORCE)
        view.setApplyEmbeddedFontSizes(override != AssStyle.FORCE)
        view.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * scale.toFloat())
        view.setBottomPaddingFraction(SubtitleView.DEFAULT_BOTTOM_PADDING_FRACTION + (100 - position.toFloat()) / 100)
    }

    fun assStyle() = AssStyle(
        // Outside a box, ASS draws the shadow in its back colour.
        override, assColor(color), assColor(outlineColor), assColor(if (box) backColor else outlineColor), outlineSize,
        // mpv's numbers for outline-and-shadow and background-box.
        if (box) 4 else 1,
        bold,
        shadowSize,
        font?.file?.takeIf { it.canRead() }?.path,
    )

    private companion object {
        /** mpv writes `#AARRGGBB`, as Android reads it. */
        fun colorOf(value: String) = runCatching { Color.parseColor(value) }.getOrNull()

        /** ASS keeps alpha last, and counts it as transparency. */
        fun assColor(argb: Int) =
            (Color.red(argb) shl 24) or (Color.green(argb) shl 16) or (Color.blue(argb) shl 8) or (255 - Color.alpha(argb))
    }
}

/** WebVTT's automatic line arrives as the last line, which the view's bottom padding never moves. */
internal fun unplaced(cue: Cue): Cue =
    if (cue.verticalType == Cue.TYPE_UNSET && cue.lineType == Cue.LINE_TYPE_NUMBER && cue.line == -1f) {
        cue.buildUpon().setLine(Cue.DIMEN_UNSET, Cue.TYPE_UNSET).build()
    } else {
        cue
    }

/** A text subtitle's lines, which the engine shows on the video's frames so its delay applies. */
@OptIn(UnstableApi::class)
internal class TextTimeline(private val replace: Boolean, private val parser: SampleParser? = null) {
    private val lines = TreeMap<Long, MutableList<CuesWithTiming>>()
    private var longestUs = 0L

    /** A file track's samples, parsed only once a frame showing the track reaches them. */
    private val samples = TreeMap<Long, MutableList<ByteArray>>()

    @Synchronized
    fun add(cues: CuesWithTiming) {
        val starting = lines.getOrPut(cues.startTimeUs) { mutableListOf() }
        // Reading a file again after a seek gives the same lines again.
        if (replace) starting.clear() else if (starting.any { it.durationUs == cues.durationUs && it.cues == cues.cues }) return
        starting += cues
        if (cues.durationUs != C.TIME_UNSET) longestUs = maxOf(longestUs, cues.durationUs)
    }

    @Synchronized
    fun sample(timeUs: Long, data: ByteArray) {
        val starting = samples.getOrPut(timeUs) { mutableListOf() }
        if (starting.none { it.contentEquals(data) }) starting += data
        val from = timeUs - KEPT_US
        samples.headMap(samples.floorKey(from) ?: from).clear()
        lines.headMap(if (replace) lines.floorKey(from) ?: from else from - longestUs).clear()
    }

    @Synchronized
    fun trim(beforeUs: Long) {
        samples.headMap(samples.floorKey(beforeUs) ?: beforeUs).clear()
        lines.headMap(if (replace) lines.floorKey(beforeUs) ?: beforeUs else beforeUs - longestUs).clear()
    }

    @Synchronized
    fun cuesAt(timeUs: Long): List<Cue> {
        if (replace) samples.floorKey(timeUs)?.let { samples.headMap(it).clear() }
        while (true) {
            val due = samples.firstEntry()?.takeIf { it.key <= timeUs } ?: break
            samples.pollFirstEntry()
            for (data in due.value) parser?.parse(due.key, data, ::add)
        }
        if (replace) {
            val line = lines.floorEntry(timeUs)?.value?.last() ?: return emptyList()
            return if (line.durationUs == C.TIME_UNSET || timeUs < line.endTimeUs) line.cues else emptyList()
        }
        return lines.subMap(timeUs - longestUs, true, timeUs, true).values.flatten()
            .filter { timeUs < it.endTimeUs }
            .flatMap { it.cues }
    }

    private companion object {
        /* Media3 reads up to 50 s ahead of the frames, and a delay shows lines up to a minute old. */
        const val KEPT_US = 120_000_000L
    }
}

/** The file's text subtitles, as its reader takes them. */
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

    /** Hidden tracks keep only lines that could show at once if picked. */
    fun trimHidden(shown: TextTimeline?, timeUs: Long) {
        for (timeline in timelines.values) if (timeline !== shown) timeline.trim(timeUs - HIDDEN_KEPT_US)
    }

    private companion object {
        const val HIDDEN_KEPT_US = 30_000_000L
    }

    /** The reader's way in for the file opening now. */
    fun sink(): TextSink {
        val opened = file
        return object : TextSink {
            override fun track(track: String, parser: SampleParser) {
                if (opened == file) timelines.putIfAbsent(track, TextTimeline(parser.replace, parser))
            }

            override fun sample(track: String, timeUs: Long, data: ByteArray) {
                if (opened == file) timelines[track]?.sample(timeUs, data)
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
