package io.github.viren070.aiostreams.exoplayer.audio

import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.AudioSink.AudioSinkConfig
import androidx.media3.exoplayer.audio.ForwardingAudioSink

/** Passes through only the formats the page allows, and delays the sound against the picture. */
@OptIn(UnstableApi::class)
internal class OutputSink(sink: AudioSink) : ForwardingAudioSink(sink) {
    /** The sample types passed through, from mpv's `audio-spdif` list. */
    @Volatile
    var passthrough: Set<String> = emptySet()
        private set

    @Volatile
    var delayUs = 0L

    @Volatile
    private var listener: AudioSink.Listener? = null

    override fun setListener(listener: AudioSink.Listener) {
        this.listener = listener
        super.setListener(listener)
    }

    fun setSpdif(names: List<String>) {
        val next = names.flatMapTo(mutableSetOf()) { SPDIF[it].orEmpty() }
        if (next == passthrough) return
        passthrough = next
        // Picks the track's output again, so a changed setting applies at once.
        listener?.onAudioCapabilitiesChanged()
    }

    private var stretching = false
    private var passingThrough = false
    private var decodedForSpeed = false

    override fun configure(audioSinkConfig: AudioSinkConfig) {
        passingThrough = audioSinkConfig.format.sampleMimeType != MimeTypes.AUDIO_RAW
        super.configure(audioSinkConfig)
    }

    override fun setPlaybackParameters(playbackParameters: PlaybackParameters) {
        super.setPlaybackParameters(playbackParameters)
        val next = playbackParameters.speed != 1f
        if (next == stretching) return
        stretching = next
        // Picking again seeks the file.
        if (if (next) passingThrough else decodedForSpeed) {
            decodedForSpeed = false
            listener?.onAudioCapabilitiesChanged()
        }
    }

    /** Sound the output would take as it is, which the app decodes instead while the speed isn't normal: encoded sound can't change speed. */
    fun decodesForSpeed(format: Format) =
        (stretching && format.sampleMimeType in passthrough && super.supportsFormat(format)).also { if (it) decodedForSpeed = true }

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
