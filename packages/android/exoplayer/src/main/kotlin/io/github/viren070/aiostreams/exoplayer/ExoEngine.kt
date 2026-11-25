package io.github.viren070.aiostreams.exoplayer

import android.content.Context
import android.media.MediaFormat
import android.net.Uri
import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Choreographer
import android.view.SurfaceHolder
import android.view.View
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ColorInfo
import androidx.media3.common.FileTypes
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaLibraryInfo
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.datasource.DataSourceUtil
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.video.VideoFrameMetadataListener
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.metadata.Chapter
import io.github.viren070.aiostreams.exoplayer.audio.AudioOutput
import io.github.viren070.aiostreams.exoplayer.audio.Renderers
import io.github.viren070.aiostreams.exoplayer.cache.BufferControl
import io.github.viren070.aiostreams.exoplayer.cache.StreamCache
import io.github.viren070.aiostreams.exoplayer.cache.bufferedRanges
import io.github.viren070.aiostreams.exoplayer.extractor.Attachments
import io.github.viren070.aiostreams.exoplayer.extractor.ExtractorHost
import io.github.viren070.aiostreams.exoplayer.extractor.Extractors
import io.github.viren070.aiostreams.exoplayer.subtitles.ExternalSubtitle
import io.github.viren070.aiostreams.exoplayer.subtitles.SubtitleScript
import io.github.viren070.aiostreams.exoplayer.subtitles.SubtitleSink
import io.github.viren070.aiostreams.exoplayer.subtitles.Subtitles
import io.github.viren070.aiostreams.exoplayer.video.DolbyVisionRoute
import io.github.viren070.aiostreams.exoplayer.video.Upscaler
import io.github.viren070.aiostreams.exoplayer.video.MediaCaps
import io.github.viren070.aiostreams.exoplayer.video.VideoFrames
import io.github.viren070.aiostreams.exoplayer.video.dolbyVisionRoute
import io.github.viren070.aiostreams.logs.AppLog
import io.github.viren070.aiostreams.playback.Change
import io.github.viren070.aiostreams.playback.Engine
import io.github.viren070.aiostreams.playback.Fit
import io.github.viren070.aiostreams.playback.LoadRequest
import io.github.viren070.aiostreams.playback.Pick
import io.github.viren070.aiostreams.playback.PlayerChapter
import io.github.viren070.aiostreams.playback.PlayerSettings
import io.github.viren070.aiostreams.playback.PlayerState
import io.github.viren070.aiostreams.playback.Skip
import io.github.viren070.aiostreams.playback.Sound
import io.github.viren070.aiostreams.playback.Style
import io.github.viren070.aiostreams.playback.UpscaleNetwork
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * ExoPlayer. libass draws ASS and text subtitles over the video; the player's
 * subtitle view draws pictures and captions.
 */
