package io.github.viren070.aiostreams.exoplayer.audio

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.AudioSink.AudioSinkConfig
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import androidx.media3.extractor.Ac3Util
import java.nio.ByteBuffer

/** Re-times TrueHD at its first sync frame after a flush: DefaultAudioSink drops the buffers before it, yet keeps the first one's time. */
@OptIn(UnstableApi::class)
internal class TrueHdSink(sink: AudioSink) : ForwardingAudioSink(sink) {
    private var trueHd = false
    private var awaitingSync = false
    private var dropped = false

    override fun configure(audioSinkConfig: AudioSinkConfig) {
        trueHd = audioSinkConfig.format.sampleMimeType == MimeTypes.AUDIO_TRUEHD
        restart()
        super.configure(audioSinkConfig)
    }

    override fun handleBuffer(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int): Boolean {
        if (awaitingSync) {
            if (Ac3Util.findTrueHdSyncframeOffset(buffer) == C.INDEX_UNSET) {
                dropped = true
            } else {
                awaitingSync = false
                if (dropped) super.handleDiscontinuity()
            }
        }
        return super.handleBuffer(buffer, presentationTimeUs, encodedAccessUnitCount)
    }

    override fun flush() {
        restart()
        super.flush()
    }

    override fun reset() {
        restart()
        super.reset()
    }

    private fun restart() {
        awaitingSync = trueHd
        dropped = false
    }
}
