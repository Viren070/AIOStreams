package io.github.viren070.aiostreams.exoplayer.audio

import android.content.Context
import android.os.Build
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.exoplayer.audio.AudioOutput
import androidx.media3.exoplayer.audio.AudioOutputProvider.OutputConfig
import androidx.media3.exoplayer.audio.AudioTrackAudioOutput
import androidx.media3.exoplayer.audio.AudioTrackAudioOutputProvider
import androidx.media3.exoplayer.audio.ForwardingAudioOutputProvider

/**
 * The sink's audio tracks. A passthrough track starts on its first frames, as Android otherwise
 * waits for a full buffer, which a seek can't always fill for DTS-HD.
 */
@OptIn(UnstableApi::class)
internal class AudioTracks(context: Context) :
    ForwardingAudioOutputProvider(AudioTrackAudioOutputProvider.Builder(context).build()) {
    override fun getAudioOutput(config: OutputConfig): AudioOutput {
        val output = super.getAudioOutput(config)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || Util.isEncodingLinearPcm(config.encoding)) return output
        val track = (output as? AudioTrackAudioOutput)?.audioTrack ?: return output
        // A compressed track's frame is a byte.
        track.setStartThresholdInFrames(minOf(track.bufferSizeInFrames, START_BYTES))
        return output
    }

    private companion object {
        const val START_BYTES = 64 shl 10
    }
}
