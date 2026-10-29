package io.github.viren070.aiostreams.exoplayer.extractor

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.ParserException
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.extractor.DefaultExtractorInput
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.mkv.EbmlProcessor
import androidx.media3.extractor.mkv.MatroskaExtractor
import androidx.media3.extractor.text.SubtitleParser
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.ATTACHMENTS
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.BLOCK
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.CLUSTER
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.CONTENT_COMPRESSION
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.CONTENT_COMPRESSION_ALGORITHM
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.CONTENT_COMPRESSION_SETTINGS
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.CUES
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.CUE_CLUSTER_POSITION
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.CUE_DURATION
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.CUE_POINT
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.CUE_TIME
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.CUE_TRACK
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.CUE_TRACK_POSITIONS
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.DEFAULT_DURATION
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.SEEK
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.SEEK_ID
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.SEEK_POSITION
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.SEGMENT
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.SIMPLE_BLOCK
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.TIMECODE_SCALE
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.TRACK_ENTRY
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaIds.TRACK_NUMBER
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.util.zip.DataFormatException
import java.util.zip.Inflater

/**
 * Matroska's extractor, which also reads where its index puts the subtitle
 * lines, skips the attachments for [attachments] to read, and inflates the
 * zlib-compressed tracks Media3 rejects.
 */
