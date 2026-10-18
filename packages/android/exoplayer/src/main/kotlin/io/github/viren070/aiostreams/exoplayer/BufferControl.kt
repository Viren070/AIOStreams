package io.github.viren070.aiostreams.exoplayer

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.analytics.PlayerId
import androidx.media3.exoplayer.source.TrackGroupArray
import androidx.media3.exoplayer.trackselection.ExoTrackSelection
import androidx.media3.exoplayer.upstream.Allocator
import androidx.media3.exoplayer.upstream.DefaultAllocator
import kotlin.math.max
import kotlin.math.min

/**
 * Media3's buffer, small since it lives in the Java heap and the stream cache
 * holds the file further ahead. Playback starts once the time buffered covers
 * what the link's speed against the file's bitrate calls for, and waits longer
 * after each stall.
 */
@OptIn(UnstableApi::class)
internal class BufferControl(private val cache: StreamCache) : LoadControl {
    private val allocator = DefaultAllocator(true, C.DEFAULT_BUFFER_SEGMENT_SIZE)
    private val heapBytes = (Runtime.getRuntime().maxMemory() / 5).coerceIn(MIN_HEAP_BYTES, MAX_HEAP_BYTES).toInt()
    private var stalls = 0
    private var stalled = false

    override fun getAllocator(playerId: PlayerId): Allocator = allocator

    override fun onPrepared(playerId: PlayerId) {
        stalls = 0
        stalled = false
    }

    override fun onTracksSelected(
        parameters: LoadControl.Parameters,
        trackGroups: TrackGroupArray,
        trackSelections: Array<out ExoTrackSelection?>,
    ) = allocator.setTargetBufferSize(targetBytes())

    override fun onStopped(playerId: PlayerId) = allocator.reset()

    override fun onReleased(playerId: PlayerId) = allocator.reset()

    override fun getBackBufferDurationUs(playerId: PlayerId) = 0L

    override fun retainBackBufferFromKeyframe(playerId: PlayerId) = false

    override fun shouldContinueLoading(parameters: LoadControl.Parameters) =
        allocator.totalBytesAllocated < targetBytes() && parameters.bufferedDurationUs < targetUs()

    /** With the cache reading ahead, the player's own buffer only feeds the decoders. */
    private fun targetBytes() = if (cache.caching) min(heapBytes, CACHED_BYTES) else heapBytes

    private fun targetUs() = if (cache.caching) CACHED_US else MAX_BUFFER_US

    override fun shouldStartPlayback(parameters: LoadControl.Parameters): Boolean {
        if (parameters.rebuffering && !stalled) {
            stalled = true
            stalls++
        }
        val start = allocator.totalBytesAllocated >= targetBytes() || run {
            val buffered = Util.getPlayoutDurationForMediaDuration(parameters.bufferedDurationUs, parameters.playbackSpeed)
            val ahead = Util.getPlayoutDurationForMediaDuration(cache.aheadUs(), parameters.playbackSpeed)
            buffered >= MIN_START_US && buffered + ahead >= requiredUs(parameters.rebuffering)
        }
        if (start) stalled = false
        return start
    }

    /** A second while the link keeps up with the file; a slower one enough to play a while before it runs out. */
    private fun requiredUs(rebuffering: Boolean): Long {
        val ratio = cache.ratio()
        var us = if (ratio.isNaN() || ratio >= 1) START_US else START_US + MARGIN_US + ((1 - ratio) * HORIZON_US).toLong()
        if (rebuffering) us = max(us, REBUFFER_US) shl min(stalls - 1, 3).coerceAtLeast(0)
        return min(us, MAX_START_US)
    }

    private companion object {
        const val MIN_HEAP_BYTES = 16L shl 20
        const val MAX_HEAP_BYTES = 64L shl 20
        const val MAX_BUFFER_US = 50_000_000L
        const val CACHED_BYTES = 32 shl 20
        const val CACHED_US = 20_000_000L
        const val MIN_START_US = 500_000L
        const val START_US = 1_000_000L
        const val REBUFFER_US = 2_000_000L
        const val MARGIN_US = 4_000_000L
        const val HORIZON_US = 120_000_000L
        const val MAX_START_US = 30_000_000L
    }
}
