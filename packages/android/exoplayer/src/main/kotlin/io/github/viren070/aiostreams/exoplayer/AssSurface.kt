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
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import java.io.File
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
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
    val shadowSize: Double = 0.0,
    /** Drawn in place of the bundled font where the style is forced; null keeps it. */
    val fontFile: String? = null,
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
 * thread owns libass and renders the moments of the video frames [frames] has
 * read ahead of time, so a costly one is ready when its frame shows; another
 * shows each frame's moment. The file's reader only queues what it finds for
 * libass's thread.
 */
@OptIn(UnstableApi::class)
internal class AssSurface(context: Context, private val frames: VideoFrames, font: () -> File) : SurfaceHolder.Callback {
    val view = SurfaceView(context).apply {
        setZOrderMediaOverlay(true)
        holder.setFormat(PixelFormat.TRANSLUCENT)
        holder.addCallback(this@AssSurface)
    }

    private val rendering = HandlerThread("ass").apply { start() }
    private val worker = Handler(rendering.looper)
    private val showing = HandlerThread("ass-show").apply { start() }
    private val shower = Handler(showing.looper)
    private val queued = ConcurrentLinkedQueue<Runnable>()
    private val scheduled = AtomicBoolean(false)
    private val stepping = AtomicBoolean(false)
    private val frameCount = AtomicLong()
    private val late = AtomicLong()
    private val missed = AtomicLong()
    private val skipped = AtomicLong()
    private val renders = Timings()
    private val blends = Timings()

    /** Counts files, so a file's reader can't reach the next one's tracks. */
    @Volatile
    private var file = 0

    @Volatile
    private var native = 0L

    /** The video frame showing, and when the screen shows it. */
    @Volatile
    private var frameUs = 0L

    @Volatile
    private var atNanos = 0L

    /** A moment the showing thread waits for, in the subtitles' milliseconds. */
    private val asked = AtomicLong(NONE)

    /** Whether a track shows, so frames need their moments; libass's thread sets it. */
    @Volatile
    private var active = false

    /** The subtitles' delay behind the video. */
    @Volatile
    var delayUs = 0L
        set(value) {
            field = value
            invalidate()
        }

    // Touched on libass's thread only.
    private val tracks = HashMap<String, Long>()
    private val scripts = HashSet<String>()
    private var shown: String? = null

    /** Tracks made from text, which take the user's look whole. */
    private val converted = HashSet<String>()
    private val parsers = HashMap<String, SampleParser>()
    private val readOrders = HashMap<String, Int>()
    private val seen = HashMap<String, HashSet<String>>()

    /** The style the renderer has; null for a new renderer. */
    private var styled: Pair<AssStyle, Boolean>? = null

    private var movedAt = 0L

    /** Each file track's latest lines, which libass gets once the track shows; it holds only the shown one's. */
    private val recent = HashMap<String, ArrayDeque<Line>>()

    /** The file's fonts, those libass has, and the names each track's styles and lines ask for. */
    private var fonts: List<FontFile> = emptyList()
    private val given = HashSet<File>()
    private val wanted = HashMap<String, MutableSet<String>>()
    private var width = 0
    private var height = 0
    private var layout = AssLayout()

    /** The last video frame rendered ahead, and the most the moments ahead may take. */
    private var aheadUs = Long.MIN_VALUE
    private var aheadBytes = AHEAD_BYTES

    /** Something other than time changed what shows: what's rendered ahead goes. */
    private var stale = false

    // Touched on the showing thread only.
    private var window: Surface? = null
    private var windowWidth = 0
    private var windowHeight = 0
    private var mustDraw = false
    private var shownMs = NONE

    init {
        worker.post {
            native = nativeCreate(font().path)
            if (native == 0L) Log.e(TAG, "libass.so can't be loaded")
            // The surface may have come first.
            shower.post(::attachWindow)
        }
    }

    /** The reader's way in for the file opening now. */
    fun sink(): AssSink {
        val opened = file
        return object : AssSink {
            override fun fonts(fonts: List<FontFile>) = queue(opened) {
                this@AssSurface.fonts = fonts
                if (giveFonts()) stale = true
            }

            override fun header(track: String, header: ByteArray) = queue(opened) {
                tracks.getOrPut(track) { nativeNewTrack(native, header) }
                wanted.getOrPut(track) { HashSet() } += styleFonts(header)
                if (track == shown && giveFonts()) stale = true
            }

            override fun line(track: String, startMs: Long, durationMs: Long, line: ByteArray) = queue(opened) {
                addLine(track, Line(startMs, durationMs, line))
                // What's rendered from the line's start went in linesFrom(), so its own fonts need no wipe.
                if (overrideFonts(line, wanted.getOrPut(track) { HashSet() }) && track == shown) giveFonts()
            }
        }
    }

