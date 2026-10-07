package io.github.viren070.aiostreams.exoplayer

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.Consumer
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.TrackOutput
import androidx.media3.extractor.mkv.EbmlProcessor
import androidx.media3.extractor.mkv.MatroskaExtractor
import androidx.media3.extractor.text.CuesWithTiming
import androidx.media3.extractor.text.DefaultSubtitleParserFactory
import androidx.media3.extractor.text.SubtitleParser
import androidx.media3.extractor.text.SubtitleTranscodingExtractorOutput
import java.io.EOFException

/** Where a file's ASS goes as it is read: its fonts, each track's header, and the lines. */
internal interface AssSink {
    fun font(name: String, data: ByteArray)

    fun header(track: String, header: ByteArray)

    fun line(track: String, startMs: Long, durationMs: Long, line: ByteArray)
}

/** Where a file's other subtitles go as Media3 parses them. */
internal interface TextSink {
    /** `replace` when each line takes the place of the one before, as in bitmap subtitles. */
    fun track(track: String, replace: Boolean)

    fun cues(track: String, cues: CuesWithTiming)
}

internal class SubtitleSink(val ass: AssSink, val text: TextSink)

internal fun isAss(format: Format) = format.sampleMimeType == MimeTypes.TEXT_SSA || format.codecs == MimeTypes.TEXT_SSA

/** Media3's extractors, with Matroska's sending its subtitles to the file's [SubtitleSink]. */
@OptIn(UnstableApi::class)
internal class SubtitleExtractors(private val sink: () -> SubtitleSink) : ExtractorsFactory {
    private val defaults = DefaultExtractorsFactory()

    override fun createExtractors() = withSubtitles(defaults.createExtractors())

    override fun createExtractors(uri: Uri, responseHeaders: Map<String, List<String>>) =
        withSubtitles(defaults.createExtractors(uri, responseHeaders))

    override fun setSubtitleParserFactory(subtitleParserFactory: SubtitleParser.Factory) = apply {
        defaults.setSubtitleParserFactory(subtitleParserFactory)
    }

    @Deprecated("Media3's own, kept as it forwards")
    override fun experimentalSetTextTrackTranscodingEnabled(textTrackTranscodingEnabled: Boolean) = apply {
        defaults.setTextTrackTranscodingEnabled(textTrackTranscodingEnabled)
    }

    private fun withSubtitles(extractors: Array<Extractor>) =
        extractors.map { if (it is MatroskaExtractor) SubtitleMatroska(sink()) else it }.toTypedArray()
}

/**
 * Matroska, read by Media3, with its attached fonts and subtitles taken on the
 * way, before Media3 parses them and drops their timing. The player gets no
 * cues for them: the engine times them itself, so its delay applies to them.
 */
@OptIn(UnstableApi::class)
private class SubtitleMatroska(private val sink: SubtitleSink) : Extractor {
    private val matroska = Attachments(sink.ass)
    private var transcoder: SubtitleTranscodingExtractorOutput? = null

    override fun sniff(input: ExtractorInput) = matroska.sniff(input)

    override fun init(output: ExtractorOutput) {
        val transcoder = SubtitleTranscodingExtractorOutput(output, Silent).also { transcoder = it }
        matroska.init(Subtitles(transcoder, sink))
    }

    override fun read(input: ExtractorInput, seekPosition: PositionHolder) = matroska.read(input, seekPosition)

    override fun seek(position: Long, timeUs: Long) {
        transcoder?.resetSubtitleParsers()
        matroska.seek(position, timeUs)
    }

    override fun release() = matroska.release()

    override fun getUnderlyingImplementation(): Extractor = matroska
}

private val parsers = DefaultSubtitleParserFactory()

/** Media3's subtitle formats, which here give the player no cues. */
@OptIn(UnstableApi::class)
private object Silent : SubtitleParser.Factory {
    override fun supportsFormat(format: Format) = parsers.supportsFormat(format)

    override fun getCueReplacementBehavior(format: Format) = parsers.getCueReplacementBehavior(format)

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

/** Matroska's extractor, which also reads the fonts the file carries for its subtitles. */
@OptIn(UnstableApi::class)
private class Attachments(private val sink: AssSink) : MatroskaExtractor(FLAG_EMIT_RAW_SUBTITLE_DATA) {
    private var name: String? = null
    private var mime: String? = null

    override fun getElementType(id: Int) = when (id) {
        ATTACHMENTS, ATTACHED_FILE -> EbmlProcessor.ELEMENT_TYPE_MASTER
        FILE_NAME, FILE_MIME_TYPE -> EbmlProcessor.ELEMENT_TYPE_STRING
        FILE_DATA -> EbmlProcessor.ELEMENT_TYPE_BINARY
        else -> super.getElementType(id)
    }

    override fun isLevel1Element(id: Int) = id == ATTACHMENTS || super.isLevel1Element(id)

    override fun startMasterElement(id: Int, contentPosition: Long, contentSize: Long) {
        if (id != ATTACHED_FILE) return super.startMasterElement(id, contentPosition, contentSize)
        name = null
        mime = null
    }

    override fun stringElement(id: Int, value: String) {
        when (id) {
            FILE_NAME -> name = value
            FILE_MIME_TYPE -> mime = value
            else -> super.stringElement(id, value)
        }
    }

