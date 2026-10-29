package io.github.viren070.aiostreams.exoplayer.extractor

/** Where the subtitle lines with a duration in Matroska's index sit in the file. */
internal class SubtitleIndex {
    private class Line(val startUs: Long, val endUs: Long, val position: Long)

    private val reading = HashMap<Long, MutableList<Line>>()

    @Volatile
    private var tracks: Map<Long, List<Line>>? = null

    fun add(track: Long, startUs: Long, durationUs: Long, position: Long) {
        if (tracks == null) reading.getOrPut(track) { mutableListOf() } += Line(startUs, startUs + durationUs, position)
    }

    fun finish() {
        if (tracks == null) tracks = reading.mapValues { (_, lines) -> lines.sortedBy { it.startUs } }
        reading.clear()
    }

    fun has(track: Long) = tracks?.containsKey(track) == true

    /** Where the first of `track`'s lines showing at `timeUs` sits, of those begun up to [READ_BACK_US] before. */
    fun earliest(track: String?, timeUs: Long): Long? {
        val tracks = tracks ?: return null
        val lines = when (track) {
            null -> return null
            MatroskaHost.ANY_TRACK -> tracks.values
            else -> listOfNotNull(track.toLongOrNull()?.let(tracks::get))
        }
        var earliest: Long? = null
        for (list in lines) {
            var i = firstFrom(list, timeUs - READ_BACK_US)
            while (i < list.size && list[i].startUs <= timeUs) {
                val line = list[i++]
                if (line.endUs > timeUs && line.position < (earliest ?: Long.MAX_VALUE)) earliest = line.position
            }
        }
        return earliest
    }

    private fun firstFrom(lines: List<Line>, timeUs: Long): Int {
        var low = 0
        var high = lines.size
        while (low < high) {
            val mid = (low + high) ushr 1
            if (lines[mid].startUs < timeUs) low = mid + 1 else high = mid
        }
        return low
    }

    private companion object {
        // mpv's demuxer-mkv-subtitle-preroll-secs-index.
        const val READ_BACK_US = 10_000_000L
    }
}