@OptIn(UnstableApi::class)
internal class Matroska(private val attachments: (position: Long, length: Long?) -> Unit) :
    MatroskaExtractor(SubtitleParser.Factory.UNSUPPORTED, FLAG_EMIT_RAW_SUBTITLE_DATA) {
    val index = SubtitleIndex()
    private var segment = 0L
    private var timecodeScale = 1_000_000L
    private var attachmentsFound = false

    /** The reader skips the Attachments element's content next. */
    private var attachmentsNext = false

    private var seek = SeekEntry()
    private var entry = TrackEntry()
    private var algorithm = ZLIB
    private var cueTime = -1L
    private var cue = CueEntry()

    private val zlibTracks = HashSet<Long>()

    /** Each track's DefaultDuration, which Media3 makes no frame rate of. */
    private val frameDurations = HashMap<Long, Long>()

    /** Before this cluster, only [readBackTrack]'s blocks are read. */
    private var readBackUntil = -1L
    private var readBackTrack: String? = null
    private var readingBack = false

    // A read error can stop a block part way, and the next read carries on in it.
    private var inMedia3Block = false
    private var taking: TakenBlock? = null
    private val varint = ByteArray(8)

    fun frameDurationNs(track: Int): Long? = frameDurations[track.toLong()]

    fun readBack(until: Long, track: String?) {
        readBackUntil = until
        readBackTrack = track
        readingBack = false
    }

    /** Reports the attachments' content as the reader skips it. */
    fun skipping(position: Long, length: Long) {
        if (!attachmentsNext) return
        attachmentsNext = false
        foundAttachments(position, length)
    }

    override fun seek(position: Long, timeUs: Long) {
        inMedia3Block = false
        taking = null
        super.seek(position, timeUs)
    }

    override fun getElementType(id: Int) = when (id) {
        ATTACHMENTS -> EbmlProcessor.ELEMENT_TYPE_UNKNOWN.also { attachmentsNext = true }
        CUE_DURATION -> EbmlProcessor.ELEMENT_TYPE_UNSIGNED_INT
        else -> super.getElementType(id)
    }

    override fun isLevel1Element(id: Int) = id == ATTACHMENTS || super.isLevel1Element(id)

    override fun startMasterElement(id: Int, contentPosition: Long, contentSize: Long) {
        when (id) {
            SEGMENT -> segment = contentPosition
            SEEK -> seek = SeekEntry()
            TRACK_ENTRY -> entry = TrackEntry()
            // Matroska's default when the file leaves it out, which Media3 then takes as no compression.
            CONTENT_COMPRESSION -> algorithm = ZLIB
            CLUSTER -> readingBack = contentPosition < readBackUntil
            CUE_POINT -> cueTime = -1
            CUE_TRACK_POSITIONS -> cue = CueEntry()
        }
        super.startMasterElement(id, contentPosition, contentSize)
    }

    override fun endMasterElement(id: Int) {
        when (id) {
            CUE_TRACK_POSITIONS -> if (cueTime >= 0 && cue.complete) {
                index.add(cue.track, scale(cueTime), scale(cue.duration), segment + cue.cluster)
            }
            // Before Media3 sends the seek map that reads it.
            CUES -> index.finish()
            SEEK -> if (seek.id == ATTACHMENTS.toLong() && seek.position >= 0) foundAttachments(segment + seek.position, null)
            CONTENT_COMPRESSION -> if (algorithm == ZLIB) entry.zlib = true
            TRACK_ENTRY -> if (entry.number >= 0) {
                if (entry.zlib) zlibTracks += entry.number
                if (entry.frameDurationNs > 0) frameDurations[entry.number] = entry.frameDurationNs
            }
        }
        super.endMasterElement(id)
    }

    override fun integerElement(id: Int, value: Long) {
        when (id) {
            TIMECODE_SCALE -> timecodeScale = value
            TRACK_NUMBER -> entry.number = value
            DEFAULT_DURATION -> entry.frameDurationNs = value
            CONTENT_COMPRESSION_ALGORITHM -> {
                algorithm = value
                // Media3 rejects it.
                if (value == ZLIB) return
            }
            CUE_TIME -> cueTime = value
            CUE_TRACK -> cue.track = value
            CUE_CLUSTER_POSITION -> cue.cluster = value
            CUE_DURATION -> return run { cue.duration = value }
            SEEK_POSITION -> seek.position = value
        }
        super.integerElement(id, value)
    }

    override fun binaryElement(id: Int, contentSize: Int, input: ExtractorInput) {
        if (id == SEEK_ID && contentSize in 1..4) {
            input.peekFully(varint, 0, contentSize)
            input.resetPeekPosition()
            seek.id = (0 until contentSize).fold(0L) { value, i -> (value shl 8) or (varint[i].toLong() and 0xFF) }
        }
        when {
            // zlib takes no settings; Media3 would take them as stripped header bytes.
            id == CONTENT_COMPRESSION_SETTINGS && entry.zlib -> input.skipFully(contentSize)
            id == SIMPLE_BLOCK || id == BLOCK -> block(id, contentSize, input)
            else -> super.binaryElement(id, contentSize, input)
        }
    }

    private fun block(id: Int, size: Int, input: ExtractorInput) {
        if (!inMedia3Block && taking == null && (readingBack || zlibTracks.isNotEmpty())) {
            val track = trackOf(input)
            taking = when {
                track == null -> null
                readingBack && !readsBack(track) -> TakenBlock(size, keep = false)
                track in zlibTracks -> TakenBlock(size, keep = true)
                else -> null
            }
        }
        val block = taking
        if (block == null) {
            inMedia3Block = true
            super.binaryElement(id, size, input)
            inMedia3Block = false
            return
        }
        val inflated = take(block, input) ?: return
        super.binaryElement(id, inflated.size, DefaultExtractorInput(Bytes(inflated), 0, inflated.size.toLong()))
    }

    /** The rest of the block being taken, inflated, or null once a skipped one is past. */
    private fun take(block: TakenBlock, input: ExtractorInput): ByteArray? {
        val data = block.data
        while (block.taken < block.size) {
            val left = block.size - block.taken
            val read = if (data == null) input.skip(left) else input.read(data, block.taken, left)
            if (read == C.RESULT_END_OF_INPUT) throw EOFException()
            block.taken += read
        }
        taking = null
        return data?.let(::inflated)
    }

    /** The block with its frame inflated: its track number, timecode and flags, then the frame. */
    private fun inflated(block: ByteArray): ByteArray {
        val header = vintLength(block[0]) + 3
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

    /** The track number the block about to be read starts with. */
    private fun trackOf(input: ExtractorInput): Long? {
        input.peekFully(varint, 0, 1)
        val length = vintLength(varint[0])
        if (length !in 1..8) return null.also { input.resetPeekPosition() }
        if (length > 1) input.peekFully(varint, 1, length - 1)
        input.resetPeekPosition()
        var track = varint[0].toLong() and (0xFFL shr length)
        for (i in 1 until length) track = (track shl 8) or (varint[i].toLong() and 0xFF)
        return track
    }

    private fun readsBack(track: Long) = when (val showing = readBackTrack) {
        MatroskaHost.ANY_TRACK -> index.has(track)
        else -> track.toString() == showing
    }

    private fun foundAttachments(position: Long, length: Long?) {
        if (attachmentsFound) return
        attachmentsFound = true
        attachments(position, length)
    }

    private fun scale(timecode: Long) = Util.scaleLargeTimestamp(timecode, timecodeScale, 1000)

    private class SeekEntry {
        var id = 0L
        var position = -1L
    }

    private class TrackEntry {
        var number = -1L
        var zlib = false
        var frameDurationNs = -1L
    }

    private class CueEntry {
        var track = -1L
        var cluster = -1L
        var duration = -1L
        val complete get() = track >= 0 && cluster >= 0 && duration > 0
    }

    private class TakenBlock(val size: Int, keep: Boolean) {
        /** Null for a block skipped rather than kept to inflate. */
        val data = if (keep) ByteArray(size) else null
        var taken = 0
    }

    private companion object {
        const val ZLIB = 0L
        const val LACING = 0x06
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
