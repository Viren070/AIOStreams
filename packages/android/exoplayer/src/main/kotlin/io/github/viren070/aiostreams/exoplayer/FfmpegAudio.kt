package io.github.viren070.aiostreams.exoplayer

import android.os.Handler
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.decoder.CryptoConfig
import androidx.media3.decoder.DecoderException
import androidx.media3.decoder.DecoderInputBuffer
import androidx.media3.decoder.SimpleDecoder
import androidx.media3.decoder.SimpleDecoderOutputBuffer
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DecoderAudioRenderer
import `is`.xyz.mpv.AudioDecoder
import java.nio.ByteBuffer

/*
 * The sound the device can't decode, decoded by libmpv's FFmpeg. Adapted from
 * Media3's FFmpeg extension (Apache 2.0).
 */

@OptIn(UnstableApi::class)
internal class FfmpegAudioRenderer(handler: Handler?, listener: AudioRendererEventListener?, sink: AudioSink) :
    DecoderAudioRenderer<FfmpegAudioDecoder>(handler, listener, sink) {
    override fun getName() = "FfmpegAudioRenderer"

    override fun supportsFormatInternal(format: Format): Int {
        val mime = format.sampleMimeType
        if (mime == null || !MimeTypes.isAudio(mime)) return C.FORMAT_UNSUPPORTED_TYPE
        val codec = codecOf(mime)
        return when {
            codec == null || !AudioDecoder.has(codec) -> C.FORMAT_UNSUPPORTED_SUBTYPE
            !sinkTakes(format, C.ENCODING_PCM_16BIT) && !sinkTakes(format, C.ENCODING_PCM_FLOAT) ->
                C.FORMAT_UNSUPPORTED_SUBTYPE
            format.cryptoType != C.CRYPTO_TYPE_NONE -> C.FORMAT_UNSUPPORTED_DRM
            else -> C.FORMAT_HANDLED
        }
    }

    override fun supportsMixedMimeTypeAdaptation() = ADAPTIVE_NOT_SEAMLESS

    override fun createDecoder(format: Format, cryptoConfig: CryptoConfig?) = FfmpegAudioDecoder(format, outputsFloat(format))

    override fun getOutputFormat(decoder: FfmpegAudioDecoder): Format = Format.Builder()
        .setSampleMimeType(MimeTypes.AUDIO_RAW)
        .setChannelCount(decoder.channels)
        .setSampleRate(decoder.sampleRate)
        .setPcmEncoding(decoder.encoding)
        .build()

    private fun sinkTakes(format: Format, encoding: Int) =
        sinkSupportsFormat(Util.getPcmFormat(encoding, format.channelCount, format.sampleRate))

    /** Float where the sink plays it as it is; AC-3 is 16-bit whatever the sink. */
    private fun outputsFloat(format: Format): Boolean {
        if (!sinkTakes(format, C.ENCODING_PCM_16BIT)) return true
        val float = Util.getPcmFormat(C.ENCODING_PCM_FLOAT, format.channelCount, format.sampleRate)
        return getSinkFormatSupport(float) == AudioSink.SINK_FORMAT_SUPPORTED_DIRECTLY &&
            format.sampleMimeType != MimeTypes.AUDIO_AC3
    }
}

@OptIn(UnstableApi::class)
internal class FfmpegAudioDecoder(format: Format, float: Boolean) :
    SimpleDecoder<DecoderInputBuffer, SimpleDecoderOutputBuffer, DecoderException>(
        arrayOfNulls(BUFFERS),
        arrayOfNulls(BUFFERS),
    ) {
    private val codec = checkNotNull(codecOf(checkNotNull(format.sampleMimeType)))
    private val decoder = AudioDecoder(codec, extraDataOf(format), format.sampleRate, format.channelCount, float)

    val encoding = if (float) C.ENCODING_PCM_FLOAT else C.ENCODING_PCM_16BIT
    val channels get() = decoder.channels
    val sampleRate get() = decoder.sampleRate

    init {
        setInitialInputBufferSize(format.maxInputSize.takeIf { it != Format.NO_VALUE } ?: INPUT_SIZE)
    }

    override fun getName() = "ffmpeg${AudioDecoder.version}-$codec"

    override fun createInputBuffer() =
        DecoderInputBuffer(DecoderInputBuffer.BUFFER_REPLACEMENT_MODE_DIRECT, AudioDecoder.inputPadding)

    override fun createOutputBuffer() = SimpleDecoderOutputBuffer(::releaseOutputBuffer)

    override fun createUnexpectedDecodeException(error: Throwable) = DecoderException("Unexpected decode error", error)

    override fun decode(
        inputBuffer: DecoderInputBuffer,
        outputBuffer: SimpleDecoderOutputBuffer,
        reset: Boolean,
    ): DecoderException? {
        if (reset) decoder.flush()
        val input = checkNotNull(inputBuffer.data)
        val size = decoder.decode(input, input.limit())
        // Bad data plays nothing, as with the device's own decoders.
        if (size <= 0) {
            outputBuffer.shouldBeSkipped = true
            return null
        }
        decoder.read(outputBuffer.init(inputBuffer.timeUs, size))
        return null
    }

    override fun release() {
        super.release()
        decoder.close()
    }

    private companion object {
        const val BUFFERS = 16
        const val INPUT_SIZE = 960 * 6
    }
}

