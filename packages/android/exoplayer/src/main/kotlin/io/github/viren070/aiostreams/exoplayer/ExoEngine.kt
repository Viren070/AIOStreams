package io.github.viren070.aiostreams.exoplayer

import android.content.Context
import android.graphics.Rect
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
import androidx.media3.common.MimeTypes
import androidx.media3.common.ParserException
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.text.Cue
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.datasource.DataSourceUtil
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlaybackException
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.UnrecognizedInputFormatException
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.video.VideoFrameMetadataListener
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.metadata.Chapter
import io.github.viren070.aiostreams.mpv.MpvEngine
import io.github.viren070.aiostreams.playback.CacheBudget
import io.github.viren070.aiostreams.playback.Change
import io.github.viren070.aiostreams.playback.Engine
import io.github.viren070.aiostreams.playback.Fit
import io.github.viren070.aiostreams.playback.LoadRequest
import io.github.viren070.aiostreams.playback.Pick
import io.github.viren070.aiostreams.playback.PlayerChapter
import io.github.viren070.aiostreams.playback.PlayerSettings
import io.github.viren070.aiostreams.playback.PlayerState
import io.github.viren070.aiostreams.playback.PlayerTrack
import io.github.viren070.aiostreams.playback.Skip
import io.github.viren070.aiostreams.playback.Sound
import io.github.viren070.aiostreams.playback.Style
import io.github.viren070.aiostreams.playback.TimeRange
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * ExoPlayer. libass draws ASS subtitles over the video; the player's subtitle
 * view draws the rest.
 */
