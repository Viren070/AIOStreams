package io.github.viren070.aiostreams.logs

import android.os.SystemClock

/**
 * Lets a few lines of each kind through per window and counts the rest, for
 * sources that can log a line per frame or per reconnect. Lines differing only
 * in numbers are of a kind.
 */
class Repeats(private val tag: String, private val keep: Int = 3, private val windowMs: Long = 60_000) {
    private class Kind(val since: Long, val priority: Int, var last: String, var seen: Int = 1)

    private val kinds = LinkedHashMap<String, Kind>()

    @Synchronized
    fun write(priority: Int, line: String) {
        val now = SystemClock.elapsedRealtime()
        val shape = line.replace(DIGITS, "#")
        val kind = kinds[shape]
        if (kind != null && now - kind.since < windowMs) {
            kind.seen++
            kind.last = line
            if (kind.seen <= keep) AppLog.write(priority, tag, line)
            return
        }
        kinds.remove(shape)?.let(::held)
        if (kinds.size >= MAX_KINDS) kinds.remove(kinds.keys.first())?.let(::held)
        kinds[shape] = Kind(now, priority, line)
        AppLog.write(priority, tag, line)
    }

    /** Writes the counts still held back, as a file ends. */
    @Synchronized
    fun flush() {
        kinds.values.forEach(::held)
        kinds.clear()
    }

    private fun held(kind: Kind) {
        val more = kind.seen - keep
        if (more > 0) AppLog.write(kind.priority, tag, "$more more like: ${kind.last}")
    }

    private companion object {
        const val MAX_KINDS = 64
        val DIGITS = Regex("\\d+")
    }
}
