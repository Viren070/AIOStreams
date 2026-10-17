package io.github.viren070.aiostreams.exoplayer

import android.content.Context
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaCodecList
import android.os.Build
import android.view.Display
import androidx.media3.common.MimeTypes

/** What the display shows and which Dolby Vision profiles a decoder takes, read as each file loads. */
internal class MediaCaps(val hdrTypes: Set<Int>, val dolbyVisionProfiles: Set<Int>) {
    /** Dolby Vision as Dolby Vision: the display shows it and a decoder takes the profile. */
    fun showsDolbyVision(profile: Int) =
        Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION in hdrTypes && profile in dolbyVisionProfiles

    companion object {
        fun read(context: Context) = MediaCaps(hdrTypes(context), decoderProfiles)

        private fun hdrTypes(context: Context): Set<Int> {
            val display = context.getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY)
                ?: return emptySet()
            // A TV's modes can differ, so it's the current one's from Android 14.
            val types = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                display.mode.supportedHdrTypes
            } else {
                @Suppress("DEPRECATION")
                display.hdrCapabilities?.supportedHdrTypes
            }
            return types?.toSet().orEmpty()
        }

        private val decoderProfiles: Set<Int> by lazy {
            runCatching {
                MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
                    .filter { !it.isEncoder && MimeTypes.VIDEO_DOLBY_VISION in it.supportedTypes }
                    .flatMap { it.getCapabilitiesForType(MimeTypes.VIDEO_DOLBY_VISION).profileLevels.asList() }
                    .mapNotNull { PROFILES[it.profile] }
                    .toSet()
            }.getOrDefault(emptySet())
        }

        /** Android's Dolby Vision profile constants, by the profile numbers codec strings use. */
        private val PROFILES = mapOf(
            CodecProfileLevel.DolbyVisionProfileDvavPer to 0,
            CodecProfileLevel.DolbyVisionProfileDvavPen to 1,
            CodecProfileLevel.DolbyVisionProfileDvheDer to 2,
            CodecProfileLevel.DolbyVisionProfileDvheDen to 3,
            CodecProfileLevel.DolbyVisionProfileDvheDtr to 4,
            CodecProfileLevel.DolbyVisionProfileDvheStn to 5,
            CodecProfileLevel.DolbyVisionProfileDvheDth to 6,
            CodecProfileLevel.DolbyVisionProfileDvheDtb to 7,
            CodecProfileLevel.DolbyVisionProfileDvheSt to 8,
            CodecProfileLevel.DolbyVisionProfileDvavSe to 9,
            CodecProfileLevel.DolbyVisionProfileDvav110 to 10,
        )
    }
}

/** What the display shows and which Dolby Vision profiles a decoder takes, for a report. */
fun mediaCapsLine(context: Context): String {
    val caps = MediaCaps.read(context)
    val hdr = caps.hdrTypes.sorted().map { HDR_NAMES[it] ?: "type $it" }.ifEmpty { listOf("none") }
    val dv = caps.dolbyVisionProfiles.sorted().ifEmpty { null }?.joinToString(", ") ?: "none"
    return "Display: ${hdr.joinToString(", ")}; DV decoder profiles: $dv"
}

private val HDR_NAMES = mapOf(
    Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION to "Dolby Vision",
    Display.HdrCapabilities.HDR_TYPE_HDR10 to "HDR10",
    Display.HdrCapabilities.HDR_TYPE_HLG to "HLG",
    Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS to "HDR10+",
)
