package io.github.viren070.aiostreams.exoplayer.subtitles.ass

import android.graphics.Color
import android.graphics.Typeface
import android.text.Layout
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.text.Cue
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.text.CuesWithTiming
import io.github.viren070.aiostreams.exoplayer.subtitles.SampleParser
import java.util.Locale

/**
 * Text subtitles as ASS for libass, with the user's look forced on a plain default style. Unplaced lines
 * sit at the bottom, where libass lifts them; placed ones keep their place.
 */
@OptIn(UnstableApi::class)
internal object AssText {
    // FFmpeg's script size for converted text.
    private const val WIDTH = 384
    private const val HEIGHT = 288

    /** Margins as the forced style has them, in this script's units. */
    private const val MARGIN_X = 8
    private const val MARGIN_Y = 14

    /** A line, for cues placed by line number. */
    private const val LINE = HEIGHT * 0.0533f * 1.2f

    val header: ByteArray = """
        [Script Info]
        ScriptType: v4.00+
        PlayResX: $WIDTH
        PlayResY: $HEIGHT
        ScaledBorderAndShadow: yes
        WrapStyle: 0

        [V4+ Styles]
        Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
        Style: Default,sans-serif,16,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,$MARGIN_X,$MARGIN_X,$MARGIN_Y,1

        [Events]
        Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    """.trimIndent().plus("\n").toByteArray()

    /** Each text cue's line as Matroska carries ASS, past its read order. */
    fun events(cues: List<Cue>): List<String> =
        cues.mapNotNull { cue -> cue.text?.takeIf { it.isNotBlank() }?.let { "0,Default,,0,0,0,,${placement(cue)}${text(it)}" } }

    /** A whole script of the lines, for a file added from outside. */
    fun script(lines: List<CuesWithTiming>): ByteArray {
        val script = StringBuilder(String(header))
        for (line in lines) {
            if (line.startTimeUs == C.TIME_UNSET || line.durationUs == C.TIME_UNSET) continue
            val start = time(line.startTimeUs)
            val end = time(line.startTimeUs + line.durationUs)
            for (event in events(line.cues)) script.append("Dialogue: 0,$start,$end,").append(event.substringAfter(',')).append('\n')
        }
        return script.toString().toByteArray()
    }

    private fun time(us: Long): String {
        val cs = us / 10_000
        return "%d:%02d:%02d.%02d".format(Locale.ROOT, cs / 360_000, cs / 6000 % 60, cs / 100 % 60, cs % 100)
    }

    private fun placement(cue: Cue): String {
        alignmentTag(cue)?.let { return if (it == 2) "" else "{\\an$it}" }
        val horizontal = when {
            cue.position != Cue.DIMEN_UNSET -> anchorColumn(cue.positionAnchor)
            cue.textAlignment == Layout.Alignment.ALIGN_NORMAL -> 1
            cue.textAlignment == Layout.Alignment.ALIGN_OPPOSITE -> 3
            else -> 2
        }
        // On the automatic line, whatever side WebVTT puts it: libass lifts that one.
        if (unplacedLine(cue)) return if (horizontal == 2) "" else "{\\an$horizontal}"
        val x = if (cue.position != Cue.DIMEN_UNSET) {
            cue.position * WIDTH
        } else {
            when (horizontal) {
                1 -> MARGIN_X.toFloat()
                3 -> WIDTH - MARGIN_X.toFloat()
                else -> WIDTH / 2f
            }
        }
        val (row, y) = when {
            cue.lineType == Cue.LINE_TYPE_NUMBER && cue.line >= 0 -> 6 to MARGIN_Y + cue.line * LINE
            cue.lineType == Cue.LINE_TYPE_NUMBER -> 0 to HEIGHT - MARGIN_Y + (cue.line + 1) * LINE
            else -> anchorRow(cue.lineAnchor) to cue.line * HEIGHT
        }
        return "{\\an${row + horizontal}\\pos(${round(x)},${round(y)})}"
    }

    /** Media3 reads SubRip's `{\anN}` as a cue placed at 8%, 50% or 92% each way. */
    private fun alignmentTag(cue: Cue): Int? {
        if (cue.lineType != Cue.LINE_TYPE_FRACTION || cue.line != fraction(cue.lineAnchor)) return null
        if (cue.position != fraction(cue.positionAnchor)) return null
        return anchorRow(cue.lineAnchor) + anchorColumn(cue.positionAnchor)
    }