@OptIn(UnstableApi::class)
class ExoEngine(private val context: Context) : Engine {
    private val main = Handler(Looper.getMainLooper())
    private val loader = Executors.newSingleThreadExecutor { Thread(it, "exo-loader") }
    private val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true)
    private val link = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true).setReadTimeoutMs(0)
    private val cache = StreamCache(context, http, link)
    private val data = DefaultDataSource.Factory(context, cache.factory)
    private val frames = VideoFrames()
    private val subtitles = Subtitles(context, frames, cache, DefaultDataSource.Factory(context, http))
    private val audio: AudioOutput = AudioOutput().also {
        it.broke = {
            main.post {
                // A break told after release belongs to no file any more.
                if (released) return@post
                // The sound's clock stopped with it, and the picture follows that clock: where both start again.
                heldAt = player.currentPosition
                heldFor = opens
                AppLog.i(TAG, "holding at $heldAt ms")
                // A track breaking with no wait under way: HDMI links again for a reason the app didn't see.
                if (!outputSettling()) outputBroke()
            }
        }
        it.canResume = { !outputSettling() && !waiting() }
        it.waits = { waiting() }
        it.quiet = { !wantsPlay && (outputSettling() || away()) }
        it.paused = { !wantsPlay }
        it.resume = {
            main.post {
                if (url == null || released) return@post
                // A file opened since the hold starts where it is: the seek lets go of a hold that isn't its own.
                val at = if (heldFor == opens) heldAt else player.currentPosition
                AppLog.i(TAG, "starting again together at $at ms")
                seekExactly(at)
            }
        }
        it.recovered = { main.post { outputRetries = 0 } }
        it.repicking = { selector.wanted = true }
    }

    // Where sound and picture stopped as the audio output broke, and in which file.
    private var heldAt = 0L
    private var heldFor = -1
    private var released = false
    private val tracks = ExoTracks()
    private val events = Events()

    /** True while HDMI links again; output changes wait until then, and a broken audio output waits for it. */
    @Volatile
    var outputSettling: () -> Boolean = { false }

    /** The app is out of sight with the file paused: the sound waits for it to come back, and so do picked tracks. */
    @Volatile
    var away: () -> Boolean = { false }

    // Whether the file is to play, as the page or a remote's Play key asked; played on out of sight (the notification,
    // a remote), nothing waits for coming back.
    @Volatile
    private var wantsPlay = false

    /** The Dolby and DTS formats the output takes, as the app reads them, in mpv's names. */
    @Volatile
    var outputFormats: () -> List<String> = { emptyList() }

    private fun selectedMime(tracks: Tracks, type: Int): String? {
        for (group in tracks.groups) {
            if (group.type != type) continue
            for (i in 0 until group.length) if (group.isTrackSelected(i)) return group.getTrackFormat(i).sampleMimeType
        }
        return null
    }

    private fun waiting() = away() && !wantsPlay

    /** Told when the audio track breaks with no wait under way: HDMI links again for a reason the app didn't see. */
    var outputBroke: () -> Unit = {}

    private val selector = object : DefaultTrackSelector(context) {
        /** Media3 seeks the playing file when the output changes, and throws if there is none. */
        @Volatile
        var tracksKnown = false

        @Volatile
        private var deferred: Renderer? = null

        init {
            setParameters(buildUponParameters().setAllowInvalidateSelectionsOnRendererCapabilitiesChange(true))
        }

        override fun onRendererCapabilitiesChanged(renderer: Renderer) {
            if (!tracksKnown) {
                // A request of the sink's before the tracks are picked is in the pick to come.
                wanted = false
                return
            }
            if (outputSettling() || waiting()) {
                if (deferred == null) AppLog.i(TAG, "holding back an output change while ${if (waiting()) "the app is away" else "the display settles"}")
                deferred = renderer
                main.removeCallbacks(settled)
                main.postDelayed(settled, SETTLE_POLL_MS)
                return
            }
            // Kept for the app's own reading of HDMI, which can come a moment later and tell otherwise.
            if (soundStays()) {
                skipped = renderer
                // A reading that changed between the check and the note is looked at again.
                main.post { recheck() }
                return
            }
            pick(renderer)
        }

        // A change skipped as the sound stayed, looked at again as the app's reading of HDMI changes.
        @Volatile
        private var skipped: Renderer? = null

        /** The app read HDMI's formats again: a change skipped for the old reading may be needed now. */
        fun recheck() {
            val renderer = skipped ?: return
            if (!tracksKnown) {
                skipped = null
                return
            }
            if (soundStays()) return
            skipped = null
            onRendererCapabilitiesChanged(renderer)
        }

        fun forgetSkipped() {
            skipped = null
        }

        /** A file opens or stops: what was held back or skipped belonged to the one before. */
        fun forget() {
            deferred = null
            skipped = null
            wanted = false
        }

        /**
         * Whether a pick would leave the sound as it is: a Dolby or DTS track passed through while HDMI still takes it.
         * After a broken track, Media3 reads the output as plain PCM until a playing track reports its device, and then
         * reads it again: a pick for either seeks the file and starts its decoders and the sound's track again, for
         * nothing, and one while it reads plain PCM decodes a track HDMI takes. Anything else, a decoded track included, picks as Media3 asks.
         *
         * Seen in Media3 1.11.1:
         * - AudioTrackAudioOutputProvider.onRecoverableWriteError sets DEFAULT_AUDIO_CAPABILITIES without an event, until
         *   onRoutedDeviceChanged: https://github.com/androidx/media/blob/1.11.1/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/audio/AudioTrackAudioOutputProvider.java#L576-L589
         * - ExoPlayerImplInternal.reselectTracksInternalAndSeek seeks on every capability change, tracks the same or not:
         *   https://github.com/androidx/media/blob/1.11.1/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/ExoPlayerImplInternal.java#L2393-L2396
         * It isn't tied to that version: should either change, it only skips picks that would leave the sound as it is,
         * and an output that no longer takes the track breaks it, which the held sound and the engine's retry pick
         * again. At worst it skips a pick that does nothing.
         */
        private fun soundStays(): Boolean {
            if (wanted || !audio.passingThrough()) return false
            val name = SPDIF_NAMES[audioMime] ?: return false
            return name in outputFormats() && audio.allows(audioMime)
        }

        private fun pick(renderer: Renderer) {
            wanted = false
            skipped = null
            // A deferred change is in this pick too.
            deferred = null
            super.onRendererCapabilitiesChanged(renderer)
        }

        // The selected audio track's sample type, set on the main thread as the tracks are known.
        @Volatile
        var audioMime: String? = null

        // The sink asked for a pick of its own (the page's passthrough, the speed), which the output's formats don't show.
        @Volatile
        var wanted = false

        /**
         * Picks tracks once for what changed while the output settled, unless the file is gone or the sound would
         * stay as it is.
         */
        fun pickDeferred() {
            val renderer = deferred ?: return
            deferred = null
            if (!tracksKnown) {
                wanted = false
                return
            }
            if (soundStays()) {
                // Kept for the app's own reading of HDMI, which can come a moment later and tell otherwise.
                skipped = renderer
                return AppLog.i(TAG, "the display settled; the sound stays as it is, so the tracks do")
            }
            AppLog.i(TAG, "the display settled; picking tracks for the output again")
            pick(renderer)
        }
    }
    private val retryOutput: Runnable = object : Runnable {
        override fun run() {
            if (!recovering || url == null) return
            val waited = SystemClock.uptimeMillis() - recoveringSince
            if (waiting()) {
                // The wait for HDMI counts from coming back, which links it again.
                recoveringSince = SystemClock.uptimeMillis()
                main.postDelayed(this, AWAY_POLL_MS)
                return
            }
            if (outputSettling() && waited < MAX_SETTLE_WAIT_MS) {
                main.postDelayed(this, SETTLE_POLL_MS)
                return
            }
            recovering = false
            AppLog.i(TAG, "the audio output settled after $waited ms; preparing the file again")
            player.prepare()
        }
    }

    private val settled: Runnable = object : Runnable {
        override fun run() {
            when {
                waiting() -> main.postDelayed(this, AWAY_POLL_MS)
                outputSettling() -> main.postDelayed(this, SETTLE_POLL_MS)
                else -> selector.pickDeferred()
            }
        }
    }
    private val loadErrors = LoadErrorPolicy()
    private val sources = DefaultMediaSourceFactory(data, Extractors(Reading())).setLoadErrorHandlingPolicy(loadErrors)
    private val player = ExoPlayer.Builder(context, Renderers(context, audio), sources)
        .setTrackSelector(selector)
        // The app keeps audio focus and pauses for noise itself.
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), false)
        .setHandleAudioBecomingNoisy(false)
        .setLoadControl(BufferControl(cache))
        .build()

    // Cleared by release() on any thread, read by Media3's callbacks on the main one.
    @Volatile
    private var listener: Engine.Listener? = null

    @Volatile
    private var reported = PlayerState()
    private var stage: Stage? = null
    private val decoders = ConcurrentHashMap<String, String>()

    // The file playing and what the page asked of it.
    private var url: String? = null

    // An audio output that broke while HDMI settled: the file waits for it, then prepares again.
    private var outputRetries = 0
    private var recovering = false
    private var recoveringSince = 0L
    private var options = TrackOptions(null)
    private var loaded = false
    private var chosen = false
    private var opens = 0
    private var seeking = false

    /** A load or seek waits for its first frame, which mpv reports as `playback-restart`. */
    private var restarting = false
    private var volume = 100.0
    private var muted = false
    private var skips: List<Skip> = emptyList()
    private var seekMap: SeekMap? = null

    /** The file's own subtitle whose lines the page asked for. */
    private var reference: Int? = null
    private var tunneling = false
    private var upscaling = false
    private var upscaler: Upscaler? = null
    private var upscalerFailed = false
    private var upscaled = false
    private var tooSlowHeight = Int.MAX_VALUE
    private var idlePolls = 0

    // Read on the loader's thread too.
    @Volatile
    private var caps = MediaCaps(emptySet(), emptySet())

    @Volatile
    private var useDolbyVision = true

    /** The Dolby Vision track's codec string and how it plays, once the file says it has one. */
    @Volatile
    private var dolbyVision: Pair<String, DolbyVisionRoute>? = null

    /** What the sound goes out as, after passthrough, mixing or re-encoding. */
    @Volatile
    private var audioTrack: AudioSink.AudioTrackConfig? = null

    init {
        player.addListener(events)
        player.addAnalyticsListener(events)
        player.setVideoFrameMetadataListener(events)
    }

    override val description = "ExoPlayer (Media3 ${MediaLibraryInfo.VERSION})"

    override fun start(listener: Engine.Listener) {
        this.listener = listener
        state(
            PlayerState(
                idle = true, paused = !player.playWhenReady, volume = volume / 100, maxVolume = VOLUME_MAX / 100,
                muted = false, speed = 1.0, audio = Pick(null), subtitle = Pick(null),
            ),
        )
        listener.onTracks(emptyList())
        listener.onChapters(emptyList())
    }

    override fun createView(context: Context): View = Stage(context, subtitles::stageLaidOut).also { stage ->
        this.stage = stage
        subtitles.attach(stage)
        // Before Media3's own: told first as the surface goes, the seek reaches the player before Media3 lets go of it.
        stage.video.holder.addCallback(surfaceGoes)
        player.setVideoSurfaceView(stage.video)
        upscaled = false
        routeVideo()
    }

    // The last frame shown, which a paused file shows again once its video surface comes back.
    @Volatile
    private var lastFrameUs = C.TIME_UNSET

    // A paused player still renders a frame now and then (after a seek, or one already on its way): only the
    // first after a seek counts as the frame on screen, so going away and back doesn't step on a frame each time.
    @Volatile
    private var playingNow = false

    @Volatile
    private var takeNextFrame = true

    private fun windowOffsetUs(): Long {
        val timeline = player.currentTimeline
        if (timeline.isEmpty) return 0L
        return timeline.getWindow(player.currentMediaItemIndex, Timeline.Window()).positionInFirstPeriodUs
    }

    // The frame a paused file shows again on coming back: the one paused on, until play or a seek from the page.
    private var anchorUs = C.TIME_UNSET

    // The paused frame's own seek runs, which the page shows no loading for.
    private var holdingFrame = false

    /** A file opens or stops: its frame and the seek that holds it belong to it. */
    private fun forgetFrame() {
        lastFrameUs = C.TIME_UNSET
        takeNextFrame = true
        anchorUs = C.TIME_UNSET
        holdingFrame = false
        main.removeCallbacks(frameLate)
    }

    // Android takes the video's surface away while the app is out of sight, and with it the frame on it.
    private val surfaceGoes = object : SurfaceHolder.Callback {
        // Back while the paused frame still builds. From memory that takes a moment; still at it a moment later, it
        // comes from the cache or the server, and the page shows loading for it rather than an empty picture.
        override fun surfaceCreated(holder: SurfaceHolder) {
            if (!holdingFrame) return
            main.removeCallbacks(frameLate)
            main.postDelayed(frameLate, FRAME_LATE_MS)
        }

        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

        // Media3 renders the frame it holds next onto a new surface at once, even while paused: one past the frame
        // that was on screen. Seeking back to that frame as the surface goes makes it the one held, decoded while
        // the app is away from the data kept behind the playhead, so coming back usually shows it at once.
        override fun surfaceDestroyed(holder: SurfaceHolder) = holdLastFrame()
    }

    /**
     * A paused file seeks back, exactly, to the frame it paused on, so the decoder holds that frame for the new surface.
     * Left alone: a stream that can't seek, upscaling, a recovering audio output, and playing.
     */
    private fun holdLastFrame() {
        if (url == null || upscaled || recovering || player.playWhenReady || !player.isCurrentMediaItemSeekable) return
        // A frame's time counts from its period, a seek from the window: only where both start together (not a live
        // window that moved on in its stream) is that frame's time a position to seek to.
        if (player.isCurrentMediaItemLive || windowOffsetUs() != 0L) return
        // The frame paused on, kept through every going away and coming back until play or a seek from the page.
        if (anchorUs == C.TIME_UNSET) {
            // Since a seek, no frame of the new position was shown: that position is the one to show.
            anchorUs = lastFrameUs.takeIf { it != C.TIME_UNSET } ?: (player.currentPosition * 1000)
        }
        val at = anchorUs / 1000
        // A frame time far from the position (a live window moved on, say) is no frame of here.
        if (abs(at - player.currentPosition) > HOLD_FRAME_MAX_MS) {
            anchorUs = C.TIME_UNSET
            return
        }
        // Only as the picture goes, never while it shows.
        AppLog.i(TAG, "the video goes while paused; holding its frame at $at ms for coming back")
        // Rebuilt from the kept data while the app is away, which the page shows no loading for.
        holdingFrame = true
        main.removeCallbacks(frameLate)
        seekExactly(at)
    }

    private val frameLate = Runnable {
        if (!holdingFrame || player.playbackState != Player.STATE_BUFFERING) return@Runnable
        AppLog.i(TAG, "the paused frame still loads after coming back; the page shows it")
        holdingFrame = false
        state(PlayerState(buffering = true))
    }

    // Exo has no queue of its own, so a file to play next waits for the page to load it.
    override fun load(request: LoadRequest) = post { if (!request.append) open(request) }

    override fun stop() = post {
        stopRecovering()
        // A file that ended or failed is no longer playing, yet still holds its cache and the player's decoders.
        val playing = url != null
        url = null
        // A live link still being told apart would start once that answers.
        opens++
        selector.tracksKnown = false
        selector.forget()
        main.removeCallbacks(settled)
        forgetFrame()
        player.stop()
        player.clearMediaItems()
        cache.play(null)
        subtitles.close()
        if (!playing) return@post
        listener?.onEnded("stop", null, null)
        state(PlayerState(idle = true))
    }

    override fun change(change: Change) = post {
        change.paused?.let { player.playWhenReady = !it }
        change.volume?.let {
            volume = (it * 100).coerceIn(0.0, VOLUME_MAX)
            applyVolume()
            state(PlayerState(volume = volume / 100))
        }
        change.muted?.let {
            muted = it
            applyVolume()
            state(PlayerState(muted = it))
        }
        change.speed?.let { player.playbackParameters = PlaybackParameters(it.toFloat()) }
        change.audio?.let { selectTrack("audio", it.id?.toIntOrNull()) }
        change.subtitle?.let { selectSubtitle(it.id?.toIntOrNull()) }
        change.subtitleDelayMs?.let(subtitles::setDelayMs)
    }

    override fun seek(positionMs: Double, snapMs: Double) = post {
        if (url == null) return@post
        // A held sound's queued restart starts where the page asked, not back where the sound stopped.
        heldFor = -1
        anchorUs = C.TIME_UNSET
        // The page's own seek shows as seeking; the paused frame's quiet one is over.
        holdingFrame = false
        main.removeCallbacks(frameLate)
        val snapUs = (snapMs * 1000).toLong()
        player.setSeekParameters(if (snapUs > 0) SeekParameters(snapUs, snapUs) else SeekParameters.EXACT)
        player.seekTo(positionMs.toLong().coerceAtLeast(0))
        seeking = true
        restarting = true
        state(PlayerState(seeking = true))
        updatePolling()
    }

    override fun addSubtitle(url: String, title: String?, language: String?, replace: Int?) = post {
        replace?.let(::removeSubtitle)
        subtitles.externals.find { it.url == url }?.let { return@post selectSubtitle(it.id) }
        val file = this.url
        loader.execute {
            runCatching {
                val script = SubtitleScript.read(read(url))
                main.post {
                    if (this.url != file) return@post
                    val id = subtitles.nextId(tracks.count("sub"))
                    subtitles.add(ExternalSubtitle(id, url, title, language, script))
                    selectSubtitle(id)
                }
            }.onFailure { AppLog.w(TAG, "couldn't add the subtitle", it) }
        }
    }

    override fun watchSubtitleLines(track: String?) = post {
        reference = track?.toIntOrNull()
        subtitles.watchLines(referenceKey())
        sendLines()
    }

    override fun setSkips(skips: List<Skip>) = post {
        this.skips = skips
        updateSkips()
    }

    override fun setStyle(style: Style) = post {
        stage?.keepAspect = style.fit != Fit.STRETCH
        stage?.panscan = if (style.fit == Fit.CROP) 1.0 else 0.0
        subtitles.setStyle(style.subtitles, forceMargins = style.fit == Fit.CROP)
    }

    override fun setSubtitlesShown(shown: Boolean) = post { subtitles.setShown(shown) }

    override fun setSettings(settings: PlayerSettings) = post {
        audio.setSettings(settings)
        cache.limitMb = settings.cacheMb
        subtitles.setGpu(settings.gpuSubtitles)
    }

    override val checksOutput = true

    override fun setDolbyVision(on: Boolean) {
        useDolbyVision = on
    }

    override fun setSound(sound: Sound) = audio.setSound(sound)

    fun setTunneling(on: Boolean) = main.post {
        val selector = player.trackSelector as? DefaultTrackSelector ?: return@post
        selector.setParameters(selector.buildUponParameters().setTunnelingEnabled(on))
        tunneling = on
        updateClock()
        routeVideo()
    }

    override fun setUpscaling(on: Boolean) {
        main.post {
            if (on == upscaling) return@post
            upscaling = on
            if (on) startUpscaler() else stopUpscaler()
        }
    }

    private fun startUpscaler() {
        upscalerFailed = false
        loader.execute {
            Upscaler(
                UpscaleNetwork.load(),
                onReady = { ready ->
                    main.post {
                        when {
                            ready == null -> upscalerFailed = true
                            !upscaling -> ready.release()
                            else -> {
                                upscaler = ready
                                routeVideo()
                            }
                        }
                    }
                },
                onTooSlow = {
                    main.post {
                        player.videoFormat?.let { tooSlowHeight = min(tooSlowHeight, it.height) }
                        routeVideo()
                    }
                },
            )
        }
    }

    private fun stopUpscaler() {
        useUpscaler(false)
        upscaler?.release()
        upscaler = null
    }

    /** Why this video plays without upscaling, if it does. */
    private fun upscalingBlock(format: Format): String? {
        val metrics = context.resources.displayMetrics
        return when {
            tunneling -> "tunneled"
            dolbyVision != null || ColorInfo.isTransferHdr(format.colorInfo) -> "HDR"
            format.height >= tooSlowHeight -> "too slow here"
            format.height * UpscaleNetwork.MIN_SCALE > min(metrics.widthPixels, metrics.heightPixels) -> "as large as the screen"
            else -> null
        }
    }

    private fun routeVideo() {
        val format = player.videoFormat
        useUpscaler(upscaler != null && format != null && upscalingBlock(format) == null)
    }

    private fun useUpscaler(on: Boolean) {
        val stage = stage ?: return
        val upscaler = upscaler
        if (on == upscaled) return
        upscaled = on
        if (on && upscaler != null) {
            player.videoFormat?.let { upscaler.setVideoSize(it.width, it.height) }
            upscaler.reset()
            player.setVideoSurface(upscaler.input)
            upscaler.attach(stage.video.holder)
        } else {
            upscaler?.detach(stage.video.holder)
            player.setVideoSurfaceView(stage.video)
        }
    }

    override fun property(name: String): String? = if (name == "hwdec-current") decoders["video"] else null

    override fun stats(): JsonObject = onMain {
        buildJsonObject {
            put("engine", "exoplayer")
            for ((type, name) in decoders) put("${type}Decoder", name)
            player.videoFormat?.let { video ->
                put("videoMime", video.sampleMimeType)
                put("videoCodecs", video.codecs)
                put("width", video.width)
                put("height", video.height)
                put("frameRate", video.frameRate)
                put("videoBitrate", video.bitrate)
                video.colorInfo?.let {
                    put("colorTransfer", it.colorTransfer)
                    put("colorSpace", it.colorSpace)
                }
            }
            player.audioFormat?.let { sound ->
                put("audioMime", sound.sampleMimeType)
                put("channels", sound.channelCount)
                put("sampleRate", sound.sampleRate)
                put("audioBitrate", sound.bitrate)
            }
            audioTrack?.let { track ->
                put("outputMime", AudioOutput.mimeOf(track.encoding))
                put("outputChannels", Integer.bitCount(track.channelConfig))
            }
            if (upscaling) {
                put(
                    "upscaling",
                    when {
                        upscaled -> "on"
                        upscalerFailed -> "off, not supported here"
                        else -> player.videoFormat?.let { format -> upscalingBlock(format)?.let { "off, $it" } } ?: "starting"
                    },
                )
            }
            val runtime = Runtime.getRuntime()
            put("javaHeap", runtime.totalMemory() - runtime.freeMemory())
            put("nativeHeap", Debug.getNativeHeapAllocatedSize())
            put("hdrTypes", JsonArray(caps.hdrTypes.sorted().map { JsonPrimitive(it) }))
            put("dolbyVisionProfiles", JsonArray(caps.dolbyVisionProfiles.sorted().map { JsonPrimitive(it) }))
            dolbyVision?.let { (codecs, route) ->
                put("dolbyVisionCodecs", codecs)
                put("dolbyVisionRoute", route.label)
            }
            put("bufferedMs", player.totalBufferedDuration)
            player.videoDecoderCounters?.let { counters ->
                counters.ensureUpdated()
                put("renderedFrames", counters.renderedOutputBufferCount)
                put("droppedFrames", counters.droppedBufferCount)
                put("skippedFrames", counters.skippedOutputBufferCount)
                put("maxConsecutiveDropped", counters.maxConsecutiveDroppedBufferCount)
                put("droppedToKeyframe", counters.droppedToKeyframeCount)
            }
            for ((key, value) in subtitles.stats()) put(key, value)
            for ((key, value) in cache.stats()) put(key, value)
            if (cache.caching && seekMap?.isSeekable == true) {
                val position = player.currentPosition.toDouble()
                val held = reported.buffered?.find { position >= it.startMs && position <= it.endMs }
                put("cacheBehindMs", held?.let { position - it.startMs } ?: 0.0)
            }
        }
    }

    /** The app read HDMI's formats again, which a change skipped for the old reading may need. */
    fun outputChanged() = main.post { selector.recheck() }

    override fun release() {
        // As mpv's engine does: a replaced engine reports nothing more, not even an error already on its way.
        listener = null
        main.post {
            released = true
            main.removeCallbacks(poll)
            main.removeCallbacks(settled)
            main.removeCallbacks(frameLate)
            stopRecovering()
            opens++
            stage?.video?.holder?.removeCallback(surfaceGoes)
            upscaling = false
            upscaler?.let { stage?.video?.holder?.removeCallback(it) }
            player.release()
            upscaler?.release()
            cache.release()
            subtitles.release()
            loader.shutdown()
        }
    }

    private fun stopRecovering() {
        recovering = false
        main.removeCallbacks(retryOutput)
    }

    /** Seeks to [ms] itself, not a keyframe near it, even where the player is already: Media3 skips a seek to the ms it is at. */
    private fun seekExactly(ms: Long) {
        player.setSeekParameters(SeekParameters.EXACT)
        if (ms != player.currentPosition) return player.seekTo(ms)
        if (ms > 0) return player.seekTo(ms - 1)
        // At 0 there is no earlier ms, and 1 ms would skip the first frame: through 1 ms back to 0 itself.
        player.seekTo(1)
        player.seekTo(0)
    }

    private fun open(request: LoadRequest) {
        selector.tracksKnown = false
        selector.forget()
        main.removeCallbacks(settled)
        forgetFrame()
        stopRecovering()
        outputRetries = 0
        if (url != null) listener?.onEnded("stop", null, null)
        http.setDefaultRequestProperties(request.headers)
        link.setDefaultRequestProperties(request.headers)
        url = request.url
        // The cache reconnects at an offset, which a live link can't serve.
        cache.play(request.url.takeUnless { request.live })
        options = TrackOptions(request)
        caps = MediaCaps.read(context)
        upscaler?.reset()
        dolbyVision = null
        audioTrack = null
        decoders.clear()
        loaded = false
        chosen = false
        restarting = true
        skips = emptyList()
        seekMap = null
        subtitles.open(readsTracks = !options.none)
        listener?.onEvent("start")
        state(PlayerState(idle = false))
        listener?.onChapters(emptyList())
        // Close to what mpv picks, so the first selection rarely changes.
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .clearOverrides()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, options.none)
            .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, false)
            .setPreferredAudioLanguages(*options.alang.toTypedArray())
            .setPreferredTextLanguages(*options.slang.toTypedArray())
            .build()
        loadErrors.live = request.live
        val opening = ++opens
        val uri = Uri.parse(request.url)
        if (request.live && Util.inferContentType(uri) == C.CONTENT_TYPE_OTHER && FileTypes.inferFileTypeFromUri(uri) == FileTypes.UNKNOWN) {
            loader.execute {
                val type = ManifestType.of(http.createDataSource(), request.url)
                main.post { if (opens == opening) prepare(request, type) }
            }
        } else {
            prepare(request, null)
        }
    }

    private fun prepare(request: LoadRequest, mimeType: String?) {
        val item = MediaItem.Builder().setUri(request.url).setMimeType(mimeType).build()
        // Any start position, 0 too, moves a live stream off its live edge.
        if (request.live) player.setMediaItem(item) else player.setMediaItem(item, request.startMs.toLong())
        player.prepare()
        updatePolling()
    }

    private fun chooseTracks() {
        val audio = tracks.chooseAudio(options)
        val subtitle = tracks.chooseSubtitle(options, tracks.languageOfTrack("audio", audio))
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .also { tracks.select(it, "audio", audio) }
            .also { tracks.select(it, "sub", subtitle) }
            .build()
    }

    /** Automatic skips are held from a little past their start, as the page skips once playback is in them. */
    private fun updateSkips() {
        val map = seekMap?.takeIf { it.isSeekable } ?: return cache.setSkips(emptyList(), emptyList())
        fun at(ms: Double, after: Boolean) = map.getSeekPoints((ms * 1000).toLong()).let { if (after) it.second else it.first }.position
        val (auto, offered) = skips.partition { it.auto }
        cache.setSkips(
            held = auto.map { at(it.startMs + SKIP_REACTION_MS, after = true) until at(it.endMs, after = false) }.filterNot { it.isEmpty() },
            landings = offered.map { at(it.endMs, after = false) until at(it.endMs + LANDING_MS, after = true) }.filterNot { it.isEmpty() },
        )
    }

    /** Past full, the sound processor raises the sound further. */
    private fun applyVolume() {
        val level = (volume / 100).toFloat()
        player.volume = if (muted) 0f else min(level, 1f)
        audio.levels.gain = max(level, 1f)
    }

    private fun selectTrack(type: String, id: Int?) {
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .also { tracks.select(it, type, id) }
            .build()
    }

    /** Ids past the file's own are the page's added files, as with mpv. */
    private fun selectSubtitle(id: Int?) {
        val added = subtitles.selectExternal(id)
        selectTrack("sub", id.takeIf { !added })
        reportTracks()
        showSubtitles()
    }

    private fun removeSubtitle(id: Int) {
        val shown = subtitles.external?.id == id
        if (!subtitles.remove(id)) return
        if (shown) selectSubtitle(null) else reportTracks()
    }

    private fun showSubtitles() = subtitles.show(tracks.format("sub"), chosen)

    private fun read(url: String): ByteArray {
        val source = data.createDataSource()
        return try {
            source.open(DataSpec(Uri.parse(url)))
            DataSourceUtil.readToEnd(source)
        } finally {
            source.close()
        }
    }

    // Tunneled frames skip the frame callbacks, so subtitles follow the playback clock.
    private val clock = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!tunneling || !player.isPlaying) return
            subtitles.clock(player.currentPosition * 1000, frameTimeNanos)
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    private fun updateClock() {
        Choreographer.getInstance().removeFrameCallback(clock)
        if (tunneling && player.isPlaying) Choreographer.getInstance().postFrameCallback(clock)
    }

    private fun reportTracks() {
        listener?.onTracks(tracks.list() + subtitles.externals.map { it.track() })
        val subtitle = subtitles.external?.id ?: tracks.selected("sub")
        state(PlayerState(audio = Pick(tracks.selected("audio")?.toString()), subtitle = Pick(subtitle?.toString())))
    }

    /** The file's chapters, which Media3 gives every track's format. */
    private fun reportChapters() {
        val metadata = tracks.format("video")?.metadata ?: tracks.format("audio")?.metadata ?: return
        val chapters = (0 until metadata.length()).map(metadata::get).filterIsInstance<Chapter>().filterNot { it.isHidden }
        listener?.onChapters(
            chapters.sortedBy { it.startTimeMs }.map { PlayerChapter(it.title?.value, it.startTimeMs.toDouble()) },
        )
    }

    /** Paused or waiting, polls go on while the cache fills, until nothing changes. */
    private val poll = object : Runnable {
        override fun run() {
            val grew = reportPosition()
            idlePolls = if (player.isPlaying || grew) 0 else idlePolls + 1
            if (url != null && idlePolls < IDLE_POLLS) main.postDelayed(this, pollMs())
        }
    }

    private fun pollMs() = if (player.isPlaying) POLL_MS else IDLE_POLL_MS

    private fun updatePolling() {
        main.removeCallbacks(poll)
        idlePolls = 0
        if (url != null) main.postDelayed(poll, pollMs())
        reportPosition()
    }

    /** True when what's buffered changed. */
    private fun reportPosition(): Boolean {
        if (url == null) return false
        val stalled = loaded && !seeking && player.playWhenReady && player.playbackState == Player.STATE_BUFFERING
        cache.setPlayer(player.totalBufferedDuration * 1000, player.isPlaying && !seeking || stalled)
        subtitles.trim(player.currentPosition * 1000)
        sendLines()
        val buffered = bufferedRanges(
            positionUs = player.currentPosition * 1000,
            bufferedUs = player.bufferedPosition * 1000,
            map = seekMap?.takeIf { it.isSeekable },
            held = cache.held(),
        )
        val grew = buffered != reported.buffered
        state(PlayerState(positionMs = player.currentPosition.toDouble(), buffered = buffered))
        return grew
    }

    /** The reader's name for [reference]. */
    private fun referenceKey() = reference?.let { tracks.format("sub", it) }?.id?.substringAfter(':')

    private fun sendLines() {
        val track = reference ?: return
        val read = subtitles.takeLines()
        if (read.isNotEmpty()) listener?.onSubtitleLines(track.toString(), read)
    }

    private fun state(update: PlayerState) {
        val changed = update.changesFrom(reported)
        reported = reported.then(update)
        if (changed != PlayerState()) listener?.onState(changed)
    }

    private fun post(block: () -> Unit) {
        main.post { runCatching(block).onFailure { AppLog.e(TAG, "player call failed", it) } }
    }

    private fun <T> onMain(block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        var result: Result<T>? = null
        val done = CountDownLatch(1)
        main.post {
            result = runCatching(block)
            done.countDown()
        }
        done.await(2, TimeUnit.SECONDS)
        return result?.getOrThrow() ?: error("the player didn't answer")
    }

    private inner class Reading : ExtractorHost {
        override val readBackTrack get() = subtitles.readBack

        override fun subtitles(): SubtitleSink = subtitles.sink()

        override fun skipping(uri: Uri, position: Long, length: Long) = cache.skipping(uri, position, length)

        override fun attachments(found: Attachments) {
            main.post { if (found.uri.toString() == url) subtitles.loadFonts(found) }
        }

        override fun route(profile: Int) = dolbyVisionRoute(profile, caps, useDolbyVision)

        override fun routed(codecs: String, route: DolbyVisionRoute) {
            dolbyVision = codecs to route
        }

        override fun seekMap(map: SeekMap) {
            main.post {
                seekMap = map
                updateSkips()
            }
        }

        override fun videoFrame(timeUs: Long) = frames.add(timeUs)
    }

    private inner class Events : Player.Listener, AnalyticsListener, VideoFrameMetadataListener {
        override fun onPlaybackStateChanged(state: Int) {
            when (state) {
                Player.STATE_READY -> {
                    if (!loaded) {
                        loaded = true
                        listener?.onEvent("loaded")
                        player.duration.takeIf { it != C.TIME_UNSET }?.let { state(PlayerState(durationMs = it.toDouble())) }
                    }
                    if (restarting) {
                        restarting = false
                        seeking = false
                        state(PlayerState(seeking = false))
                        listener?.onEvent("restart")
                    }
                    holdingFrame = false
                    state(PlayerState(buffering = false))
                }
                Player.STATE_BUFFERING -> if (loaded && !seeking && !holdingFrame) state(PlayerState(buffering = true))
                Player.STATE_ENDED -> {
                    url = null
                    listener?.onEnded("eof", null, null)
                    state(PlayerState(idle = true))
                }
            }
            reportPosition()
        }

        // Before the first frame, so the start rule has the file's bitrate.
        override fun onTimelineChanged(timeline: Timeline, reason: Int) {
            player.duration.takeIf { it != C.TIME_UNSET }?.let { cache.setDurationUs(it * 1000) }
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            wantsPlay = playWhenReady
            if (playWhenReady) {
                anchorUs = C.TIME_UNSET
                // Played before the paused frame is ready: that wait is a real one.
                if (holdingFrame && player.playbackState == Player.STATE_BUFFERING) state(PlayerState(buffering = true))
                holdingFrame = false
            }
            state(PlayerState(paused = !playWhenReady))
            updatePolling()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            playingNow = isPlaying
            updatePolling()
            updateClock()
        }

        override fun onPlaybackParametersChanged(parameters: PlaybackParameters) =
            state(PlayerState(speed = parameters.speed.toDouble()))

        override fun onPositionDiscontinuity(old: Player.PositionInfo, new: Player.PositionInfo, reason: Int) {
            // The frame last shown belongs to where the file was before.
            if (reason == Player.DISCONTINUITY_REASON_SEEK || reason == Player.DISCONTINUITY_REASON_SEEK_ADJUSTMENT) {
                lastFrameUs = C.TIME_UNSET
                takeNextFrame = true
            }
        }

        override fun onVideoSizeChanged(size: VideoSize) {
            stage?.videoSize = size
            if (size.width == 0 || size.height == 0) return
            if (upscaled) upscaler?.setVideoSize(size.width, size.height)
            subtitles.videoSized(size.width, size.height)
            listener?.onVideo(width = (size.width * size.pixelWidthHeightRatio).toInt(), height = size.height)
        }

        override fun onTracksChanged(tracks: Tracks) {
            this@ExoEngine.tracks.update(tracks)
            if (!tracks.isEmpty) selector.tracksKnown = true
            val audioMime = selectedMime(tracks, C.TRACK_TYPE_AUDIO)
            // Another sound track was picked: a change skipped for the one before is no longer the question.
            if (audioMime != selector.audioMime) selector.forgetSkipped()
            selector.audioMime = audioMime
            if (!chosen && !this@ExoEngine.tracks.isEmpty()) {
                chosen = true
                Failures.undecodable(tracks)?.let { error ->
                    url = null
                    // Stopped with no period playing: Media3 can't re-pick tracks for a changed output now.
                    selector.tracksKnown = false
                    player.stop()
                    listener?.onUnplayable(error)
                    return
                }
                chooseTracks()
            }
            reportTracks()
            reportChapters()
            showSubtitles()
            subtitles.watchLines(referenceKey())
        }

        override fun onCues(cueGroup: CueGroup) = subtitles.onCues(cueGroup.cues)

        override fun onRenderedFirstFrame() = subtitles.firstFrameShown()

        override fun onPlayerError(error: PlaybackException) {
            // What follows an error (a retry, a new start) is a real wait, not the paused frame's quiet seek.
            holdingFrame = false
            // The file already failed or stopped. Media3 can still raise a second error for it, such as the
            // NullPointerException a capabilities change queued before the first error throws on the emptied queue.
            if (url == null) {
                AppLog.i(TAG, "a later error for a file that already ended (${error.errorCodeName}): ${error.cause?.message}")
                return
            }
            if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                player.seekToDefaultPosition()
                player.prepare()
                return
            }
            if (recovering) {
                AppLog.i(TAG, "a later error while the audio output settles (${error.errorCodeName}): ${error.cause?.message}")
                return
            }
            // HDMI linking again breaks the audio track for a while; the output it had comes back once it settles.
            if (error.errorCode in AUDIO_OUTPUT_ERRORS && outputRetries < MAX_OUTPUT_RETRIES) {
                // Only a break no known relink explains counts: those of HDMI linking again end with the relink.
                val known = outputSettling() || waiting()
                if (!known) {
                    outputBroke()
                    outputRetries++
                }
                recovering = true
                // The failed file has no playing period until it is prepared again; Media3 throws on a re-pick then.
                selector.tracksKnown = false
                recoveringSince = SystemClock.uptimeMillis()
                AppLog.i(TAG, "the audio output broke while HDMI settles (${error.errorCodeName}); waiting to play on${if (known) "" else ", try $outputRetries"}")
                main.removeCallbacks(retryOutput)
                main.postDelayed(retryOutput, SETTLE_POLL_MS)
                return
            }
            url = null
            selector.tracksKnown = false
            AppLog.w(TAG, "playback failed (${error.errorCodeName})", error)
            state(PlayerState(idle = true))
            // mpv can't load a link that failed to either; anything else it may well play.
            if (!Failures.isLink(error)) return listener?.onUnplayable(Failures.unplayable(error)) ?: Unit
            val (message, cause) = Failures.linkFailure(error)
            listener?.onEnded("error", message, cause)
        }

        override fun onVideoFrameAboutToBeRendered(
            presentationTimeUs: Long,
            releaseTimeNs: Long,
            format: Format,
            mediaFormat: MediaFormat?,
        ) {
            if (playingNow || takeNextFrame) {
                lastFrameUs = presentationTimeUs
                takeNextFrame = false
            }
            subtitles.frame(presentationTimeUs, releaseTimeNs)
        }

        override fun onVideoInputFormatChanged(
            eventTime: AnalyticsListener.EventTime,
            format: Format,
            decoderReuseEvaluation: DecoderReuseEvaluation?,
        ) {
            if (format.frameRate > 0) listener?.onVideo(frameRate = format.frameRate.toDouble())
            routeVideo()
            upscaler?.setFrameRate(format.frameRate.coerceAtLeast(0f))
        }

        override fun onVideoDecoderInitialized(
            eventTime: AnalyticsListener.EventTime,
            decoderName: String,
            initializedTimestampMs: Long,
            initializationDurationMs: Long,
        ) {
            decoders["video"] = decoderName
        }

        override fun onAudioDecoderInitialized(
            eventTime: AnalyticsListener.EventTime,
            decoderName: String,
            initializedTimestampMs: Long,
            initializationDurationMs: Long,
        ) {
            decoders["audio"] = decoderName
        }

        override fun onAudioTrackInitialized(eventTime: AnalyticsListener.EventTime, audioTrackConfig: AudioSink.AudioTrackConfig) {
            audioTrack = audioTrackConfig
            val passthrough = !Util.isEncodingLinearPcm(audioTrackConfig.encoding)
            if (passthrough) decoders.remove("audio")
            state(PlayerState(passthrough = passthrough))
        }
    }

    private companion object {
        const val TAG = "exo"
        const val POLL_MS = 250L
        const val HOLD_FRAME_MAX_MS = 5_000L
        const val FRAME_LATE_MS = 1_000L
        const val SETTLE_POLL_MS = 250L
        const val AWAY_POLL_MS = 1000L
        const val MAX_OUTPUT_RETRIES = 3
        const val MAX_SETTLE_WAIT_MS = 20_000L
        // Dolby and DTS sample types, in mpv's names as the app reads the output's formats.
        val SPDIF_NAMES = mapOf(
            MimeTypes.AUDIO_AC3 to "ac3",
            MimeTypes.AUDIO_E_AC3 to "eac3",
            MimeTypes.AUDIO_E_AC3_JOC to "eac3",
            MimeTypes.AUDIO_DTS to "dts",
            MimeTypes.AUDIO_DTS_HD to "dts-hd",
            MimeTypes.AUDIO_DTS_X to "dts-hd",
            MimeTypes.AUDIO_TRUEHD to "truehd",
        )
        val AUDIO_OUTPUT_ERRORS = setOf(
            PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED,
            PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED,
        )
        const val IDLE_POLL_MS = 1000L
        const val IDLE_POLLS = 10
        const val VOLUME_MAX = 130.0
        const val LANDING_MS = 10_000.0
        const val SKIP_REACTION_MS = 2_000.0
    }
}
