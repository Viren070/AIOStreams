package io.github.viren070.aiostreams

import android.content.Context
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.exoplayer.audio.AudioCapabilities
import androidx.media3.exoplayer.audio.AudioCapabilitiesReceiver

/**
 * The Dolby and DTS formats the audio output decodes itself, in mpv's
 * `audio-spdif` names, as ExoPlayer reads them from HDMI and the system.
 */
class Passthrough(context: Context, changed: () -> Unit) {
    private lateinit var capabilities: AudioCapabilities
    private val receiver = AudioCapabilitiesReceiver(
        context,
        {
            capabilities = it
            changed()
        },
        AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
        null,
    )

    init {
        capabilities = receiver.register()
    }

    fun codecs(): String =
        SPDIF.filter { (encodings) -> encodings.any(capabilities::supportsEncoding) }.joinToString(",") { it.second }

    fun release() = receiver.unregister()

    private companion object {
        val SPDIF = listOf(
            listOf(C.ENCODING_AC3) to "ac3",
            listOf(C.ENCODING_E_AC3, C.ENCODING_E_AC3_JOC) to "eac3",
            listOf(C.ENCODING_DTS) to "dts",
            listOf(C.ENCODING_DTS_HD) to "dts-hd",
            listOf(C.ENCODING_DOLBY_TRUEHD) to "truehd",
        )
    }
}
