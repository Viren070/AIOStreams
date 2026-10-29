package io.github.viren070.aiostreams.exoplayer.cache

import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.net.ConnectivityManager
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import io.github.viren070.aiostreams.playback.CacheBudget
import java.io.IOException
import kotlin.math.min

internal class PlayerBuffer {
    @Volatile
    var bufferedUs = 0L

    @Volatile
    var playing = false

    val runningDry get() = playing && bufferedUs < 1_000_000L
}

/** Android no longer warns an app in front as memory runs out. */
internal class Memory(context: Context) {
    private val activities = context.getSystemService(ActivityManager::class.java)

    @Volatile
    var onShort: (() -> Unit)? = null

    fun short(): Boolean {
        val memory = ActivityManager.MemoryInfo().also(activities::getMemoryInfo)
        return memory.lowMemory || memory.availMem < memory.threshold + memory.threshold / 2
    }
}

/**
 * The playing file's bytes around where the player reads, in native memory and
 * fetched ahead on one connection, so seeks inside it, track changes and the
 * extractor's jumps read memory instead of opening the link again. [link]
 * opens the cache's own connections without a read timeout, as one costs a
 * wakeup per read: the cache leaves a stalled one and fetches on another.
 */
@OptIn(UnstableApi::class)
internal class StreamCache(
    context: Context,
    private val upstream: DataSource.Factory,
    private val link: DataSource.Factory,
) : ComponentCallbacks2 {
    private val context = context.applicationContext
    private val player = PlayerBuffer()
    private val memory = Memory(this.context)

    @Volatile
    private var stream: Stream? = null

    /** Megabytes the cache may hold from the next file, or 0 to size it from the device's memory. */
    @Volatile
    var limitMb = 0

    /** Memory stays short with the cache already at its least. */
    var onMemoryShort by memory::onShort

    val factory = DataSource.Factory { CachedDataSource() }

    val caching get() = stream != null

    init {
        this.context.registerComponentCallbacks(this)
    }

    fun play(url: String?) {
        stream?.close()
        stream = url?.let(Uri::parse)?.takeIf(::cacheable)?.let { Stream(it, link, player, memory, budget(), aheadCap()) }
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
        player.bufferedUs = bufferedUs
        player.playing = playing
    }

    /** Whether the link can fetch this many bytes besides the file without playback running short. */
    fun canSpare(bytes: Long) = stream?.canSpare(bytes) == true

    /** Bytes the extractor skips unread, which it gets without their being fetched. */
    fun skipping(uri: Uri, position: Long, length: Long) {
        stream?.takeIf { it.uri == uri }?.discard(position until position + length)
    }

    /** The playing time held ahead of where the player reads. */
    fun aheadUs(): Long = stream?.aheadUs() ?: 0

    /** How many times faster than the file plays the link delivers it, NaN until known. */
    fun ratio(): Double = stream?.ratio() ?: Double.NaN

    fun held(): HeldBytes? = stream?.held()

    fun stats(): Map<String, Number> = stream?.stats().orEmpty()

    fun release() {
        play(null)
        context.unregisterComponentCallbacks(this)
    }

    @Suppress("DEPRECATION")
    override fun onTrimMemory(level: Int) {
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) stream?.shrink()
    }

    override fun onLowMemory() {
        stream?.shrink()
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
        const val METERED_AHEAD_BYTES = 48L shl 20
    }
}
