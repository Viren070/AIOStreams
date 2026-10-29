package io.github.viren070.aiostreams.exoplayer.subtitles

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.TrackOutput
import io.github.viren070.aiostreams.exoplayer.extractor.FilteringTrackOutput
import io.github.viren070.aiostreams.exoplayer.extractor.SampleBytes

/** Takes each subtitle sample, with the time Matroska gives it, on its way to the player. */
@OptIn(UnstableApi::class)
internal class SubtitleCapture(track: TrackOutput, private val sink: SubtitleSink) : FilteringTrackOutput(track) {
    /** The track, while its samples are taken. */
    private var id: String? = null
    private var text = false
    private val bytes = SampleBytes(minimum = 4096)

    override fun format(format: Format) {
        val id = format.id
        this.id = id
        text = false
        when {
            id == null -> {}
            isAss(format) -> format.initializationData.getOrNull(1)?.let { sink.ass.header(id, it) }
            subtitleParsers.supportsFormat(format) -> {
                text = true
                sink.text.track(id, SampleParser(format))
            }
            else -> this.id = null
        }
        track.format(format)
    }

    override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int): Int {
        if (id == null) return track.sampleData(input, length, allowEndOfInput, sampleDataPart)
        val read = bytes.read(input, length, allowEndOfInput)
        if (read == C.RESULT_END_OF_INPUT) return read
        track.sampleData(ParsableByteArray(bytes.data.copyOfRange(bytes.size - read, bytes.size)), read, sampleDataPart)
        return read
    }

    override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) {
        if (id != null) bytes.add(data.data, data.position, length)
        track.sampleData(data, length, sampleDataPart)
    }

    override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) {
        val id = id
        if (id != null) {
            val end = bytes.size - offset
            if (timeUs != C.TIME_UNSET) take(id, timeUs, end - size, end)
            bytes.keepLast(offset)
        }
        track.sampleMetadata(timeUs, flags, size, offset, cryptoData)
    }

    private fun take(id: String, timeUs: Long, from: Int, to: Int) {
        if (text) return sink.text.sample(id, timeUs, bytes.data.copyOfRange(from, to))
        dialogue(bytes.data, from, to)?.let { (durationMs, line) -> sink.ass.line(id, timeUs / 1000, durationMs, line) }
    }

    private companion object {
        /** Matroska's ASS sample, `Dialogue: 0:00:00:00,<duration>,<line>`, as its duration and line. */
        fun dialogue(data: ByteArray, from: Int, to: Int): Pair<Long, ByteArray>? {
            val first = indexOfComma(data, from, to)
            val second = indexOfComma(data, first + 1, to)
            if (first < 0 || second < 0) return null
            val parts = String(data, first + 1, second - first - 1, Charsets.US_ASCII).split(':', '.')
            if (parts.size != 4) return null
            val (hours, minutes, seconds, centis) = parts.map { it.toLongOrNull() ?: return null }
            val durationMs = ((hours * 60 + minutes) * 60 + seconds) * 1000 + centis * 10
            return durationMs to data.copyOfRange(second + 1, to)
        }

        fun indexOfComma(data: ByteArray, from: Int, to: Int): Int {
            if (from < 0) return -1
            for (i in from until to) if (data[i] == ','.code.toByte()) return i
            return -1
        }
    }
}
