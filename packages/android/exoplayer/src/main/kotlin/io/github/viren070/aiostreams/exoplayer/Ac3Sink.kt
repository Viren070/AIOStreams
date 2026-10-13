package io.github.viren070.aiostreams.exoplayer

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.AudioSink.AudioSinkConfig
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import `is`.xyz.mpv.AudioEncoder
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.min

/**
 * Re-encodes surround sound to Dolby Digital, for an output that passes only
 * that through, as optical and ARC links do. The sound is shaped first, as
 * the sink's own processors only see sound it decodes. From the next track.
 */
@OptIn(UnstableApi::class)
internal class Ac3Sink(sink: AudioSink, levels: SoundLevels) : ForwardingAudioSink(sink) {
    @Volatile
    var enabled = false

    private val shaper = SoundShaper(levels)
    private var encoder: AudioEncoder? = null
    private var inputChannels = 0

    /** The input channel each channel takes, as some decoders' order differs. */
    private var mapping = IntArray(0)
    private var encodedChannels = 0
    private var sampleRate = 0

    /** The encoder's next frame of float samples, and how many sample frames it holds so far. */
    private var frame = EMPTY
    private var framed = 0
    private var framedFromUs = 0L
    private val packet = ByteBuffer.allocateDirect(MAX_PACKET)

    /** An encoded frame the sink hasn't taken yet. */
    private var pending = false
    private var pendingUs = 0L

    /** The buffer being taken in, where it started and its time. */
    private var current: ByteBuffer? = null
    private var currentStart = 0
    private var currentUs = 0L

    override fun configure(audioSinkConfig: AudioSinkConfig) {
        close()
        val format = audioSinkConfig.format
        val mapping = audioSinkConfig.outputChannelMapping?.toArray()
        val channels = mapping?.size ?: format.channelCount
        val target = Format.Builder()
            .setSampleMimeType(MimeTypes.AUDIO_AC3)
            .setChannelCount(min(channels, ENCODED_CHANNELS))
            .setSampleRate(format.sampleRate)
            .build()
        val encodes = enabled && format.sampleMimeType == MimeTypes.AUDIO_RAW &&
            format.pcmEncoding == C.ENCODING_PCM_16BIT && channels in 3..8 && format.sampleRate in SAMPLE_RATES &&
            super.supportsFormat(target) && AudioEncoder.has(CODEC)
        if (!encodes) return super.configure(audioSinkConfig)
        val encoder = AudioEncoder(CODEC, LAYOUTS.getValue(target.channelCount), format.sampleRate, BIT_RATE)
        inputChannels = format.channelCount
        this.mapping = mapping ?: IntArray(channels) { it }
        encodedChannels = target.channelCount
        sampleRate = format.sampleRate
        frame = ByteBuffer.allocateDirect(encoder.frameSize * encodedChannels * 4).order(ByteOrder.nativeOrder())
        super.configure(
            AudioSinkConfig.Builder(target)
                .setTimeline(audioSinkConfig.timeline)
                .setMediaPeriodId(audioSinkConfig.mediaPeriodId)
                .build(),
        )
        this.encoder = encoder
    }

    override fun handleBuffer(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int): Boolean {
        val encoder = encoder ?: return super.handleBuffer(buffer, presentationTimeUs, encodedAccessUnitCount)
        if (current !== buffer) {
            current = buffer
            currentStart = buffer.position()
            currentUs = presentationTimeUs
        }
        while (true) {
            if (pending) {
                if (!super.handleBuffer(packet, pendingUs, 1)) return false
                pending = false
            }
            if (buffer.remaining() < inputChannels * 2) {
                buffer.position(buffer.limit())
                current = null
                return true
            }
            take(buffer, encoder.frameSize)
            if (framed == encoder.frameSize) encode(encoder)
        }
    }

    /** Shapes frames from `buffer` into the encoder's frame. */
    private fun take(buffer: ByteBuffer, frameSize: Int) {
        val bytes = inputChannels * 2
        val count = min(buffer.remaining() / bytes, frameSize - framed)
        if (framed == 0) framedFromUs = currentUs + (buffer.position() - currentStart) / bytes * 1_000_000L / sampleRate
        shaper.shape(buffer, count, inputChannels, mapping, sampleRate, frame, framed * encodedChannels, encodedChannels, true)
        buffer.position(buffer.position() + count * bytes)
        framed += count
    }

    private fun encode(encoder: AudioEncoder) {
        val size = encoder.encode(frame, packet)
        framed = 0
        if (size == 0) return
        packet.clear().limit(size)
        pending = true
        pendingUs = framedFromUs
    }

    override fun playToEndOfStream() {
        val encoder = encoder
        if (encoder != null) {
            if (framed > 0) {
                val samples = frame.asFloatBuffer()
                for (i in framed * encodedChannels until samples.capacity()) samples.put(i, 0f)
                encode(encoder)
            }
            if (pending && !super.handleBuffer(packet, pendingUs, 1)) return
            pending = false
        }
        super.playToEndOfStream()
    }

    override fun hasPendingData() = pending || super.hasPendingData()

    override fun isEnded() = !pending && super.isEnded()

    override fun flush() {
        super.flush()
        framed = 0
        pending = false
        current = null
        shaper.reset()
    }

    override fun reset() {
        super.reset()
        close()
    }

    override fun release() {
        super.release()
        close()
    }

    private fun close() {
        encoder?.close()
        encoder = null
        framed = 0
        pending = false
        current = null
        shaper.reset()
    }

    private companion object {
        const val CODEC = "ac3"
        const val BIT_RATE = 640_000
        const val ENCODED_CHANNELS = 6
        const val MAX_PACKET = 4096
        val SAMPLE_RATES = setOf(32_000, 44_100, 48_000)

        /** FFmpeg's names for Android's layouts. */
        val LAYOUTS = mapOf(3 to "3.0", 4 to "quad", 5 to "5.0", 6 to "5.1")
        val EMPTY: ByteBuffer = ByteBuffer.allocateDirect(0)
    }
}
