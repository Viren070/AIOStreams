package io.github.viren070.aiostreams.exoplayer

import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink

/** Passes through only the formats the page allows, and delays the sound against the picture. */
@OptIn(UnstableApi::class)
internal class OutputSink(sink: AudioSink) : ForwardingAudioSink(sink) {
    /** The sample types passed through, from mpv's `audio-spdif` list; read from the next track picked. */
    @Volatile
    var passthrough: Set<String> = emptySet()
        private set

    @Volatile
    var delayUs = 0L

    fun setSpdif(list: String) {
        passthrough = list.split(',').flatMapTo(mutableSetOf()) { SPDIF[it].orEmpty() }
    }

    private fun allowed(format: Format) = format.sampleMimeType == MimeTypes.AUDIO_RAW || format.sampleMimeType in passthrough

    override fun supportsFormat(format: Format) = allowed(format) && super.supportsFormat(format)

    override fun getFormatSupport(format: Format) =
        if (allowed(format)) super.getFormatSupport(format) else AudioSink.SINK_FORMAT_UNSUPPORTED

    // The video follows this clock: running it ahead shows each frame sooner than its sound.
    override fun getCurrentPositionUs(sourceEnded: Boolean): Long {
        val position = super.getCurrentPositionUs(sourceEnded)
        return if (position == AudioSink.CURRENT_POSITION_NOT_SET) position else position + delayUs
    }

    private companion object {
        val SPDIF = mapOf(
            "ac3" to listOf(MimeTypes.AUDIO_AC3),
            "eac3" to listOf(MimeTypes.AUDIO_E_AC3, MimeTypes.AUDIO_E_AC3_JOC),
            "dts" to listOf(MimeTypes.AUDIO_DTS),
            "dts-hd" to listOf(MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_HD, MimeTypes.AUDIO_DTS_X),
            "truehd" to listOf(MimeTypes.AUDIO_TRUEHD),
        )
    }
}