    /** The reader's way in for text subtitles, which become ASS as they arrive. */
    fun textSink(): TextSink {
        val opened = file
        return object : TextSink {
            override fun track(track: String, parser: SampleParser) = queue(opened) {
                tracks.getOrPut(track) { nativeNewTrack(native, AssText.header) }
                parsers[track] = parser
                // Picked before the reader reached it, it showed without the forced look.
                if (converted.add(track) && track == shown) {
                    applyLayout()
                    stale = true
                }
            }

            override fun sample(track: String, timeUs: Long, data: ByteArray) = queue(opened) {
                val parser = parsers[track] ?: return@queue
                val seen = seen.getOrPut(track) { HashSet() }
                runCatching { parser.parse(timeUs, data) { cues ->
                    if (cues.durationUs == C.TIME_UNSET) return@parse
                    val startMs = cues.startTimeUs / 1000
                    val durationMs = cues.durationUs / 1000
                    for (event in AssText.events(cues.cues)) {
                        // Reading a stretch again after a seek gives the same lines again.
                        if (!seen.add("$startMs $durationMs $event")) continue
                        val order = readOrders.merge(track, 1, Int::plus)!!
                        addLine(track, Line(startMs, durationMs, "$order,$event".toByteArray()))
                    }
                } }.onFailure { Log.w(TAG, "couldn't read a subtitle line", it) }
            }
        }
    }

    private fun addLine(track: String, line: Line) {
        val lines = recent.getOrPut(track) { ArrayDeque() }
        lines += line
        while (lines.isNotEmpty() && lines.first().endMs < frameUs / 1000 - KEPT_MS) lines.removeFirst()
        if (track == shown) tracks[track]?.let {
            nativeAddLine(it, line.bytes, line.startMs, line.durationMs)
            linesFrom(line.startMs)
        }
    }

    /** Lets go of the last file's tracks and fonts, before the next file's reader queues its own. */
    fun reset() {
        file++
        // The next file's lines arrive before its first frame, and are kept by its time.
        frameUs = 0
        atNanos = 0
        queue {
            freeTracks()
            nativeClearFonts(native)
            styled = null
            recent.clear()
            fonts = emptyList()
            given.clear()
            wanted.clear()
            parsers.clear()
            readOrders.clear()
            seen.clear()
            shown = null
            applyLayout()
            stale = true
        }
    }

    /** A whole script from outside the file, which [select] shows as `key`; `converted` from text. */
    fun addScript(key: String, script: ByteArray, converted: Boolean) = queue {
        tracks.remove(key)?.let(::nativeFreeTrack)
        tracks[key] = nativeReadScript(native, script)
        scripts += key
        if (converted) this.converted += key else this.converted -= key
        if (key == shown) {
            applyLayout()
            stale = true
        }
    }

    fun removeScript(key: String) = queue {
        if (shown == key) shown = null
        tracks.remove(key)?.let(::nativeFreeTrack)
        scripts -= key
        converted -= key
        stale = true
    }

    /** Shows the file's track or the script with `key`, or nothing. */
    fun select(key: String?) = queue {
        if (key != shown) {
            shown?.takeIf { it !in scripts }?.let(tracks::get)?.let(::nativeFlushTrack)
            tracks[key]?.let { track -> recent[key]?.forEach { nativeAddLine(track, it.bytes, it.startMs, it.durationMs) } }
        }
        val restyle = (key in converted) != (shown in converted)
        shown = key
        if (!giveFonts() && restyle) applyLayout()
        stale = true
    }

    /** Megabytes of drawn subtitles libass keeps, 0 for its own limit; what's rendered ahead keeps half as many. */
    fun setCacheLimit(mb: Int) = queue {
        nativeSetCacheLimit(native, mb)
        aheadBytes = if (mb > 0) (mb.toLong() shl 20) / 2 else AHEAD_BYTES
    }

    /** Shows the subtitles for the video frame at `frameUs`, which the screen shows at `atNanos`. */
    fun render(frameUs: Long, atNanos: Long) {
        this.frameUs = frameUs
        this.atNanos = atNanos
        frameCount.incrementAndGet()
        frames.trim(frameUs - KEPT_FRAMES_US)
        if (active && scheduled.compareAndSet(false, true)) shower.post(show)
    }

