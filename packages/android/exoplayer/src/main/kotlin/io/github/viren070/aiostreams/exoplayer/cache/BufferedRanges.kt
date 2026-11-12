package io.github.viren070.aiostreams.exoplayer.cache

import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.SeekMap
import io.github.viren070.aiostreams.playback.TimeRange
import kotlin.math.max

/** The player's own buffer, and the cache's [held] runs timed by [map]'s seek points. */
@OptIn(UnstableApi::class)
internal fun bufferedRanges(positionUs: Long, bufferedUs: Long, map: SeekMap?, held: HeldBytes?): List<TimeRange> {
    val spans = mutableListOf(positionUs to bufferedUs)
    val durationUs = map?.durationUs?.takeIf { it > 0 }
    if (map != null && held != null && durationUs != null) {
        // Runs past the last seek point hold the index and other data after the media.
        val last = map.getSeekPoints(durationUs).first.position
        for (run in held.runs) {
            if (run.first >= last) continue
            spans += timeAt(map, run.first, durationUs, held.length) to timeAt(map, run.last + 1, durationUs, held.length)
        }
    }
    val ranges = mutableListOf<TimeRange>()
    for ((startUs, endUs) in spans.filter { it.second > it.first }.sortedBy { it.first }) {
        val start = (startUs / 1000).toDouble()
        val end = (endUs / 1000).toDouble()
        val previous = ranges.lastOrNull()
        if (previous != null && start <= previous.endMs) ranges[ranges.lastIndex] = previous.copy(endMs = max(previous.endMs, end))
        else ranges += TimeRange(start, end)
    }
    return ranges
}

@OptIn(UnstableApi::class)
private fun timeAt(map: SeekMap, position: Long, durationUs: Long, length: Long): Long {
    if (length > 0 && position >= length) return durationUs
    var low = 0L
    var high = durationUs
    while (high - low > SEARCH_US) {
        val mid = (low + high) ushr 1
        if (map.getSeekPoints(mid).first.position <= position) low = mid else high = mid
    }
    val before = map.getSeekPoints(low).first
    if (position <= before.position) return before.timeUs
    val next = map.getSeekPoints(before.timeUs + 1)
    val (afterUs, afterPosition) = when {
        next.second != next.first -> next.second.timeUs to next.second.position
        length > 0 -> durationUs to length
        else -> return before.timeUs
    }
    if (afterPosition <= before.position) return before.timeUs
    val fraction = (position - before.position).toDouble() / (afterPosition - before.position)
    return before.timeUs + (fraction * (afterUs - before.timeUs)).toLong()
}

private const val SEARCH_US = 1000L
