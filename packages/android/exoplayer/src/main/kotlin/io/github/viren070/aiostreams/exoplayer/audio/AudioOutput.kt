package io.github.viren070.aiostreams.exoplayer.audio

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import io.github.viren070.aiostreams.playback.PlayerSettings
import io.github.viren070.aiostreams.playback.Sound
import kotlin.math.pow

/** The sound's way out: shaped, passed through as the page allows, delayed, or re-encoded to Dolby Digital. */
@OptIn(UnstableApi::class)
internal class AudioOutput {
    val levels = SoundLevels()
    private lateinit var output: OutputSink
    private lateinit var ac3: Ac3Sink
    private var ac3Encode = false

    /** Built once, as the player is made. */
    fun sink(context: Context, enableFloatOutput: Boolean, enablePlaybackParameters: Boolean): AudioSink {
        val sink = DefaultAudioSink.Builder(context)
            .setEnableFloatOutput(enableFloatOutput)
            .setEnableAudioOutputPlaybackParameters(enablePlaybackParameters)
            .setAudioProcessors(arrayOf(SoundProcessor(levels)))
            .build()
        ac3 = Ac3Sink(sink, levels)
        output = OutputSink(ac3)
        return output
    }

    fun setSettings(settings: PlayerSettings) {
        output.setSpdif(settings.passthrough)
        output.delayUs = (settings.audioDelayMs * 1000).toLong()
        levels.maxChannels = CHANNELS[settings.audioChannels] ?: 0
        updateEncoding()
    }

    fun setSound(sound: Sound) {
        levels.centreGain = 10f.pow(sound.dialogueBoost / 20f)
        levels.nightMode = sound.nightMode
        ac3Encode = sound.ac3Encode
        updateEncoding()
    }

    /** Encoding to Dolby Digital needs it to pass through. */
    private fun updateEncoding() {
        ac3.enabled = ac3Encode && MimeTypes.AUDIO_AC3 in output.passthrough
    }

    companion object {
        /** The layouts the page offers. */
        private val CHANNELS = mapOf("stereo" to 2, "5.1" to 6, "7.1" to 8)

        /** The sound type an audio track carries, PCM for any decoded sound. */
        fun mimeOf(encoding: Int): String = when (encoding) {
            C.ENCODING_AC3 -> MimeTypes.AUDIO_AC3
            C.ENCODING_E_AC3 -> MimeTypes.AUDIO_E_AC3
            C.ENCODING_E_AC3_JOC -> MimeTypes.AUDIO_E_AC3_JOC
            C.ENCODING_AC4 -> MimeTypes.AUDIO_AC4
            C.ENCODING_DTS -> MimeTypes.AUDIO_DTS
            C.ENCODING_DTS_HD -> MimeTypes.AUDIO_DTS_HD
            C.ENCODING_DTS_UHD_P2 -> MimeTypes.AUDIO_DTS_X
            C.ENCODING_DOLBY_TRUEHD -> MimeTypes.AUDIO_TRUEHD
            else -> MimeTypes.AUDIO_RAW
        }
    }
}
