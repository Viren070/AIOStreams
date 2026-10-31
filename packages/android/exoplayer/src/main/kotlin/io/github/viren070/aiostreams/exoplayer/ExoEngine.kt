package io.github.viren070.aiostreams.exoplayer

import android.content.Context
import android.media.MediaFormat
import android.net.Uri
import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Choreographer
import android.view.View
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaLibraryInfo
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
import io.github.viren070.aiostreams.exoplayer.video.MediaCaps
import io.github.viren070.aiostreams.exoplayer.video.VideoFrames
import io.github.viren070.aiostreams.exoplayer.video.dolbyVisionRoute
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
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
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
    private val audio = AudioOutput()
    private val tracks = ExoTracks()
    private val events = Events()
    private val player = ExoPlayer.Builder(context, Renderers(context, audio), DefaultMediaSourceFactory(data, Extractors(Reading())))
        // The app keeps audio focus and pauses for noise itself.
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), false)
        .setHandleAudioBecomingNoisy(false)
        .setLoadControl(BufferControl(cache))
        // A TV's own decoder for passed-through sound can take several seconds to start after a load or seek
        // (DTS:X on MediaTek), and the default 10 s reads that as stuck and moves to mpv.
        .setStuckPlayingDetectionTimeoutMs(STUCK_PLAYING_MS)
        .build()

    private var listener: Engine.Listener? = null

    @Volatile
    private var reported = PlayerState()
    private var stage: Stage? = null
    private val decoders = ConcurrentHashMap<String, String>()

    // The file playing and what the page asked of it.
    private var url: String? = null
    private var options = TrackOptions(null)
    private var loaded = false
    private var chosen = false
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
        player.setVideoSurfaceView(stage.video)
    }

    // Exo has no queue of its own, so a file to play next waits for the page to load it.
    override fun load(request: LoadRequest) = post { if (!request.append) open(request) }

    override fun stop() = post {
        if (url == null) return@post
        url = null
        player.stop()
        player.clearMediaItems()
        cache.play(null)
        subtitles.close()
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
            }.onFailure { Log.w(TAG, "couldn't add the subtitle", it) }
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

    override fun setSettings(settings: PlayerSettings) = post {
        audio.setSettings(settings)
        cache.limitMb = settings.cacheMb
    }

    override fun setDolbyVision(on: Boolean) {
        useDolbyVision = on
    }

    override fun setSound(sound: Sound) = audio.setSound(sound)

    fun setTunneling(on: Boolean) = main.post {
        val selector = player.trackSelector as? DefaultTrackSelector ?: return@post
        selector.setParameters(selector.buildUponParameters().setTunnelingEnabled(on))
        tunneling = on
        updateClock()
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

    override fun release() {
        main.post {
            main.removeCallbacks(poll)
            player.release()
            cache.release()
            subtitles.release()
            loader.shutdown()
        }
    }

    private fun open(request: LoadRequest) {
        if (url != null) listener?.onEnded("stop", null, null)
        http.setDefaultRequestProperties(request.headers)
        link.setDefaultRequestProperties(request.headers)
        url = request.url
        cache.play(request.url)
        options = TrackOptions(request)
        caps = MediaCaps.read(context)
        dolbyVision = null
        audioTrack = null
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
        player.setMediaItem(MediaItem.fromUri(request.url), request.startMs.toLong())
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
        main.post { runCatching(block).onFailure { Log.w(TAG, "player call failed", it) } }
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
                    state(PlayerState(buffering = false))
                }
                Player.STATE_BUFFERING -> if (loaded && !seeking) state(PlayerState(buffering = true))
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
            state(PlayerState(paused = !playWhenReady))
            updatePolling()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            updatePolling()
            updateClock()
        }

        override fun onPlaybackParametersChanged(parameters: PlaybackParameters) =
            state(PlayerState(speed = parameters.speed.toDouble()))

        override fun onVideoSizeChanged(size: VideoSize) {
            stage?.videoSize = size
            if (size.width == 0 || size.height == 0) return
            subtitles.videoSized(size.width, size.height)
            listener?.onVideo(width = (size.width * size.pixelWidthHeightRatio).toInt(), height = size.height)
        }

        override fun onTracksChanged(tracks: Tracks) {
            this@ExoEngine.tracks.update(tracks)
            if (!chosen && !this@ExoEngine.tracks.isEmpty()) {
                chosen = true
                Failures.undecodable(tracks)?.let { error ->
                    url = null
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
            url = null
            Log.w(TAG, "playback failed", error)
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
        ) = subtitles.frame(presentationTimeUs, releaseTimeNs)

        override fun onVideoInputFormatChanged(
            eventTime: AnalyticsListener.EventTime,
            format: Format,
            decoderReuseEvaluation: DecoderReuseEvaluation?,
        ) {
            if (format.frameRate > 0) listener?.onVideo(frameRate = format.frameRate.toDouble())
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
            state(PlayerState(passthrough = !Util.isEncodingLinearPcm(audioTrackConfig.encoding)))
        }
    }

    private companion object {
        const val TAG = "exo"
        const val POLL_MS = 250L
        const val IDLE_POLL_MS = 1000L
        const val IDLE_POLLS = 10
        const val VOLUME_MAX = 130.0
        const val LANDING_MS = 10_000.0
        const val SKIP_REACTION_MS = 2_000.0
        const val STUCK_PLAYING_MS = 30_000
    }
}
