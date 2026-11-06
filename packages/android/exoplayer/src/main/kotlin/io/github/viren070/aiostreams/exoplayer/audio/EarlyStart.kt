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
 * Starts a passthrough track on its first frames rather than a full buffer.
 * Android plays a new direct track only once it holds its start threshold,
 * the whole buffer unless told otherwise, and gives up on it 200 ms short of
 * that. DTS-HD's buffer is 2.25 MB, which a seek or a change of track can't
 * fill in time, so the track sits there until the player calls it stuck.
 */
@OptIn(UnstableApi::class)
internal class EarlyStart(context: Context) :
    ForwardingAudioOutputProvider(AudioTrackAudioOutputProvider.Builder(context).build()) {
    override fun getAudioOutput(config: OutputConfig): AudioOutput {
        val output = super.getAudioOutput(config)
        if (Build.VERSION.SDK_INT >= 31 && !Util.isEncodingLinearPcm(config.encoding)) {
            // A compressed track's frame is a byte.
            (output as? AudioTrackAudioOutput)?.audioTrack?.let { it.setStartThresholdInFrames(minOf(it.bufferSizeInFrames, START_BYTES)) }
        }
        return output
    }

    private companion object {
        /** A few frames of any format. */
        const val START_BYTES = 64 shl 10
    }
}
