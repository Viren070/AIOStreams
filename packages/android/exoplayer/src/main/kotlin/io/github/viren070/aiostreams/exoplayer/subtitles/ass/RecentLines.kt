package io.github.viren070.aiostreams.exoplayer.subtitles.ass

import kotlin.math.abs

/** Every track's latest lines, capped since signs traced frame by frame can fill the Java heap in seconds of video. */
internal class RecentLines {
    private class Kept(val track: String, val line: AssLine)

    private val maxBytes = Runtime.getRuntime().maxMemory() / HEAP_SHARE
    private val lines = ArrayDeque<Kept>()
    private var bytes = 0L
    private var sweptMs = 0L

    fun add(track: String, line: AssLine, nowMs: Long) {
        lines += Kept(track, line)
        bytes += line.bytes.size
        if (abs(nowMs - sweptMs) >= SWEEP_MS) sweep(nowMs)
        while (bytes > maxBytes) bytes -= lines.removeFirst().line.bytes.size
    }

    fun forEach(track: String?, action: (AssLine) -> Unit) {
        for (kept in lines) if (kept.track == track) action(kept.line)
    }

    fun clear() {
        lines.clear()
        bytes = 0
        sweptMs = 0
    }

    // Not from the front alone: a line staying up sits ahead of many that have ended.
    private fun sweep(nowMs: Long) {
        sweptMs = nowMs
        lines.removeAll { kept ->
            val ended = kept.line.endMs < nowMs - KEPT_MS
            if (ended) bytes -= kept.line.bytes.size
            ended
        }
    }

    private companion object {
        const val HEAP_SHARE = 8
        const val KEPT_MS = 30_000L
        const val SWEEP_MS = 1000L
    }
}
