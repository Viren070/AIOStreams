package io.github.viren070.aiostreams.exoplayer.subtitles

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.Consumer
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.text.CuesWithTiming
import androidx.media3.extractor.text.DefaultSubtitleParserFactory
import androidx.media3.extractor.text.SubtitleParser

@OptIn(UnstableApi::class)
internal val subtitleParsers = DefaultSubtitleParserFactory()

internal fun isAss(format: Format) = format.sampleMimeType == MimeTypes.TEXT_SSA || format.codecs == MimeTypes.TEXT_SSA

/** ASS, and text whose lines don't take each other's place, which libass draws; the subtitle view draws the rest. */
@OptIn(UnstableApi::class)
internal fun drawnByLibass(format: Format): Boolean {
    if (isAss(format)) return true
    // The player's format, once Media3 has made the samples cues, keeps the file's own in its codecs.
    val own = if (format.sampleMimeType == MimeTypes.APPLICATION_MEDIA3_CUES) {
        format.buildUpon().setSampleMimeType(format.codecs).build()
    } else {
        format
    }
    return subtitleParsers.supportsFormat(own) &&
        subtitleParsers.getCueReplacementBehavior(own) == Format.CUE_REPLACEMENT_BEHAVIOR_MERGE
}

/** Media3's subtitle formats, which here give the player no cues. */
@OptIn(UnstableApi::class)
internal object Silent : SubtitleParser.Factory {
    override fun supportsFormat(format: Format) = subtitleParsers.supportsFormat(format)

    override fun getCueReplacementBehavior(format: Format) = subtitleParsers.getCueReplacementBehavior(format)

    override fun create(format: Format): SubtitleParser = Nothing

    private object Nothing : SubtitleParser {
        override fun parse(
            data: ByteArray,
            offset: Int,
            length: Int,
            outputOptions: SubtitleParser.OutputOptions,
            output: Consumer<CuesWithTiming>,
        ) {}

        override fun getCueReplacementBehavior() = Format.CUE_REPLACEMENT_BEHAVIOR_REPLACE
    }
}

/** Parses a file track's samples, timed as Media3's own transcoder times them. */
@OptIn(UnstableApi::class)
internal class SampleParser(format: Format) {
    private val parser = if (format.sampleMimeType == MimeTypes.APPLICATION_PGS) Pgs() else subtitleParsers.create(format)
    private val offsetUs = format.subsampleOffsetUs

    /** Whether each line takes the place of the one before, as in bitmap subtitles. */
    val replace = subtitleParsers.getCueReplacementBehavior(format) == Format.CUE_REPLACEMENT_BEHAVIOR_REPLACE

    fun parse(timeUs: Long, data: ByteArray, output: (CuesWithTiming) -> Unit) =
        parser.parse(data, SubtitleParser.OutputOptions.allCues()) { cues ->
            val startUs = when {
                cues.startTimeUs == C.TIME_UNSET -> timeUs
                offsetUs == Format.OFFSET_SAMPLE_RELATIVE -> timeUs + cues.startTimeUs
                else -> cues.startTimeUs + offsetUs
            }
            output(CuesWithTiming(cues.cues, startUs, cues.durationUs))
        }
}