    override fun binaryElement(id: Int, contentSize: Int, input: ExtractorInput) {
        if (id != FILE_DATA) return super.binaryElement(id, contentSize, input)
        val name = name
        if (name == null || !isFont(name, mime)) return input.skipFully(contentSize)
        sink.font(name, ByteArray(contentSize).also { input.readFully(it, 0, contentSize) })
    }

    private companion object {
        const val ATTACHMENTS = 0x1941A469
        const val ATTACHED_FILE = 0x61A7
        const val FILE_NAME = 0x466E
        const val FILE_MIME_TYPE = 0x4660
        const val FILE_DATA = 0x465C

        fun isFont(name: String, mime: String?) =
            mime?.let { "font" in it || "truetype" in it || "opentype" in it } == true ||
                name.substringAfterLast('.').lowercase() in setOf("ttf", "otf", "ttc", "woff", "woff2")
    }
}

/** Takes each subtitle sample, with the time Matroska gives it, on its way to the player. */
@OptIn(UnstableApi::class)
private class Subtitles(private val output: ExtractorOutput, private val sink: SubtitleSink) : ExtractorOutput by output {
    override fun track(id: Int, type: Int): TrackOutput {
        val track = output.track(id, type)
        return if (type == C.TRACK_TYPE_TEXT) SubtitleOutput(track, sink) else track
    }
}

@OptIn(UnstableApi::class)
private class SubtitleOutput(private val track: TrackOutput, private val sink: SubtitleSink) : TrackOutput by track {
    private var id: String? = null
    private var parser: SubtitleParser? = null
    private var offsetUs = Format.OFFSET_SAMPLE_RELATIVE
    private var pending = ByteArray(4096)
    private var filled = 0

    override fun format(format: Format) {
        id = format.id
        parser = null
        offsetUs = format.subsampleOffsetUs
        when {
            id == null -> {}
            isAss(format) -> format.initializationData.getOrNull(1)?.let { sink.ass.header(id!!, it) }
            parsers.supportsFormat(format) -> {
                parser = parsers.create(format)
                val replace = parsers.getCueReplacementBehavior(format) == Format.CUE_REPLACEMENT_BEHAVIOR_REPLACE
                sink.text.track(id!!, replace)
            }
            else -> id = null
        }
        track.format(format)
    }

    override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean) =
        sampleData(input, length, allowEndOfInput, TrackOutput.SAMPLE_DATA_PART_MAIN)

    override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int): Int {
        if (id == null) return track.sampleData(input, length, allowEndOfInput, sampleDataPart)
        reserve(length)
        val read = input.read(pending, filled, length)
        if (read == C.RESULT_END_OF_INPUT) {
            if (allowEndOfInput) return C.RESULT_END_OF_INPUT
            throw EOFException()
        }
        track.sampleData(ParsableByteArray(pending.copyOfRange(filled, filled + read)), read, sampleDataPart)
        filled += read
        return read
    }

    override fun sampleData(data: ParsableByteArray, length: Int) =
        sampleData(data, length, TrackOutput.SAMPLE_DATA_PART_MAIN)

    override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) {
        if (id != null) {
            reserve(length)
            System.arraycopy(data.data, data.position, pending, filled, length)
            filled += length
        }
        track.sampleData(data, length, sampleDataPart)
    }

    override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) {
        val id = id
        if (id != null) {
            val end = filled - offset
            if (timeUs != C.TIME_UNSET) take(id, timeUs, end - size, end)
            System.arraycopy(pending, end, pending, 0, offset)
            filled = offset
        }
        track.sampleMetadata(timeUs, flags, size, offset, cryptoData)
    }

    private fun take(id: String, timeUs: Long, from: Int, to: Int) {
        val parser = parser
        if (parser == null) {
            dialogue(from, to)?.let { (durationMs, line) -> sink.ass.line(id, timeUs / 1000, durationMs, line) }
            return
        }
        parser.parse(pending, from, to - from, SubtitleParser.OutputOptions.allCues()) { cues ->
            // Timed as Media3's own transcoder times them.
            val startUs = when {
                cues.startTimeUs == C.TIME_UNSET -> timeUs
                offsetUs == Format.OFFSET_SAMPLE_RELATIVE -> timeUs + cues.startTimeUs
                else -> cues.startTimeUs + offsetUs
            }
            sink.text.cues(id, CuesWithTiming(cues.cues, startUs, cues.durationUs))
        }
    }

    private fun reserve(length: Int) {
        if (filled + length > pending.size) pending = pending.copyOf(maxOf(pending.size * 2, filled + length))
    }

    /** Matroska's ASS sample, `Dialogue: 0:00:00:00,<duration>,<line>`, as its duration and line. */
    private fun dialogue(from: Int, to: Int): Pair<Long, ByteArray>? {
        val first = indexOfComma(from, to)
        val second = indexOfComma(first + 1, to)
        if (first < 0 || second < 0) return null
        val parts = String(pending, first + 1, second - first - 1, Charsets.US_ASCII).split(':', '.')
        if (parts.size != 4) return null
        val (hours, minutes, seconds, centis) = parts.map { it.toLongOrNull() ?: return null }
        val durationMs = ((hours * 60 + minutes) * 60 + seconds) * 1000 + centis * 10
        return durationMs to pending.copyOfRange(second + 1, to)
    }

    private fun indexOfComma(from: Int, to: Int): Int {
        if (from < 0) return -1
        for (i in from until to) if (pending[i] == ','.code.toByte()) return i
        return -1
    }
}