    private fun fraction(anchor: Int) = when (anchor) {
        Cue.ANCHOR_TYPE_START -> 0.08f
        Cue.ANCHOR_TYPE_END -> 0.92f
        Cue.ANCHOR_TYPE_MIDDLE -> 0.5f
        else -> Float.NaN
    }

    private fun unplacedLine(cue: Cue) =
        cue.line == Cue.DIMEN_UNSET || cue.lineType == Cue.LINE_TYPE_NUMBER && cue.line == -1f

    // \an numbers count from the bottom row, left to right.
    private fun anchorRow(anchor: Int) = when (anchor) {
        Cue.ANCHOR_TYPE_END -> 0
        Cue.ANCHOR_TYPE_MIDDLE -> 3
        else -> 6
    }

    private fun anchorColumn(anchor: Int) = when (anchor) {
        Cue.ANCHOR_TYPE_START -> 1
        Cue.ANCHOR_TYPE_END -> 3
        else -> 2
    }

    private fun round(value: Float) = "%.1f".format(Locale.ROOT, value)

    private data class Look(
        val bold: Boolean = false,
        val italic: Boolean = false,
        val underline: Boolean = false,
        val strike: Boolean = false,
        val color: Int? = null,
    )

    private fun lookAt(text: Spanned, index: Int): Look {
        var look = Look()
        for (span in text.getSpans(index, index + 1, Any::class.java)) {
            look = when (span) {
                is StyleSpan -> look.copy(
                    bold = look.bold || span.style and Typeface.BOLD != 0,
                    italic = look.italic || span.style and Typeface.ITALIC != 0,
                )
                is UnderlineSpan -> look.copy(underline = true)
                is StrikethroughSpan -> look.copy(strike = true)
                is ForegroundColorSpan -> look.copy(color = span.foregroundColor)
                else -> look
            }
        }
        return look
    }

    private fun tags(from: Look, to: Look): String {
        val tags = StringBuilder()
        if (from.bold != to.bold) tags.append(if (to.bold) "\\b1" else "\\b0")
        if (from.italic != to.italic) tags.append(if (to.italic) "\\i1" else "\\i0")
        if (from.underline != to.underline) tags.append(if (to.underline) "\\u1" else "\\u0")
        if (from.strike != to.strike) tags.append(if (to.strike) "\\s1" else "\\s0")
        if (from.color != to.color) {
            // A colour ending goes back to the style's.
            tags.append(to.color?.let { "\\c&H%02X%02X%02X&".format(Color.blue(it), Color.green(it), Color.red(it)) } ?: "\\c")
        }
        return if (tags.isEmpty()) "" else "{$tags}"
    }

    private fun text(text: CharSequence): String {
        val out = StringBuilder()
        val spanned = text as? Spanned
        var look = Look()
        for (i in text.indices) {
            val next = spanned?.let { lookAt(it, i) } ?: look
            if (next != look) {
                out.append(tags(look, next))
                look = next
            }
            when (val c = text[i]) {
                '\n' -> out.append("\\N")
                '{', '}' -> out.append('\\').append(c)
                // A word joiner, so `\N` or `\h` written in the text stays text.
                '\\' -> out.append("\\\u2060")
                else -> out.append(c)
            }
        }
        return out.toString()
    }
}

/** A text track's samples as ASS lines, each once however often it's read, numbered in the order read. */
@OptIn(UnstableApi::class)
internal class AssTextTrack(var parser: SampleParser) {
    private var readOrder = 0
    private val seen = HashSet<String>()

    fun read(timeUs: Long, data: ByteArray, line: (AssLine) -> Unit) = parser.parse(timeUs, data) { cues ->
        if (cues.durationUs == C.TIME_UNSET) return@parse
        val startMs = cues.startTimeUs / 1000
        val durationMs = cues.durationUs / 1000
        for (event in AssText.events(cues.cues)) {
            // Reading a stretch again after a seek gives the same lines again.
            if (seen.add("$startMs $durationMs $event")) line(AssLine(startMs, durationMs, "${++readOrder},$event".toByteArray()))
        }
    }
}
