package io.github.viren070.aiostreams

import android.app.Activity
import android.content.pm.ActivityInfo
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/** The window as the player asks for it: full screen (in landscape on a phone), and awake while playing. */
class PlayerWindow(private val activity: Activity) {
    var fullscreen = false
        private set

    fun setFullscreen(on: Boolean) {
        val window = activity.window
        val bars = WindowCompat.getInsetsController(window, window.decorView)
        if (on) {
            bars.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            bars.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            bars.show(WindowInsetsCompat.Type.systemBars())
        }
        // A tablet plays whichever way up it is held.
        val phone = activity.resources.configuration.smallestScreenWidthDp < 600
        activity.requestedOrientation =
            if (on && phone) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        fullscreen = on
    }

    fun keepAwake(on: Boolean) {
        val flag = WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        if (on) activity.window.addFlags(flag) else activity.window.clearFlags(flag)
    }
}
