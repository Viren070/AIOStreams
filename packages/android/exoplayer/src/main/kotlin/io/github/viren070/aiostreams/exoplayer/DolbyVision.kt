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
    BASE_LAYER("base layer"),
    STRIPPED("base layer, enhancement layer dropped"),
}

/**
 * The route for a profile: Dolby Vision where the display shows it, else the
 * base layer the profile carries for other displays. Profile 5 has none, so
 * it's the Dolby Vision decoder or nothing.
 */
internal fun dolbyVisionRoute(profile: Int, caps: MediaCaps): DolbyVisionRoute = when {
    caps.showsDolbyVision(profile) || baseOf(profile) == null -> DolbyVisionRoute.DOLBY_VISION
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
internal class DolbyVisionOutput(
    private val output: ExtractorOutput,
    private val route: (Int) -> DolbyVisionRoute,
    private val onRoute: (codecs: String, DolbyVisionRoute) -> Unit,
) : ExtractorOutput by output {
    override fun track(id: Int, type: Int): TrackOutput {
        val track = output.track(id, type)
        return if (type == C.TRACK_TYPE_VIDEO) DolbyVisionTrack(track, route, onRoute) else track
    }
}

/** Passes samples through untouched until a format calls for stripping. */
@OptIn(UnstableApi::class)
private class DolbyVisionTrack(
    private val track: TrackOutput,
    private val route: (Int) -> DolbyVisionRoute,
    private val onRoute: (codecs: String, DolbyVisionRoute) -> Unit,
) : TrackOutput by track {
    private var strip = false
    private var pending = ByteArray(0)
    private var filled = 0
    private var out = ByteArray(0)

    override fun format(format: Format) {
        val profile = dolbyVisionProfile(format)
        if (format.sampleMimeType != MimeTypes.VIDEO_DOLBY_VISION || profile == null) {
            strip = false
            return track.format(format)
        }
        val chosen = route(profile)
        onRoute(format.codecs.orEmpty(), chosen)
        strip = chosen == DolbyVisionRoute.STRIPPED
        if (chosen == DolbyVisionRoute.DOLBY_VISION) return track.format(format)
        // Without a codec string the decoder is chosen by type alone, as for any file that lacks one.
        track.format(format.buildUpon().setSampleMimeType(baseOf(profile)).setCodecs(null).build())
    }

    override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean): Int =
        sampleData(input, length, allowEndOfInput, TrackOutput.SAMPLE_DATA_PART_MAIN)

    override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int): Int {
        if (!strip) return track.sampleData(input, length, allowEndOfInput, sampleDataPart)
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
        if (!strip) return track.sampleData(data, length, sampleDataPart)
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
        if (!strip) return track.sampleMetadata(timeUs, flags, size, offset, cryptoData)
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
        val kept = if (cryptoData == null) dropLayers(from, length) else copy(from, length)
        track.sampleData(ParsableByteArray(out, kept), kept)
        track.sampleMetadata(timeUs, flags and C.BUFFER_FLAG_HAS_SUPPLEMENTAL_DATA.inv(), kept, 0, cryptoData)
        // Bytes of the next sample, written before this one's metadata.
        System.arraycopy(pending, filled - offset, pending, 0, offset)
        filled = offset
    }

    /** Copies the Annex B sample to [out] without NAL units 62 (RPU) and 63 (enhancement layer). */
    private fun dropLayers(from: Int, length: Int): Int {
        if (out.size < length) out = ByteArray(length)
        val end = from + length
        var kept = 0
        var unit = nextUnit(from, end)
        if (unit < 0) return copy(from, length)
        if (unit > from) {
            System.arraycopy(pending, from, out, 0, unit - from)
            kept = unit - from
        }
        while (unit >= 0) {
            val next = nextUnit(unit + 3, end)
            val stop = if (next < 0) end else next
            val header = startCodeEnd(unit)
            val type = if (header < end) pending[header].toInt() shr 1 and 0x3F else -1
            if (type != 62 && type != 63) {
                System.arraycopy(pending, unit, out, kept, stop - unit)
                kept += stop - unit
            }
            unit = next
        }
        return kept
    }

    private fun copy(from: Int, length: Int): Int {
        if (out.size < length) out = ByteArray(length)
        System.arraycopy(pending, from, out, 0, length)
        return length
    }

    /** Where the next start code begins, its leading zero byte included; -1 if none. */
    private fun nextUnit(from: Int, end: Int): Int {
        var i = from
        while (i + 2 < end) {
            if (pending[i + 2].toInt() and 0xFF > 1) {
                i += 3
                continue
            }
            if (pending[i] == ZERO && pending[i + 1] == ZERO && pending[i + 2] == ONE) {
                return if (i > from && pending[i - 1] == ZERO) i - 1 else i
            }
            i++
        }
        return -1
    }

    private fun startCodeEnd(unit: Int) = if (pending[unit + 2] == ONE) unit + 3 else unit + 4

    private fun reserve(length: Int) {
        if (pending.size >= filled + length) return
        pending = pending.copyOf(maxOf(filled + length, pending.size * 2, 1 shl 20))
    }

    private companion object {
        const val ZERO: Byte = 0
        const val ONE: Byte = 1
    }
}
