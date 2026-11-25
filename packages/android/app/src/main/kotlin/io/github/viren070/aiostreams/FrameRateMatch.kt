package io.github.viren070.aiostreams

import android.app.Activity
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.view.Display
import io.github.viren070.aiostreams.logs.AppLog
import kotlin.math.abs
import kotlin.math.max

/**
 * Matches the display's refresh rate to the video's, and watches HDMI link again, after the app's own switches and
 * Android's as the app leaves and comes back: the settle window the player waits out before it trusts the output.
 */
class FrameRateMatch(
    private val activity: Activity,
    /** Pauses what plays while a TV blanks to switch modes; false when it was already paused. */
    private val hold: () -> Boolean,
    private val resume: () -> Unit,
    private val hasFile: () -> Boolean,
) {
    var enabled = false
        set(value) {
            field = value
            if (!value) restore()
        }

    /** The page draws the video in a box of its own, as a card's trailer or the mini player, and the display keeps its mode. */
    var framed = false
        set(value) {
            if (field == value) return
            field = value
            match(wanted.takeIf { hasFile() })
        }

    private val main = Handler(Looper.getMainLooper())
    private var wanted: Double? = null
    private var matched = 0.0
    private var original: Int? = null
    // Read on the player's thread too, through settling().
    @Volatile
    private var waiting: Runnable? = null

    // Read on the player's thread too, through settling().
    @Volatile
    private var lastEvent = -RELINK_MS

    // Read on the player's thread too: the output passes through what it did before again, and the wait can end early.
    @Volatile
    private var steady = false

    // Watches the output while HDMI links again, and ends the wait once it passes through what it did before. It asks
    // the audio service, which can hang for seconds while HDMI links again, so it runs on a thread of its own.
    private val probeThread = HandlerThread("hdmi-probe").apply { start() }
    private val probing = Handler(probeThread.looper)
    private val audio = activity.getSystemService(AudioManager::class.java)

    @Volatile
    private var released = false

    // As the system last told it, so the main thread never asks the audio service.
    @Volatile
    private var hdmiSeen = false

    // The sound goes out over Bluetooth, USB or wired headphones, not HDMI: HDMI linking again leaves it alone, so
    // there is nothing to wait out, and HDMI's own formats stay as they were for coming back to it. A state, not an
    // event: the formats' drop and the device's arrival come in either order.
    @Volatile
    private var elsewhere = false

    // Since when the output has been ready without a break, under the lock: a relink starts it again.
    private var readySince = 0L

    // The probe's thread only.
    private var probeStart = 0L
    private var running = false
    private var known = emptySet<String>()
    private var wasReady = true
    private var wasSteady = false

    /** Whether ExoPlayer's own list of formats has all it had before HDMI dropped some; asked on the probe's thread. */
    @Volatile
    var formatsBack: () -> Boolean = { true }

    /** Told, on the probe's thread, that a wait ended without them: the output is what it is now, a receiver switched off say. */
    @Volatile
    var formatsSettled: () -> Unit = {}

    fun match(frameRate: Double?) {
        wanted = frameRate
        if (frameRate == null || !enabled || framed) return restore()
        if (abs(frameRate - matched) < 0.01) return
        matched = frameRate
        val display = activity.window.decorView.display ?: return
        val active = display.mode
        val best = choose(display.supportedModes.filter { it.sameSize(active) }, frameRate.toFloat()) ?: return
        if (best.modeId == active.modeId) return
        if (original == null) original = activity.window.attributes.preferredDisplayModeId
        AppLog.i(TAG, "switching the display from ${active.refreshRate} to ${best.refreshRate} Hz for $frameRate fps")
        prefer(best.modeId)
        val held = hold()
        wait(display, best) {
            relinkStarted("the display switched")
            if (held) resume()
        }
    }

    /** HDMI links again (a mode switch, the app leaving or coming back), dropping the audio output for a while. */
    fun relinking() = !elsewhere && !steady && SystemClock.uptimeMillis() - lastEvent < RELINK_MS

    /** Whether the sound goes out over HDMI, which links again as the app leaves and comes back. */
    fun hdmiAudio() = hdmiSeen

    /**
     * HDMI links again: the display switched, its audio device or formats dropped, or the app left or came back
     * and Android switched the display by itself. Each event starts the wait again, for [RELINK_MS] at most; it
     * ends sooner once the output passes through what it did before.
     */
    fun relinkStarted(reason: String) {
        if (released || elsewhere) return
        // With the probe's check of both, so a new event can't be marked steady by the one before; read in the lock,
        // so a later event's time can't be replaced by an earlier one's.
        val now = synchronized(this) {
            val at = SystemClock.uptimeMillis()
            steady = false
            lastEvent = at
            readySince = 0L
            at
        }
        probing.post { startProbe(reason, now) }
    }

    private fun startProbe(reason: String, at: Long) {
        if (running) return AppLog.i(TAG, "HDMI: $reason at +${at - probeStart} ms")
        AppLog.i(TAG, "HDMI links again ($reason); waiting for it to settle")
        running = true
        probeStart = at
        wasReady = true
        wasSteady = false
        probing.removeCallbacks(probe)
        probing.post(probe)
    }

    // The system's own word that HDMI audio went or came back, which the formats' broadcast tells later.
    private var listed = false
    private val devices = object : AudioDeviceCallback() {
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) {
            // Headphones gone, the sound may be back on HDMI: asked on the probe's thread, as it asks the audio service.
            if (removed.any(::takesOver)) {
                probing.post { elsewhere = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any(::takesOver) }
            }
            if (!removed.any(::isHdmi)) return
            // Another HDMI sink (ARC, eARC) may stay.
            probing.post { hdmiSeen = hdmi() }
            relinkStarted("the HDMI audio device went")
        }

        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) {
            // Headphones take the sound from HDMI, those there from the start too: a wait that runs ends at once.
            if (added.any(::takesOver)) {
                elsewhere = true
                synchronized(this@FrameRateMatch) { lastEvent = SystemClock.uptimeMillis() - RELINK_MS }
            }
            // Its first call lists what is there already.
            val hdmi = added.any(::isHdmi)
            // On the probe's thread, after a reading a removal queued there: an older reading can't undo it.
            if (hdmi) probing.post { hdmiSeen = true }
            if (!listed) {
                listed = true
                return
            }
            if (hdmi) relinkStarted("the HDMI audio device came back")
        }
    }

    init {
        audio.registerAudioDeviceCallback(devices, main)
        probing.post { known = direct() }
    }

    fun release() {
        released = true
        cancelWait()
        audio.unregisterAudioDeviceCallback(devices)
        probeThread.quitSafely()
    }

    private val probe = object : Runnable {
        override fun run() {
            if (released) return
            if (elsewhere) {
                running = false
                return
            }
            val before = synchronized(this@FrameRateMatch) { lastEvent }
            val formats = direct()
            val ready = hdmi() && formats.containsAll(known) && formatsBack()
            // After the calls above, which the audio service can hold up: ready counts from when it was seen.
            val now = SystemClock.uptimeMillis()
            if (ready != wasReady) AppLog.i(TAG, "HDMI audio ${if (ready) "back" else "gone"} at +${now - probeStart} ms: ${formats.names()}")
            wasReady = ready
            synchronized(this@FrameRateMatch) {
                // A relink while the sample was taken: it tells nothing of the output after it.
                val fresh = lastEvent == before
                if (!ready || !fresh) readySince = 0L else if (readySince == 0L) readySince = now
                if (fresh && ready && now - readySince >= STEADY_MS && now - lastEvent >= QUIET_MS) steady = true
            }
            if (steady && !wasSteady) AppLog.i(TAG, "HDMI is steady again at +${now - probeStart} ms; the wait ends")
            wasSteady = steady
            // Headphones took the sound meanwhile: HDMI's formats stay as they were, not what those take.
            if (elsewhere) {
                running = false
                return
            }
            // Decided with relinkStarted's lock: a relink starting meanwhile keeps the wait and the baseline it had.
            val ended = synchronized(this@FrameRateMatch) {
                val over = steady || SystemClock.uptimeMillis() - lastEvent >= RELINK_MS
                if (over) known = formats
                over
            }
            if (!ended) {
                probing.postDelayed(this, PROBE_MS)
                return
            }
            running = false
            // Not back as before by the end of the wait, the output is what it is now: a receiver switched off, say.
            if (!steady) formatsSettled()
        }
    }

    private fun hdmi() = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any(::isHdmi)

    private fun isHdmi(device: AudioDeviceInfo) = device.isSink &&
        (device.type == AudioDeviceInfo.TYPE_HDMI || device.type == AudioDeviceInfo.TYPE_HDMI_ARC || device.type == AudioDeviceInfo.TYPE_HDMI_EARC)

    // An output Android sends media to in place of HDMI once it is there. Not a USB device in general: one listed
    // (a hub's, say) needn't take the sound, and the relink wait would be lost for it.
    private fun takesOver(device: AudioDeviceInfo) = device.isSink && device.type in OVER_HDMI

    /** The encodings the output takes as they are, as the system knows them now. */
    private fun direct(): Set<String> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return emptySet()
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
            .build()
        return DIRECT.filterTo(mutableSetOf()) { (_, encoding, channels) ->
            val format = AudioFormat.Builder().setEncoding(encoding).setSampleRate(48000).setChannelMask(channels).build()
            runCatching { AudioTrack.isDirectPlaybackSupported(format, attributes) }.getOrDefault(false)
        }.mapTo(mutableSetOf()) { it.first }
    }

    private fun Set<String>.names() = DIRECT.map { it.first }.filter { it in this }.joinToString().ifEmpty { "nothing" }

    /** Switching modes, or HDMI linking again: the audio output's formats can't be trusted yet. */
    fun settling() = waiting != null || relinking()

    private fun restore() {
        matched = 0.0
        cancelWait()
        prefer(original ?: return)
        AppLog.i(TAG, "switching the display back")
        original = null
        relinkStarted("the display switched back")
    }

    /** The screen's fastest rate while the page's controls show: playing, an adaptive screen runs at the video's. */
    fun controls(shown: Boolean) {
        val display = activity.window.decorView.display ?: return
        val rate = if (shown) {
            display.supportedModes.filter { it.sameSize(display.mode) }.maxOfOrNull { it.refreshRate } ?: return
        } else {
            0f
        }
        val params = activity.window.attributes
        if (params.preferredRefreshRate == rate) return
        params.preferredRefreshRate = rate
        activity.window.attributes = params
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
                val waited = SystemClock.uptimeMillis() - start
                if (stable >= 2 || waited > SWITCH_TIMEOUT_MS) {
                    AppLog.i(
                        TAG,
                        if (stable >= 2) "the display switched in $waited ms" else "the display still shows ${display.mode.refreshRate} Hz after $waited ms",
                    )
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
        const val TAG = "display"
        const val POLL_MS = 60L
        const val SWITCH_TIMEOUT_MS = 4000L
        const val PROBE_MS = 250L

        const val RELINK_MS = 5000L

        val OVER_HDMI = setOf(
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
            AudioDeviceInfo.TYPE_BLE_HEADSET,
            AudioDeviceInfo.TYPE_BLE_SPEAKER,
            AudioDeviceInfo.TYPE_BLE_BROADCAST,
            AudioDeviceInfo.TYPE_HEARING_AID,
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_USB_HEADSET,
        )

        // The wait ends early once the output passes through as before for this long, with no event for this long.
        const val STEADY_MS = 1000L
        const val QUIET_MS = 1500L

        val DIRECT = listOf(
            Triple("ac3", AudioFormat.ENCODING_AC3, AudioFormat.CHANNEL_OUT_5POINT1),
            Triple("eac3", AudioFormat.ENCODING_E_AC3, AudioFormat.CHANNEL_OUT_5POINT1),
            Triple("eac3-joc", AudioFormat.ENCODING_E_AC3_JOC, AudioFormat.CHANNEL_OUT_5POINT1),
            Triple("dts", AudioFormat.ENCODING_DTS, AudioFormat.CHANNEL_OUT_5POINT1),
            Triple("dts-hd", AudioFormat.ENCODING_DTS_HD, AudioFormat.CHANNEL_OUT_7POINT1_SURROUND),
            Triple("truehd", AudioFormat.ENCODING_DOLBY_TRUEHD, AudioFormat.CHANNEL_OUT_7POINT1_SURROUND),
        )

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
