package io.github.viren070.aiostreams.exoplayer

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.container.NalUnitUtil
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.TrackOutput

/**
 * Marks the Matroska H.264 and H.265 frames no other frame decodes from, which
 * Media3 skips rather than decodes on its way to a seek's exact frame.
 */
@OptIn(UnstableApi::class)
internal class SampleDependencies(private val output: ExtractorOutput) : ExtractorOutput by output {
    override fun track(id: Int, type: Int): TrackOutput {
        val track = output.track(id, type)
        return if (type == C.TRACK_TYPE_VIDEO) Track(track) else track
    }

    /** The extractor writes a start code before each NAL unit, whose header follows. */
    private class Track(private val track: TrackOutput) : TrackOutput by track {
        private var format: Format? = null
        private var headerBytes = 0
        private val header = ByteArray(2)
        private var atUnit = false
        private var units = 0
        private var dependedOn = false

        override fun format(format: Format) {
            this.format = withSubLayers(format)
            headerBytes = NalUnitUtil.numberOfBytesInNalUnitHeader(format)
            track.format(format)
        }

        override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean) =
            sampleData(input, length, allowEndOfInput, TrackOutput.SAMPLE_DATA_PART_MAIN)

        override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int): Int {
            if (atUnit) {
                atUnit = false
                val read = input is ExtractorInput && length >= headerBytes && input.peekFully(header, 0, headerBytes, true)
                if (read) (input as ExtractorInput).resetPeekPosition()
                unit(read && !NalUnitUtil.isDependedOn(header, 0, headerBytes, format!!))
            }
            return track.sampleData(input, length, allowEndOfInput, sampleDataPart)
        }

        override fun sampleData(data: ParsableByteArray, length: Int) =
            sampleData(data, length, TrackOutput.SAMPLE_DATA_PART_MAIN)

        override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) {
            when {
                atUnit -> {
                    atUnit = false
                    unit(length >= headerBytes && !NalUnitUtil.isDependedOn(data.data, data.position, headerBytes, format!!))
                }
                headerBytes > 0 && length == START_CODE.size && data.startsWithStartCode() -> atUnit = true
            }
            track.sampleData(data, length, sampleDataPart)
        }

        override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) {
            val skippable = units > 0 && !dependedOn && offset == 0 && flags and C.BUFFER_FLAG_KEY_FRAME == 0
            track.sampleMetadata(timeUs, if (skippable) flags or C.BUFFER_FLAG_NOT_DEPENDED_ON else flags, size, offset, cryptoData)
            units = 0
            dependedOn = false
            atUnit = false
        }

        private fun unit(skippable: Boolean) {
            units++
            if (!skippable) dependedOn = true
        }

        private fun ParsableByteArray.startsWithStartCode() =
            bytesLeft() >= START_CODE.size && START_CODE.indices.all { data[position + it] == START_CODE[it] }
    }

    private companion object {
        val START_CODE = NalUnitUtil.NAL_START_CODE
        const val H265_SPS = 33

        /** H.265's unreferenced frames are those of its top temporal layer, so they need the layer count Matroska's extractor leaves out. */
        fun withSubLayers(format: Format): Format {
            if (format.sampleMimeType != MimeTypes.VIDEO_H265 || format.maxSubLayers != Format.NO_VALUE) return format
            val data = format.initializationData.firstOrNull() ?: return format
            val starts = data.indices.filter { i ->
                i + START_CODE.size < data.size && START_CODE.indices.all { data[i + it] == START_CODE[it] }
            }
            starts.forEachIndexed { n, start ->
                val unit = start + START_CODE.size
                if ((data[unit].toInt() shr 1) and 0x3F != H265_SPS) return@forEachIndexed
                val end = starts.getOrNull(n + 1) ?: data.size
                val sps = runCatching { NalUnitUtil.parseH265SpsNalUnit(data, unit, end, null) }.getOrNull() ?: return format
                return format.buildUpon().setMaxSubLayers(sps.maxSubLayersMinus1 + 1).build()
            }
            return format
        }
    }
}
