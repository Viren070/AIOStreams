package io.github.viren070.aiostreams.exoplayer.video

import androidx.media3.common.Format
import androidx.media3.common.MimeTypes

/** How a Dolby Vision track plays on this device. */
internal enum class DolbyVisionRoute(val label: String) {
    DOLBY_VISION("Dolby Vision decoder"),
    CONVERTED("Dolby Vision decoder, as profile 8.1"),
    BASE_LAYER("base layer"),
    STRIPPED("base layer, enhancement layer dropped"),
}

internal interface DolbyVisionRouter {
    fun route(profile: Int): DolbyVisionRoute

    fun routed(codecs: String, route: DolbyVisionRoute)
}

/**
 * The route for a profile: Dolby Vision where the display shows it and [use]
 * allows, profile 7 as 8.1 where only a profile 8 decoder takes it, else the
 * base layer the profile carries for other displays. Profile 5 has none, so
 * it's the Dolby Vision decoder or nothing.
 */
internal fun dolbyVisionRoute(profile: Int, caps: MediaCaps, use: Boolean): DolbyVisionRoute = when {
    baseLayerOf(profile) == null -> DolbyVisionRoute.DOLBY_VISION
    use && caps.showsDolbyVision(profile) -> DolbyVisionRoute.DOLBY_VISION
    use && profile == 7 && caps.showsDolbyVision(8) && DolbyVisionNative.converts -> DolbyVisionRoute.CONVERTED
    profile in DUAL_LAYER -> DolbyVisionRoute.STRIPPED
    else -> DolbyVisionRoute.BASE_LAYER
}

internal fun dolbyVisionProfile(format: Format): Int? =
    format.codecs?.split('.')?.getOrNull(1)?.toIntOrNull()

/** The codec of a profile's base layer, which other decoders play as HDR10, HLG or SDR. */
internal fun baseLayerOf(profile: Int) = when (profile) {
    4, 7, 8 -> MimeTypes.VIDEO_H265
    9 -> MimeTypes.VIDEO_H264
    10 -> MimeTypes.VIDEO_AV1
    else -> null
}

/** Profiles whose enhancement layer rides in the same track, in NAL units other decoders shouldn't see. */
private val DUAL_LAYER = setOf(4, 7)

/** Dolby Vision units dropped or rewritten natively, with libdovi when the libs AAR carries it. */
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
