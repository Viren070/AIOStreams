package io.github.viren070.aiostreams.exoplayer

import android.content.Context
import android.graphics.PixelFormat
import android.graphics.Rect
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.Surface
import android.view.SurfaceHolder
import android.util.Log
import android.view.SurfaceView
import java.io.File
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.roundToInt
import kotlin.math.sqrt
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Where the video sits on the stage, and the page's `sub-*` options for ASS. */
internal data class AssLayout(
    val stageWidth: Int = 0,
    val stageHeight: Int = 0,
    val video: Rect = Rect(),
    val videoWidth: Int = 0,
    val videoHeight: Int = 0,
    val scale: Double = 1.0,
    /** mpv's `sub-pos`. */
    val position: Double = 100.0,
    val forceMargins: Boolean = false,
    val style: AssStyle = AssStyle(),
)

/** mpv's `sub-ass-override`, and the look it forces on dialogue. Colours are ASS's RGBA. */
internal data class AssStyle(
    val override: Int = SCALE,
    val color: Int = 0xFFFFFF00.toInt(),
    val outlineColor: Int = 0x00000000,
    val backColor: Int = 0x00000050,
    val outlineSize: Double = 1.65,
    val borderStyle: Int = 1,
    val bold: Boolean = false,
) {
    companion object {
        const val NONE = 0
        const val SCALE = 1
        const val FORCE = 2
    }
}

/**
 * libass, drawing ASS into a surface of its own between the video and the
 * page, which the compositor lays over the video without the app drawing. One
 * thread owns libass; the file's reader only queues what it finds for it.
 */
internal class AssSurface(context: Context, font: () -> File) : SurfaceHolder.Callback {
    val view = SurfaceView(context).apply {
        setZOrderMediaOverlay(true)
        holder.setFormat(PixelFormat.TRANSLUCENT)
        holder.addCallback(this@AssSurface)
    }

    private val thread = HandlerThread("ass").apply { start() }
    private val worker = Handler(thread.looper)
    private val queued = ConcurrentLinkedQueue<Runnable>()
    private val waiting = AtomicInteger()
    private val scheduled = AtomicBoolean(false)
    private val frames = AtomicLong()
    private val late = AtomicLong()
    private val renders = Timings()
    private val blends = Timings()

    /** Counts files, so a file's reader can't reach the next one's tracks. */
    @Volatile
    private var file = 0

    @Volatile
    private var timeUs = 0L

    @Volatile
    private var atNanos = 0L

    // Touched on the worker only.
    private var native = 0L
    private val tracks = HashMap<String, Long>()
    private var shown: String? = null
    private var surface: Surface? = null
    private var width = 0
    private var height = 0
    private var layout = AssLayout()
    private var drawn = 0L

    init {
        worker.post {
            native = nativeCreate(font().path)
            if (native == 0L) Log.e(TAG, "libass is missing from libmpv")
        }
    }

    /** The reader's way in for the file opening now. */
    fun sink(): AssSink {
        val opened = file
        return object : AssSink {
            override fun font(name: String, data: ByteArray) = queue(opened) { nativeAddFont(native, name, data) }

            override fun header(track: String, header: ByteArray) = queue(opened) {
                tracks.getOrPut(track) { nativeNewTrack(native, header) }
            }

            override fun line(track: String, startMs: Long, durationMs: Long, line: ByteArray) = queue(opened) {
                tracks[track]?.let { nativeAddLine(it, line, startMs, durationMs) }
            }
        }
    }

    /** Lets go of the last file's tracks and fonts, before the next file's reader queues its own. */
    fun reset() {
        file++
        queue {
            freeTracks()
            nativeClearFonts(native)
            shown = null
            redraw()
        }
    }

    /** A whole script from outside the file, which [select] shows as `key`. */
    fun addScript(key: String, script: ByteArray) = queue {
        tracks.remove(key)?.let(::nativeFreeTrack)
        tracks[key] = nativeReadScript(native, script)
    }

    fun removeScript(key: String) = queue {
        if (shown == key) shown = null
        tracks.remove(key)?.let(::nativeFreeTrack)
        redraw()
    }

    /** Shows the file's track or the script with `key`, or nothing. */
    fun select(key: String?) = queue {
        shown = key
        redraw()
    }

    /** Draws what shows at `timeUs` of the script, for the frame the screen shows at `atNanos`. */
    fun render(timeUs: Long, atNanos: Long) {
        this.timeUs = timeUs
        this.atNanos = atNanos
        frames.incrementAndGet()
        if (scheduled.compareAndSet(false, true)) worker.post(draw)
    }

    /** Draws the last moment again, as something other than time changed. */
    fun invalidate() {
        atNanos = 0
        redraw()
    }

    fun setLayout(layout: AssLayout) = worker.post {
        this.layout = layout
        applyLayout()
        draw(force = true)
    }

    fun stats() = buildJsonObject {
        put("subtitleFrames", frames.get())
        put("latePosts", late.get())
        for ((key, value) in renders.stats()) put(key, value)
        for ((key, value) in blends.stats()) put("blend" + key.replaceFirstChar(Char::uppercase), value)
    }

