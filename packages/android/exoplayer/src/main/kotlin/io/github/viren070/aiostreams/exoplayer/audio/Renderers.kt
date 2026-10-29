package io.github.viren070.aiostreams.exoplayer.audio

import android.content.Context
import android.os.Handler
import androidx.annotation.OptIn
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector

@OptIn(UnstableApi::class)
internal class Renderers(context: Context, private val audio: AudioOutput) : DefaultRenderersFactory(context) {
    init {
        setEnableDecoderFallback(true)
    }

    override fun buildAudioSink(
        context: Context,
        enableFloatOutput: Boolean,
        enableAudioOutputPlaybackParameters: Boolean,
    ): AudioSink = audio.sink(context, enableFloatOutput, enableAudioOutputPlaybackParameters)

    // FFmpeg after the device's own decoders, for what they can't play, such as TrueHD. DTS skips them, as some play silence.
    override fun buildAudioRenderers(
        context: Context,
        extensionRendererMode: Int,
        mediaCodecSelector: MediaCodecSelector,
        enableDecoderFallback: Boolean,
        audioSink: AudioSink,
        eventHandler: Handler,
        eventListener: AudioRendererEventListener,
        out: ArrayList<Renderer>,
    ) {
        val decoders = MediaCodecSelector { mime, secure, tunneling ->
            if (mime in DTS) emptyList() else mediaCodecSelector.getDecoderInfos(mime, secure, tunneling)
        }
        out += DeviceAudioRenderer(context, codecAdapterFactory, decoders, enableDecoderFallback, eventHandler, eventListener, audioSink)
        out += FfmpegAudioRenderer(eventHandler, eventListener, audioSink)
    }

    private companion object {
        /** The DTS types FFmpeg decodes. */
        val DTS = setOf(MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_EXPRESS, MimeTypes.AUDIO_DTS_HD)
    }
}
