package io.github.viren070.aiostreams.exoplayer.subtitles.ass

import android.content.Context
import android.graphics.PixelFormat
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import io.github.viren070.aiostreams.exoplayer.subtitles.AssSink
import io.github.viren070.aiostreams.exoplayer.subtitles.FontFile
import io.github.viren070.aiostreams.exoplayer.subtitles.SampleParser
import io.github.viren070.aiostreams.exoplayer.subtitles.SubtitleStyle
import io.github.viren070.aiostreams.exoplayer.subtitles.TextSink
import io.github.viren070.aiostreams.exoplayer.video.VideoFrames
import java.io.File
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.roundToInt
import kotlin.math.sqrt
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A line for libass: its start and duration, and its event as Matroska carries ASS. */
internal class AssLine(val startMs: Long, val durationMs: Long, val bytes: ByteArray) {
    val endMs get() = startMs + durationMs
}

/**
 * libass, drawing ASS into a surface of its own between the video and the
 * page, which the compositor lays over the video without the app drawing. One
 * thread owns libass and renders the moments of the video frames [frames] has
 * read ahead of time, so a costly one is ready when its frame shows; another
 * shows each frame's moment. The file's reader only queues what it finds for
 * libass's thread.
 */
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
    private val counts = Counts()

    /** Counts files, so a file's reader can't reach the next one's tracks. */
    @Volatile
    private var file = 0

    @Volatile
    private var handle = 0L

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

    /** Tracks made from text, which take the user's look whole. */
    private val converted = HashSet<String>()
    private val textTracks = HashMap<String, AssTextTrack>()

    /** Each file track's latest lines, which libass gets once the track shows; it holds only the shown one's. */
    private val recent = HashMap<String, ArrayDeque<AssLine>>()
    private val fonts = AssFonts()
    private var shown: String? = null
    private var width = 0
    private var height = 0
    private var stage = StageLayout()
    private var style = SubtitleStyle()

    /** The style libass has; null for a new renderer. */
    private var styled: AssStyle? = null
    private var movedAt = 0L

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
            handle = AssNative.create(font().path)
            if (handle == 0L) Log.e(TAG, "libass.so can't be loaded")
            // The surface may have come first.
            shower.post(::attachWindow)
        }
    }

    /** The reader's way in for the file opening now. */
    fun sink(): AssSink {
        val opened = file
        return object : AssSink {
            override fun fonts(fonts: List<FontFile>) = queue(opened) {
                this@AssSurface.fonts.found(fonts)
                if (giveFonts()) stale = true
            }

            override fun header(track: String, header: ByteArray) = queue(opened) {
                tracks.getOrPut(track) { AssNative.newTrack(handle, header) }
                fonts.header(track, header)
                if (track == shown && giveFonts()) stale = true
            }

            override fun line(track: String, startMs: Long, durationMs: Long, line: ByteArray) = queue(opened) {
                addLine(track, AssLine(startMs, durationMs, line))
                // What's rendered from the line's start went in linesFrom(), so its own fonts need no wipe.
                if (fonts.line(track, line) && track == shown) giveFonts()
            }
        }
    }

    /** The reader's way in for text subtitles, which become ASS as they arrive. */
    fun textSink(): TextSink {
        val opened = file
        return object : TextSink {
            override fun track(track: String, parser: SampleParser) = queue(opened) {
                tracks.getOrPut(track) { AssNative.newTrack(handle, AssText.header) }
                textTracks.getOrPut(track) { AssTextTrack(parser) }.parser = parser
                // Picked before the reader reached it, it showed without the forced look.
                if (converted.add(track) && track == shown) {
                    applyLayout()
                    stale = true
                }
            }

            override fun sample(track: String, timeUs: Long, data: ByteArray) = queue(opened) {
                val text = textTracks[track] ?: return@queue
                runCatching { text.read(timeUs, data) { addLine(track, it) } }
                    .onFailure { Log.w(TAG, "couldn't read a subtitle line", it) }
            }
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
            AssNative.clearFonts(handle)
            styled = null
            recent.clear()
            fonts.clear()
            textTracks.clear()
            shown = null
            applyLayout()
            stale = true
        }
    }

    /** A whole script from outside the file, which [select] shows as `key`; `converted` from text. */
    fun addScript(key: String, script: ByteArray, converted: Boolean) = queue {
        tracks.remove(key)?.let(AssNative::freeTrack)
        tracks[key] = AssNative.readScript(handle, script)
        scripts += key
        if (converted) this.converted += key else this.converted -= key
        if (key == shown) {
            applyLayout()
            stale = true
        }
    }

    fun removeScript(key: String) = queue {
        if (shown == key) shown = null
        tracks.remove(key)?.let(AssNative::freeTrack)
        scripts -= key
        converted -= key
        stale = true
    }

    /** Shows the file's track or the script with `key`, or nothing. */
    fun select(key: String?) = queue {
        if (key != shown) {
            shown?.takeIf { it !in scripts }?.let(tracks::get)?.let(AssNative::flushTrack)
            tracks[key]?.let { track -> recent[key]?.forEach { AssNative.addLine(track, it.bytes, it.startMs, it.durationMs) } }
        }
        val restyle = (key in converted) != (shown in converted)
        shown = key
        if (!giveFonts() && restyle) applyLayout()
        stale = true
    }

    /** Megabytes of drawn subtitles libass keeps, 0 for its own limit; what's rendered ahead keeps half as many. */
    fun setCacheLimit(mb: Int) = queue {
        AssNative.setCacheLimit(handle, mb)
        aheadBytes = if (mb > 0) (mb.toLong() shl 20) / 2 else AHEAD_BYTES
    }

    fun setStage(stage: StageLayout) = queue {
        this.stage = stage
        applyLayout()
        stale = true
    }

    fun setStyle(style: SubtitleStyle) = queue {
        // Lifted above the page's controls, the position changes every display frame.
        if (style.looksLike(this.style)) {
            movedAt = SystemClock.uptimeMillis()
            worker.removeCallbacks(settled)
            worker.postDelayed(settled, SETTLE_MS)
        }
        this.style = style
        applyLayout()
        stale = true
    }

    /** Shows the subtitles for the video frame at `frameUs`, which the screen shows at `atNanos`. */
    fun render(frameUs: Long, atNanos: Long) {
        this.frameUs = frameUs
        this.atNanos = atNanos
        counts.frames.incrementAndGet()
        frames.trim(frameUs - KEPT_FRAMES_US)
        if (active && scheduled.compareAndSet(false, true)) shower.post(show)
    }

    /** Renders the moment showing again, as something other than time changed. */
    fun invalidate() {
        atNanos = 0
        queue { stale = true }
    }

    fun stats() = counts.stats()

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
            AssNative.setFrameSize(handle, scaledWidth, scaledHeight)
            applyLayout()
            stale = true
        }
    }

    // The surface is gone once this returns, so the window has to be let go of first.
    override fun surfaceDestroyed(holder: SurfaceHolder) {
        val done = CountDownLatch(1)
        shower.post {
            window = null
            if (handle != 0L) AssNative.setWindow(handle, null, 0, 0)
            done.countDown()
        }
        done.await(2, TimeUnit.SECONDS)
    }

    fun release() {
        shower.post {
            if (handle != 0L) AssNative.setWindow(handle, null, 0, 0)
            showing.quitSafely()
        }
        worker.post {
            showing.join()
            freeTracks()
            AssNative.release(handle)
            handle = 0L
            rendering.quitSafely()
        }
    }

    private fun attachWindow() {
        if (handle == 0L || window == null) return
        AssNative.setWindow(handle, window, windowWidth, windowHeight)
        mustDraw = true
    }

    private fun queue(opened: Int, change: () -> Unit) = queue { if (opened == file) change() }

    private fun queue(change: Runnable) {
        queued += change
        step(front = false)
    }

    private fun addLine(track: String, line: AssLine) {
        val lines = recent.getOrPut(track) { ArrayDeque() }
        lines += line
        while (lines.isNotEmpty() && lines.first().endMs < frameUs / 1000 - KEPT_MS) lines.removeFirst()
        if (track == shown) tracks[track]?.let {
            AssNative.addLine(it, line.bytes, line.startMs, line.durationMs)
            linesFrom(line.startMs)
        }
    }

    private fun freeTracks() {
        tracks.values.forEach(AssNative::freeTrack)
        tracks.clear()
        scripts.clear()
        converted.clear()
    }

    /** Hands libass the fonts the shown track asks for; true when it had new ones. */
    private fun giveFonts(): Boolean {
        val giving = fonts.take(shown)
        if (giving.isEmpty()) return false
        for (font in giving) {
            runCatching { AssNative.addFont(handle, font.file.name, font.file.readBytes()) }
                .onFailure { Log.w(TAG, "couldn't read ${font.file.name}", it) }
        }
        AssNative.reloadFonts(handle)
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
        AssNative.dropFrom(handle, startMs)
        aheadUs = minOf(aheadUs, startMs * 1000 + delayUs - 1)
    }

    private fun applyLayout() {
        if (handle == 0L || stage.width == 0 || width == 0) return
        val layout = AssLayout(stage, style, width, height, converted = shown in converted)
        AssNative.setLayout(
            handle, stage.videoWidth, stage.videoHeight, layout.top, layout.bottom, layout.left, layout.right,
            layout.useMargins, layout.fontScale, layout.linePosition,
        )
        val style = layout.assStyle
        if (styled == style) return
        styled = style
        AssNative.setStyle(
            handle, style.override, style.color, style.outlineColor, style.backColor,
            style.outlineSize, style.borderStyle, style.bold, style.shadowSize, style.fontFile,
        )
    }

    private val ahead = Runnable {
        stepping.set(false)
        step()
    }

    private val asap = Runnable { step() }

    private val settled = Runnable { step() }

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
        if (handle == 0L) return
        while (true) queued.poll()?.run() ?: break
        val track = shown?.let(tracks::get) ?: 0L
        active = track != 0L
        val nowUs = frameUs
        if (stale) {
            stale = false
            AssNative.dropFrom(handle, Long.MIN_VALUE)
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
        if (track == 0L || !AssNative.room(handle, AHEAD_MOMENTS, aheadBytes)) return
        // Behind, from the frame showing, which the showing thread may not have taken yet.
        val next = frames.after(maxOf(aheadUs, nowUs - 1)) ?: return
        if (next - nowUs > AHEAD_US) return
        queueMoment(track, momentMs(next))
        aheadUs = next
        step(front = false)
    }

    private fun queueMoment(track: Long, ms: Long) {
        val start = System.nanoTime()
        AssNative.queue(handle, track, ms)
        counts.renders.add(System.nanoTime() - start)
    }

    private fun momentMs(videoUs: Long) = (videoUs - delayUs) / 1000

    private val show = Runnable {
        scheduled.set(false)
        show(force = false)
    }

    /** Shows the moment of the frame showing, rendered ahead or asked for now. */
    private fun show(force: Boolean) {
        if (handle == 0L || window == null) return
        val ms = momentMs(frameUs)
        // Tunneled, the frame showing comes from the clock, on every refresh.
        if (ms == shownMs && !force && !mustDraw) return
        var taken = AssNative.take(handle, ms, 0)
        if (taken < 0) {
            counts.missed.incrementAndGet()
            asked.set(ms)
            step(front = true)
            taken = AssNative.take(handle, ms, ASK_WAIT_MS)
            // Rendered ahead meanwhile, it needn't be again.
            asked.compareAndSet(ms, NONE)
            if (taken < 0) {
                counts.skipped.incrementAndGet()
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
        if (!AssNative.draw(handle)) return
        val now = System.nanoTime()
        counts.blends.add(now - start)
        if (AssNative.stamped(handle)) {
            // The compositor holds it for the video frame's time.
            if (at != 0L && now > at) counts.late.incrementAndGet()
        } else {
            // Posted a refresh ahead of the video frame, so both show together.
            val wait = at - now - REFRESH_NANOS
            if (wait > 0) SystemClock.sleep(wait / 1_000_000)
            else if (at != 0L && wait < -REFRESH_NANOS) counts.late.incrementAndGet()
        }
        AssNative.post(handle, at)
    }

    private class Counts {
        val frames = AtomicLong()
        val late = AtomicLong()
        val missed = AtomicLong()
        val skipped = AtomicLong()
        val renders = Timings()
        val blends = Timings()

        fun stats() = buildJsonObject {
            put("subtitleFrames", frames.get())
            put("latePosts", late.get())
            put("missedMoments", missed.get())
            put("skippedMoments", skipped.get())
            for ((key, value) in renders.stats()) put(key, value)
            for ((key, value) in blends.stats()) put("blend" + key.replaceFirstChar(Char::uppercase), value)
        }
    }

    private companion object {
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
    }
}