/** FFmpeg's decoder for a sound type. */
private fun codecOf(mime: String) = when (mime) {
    MimeTypes.AUDIO_AAC -> "aac"
    MimeTypes.AUDIO_MPEG, MimeTypes.AUDIO_MPEG_L1, MimeTypes.AUDIO_MPEG_L2 -> "mp3"
    MimeTypes.AUDIO_AC3 -> "ac3"
    MimeTypes.AUDIO_E_AC3, MimeTypes.AUDIO_E_AC3_JOC -> "eac3"
    MimeTypes.AUDIO_TRUEHD -> "truehd"
    MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_EXPRESS, MimeTypes.AUDIO_DTS_HD -> "dca"
    MimeTypes.AUDIO_VORBIS -> "vorbis"
    MimeTypes.AUDIO_OPUS -> "opus"
    MimeTypes.AUDIO_AMR_NB -> "amrnb"
    MimeTypes.AUDIO_AMR_WB -> "amrwb"
    MimeTypes.AUDIO_FLAC -> "flac"
    MimeTypes.AUDIO_ALAC -> "alac"
    MimeTypes.AUDIO_MLAW -> "pcm_mulaw"
    MimeTypes.AUDIO_ALAW -> "pcm_alaw"
    else -> null
}

/** The setup FFmpeg's decoder takes from the container, in its own shape. */
private fun extraDataOf(format: Format): ByteArray? {
    val init = format.initializationData
    return when (format.sampleMimeType) {
        MimeTypes.AUDIO_AAC, MimeTypes.AUDIO_OPUS -> init.firstOrNull()
        // An ALAC atom around the magic cookie.
        MimeTypes.AUDIO_ALAC -> init.firstOrNull()?.let { cookie ->
            ByteBuffer.allocate(12 + cookie.size).putInt(12 + cookie.size).putInt(ALAC).putInt(0).put(cookie).array()
        }
        // Each of the first two headers behind its 16-bit length.
        MimeTypes.AUDIO_VORBIS -> if (init.size < 2) null else {
            val (first, second) = init
            ByteBuffer.allocate(first.size + second.size + 6)
                .putShort(first.size.toShort()).put(first)
                .putShort(0).putShort(second.size.toShort()).put(second)
                .array()
        }
        MimeTypes.AUDIO_FLAC -> init.firstNotNullOfOrNull(::flacStreamInfo)
        else -> null
    }
}

/** The STREAMINFO block in [data], bare or behind the stream marker or its block header. */
private fun flacStreamInfo(data: ByteArray): ByteArray? {
    val from = if (data.size >= 4 && data.copyOfRange(0, 4).contentEquals(FLAC_MARKER)) 4 else 0
    if (data.size - from == STREAM_INFO_SIZE) return data.copyOfRange(from, from + STREAM_INFO_SIZE)
    if (data.size < from + 4 + STREAM_INFO_SIZE) return null
    val type = data[from].toInt() and 0x7F
    val length = (data[from + 1].toInt() and 0xFF shl 16) or (data[from + 2].toInt() and 0xFF shl 8) or
        (data[from + 3].toInt() and 0xFF)
    if (type != 0 || length != STREAM_INFO_SIZE) return null
    return data.copyOfRange(from + 4, from + 4 + STREAM_INFO_SIZE)
}

private const val ALAC = 0x616c6163
private const val STREAM_INFO_SIZE = 34
private val FLAC_MARKER = byteArrayOf('f'.code.toByte(), 'L'.code.toByte(), 'a'.code.toByte(), 'C'.code.toByte())
