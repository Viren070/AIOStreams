package io.github.viren070.aiostreams.exoplayer

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.ParserException
import androidx.media3.common.util.Consumer
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.extractor.DefaultExtractorInput
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.SeekPoint
import androidx.media3.extractor.TrackOutput
import androidx.media3.extractor.mkv.EbmlProcessor
import androidx.media3.extractor.mkv.MatroskaExtractor
import androidx.media3.extractor.text.CuesWithTiming
import androidx.media3.extractor.text.DefaultSubtitleParserFactory
import androidx.media3.extractor.text.SubtitleParser
import androidx.media3.extractor.text.SubtitleTranscodingExtractorOutput
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.util.zip.DataFormatException
import java.util.zip.Inflater

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
internal class SubtitleExtractors(
    /** The subtitle track whose lines a seek reads back for, or [ANY_TRACK] before the engine picks one. */
    private val readBack: () -> String?,
    private val sink: () -> SubtitleSink,
) : ExtractorsFactory {
    private val defaults = DefaultExtractorsFactory()

    override fun createExtractors() = withSubtitles(defaults.createExtractors())

    override fun createExtractors(uri: Uri, responseHeaders: Map<String, List<String>>) =
        withSubtitles(defaults.createExtractors(uri, responseHeaders))

    override fun setSubtitleParserFactory(subtitleParserFactory: SubtitleParser.Factory) = apply {
        defaults.setSubtitleParserFactory(subtitleParserFactory)
    }

    @Deprecated("Media3's own, kept as it forwards")
    @Suppress("DEPRECATION")
    override fun experimentalSetTextTrackTranscodingEnabled(textTrackTranscodingEnabled: Boolean) = apply {
        defaults.setTextTrackTranscodingEnabled(textTrackTranscodingEnabled)
    }

    private fun withSubtitles(extractors: Array<Extractor>) =
        extractors.map { if (it is MatroskaExtractor) SubtitleMatroska(sink(), readBack) else it }.toTypedArray()

    companion object {
        const val ANY_TRACK = "*"
    }
}

/**
 * Matroska, read by Media3, with its attached fonts and subtitles taken on the
 * way, before Media3 parses them and drops their timing. The player gets no
 * cues for them: the engine times them itself, so its delay applies to them.
 */
@OptIn(UnstableApi::class)
private class SubtitleMatroska(private val sink: SubtitleSink, private val readBack: () -> String?) : Extractor {
    private val matroska = Matroska(sink.ass)
    private var transcoder: SubtitleTranscodingExtractorOutput? = null

    @Volatile
    private var seekMap: SeekMap? = null

    override fun sniff(input: ExtractorInput) = matroska.sniff(input)

    override fun init(output: ExtractorOutput) {
        val transcoder = SubtitleTranscodingExtractorOutput(output, Silent).also { transcoder = it }
        val seeking = object : ExtractorOutput by transcoder {
            override fun seekMap(seekMap: SeekMap) {
                this@SubtitleMatroska.seekMap = seekMap
                transcoder.seekMap(ReadBack(seekMap))
            }
        }
        matroska.init(Subtitles(FrameRates(seeking, matroska::frameDurationNs), sink))
    }

    override fun read(input: ExtractorInput, seekPosition: PositionHolder) = matroska.read(input, seekPosition)

    override fun seek(position: Long, timeUs: Long) {
        transcoder?.resetSubtitleParsers()
        matroska.seek(position, timeUs)
        // Media3 itself starts at the keyframe's cluster, so starting earlier is a read-back.
        val keyframe = seekMap?.getSeekPoints(timeUs)?.first?.position ?: return
        matroska.readBack(if (position < keyframe) keyframe else -1, readBack())
    }

    override fun release() = matroska.release()

    override fun getUnderlyingImplementation(): Extractor = matroska

