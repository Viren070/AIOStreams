package io.github.viren070.aiostreams.exoplayer.video

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.TrackOutput
import io.github.viren070.aiostreams.exoplayer.extractor.FilteringTrackOutput
import io.github.viren070.aiostreams.exoplayer.extractor.SampleBytes

/** Passes samples through untouched until a format calls for stripping or converting. */
@OptIn(UnstableApi::class)
internal class DolbyVisionTrack(track: TrackOutput, private val router: DolbyVisionRouter) :
    FilteringTrackOutput(track) {
    private var rewrite: DolbyVisionRoute? = null

    /** A format to convert, held back until the first sample shows whether its RPUs do. */
    private var held: Format? = null
    private var converts: Boolean? = null
    private val bytes = SampleBytes(minimum = 1 shl 20)
    private val sample = ParsableByteArray()

    override fun format(format: Format) {
        val profile = dolbyVisionProfile(format)
        if (format.sampleMimeType != MimeTypes.VIDEO_DOLBY_VISION || profile == null) {
            rewrite = null
            return track.format(format)
        }
        var route = router.route(profile)
        if (route == DolbyVisionRoute.CONVERTED) {
            when (converts) {
                null -> {
                    rewrite = route
                    held = format
                    return
                }
                false -> route = DolbyVisionRoute.STRIPPED
                true -> {}
            }
        }
        rewrite = route.takeIf { it == DolbyVisionRoute.STRIPPED || it == DolbyVisionRoute.CONVERTED }
        emit(format, profile, route)
    }

    private fun emit(format: Format, profile: Int, route: DolbyVisionRoute) {
        router.routed(format.codecs.orEmpty(), route)
        track.format(
            when (route) {
                DolbyVisionRoute.DOLBY_VISION -> format
                DolbyVisionRoute.CONVERTED -> format.buildUpon()
                    .setCodecs(format.codecs?.split('.')?.toMutableList()?.apply { this[1] = "08" }?.joinToString("."))
                    .build()
                // Without a codec string the decoder is chosen by type alone, as for any file that lacks one.
                else -> format.buildUpon().setSampleMimeType(baseLayerOf(profile)).setCodecs(null).build()
            },
        )
    }

    override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int): Int {
        if (rewrite == null) return track.sampleData(input, length, allowEndOfInput, sampleDataPart)
        return bytes.read(input, length, allowEndOfInput)
    }

    override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) {
        if (rewrite == null) return track.sampleData(data, length, sampleDataPart)
        bytes.add(data.data, data.position, length)
        data.skipBytes(length)
    }

    override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) {
        if (rewrite == null) return track.sampleMetadata(timeUs, flags, size, offset, cryptoData)
        val pending = bytes.data
        var from = bytes.size - offset - size
        var length = size
        // A Matroska block's additions follow the sample behind its length; for these profiles that's the enhancement layer.
        if (flags and C.BUFFER_FLAG_HAS_SUPPLEMENTAL_DATA != 0 && size >= 4) {
            length = (pending[from].toInt() and 0xFF shl 24) or (pending[from + 1].toInt() and 0xFF shl 16) or
                (pending[from + 2].toInt() and 0xFF shl 8) or (pending[from + 3].toInt() and 0xFF)
            from += 4
            if (length < 0 || length > size - 4) length = size - 4
        }
        var converted = 0
        if (cryptoData == null) {
            val result = DolbyVisionNative.nativeRewrite(pending, from, length, rewrite == DolbyVisionRoute.CONVERTED)
            converted = (result ushr 32).toInt()
            length = result.toInt()
        }
        held?.let {
            // Without a converted RPU, the sample is already what stripping makes.
            val route = if (converted > 0) DolbyVisionRoute.CONVERTED else DolbyVisionRoute.STRIPPED
            converts = converted > 0
            rewrite = route
            held = null
            emit(it, 7, route)
        }
        sample.reset(pending, from + length)
        sample.position = from
        track.sampleData(sample, length)
        track.sampleMetadata(timeUs, flags and C.BUFFER_FLAG_HAS_SUPPLEMENTAL_DATA.inv(), length, 0, cryptoData)
        bytes.keepLast(offset)
    }
}