    override fun surfaceCreated(holder: SurfaceHolder) {}

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        // The compositor scales a smaller buffer up for free.
        val scale = sqrt(MAX_PIXELS.toDouble() / (width.toLong() * height)).coerceAtMost(1.0)
        worker.post {
            if (native == 0L) return@post
            surface = holder.surface
            this.width = (width * scale).roundToInt()
            this.height = (height * scale).roundToInt()
            nativeSetWindow(native, surface, this.width, this.height)
            applyLayout()
            draw(force = true)
        }
    }

    // The surface is gone once this returns, so the window has to be let go of first.
    override fun surfaceDestroyed(holder: SurfaceHolder) {
        val done = CountDownLatch(1)
        worker.post {
            surface = null
            if (native != 0L) nativeSetWindow(native, null, 0, 0)
            done.countDown()
        }
        done.await(2, TimeUnit.SECONDS)
    }

    fun release() = worker.post {
        freeTracks()
        nativeRelease(native)
        native = 0L
        thread.quitSafely()
    }

    private fun queue(opened: Int, change: () -> Unit) = queue { if (opened == file) change() }

    private fun queue(change: Runnable) {
        queued += change
        if (waiting.getAndIncrement() == 0) worker.post(::apply)
    }

    private fun freeTracks() {
        tracks.values.forEach(::nativeFreeTrack)
        tracks.clear()
    }

    private fun apply() {
        if (native == 0L) return
        while (true) {
            val change = queued.poll() ?: return
            waiting.decrementAndGet()
            change.run()
        }
    }

    private val draw = Runnable {
        scheduled.set(false)
        draw(force = false)
    }

    private fun redraw() {
        worker.post { draw(force = true) }
    }

    private fun draw(force: Boolean) {
        apply()
        if (native == 0L || surface == null) return
        val track = shown?.let(tracks::get) ?: 0L
        val start = System.nanoTime()
        val changed = nativeRender(native, track, timeUs / 1000, force || track != drawn)
        drawn = track
        if (!changed) return
        val rendered = System.nanoTime()
        if (!nativeDraw(native)) return
        val now = System.nanoTime()
        renders.add(rendered - start)
        blends.add(now - rendered)
        // Posted a refresh ahead of the video frame, so both show together.
        val wait = atNanos - now - REFRESH_NANOS
        if (wait > 0) SystemClock.sleep(wait / 1_000_000)
        else if (atNanos != 0L && wait < -REFRESH_NANOS) late.incrementAndGet()
        nativePost(native)
    }

    // mpv's configure_ass(): its own options reach ASS only as far as the override allows.
    private fun applyLayout() {
        val stage = layout
        if (native == 0L || stage.stageWidth == 0 || width == 0) return
        val sx = width.toDouble() / stage.stageWidth
        val sy = height.toDouble() / stage.stageHeight
        val style = stage.style
        val force = style.override == AssStyle.FORCE
        val useMargins = force || stage.forceMargins
        var fontScale = if (style.override == AssStyle.NONE) 1.0 else stage.scale
        if (force) {
            // Sized to the screen rather than the video, as mpv's sub-scale-with-window does.
            val videoWidth = stage.video.width() * sx
            val videoHeight = stage.video.height() * sy
            if (videoWidth >= 1) fontScale *= height / minOf(height.toDouble(), width / videoWidth * videoHeight)
        }
        nativeSetLayout(
            native, stage.videoWidth, stage.videoHeight,
            (stage.video.top * sy).roundToInt(), ((stage.stageHeight - stage.video.bottom) * sy).roundToInt(),
            (stage.video.left * sx).roundToInt(), ((stage.stageWidth - stage.video.right) * sx).roundToInt(),
            useMargins, fontScale.toFloat(), if (style.override == AssStyle.NONE) 0.0 else 100 - stage.position,
        )
        nativeSetStyle(
            native, style.override, style.color, style.outlineColor, style.backColor,
            style.outlineSize, style.borderStyle, style.bold,
        )
    }

    private companion object {
        init {
            System.loadLibrary("aiostreams_ass")
        }

        const val TAG = "ass"

        /** A 1080p picture: subtitles drawn larger only cost more to blend. */
        const val MAX_PIXELS = 1920 * 1080
        const val REFRESH_NANOS = 8_000_000L

        @JvmStatic
        external fun nativeCreate(font: String): Long

        @JvmStatic
        external fun nativeAddFont(handle: Long, name: String, data: ByteArray)

        @JvmStatic
        external fun nativeClearFonts(handle: Long)

        @JvmStatic
        external fun nativeNewTrack(handle: Long, header: ByteArray): Long

        @JvmStatic
        external fun nativeReadScript(handle: Long, script: ByteArray): Long

        @JvmStatic
        external fun nativeAddLine(track: Long, line: ByteArray, startMs: Long, durationMs: Long)

        @JvmStatic
        external fun nativeFreeTrack(track: Long)

        @JvmStatic
        external fun nativeSetWindow(handle: Long, surface: Surface?, width: Int, height: Int)

        @JvmStatic
        external fun nativeSetLayout(
            handle: Long, videoWidth: Int, videoHeight: Int, top: Int, bottom: Int, left: Int, right: Int,
            useMargins: Boolean, fontScale: Float, linePosition: Double,
        )

        @JvmStatic
        external fun nativeSetStyle(
            handle: Long, override: Int, color: Int, outlineColor: Int, backColor: Int,
            outlineSize: Double, borderStyle: Int, bold: Boolean,
        )

        @JvmStatic
        external fun nativeRender(handle: Long, track: Long, timeMs: Long, force: Boolean): Boolean

        @JvmStatic
        external fun nativeDraw(handle: Long): Boolean

        @JvmStatic
        external fun nativePost(handle: Long)

        @JvmStatic
        external fun nativeRelease(handle: Long)
    }
}

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
