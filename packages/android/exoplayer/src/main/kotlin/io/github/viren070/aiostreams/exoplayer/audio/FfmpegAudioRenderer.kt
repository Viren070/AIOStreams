package io.github.viren070.aiostreams.exoplayer.audio

import android.os.Handler
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.decoder.CryptoConfig
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DecoderAudioRenderer
import `is`.xyz.mpv.AudioDecoder

/**
 * The sound the device can't decode, decoded by libmpv's FFmpeg. Adapted from
 * Media3's FFmpeg extension (Apache 2.0).
 */
@OptIn(UnstableApi::class)
internal class FfmpegAudioRenderer(
    handler: Handler?,
    listener: AudioRendererEventListener?,
    sink: AudioSink,
    /** Whether DTS-HD and DTS:X decode as their DTS core alone, read as each decoder opens. */
    private val dtsCore: () -> Boolean,
) : DecoderAudioRenderer<FfmpegAudioDecoder>(handler, listener, sink) {
    override fun getName() = "FfmpegAudioRenderer"

    override fun supportsFormatInternal(format: Format): Int {
        val mime = format.sampleMimeType
        if (mime == null || !MimeTypes.isAudio(mime)) return C.FORMAT_UNSUPPORTED_TYPE
        val codec = FfmpegAudioDecoder.codecOf(mime)
        return when {
            codec == null || !AudioDecoder.has(codec) -> C.FORMAT_UNSUPPORTED_SUBTYPE
            !sinkTakes(format, C.ENCODING_PCM_16BIT) && !sinkTakes(format, C.ENCODING_PCM_FLOAT) ->
                C.FORMAT_UNSUPPORTED_SUBTYPE
            format.cryptoType != C.CRYPTO_TYPE_NONE -> C.FORMAT_UNSUPPORTED_DRM
            else -> C.FORMAT_HANDLED
        }
    }

    override fun supportsMixedMimeTypeAdaptation() = ADAPTIVE_NOT_SEAMLESS

    override fun createDecoder(format: Format, cryptoConfig: CryptoConfig?) =
        FfmpegAudioDecoder(format, outputsFloat(format), dtsCore())

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
