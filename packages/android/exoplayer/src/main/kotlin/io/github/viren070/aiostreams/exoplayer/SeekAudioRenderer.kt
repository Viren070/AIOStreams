package io.github.viren070.aiostreams.exoplayer

import android.content.Context
import android.os.Handler
import androidx.annotation.OptIn
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.decoder.DecoderInputBuffer
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.MediaCodecAudioRenderer
import androidx.media3.exoplayer.mediacodec.MediaCodecAdapter
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector

/**
 * Media3's audio renderer, decoding Opus and Vorbis from just before a seek's
 * position rather than from the video's keyframe: Media3 skips the earlier
 * samples only for formats whose every sample decodes alone.
 */
@OptIn(UnstableApi::class)
internal class SeekAudioRenderer(
    context: Context,
    codecAdapterFactory: MediaCodecAdapter.Factory,
    codecSelector: MediaCodecSelector,
    enableDecoderFallback: Boolean,
    eventHandler: Handler,
    eventListener: AudioRendererEventListener,
    audioSink: AudioSink,
) : MediaCodecAudioRenderer(context, codecAdapterFactory, codecSelector, enableDecoderFallback, eventHandler, eventListener, audioSink) {
    override fun shouldSkipDecoderInputBuffer(buffer: DecoderInputBuffer) =
        codecInfo?.mimeType in SETTLING && buffer.timeUs < lastResetPositionUs - SETTLE_US

    private companion object {
        val SETTLING = setOf(MimeTypes.AUDIO_OPUS, MimeTypes.AUDIO_VORBIS)

        /** Opus asks for 80 ms, and Vorbis's longest window is under 200. */
        const val SETTLE_US = 200_000L
    }
}
