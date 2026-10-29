package io.github.viren070.aiostreams.exoplayer.extractor

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.TrackOutput
import java.io.EOFException

@OptIn(UnstableApi::class)
internal fun ExtractorOutput.filterTracks(
    trackType: Int,
    filter: (id: Int, track: TrackOutput) -> TrackOutput,
): ExtractorOutput {
    val output = this
    return object : ExtractorOutput by output {
        override fun track(id: Int, type: Int): TrackOutput {
            val track = output.track(id, type)
            return if (type == trackType) filter(id, track) else track
        }
    }
}

@OptIn(UnstableApi::class)
internal abstract class FilteringTrackOutput(protected val track: TrackOutput) : TrackOutput by track {
    // Delegation would send these straight to the track, past the subclass's overrides of the full ones.
    final override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean) =
        sampleData(input, length, allowEndOfInput, TrackOutput.SAMPLE_DATA_PART_MAIN)

    final override fun sampleData(data: ParsableByteArray, length: Int) =
        sampleData(data, length, TrackOutput.SAMPLE_DATA_PART_MAIN)
}

/** A sample's bytes as the extractor writes them, until its metadata says where it ends. */
@OptIn(UnstableApi::class)
internal class SampleBytes(private val minimum: Int) {
    var data = ByteArray(0)
        private set
    var size = 0
        private set

    fun read(input: DataReader, length: Int, allowEndOfInput: Boolean): Int {
        reserve(length)
        val read = input.read(data, size, length)
        if (read == C.RESULT_END_OF_INPUT) {
            if (allowEndOfInput) return C.RESULT_END_OF_INPUT
            throw EOFException()
        }
        size += read
        return read
    }

    fun add(source: ByteArray, from: Int, length: Int) {
        reserve(length)
        System.arraycopy(source, from, data, size, length)
        size += length
    }

    /** The extractor writes the next sample's first bytes before this one's metadata. */
    fun keepLast(count: Int) {
        System.arraycopy(data, size - count, data, 0, count)
        size = count
    }

    private fun reserve(length: Int) {
        if (size + length > data.size) data = data.copyOf(maxOf(size + length, data.size * 2, minimum))
    }
}
