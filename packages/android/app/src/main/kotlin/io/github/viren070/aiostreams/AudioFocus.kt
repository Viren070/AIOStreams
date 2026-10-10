package io.github.viren070.aiostreams

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import androidx.annotation.OptIn
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.audio.AudioFocusRequestCompat
import androidx.media3.common.audio.AudioManagerCompat
import androidx.media3.common.util.UnstableApi

/** Holds audio focus while playing; calls, other players and unplugged headphones pause. */
@OptIn(UnstableApi::class)
class AudioFocus(
    private val context: Context,
    private val pause: () -> Unit,
    private val resume: () -> Unit,
) {
    private val audio = context.getSystemService(AudioManager::class.java)
    private val request = AudioFocusRequestCompat.Builder(AudioManagerCompat.AUDIOFOCUS_GAIN)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build()
        )
        .setOnAudioFocusChangeListener(::onChange)
        .build()
    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = pause()
    }
    private var playing = false
    private var resumeOnGain = false

    fun update(playing: Boolean) {
        if (playing == this.playing) return
        this.playing = playing
        if (playing) {
            resumeOnGain = false
            AudioManagerCompat.requestAudioFocus(audio, request)
            ContextCompat.registerReceiver(
                context, noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
        } else {
            // A pause for a call keeps the focus, to hear when it ends.
            if (!resumeOnGain) AudioManagerCompat.abandonAudioFocusRequest(audio, request)
            context.unregisterReceiver(noisy)
        }
    }

    fun release() {
        update(false)
        AudioManagerCompat.abandonAudioFocusRequest(audio, request)
    }

    private fun onChange(change: Int) {
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                resumeOnGain = false
                pause()
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                resumeOnGain = playing
                pause()
            }
            AudioManager.AUDIOFOCUS_GAIN -> if (resumeOnGain) {
                resumeOnGain = false
                resume()
            }
        }
    }
}
