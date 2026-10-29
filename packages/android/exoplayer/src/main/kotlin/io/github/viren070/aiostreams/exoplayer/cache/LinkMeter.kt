package io.github.viren070.aiostreams.exoplayer.cache

import android.os.SystemClock

/** Bytes a second the link delivers while it's read without pause, averaged over the last few seconds. */
internal class LinkMeter {
    var speed = 0.0
        private set
    private var bytes = 0L
    private var ns = 0L
    private var lastNs = 0L

    /** The next read follows a wait, which isn't the link's time. */
    fun pause() {
        lastNs = 0
    }

    fun add(count: Int) {
        val now = SystemClock.elapsedRealtimeNanos()
        if (lastNs != 0L) {
            bytes += count
            ns += now - lastNs
            if (ns >= SAMPLE_NS) {
                val sample = bytes * 1e9 / ns
                speed = if (speed == 0.0) sample else speed * 0.7 + sample * 0.3
                bytes = 0
                ns = 0
            }
        }
        lastNs = now
    }

    private companion object {
        const val SAMPLE_NS = 500_000_000L
    }
}
