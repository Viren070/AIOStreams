package io.github.viren070.aiostreams

import android.app.Activity
import android.media.AudioManager
import android.provider.Settings
import android.view.WindowManager
import kotlin.math.roundToInt

/** The media volume and the window's brightness, from 0 to 1, as swipes on the video set them. */
class Levels(private val activity: Activity) {
    private val audio = activity.getSystemService(AudioManager::class.java)
    private val maxVolume = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)

    val volume: Float
        get() = audio.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / maxVolume

    /** The window's own, or the system's until the page sets one. */
    val brightness: Float
        get() = activity.window.attributes.screenBrightness.takeIf { it >= 0 }
            ?: (Settings.System.getInt(activity.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 128) / 255f)

    fun setVolume(value: Float) {
        val index = (value * maxVolume).roundToInt().coerceIn(0, maxVolume)
        // No flags, so the system's own volume panel stays away: the page shows the level.
        if (index != audio.getStreamVolume(AudioManager.STREAM_MUSIC)) {
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, index, 0)
        }
    }

    /** Null hands the brightness back to the system. */
    fun setBrightness(value: Float?) {
        val window = activity.window
        window.attributes = window.attributes.apply {
            // Zero is darker than the system's own lowest.
            screenBrightness = value?.coerceIn(0.01f, 1f) ?: WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
        }
    }
}
