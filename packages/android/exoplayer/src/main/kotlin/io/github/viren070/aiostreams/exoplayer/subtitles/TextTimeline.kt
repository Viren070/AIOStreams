package io.github.viren070.aiostreams.exoplayer.subtitles

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.text.Cue
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.text.CuesWithTiming
import java.util.TreeMap
import java.util.concurrent.ConcurrentHashMap

/**
 * A subtitle whose each line takes the place of the one before, as pictures
 * do, which the subtitle view shows on the video's frames so its delay applies.
 */
@OptIn(UnstableApi::class)
internal class TextTimeline(
    private val parser: SampleParser,
    /** How late the engine shows lines, which keeps that much older ones. */
    private val delayUs: () -> Long,
) {
    private val lines = TreeMap<Long, CuesWithTiming>()

    /** The track's samples, parsed only once a frame showing the track reaches them. */
    private val samples = TreeMap<Long, MutableList<ByteArray>>()

    @Synchronized
    fun sample(timeUs: Long, data: ByteArray) {
        val starting = samples.getOrPut(timeUs) { mutableListOf() }
        if (starting.none { it.contentEquals(data) }) starting += data
        trim(timeUs - KEPT_US - delayUs().coerceAtLeast(0))
    }

    /** Keeps the line showing at `beforeUs` and later ones. */
    @Synchronized
    fun trim(beforeUs: Long) {
        samples.headMap(samples.floorKey(beforeUs) ?: beforeUs).clear()
        lines.headMap(lines.floorKey(beforeUs) ?: beforeUs).clear()
    }

    @Synchronized
    fun cuesAt(timeUs: Long): List<Cue> {
        samples.floorKey(timeUs)?.let { samples.headMap(it).clear() }
        while (true) {
            val due = samples.firstEntry()?.takeIf { it.key <= timeUs } ?: break
            samples.pollFirstEntry()
            for (data in due.value) parser.parse(due.key, data) { lines[it.startTimeUs] = it }
        }
        val line = lines.floorEntry(timeUs)?.value ?: return emptyList()
        return if (line.durationUs == C.TIME_UNSET || timeUs < line.endTimeUs) line.cues else emptyList()
    }

    private companion object {
        /* Media3 reads up to 50 s ahead of the frames, and a delay of up to a minute shows at once. */
        const val KEPT_US = 120_000_000L
    }
}

/** The file's subtitles the subtitle view draws, as its reader takes them. */
internal class TextTracks(private val delayUs: () -> Long) {
    private val timelines = ConcurrentHashMap<String, TextTimeline>()

    /** Counts files, so a file's reader can't reach the next one's tracks. */
    @Volatile
    private var file = 0

    operator fun get(track: String): TextTimeline? = timelines[track]

    fun reset() {
        file++
        timelines.clear()
    }

    /** Hidden tracks keep only lines that could show at once if picked. */
    fun trimHidden(shown: TextTimeline?, timeUs: Long) {
        for (timeline in timelines.values) if (timeline !== shown) timeline.trim(timeUs - HIDDEN_KEPT_US)
    }

    /** The reader's way in for the file opening now. */
    fun sink(): TextSink {
        val opened = file
        return object : TextSink {
            override fun track(track: String, parser: SampleParser) {
                if (opened == file) timelines.putIfAbsent(track, TextTimeline(parser, delayUs))
            }

            override fun sample(track: String, timeUs: Long, data: ByteArray) {
                if (opened == file) timelines[track]?.sample(timeUs, data)
            }
        }
    }

    private companion object {
        const val HIDDEN_KEPT_US = 30_000_000L
    }
}
