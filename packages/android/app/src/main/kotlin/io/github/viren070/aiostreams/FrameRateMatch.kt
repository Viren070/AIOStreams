package io.github.viren070.aiostreams

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Display
import kotlin.math.abs
import kotlin.math.max

class FrameRateMatch(
    private val activity: Activity,
    /** Pauses what plays while a TV blanks to switch modes; false when it was already paused. */
    private val hold: () -> Boolean,
    private val resume: () -> Unit,
) {
    var enabled = false
        set(value) {
            field = value
            if (!value) match(null)
        }

    private val main = Handler(Looper.getMainLooper())
    private var matched = 0.0
    private var original: Int? = null
    private var waiting: Runnable? = null

    fun match(frameRate: Double?) {
        if (frameRate == null || !enabled) return restore()
        if (abs(frameRate - matched) < 0.01) return
        matched = frameRate
        val display = activity.window.decorView.display ?: return
        val active = display.mode
        val best = choose(display.supportedModes.filter { it.sameSize(active) }, frameRate.toFloat()) ?: return
        if (best.modeId == active.modeId) return
        if (original == null) original = activity.window.attributes.preferredDisplayModeId
        prefer(best.modeId)
        val held = hold()
        wait(display, best) { if (held) resume() }
    }

    private fun restore() {
        matched = 0.0
        cancelWait()
        prefer(original ?: return)
        original = null
    }

    private fun prefer(modeId: Int) {
        val params = activity.window.attributes
        params.preferredDisplayModeId = modeId
        activity.window.attributes = params
    }

    private fun wait(display: Display, mode: Display.Mode, then: () -> Unit) {
        cancelWait()
        val start = SystemClock.uptimeMillis()
        var stable = 0
        val poll = object : Runnable {
            override fun run() {
                stable = if (display.mode.refreshRate.near(mode.refreshRate)) stable + 1 else 0
                if (stable >= 2 || SystemClock.uptimeMillis() - start > SWITCH_TIMEOUT_MS) {
                    waiting = null
                    return then()
                }
                main.postDelayed(this, POLL_MS)
            }
        }
        waiting = poll
        main.postDelayed(poll, POLL_MS)
    }

    private fun cancelWait() {
        waiting?.let(main::removeCallbacks)
        waiting = null
    }

    private companion object {
        const val POLL_MS = 60L
        const val SWITCH_TIMEOUT_MS = 4000L

        fun Display.Mode.sameSize(other: Display.Mode) =
            physicalWidth == other.physicalWidth && physicalHeight == other.physicalHeight

        fun Float.near(target: Float) = abs(this - target) <= max(0.08f, target * 0.003f)

        // 2.5 times is 3:2 pulldown.
        fun choose(modes: List<Display.Mode>, fps: Float): Display.Mode? =
            listOf(1f, 2f, 2.5f).firstNotNullOfOrNull { times ->
                val target = fps * times
                modes.filter { it.refreshRate.near(target) }.minByOrNull { abs(it.refreshRate - target) }
            }
    }
}
