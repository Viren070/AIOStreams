package io.github.viren070.aiostreams.exoplayer.cache

import android.net.Uri
import android.os.SystemClock
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import java.io.EOFException
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** [length] is [C.LENGTH_UNSET] until the link answers. */
internal class HeldBytes(val runs: List<LongRange>, val length: Long)

@OptIn(UnstableApi::class)
internal class Stream(
    val uri: Uri,
    private val link: DataSource.Factory,
    private val player: PlayerBuffer,
    private val memory: Memory,
    private var budget: Long,
    private val aheadCap: Long,
) {
    private val lock = ReentrantLock()
    private val changed = lock.newCondition()
    private val blocks = Blocks()
    private var length = C.LENGTH_UNSET.toLong()
    private var answered = false
    private var readAt = 0L

    /** A position the bytes from readAt run unbroken to, or -1. */
    private var runHint = -1L

    /** The reader wakes the paused fetcher once it reads past this. */
    private var wakeAt = Long.MAX_VALUE
    private var refilling = true
    private var waited = false
    private var failure: IOException? = null

    @Volatile
    private var closed = false
    private var durationUs = C.TIME_UNSET
    private var skips: List<LongRange> = emptyList()
    private var released: List<LongRange> = emptyList()
    private var landings: List<LongRange> = emptyList()
    private var discarded: List<LongRange> = emptyList()

    /** What a second connection fetches: the file's index once its start shows where it is, or a landing. */
    private var side: LongRange? = null
    private var indexChecked = false

    /** Opens at bytes not held, which a landing's fetch gives the link up for. */
    private var misses = 0

    private val meter = LinkMeter()
    private var connectNs = 0.0

    /** Where the link redirected, which later requests go to directly. */
    private var resolved: Uri? = null

    /** Connections waiting on the link, since when, and whose. */
    private val waiting = ConcurrentHashMap<DataSource, Waiting>()

    private var fetcher: Task? = null
    private var sideTask: Task? = null

    init {
        lock.withLock { startFetch(0) }
        Thread(::watch, "stream-cache-watch").apply { isDaemon = true }.start()
    }

    fun close() = lock.withLock {
        closed = true
        blocks.free()
        changed.signalAll()
    }

    fun setDurationUs(us: Long) = lock.withLock {
        durationUs = us
        changed.signalAll()
    }

    fun setSkips(held: List<LongRange>, landings: List<LongRange>) = lock.withLock {
        skips = held.filter { it !in released }.sortedBy { it.first }
        this.landings = landings.sortedBy { it.first }.map { it.first..min(it.last, it.first + budget / LANDING_SHARE - 1) }
        runHint = -1
        changed.signalAll()
    }

    fun discard(range: LongRange) = lock.withLock {
        discarded = discarded + listOf(range)
        runHint = -1
        changed.signalAll()
    }

    /** False once the cache is at its least already. */
    fun shrink(): Boolean = lock.withLock {
        if (budget <= MIN_BYTES) return false
        budget = (budget / 2).coerceAtLeast(MIN_BYTES) / BLOCK * BLOCK
        while (blocks.count * BLOCK > budget && evict(-1)) Unit
        Log.i(TAG, "memory is short, holding ${budget shr 20} MB at most")
        true
    }

    fun aheadUs(): Long = lock.withLock {
        val rate = rate() ?: return 0
        (aheadBytes() / rate * 1_000_000).toLong()
    }

    fun ratio(): Double = lock.withLock { ratioLocked() }

    fun held(): HeldBytes = lock.withLock { HeldBytes(blocks.runs(), length) }

    /** Twice the link's time for the bytes, as its speed may drop meanwhile, and a margin. */
    fun canSpare(bytes: Long): Boolean = lock.withLock {
        val speed = meter.speed.takeIf { it > 0 } ?: return false
        player.bufferedUs + aheadUs() >= 2 * (bytes / speed * 1_000_000).toLong() + SPARE_MARGIN_US
    }

    fun stats(): Map<String, Number> = lock.withLock {
        buildMap {
            put("cacheBytes", blocks.count.toLong() * BLOCK)
            put("cacheBudget", budget)
            put("cacheAhead", aheadBytes())
            rate()?.let { put("cacheAheadMs", (aheadBytes() / it * 1000).toLong()) }
            put("linkSpeed", meter.speed.toLong())
            // JSON has no NaN.
            ratioLocked().takeIf { it.isFinite() }?.let { put("linkRatio", it) }
        }
    }

    /** Where the player starts reading; the file's length after that, once the link answers. */
    fun open(position: Long): Long = lock.withLock {
        moveReader(position)
        // A seek into a held skip watches it.
        skips.firstOrNull { position in it }?.let(::release)
        if (side?.let { position in it } != true && blocks.end(position) == position) misses++
        // Media3 opens again to retry what failed.
        failure = null
        changed.signalAll()
        while (!answered && failure == null && !closed) awaitReader()
        failure?.let { throw it }
        if (closed) throw IOException("the stream closed")
        if (length == C.LENGTH_UNSET.toLong()) C.LENGTH_UNSET.toLong() else length - position
    }

    fun read(position: Long, target: ByteArray, offset: Int, count: Int): Int = lock.withLock {
        moveReader(position)
        var n = blocks.read(position, target, offset, count)
        while (n == 0) {
            if (closed) throw IOException("the stream closed")
            discarded.firstOrNull { position in it }?.let { range ->
                val zeros = min(count.toLong(), range.last + 1 - position).toInt()
                target.fill(0, offset, offset + zeros)
                return zeros
            }
            if (length != C.LENGTH_UNSET.toLong() && position >= length) return C.RESULT_END_OF_INPUT
            failure?.let { throw it }
            // The page seeks past a held skip as playback reaches it.
            val skip = skips.firstOrNull { position in it }
            if (skip != null && !player.runningDry) {
                awaitReader(HELD_POLL_NS)
                n = blocks.read(position, target, offset, count)
                continue
            }
            skip?.let(::release)
            changed.signalAll()
            awaitReader()
            n = blocks.read(position, target, offset, count)
        }
        n
    }

    private fun moveReader(position: Long) {
        val jumped = abs(position - readAt) > BLOCK
        if (position < readAt || position > runHint) runHint = -1
        readAt = position
        if (jumped || position >= wakeAt) changed.signalAll()
    }

    private fun release(skip: LongRange) {
        skips = skips - listOf(skip)
        released = released + listOf(skip)
        runHint = -1
        changed.signalAll()
    }

    private fun awaitReader(nanos: Long = 0) {
        try {
            if (nanos > 0) changed.awaitNanos(nanos) else changed.await()
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            throw InterruptedIOException()
        }
    }

    private fun startFetch(failures: Int) {
        val task = Task(failures)
        fetcher = task
        Thread({ fetch(task) }, "stream-cache").apply { isDaemon = true }.start()
    }

    private fun fetch(task: Task) {
        val scratch = ByteArray(CHUNK)
        var source: DataSource? = null
        // Where the open connection reads next.
        var at = 0L
        if (task.failures > 0 && !failed(task, IOException("the link stalled"))) return
        while (true) {
            val from = lock.withLock { next(source?.let { at }, task) } ?: break
            if (waited) meter.pause()
            try {
                if (source == null || at != from) {
                    retire(source)
                    source = null
                    source = connect(from, task)
                    at = from
                    meter.pause()
                }
                val n = watched(source, task) { source.read(scratch, 0, CHUNK) }
                if (n == C.RESULT_END_OF_INPUT) {
                    lock.withLock {
                        if (length != C.LENGTH_UNSET.toLong() && at < length) throw EOFException("the link ended early")
                        length = at
                        changed.signalAll()
                    }
                    source.closeQuietly()
                    source = null
                    continue
                }
                lock.withLock {
                    if (task.abandoned) throw Abandoned()
                    // A side connection's share of the link isn't the link slowing.
                    if (side == null) meter.add(n) else meter.pause()
                    write(at, scratch, n)
                }
                at += n
                task.failures = 0
                if (!indexChecked) checkIndex()
            } catch (e: Exception) {
                if (task.abandoned) break
                retire(source)
                source = null
                if (closed) break
                task.failures++
                Log.w(TAG, "fetch failed (${task.failures})", e)
                if (!failed(task, e)) break
            }
        }
        if (task.abandoned) source?.closeQuietly() else retire(source)
    }

    /** False once the fetch should end. */
    private fun failed(task: Task, e: Exception): Boolean = lock.withLock {
        if (task.abandoned || closed) return false
        if (e !is HttpDataSource.InvalidResponseCodeException && task.failures <= RETRIES) {
            changed.awaitNanos(RETRY_NS shl (task.failures - 1))
        } else {
            failure = e as? IOException ?: IOException(e)
            task.failures = 0
            changed.signalAll()
        }
        true
    }

    /** Where to fetch next, after waiting while enough is ahead; null once closed or left. */
    private fun next(at: Long?, task: Task): Long? {
        waited = false
        while (!closed && !task.abandoned) {
            if (failure != null) {
                await()
                continue
            }
            val from = aheadEnd()
            val ahead = aheadBytes()
            val high = (aheadLimit() - landingBytes()).coerceAtLeast(MIN_AHEAD_BYTES)
            val low = lowWater(high)
            if (ahead >= high) refilling = false else if (ahead < low) refilling = true
            val done = length != C.LENGTH_UNSET.toLong() && from >= length
            if (done || !refilling) {
                wakeAt = if (done) Long.MAX_VALUE else from - low
                await()
                continue
            }
            wakeAt = Long.MAX_VALUE
            if (side?.let { from in it } == true) {
                await()
                continue
            }
            // Bytes before it the link delivers sooner than it answers a new request are read through.
            return if (at != null && at in (from - reopenGap())..from) at else from
        }
        return null
    }

    private fun reopenGap(): Long =
        (meter.speed * connectNs / 1e9).toLong().coerceIn(MIN_REOPEN_GAP, MAX_REOPEN_GAP)

    private fun await() {
        waited = true
        changed.await()
    }

    /** As the file's first bytes come in, fetches its index if they show it's further on. */
    private fun checkIndex() {
        val head = lock.withLock {
            val held = min(blocks.end(0), HEAD_BYTES.toLong()).toInt()
            if (held < MIN_HEAD_BYTES && held.toLong() != length) return
            ByteArray(held).also { blocks.read(0, it, 0, held) }
        }
        val range = FileIndex.locate(head, lock.withLock { length })
        if (range != null || head.size >= HEAD_BYTES) indexChecked = true
        range?.takeIf { it.first >= MAX_REOPEN_GAP }?.let(::prefetch)
    }

    private fun prefetch(range: LongRange) {
        if (lock.withLock { blocks.end(range.first) > range.first }) return
        fetchSide(range, "stream-cache-index", yields = false)
    }

    /** Fetches the next landing ahead of the reader once the link can spare it. */
    private fun fetchLanding() {
        val range = lock.withLock {
            val landing = landings.firstOrNull { it.last >= readAt } ?: return
            if (side != null || landing.first <= aheadEnd()) return
            val from = blocks.end(landing.first)
            if (from > landing.last || !canSpare(landing.last + 1 - from)) return
            from..landing.last
        }
        fetchSide(range, "stream-cache-landing", yields = true)
    }

    /** Bytes held of the next landing beyond what the reader reads on to. */
    private fun landingBytes(): Long {
        val landing = landings.firstOrNull { it.first > readAt } ?: return 0
        if (landing.first <= aheadEnd()) return 0
        return min(blocks.end(landing.first), landing.last + 1) - landing.first
    }

    /** [yields] stops it once the player runs dry or opens what isn't held. */
    private fun fetchSide(range: LongRange, name: String, yields: Boolean) {
        val task = Task()
        val missed = lock.withLock {
            if (side != null) return
            side = range
            sideTask = task
            misses
        }
        Thread({ readSide(range, yields, missed, task) }, name).apply { isDaemon = true }.start()
    }

    private fun readSide(range: LongRange, yields: Boolean, missed: Int, task: Task) {
        val scratch = ByteArray(CHUNK)
        var source: DataSource? = null
        try {
            source = connect(range.first, task)
            var at = range.first
            while (at <= range.last && !closed) {
                val n = watched(source, task) { source.read(scratch, 0, min(CHUNK.toLong(), range.last + 1 - at).toInt()) }
                if (n == C.RESULT_END_OF_INPUT) break
                val stop = lock.withLock {
                    if (task.abandoned) throw Abandoned()
                    write(at, scratch, n)
                    yields && (misses != missed || player.runningDry)
                }
                if (stop) break
                at += n
            }
        } catch (e: Exception) {
            // The main connection fetches what the extractor reads.
            if (!task.abandoned) Log.w(TAG, "side fetch failed", e)
        } finally {
            if (task.abandoned) source?.closeQuietly() else retire(source)
            lock.withLock {
                if (sideTask === task) {
                    side = null
                    sideTask = null
                }
                changed.signalAll()
            }
        }
    }

    private inline fun <T> watched(source: DataSource, task: Task, call: () -> T): T {
        waiting[source] = Waiting(SystemClock.elapsedRealtimeNanos(), task)
        try {
            val result = call()
            if (task.abandoned) {
                source.closeQuietly()
                throw Abandoned()
            }
            return result
        } finally {
            waiting.remove(source)
        }
    }

    /** Closing the connection here would race its read on the fetch thread and corrupt okhttp's buffers. */
    private fun abandon(task: Task) = lock.withLock {
        task.abandoned = true
        if (task === sideTask) {
            side = null
            sideTask = null
        }
        if (task === fetcher && !closed) startFetch(task.failures + 1)
        changed.signalAll()
    }

    /** Leaves fetches that wait too long on the link, starts landings, and shrinks the cache as memory runs short. */
    private fun watch() {
        var ticks = 0
        while (!closed) {
            SystemClock.sleep(WATCH_MS)
            fetchLanding()
            if (++ticks % MEMORY_TICKS == 0 && memory.short() && !shrink()) memory.onShort?.invoke()
            val now = SystemClock.elapsedRealtimeNanos()
            for ((source, waited) in waiting) {
                if (now - waited.since < STALL_NS || waiting.remove(source) == null) continue
                Log.w(TAG, "the link stalled, so a new connection takes over")
                abandon(waited.task)
            }
        }
    }

    private fun connect(from: Long, task: Task): DataSource {
        val source = link.createDataSource()
        val target = lock.withLock { resolved } ?: uri
        val startNs = SystemClock.elapsedRealtimeNanos()
        val opened = try {
            watched(source, task) { source.open(DataSpec.Builder().setUri(target).setPosition(from).build()) }
        } catch (e: IOException) {
            source.closeQuietly()
            // A redirect's link may expire; the original one makes a new one.
            if (target != uri && !task.abandoned) {
                lock.withLock { resolved = null }
                return connect(from, task)
            }
            throw e
        }
        lock.withLock {
            val ns = (SystemClock.elapsedRealtimeNanos() - startNs).toDouble()
            connectNs = if (connectNs == 0.0) ns else connectNs * 0.7 + ns * 0.3
            if (resolved == null) resolved = source.uri?.takeIf { it != uri }
            if (!answered && opened != C.LENGTH_UNSET.toLong()) length = from + opened
            answered = true
            changed.signalAll()
        }
        return source
    }

    /** Bytes a second of playing, from the file's size and duration. */
    private fun rate(): Double? =
        if (length > 0 && durationUs > 0) length * 1e6 / durationUs else null

    private fun ratioLocked(): Double {
        val rate = rate() ?: return Double.NaN
        return if (meter.speed > 0) meter.speed / rate else Double.NaN
    }

    /** A quarter keeps what just played, for seeking back. */
    private fun aheadLimit(): Long {
        var limit = budget - budget / 4
        rate()?.let { limit = min(limit, (it * AHEAD_MAX_SECONDS).toLong()) }
        return min(limit, aheadCap).coerceAtLeast(MIN_AHEAD_BYTES)
    }

    /**
     * How empty the cache gets before it fetches again: a link well ahead of the
     * file refills in long bursts, a slower one soon, and never in pieces too
     * small to be worth waking for.
     */
    private fun lowWater(high: Long): Long {
        val ratio = ratioLocked()
        val fraction = if (ratio.isNaN() || ratio <= 2) 1.0 else (1.0 - (ratio - 2) / 8).coerceAtLeast(0.5)
        return high - max((high * (1 - fraction)).toLong(), min(MIN_REFILL_BYTES, high / 4))
    }

    /** Where the bytes from the reader stop, counting held skips and what's discarded as held. */
    private fun aheadEnd(): Long {
        val end = blocks.end(if (runHint >= readAt) runHint else readAt) { p ->
            skips.firstOrNull { p in it } ?: discarded.firstOrNull { p in it }
        }
        runHint = end
        return end
    }

    /** Bytes held ahead of the reader, leaving out held skips and what's discarded. */
    private fun aheadBytes(): Long {
        val end = aheadEnd()
        val unread = (skips + discarded).sumOf { range ->
            (min(end, range.last + 1) - max(readAt, range.first)).coerceAtLeast(0)
        }
        return end - readAt - unread
    }

    private fun write(position: Long, source: ByteArray, count: Int) {
        if (closed) return
        if (blocks.write(position, source, count, ::makeRoom)) runHint = -1
        changed.signalAll()
    }

    private fun makeRoom(writing: Long): Boolean {
        while ((blocks.count + 1L) * BLOCK > budget) if (!evict(writing)) return false
        return true
    }

    /** Frees the block least likely to be read: played ones past what's kept, other runs but the next landing, the rest played, then the far end. */
    private fun evict(writing: Long): Boolean {
        val first = blocks.first ?: return false
        val reading = readAt / BLOCK
        val runEnd = (aheadEnd() - 1) / BLOCK
        val keepBehind = budget / 4 / BLOCK
        val landing = landings.firstOrNull { it.first > readAt }?.let { it.first / BLOCK..it.last / BLOCK } ?: LongRange.EMPTY
        val spare = { index: Long -> index != writing && index != reading }
        val victim = first.takeIf { it < reading - keepBehind }
            ?: blocks.lastAfter(runEnd) { spare(it) && it !in landing }
            ?: first.takeIf { it < reading }
            ?: blocks.lastAfter(reading, spare)
            ?: return false
        blocks.drop(victim)
        if (victim in reading..runEnd) runHint = -1
        return true
    }

    private class Task(@Volatile var failures: Int = 0) {
        @Volatile
        var abandoned = false
    }

    private class Waiting(val since: Long, val task: Task)

    private class Abandoned : Exception()

    private companion object {
        const val TAG = "stream-cache"
        const val CHUNK = 64 * 1024
        const val HEAD_BYTES = 64 * 1024
        const val MIN_BYTES = 32L shl 20
        const val MIN_HEAD_BYTES = 4 * 1024
        const val MIN_AHEAD_BYTES = 8L shl 20
        const val MIN_REFILL_BYTES = 8L shl 20
        const val AHEAD_MAX_SECONDS = 300
        const val MIN_REOPEN_GAP = 2L shl 20
        const val MAX_REOPEN_GAP = 32L shl 20
        const val RETRIES = 5
        const val RETRY_NS = 500_000_000L
        const val WATCH_MS = 1000L
        const val MEMORY_TICKS = 5
        const val STALL_NS = 8_000_000_000L
        const val LANDING_SHARE = 8
        const val SPARE_MARGIN_US = 4_000_000L
        const val HELD_POLL_NS = 100_000_000L

        // Closing a connection with bytes left drains it for a while first, which a fetch shouldn't wait for.
        // Never shut down, as a fetch thread can retire its connection after a release.
        val closer = ThreadPoolExecutor(0, 1, 10, TimeUnit.SECONDS, LinkedBlockingQueue()) {
            Thread(it, "stream-cache-close").apply { isDaemon = true }
        }

        fun retire(source: DataSource?) {
            if (source != null) closer.execute { source.closeQuietly() }
        }

        fun DataSource.closeQuietly() {
            runCatching { close() }
        }
    }
}
