package io.github.viren070.aiostreams.exoplayer

import io.github.viren070.aiostreams.playback.SubtitleLine
import java.util.TreeMap

/**
 * When each of the file's own text subtitles shows, logged as the reader
 * takes its lines, so the page can match an added subtitle against every
 * line read before it asked.
 */
internal class SubtitleLines {
    private val logs = HashMap<String, TreeMap<Long, Long>>()
    private var watched: String? = null
    private val pending = mutableListOf<SubtitleLine>()

    /** Counts files, so a file's reader can't reach the next one's lines. */
    @Volatile
    private var file = 0

    @Synchronized
    fun reset() {
        file++
        logs.clear()
        pending.clear()
        watched = null
    }

    /** Watches `track`'s lines, from those already read. */
    @Synchronized
    fun watch(track: String?) {
        if (track == watched) return
        watched = track
        pending.clear()
        logs[track]?.forEach { (start, end) -> pending += SubtitleLine(start.toDouble(), end.toDouble()) }
    }

    /** The watched track's lines read since the last call. */
    @Synchronized
    fun take(): List<SubtitleLine> = pending.toList().also { pending.clear() }

    @Synchronized
    private fun add(opened: Int, track: String, startMs: Long, endMs: Long) {
        if (opened != file || endMs <= startMs) return
        // Reading a stretch again after a seek gives the same lines again.
        if (logs.getOrPut(track) { TreeMap() }.put(startMs, endMs) == endMs) return
        if (track == watched) pending += SubtitleLine(startMs.toDouble(), endMs.toDouble())
    }

    /** The reader's way in for the file opening now, passing everything on to `inner`. */
    fun sink(inner: SubtitleSink): SubtitleSink {
        val opened = file
        val texts = HashSet<String>()
        return SubtitleSink(
            object : AssSink by inner.ass {
                override fun line(track: String, startMs: Long, durationMs: Long, line: ByteArray) {
                    add(opened, track, startMs, startMs + durationMs)
                    inner.ass.line(track, startMs, durationMs, line)
                }
            },
            object : TextSink {
                override fun track(track: String, parser: SampleParser) {
                    if (!parser.replace) texts += track
                    inner.text.track(track, parser)
                }

                override fun sample(track: String, timeUs: Long, data: ByteArray) {
                    if (track in texts) durationMs(data)?.let { add(opened, track, timeUs / 1000, timeUs / 1000 + it) }
                    inner.text.sample(track, timeUs, data)
                }
            },
        )
    }

    private companion object {
        /** Media3 writes Matroska's SubRip and WebVTT samples as one cue from 0 to the line's duration. */
        val END = Regex("""--> (\d+):(\d{2}):(\d{2})[,.](\d{3})""")

        fun durationMs(data: ByteArray): Long? {
            val head = String(data, 0, minOf(data.size, 64), Charsets.ISO_8859_1)
            val (hours, minutes, seconds, millis) = END.find(head)?.destructured ?: return null
            return ((hours.toLong() * 60 + minutes.toLong()) * 60 + seconds.toLong()) * 1000 + millis.toLong()
        }
    }
}