@OptIn(UnstableApi::class)
class ExoEngine(private val context: Context) :
    Engine, Player.Listener, AnalyticsListener, VideoFrameMetadataListener {
    private val main = Handler(Looper.getMainLooper())
    private val loader = Executors.newSingleThreadExecutor { Thread(it, "exo-loader") }
    private val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true)
    private val link = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true).setReadTimeoutMs(0)
    private val cache = StreamCache(context, http, link)
    private val data = DefaultDataSource.Factory(context, cache.factory)
    private val ass = AssSurface(context) { MpvEngine.fallbackFont(context) }
    private val fontsDir = File(context.cacheDir, "attached-fonts")
    private val player: ExoPlayer
    private val tracks = ExoTracks()
    private val levels = SoundLevels()
    private lateinit var ac3: Ac3Sink
    private lateinit var output: OutputSink
    private val style = SubtitleStyle()
    @Volatile
    private var reported = PlayerState()
    private val decoders = ConcurrentHashMap<String, String>()
    private var listener: Engine.Listener? = null
    private var stage: Stage? = null
    private var layout = AssLayout()
    private var sentLayout: AssLayout? = null

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
    private val externals = mutableListOf<ExternalSubtitle>()
    private var skips: List<Skip> = emptyList()
    private var seekMap: SeekMap? = null
    private var fonts: AttachedFonts? = null

    @Volatile
    private var shown = false
    private val texts = TextTracks { delayUs }
    private val subtitleLines = SubtitleLines()
    /** The file's own subtitle whose lines the page asked for. */
    private var reference: Int? = null
    private var shownCues: List<Cue> = emptyList()

    // Read on the playback thread too.
    @Volatile
    private var external: ExternalSubtitle? = null

    /** The text subtitle the engine times itself, rather than the player. */
    @Volatile
    private var text: TextTimeline? = null

    @Volatile
    private var readBack: String? = null

    @Volatile
    private var delayUs = 0L

    @Volatile
    private var lastFrameUs = 0L

    @Volatile
    private var lastFrameAtNs = 0L

    @Volatile
    private var caps = MediaCaps(emptySet(), emptySet())

    /** The Dolby Vision track's codec string and how it plays, once the file says it has one. */
    @Volatile
    private var dolbyVision: Pair<String, DolbyVisionRoute>? = null

    /** What the sound goes out as, after passthrough, mixing or re-encoding. */
    @Volatile
    private var audioTrack: AudioSink.AudioTrackConfig? = null

    private var tunneling = false

    @Volatile
    private var useDolbyVision = true

    @Volatile
    private var ac3Encode = false

    init {
        fontsDir.deleteRecursively()
        if (CacheBudget.small(context)) ass.setCacheLimit(SMALL_ASS_CACHE_MB)
        cache.onMemoryShort = { ass.setCacheLimit(SHORT_ASS_CACHE_MB) }
        val extractors = Extractors(
            readBack = { readBack },
            sink = { subtitleLines.sink(SubtitleSink(ass.sink(), texts.sink())) },
            route = { dolbyVisionRoute(it, caps, useDolbyVision) },
            onRoute = { codecs, route -> dolbyVision = codecs to route },
            onSeekMap = { map ->
                main.post {
                    seekMap = map
                    updateSkips()
                }
            },
            events = object : MatroskaEvents {
                override fun skipping(uri: Uri, position: Long, length: Long) = cache.skipping(uri, position, length)

                override fun attachments(uri: Uri, position: Long, length: Long?) {
                    main.post { loadFonts(uri, position, length) }
                }
            },
        )
        val sources = DefaultMediaSourceFactory(data, extractors)
        val renderers = object : DefaultRenderersFactory(context) {
            override fun buildAudioSink(
                context: Context,
                enableFloatOutput: Boolean,
                enableAudioOutputPlaybackParameters: Boolean,
            ): AudioSink {
                val sink = DefaultAudioSink.Builder(context)
                    .setEnableFloatOutput(enableFloatOutput)
                    .setEnableAudioOutputPlaybackParameters(enableAudioOutputPlaybackParameters)
                    .setAudioProcessors(arrayOf(SoundProcessor(levels)))
                    .build()
                ac3 = Ac3Sink(sink, levels)
                output = OutputSink(ac3)
                return output
            }

            // After the device's own decoders, for what they can't play, such as TrueHD. DTS skips them, as some play silence.
            override fun buildAudioRenderers(
                context: Context,
                extensionRendererMode: Int,
                mediaCodecSelector: MediaCodecSelector,
                enableDecoderFallback: Boolean,
                audioSink: AudioSink,
                eventHandler: Handler,
                eventListener: AudioRendererEventListener,
                out: ArrayList<Renderer>,
            ) {
                val decoders = MediaCodecSelector { mime, secure, tunneling ->
                    if (mime in DTS) emptyList() else mediaCodecSelector.getDecoderInfos(mime, secure, tunneling)
                }
                out += SeekAudioRenderer(context, codecAdapterFactory, decoders, enableDecoderFallback, eventHandler, eventListener, audioSink)
                out += FfmpegAudioRenderer(eventHandler, eventListener, audioSink)
            }
        }
            .setEnableDecoderFallback(true)
        val audio = AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build()
        player = ExoPlayer.Builder(context, renderers, sources)
            // The app keeps audio focus and pauses for noise itself.
            .setAudioAttributes(audio, false)
            .setHandleAudioBecomingNoisy(false)
            .setLoadControl(BufferControl(cache))
            .build()
        player.addListener(this)
        player.addAnalyticsListener(this)
        player.setVideoFrameMetadataListener(this)
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

    override fun createView(context: Context): View = Stage(context, ::onStageLayout).also { stage ->
        this.stage = stage
        stage.addLayer(ass.view)
        style.apply(stage.subtitles)
        player.setVideoSurfaceView(stage.video)
    }

    private fun post(block: () -> Unit) {
        main.post { runCatching(block).onFailure { Log.w(TAG, "player call failed", it) } }
    }

    // Exo has no queue of its own, so a file to play next waits for the page to load it.
    override fun load(request: LoadRequest) = post { if (!request.append) open(request) }

    override fun stop() = post {
        if (url == null) return@post
        url = null
        player.stop()
        player.clearMediaItems()
        cache.play(null)
        closeFonts()
        clearExternals()
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
        change.subtitleDelayMs?.let {
            delayUs = (it * 1000).toLong()
            redrawSubtitles()
        }
    }

    override fun seek(positionMs: Double, snapMs: Double) = post {
        val snapUs = (snapMs * 1000).toLong()
        seekTo(positionMs.toLong(), if (snapUs > 0) SeekParameters(snapUs, snapUs) else SeekParameters.EXACT)
    }

    override fun addSubtitle(url: String, title: String?, language: String?, replace: Int?) = post {
        replace?.let(::removeSubtitle)
        addSubtitle(url, "select", title, language)
    }

    override fun watchSubtitleLines(track: String?) = post {
        reference = track?.toIntOrNull()
        subtitleLines.watch(referenceKey())
        sendLines()
    }

    override fun setSkips(skips: List<Skip>) = post {
        this.skips = skips
        updateSkips()
    }

    override fun setStyle(style: Style) = post {
        stage?.keepAspect = style.fit != Fit.STRETCH
        stage?.panscan = if (style.fit == Fit.CROP) 1.0 else 0.0
        this.style.apply(style.subtitles, forceMargins = style.fit == Fit.CROP)
        stage?.let { this.style.apply(it.subtitles) }
        updateLayout()
        showSubtitles()
    }

    override fun setSettings(settings: PlayerSettings) = post {
        output.setSpdif(settings.passthrough.joinToString(","))
        updateEncoding()
        output.delayUs = (settings.audioDelayMs * 1000).toLong()
        levels.maxChannels = CHANNELS[settings.audioChannels] ?: 0
        cache.limitMb = settings.cacheMb
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
            player.audioFormat?.let { audio ->
                put("audioMime", audio.sampleMimeType)
                put("channels", audio.channelCount)
                put("sampleRate", audio.sampleRate)
                put("audioBitrate", audio.bitrate)
            }
            audioTrack?.let { track ->
                put("outputMime", mimeOf(track.encoding))
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
            for ((key, value) in ass.stats()) put(key, value)
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
            closeFonts()
            ass.release()
            loader.shutdown()
        }
    }

    private fun open(request: LoadRequest) {
        if (this.url != null) listener?.onEnded("stop", null, null)
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
        clearExternals()
        closeFonts()
        shown = false
        skips = emptyList()
        seekMap = null
        ass.reset()
        texts.reset()
        subtitleLines.reset()
        readBack = if (options.none) null else Extractors.ANY_TRACK
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

    private fun seekTo(ms: Long, parameters: SeekParameters) {
        if (url == null) return
        player.setSeekParameters(parameters)
        player.seekTo(ms.coerceAtLeast(0))
        seeking = true
        restarting = true
        state(PlayerState(seeking = true))
        updatePolling()
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

    private fun loadFonts(uri: Uri, position: Long, length: Long?) {
        if (fonts != null || uri.toString() != url) return
        val dir = File(fontsDir, System.nanoTime().toString())
        fonts = AttachedFonts(DefaultDataSource.Factory(context, http), uri, position, length, ass.sink(), dir, ::fontsMayLoad)
            .also { it.start() }
    }

    private fun closeFonts() {
        fonts?.close()
        fonts = null
        fontsDir.deleteRecursively()
    }

    private fun fontsMayLoad(bytes: Long) = bytes <= SMALL_FONTS_BYTES || shown && (!cache.caching || cache.canSpare(bytes))

    override fun onRenderedFirstFrame() {
        shown = true
    }

    /** Past full, the sound processor raises the sound further. */
    private fun applyVolume() {
        val level = (volume / 100).toFloat()
        player.volume = if (muted) 0f else min(level, 1f)
        levels.gain = max(level, 1f)
    }

    private fun selectTrack(type: String, id: Int?) {
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .also { tracks.select(it, type, id) }
            .build()
    }

    /** Ids past the file's own are the page's added files, as with mpv. */
    private fun selectSubtitle(id: Int?) {
        external = externals.find { it.id == id }
        selectTrack("sub", id.takeIf { external == null })
        reportTracks()
        showSubtitles()
    }

    private fun selectedSubtitle(): Int? = external?.id ?: tracks.selected("sub")

    private fun addSubtitle(url: String, flags: String?, title: String?, lang: String?) {
        externals.find { it.url == url }?.let { found ->
            if (flags == "select") selectSubtitle(found.id)
            return
        }
        val file = this.url
        loader.execute {
            runCatching {
                val bytes = read(url)
                main.post {
                    if (this.url != file) return@post
                    val id = maxOf(tracks.count("sub"), externals.maxOfOrNull { it.id } ?: 0) + 1
                    val added = ExternalSubtitle.parse(id, url, title, lang, bytes)
                    added.script?.let { ass.addScript(added.key, it) }
                    externals += added
                    if (flags == "select") selectSubtitle(id) else reportTracks()
                }
            }.onFailure { Log.w(TAG, "couldn't add the subtitle", it) }
        }
    }

    private fun removeSubtitle(id: Int?) {
        val removed = externals.find { it.id == id } ?: return
        externals -= removed
        ass.removeScript(removed.key)
        if (external == removed) selectSubtitle(null) else reportTracks()
    }

    private fun clearExternals() {
        external = null
        externals.clear()
    }

    private fun read(url: String): ByteArray {
        val source = data.createDataSource()
        return try {
            source.open(DataSpec(Uri.parse(url)))
            DataSourceUtil.readToEnd(source)
        } finally {
            source.close()
        }
    }

    private fun showSubtitles() {
        val added = external
        val format = tracks.format("sub")
        val id = format?.id?.substringAfter(':')
        ass.select(
            when {
                !style.visible -> null
                added != null -> added.key.takeIf { added.script != null }
                format != null && isAss(format) -> id
                else -> null
            },
        )
        text = when {
            !style.visible -> null
            added != null -> added.text
            format != null && !isAss(format) -> id?.let(texts::get)
            else -> null
        }
        if (chosen) readBack = id.takeIf { style.visible && added == null }
        shownCues = emptyList()
        stage?.subtitles?.setCues(emptyList())
        showCues(lastFrameUs)
    }

    private fun redrawSubtitles() {
        ass.invalidate()
        showCues(lastFrameUs)
    }

    // Each video frame, as it is handed to the screen: the subtitles follow the picture.
    override fun onVideoFrameAboutToBeRendered(
        presentationTimeUs: Long,
        releaseTimeNs: Long,
        format: Format,
        mediaFormat: MediaFormat?,
    ) {
        lastFrameUs = presentationTimeUs
        lastFrameAtNs = System.nanoTime()
        ass.render(presentationTimeUs - delayUs, releaseTimeNs)
        if (text != null) main.post { showCues(presentationTimeUs) }
    }

    override fun setDolbyVision(on: Boolean) {
        useDolbyVision = on
    }

    override fun setSound(sound: Sound) {
        levels.centreGain = 10f.pow(sound.dialogueBoost / 20f)
        levels.nightMode = sound.nightMode
        ac3Encode = sound.ac3Encode
        updateEncoding()
    }

    /** Encoding to Dolby Digital needs it to pass through. */
    private fun updateEncoding() {
        ac3.enabled = ac3Encode && MimeTypes.AUDIO_AC3 in output.passthrough
    }

    fun setTunneling(on: Boolean) = main.post {
        val selector = player.trackSelector as? DefaultTrackSelector ?: return@post
        selector.setParameters(selector.buildUponParameters().setTunnelingEnabled(on))
        tunneling = on
        updateClock()
    }

    // Tunneled frames skip the frame callbacks, so subtitles follow the playback clock.
    private val clock = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!tunneling || !player.isPlaying) return
            if (System.nanoTime() - lastFrameAtNs > FRAMES_STOPPED_NS) {
                val us = player.currentPosition * 1000
                lastFrameUs = us
                ass.render(us - delayUs, frameTimeNanos)
                showCues(us)
            }
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    private fun updateClock() {
        Choreographer.getInstance().removeFrameCallback(clock)
        if (tunneling && player.isPlaying) Choreographer.getInstance().postFrameCallback(clock)
    }

    override fun onVideoInputFormatChanged(
        eventTime: AnalyticsListener.EventTime,
        format: Format,
        decoderReuseEvaluation: DecoderReuseEvaluation?,
    ) {
        if (format.frameRate > 0) listener?.onVideo(frameRate = format.frameRate.toDouble())
    }

    private fun showCues(frameUs: Long) {
        val cues = text?.cuesAt(frameUs - delayUs) ?: return
        if (cues == shownCues) return
        shownCues = cues
        stage?.subtitles?.setCues(cues.map(::unplaced))
    }

    override fun onCues(cueGroup: CueGroup) {
        if (text == null && external == null) stage?.subtitles?.setCues(if (style.visible) cueGroup.cues.map(::unplaced) else emptyList())
    }

    private fun onStageLayout(width: Int, height: Int, video: Rect) {
        layout = layout.copy(stageWidth = width, stageHeight = height, video = video)
        updateLayout()
    }

    private fun updateLayout() {
        val next = layout.copy(
            scale = style.scale,
            position = style.position,
            forceMargins = style.forceMargins,
            style = style.assStyle(),
        )
        layout = next
        if (next == sentLayout) return
        sentLayout = next
        ass.setLayout(next)
    }

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
        layout = layout.copy(videoWidth = size.width, videoHeight = size.height)
        updateLayout()
        listener?.onVideo(width = (size.width * size.pixelWidthHeightRatio).toInt(), height = size.height)
    }

    override fun onTracksChanged(tracks: Tracks) {
        this.tracks.update(tracks)
        if (!chosen && !this.tracks.isEmpty()) {
            chosen = true
            undecodable(tracks)?.let { error ->
                url = null
                player.stop()
                listener?.onUnplayable(error)
                return
            }
            val audio = this.tracks.chooseAudio(options)
            val subtitle = this.tracks.chooseSubtitle(options, this.tracks.languageOfTrack("audio", audio))
            player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                .also { this.tracks.select(it, "audio", audio) }
                .also { this.tracks.select(it, "sub", subtitle) }
                .build()
        }
        reportTracks()
        reportChapters()
        showSubtitles()
        subtitleLines.watch(referenceKey())
    }

    private fun reportTracks() {
        val added = externals.map { sub ->
            PlayerTrack(
                id = sub.id.toString(),
                type = "subtitle",
                title = sub.title,
                language = sub.lang,
                codec = sub.codec,
                external = true,
                url = sub.url,
            )
        }
        listener?.onTracks(tracks.list() + added)
        state(
            PlayerState(
                audio = Pick(tracks.selected("audio")?.toString()),
                subtitle = Pick(selectedSubtitle()?.toString()),
            ),
        )
    }

    /** The file's chapters, which Media3 gives every track's format. */
    private fun reportChapters() {
        val metadata = tracks.format("video")?.metadata ?: tracks.format("audio")?.metadata ?: return
        val chapters = (0 until metadata.length()).map(metadata::get).filterIsInstance<Chapter>().filterNot { it.isHidden }
        listener?.onChapters(
            chapters.sortedBy { it.startTimeMs }.map { PlayerChapter(it.title?.value, it.startTimeMs.toDouble()) },
        )
    }

    override fun onPlayerError(error: PlaybackException) {
        url = null
        Log.w(TAG, "playback failed", error)
        state(PlayerState(idle = true))
        // mpv can't load a link that failed to either; anything else it may well play.
        if (error.errorCode !in LINK) return listener?.onUnplayable(unplayable(error)) ?: Unit
        val (message, cause) = failureOf(error)
        listener?.onEnded("error", message, cause)
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

    override fun onAudioTrackInitialized(
        eventTime: AnalyticsListener.EventTime,
        audioTrackConfig: AudioSink.AudioTrackConfig,
    ) {
        audioTrack = audioTrackConfig
        state(PlayerState(passthrough = !Util.isEncodingLinearPcm(audioTrackConfig.encoding)))
    }

    /** Paused or waiting, polls go on while the cache fills, until nothing changes. */
    private val poll = object : Runnable {
        override fun run() {
            val grew = reportPosition()
            idlePolls = if (player.isPlaying || grew) 0 else idlePolls + 1
            if (url != null && idlePolls < IDLE_POLLS) main.postDelayed(this, pollMs())
        }
    }

    private var idlePolls = 0

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
        texts.trimHidden(text, player.currentPosition * 1000)
        sendLines()
        val buffered = buffered()
        val grew = buffered != reported.buffered
        state(PlayerState(positionMs = player.currentPosition.toDouble(), buffered = buffered))
        return grew
    }

    private fun buffered(): List<TimeRange> {
        val spans = mutableListOf(player.currentPosition * 1000 to player.bufferedPosition * 1000)
        val map = seekMap?.takeIf { it.isSeekable }
        val held = cache.held()
        val durationUs = map?.durationUs?.takeIf { it > 0 }
        if (map != null && held != null && durationUs != null) {
            // Runs past the last seek point hold the index and other data after the media.
            val last = map.getSeekPoints(durationUs).first.position
            for (run in held.runs) {
                if (run.first < last) spans += timeAt(map, run.first, durationUs, held.length) to timeAt(map, run.last + 1, durationUs, held.length)
            }
        }
        val ranges = mutableListOf<TimeRange>()
        for ((startUs, endUs) in spans.filter { it.second > it.first }.sortedBy { it.first }) {
            val start = (startUs / 1000).toDouble()
            val end = (endUs / 1000).toDouble()
            val previous = ranges.lastOrNull()
            if (previous != null && start <= previous.endMs) ranges[ranges.lastIndex] = previous.copy(endMs = max(previous.endMs, end))
            else ranges += TimeRange(start, end)
        }
        return ranges
    }

    private fun timeAt(map: SeekMap, position: Long, durationUs: Long, length: Long): Long {
        if (length > 0 && position >= length) return durationUs
        var low = 0L
        var high = durationUs
        while (high - low > SEARCH_US) {
            val mid = (low + high) ushr 1
            if (map.getSeekPoints(mid).first.position <= position) low = mid else high = mid
        }
        val before = map.getSeekPoints(low).first
        if (position <= before.position) return before.timeUs
        val next = map.getSeekPoints(before.timeUs + 1)
        val (afterUs, afterPosition) = when {
            next.second != next.first -> next.second.timeUs to next.second.position
            length > 0 -> durationUs to length
            else -> return before.timeUs
        }
        if (afterPosition <= before.position) return before.timeUs
        val fraction = (position - before.position).toDouble() / (afterPosition - before.position)
        return before.timeUs + (fraction * (afterUs - before.timeUs)).toLong()
    }

    /** The reader's name for [reference]. */
    private fun referenceKey() = reference?.let { tracks.format("sub", it) }?.id?.substringAfter(':')

    private fun sendLines() {
        val track = reference ?: return
        val read = subtitleLines.take()
        if (read.isNotEmpty()) listener?.onSubtitleLines(track.toString(), read)
    }

    private fun state(update: PlayerState) {
        val changed = update.changesFrom(reported)
        reported = reported.then(update)
        if (changed != PlayerState()) listener?.onState(changed)
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

    private companion object {
        const val TAG = "exo"
        const val POLL_MS = 250L
        const val IDLE_POLL_MS = 1000L
        const val IDLE_POLLS = 10
        const val SEARCH_US = 1000L
        const val FRAMES_STOPPED_NS = 100_000_000L
        const val VOLUME_MAX = 130.0
        const val SMALL_FONTS_BYTES = 8L shl 20
        const val LANDING_MS = 10_000.0
        const val SKIP_REACTION_MS = 2_000.0
        const val SMALL_ASS_CACHE_MB = 32
        const val SHORT_ASS_CACHE_MB = 8
        const val REASON_CHARS = 200

        /** The layouts the page offers. */
        val CHANNELS = mapOf("stereo" to 2, "5.1" to 6, "7.1" to 8)

        /** The DTS types FFmpeg decodes. */
        val DTS = setOf(MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_EXPRESS, MimeTypes.AUDIO_DTS_HD)

        /** The sound type an audio track carries, PCM for any decoded sound. */
        fun mimeOf(encoding: Int) = when (encoding) {
            C.ENCODING_AC3 -> MimeTypes.AUDIO_AC3
            C.ENCODING_E_AC3 -> MimeTypes.AUDIO_E_AC3
            C.ENCODING_E_AC3_JOC -> MimeTypes.AUDIO_E_AC3_JOC
            C.ENCODING_AC4 -> MimeTypes.AUDIO_AC4
            C.ENCODING_DTS -> MimeTypes.AUDIO_DTS
            C.ENCODING_DTS_HD -> MimeTypes.AUDIO_DTS_HD
            C.ENCODING_DTS_UHD_P2 -> MimeTypes.AUDIO_DTS_X
            C.ENCODING_DOLBY_TRUEHD -> MimeTypes.AUDIO_TRUEHD
            else -> MimeTypes.AUDIO_RAW
        }

        /** Errors loading the link. */
        val LINK = 2000..2999

        /** mpv's words for a link that failed to load, which the page knows, and why it failed. */
        fun failureOf(error: PlaybackException): Pair<String, String> {
            val causes = generateSequence<Throwable>(error) { it.cause }.toList()
            causes.filterIsInstance<HttpDataSource.InvalidResponseCodeException>().firstOrNull()?.let {
                return "loading failed" to "HTTP error ${it.responseCode} ${it.responseMessage.orEmpty()}".trim()
            }
            return "loading failed" to when (error.errorCode) {
                PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED -> "could not connect to the server"
                PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "the server took too long to answer"
                else -> error.errorCodeName.removePrefix("ERROR_CODE_IO_").lowercase().replace('_', ' ')
            }
        }

        /** Why ExoPlayer can't play the file, with Media3's own reason. */
        fun unplayable(error: PlaybackException): String {
            undecodable(error)?.let { return it }
            val causes = generateSequence<Throwable>(error) { it.cause }.toList()
            if (causes.any { it is UnrecognizedInputFormatException }) return "ExoPlayer doesn't recognise this file's format"
            val code = error.errorCodeName.removePrefix("ERROR_CODE_").lowercase().replace('_', ' ')
            val reason = causes.filterIsInstance<ParserException>().firstNotNullOfOrNull { reasonOf(it) }
                ?: listOfNotNull(code, unexpected(error, causes)).joinToString(": ")
            return "ExoPlayer can't play this file: $reason"
        }

        /** The words of an exception Media3 didn't expect, which its code says nothing of. */
        fun unexpected(error: PlaybackException, causes: List<Throwable>): String? {
            if (error.errorCode !in UNEXPECTED) return null
            return causes.drop(1)
                .firstNotNullOfOrNull { cause -> cause.message?.lineSequence()?.first()?.trim()?.takeIf { it.isNotEmpty() } }
                ?.take(REASON_CHARS)
        }

        /** The parser's message, in plain words where it's a known one. */
        fun reasonOf(error: ParserException): String? {
            // Media3 adds its fields to the message.
            val message = error.message.substringBefore("{contentIsMalformed").trim().takeIf { it.isNotEmpty() }
            val algorithm = message?.let { Regex("""^ContentCompAlgo (\d+) not supported""").find(it) }?.groupValues?.get(1)
            return when (algorithm) {
                null -> message
                "1" -> "it has bzip2-compressed tracks"
                "2" -> "it has LZO-compressed tracks"
                else -> "it has tracks compressed in a way it can't read"
            }
        }

        fun undecodable(error: PlaybackException): String? {
            if (error.errorCode !in DECODING) return null
            val format = (error as? ExoPlaybackException)?.rendererFormat
            return cantPlay(format, if (MimeTypes.isAudio(format?.sampleMimeType)) "audio" else "video")
        }

        /** The file's video, or all of its audio, which the device has no decoder for at all. */
        fun undecodable(tracks: Tracks): String? {
            for ((type, kind) in listOf(C.TRACK_TYPE_VIDEO to "video", C.TRACK_TYPE_AUDIO to "audio")) {
                val groups = tracks.groups.filter { it.type == type }
                val decodable = groups.any { group -> (0 until group.length).any { group.isTrackSupported(it, true) } }
                if (groups.isNotEmpty() && !decodable) return cantPlay(groups[0].getTrackFormat(0), kind)
            }
            return null
        }

        fun cantPlay(format: Format?, kind: String): String {
            val codec = when (format?.sampleMimeType) {
                // Not codecOf's hevc: the device may well play HEVC, just not this profile.
                MimeTypes.VIDEO_DOLBY_VISION ->
                    "Dolby Vision" + format.codecs?.split('.')?.getOrNull(1)?.toIntOrNull()?.let { " profile $it" }.orEmpty()
                else -> format?.let(ExoTracks::codecOf)?.takeIf { it.isNotEmpty() }
            }
            return "this device can't play ${listOfNotNull(codec, kind).joinToString(" ")}"
        }

        val DECODING = setOf(
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
            PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED,
        )

        val UNEXPECTED = setOf(PlaybackException.ERROR_CODE_UNSPECIFIED, PlaybackException.ERROR_CODE_FAILED_RUNTIME_CHECK)
    }
}
