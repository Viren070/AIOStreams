package io.github.viren070.aiostreams.exoplayer

import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.net.ConnectivityManager
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import io.github.viren070.aiostreams.playback.CacheBudget
import java.io.EOFException
import java.io.IOException
import java.io.InterruptedIOException
import java.nio.ByteBuffer
import java.util.TreeMap
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * The playing file's bytes around where the player reads, in native memory and
 * fetched ahead on one connection, so seeks inside it, track changes and the
 * extractor's jumps read memory instead of opening the link again. [link]
 * opens the cache's own connections without a read timeout, as one costs a
 * wakeup per read: the cache closes a stalled one itself.
 */
@OptIn(UnstableApi::class)
internal class StreamCache(
    context: Context,
    private val upstream: DataSource.Factory,
    private val link: DataSource.Factory,
) : ComponentCallbacks2 {
    private val context = context.applicationContext
    private val activities = this.context.getSystemService(ActivityManager::class.java)

    @Volatile
    private var stream: Stream? = null

    @Volatile
    private var playerBufferedUs = 0L

    @Volatile
    private var playerPlaying = false

    /** Megabytes the cache may hold from the next file, or 0 to size it from the device's memory. */
    @Volatile
    var limitMb = 0

    /** Memory stays short with the cache already at its least. */
    @Volatile
    var onMemoryShort: (() -> Unit)? = null

    val factory = DataSource.Factory { CachedDataSource() }

    init {
        this.context.registerComponentCallbacks(this)
    }

    fun play(url: String?) {
        stream?.close()
        stream = url?.let(Uri::parse)?.takeIf(::cacheable)?.let { Stream(it, budget(), aheadCap()) }
    }

    fun setDurationUs(us: Long) {
        stream?.setDurationUs(us)
    }

    /**
     * Byte ranges the page skips, which aren't fetched unless the player opens
     * inside one or runs short before the page skips it, and the starts of what
     * follows those it offers to skip, fetched early once the link can spare it.
     */
    fun setSkips(held: List<LongRange>, landings: List<LongRange>) {
        stream?.setSkips(held, landings)
    }

    /** What the player holds past where it plays, which side fetches and held skips go by. */
    fun setPlayer(bufferedUs: Long, playing: Boolean) {
        playerBufferedUs = bufferedUs
        playerPlaying = playing
    }

    /** Whether the link can fetch this many bytes besides the file without playback running short. */
    fun canSpare(bytes: Long) = stream?.canSpare(bytes) == true

    /** Bytes the extractor skips unread, which it gets without their being fetched. */
    fun skipping(uri: Uri, position: Long, length: Long) {
        stream?.takeIf { it.uri == uri }?.discard(position until position + length)
    }

    val caching get() = stream != null

    /** The playing time held ahead of where the player reads. */
    fun aheadUs(): Long = stream?.aheadUs() ?: 0

    /** How many times faster than the file plays the link delivers it, NaN until known. */
    fun ratio(): Double = stream?.ratio() ?: Double.NaN

    fun stats(): Map<String, Number> = stream?.stats().orEmpty()

    fun release() {
        play(null)
        context.unregisterComponentCallbacks(this)
    }

    private fun retire(source: DataSource?) {
        if (source != null) closer.execute { source.closeQuietly() }
    }

    @Suppress("DEPRECATION")
    override fun onTrimMemory(level: Int) {
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) stream?.shrink()
    }

    override fun onLowMemory() {
        stream?.shrink()
    }

    /** Android no longer warns an app in front as memory runs out. */
    private fun memoryShort(): Boolean {
        val memory = ActivityManager.MemoryInfo().also(activities::getMemoryInfo)
        return memory.lowMemory || memory.availMem < memory.threshold + memory.threshold / 2
    }

    override fun onConfigurationChanged(newConfig: Configuration) = Unit

    /** Single files over HTTP; streaming formats fetch in pieces of their own. */
    private fun cacheable(uri: Uri) =
        (uri.scheme == "http" || uri.scheme == "https") && Util.inferContentType(uri) == C.CONTENT_TYPE_OTHER

    private fun budget() = CacheBudget.bytes(context, limitMb) / BLOCK * BLOCK

    /** Mobile data reads only a little ahead, in case the file is left. */
    private fun aheadCap(): Long {
        val metered = context.getSystemService(ConnectivityManager::class.java)?.isActiveNetworkMetered ?: false
        return if (metered) METERED_AHEAD_BYTES else Long.MAX_VALUE
    }

    /** Bytes a second the link delivers while it's read without pause, averaged over the last few seconds. */
    private class LinkMeter {
        var speed = 0.0
            private set
        private var bytes = 0L
        private var ns = 0L
        private var lastNs = 0L

        /** The next read follows a wait, which isn't the link's time. */
        fun pause() {
            lastNs = 0
        }

        fun add(count: Int) {
            val now = SystemClock.elapsedRealtimeNanos()
            if (lastNs != 0L) {
                bytes += count
                ns += now - lastNs
                if (ns >= SAMPLE_NS) {
                    val sample = bytes * 1e9 / ns
                    speed = if (speed == 0.0) sample else speed * 0.7 + sample * 0.3
                    bytes = 0
                    ns = 0
                }
            }
            lastNs = now
        }
    }

    /**
     * The held bytes, in native blocks that each hold one unbroken stretch. Its
     * owner's lock guards it, and it frees its memory itself, as the garbage
     * collector would only free it with the buffers.
     */
    private class Blocks {
        private class Block(val data: ByteBuffer) {
            var start = 0
            var end = 0
        }

        private val blocks = TreeMap<Long, Block>()
        private val spare = ArrayDeque<ByteBuffer>()

        val count get() = blocks.size
        val first: Long? get() = blocks.firstEntry()?.key
        val last: Long? get() = blocks.lastEntry()?.key

        /** Copies what's held from [position] in its block, 0 when nothing is. */
        fun read(position: Long, target: ByteArray, offset: Int, count: Int): Int {
            val block = blocks[position / BLOCK] ?: return 0
            val inner = (position % BLOCK).toInt()
            if (inner < block.start || inner >= block.end) return 0
            val n = min(count, block.end - inner)
            block.data.position(inner)
            block.data.get(target, offset, n)
            return n
        }

        /** Where the bytes held from [position] stop, jumping the stretches [skip] gives. */
        fun end(position: Long, skip: (Long) -> LongRange?): Long {
            var p = position
            while (true) {
                skip(p)?.let {
                    p = it.last + 1
                    continue
                }
                val block = blocks[p / BLOCK] ?: return p
                val inner = (p % BLOCK).toInt()
                if (inner < block.start || inner >= block.end) return p
                p += block.end - inner
                if (block.end < BLOCK) return p
            }
        }

        /**
         * Stores bytes, taking a new block once [room] makes space for it; true
         * when a block's earlier stretch was dropped for them.
         */
        fun write(position: Long, source: ByteArray, count: Int, room: (Long) -> Boolean): Boolean {
            var dropped = false
            var p = position
            var offset = 0
            while (offset < count) {
                val index = p / BLOCK
                val inner = (p % BLOCK).toInt()
                val block = blocks[index] ?: take(index, room) ?: return dropped
                if (inner < block.start || inner > block.end) {
                    dropped = dropped || block.end > block.start
                    block.start = inner
                    block.end = inner
                }
                val n = min(count - offset, BLOCK - inner)
                block.data.position(inner)
                block.data.put(source, offset, n)
                block.end = max(block.end, inner + n)
                p += n
                offset += n
            }
            return dropped
        }

        fun drop(index: Long) {
            val block = blocks.remove(index) ?: return
            if (spare.size < SPARE_BLOCKS) spare.addLast(block.data) else nativeFree(block.data)
        }

        fun free() {
            for (block in blocks.values) nativeFree(block.data)
            for (data in spare) nativeFree(data)
            blocks.clear()
            spare.clear()
        }

        private fun take(index: Long, room: (Long) -> Boolean): Block? {
            if (!room(index)) return null
            val data = spare.removeFirstOrNull() ?: nativeAllocate(BLOCK) ?: return null
            return Block(data).also { blocks[index] = it }
        }
    }

    private inner class Stream(val uri: Uri, private var budget: Long, private val aheadCap: Long) {
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

        private val meter = LinkMeter()
        private var connectNs = 0.0

        /** Where the link redirected, which later requests go to directly. */
        private var resolved: Uri? = null

        /** Connections waiting on the link, since when. */
        private val waiting = ConcurrentHashMap<DataSource, Long>()

        init {
            Thread(::fetch, "stream-cache").apply { isDaemon = true }.start()
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

        /** Twice the link's time for the bytes, as its speed may drop meanwhile, and a margin. */
        fun canSpare(bytes: Long): Boolean = lock.withLock {
            val speed = meter.speed.takeIf { it > 0 } ?: return false
            playerBufferedUs + aheadUs() >= 2 * (bytes / speed * 1_000_000).toLong() + SPARE_MARGIN_US
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
                if (skip != null && !(playerPlaying && playerBufferedUs < RELEASE_US)) {
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

        private fun fetch() {
            val scratch = ByteArray(CHUNK)
            var source: DataSource? = null
            // Where the open connection reads next.
            var at = 0L
            var failures = 0
            while (true) {
                val from = lock.withLock { next(source?.let { at }) } ?: break
                if (waited) meter.pause()
                try {
                    if (source == null || at != from) {
                        retire(source)
                        source = null
                        source = connect(from)
                        at = from
                        meter.pause()
                    }
                    val n = watched(source) { source.read(scratch, 0, CHUNK) }
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
                        meter.add(n)
                        write(at, scratch, n)
                    }
                    at += n
                    failures = 0
                    if (!indexChecked) checkIndex()
                } catch (e: Exception) {
                    retire(source)
                    source = null
                    if (closed) break
                    failures++
                    Log.w(TAG, "fetch failed ($failures)", e)
                    val retry = e !is HttpDataSource.InvalidResponseCodeException && failures <= RETRIES
                    lock.withLock {
                        if (retry) {
                            changed.awaitNanos(RETRY_NS shl (failures - 1))
                        } else {
                            // A connection closed under its read can fail as other than an IOException.
                            failure = e as? IOException ?: IOException(e)
                            failures = 0
                            changed.signalAll()
                        }
                    }
                }
            }
            retire(source)
        }

        /** Where to fetch next, after waiting while enough is ahead; null once closed. */
        private fun next(at: Long?): Long? {
            waited = false
            while (!closed) {
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
                val held = min(blocks.end(0) { null }, HEAD_BYTES.toLong()).toInt()
                if (held < MIN_HEAD_BYTES && held.toLong() != length) return
                ByteArray(held).also { blocks.read(0, it, 0, held) }
            }
            val range = FileIndex.locate(head, lock.withLock { length })
            if (range != null || head.size >= HEAD_BYTES) indexChecked = true
            range?.takeIf { it.first >= MAX_REOPEN_GAP }?.let(::prefetch)
        }

        private fun prefetch(range: LongRange) {
            if (lock.withLock { blocks.end(range.first) { null } > range.first }) return
            fetchSide(range, "stream-cache-index")
        }

        /** Fetches the next landing ahead of the reader once the link can spare it. */
        private fun fetchLanding() {
            val range = lock.withLock {
                val landing = landings.firstOrNull { it.last >= readAt } ?: return
                if (side != null || landing.first <= aheadEnd()) return
                val from = blocks.end(landing.first) { null }
                if (from > landing.last || !canSpare(landing.last + 1 - from)) return
                from..landing.last
            }
            fetchSide(range, "stream-cache-landing")
        }

        /** Bytes held of the next landing beyond what the reader reads on to. */
        private fun landingBytes(): Long {
            val landing = landings.firstOrNull { it.first > readAt } ?: return 0
            if (landing.first <= aheadEnd()) return 0
            return min(blocks.end(landing.first) { null }, landing.last + 1) - landing.first
        }

        private fun fetchSide(range: LongRange, name: String) {
            lock.withLock {
                if (side != null) return
                side = range
            }
            Thread({ readSide(range) }, name).apply { isDaemon = true }.start()
        }

        private fun readSide(range: LongRange) {
            val scratch = ByteArray(CHUNK)
            var source: DataSource? = null
            try {
                source = connect(range.first)
                var at = range.first
                while (at <= range.last && !closed) {
                    val n = watched(source) { source.read(scratch, 0, min(CHUNK.toLong(), range.last + 1 - at).toInt()) }
                    if (n == C.RESULT_END_OF_INPUT) break
                    lock.withLock { write(at, scratch, n) }
                    at += n
                }
            } catch (e: Exception) {
                // The main connection fetches what the extractor reads.
                Log.w(TAG, "side fetch failed", e)
            } finally {
                retire(source)
                lock.withLock {
                    side = null
                    changed.signalAll()
                }
            }
        }

        private inline fun <T> watched(source: DataSource, call: () -> T): T {
            waiting[source] = SystemClock.elapsedRealtimeNanos()
            try {
                return call()
            } finally {
                waiting.remove(source)
            }
        }

        /** Closes a connection that waits too long on the link, which fails its call, starts landings, and shrinks the cache as memory runs short. */
        private fun watch() {
            var ticks = 0
            while (!closed) {
                SystemClock.sleep(WATCH_MS)
                fetchLanding()
                if (++ticks % MEMORY_TICKS == 0 && memoryShort() && !shrink()) onMemoryShort?.invoke()
                val now = SystemClock.elapsedRealtimeNanos()
                for ((source, since) in waiting) {
                    if (now - since < STALL_NS || waiting.remove(source) == null) continue
                    Log.w(TAG, "the link stalled")
                    source.closeQuietly()
                }
            }
        }

        private fun connect(from: Long): DataSource {
            val source = link.createDataSource()
            val target = lock.withLock { resolved } ?: uri
            val startNs = SystemClock.elapsedRealtimeNanos()
            val opened = try {
                watched(source) { source.open(DataSpec.Builder().setUri(target).setPosition(from).build()) }
            } catch (e: IOException) {
                source.closeQuietly()
                // A redirect's link may expire; the original one makes a new one.
                if (target != uri) {
                    lock.withLock { resolved = null }
                    return connect(from)
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

        /** Frees the block least likely to be read: played ones past what's kept, other runs, then the far ends, but not the next landing. */
        private fun evict(writing: Long): Boolean {
            val first = blocks.first ?: return false
            val last = blocks.last ?: return false
            val reading = readAt / BLOCK
            val runEnd = (aheadEnd() - 1) / BLOCK
            val keepBehind = budget / 4 / BLOCK
            val landing = landings.firstOrNull { it.first > readAt }?.let { it.first / BLOCK..it.last / BLOCK } ?: LongRange.EMPTY
            val victim = listOf(
                first.takeIf { it < reading - keepBehind },
                last.takeIf { it > runEnd },
                first.takeIf { it < reading },
                last,
            ).firstOrNull { it != null && it != writing && it != reading && it !in landing } ?: return false
            blocks.drop(victim)
            if (victim in reading..runEnd) runHint = -1
            return true
        }
    }

    /** The cache for the file playing, the link itself for anything else. */
    private inner class CachedDataSource : BaseDataSource(true) {
        private var cached: Stream? = null
        private var direct: DataSource? = null
        private var spec: DataSpec? = null
        private var position = 0L
        private var remaining = C.LENGTH_UNSET.toLong()

        override fun open(dataSpec: DataSpec): Long {
            spec = dataSpec
            val current = stream?.takeIf { it.uri == dataSpec.uri }
            if (current == null) {
                transferInitializing(dataSpec)
                val source = upstream.createDataSource()
                direct = source
                val opened = source.open(dataSpec)
                transferStarted(dataSpec)
                return opened
            }
            cached = current
            position = dataSpec.position
            val total = current.open(position)
            remaining = when {
                dataSpec.length != C.LENGTH_UNSET.toLong() -> dataSpec.length
                total != C.LENGTH_UNSET.toLong() -> total
                else -> C.LENGTH_UNSET.toLong()
            }
            return remaining
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (length == 0) return 0
            direct?.let { source ->
                val n = source.read(buffer, offset, length)
                if (n > 0) bytesTransferred(n)
                return n
            }
            val current = cached ?: throw IOException("not open")
            if (remaining == 0L) return C.RESULT_END_OF_INPUT
            val wanted = if (remaining == C.LENGTH_UNSET.toLong()) length else min(length.toLong(), remaining).toInt()
            val n = current.read(position, buffer, offset, wanted)
            if (n > 0) {
                position += n
                if (remaining != C.LENGTH_UNSET.toLong()) remaining -= n
            }
            return n
        }

        override fun getUri(): Uri? = direct?.uri ?: spec?.uri

        override fun getResponseHeaders(): Map<String, List<String>> = direct?.responseHeaders.orEmpty()

        override fun close() {
            cached = null
            spec = null
            val source = direct ?: return
            direct = null
            try {
                source.close()
            } finally {
                transferEnded()
            }
        }
    }

    private companion object {
        init {
            System.loadLibrary("aiostreams_stream_cache")
        }

        const val TAG = "stream-cache"
        const val BLOCK = 1 shl 20
        const val CHUNK = 64 * 1024
        const val HEAD_BYTES = 64 * 1024
        const val MIN_HEAD_BYTES = 4 * 1024
        const val MIN_BYTES = 32L shl 20
        const val MIN_AHEAD_BYTES = 8L shl 20
        const val MIN_REFILL_BYTES = 8L shl 20
        const val METERED_AHEAD_BYTES = 48L shl 20
        const val AHEAD_MAX_SECONDS = 300
        const val MIN_REOPEN_GAP = 2L shl 20
        const val MAX_REOPEN_GAP = 32L shl 20
        const val SAMPLE_NS = 500_000_000L
        const val RETRIES = 5
        const val RETRY_NS = 500_000_000L
        const val WATCH_MS = 1000L
        const val MEMORY_TICKS = 5
        const val STALL_NS = 8_000_000_000L
        const val SPARE_BLOCKS = 4
        const val LANDING_SHARE = 8
        const val SPARE_MARGIN_US = 4_000_000L
        const val RELEASE_US = 1_000_000L
        const val HELD_POLL_NS = 100_000_000L

        // Closing a connection with bytes left drains it for a while first, which a fetch shouldn't wait for.
        // Never shut down, as a fetch thread can retire its connection after a release.
        val closer = ThreadPoolExecutor(0, 1, 10, TimeUnit.SECONDS, LinkedBlockingQueue()) {
            Thread(it, "stream-cache-close").apply { isDaemon = true }
        }

        fun DataSource.closeQuietly() {
            runCatching { close() }
        }

        @JvmStatic
        external fun nativeAllocate(size: Int): ByteBuffer?

        @JvmStatic
        external fun nativeFree(buffer: ByteBuffer)
    }
}
