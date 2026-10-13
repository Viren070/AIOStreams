package io.github.viren070.aiostreams.exoplayer

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.AudioProcessor.StreamMetadata
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer

/**
 * The sound shaper in the sink's chain. Changes to the levels apply to what
 * plays next, without a reconfiguration, so it stays in the chain while they are off.
 */
@OptIn(UnstableApi::class)
internal class SoundProcessor(private val levels: SoundLevels) : BaseAudioProcessor() {
    private val shaper = SoundShaper(levels)
    private var channels = IntArray(0)
    private var outputs = 0
    private var sampleRate = 0

    override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT) return AudioFormat.NOT_SET
        channels = IntArray(inputAudioFormat.channelCount) { it }
        outputs = levels.outputs(channels.size)
        sampleRate = inputAudioFormat.sampleRate
        return AudioFormat(sampleRate, outputs, C.ENCODING_PCM_16BIT)
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val size = inputBuffer.remaining()
        if (size == 0) return
        val output = replaceOutputBuffer(size)
        if (outputs == channels.size && !levels.shape(outputs)) {
            shaper.reset()
            output.put(inputBuffer).flip()
            return
        }
        val frames = size / (channels.size * 2)
        shaper.shape(inputBuffer, frames, channels.size, channels, sampleRate, output, 0, outputs, false)
        inputBuffer.position(inputBuffer.limit())
        output.limit(frames * outputs * 2)
    }

    override fun onFlush(streamMetadata: StreamMetadata) = shaper.reset()

    override fun onReset() = shaper.reset()
}
