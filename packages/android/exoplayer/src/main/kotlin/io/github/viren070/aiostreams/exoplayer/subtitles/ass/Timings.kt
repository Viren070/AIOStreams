package io.github.viren070.aiostreams.exoplayer.subtitles.ass

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** How long renders took, kept for the last few thousand. */
internal class Timings {
    private val samples = LongArray(4096)
    private var count = 0

    @Synchronized
    fun add(nanos: Long) {
        samples[count % samples.size] = nanos
        count++
    }

    @Synchronized
    fun stats(): JsonObject {
        val kept = samples.copyOf(minOf(count, samples.size)).sorted()
        fun ms(nanos: Long) = nanos / 1e6
        return buildJsonObject {
            put("renders", count)
            if (kept.isNotEmpty()) {
                put("renderMedianMs", ms(kept[kept.size / 2]))
                put("renderP95Ms", ms(kept[(kept.size * 95 / 100).coerceAtMost(kept.size - 1)]))
                put("renderMaxMs", ms(kept.last()))
                put("renderMeanMs", ms(kept.sum() / kept.size))
            }
        }
    }
}
