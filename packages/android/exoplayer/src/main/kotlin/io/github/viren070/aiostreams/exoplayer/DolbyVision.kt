package io.github.viren070.aiostreams.exoplayer

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.TrackOutput
import java.io.EOFException

/** How a Dolby Vision track plays on this device. */
internal enum class DolbyVisionRoute(val label: String) {
    DOLBY_VISION("Dolby Vision decoder"),
    CONVERTED("Dolby Vision decoder, as profile 8.1"),
    BASE_LAYER("base layer"),
    STRIPPED("base layer, enhancement layer dropped"),
}

/**
 * The route for a profile: Dolby Vision where the display shows it, profile 7
 * as 8.1 where only a profile 8 decoder takes it, else the base layer the
 * profile carries for other displays. Profile 5 has none, so it's the Dolby
 * Vision decoder or nothing.
 */
internal fun dolbyVisionRoute(profile: Int, caps: MediaCaps): DolbyVisionRoute = when {
    caps.showsDolbyVision(profile) || baseOf(profile) == null -> DolbyVisionRoute.DOLBY_VISION
    profile == 7 && caps.showsDolbyVision(8) && DolbyVisionNative.converts -> DolbyVisionRoute.CONVERTED
    profile in DUAL_LAYER -> DolbyVisionRoute.STRIPPED
    else -> DolbyVisionRoute.BASE_LAYER
}

/** The codec of a profile's base layer, which other decoders play as HDR10, HLG or SDR. */
private fun baseOf(profile: Int) = when (profile) {
    4, 7, 8 -> MimeTypes.VIDEO_H265
    9 -> MimeTypes.VIDEO_H264
    10 -> MimeTypes.VIDEO_AV1
    else -> null
}

/** Profiles whose enhancement layer rides in the same track, in NAL units other decoders shouldn't see. */
private val DUAL_LAYER = setOf(4, 7)

internal fun dolbyVisionProfile(format: Format): Int? =
    format.codecs?.split('.')?.getOrNull(1)?.toIntOrNull()

/** Dolby Vision units dropped or rewritten natively, with libdovi when the libmpv AAR carries it. */
internal object DolbyVisionNative {
    init {
        System.loadLibrary("aiostreams_dolby_vision")
    }

    val converts: Boolean by lazy { nativeLoadLibdovi() }

    /**
     * The Annex B sample at [from] in [sample] rewritten in place without RPU and enhancement layer units, or with
     * each RPU as profile 8.1 when [convert]ing: the RPUs converted in the upper 32 bits, its new length in the lower.
     */
    @JvmStatic
    external fun nativeRewrite(sample: ByteArray, from: Int, length: Int, convert: Boolean): Long

    @JvmStatic
    private external fun nativeLoadLibdovi(): Boolean
}

/** Any extractor, with its Dolby Vision tracks routed by [route] and the track's codec string and route told to [onRoute]. */
@OptIn(UnstableApi::class)
internal class DolbyVisionExtractor(
    private val extractor: Extractor,
    private val route: (Int) -> DolbyVisionRoute,
    private val onRoute: (codecs: String, DolbyVisionRoute) -> Unit,
) : Extractor by extractor {
    override fun init(output: ExtractorOutput) = extractor.init(DolbyVisionOutput(output, route, onRoute))

    override fun getUnderlyingImplementation(): Extractor = extractor.underlyingImplementation
}

@OptIn(UnstableApi::class)
private class DolbyVisionOutput(
    private val output: ExtractorOutput,
    private val route: (Int) -> DolbyVisionRoute,
    private val onRoute: (codecs: String, DolbyVisionRoute) -> Unit,
) : ExtractorOutput by output {
    override fun track(id: Int, type: Int): TrackOutput {
        val track = output.track(id, type)
        return if (type == C.TRACK_TYPE_VIDEO) DolbyVisionTrack(track, route, onRoute) else track
    }
}

