package io.github.viren070.aiostreams.exoplayer.subtitles

import android.content.Context
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.text.Cue
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.ui.SubtitleView
import io.github.viren070.aiostreams.exoplayer.Stage
import io.github.viren070.aiostreams.exoplayer.cache.StreamCache
import io.github.viren070.aiostreams.exoplayer.extractor.Attachments
import io.github.viren070.aiostreams.exoplayer.extractor.MatroskaHost
import io.github.viren070.aiostreams.exoplayer.subtitles.ass.AssSurface
import io.github.viren070.aiostreams.exoplayer.subtitles.ass.AttachedFonts
import io.github.viren070.aiostreams.exoplayer.subtitles.ass.StageLayout
import io.github.viren070.aiostreams.exoplayer.video.VideoFrames
import io.github.viren070.aiostreams.libs.FallbackFont
import io.github.viren070.aiostreams.playback.CacheBudget
import io.github.viren070.aiostreams.playback.SubtitleLine
import io.github.viren070.aiostreams.playback.SubtitleLook
import java.io.File

/**
 * The engine's subtitles, shown on the video's frames so their delay applies.
 * On the main thread, but for [sink], [readBack] and [frame].
 */
@OptIn(UnstableApi::class)
internal class Subtitles(
    context: Context,
    private val frames: VideoFrames,
    private val cache: StreamCache,
    /** Reads the file's attached fonts, past the cache. */
    private val fontSource: DataSource.Factory,
) {
    private val main = Handler(Looper.getMainLooper())
    private val ass = AssSurface(context, frames) { FallbackFont.file(context) }
    private val texts = TextTracks { delayUs }
    private val lines = SubtitleLines()
    private val fontsDir = File(context.cacheDir, "attached-fonts")
    private var fonts: AttachedFonts? = null
    private var view: SubtitleView? = null
    private var style = SubtitleStyle()
    private var stage = StageLayout()
    private val added = mutableListOf<ExternalSubtitle>()
    private var shownCues: List<Cue> = emptyList()

    /** The file's first frame showed, so its fonts may take the link. */
    @Volatile
    private var started = false

    @Volatile
    var external: ExternalSubtitle? = null
        private set

    /** The text subtitle timed here, rather than by the player. */
    @Volatile
    private var text: TextTimeline? = null

    @Volatile
    var readBack: String? = null
        private set

    @Volatile
    private var delayUs = 0L

    @Volatile
    private var lastFrameUs = 0L

    @Volatile
    private var lastFrameAtNs = 0L

    val externals: List<ExternalSubtitle> get() = added

    init {
        fontsDir.deleteRecursively()
        if (CacheBudget.small(context)) ass.setCacheLimit(SMALL_ASS_CACHE_MB)
        cache.onMemoryShort = { ass.setCacheLimit(SHORT_ASS_CACHE_MB) }
    }

    /** The reader's way in for the file opening now. */
    fun sink(): SubtitleSink = lines.sink(SubtitleSink(ass.sink(), TextRoute(ass.textSink(), texts.sink())))

    fun attach(stage: Stage) {
        stage.addLayer(ass.view)
        view = stage.subtitles
        style.applyTo(stage.subtitles)
    }

    /** Lets go of the last file's subtitles; [readsTracks] is false where the page wants none of the file's own. */
    fun open(readsTracks: Boolean) {
        close()
        started = false
        frames.clear()
        ass.reset()
        texts.reset()
        lines.reset()
        readBack = if (readsTracks) MatroskaHost.ANY_TRACK else null
    }

    fun close() {
        fonts?.close()
        fonts = null
        fontsDir.deleteRecursively()
        external = null
        added.clear()
    }

    fun loadFonts(found: Attachments) {
        if (fonts != null) return
        val dir = File(fontsDir, System.nanoTime().toString())
        fonts = AttachedFonts(found, fontSource, dir, ass.sink(), ::fontsMayLoad).also { it.start() }
    }

    fun firstFrameShown() {
        started = true
    }

    fun setStyle(look: SubtitleLook, forceMargins: Boolean) {
        val next = SubtitleStyle(look, forceMargins)
        if (next == style) return
        val moved = next.looksLike(style)
        style = next
        ass.setStyle(next)
        val view = view ?: return
        if (moved) next.place(view) else next.applyTo(view)
        if (shownCues.isNotEmpty()) view.setCues(shownCues.map(next::placed))
    }

    fun stageLaidOut(width: Int, height: Int, video: Rect) = setStage(stage.copy(width = width, height = height, video = video))

    fun videoSized(width: Int, height: Int) = setStage(stage.copy(videoWidth = width, videoHeight = height))

    fun setDelayMs(ms: Double) {
        delayUs = (ms * 1000).toLong()
        ass.delayUs = delayUs
        showCues(lastFrameUs)
    }

    /** Shows the added file with `id`; false where it isn't one. */
    fun selectExternal(id: Int?): Boolean {
        external = added.find { it.id == id }
        return external != null
    }

    /** Once the engine has [chosen] the file's tracks, seeks read back for the one shown alone. */
    fun show(format: Format?, chosen: Boolean) {
        val shown = external
        val id = format?.id?.substringAfter(':')
        val drawnByLibass = format != null && drawnByLibass(format)
        ass.select(shown?.key ?: id.takeIf { drawnByLibass })
        text = if (shown == null && format != null && !drawnByLibass) id?.let(texts::get) else null
        if (chosen) readBack = id.takeIf { shown == null }
        shownCues = emptyList()
        view?.setCues(emptyList())
        showCues(lastFrameUs)
    }

    /** The id for a file the page adds, past the file's own [tracks]. */
    fun nextId(tracks: Int) = maxOf(tracks, added.maxOfOrNull { it.id } ?: 0) + 1

    fun add(subtitle: ExternalSubtitle) {
        ass.addScript(subtitle.key, subtitle.script.bytes, subtitle.script.converted)
        added += subtitle
    }

    /** False where no added file has `id`. */
    fun remove(id: Int): Boolean {
        val removed = added.find { it.id == id } ?: return false
        added -= removed
        ass.removeScript(removed.key)
        return true
    }

    /** Each video frame, as it's handed to the screen, on the player's thread: the subtitles follow the picture. */
    fun frame(timeUs: Long, releaseNs: Long) {
        lastFrameUs = timeUs
        lastFrameAtNs = System.nanoTime()
        ass.render(timeUs, releaseNs)
        if (text != null) main.post { showCues(timeUs) }
    }

    fun clock(positionUs: Long, frameNanos: Long) {
        if (System.nanoTime() - lastFrameAtNs <= FRAMES_STOPPED_NS) return
        lastFrameUs = positionUs
        ass.render(frames.at(positionUs) ?: positionUs, frameNanos)
        showCues(positionUs)
    }

    fun onCues(cues: List<Cue>) {
        if (text != null || external != null) return
        shownCues = cues
        view?.setCues(cues.map(style::placed))
    }

    fun trim(positionUs: Long) = texts.trimHidden(text, positionUs)

    fun watchLines(track: String?) = lines.watch(track)

    fun takeLines(): List<SubtitleLine> = lines.take()

    fun stats() = ass.stats()

    fun release() {
        close()
        ass.release()
    }

    private fun setStage(next: StageLayout) {
        if (next == stage) return
        stage = next
        ass.setStage(next)
    }

    private fun showCues(frameUs: Long) {
        val cues = text?.cuesAt(frameUs - delayUs) ?: return
        if (cues == shownCues) return
        shownCues = cues
        view?.setCues(cues.map(style::placed))
    }

    private fun fontsMayLoad(bytes: Long) =
        bytes <= SMALL_FONTS_BYTES || started && (!cache.caching || cache.canSpare(bytes))

    private companion object {
        const val SMALL_FONTS_BYTES = 8L shl 20
        const val SMALL_ASS_CACHE_MB = 32
        const val SHORT_ASS_CACHE_MB = 8
        const val FRAMES_STOPPED_NS = 100_000_000L
    }
}
