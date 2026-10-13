package io.github.viren070.aiostreams.exoplayer

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** What the sound processors apply, which the engine changes as it plays. */
internal class SoundLevels {
    @Volatile
    var centreGain = 1f

    @Volatile
    var nightMode = false

    /** Volume past full. */
    @Volatile
    var gain = 1f

    /** The most channels to play, as the next track starts; 0 plays them as decoded. */
    @Volatile
    var maxChannels = 0

    /** Stereo, or 5.1 from more, where there are more channels than that. */
    fun outputs(channels: Int) = when {
        maxChannels == 0 || channels <= maxChannels -> channels
        maxChannels < 6 -> 2
        else -> 6
    }

    /** Whether the levels change sound with this many channels at all. */
    fun shape(channels: Int) = nightMode || gain != 1f || centreGain(channels) != 1f

    fun centreGain(channels: Int) = if (channels in CENTRED) centreGain else 1f

    private companion object {
        /** Android's layouts with a centre channel, which each have it third. */
        val CENTRED = setOf(3, 5, 6, 7, 8)
    }
}

/**
 * Dialogue boost, night mode, volume past full and mixing down, with a limiter
 * catching what they push past full scale, done natively on interleaved 16-bit sound.
 */
internal class SoundShaper(private val levels: SoundLevels) {
    /** The compressor's level and gain and the limiter's gain, between calls. */
    private val state = FloatArray(3)
    private var copy: ByteBuffer? = null

    init {
        reset()
    }

    fun reset() {
        state[0] = 0f
        state[1] = 1f
        state[2] = 1f
    }

    /**
     * Shapes [frames] frames from [input]'s position, its channel `map[c]` as channel `c`, into
     * [output] from sample [outputAt], 16-bit or float, mixed down to [outputChannels] where fewer.
     */
    fun shape(
        input: ByteBuffer,
        frames: Int,
        inputChannels: Int,
        map: IntArray,
        sampleRate: Int,
        output: ByteBuffer,
        outputAt: Int,
        outputChannels: Int,
        floatOutput: Boolean,
    ) {
        val (source, offset) = if (input.isDirect) input to input.position() else direct(input) to 0
        val shaped = nativeShape(
            source, offset, frames, inputChannels, map, sampleRate, output, outputAt, outputChannels, floatOutput,
            levels.centreGain(map.size), levels.nightMode, levels.gain, state,
        )
        check(shaped) { "couldn't shape the sound" }
    }

    /** Decoders hand over direct buffers; this is for one that doesn't. */
    private fun direct(input: ByteBuffer): ByteBuffer {
        val size = input.remaining()
        val copy = copy?.takeIf { it.capacity() >= size } ?: ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder())
        this.copy = copy
        copy.clear()
        copy.put(input.duplicate())
        return copy
    }

    private companion object {
        init {
            System.loadLibrary("aiostreams_sound")
        }

        @JvmStatic
        external fun nativeShape(
            input: ByteBuffer, inputOffset: Int, frames: Int, inputChannels: Int, map: IntArray, sampleRate: Int,
            output: ByteBuffer, outputAt: Int, outputChannels: Int, floatOutput: Boolean,
            centre: Float, night: Boolean, gain: Float, state: FloatArray,
        ): Boolean
    }
}