/** Passes samples through untouched until a format calls for stripping or converting. */
@OptIn(UnstableApi::class)
private class DolbyVisionTrack(
    private val track: TrackOutput,
    private val route: (Int) -> DolbyVisionRoute,
    private val onRoute: (codecs: String, DolbyVisionRoute) -> Unit,
) : TrackOutput by track {
    private var rewrite: DolbyVisionRoute? = null

    /** A format to convert, held back until the first sample shows whether its RPUs do. */
    private var held: Format? = null
    private var converts: Boolean? = null
    private var pending = ByteArray(0)
    private var filled = 0
    private val sample = ParsableByteArray()

    override fun format(format: Format) {
        val profile = dolbyVisionProfile(format)
        if (format.sampleMimeType != MimeTypes.VIDEO_DOLBY_VISION || profile == null) {
            rewrite = null
            return track.format(format)
        }
        var chosen = route(profile)
        if (chosen == DolbyVisionRoute.CONVERTED) {
            if (converts == null) {
                rewrite = chosen
                held = format
                return
            }
            if (converts == false) chosen = DolbyVisionRoute.STRIPPED
        }
        rewrite = chosen.takeIf { it == DolbyVisionRoute.STRIPPED || it == DolbyVisionRoute.CONVERTED }
        emit(format, profile, chosen)
    }

    private fun emit(format: Format, profile: Int, chosen: DolbyVisionRoute) {
        onRoute(format.codecs.orEmpty(), chosen)
        track.format(
            when (chosen) {
                DolbyVisionRoute.DOLBY_VISION -> format
                DolbyVisionRoute.CONVERTED -> format.buildUpon()
                    .setCodecs(format.codecs?.split('.')?.toMutableList()?.apply { this[1] = "08" }?.joinToString("."))
                    .build()
                // Without a codec string the decoder is chosen by type alone, as for any file that lacks one.
                else -> format.buildUpon().setSampleMimeType(baseOf(profile)).setCodecs(null).build()
            },
        )
    }

    override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean): Int =
        sampleData(input, length, allowEndOfInput, TrackOutput.SAMPLE_DATA_PART_MAIN)

    override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int): Int {
        if (rewrite == null) return track.sampleData(input, length, allowEndOfInput, sampleDataPart)
        reserve(length)
        val read = input.read(pending, filled, length)
        if (read == C.RESULT_END_OF_INPUT) {
            if (allowEndOfInput) return C.RESULT_END_OF_INPUT
            throw EOFException()
        }
        filled += read
        return read
    }

    override fun sampleData(data: ParsableByteArray, length: Int) =
        sampleData(data, length, TrackOutput.SAMPLE_DATA_PART_MAIN)

    override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) {
        if (rewrite == null) return track.sampleData(data, length, sampleDataPart)
        reserve(length)
        data.readBytes(pending, filled, length)
        filled += length
    }

    override fun sampleMetadata(
        timeUs: Long,
        flags: Int,
        size: Int,
        offset: Int,
        cryptoData: TrackOutput.CryptoData?,
    ) {
        if (rewrite == null) return track.sampleMetadata(timeUs, flags, size, offset, cryptoData)
        val start = filled - offset - size
        var length = size
        var from = start
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
        sample.reset(pending, from + length)
        sample.position = from
        held?.let {
            // Without a converted RPU, the sample is already what stripping makes.
            val chosen = if (converted > 0) DolbyVisionRoute.CONVERTED else DolbyVisionRoute.STRIPPED
            converts = converted > 0
            rewrite = chosen
            held = null
            emit(it, 7, chosen)
        }
        track.sampleData(sample, length)
        track.sampleMetadata(timeUs, flags and C.BUFFER_FLAG_HAS_SUPPLEMENTAL_DATA.inv(), length, 0, cryptoData)
        // Bytes of the next sample, written before this one's metadata.
        System.arraycopy(pending, filled - offset, pending, 0, offset)
        filled = offset
    }

    private fun reserve(length: Int) {
        if (pending.size >= filled + length) return
        pending = pending.copyOf(maxOf(filled + length, pending.size * 2, 1 shl 20))
    }
}