    /** Renders the moment showing again, as something other than time changed. */
    fun invalidate() {
        atNanos = 0
        queue { stale = true }
    }

    fun setLayout(layout: AssLayout) = queue {
        // Lifted above the page's controls, the position changes every display frame.
        if (layout.copy(position = this.layout.position) == this.layout) {
            movedAt = SystemClock.uptimeMillis()
            worker.removeCallbacks(settled)
            worker.postDelayed(settled, SETTLE_MS)
        }
        this.layout = layout
        applyLayout()
        stale = true
    }

    private val settled = Runnable { step() }

    fun stats() = buildJsonObject {
        put("subtitleFrames", frameCount.get())
        put("latePosts", late.get())
        put("missedMoments", missed.get())
        put("skippedMoments", skipped.get())
        for ((key, value) in renders.stats()) put(key, value)
        for ((key, value) in blends.stats()) put("blend" + key.replaceFirstChar(Char::uppercase), value)
    }

    override fun surfaceCreated(holder: SurfaceHolder) {}

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        // The compositor scales a smaller buffer up for free.
        val scale = sqrt(MAX_PIXELS.toDouble() / (width.toLong() * height)).coerceAtMost(1.0)
        val scaledWidth = (width * scale).roundToInt()
        val scaledHeight = (height * scale).roundToInt()
        shower.post {
            window = holder.surface
            windowWidth = scaledWidth
            windowHeight = scaledHeight
            attachWindow()
        }
        queue {
            this.width = scaledWidth
            this.height = scaledHeight
            nativeSetFrameSize(native, scaledWidth, scaledHeight)
            applyLayout()
            stale = true
        }
    }

    // The surface is gone once this returns, so the window has to be let go of first.
    override fun surfaceDestroyed(holder: SurfaceHolder) {
        val done = CountDownLatch(1)
        shower.post {
            window = null
            if (native != 0L) nativeSetWindow(native, null, 0, 0)
            done.countDown()
        }
        done.await(2, TimeUnit.SECONDS)
    }

    fun release() {
        shower.post {
            if (native != 0L) nativeSetWindow(native, null, 0, 0)
            showing.quitSafely()
        }
        worker.post {
            showing.join()
            freeTracks()
            nativeRelease(native)
            native = 0L
            rendering.quitSafely()
        }
    }

    private fun attachWindow() {
        if (native == 0L || window == null) return
        nativeSetWindow(native, window, windowWidth, windowHeight)
        mustDraw = true
    }

    private fun queue(opened: Int, change: () -> Unit) = queue { if (opened == file) change() }

    private fun queue(change: Runnable) {
        queued += change
        step(front = false)
    }

    private fun freeTracks() {
        tracks.values.forEach(::nativeFreeTrack)
        tracks.clear()
        scripts.clear()
        converted.clear()
    }

    /** Hands libass the fonts the shown track asks for; true when it had new ones. */
    private fun giveFonts(): Boolean {
        val names = shown?.let(wanted::get) ?: return false
        val giving = fonts.filter { font -> font.file !in given && font.names?.any(names::contains) != false }
        if (giving.isEmpty()) return false
        for (font in giving) {
            runCatching { nativeAddFont(native, font.file.name, font.file.readBytes()) }
                .onFailure { Log.w(TAG, "couldn't read ${font.file.name}", it) }
            given += font.file
        }
        nativeReloadFonts(native)
        styled = null
        applyLayout()
        return true
    }

    /** A line from `startMs` on changes the moments rendered for it. */
    private fun linesFrom(startMs: Long) {
        if (startMs <= momentMs(frameUs)) {
            stale = true
            return
        }
        nativeDropFrom(native, startMs)
        aheadUs = minOf(aheadUs, startMs * 1000 + delayUs - 1)
    }

    private fun apply() {
        while (true) queued.poll()?.run() ?: return
    }

    private val ahead = Runnable {
        stepping.set(false)
        step()
    }

    private val asap = Runnable { step() }

    /** Runs [step] on libass's thread soon, or before its other work when the showing thread waits. */
    private fun step(front: Boolean) {
        if (front) worker.postAtFrontOfQueue(asap)
        else if (stepping.compareAndSet(false, true)) worker.post(ahead)
    }

    /**
     * Applies what changed, renders a moment the showing thread asked for, then
     * the next frame's ahead if the queue has room.
     */
    private fun step() {
        if (native == 0L) return
        apply()
        val track = shown?.let(tracks::get) ?: 0L
        active = track != 0L
        val nowUs = frameUs
        if (stale) {
            stale = false
            nativeDropFrom(native, Long.MIN_VALUE)
            aheadUs = Long.MIN_VALUE
            queueMoment(track, momentMs(nowUs))
            shower.post { show(force = true) }
        }
        val asked = asked.getAndSet(NONE)
        if (asked != NONE) {
            // What was rendered ahead was elsewhere, as after a seek.
            queueMoment(track, asked)
            aheadUs = nowUs
        }
        // Moments rendered ahead would be thrown away at the next position.
        if (SystemClock.uptimeMillis() - movedAt < SETTLE_MS) return
        if (track == 0L || !nativeRoom(native, AHEAD_MOMENTS, aheadBytes)) return
        // Behind, from the frame showing, which the showing thread may not have taken yet.
        val next = frames.after(maxOf(aheadUs, nowUs - 1)) ?: return
        if (next - nowUs > AHEAD_US) return
        queueMoment(track, momentMs(next))
        aheadUs = next
        step(front = false)
    }

    private fun queueMoment(track: Long, ms: Long) {
        val start = System.nanoTime()
        nativeQueue(native, track, ms)
        renders.add(System.nanoTime() - start)
    }

    private fun momentMs(videoUs: Long) = (videoUs - delayUs) / 1000

    private val show = Runnable {
        scheduled.set(false)
        show(force = false)
    }

    /** Shows the moment of the frame showing, rendered ahead or asked for now. */
    private fun show(force: Boolean) {
        if (native == 0L || window == null) return
        val ms = momentMs(frameUs)
        // Tunneled, the frame showing comes from the clock, on every refresh.
        if (ms == shownMs && !force && !mustDraw) return
        var taken = nativeTake(native, ms, 0)
        if (taken < 0) {
            missed.incrementAndGet()
            asked.set(ms)
            step(front = true)
            taken = nativeTake(native, ms, ASK_WAIT_MS)
            // Rendered ahead meanwhile, it needn't be again.
            asked.compareAndSet(ms, NONE)
            if (taken < 0) {
                skipped.incrementAndGet()
                return
            }
        }
        shownMs = ms
        step(front = false)
        if (taken == 0 && !force && !mustDraw) return
        mustDraw = false
        // Something other than time changed: held for the next video frame, a slide would move by frames.
        val at = if (force) 0L else atNanos
        val start = System.nanoTime()
        if (!nativeDraw(native)) return
        val now = System.nanoTime()
        blends.add(now - start)
        if (nativeStamped(native)) {
            // The compositor holds it for the video frame's time.
            if (at != 0L && now > at) late.incrementAndGet()
        } else {
            // Posted a refresh ahead of the video frame, so both show together.
            val wait = at - now - REFRESH_NANOS
            if (wait > 0) SystemClock.sleep(wait / 1_000_000)
            else if (at != 0L && wait < -REFRESH_NANOS) late.incrementAndGet()
        }
        nativePost(native, at)
    }

    // mpv's configure_ass(): its own options reach ASS only as far as the override allows.
    private fun applyLayout() {
        val stage = layout
        if (native == 0L || stage.stageWidth == 0 || width == 0) return
        val sx = width.toDouble() / stage.stageWidth
        val sy = height.toDouble() / stage.stageHeight
        val style = stage.style
        val force = style.override == AssStyle.FORCE || shown in converted
        val useMargins = force || stage.forceMargins
        var fontScale = if (style.override == AssStyle.NONE && !force) 1.0 else stage.scale
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
            useMargins, fontScale.toFloat(), if (style.override == AssStyle.NONE && !force) 0.0 else 100 - stage.position,
        )
        if (styled == style to force) return
        styled = style to force
        nativeSetStyle(
            native, if (force) AssStyle.FORCE else style.override, style.color, style.outlineColor, style.backColor,
            style.outlineSize, style.borderStyle, style.bold, style.shadowSize,
            style.fontFile.takeIf { force },
        )
    }

    private companion object {
        init {
            System.loadLibrary("aiostreams_ass")
        }

        const val TAG = "ass"
        const val NONE = Long.MIN_VALUE

        /** A 1080p picture: subtitles drawn larger only cost more to blend. */
        const val MAX_PIXELS = 1920 * 1080
        const val REFRESH_NANOS = 8_000_000L

        /** How far ahead of the frame showing moments are rendered, at most. */
        const val AHEAD_US = 2_500_000L
        const val AHEAD_MOMENTS = 64
        const val AHEAD_BYTES = 48L shl 20

        /** How long the showing thread waits for a moment it asked for, as a frame shows. */
        const val ASK_WAIT_MS = 1000

        /** Past a 24 Hz display's frame, so a slide counts as one move. */
        const val SETTLE_MS = 120L

        /** Frames' times kept from before the one showing, for a seek back. */
        const val KEPT_FRAMES_US = 5_000_000L

        /** Lines a track keeps from before the playhead, for one it shows later; signs can stay up a while. */
        const val KEPT_MS = 30_000L

        @JvmStatic
        external fun nativeCreate(font: String): Long

        @JvmStatic
        external fun nativeAddFont(handle: Long, name: String, data: ByteArray)

        @JvmStatic
        external fun nativeClearFonts(handle: Long)

        @JvmStatic
        external fun nativeReloadFonts(handle: Long)

        @JvmStatic
        external fun nativeNewTrack(handle: Long, header: ByteArray): Long

        @JvmStatic
        external fun nativeReadScript(handle: Long, script: ByteArray): Long

        @JvmStatic
        external fun nativeAddLine(track: Long, line: ByteArray, startMs: Long, durationMs: Long)

        @JvmStatic
        external fun nativeFreeTrack(track: Long)

        @JvmStatic
        external fun nativeFlushTrack(track: Long)

        @JvmStatic
        external fun nativeSetCacheLimit(handle: Long, mb: Int)

        @JvmStatic
        external fun nativeSetWindow(handle: Long, surface: Surface?, width: Int, height: Int)

        @JvmStatic
        external fun nativeSetFrameSize(handle: Long, width: Int, height: Int)

        @JvmStatic
        external fun nativeSetLayout(
            handle: Long, videoWidth: Int, videoHeight: Int, top: Int, bottom: Int, left: Int, right: Int,
            useMargins: Boolean, fontScale: Float, linePosition: Double,
        )

        @JvmStatic
        external fun nativeSetStyle(
            handle: Long, override: Int, color: Int, outlineColor: Int, backColor: Int,
            outlineSize: Double, borderStyle: Int, bold: Boolean, shadowSize: Double, fontFile: String?,
        )

        @JvmStatic
        external fun nativeQueue(handle: Long, track: Long, timeMs: Long)

        @JvmStatic
        external fun nativeRoom(handle: Long, moments: Int, bytes: Long): Boolean

        @JvmStatic
        external fun nativeDropFrom(handle: Long, timeMs: Long)

        @JvmStatic
        external fun nativeTake(handle: Long, timeMs: Long, waitMs: Int): Int

        @JvmStatic
        external fun nativeDraw(handle: Long): Boolean

        @JvmStatic
        external fun nativeStamped(handle: Long): Boolean

        @JvmStatic
        external fun nativePost(handle: Long, atNanos: Long)

        @JvmStatic
        external fun nativeRelease(handle: Long)
    }
}