    /** Media3's seek map, starting each seek early enough to read the subtitle lines already showing at its target. */
    private inner class ReadBack(private val map: SeekMap) : SeekMap by map {
        override fun getSeekPoints(timeUs: Long): SeekMap.SeekPoints {
            val points = map.getSeekPoints(timeUs)
            val from = matroska.index.earliest(readBack(), timeUs)
            if (from == null || from >= points.first.position) return points
            val first = SeekPoint(points.first.timeUs, from)
            return if (points.second == points.first) SeekMap.SeekPoints(first) else SeekMap.SeekPoints(first, points.second)
        }
    }
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

/**
 * Matroska's extractor, which also reads the fonts the file carries for its
 * subtitles and where its index puts their lines, and inflates the
 * zlib-compressed tracks Media3 rejects.
 */
@OptIn(UnstableApi::class)
private class Matroska(private val sink: AssSink) :
    MatroskaExtractor(SubtitleParser.Factory.UNSUPPORTED, FLAG_EMIT_RAW_SUBTITLE_DATA) {
    val index = SubtitleIndex()
    private var name: String? = null
    private var mime: String? = null
    private var segment = 0L
    private var timecodeScale = 1_000_000L
    private var cueTime = -1L
    private var cueTrack = -1L
    private var cuePosition = -1L
    private var cueDuration = -1L

    /** Before this cluster, only [readBackTrack]'s blocks are read. */
    private var readBackUntil = -1L
    private var readBackTrack: String? = null
    private var readingBack = false
    private val varint = ByteArray(8)

    private val zlibTracks = HashSet<Long>()
    private var entryNumber = -1L
    private var entryZlib = false
    private var algorithm = ZLIB

    /** Each track's DefaultDuration, which Media3 makes no frame rate of. */
    private val frameDurations = HashMap<Long, Long>()
    private var entryDuration = -1L

    fun frameDurationNs(track: Int): Long? = frameDurations[track.toLong()]

    // A read error can stop a block part way, and the next read carries on in it.
    private var inMedia3Block = false
    private var takeSize = -1
    private var taken = 0

    /** The block being read here to inflate, or null while skipping one. */
    private var takeData: ByteArray? = null

    fun readBack(until: Long, track: String?) {
        readBackUntil = until
        readBackTrack = track
        readingBack = false
    }

    override fun seek(position: Long, timeUs: Long) {
        inMedia3Block = false
        takeSize = -1
        takeData = null
        super.seek(position, timeUs)
    }

    override fun getElementType(id: Int) = when (id) {
        ATTACHMENTS, ATTACHED_FILE -> EbmlProcessor.ELEMENT_TYPE_MASTER
        FILE_NAME, FILE_MIME_TYPE -> EbmlProcessor.ELEMENT_TYPE_STRING
        FILE_DATA -> EbmlProcessor.ELEMENT_TYPE_BINARY
        CUE_DURATION -> EbmlProcessor.ELEMENT_TYPE_UNSIGNED_INT
        else -> super.getElementType(id)
    }

    override fun isLevel1Element(id: Int) = id == ATTACHMENTS || super.isLevel1Element(id)

    override fun startMasterElement(id: Int, contentPosition: Long, contentSize: Long) {
        when (id) {
            ATTACHED_FILE -> {
                name = null
                mime = null
                return
            }
            SEGMENT -> segment = contentPosition
            TRACK_ENTRY -> {
                entryNumber = -1
                entryZlib = false
                entryDuration = -1
            }
            // Matroska's default when the file leaves it out, which Media3 then takes as no compression.
            CONTENT_COMPRESSION -> algorithm = ZLIB
            CLUSTER -> readingBack = contentPosition < readBackUntil
            CUE_POINT -> cueTime = -1
            CUE_TRACK_POSITIONS -> {
                cueTrack = -1
                cuePosition = -1
                cueDuration = -1
            }
        }
        super.startMasterElement(id, contentPosition, contentSize)
    }

    override fun endMasterElement(id: Int) {
        when (id) {
            CUE_TRACK_POSITIONS -> if (cueTime >= 0 && cueTrack >= 0 && cuePosition >= 0 && cueDuration > 0) {
                index.add(cueTrack, scale(cueTime), scale(cueDuration), segment + cuePosition)
            }
            // Before Media3 sends the seek map that reads it.
            CUES -> index.finish()
            CONTENT_COMPRESSION -> if (algorithm == ZLIB) entryZlib = true
            TRACK_ENTRY -> if (entryNumber >= 0) {
                if (entryZlib) zlibTracks += entryNumber
                if (entryDuration > 0) frameDurations[entryNumber] = entryDuration
            }
        }
        super.endMasterElement(id)
    }

    override fun integerElement(id: Int, value: Long) {
        when (id) {
            TIMECODE_SCALE -> timecodeScale = value
            TRACK_NUMBER -> entryNumber = value
            DEFAULT_DURATION -> entryDuration = value
            CONTENT_COMPRESSION_ALGORITHM -> {
                algorithm = value
                // Media3 rejects it.
                if (value == ZLIB) return
            }
            CUE_TIME -> cueTime = value
            CUE_TRACK -> cueTrack = value
            CUE_CLUSTER_POSITION -> cuePosition = value
            CUE_DURATION -> return run { cueDuration = value }
        }
        super.integerElement(id, value)
    }

    override fun stringElement(id: Int, value: String) {
        when (id) {
            FILE_NAME -> name = value
            FILE_MIME_TYPE -> mime = value
            else -> super.stringElement(id, value)
        }
    }

    override fun binaryElement(id: Int, contentSize: Int, input: ExtractorInput) {
        if (id == FILE_DATA) return font(contentSize, input)
        // zlib takes no settings; Media3 would take them as stripped header bytes.
        if (id == CONTENT_COMPRESSION_SETTINGS && entryZlib) return input.skipFully(contentSize)
        if (id != SIMPLE_BLOCK && id != BLOCK) return super.binaryElement(id, contentSize, input)
        if (!inMedia3Block && takeSize < 0 && (readingBack || zlibTracks.isNotEmpty())) {
            val track = trackOf(input)
            when {
                track == null -> {}
                readingBack && !readsBack(track) -> startTaking(contentSize, keep = false)
                track in zlibTracks -> startTaking(contentSize, keep = true)
            }
        }
        if (takeSize < 0) {
            inMedia3Block = true
            super.binaryElement(id, contentSize, input)
            inMedia3Block = false
            return
        }
        val block = take(input) ?: return
        super.binaryElement(id, block.size, DefaultExtractorInput(Bytes(block), 0, block.size.toLong()))
    }

    private fun startTaking(size: Int, keep: Boolean) {
        takeSize = size
        taken = 0
        takeData = if (keep) ByteArray(size) else null
    }

    /** The rest of the block being taken, inflated, or null once a skipped one is past. */
    private fun take(input: ExtractorInput): ByteArray? {
        val data = takeData
        while (taken < takeSize) {
            val read = if (data == null) input.skip(takeSize - taken) else input.read(data, taken, takeSize - taken)
            if (read == C.RESULT_END_OF_INPUT) throw EOFException()
            taken += read
        }
        takeSize = -1
        takeData = null
        return data?.let(::inflated)
    }

    /** The block with its frame inflated: its track number, timecode and flags, then the frame. */
    private fun inflated(block: ByteArray): ByteArray {
        val header = varintLength(block[0]) + 3
        if (header !in 4..11 || block.size < header) {
            throw ParserException.createForMalformedContainer("Bad block header", null)
        }
        if (block[header - 1].toInt() and LACING != 0) {
            throw ParserException.createForMalformedContainer("Laced zlib-compressed blocks not supported", null)
        }
        val inflater = Inflater()
        try {
            inflater.setInput(block, header, block.size - header)
            val out = ByteArrayOutputStream(block.size * 4)
            out.write(block, 0, header)
            val chunk = ByteArray(8192)
            while (!inflater.finished()) {
                val read = inflater.inflate(chunk)
                if (read == 0 && (inflater.needsInput() || inflater.needsDictionary())) {
                    throw ParserException.createForMalformedContainer("Truncated zlib frame", null)
                }
                out.write(chunk, 0, read)
            }
            return out.toByteArray()
        } catch (e: DataFormatException) {
            throw ParserException.createForMalformedContainer("Bad zlib frame", e)
        } finally {
            inflater.end()
        }
    }

    private fun font(size: Int, input: ExtractorInput) {
        val name = name
        if (name == null || !isFont(name, mime)) return input.skipFully(size)
        sink.font(name, ByteArray(size).also { input.readFully(it, 0, size) })
    }

    /** The track number the block about to be read starts with. */
    private fun trackOf(input: ExtractorInput): Long? {
        input.peekFully(varint, 0, 1)
        val length = varintLength(varint[0])
        if (length !in 1..8) return null.also { input.resetPeekPosition() }
        if (length > 1) input.peekFully(varint, 1, length - 1)
        input.resetPeekPosition()
        var track = varint[0].toLong() and (0xFFL shr length)
        for (i in 1 until length) track = (track shl 8) or (varint[i].toLong() and 0xFF)
        return track
    }

    /** Whether a block of `track`'s is one of [readBackTrack]'s. */
    private fun readsBack(track: Long) = when (val showing = readBackTrack) {
        SubtitleExtractors.ANY_TRACK -> index.has(track)
        else -> track.toString() == showing
    }

    private fun varintLength(first: Byte) = Integer.numberOfLeadingZeros(first.toInt() and 0xFF) - 23

    private fun scale(timecode: Long) = Util.scaleLargeTimestamp(timecode, timecodeScale, 1000)

    private companion object {
        const val SEGMENT = 0x18538067
        const val TIMECODE_SCALE = 0x2AD7B1
        const val TRACK_ENTRY = 0xAE
        const val TRACK_NUMBER = 0xD7
        const val DEFAULT_DURATION = 0x23E383
        const val CONTENT_COMPRESSION = 0x5034
        const val CONTENT_COMPRESSION_ALGORITHM = 0x4254
        const val CONTENT_COMPRESSION_SETTINGS = 0x4255
        const val ZLIB = 0L
        const val LACING = 0x06
        const val CLUSTER = 0x1F43B675
        const val SIMPLE_BLOCK = 0xA3
        const val BLOCK = 0xA1
        const val CUES = 0x1C53BB6B
        const val CUE_POINT = 0xBB
        const val CUE_TIME = 0xB3
        const val CUE_TRACK_POSITIONS = 0xB7
        const val CUE_TRACK = 0xF7
        const val CUE_CLUSTER_POSITION = 0xF1
        const val CUE_DURATION = 0xB2
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

@OptIn(UnstableApi::class)
private class Bytes(private val data: ByteArray) : DataReader {
    private var at = 0

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (at == data.size) return C.RESULT_END_OF_INPUT
        val read = minOf(length, data.size - at)
        System.arraycopy(data, at, buffer, offset, read)
        at += read
        return read
    }
}

/** Where the subtitle lines with a duration in Matroska's index sit in the file. */
private class SubtitleIndex {
    private class Line(val startUs: Long, val endUs: Long, val position: Long)

    private val reading = HashMap<Long, MutableList<Line>>()

    @Volatile
    private var tracks: Map<Long, List<Line>>? = null

    fun add(track: Long, startUs: Long, durationUs: Long, position: Long) {
        if (tracks == null) reading.getOrPut(track) { mutableListOf() } += Line(startUs, startUs + durationUs, position)
    }

    fun finish() {
        if (tracks == null) tracks = reading.mapValues { (_, lines) -> lines.sortedBy { it.startUs } }
        reading.clear()
    }

    fun has(track: Long) = tracks?.containsKey(track) == true

    /** Where the first of `track`'s lines showing at `timeUs` sits, of those begun up to [READ_BACK_US] before. */
    fun earliest(track: String?, timeUs: Long): Long? {
        val tracks = tracks ?: return null
        val lines = when (track) {
            null -> return null
            SubtitleExtractors.ANY_TRACK -> tracks.values
            else -> listOfNotNull(track.toLongOrNull()?.let(tracks::get))
        }
        var earliest: Long? = null
        for (list in lines) {
            var i = firstFrom(list, timeUs - READ_BACK_US)
            while (i < list.size && list[i].startUs <= timeUs) {
                val line = list[i++]
                if (line.endUs > timeUs && line.position < (earliest ?: Long.MAX_VALUE)) earliest = line.position
            }
        }
        return earliest
    }

    private fun firstFrom(lines: List<Line>, timeUs: Long): Int {
        var low = 0
        var high = lines.size
        while (low < high) {
            val mid = (low + high) ushr 1
            if (lines[mid].startUs < timeUs) low = mid + 1 else high = mid
        }
        return low
    }

    private companion object {
        // mpv's demuxer-mkv-subtitle-preroll-secs-index.
        const val READ_BACK_US = 10_000_000L
    }
}

@OptIn(UnstableApi::class)
private class FrameRates(private val output: ExtractorOutput, private val durationNs: (Int) -> Long?) :
    ExtractorOutput by output {
    override fun track(id: Int, type: Int): TrackOutput {
        val track = output.track(id, type)
        val ns = durationNs(id)?.takeIf { type == C.TRACK_TYPE_VIDEO } ?: return track
        return object : TrackOutput by track {
            override fun format(format: Format) = track.format(
                if (format.frameRate > 0) format else format.buildUpon().setFrameRate(1e9f / ns).build(),
            )
        }
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
