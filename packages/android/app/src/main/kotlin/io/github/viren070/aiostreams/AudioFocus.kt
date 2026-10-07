package io.github.viren070.aiostreams

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import androidx.core.content.ContextCompat

/** Holds audio focus while playing; calls, other players and unplugged headphones pause. */
class AudioFocus(
    private val context: Context,
    private val pause: () -> Unit,
    private val resume: () -> Unit,
) {
    private val audio = context.getSystemService(AudioManager::class.java)
    private val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
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
            audio.requestAudioFocus(request)
            ContextCompat.registerReceiver(
                context, noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
        } else {
            // A pause for a call keeps the focus, to hear when it ends.
            if (!resumeOnGain) audio.abandonAudioFocusRequest(request)
            context.unregisterReceiver(noisy)
        }
    }

    fun release() {
        update(false)
        audio.abandonAudioFocusRequest(request)
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