private class Line(val startMs: Long, val durationMs: Long, val bytes: ByteArray) {
    val endMs get() = startMs + durationMs
}

private fun styleFonts(header: ByteArray): Set<String> {
    val names = HashSet<String>()
    var styles = false
    var column = 1
    for (raw in String(header, Charsets.UTF_8).lineSequence()) {
        val line = raw.trim()
        when {
            line.startsWith("[") -> styles = line.contains("Styles", ignoreCase = true)
            !styles -> {}
            line.startsWith("Format:") -> column = line.substringAfter(':').split(',').indexOfFirst { it.trim().equals("Fontname", ignoreCase = true) }.coerceAtLeast(0)
            line.startsWith("Style:") -> line.substringAfter(':').split(',').getOrNull(column)?.let(::fontKey)?.takeIf { it.isNotEmpty() }?.let(names::add)
        }
    }
    return names
}

/** Adds the fonts a line's `\fn` tags name; true when one was new. */
private fun overrideFonts(line: ByteArray, names: MutableSet<String>): Boolean {
    var added = false
    var i = 0
    while (i + 3 <= line.size) {
        if (line[i] != BACKSLASH || line[i + 1] != 'f'.code.toByte() || line[i + 2] != 'n'.code.toByte()) {
            i++
            continue
        }
        var end = i + 3
        while (end < line.size && line[end] != BACKSLASH && line[end] != '}'.code.toByte()) end++
        val name = fontKey(String(line, i + 3, end - i - 3, Charsets.UTF_8))
        if (name.isNotEmpty() && names.add(name)) added = true
        i = end
    }
    return added
}

private const val BACKSLASH = '\\'.code.toByte()

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
