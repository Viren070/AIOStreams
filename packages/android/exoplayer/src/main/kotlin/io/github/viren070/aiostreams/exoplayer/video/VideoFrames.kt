package io.github.viren070.aiostreams.exoplayer.video

import java.util.concurrent.ConcurrentSkipListSet

/** The times of the video frames the extractor has read, ahead of the player, which subtitles are drawn for early. */
internal class VideoFrames {
    private val times = ConcurrentSkipListSet<Long>()

    fun add(timeUs: Long) {
        times += timeUs
    }

    /** The frame showing at `timeUs`, the last at or before it, or null if none is read. */
    fun at(timeUs: Long): Long? = times.floor(timeUs)

    /** The first frame after `timeUs`, or null if none is read yet. */
    fun after(timeUs: Long): Long? = times.higher(timeUs)

    /** Forgets the frames before `timeUs`. */
    fun trim(timeUs: Long) = times.headSet(timeUs).clear()

    fun clear() = times.clear()
}
